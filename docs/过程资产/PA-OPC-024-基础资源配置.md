# PA-OPC-024 基础资源配置与默认选型记录

- 变更编号：CR-2026-11-14-03
- 日期：2026-11-14
- 发起人：老板
- 变更类型：新增能力（项目监理·公司基础资源）
- 关联：`OPC-SRS-105`、`OPC-DBDD-001`、`OPC-IRS-001`、`OPC-RTM-001`、`OPC-STD-001`、`OPC-STP-001`、`OPC-STR-001`、`OPC-SDD-001`、`spec/opc-xuanji/*`、`migrations/0008_shared_resources.sql`、`src/domains/admin/service.ts`、`test/integration/admin-shared.test.ts`

## 1. 原始需求

作为公司的项目管理，需要有公共的基础设定：包括公司公用的版本库、制品库、测试服务器、NAS 存储、公网服务器、域名等基础资源；增加基础资源配置，新建项目时默认从这些资源里面选。测试服务器的远程管理方式支持 ssh、Windows 远程桌面、向日葵等；公司默认用 Debian 系统、SSH 远程管理，默认账号 `canetwork`（口令不落库、不落仓）。

## 2. 变更内容

- `OPC-SRS-105` 由 22 条需求扩展为 26 条，新增：
  - `REQ-PRJ-023` 公司基础资源目录（六类共享资源）；
  - `REQ-PRJ-024` 远程管理方式与公司默认口径（debian / ssh / 默认账号 / 凭据引用）；
  - `REQ-PRJ-025` 新建项目按默认资源选型；
  - `REQ-PRJ-026` 项目基础资源绑定与追溯。
- 新增 3 个实体与迁移 `migrations/0008_shared_resources.sql`：`SharedResource`（`ref.shared_resource`，六类资源目录）、`SharedSetting`（`ref.shared_setting`，公司默认口径）、`ProjectSharedResource`（`ref.project_shared_resource`，项目绑定）。
- 公司默认口径种子：`company.default_os=debian`、`company.default_remote_method=ssh`、`company.default_account=canetwork`、`company.default_credential_ref=env:OPC_DEFAULT_SSH_PASSWORD`、`company.default_ssh_port=22`。
- 已确认资源种子三条：`git-primary`（GitHub 主仓库）、`test-debian52`（本机测试服务器，Debian + SSH，账号 `canetwork`，`is_default`）、`domain-main`（主域名）。制品库/NAS/公网服务器支持登记，但不预置虚构地址。
- `AdminService` 新增 8 个方法：`sharedDefaults`、`listSharedResources`、`createSharedResource`、`updateSharedResource`、`removeSharedResource`、`listProjectSharedResources`、`bindProjectSharedResources`、`unbindProjectSharedResource`；`createProject` 改为默认按 `is_default + active` 选型绑定，`resourceIds` 显式覆盖、`bindDefaults=false` 关闭。
- 新增 8 个 HTTP operation（P77–P84）与 4 个错误码 `ERR-RES-001..004`；契约 operation 89→97，实体 76→79，用例 21→23。
- 新增集成测试 `test/integration/admin-shared.test.ts`（TC-RES-001..005）。
- 文档同步：`OPC-SRS-001` §12、`OPC-SRS-105`、`OPC-DBDD-001`（79 张表 + §3.10）、`OPC-IRS-001`（§7.6、§9.1.1、§10.1）、`OPC-RTM-001`、`OPC-STD-001`（§4.25）、`OPC-STP-001`（§12）、`OPC-STR-001`（§11）、`OPC-SDD-001` §5.7、`docs/index.md`、`pa-index`、`CHANGELOG`、`README`。

## 3. 关键边界

- **凭据只存引用**：`credential_ref` 仅接受 `env:/secret:/vault:/ssh-agent:`；疑似明文口令直接 400 `ERR-RES-002`。默认账号 `canetwork` 入库，实际口令由部署环境变量 `OPC_DEFAULT_SSH_PASSWORD` 注入，库、仓、日志均不出现明文。
- **共享资产、项目绑定**：资源是公司级目录，项目只绑定不复制；更换地址只改资源一处。被项目绑定的资源删除返回 409 `ERR-RES-004`，外键 `ON DELETE RESTRICT` 兜底。
- **默认不覆盖显式选择**：默认选型仅在未传 `resourceIds` 时生效；`bindDefaults=false` 完全不绑定。
- **不预置虚构地址**：只播种已确认的版本库/测试服务器/域名；其余类型登记后，后续新建项目自动带上。
- **跨域不越权**：管理面写操作记 `actor=boss` 审计，沿用既有管理面鉴权口径。

## 4. 落地进度

- 迁移：业务库 `opc` 与测试库 `opc_test` 均已应用 `0008_shared_resources.sql`（各 skipped 7 / applied 1，exit 0）。
- 契约：`npm run spec:check` PASS（79 实体 / 23 用例 / 21 模块）；`api.yaml` 97 operation、25 errorCodes。
- 代码：`npm run typecheck` exit 0。
- 测试：`test/integration/admin-shared.test.ts` 5/5 pass；全量 `npm test` 全绿（结果见 `OPC-STR-001` §11）。
- 文档：`npm run docs:check` PASS（28 份文档）。
- 部署：`dsh-web` 重启后生效（发版值守或人工 `restart.sh`）。

## 5. 回滚

- 代码：`git reset --hard <上一提交>` 后重启 `dsh-web`。
- 数据：`0008` 只新增 `ref.shared_resource`、`ref.shared_setting`、`ref.project_shared_resource` 三表；旧代码不读取这三张表，回滚代码无需删表（删表会丢失已登记资源）。
- 配置：`OPC_DEFAULT_SSH_PASSWORD` 未被读取也不影响健康检查；凭据引用缺失时仅 SSH 登录侧需人工补。

## 6. 关联

- 上游需求：`OPC-SRS-105` §3.23–§3.26；`OPC-SRS-001` §12。
- 下游实现：`migrations/0008_shared_resources.sql`、`src/domains/admin/service.ts`、`src/api/http.ts`、`src/platform/errors.ts`、`test/integration/admin-shared.test.ts`。
- 规格：`spec/opc-xuanji/entities.yaml`（79）、`api.yaml`（97）、`usecases.yaml`（23）、`modules.yaml`（admin 责任边界）。
