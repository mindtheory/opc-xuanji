# PA-OPC-027 运维反馈闭环（运行错误自动开 Issue / AI 审视使用习惯）记录

- 变更编号：CR-2026-11-14-06
- 日期：2026-11-14
- 发起人：老板
- 变更类型：新增能力（平台·运维反馈）
- 关联：`OPC-SRS-001` §8.5/§12、`OPC-DBDD-001`、`OPC-IRS-001`、`OPC-RTM-001`、`OPC-STD-001`、`OPC-STP-001`、`OPC-STR-001`、`OPC-SDD-001`、`spec/opc-xuanji/*`、`migrations/0011_ops_feedback.sql`、`src/ops/feedback.ts`、`src/api/http.ts`、`src/scheduler/tasks/index.ts`、`test/integration/ops.test.ts`

## 1. 原始需求

增加 opc-xuanji 项目自动提交运行错误到 git issue 的功能；增加使用 AI 自动审视用户使用项目的习惯的功能，可以发现更好的用户操作体验、发现更丰富的用户需求、发现更多更便捷的工作流程，反馈到 git issue。

## 2. 变更内容

- `OPC-SRS-001` 新增 §8.5 运维反馈功能需求 3 条：
  - `REQ-OPS-001` 运行错误自动登记并开 Issue；
  - `REQ-OPS-002` 用量遥测与使用习惯审视；
  - `REQ-OPS-003` 反馈投递治理（去重/限额/脱敏/未配置降级）。
- 新增 3 个实体与迁移 `migrations/0011_ops_feedback.sql`：`UsageEvent`（`stat.usage_event`）、`RuntimeError`（`stat.runtime_error`）、`IssueFiling`（`stat.issue_filing`）。
- 新增 `src/ops/feedback.ts`：
  - `UsageService`：HTTP 入口自动记录动作/状态/耗时/错误码（不记请求体）；按天聚合调用量、错误率、慢操作、页签分布；规则审视 + 可选 AI（OpenAI 兼容端点，只发送聚合统计）产出 [体验]/[需求]/[流程] 草稿；
  - `IssueReporter`：5xx 运行错误按「方法+路由+错误码+消息摘要」指纹去重累加；草稿投递 GitHub API，单轮 ≤5、单日 ≤20，正文脱敏（`token=/password=` 与长随机串替换为 ***）；未配置 token 时草稿标 `skipped` 并保留。
- HTTP：入口埋点 + 4 个管理面 operation（`GET /admin/usage/summary`、`POST /admin/usage/insight`、`GET /admin/issues`、`POST /admin/issues/sync`，P91–P94；契约 103→107）；新增错误码 `ERR-OPS-001/002`（32 个）。
- 定时任务 +2：`issue_autofile`（每 30 分钟）、`usage_insight`（每周一 09:00）；工具 +2：`opc_ops_usage_summary`、`opc_ops_issues_sync`（37→39）。
- 配置项：`OPC_GITHUB_TOKEN`（未配置只攒草稿）、`OPC_GITHUB_REPO`（默认 `mindtheory/opc-xuanji`）、`OPC_GITHUB_API_BASE`（默认 `https://api.github.com`，测试用 mock）、`OPC_GITHUB_LABELS`（默认空，避免 422）、`OPC_GITHUB_MAX_PER_RUN`；AI：`OPC_AI_API_KEY`（回退 `DEEPSEEK_API_KEY`）、`OPC_AI_BASE_URL`、`OPC_AI_MODEL`、`OPC_AI_DISABLED`。
- 计数同步：实体 86→89；用例 26→28；operation 103→107；错误码 30→32；工具 37→39；测试 110→115；表 86→89。
- 文档同步：`OPC-SRS-001`（§8.5、§12）、`OPC-DBDD-001`（§3.13）、`OPC-IRS-001`、`OPC-RTM-001`、`OPC-STD-001`（§4.28）、`OPC-STP-001`（§15）、`OPC-STR-001`（§14）、`OPC-SDD-001`、`docs/index.md`、`pa-index`、`CHANGELOG`、`README`、`.env.example`。

## 3. 关键边界

- **隐私**：遥测只记动作/状态/耗时/错误码，不记请求体、业务数据与敏感值；Issue 正文脱敏后再投递。
- **去重与限额**：同指纹只登记一行、只开一个 Issue；单轮 ≤5、单日 ≤20，避免刷爆仓库。
- **降级**：GitHub 未配置或不可达时，草稿保留（`skipped`/`failed`），不影响 API 与定时任务主流程。
- **AI 可选**：未配置密钥或 `OPC_AI_DISABLED=1` 时走规则审视（高频失败/慢操作/未使用页签），不阻塞。
- **不自动改代码**：Issue 只做反馈，不触发自动修复或自动发布。

## 4. 落地进度

- 迁移：业务库 `opc` 与测试库 `opc_test` 均已应用 `0011_ops_feedback.sql`。
- 契约：`npm run spec:check` PASS（89 实体 / 28 用例 / 21 模块；107 operation / 32 errorCodes）。
- 代码：`npm run typecheck` exit 0。
- 测试：`test/integration/ops.test.ts` 5/5 pass（GitHub 本地 mock、AI 走规则路径）；全量 `npm test` 全绿（见 `OPC-STR-001` §14）。
- 文档：`npm run docs:check` PASS（28 份文档）。
- 部署：`dsh-web` 重启后生效；配置 `OPC_GITHUB_TOKEN` 后由 `issue_autofile` 定时投递。

## 5. 回滚

- 代码：`git reset --hard <上一提交>` 后重启 `dsh-web`。
- 数据：`0011` 只新增 3 张表；回滚代码无需删表（删表会丢失用量与 Issue 记录）。
- 配置：移除 `OPC_GITHUB_TOKEN` 即停止投递，草稿仍会保留。

## 6. 关联

- 上游需求：`OPC-SRS-001` §8.5、§12。
- 下游实现：`migrations/0011_ops_feedback.sql`、`src/ops/feedback.ts`、`src/api/http.ts`、`src/plugin/index.ts`、`src/scheduler/tasks/index.ts`、`test/integration/ops.test.ts`。
- 规格：`spec/opc-xuanji/entities.yaml`（89）、`api.yaml`（107）、`usecases.yaml`（28）。
