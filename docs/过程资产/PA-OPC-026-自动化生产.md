# PA-OPC-026 自动化生产（骨架 / 流水线 / 测试环境）记录

- 变更编号：CR-2026-11-14-05
- 日期：2026-11-14
- 发起人：老板
- 变更类型：能力增强（项目监理·自动化生产）
- 关联：`OPC-SRS-105`、`OPC-SRS-001`、`OPC-DBDD-001`、`OPC-IRS-001`、`OPC-RTM-001`、`OPC-STD-001`、`OPC-STP-001`、`OPC-STR-001`、`OPC-SDD-001`、`spec/opc-xuanji/*`、`migrations/0010_autopilot_production.sql`、`src/domains/project/autopilot.ts`、`client.js`、`test/integration/autopilot.test.ts`

## 1. 原始需求

自动化生产要往前推到：自动生成代码骨架、自动跑测试流水线、自动发测试环境；管理面 UI 加「自动驾驶」页签。

## 2. 变更内容

- `OPC-SRS-105` 由 30 条需求扩展为 33 条，新增：
  - `REQ-PRJ-031` 自动生成代码骨架；
  - `REQ-PRJ-032` 自动跑测试流水线；
  - `REQ-PRJ-033` 自动发布测试环境。
- 新增 3 个实体与迁移 `migrations/0010_autopilot_production.sql`：`ProjectScaffold`（`stat.project_scaffold`）、`ProjectPipelineRun`（`stat.project_pipeline_run`）、`ProjectDeployRun`（`stat.project_deploy_run`）。
- `ProjectAutopilotService` 增加：
  - `generateScaffold`：按技术栈**只补缺失文件**（Node：`src/index.js`/`test/smoke.test.js`/`.gitignore`/`Dockerfile`；Python：`src/main.py`/`tests/test_smoke.py`/`.gitignore`），提交到 `opc/autopilot-<时间戳>` **本地分支，不推送远端**；
  - `runPipeline`：识别 `lint/build/test` 脚本与 go/pytest 步骤，最多 3 步，300s 超时 + 最小环境变量，默认**不安装依赖**（`install=true` 才 `npm install --ignore-scripts`），逐阶段落库；
  - `deployTestEnvironment`：建测试环境发布单（`approved`），执行 `OPC_TEST_DEPLOY_CMD` 或显式命令并可选健康检查；**无命令 → pending + 裁决**。
- 新增 HTTP operation `deployProjectTest`（`POST /admin/projects/{projectId}/deploy-test`，P90；契约 102→103）；新增错误码 `ERR-AUTO-005`（30 个）。
- 裁决新增触发项：`scaffold_review`（骨架是否合并，low）、`pipeline_failed`（流水线失败，high）、`deploy_executor`（未配置发布命令，high）、`deploy_failed`（发布失败，high）。
- 管理面 UI：`client.js` 新增「自动驾驶」页签（经营分组），支持填版本库一键自动生产、查看检出/扫描/计划/流水线/发布结果、就地裁决；页签数 12→13。
- 工作区默认路径：`OPC_WORKSPACE_ROOT`，默认 `~/.opc-workspaces`（原 `/tmp` 小分区易被克隆撑满，已在本次排障中确认）。
- 计数同步：员工需求 153→156；实体 83→86；用例 25→26；operation 102→103；错误码 29→30；测试 107→110；表 83→86。
- 文档同步：`OPC-SRS-105`、`OPC-SRS-001` §12、`OPC-DBDD-001`（§3.12）、`OPC-IRS-001`（§7.6/§9.1.2/§10.1）、`OPC-RTM-001`、`OPC-STD-001`（§4.27）、`OPC-STP-001`（§14）、`OPC-STR-001`（§13）、`OPC-SDD-001`、`docs/index.md`、`pa-index`、`CHANGELOG`、`README`。

## 3. 关键边界

- **骨架只补缺失、只提交本地分支**：不覆盖既有文件、不 push 远端；是否合并为项目基线由老板裁决（`scaffold_review`）。
- **流水线可执行但受限**：300s 超时、最小环境变量（`PATH/HOME/LANG/CI`）、输出截断、默认不装依赖、安装必须显式开启且带 `--ignore-scripts`。
- **发布只到测试环境**：生产仍走人工审批；无执行命令不假装成功，落 `pending` 并转裁决。
- **失败必转裁决**：流水线失败、发布失败、骨架待合并都进入裁决队列，其余流程自动完成。
- **磁盘安全**：克隆默认落用户目录而非 `/tmp` 小分区；可用 `OPC_WORKSPACE_ROOT` 覆盖。

## 4. 落地进度

- 迁移：业务库 `opc` 与测试库 `opc_test` 均已应用 `0010_autopilot_production.sql`（applied 1 / skipped 9，exit 0）。
- 契约：`npm run spec:check` PASS（86 实体 / 26 用例 / 21 模块；103 operation / 30 errorCodes）。
- 代码：`npm run typecheck` exit 0；`client.js` 语法检查通过。
- 测试：`test/integration/autopilot.test.ts` 7/7 pass；全量 `npm test` 全绿（见 `OPC-STR-001` §13）。
- 文档：`npm run docs:check` PASS（28 份文档）。
- 部署：`dsh-web` 重启后生效；刷新页面可见「自动驾驶」页签。

## 5. 回滚

- 代码：`git reset --hard <上一提交>` 后重启 `dsh-web`。
- 数据：`0010` 只新增 3 张表；旧代码不读这三张表，回滚代码无需删表。
- 工作区：检出目录在 `OPC_WORKSPACE_ROOT`（默认 `~/.opc-workspaces`）下，可按项目清理。
- UI：`client.js` 回滚即恢复 12 页签；旧页面刷新后生效。

## 6. 关联

- 上游需求：`OPC-SRS-105` §3.31–§3.33；`OPC-SRS-001` §12。
- 下游实现：`migrations/0010_autopilot_production.sql`、`src/domains/project/autopilot.ts`、`src/domains/admin/service.ts`、`src/api/http.ts`、`client.js`、`test/integration/autopilot.test.ts`。
- 规格：`spec/opc-xuanji/entities.yaml`（86）、`api.yaml`（103）、`usecases.yaml`（26）。
