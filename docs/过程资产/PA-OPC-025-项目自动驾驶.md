# PA-OPC-025 项目自动驾驶与裁决队列记录

- 变更编号：CR-2026-11-14-04
- 日期：2026-11-14
- 发起人：老板
- 变更类型：新增能力（项目监理·自动驾驶）
- 关联：`OPC-SRS-105`、`OPC-SRS-001`、`OPC-DBDD-001`、`OPC-IRS-001`、`OPC-RTM-001`、`OPC-STD-001`、`OPC-STP-001`、`OPC-STR-001`、`OPC-SDD-001`、`spec/opc-xuanji/*`、`migrations/0009_project_autopilot.sql`、`src/domains/project/autopilot.ts`、`test/integration/autopilot.test.ts`

## 1. 原始需求

项目管理中，新增项目的时候就填写版本库；增加了版本库以后，自动从版本库中检出项目，按项目内容填写项目管理中需要的数据，并自动制定测试计划、开发计划、部署计划等等内容，实现软件的自动化生产。需要老板裁决的，才提交到裁决等待结果。

## 2. 变更内容

- `OPC-SRS-105` 由 26 条需求扩展为 30 条，新增：
  - `REQ-PRJ-027` 建项目自动检出（浅克隆 + 检出留痕）；
  - `REQ-PRJ-028` 仓库静态扫描与项目档案回填；
  - `REQ-PRJ-029` 自动生成开发/测试/部署计划；
  - `REQ-PRJ-030` 裁决队列与人工放行。
- 新增 4 个实体与迁移 `migrations/0009_project_autopilot.sql`：`ProjectCheckout`（`ref.project_checkout`）、`ProjectScan`（`stat.project_scan`）、`ProjectPlan`（`stat.project_plan`）、`ProjectDecision`（`stat.project_decision`）。
- 新增 `ProjectAutopilotService`（`src/domains/project/autopilot.ts`）：
  - `bootstrap`：登记版本库 → 浅克隆（`git clone --depth 1`，120s 超时，`env:` 凭据经临时 askpass，不落明文）→ 静态扫描 → 回填档案 → 生成三份计划 → 裁决项入队；
  - `summary/listPlans/listDecisions/decide`：查询与裁决闭环。
- 接入建项目入口：`POST /api/v1/admin/projects` 支持 `repository:{url,branch?,authRef?}`，创建后自动执行自动驾驶；新增 5 个 HTTP operation（P85–P89）与 4 个错误码 `ERR-AUTO-001..004`；新增工具 `opc_project_bootstrap`（36→37 个工具）。
- 计划生成口径：开发计划按代码规模估 2–12 周并落 5 个里程碑；测试计划生成 `draft` 计划 + 3 条基线用例；部署计划复用公司默认测试服务器登记测试环境，生产目标 `waiting-for-decision`。
- 裁决触发条件：无 LICENSE、无自动化测试、无 CI、无公网/生产服务器、技术栈歧义或缺失。
- 计数同步：员工需求 149→153；实体 79→83；用例 23→25；operation 97→102；错误码 25→29；工具 36→37；测试 103→107；表 79→83。
- 文档同步：`OPC-SRS-105`、`OPC-SRS-001` §12、`OPC-DBDD-001`（§3.11）、`OPC-IRS-001`（§7.6/§9.1.2/§10.1）、`OPC-RTM-001`、`OPC-STD-001`（§4.26）、`OPC-STP-001`（§13）、`OPC-STR-001`（§12）、`OPC-SDD-001`、`docs/index.md`、`pa-index`、`CHANGELOG`、`README`。

## 3. 关键边界

- **只读扫描，不执行仓库代码**：不跑 `npm install`、不构建、不执行仓库脚本；只读文件与 `git rev-parse`。检出上限 2000 文件，跳过 `.git/node_modules/dist/build/target/vendor` 等目录。
- **失败不伪造**：检出失败写 `status=failed` + 错误摘要并返回 502 `ERR-AUTO-002`，不生成计划、不回填档案。
- **凭据只存引用**：检出凭据只接受 `env:` 引用（`ERR-AUTO-003`），临时 askpass 脚本不含 token 值，用后即删。
- **生产不放行**：自动只到「计划草案 + 测试环境登记」；生产发布目标保持 `waiting-for-decision`，必须老板裁决后走人工审批。
- **计划默认 draft**：开发/测试/部署计划均为草案，需人工确认；不因自动化直接进入执行态。

## 4. 落地进度

- 迁移：业务库 `opc` 与测试库 `opc_test` 均已应用 `0009_project_autopilot.sql`（applied 1 / skipped 8，exit 0）。
- 契约：`npm run spec:check` PASS（83 实体 / 25 用例 / 21 模块；102 operation / 29 errorCodes）。
- 代码：`npm run typecheck` exit 0。
- 测试：`test/integration/autopilot.test.ts` 4/4 pass（本地 `file://` git 夹具，无外网依赖）；全量 `npm test` 全绿（见 `OPC-STR-001` §12）。
- 文档：`npm run docs:check` PASS（28 份文档）。
- 部署：`dsh-web` 重启后生效。

## 5. 回滚

- 代码：`git reset --hard <上一提交>` 后重启 `dsh-web`。
- 数据：`0009` 只新增 4 张表；旧代码不读这四张表，回滚代码无需删表（删表会丢失检出/扫描/计划/裁决记录）。
- 工作区：检出目录在 `OPC_WORKSPACE_ROOT`（默认 `/tmp/opc-workspaces`）下，可按项目清理。

## 6. 关联

- 上游需求：`OPC-SRS-105` §3.27–§3.30；`OPC-SRS-001` §12。
- 下游实现：`migrations/0009_project_autopilot.sql`、`src/domains/project/autopilot.ts`、`src/domains/admin/service.ts`、`src/api/http.ts`、`src/plugin/index.ts`、`test/integration/autopilot.test.ts`。
- 规格：`spec/opc-xuanji/entities.yaml`（83）、`api.yaml`（102）、`usecases.yaml`（25）、`modules.yaml`（project 责任边界）。
