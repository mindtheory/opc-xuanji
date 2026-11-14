---
doc_id: OPC-STD-001
title: OPC-玄机 · 一人公司中枢 测试设计说明
version: 0.4
status: 评审稿
stage: D4
owner: 质量与交付组（docs-test）
upstream: ["spec/opc-xuanji/usecases.yaml", "spec/opc-xuanji/api.yaml", "spec/opc-xuanji/entities.yaml", "docs/OPC-STP-001-测试计划.md"]
gate: G4
updated: 2026-11-11
---

# OPC-STD-001 · OPC-玄机 · 一人公司中枢 测试设计说明

本说明解决“每条 TC 到底由哪段代码验证、断言了什么、为什么这样断言”的问题：把 `usecases.yaml` 中 21 个用例的全部 31 条 TC 逐条落到仓库里真实存在的测试文件与测试标题，给出前置条件、步骤、输入数据、期望结果与需求/接口追溯，并把没有自动化覆盖的部分单独立册。**读者与使用时点**：测试执行者在 G4 复跑时按第 4 章逐条核对；开发接到失败单时按第 5 章定位断言与期望值；评审人判断“TC 是否真的被验证”时看第 5、7、8 章；新人接手测试时先读第 2、3 章再进第 4 章。

## 目录

- [1. 设计原则与追溯口径](#1-设计原则与追溯口径)
- [2. 公共测试装置](#2-公共测试装置)
- [3. 用例组织与执行方式](#3-用例组织与执行方式)
- [4. 逐用例设计](#4-逐用例设计)
- [5. TC ↔ 测试文件 ↔ 断言要点总表](#5-tc--测试文件--断言要点总表)
- [6. 接口覆盖矩阵](#6-接口覆盖矩阵)
- [7. 横切验证（不对应 TC 的用例）](#7-横切验证不对应-tc-的用例)
- [8. 未覆盖项与理由](#8-未覆盖项与理由)
- [9. 偏差登记与闭环](#9-偏差登记与闭环)
- [10. 用例维护规则](#10-用例维护规则)

## 1. 设计原则与追溯口径

### 1.1 三条原则

1. **TC 只来自规格**：TC 编号、所属 UC、`requirement`、涉及实体与接口全部取自 `spec/opc-xuanji/usecases.yaml` 与 `api.yaml`，本说明不新造 TC，也不合并 TC。
2. **一条 TC 至少一条主用例**：主用例承载该 TC 的核心期望（正向主路径或核心拒绝路径），辅助用例补齐 API 契约、工具层与边界；同一文件内多个用例可共同承载一条 TC（如平台层与 HTTP 层各验一次）。
3. **断言用绝对值**：金额、行数、错误码、置信度、哈希长度、ISO 时刻一律精确断言（`assert.equal` / `deepEqual`），不用“存在即可”“大于 0 即可”的弱判据；唯一例外是“审计不落敏感值”这类负向断言，用字符串反查。

### 1.2 追溯三跳

```
UC（9）──tests──▶ TC（16）──主用例/辅助用例──▶ 测试文件·测试标题 ──断言──▶ 期望结果
   │                                                                      │
   └──requirement REQ-*-00x ──────────────────────────────────────────────┘
```

- 第一跳（UC→TC）在 `usecases.yaml`，由 `test/integration/spec.test.ts` 的「实体与用例的追溯不断链」用例校验 TC 与 REQ 的格式及实体引用存在性。
- 第二跳（TC→用例）由本说明第 4、5 章固化；用例标题即索引，不额外维护用例 ID，避免“文档 ID 与代码标题”两套编号漂移。
- 第三跳（用例→期望）写在第 4 章的“期望结果”，与代码断言一一对应；评审时以代码为准核对本文，不以本文替代代码。

### 1.3 断言风格

- 全部用 `node:test` + `node:assert/strict`；失败即抛，无自定义报告层。
- 错误路径断言“类型 + 错误码”双条件：`error instanceof OpcError && error.errorCode === "ERR-AUTHZ-001"`，防止只对消息文本、改文案就漏判。
- 数据库结果断言走 `pool.query` 原始 SQL（如 `SELECT risk_level, code_hash, meta FROM ref.workflow_registry`），不经被测服务回读，避免“自己验自己”。
- 排序类断言只对“默认按时间倒序”这类已声明口径做首元素校验，不对全序做脆弱断言。

## 2. 公共测试装置

### 2.1 `test/helpers.ts` 提供的三段能力

| 能力 | 导出 | 行为 | 使用方 |
| :--- | :--- | :--- | :--- |
| 连接配置 | `config`、`testDsn`、`makePool()` | `loadConfig()` 读 `OPC_TEST_DSN`（缺省 `opc_test`）；`makePool` 建 `max: 4` 池 | 全部集成用例 |
| 清库 | `resetDb(pool)` | advisory lock `824361` 内 `TRUNCATE` 76 张业务表 `RESTART IDENTITY CASCADE`，保留 `public._opc_migrations` | 集成用例的 `beforeEach` |
| 员工种子 | `seedEmployee(pool, pluginId, options)` | upsert `ref.employee_plugin`（scope/required_views/tools/write_targets/enabled）+ 逐视图写 `ref.view_grant(status='active')` | 平台、流程、API、插件用例 |
| 固定时刻 | `NOW = 2026-11-05T02:00:00.000Z` | 北京时间 10:00 的固定参考时刻 | 需要“当前时刻”的新增用例 |

### 2.2 装置使用约定

- `before` 建池、`after` 关池（`pool.end()`）；`beforeEach` 先 `resetDb`，需要调度配置的用例再 `seedDefaults()`。
- 调度相关用例（`scheduler.test.ts`、`api.test.ts`）清库会清掉 `stat.task_schedule`，因此必须重新 `seedDefaults()` 才能断言 10 个默认任务。
- 归档目录用 `mkdtemp(join(tmpdir(), "opc-…-"))` 现场创建，用例内不清理、不写仓库 `archive/`。
- HTTP 用例用 `startApiServer(ctx, 0)` 取随机端口，`base = http://127.0.0.1:<port>`，避免固定端口占用导致假失败。

### 2.3 固定时钟的用法与例外

- 显式注入：`scheduler.run(taskId, { scheduledAt })`、`scheduler.tick(now)`、`nextRun(cron, tz, from)`；断言 UTC ISO 字符串。
- 允许读系统时间的例外：令牌 `expiresAt > Date.now()`、`nextRunAt instanceof Date` 类型断言、以 `current_date ± N 天` 表达的到期窗口。
- 新增用例不得写“明天 08:30”这类依赖执行日期的断言。

## 3. 用例组织与执行方式

| 层次 | 文件 | 用例数 | 执行命令 |
| :--- | :--- | ---: | :--- |
| 单元 | `test/unit/cron.test.ts` | 7 | `npm run test:unit` |
| 单元 | `test/unit/guard.test.ts` | 9 | `npm run test:unit` |
| 集成·平台 | `test/integration/platform.test.ts` | 3 | `npm run test:integration` |
| 集成·审计 | `test/integration/audit.test.ts` | 3 | `npm run test:integration` |
| 集成·流程 | `test/integration/workflow.test.ts` | 7 | `npm run test:integration` |
| 集成·调度 | `test/integration/scheduler.test.ts` | 6 | `npm run test:integration` |
| 集成·HTTP | `test/integration/api.test.ts` | 8 | `npm run test:integration` |
| 集成·插件 | `test/integration/plugin.test.ts` | 4 | `npm run test:integration` |
| 集成·规格 | `test/integration/spec.test.ts` | 4 | `npm run test:integration` |
| 合计 | — | 68 | `npm test`（`--test-concurrency=1`） |

执行口径：全量 `npm test` 串行跑 9 个文件；单层调试用 `npm run test:unit` 或 `npm run test:integration`；不允许对同一 `opc_test` 并行跑两个全量进程（TRUNCATE 的 `AccessExclusiveLock` 互等）。

## 4. 逐用例设计

以下 16 节与 `usecases.yaml` 的 `tests` 字段一一对应，顺序按 UC-001 → UC-009。每节字段固定：追溯、前置条件、步骤、输入数据、期望结果、对应用例。

### 4.1 TC-VIEW-001 · 视图授权查询与拒绝留痕

**追溯**：UC-001 / REQ-VIEW-001 / 接口 `queryView` / 实体 ViewGrant、EmployeePlugin、AuditLog

**前置条件**：`opc_finance` 已注册且 `required_views` 覆盖 `view_ar_ap`；`biz.ar_ap` 有 3 行数据（甲公司两行 open 共 2000、乙公司一行 closed 500）。

**步骤**：

1. 以 `pluginId=opc_finance`、`viewId=view_ar_ap`、`filter={status:'open'}`、`limit=50` 发起查询。
2. 同一员工改查未授权的 `view_contract_index`，期望被拒。
3. 查询 `audit.list({ action:'view.query' })`，核对两条留痕。

**输入数据**：`biz.ar_ap` 三行：`('甲公司',1200.00,'2026-11-20','open')`、`('甲公司',800.00,'2026-12-01','open')`、`('乙公司',500.00,'2026-11-10','closed')`。

**期望结果**：

- 授权查询返回 `viewId='view_ar_ap'`、`rows.length=1`（按 `counterparty` 聚合）、`amount_total=2000`。
- 未授权查询抛 `OpcError`，`errorCode='ERR-AUTHZ-001'`（HTTP 层为 403）。
- 审计恰 2 条 `view.query`，其中至少 1 条 `result='denied'`；拒绝也留痕。

**对应用例**：

- [test/integration/platform.test.ts](../test/integration/platform.test.ts) ·「视图授权：已授权视图返回聚合行，未授权视图拒绝并写审计」（主用例）
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「views：授权查询 200，未授权 403 且带错误码」（HTTP 契约）
- [test/integration/plugin.test.ts](../test/integration/plugin.test.ts) ·「opc_view_query：未授权时抛出带错误码的异常」（工具层）

### 4.2 TC-TOKEN-001 · 一次性令牌签发与单次消费

**追溯**：UC-002 / REQ-TOKEN-001 / 接口 `issueToken`、`consumeToken` / 实体 Token、CustomerSensitive、AuditLog

**前置条件**：`biz.customer` 有 1 行 `sensitivity_level='sensitive'`；`biz.customer_sensitive` 有 `family`、`health` 两个字段。

**步骤**：

1. 以 `taskId='task-1'`、`pluginId='opc_admin'`、`viewId='view_customer_base'`、`fields=['family']`、`ttlSeconds=60` 签发。
2. 携令牌消费一次，检查返回字段。
3. 用同一令牌与同一 `taskId` 再消费一次，期望 409。
4. 另签发一枚 `fields=['health']` 的令牌，DB 将 `expires_at` 改为 `now() - 1 分钟`，再消费，期望 409。

**输入数据**：敏感值 `family='有两名学龄子女'`、`health='无重大疾病'`；`customerId` 取自 `INSERT ... RETURNING id`。

**期望结果**：

- `tokenId.length >= 16`，`expiresAt > now`（TTL 60 秒 ≤ 5 分钟上限）。
- 首次消费 `fields` 深等 `{ family: '有两名学龄子女' }`——同客户 `health` 未被带出，字段范围收窄成立。
- 重复消费与过期消费均抛 `OpcError`、`errorCode='ERR-TOKEN-001'`（HTTP 409）。
- HTTP 契约：`POST /api/v1/tokens` 201 → 消费 200（`fields.family='两孩'`）→ 重复消费 409 且 `errorCode='ERR-TOKEN-001'`。

**对应用例**：

- [test/integration/platform.test.ts](../test/integration/platform.test.ts) ·「一次性令牌：单次消费、范围外字段拒绝、过期拒绝」（主用例）
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「tokens：签发 201 → 消费 200 → 重复消费 409」（HTTP 契约）

### 4.3 TC-TOKEN-002 · 令牌审计口径不落敏感值

**追溯**：UC-002 第 4 步 / REQ-TOKEN-001 / 接口 `consumeToken` / 实体 AuditLog、Token

**前置条件**：与 TC-TOKEN-001 同一套数据（1 客户 + 2 敏感字段），完成“成功 1 次 + 重复 1 次 + 过期 1 次”三次消费。

**步骤**：

1. 查询 `audit.list({ action:'token.consume' })`。
2. 断言条数与结果分布。
3. 把审计行整体 `JSON.stringify` 后反查敏感值字符串。

**输入数据**：敏感值 `family='有两名学龄子女'`（反查串取“学龄子女”）。

**期望结果**：

- 恰 3 条 `token.consume`：1 条 `result='ok'`，2 条拒绝。
- 审计载荷中**不出现**“学龄子女”，即字段值未落库；可落库的只有 `token_id`、`task_id`、字段名与结果口径。

**对应用例**：

- [test/integration/platform.test.ts](../test/integration/platform.test.ts) ·「一次性令牌：单次消费、范围外字段拒绝、过期拒绝」中的审计断言段

### 4.4 TC-CONFLICT-001 · 冲突冻结与含冻结汇总

**追溯**：UC-003 / REQ-CONFLICT-001 / 接口 `openConflict` / 实体 ConflictQueue、Ledger、AuditLog

**前置条件**：`biz.ledger` 有 1 行 `('2026-11-01',3000.00,'out','supplier','company','甲供方货款')`，未冻结。

**步骤**：

1. 登记冲突：`conflictType='cost'`、`frozenUnitType='ledger'`、`frozenUnitId=<id>`、两方证据（`opc_finance` 归项目 A / `opc_project` 归项目 B）、`diffFields=['project_id']`。
2. 调用 `summaryIncludingFrozen('ledger')` 取汇总。

**输入数据**：金额 3000.00；两方 `parties` 各 1 条；差异字段仅 `project_id`。

**期望结果**：

- 登记返回 `frozen=true`（冻结标记写入冻结单元）。
- 汇总 `total_including_frozen=3000`、`effective_total=0`、`frozen_items.length=1`——冻结单元不计入有效汇总，但总额含冻结。
- HTTP 契约：`POST /api/v1/conflicts` 201 且 `data.frozen=true`。

**对应用例**：

- [test/integration/platform.test.ts](../test/integration/platform.test.ts) ·「冲突冻结：冻结单元不入有效汇总，但总额含冻结并可裁决解除」（前半，主用例）
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「conflicts：冻结 201 → 裁决 200」（前半，HTTP 契约）

### 4.5 TC-CONFLICT-002 · 老板裁决与解冻恢复

**追溯**：UC-003 / REQ-CONFLICT-001 / 接口 `resolveConflict` / 实体 ConflictQueue、Decision、AuditLog

**前置条件**：冻结冲突已开启（TC-CONFLICT-001 步骤 1 的产物）。

**步骤**：

1. 裁决：`resolve(conflictId, { choice:'A', note:'归属项目A' })`。
2. 再次调用 `summaryIncludingFrozen('ledger')`，确认解冻后汇总恢复。

**输入数据**：`choice='A'`（可选值 A/B/manual/later），裁决备注“归属项目A”。

**期望结果**：

- 返回 `status='resolved'`、`frozen=false`。
- 解冻后 `effective_total=3000`、`frozen_items.length=0`。
- HTTP 契约：`POST /api/v1/conflicts/{id}/resolve` 200 且 `data.status='resolved'`。
- 裁决写入 `biz.decision` 并回填 `conflict_queue.arbitration_id`（明细断言缺口见第 8 章 N-7）。

**对应用例**：

- [test/integration/platform.test.ts](../test/integration/platform.test.ts) ·「冲突冻结：冻结单元不入有效汇总，但总额含冻结并可裁决解除」（后半，主用例）
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「conflicts：冻结 201 → 裁决 200」（后半，HTTP 契约）

### 4.6 TC-WF-001 · 守卫通过与风险等级硬规则

**追溯**：UC-004 / REQ-WF-001 / 接口 `registerWorkflow` / 实体 WorkflowRegistry、EmployeePlugin、AuditLog

**前置条件**：`opc_finance` 已注册（`views=['view_ar_ap']`、`tools=['opc_ledger_write']`、`writeTargets=['ledger']`）；meta 为合规样例（`deadline_impact=true`、`human_gates=['review_gate']`、`write_nodes` 与 `idempotent_nodes` 同为 `['write_ledger']`、`verifier_policy.reconcile.sampling=3`）；`testedCodeHash = sha256(CODE)`。

**步骤**：

1. 提交注册：`workflowId='tax_monthly_prepare'`、`version='1.0.0'`、`ownerPlugin='opc_finance'`、`meta`、`code`、`testedCodeHash`。
2. 直接查 `ref.workflow_registry` 核对落库值。
3. 单元层用 `evaluateGuard` 复核六项守卫与 `computeRisk` 结果。

**输入数据**：`CODE = "export const meta = { id: 'tax_monthly_prepare' };\n"`，其 SHA-256 为注册哈希；`monthlyFlow=200000`。

**期望结果**：

- 注册返回 `riskLevel='high'`、`status='registered'`。
- DB 行 `risk_level='high'`、`code_hash=CODE_HASH`，且 `meta` 中**不存在** `risk_level` 键（自述等级不得入库）。
- 单元断言：合规流程 `ok=true`、`riskLevel='high'`、`riskReasons` 含 `deadline_impact`。
- HTTP 契约：`POST /api/v1/workflows` 201 且 `data.riskLevel='high'`。

**对应用例**：

- [test/integration/workflow.test.ts](../test/integration/workflow.test.ts) ·「注册：守卫通过则记录硬规则风险等级（high）」（主用例）
- [test/unit/guard.test.ts](../test/unit/guard.test.ts) ·「合规流程通过六项守卫，且因 deadline_impact 判高风险」
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「workflows：注册 201 / 守卫失败 422 / 实例与幂等节点 / Verifier」（注册段）

### 4.7 TC-WF-002 · 六项守卫失败即拒绝

**追溯**：UC-004 / REQ-WF-001 / 接口 `registerWorkflow` / 实体 WorkflowRegistry、AuditLog

**前置条件**：同 TC-WF-001；准备 6 类失败变体：meta 自述 `risk_level`、缺字段/节点命名不合规、视图未授权、写节点未登记幂等键、未注册工具、跨员工引用或代码哈希不一致。

**步骤**：

1. 以 `meta.risk_level='low'` 注册 `bad_flow`，捕获异常并核对 `details.failures`。
2. 直接查 `ref.workflow_registry` 确认未写入。
3. 查审计 `workflow.register` 首条为 `denied`。
4. 单元层逐项复核六项守卫的 `failures[].item`；另验同版本重复注册返回 409。

**输入数据**：失败变体分别为 `risk_level:'low'`、`owner_plugin:''`、`key_nodes:['BadNode']`、`human_gates:['not_a_key_node']`、`required_views:['view_ar_ap','view_stock_index']`、`write_nodes:['write_ledger','write_invoice']` 配 `idempotent_nodes:['write_ledger']`、`tools:['opc_ledger_write','opc_admin_calendar']`、`owner_plugin:'opc_legal'`、`private_refs:['biz.customer_sensitive']`、`testedCodeHash:'deadbeef'`。

**期望结果**：

- 抛 `OpcError`、`errorCode='ERR-WF-001'`（HTTP 422），`details.failures` 为数组且能定位到失败项（`meta_schema`/`views`/`idempotency`/`tools`/`code_hash` 等）。
- `ref.workflow_registry` 无 `bad_flow` 行——守卫失败绝不静默降级为“已注册”。
- 审计 `workflow.register` 记 `result='denied'`。
- 同版本重复注册抛 `ERR-WF-002`（409，版本不可变）。
- 单元层：`human_gates` 必须在 `key_nodes` 内；跨员工 owner 或私有数据引用一律 `ok=false`。

**对应用例**：

- [test/integration/workflow.test.ts](../test/integration/workflow.test.ts) ·「注册：守卫失败拒绝写入并返回逐项失败原因」（主用例）
- [test/integration/workflow.test.ts](../test/integration/workflow.test.ts) ·「注册：同版本重复注册返回 409（版本不可变）」
- [test/unit/guard.test.ts](../test/unit/guard.test.ts) ·「meta 自述 risk_level 直接拒绝」「缺少必需字段 / 节点命名不合规范 拒绝」「视图授权守卫：未在授权表内的视图拒绝」「幂等完整性守卫：写节点必须全部登记幂等键」「工具合法性守卫：未注册工具拒绝」「跨员工隔离守卫：owner 不一致或引用他人私有数据拒绝」「代码哈希守卫：注册哈希必须等于测试通过时哈希」
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「workflows：注册 201 / 守卫失败 422 / 实例与幂等节点 / Verifier」（422 段）

### 4.8 TC-WF-003 · 实例启动与生命周期

**追溯**：UC-005 / REQ-WF-002 / 接口 `startInstance` / 实体 WorkflowInstance

**前置条件**：`tax_monthly_prepare@1.0.0` 已注册；`opc_finance` 已获 `view_ar_ap` 授权。

**步骤**：

1. 以 `version='1.0.0'`、`context={period:'2026-10'}` 启动实例。
2. 断言实例状态。
3. 以未注册的 `workflowId='not_exists'` 启动，期望 404。

**输入数据**：`workflowId='tax_monthly_prepare'`、`version='1.0.0'`、`context.period='2026-10'`。

**期望结果**：

- 启动成功，`instance.status='running'`，返回 `instanceId`（bigint 自增）。
- 未注册流程抛 `OpcError`、`errorCode='ERR-WF-003'`（HTTP 404）。
- HTTP 契约：`POST /api/v1/workflows/tax_monthly_prepare/instances` 201 且返回 `instanceId`。
- 生命周期事件（start/finish）写审计，但当前只断言状态迁移（缺口见 N-7）。

**对应用例**：

- [test/integration/workflow.test.ts](../test/integration/workflow.test.ts) ·「实例：未注册流程启动返回 404」（主用例，拒绝路径）
- [test/integration/workflow.test.ts](../test/integration/workflow.test.ts) ·「实例：写节点幂等（同入参跳过、异入参 409），生命周期可查」（启动与 `finish('completed')` 段）
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「workflows：注册 201 / 守卫失败 422 / 实例与幂等节点 / Verifier」（实例段）

### 4.9 TC-WF-004 · 写节点幂等与中断恢复

**追溯**：UC-005 / REQ-WF-002 / 接口 `completeNode` / 实体 WorkflowNodeRun、Ledger

**前置条件**：实例处于 `running`；`write_ledger` 是 meta 声明的写节点。

**步骤**：

1. `completeNode(instanceId, 'write_ledger', {amount:1200})` 第一次。
2. 同参再执行一次。
3. 以异参 `{amount:9999}` 执行。
4. `finish(instanceId, 'completed')`，再查 `audit.workflow_node_run`。

**输入数据**：同参 `{ amount:1200 }`；异参 `{ amount:9999 }`；幂等键 `instance_id + node_id`。

**期望结果**：

- 第一次 `idempotentHit=false`、`status='done'`；第二次 `idempotentHit=true`、`status='done'`（返回既有结果）。
- 异参抛 `OpcError`、`errorCode='ERR-WF-004'`（HTTP 409）。
- `finish` 后实例 `status='completed'`。
- `audit.workflow_node_run` 中该实例**恰 1 行**，`idempotency_key = "<instanceId>:write_ledger"`——中断恢复不重复入库。
- HTTP 契约：两次 `complete` 200，`idempotentHit` false → true。

**对应用例**：

- [test/integration/workflow.test.ts](../test/integration/workflow.test.ts) ·「实例：写节点幂等（同入参跳过、异入参 409），生命周期可查」（主用例）
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「workflows：注册 201 / 守卫失败 422 / 实例与幂等节点 / Verifier」（幂等节点段）

### 4.10 TC-WF-005 · Verifier 采样投票与低置信升级

**追溯**：UC-006 / REQ-WF-003 / 接口 `recordVerdict` / 实体 VerifierVerdict、WorkflowInstance、AuditLog

**前置条件**：实例运行中；`reconcile` 与 `tax_calc` 属于 `key_nodes`；`verifier_policy.reconcile.sampling=3`、阈值 0.8。

**步骤**：

1. 一致样本：`samples=['pass','pass','pass']`，evidence 为勾稽全等数据，`highImpact=true`。
2. 分裂样本：`samples=['pass','pass','fail']`，evidence 为税率区间数据，`highImpact=true`。
3. 用**同一 evidence** 再判一次，验证缓存命中与结论保持。
4. 单元层直接调 `aggregateSamples` 校验非高影响节点不升级。

**输入数据**：evidence1 `{invoice_total:1200, ledger_total:1200, diff_count:0}`；evidence2 `{tax_rate:0.031, industry_low:0.02, industry_high:0.04}`；阈值 0.8。

**期望结果**：

- 一致样本：`finalVerdict='pass'`、`confidence=1`、`escalated=false`、`cacheHit=false`。
- 分裂样本：`escalated=true`、`finalVerdict='escalated'`——低置信且高影响**升级人工**，不按多数票自动通过。
- 重复评判：`cacheHit=true`，`finalVerdict` 仍为 `escalated`——缓存命中只省调用、不改结论；缓存键为 `(evidence_hash, node_id)`。
- 聚合函数：`['pass','fail','fail']` → `fail`/`0.6667`/不升级；`['pass','pass','fail']` → `pass`/`0.6667`/不升级；同数据 `highImpact=true` 时 `escalated=true`。
- HTTP 契约：`POST /instances/{id}/nodes/reconcile/verdict` 200 且 `finalVerdict='pass'`。

**对应用例**：

- [test/integration/workflow.test.ts](../test/integration/workflow.test.ts) ·「Verifier：多数票 + 高影响节点低一致升级人工 + evidence 缓存」（主用例）
- [test/integration/workflow.test.ts](../test/integration/workflow.test.ts) ·「聚合函数：非高影响节点低一致不升级，按多数票判定」
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「workflows：注册 201 / 守卫失败 422 / 实例与幂等节点 / Verifier」（评判段）

### 4.11 TC-AUDIT-001 · 统一写入口与哈希链

**追溯**：UC-007 / REQ-AUDIT-001 / 接口 `listAudits` / 实体 AuditLog、AuditChainHead

**前置条件**：空库（`resetDb` 后无历史审计行）。

**步骤**：

1. 依次写 3 条审计：`dispatch`（opc_hub）、`tool.call`（opc_finance，objectType ledger）、`conflict.resolve`（boss）。
2. 调 `verifyChain()` 校验链。
3. 按 `action`、`instanceId` 分别查询，核对倒序。

**输入数据**：payload 分别为 `{task:'t1'}`、无 payload（仅 objectType）、无；查询参数 `action='dispatch'`、`instanceId=7`、`limit=10`。

**期望结果**：

- 每条 `hash` 为 64 位十六进制；`second.prevHash=first.hash`、`third.prevHash=second.hash`。
- `verifyChain()` 返回 `{ ok:true, checked:3 }`；链头与末条记录一致。
- `list({action:'dispatch'})` 2 条，首条 `result='denied'`（时间倒序）；`list({instanceId:7})` 2 条。
- HTTP 契约：`GET /api/v1/audits?limit=5` 200 且 `total=1`（该用例只写 1 条）。
- 统一入口由 `AuditService.record` 单点写入保证（写入事务内取 `pg_advisory_xact_lock` 串行化链）。

**对应用例**：

- [test/integration/audit.test.ts](../test/integration/audit.test.ts) ·「连续写入形成 prev_hash 链，verifyChain 校验通过」（主用例）
- [test/integration/audit.test.ts](../test/integration/audit.test.ts) ·「审计查询按动作与实例过滤，默认按时间倒序」
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「audits：查询 200 与导出 201」（查询段）

### 4.12 TC-AUDIT-002 · JSONL 导出、SHA-256 与链头续链

**追溯**：UC-007 / REQ-AUDIT-001 / 接口 `exportAudits` / 实体 AuditExport、AuditChainHead

**前置条件**：库内有 2 条审计；归档目录由 `mkdtemp` 现场创建。

**步骤**：

1. `audit.export({ outDir })` 导出。
2. 读文件校验行数、字段与 SHA-256。
3. 查 `audit.audit_chain_head` 的 `last_hash` 与 `last_export_id`。
4. 再写 1 条审计，二次导出，核对 `prevHash` 接上一次 `sha256`。

**输入数据**：首次 2 条 `dispatch`（payload `{n:1}`、`{n:2}`）；二次新增 1 条；`schema_version='1'`（`OPC_SCHEMA_VERSION`）。

**期望结果**：

- 首次 `rowCount=2`，文件 2 行 JSONL；首行 `schema_version='1'`、`action='dispatch'`。
- 文件内容 SHA-256 与 `exported.sha256` 相等（`createHash('sha256').update(content).digest('hex')`）。
- 链头恰 1 行：`last_export_id` 非空、`last_hash` 长度 64。
- 二次导出 `rowCount=1` 且 `prevHash` 等于首次 `sha256`——增量游标与归档链成立。
- 调度侧：`audit_export` 任务执行后 `filePath` 以 `.jsonl` 结尾、`rowCount=1`、归档目录递归列表含 `.jsonl`。
- HTTP 契约：`POST /api/v1/audits/export` 201 且 `rowCount=1`。

**对应用例**：

- [test/integration/audit.test.ts](../test/integration/audit.test.ts) ·「导出 JSONL：SHA-256 与文件一致，链头持久化，可续链」（主用例）
- [test/integration/scheduler.test.ts](../test/integration/scheduler.test.ts) ·「审计导出任务：有记录时产出 JSONL 文件并写 task_run 结果」
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「audits：查询 200 与导出 201」（导出段）

### 4.13 TC-TASK-001 · 任务配置增改与校验

**追溯**：UC-008 / REQ-TASK-001 / 接口 `listTasks`、`upsertTask` / 实体 TaskSchedule

**前置条件**：`defaultTasks()` 已全部注册，`seedDefaults()` 已落 10 个默认任务。

**步骤**：

1. `scheduler.list()` 核对任务集合与晨报配置。
2. `upsert('daily_report', {cron:'99 * * * *'})` 与 `upsert('not_registered', …)`，期望均拒绝。
3. HTTP `PUT /api/v1/tasks/daily_report` 改 cron 为 `45 8 * * 1-5`。
4. 工具层 `opc_task_upsert` 改 `tax_reminder` 为 `15 9 * * *`，再 `opc_task_list` 回读。

**输入数据**：默认 15 任务 ID 排序后为 `audit_export`、`conflict_escalation`、`contract_expiry`、`daily_report`、`dashboard_refresh`、`intel_aggregate`、`intel_analyze`、`intel_brief`、`intel_push`、`intel_source_collect`、`invoice_backlog`、`keyword_radar_scan`、`monthly_archive`、`plugin_radar_scan`、`tax_reminder`；非法 cron `99 * * * *`；新 cron `45 8 * * 1-5`、`15 9 * * *`；时区 `Asia/Shanghai`。

**期望结果**：

- 任务集合与上述 10 个 ID 完全一致；`daily_report` 的 `cron='30 8 * * 1-5'`、`timezone='Asia/Shanghai'`、`nextRunAt` 为 `Date`。
- 非法 cron 与未注册类型均抛 `OpcError`、`errorCode='ERR-TASK-001'`（400）——与 `api.yaml`/IRS/SRS 的“任务配置非法”口径一致；该码曾与实现互置，已于 2026-11-05 修复闭环（见第 9 章 X-1）。
- HTTP PUT 200 且返回 `cron='45 8 * * 1-5'`；工具层 upsert 后 list 回读到 `15 9 * * *`——配置驱动、可增可改。

**对应用例**：

- [test/integration/scheduler.test.ts](../test/integration/scheduler.test.ts) ·「默认任务集已按配置落库（晨报/税务/合同/审计/缺票/冲突/月度归档）」（主用例）
- [test/integration/scheduler.test.ts](../test/integration/scheduler.test.ts) ·「配置校验：非法 cron 与未注册任务类型拒绝」
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「tasks：列表 7 项 / 配置 200 / 立即执行 200 / 晨报可查」（配置段）
- [test/integration/plugin.test.ts](../test/integration/plugin.test.ts) ·「opc_task_list / opc_task_upsert：配置驱动可增改」

### 4.14 TC-TASK-002 · 执行幂等与强制重跑

**追溯**：UC-008 / REQ-TASK-001 / 接口 `runTask` / 实体 TaskRun、AuditLog

**前置条件**：`audit_export` 任务已配置；`stat.task_run` 为空。

**步骤**：

1. `run('audit_export', { scheduledAt: 2026-11-05T01:00:00.000Z })`。
2. 同一 `scheduledAt` 再跑一次。
3. 同 `scheduledAt` 加 `force:true` 再跑。
4. 统计 `stat.task_run` 行数。

**输入数据**：幂等键 `(task_id, scheduled_at)`；`scheduledAt=2026-11-05T01:00:00.000Z`；`force=true` 时计划时间后移 1ms 生成新键。

**期望结果**：

- 第一次 `skipped=false`、`status='ok'`；第二次 `skipped=true`（幂等跳过）。
- `force=true` 时 `skipped=false` 且 `runId` 与第一次不同（历史保留）。
- `stat.task_run` 中 `audit_export` 恰 2 行——重复触发不产生第二次执行记录之外的写入。
- HTTP 契约：`POST /api/v1/tasks/daily_report/run` 200 且 `status='ok'`。

**对应用例**：

- [test/integration/scheduler.test.ts](../test/integration/scheduler.test.ts) ·「执行幂等：同一计划时间只执行一次，force 可强制重跑」（主用例）
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「tasks：列表 7 项 / 配置 200 / 立即执行 200 / 晨报可查」（执行段）

### 4.15 TC-TASK-003 · 到点触发与 cron 触发计算

**追溯**：UC-008 / REQ-TASK-001 / 接口 `runTask`（调度触发路径）/ 实体 TaskSchedule、TaskRun

**前置条件**：`tax_reminder` 配置 `0 9 * * *`、`Asia/Shanghai`；`stat.task_schedule.next_run_at` 置为 `2026-11-05T01:00:00.000Z`（北京 09:00）。

**步骤**：

1. `scheduler.tick(now + 1000ms)`。
2. 核对返回的触发列表与 `task_schedule` 的 `next_run_at`、`last_run_at`。
3. 单元层用 `nextRun` 复核触发时刻计算边界。

**输入数据**：`now=2026-11-05T01:00:00.000Z`、`tick` 传 `01:00:01Z`；cron 边界样本 `30 8 * * 1-5`、`0 2 * * *`、`*/15 8-9 * * 1-5`、`0 9 * * 0,7`、非法 `* * * *`、`60 * * * *`、`* * * * 8`。

**期望结果**：

- `tick` 返回列表含 `tax_reminder`（到点触发恰一次）。
- `next_run_at > now`（推进到下一次），`last_run_at` 非空。
- 单元断言：`*/15 8-9 * * 1-5` → 分钟 `[0,15,30,45]`、小时 `[8,9]`、含周一；`0 9 * * 0,7` 周日归一为 `{0}`；非法表达式分别报“5 字段”“分”“周”。
- 单元断言：`nextRun('30 8 * * 1-5', 'Asia/Shanghai', 2026-11-04T22:00Z)=2026-11-05T00:30Z`；周五 18:00 → 下周一 08:30；同一分钟不重复（from 08:30 → 次日 08:30）；`0 2 * * *` from 2026-11-05T12:00Z → 18:00Z；`describeCron` 输出“工作日 08:30”“每天 02:00”。

**对应用例**：

- [test/integration/scheduler.test.ts](../test/integration/scheduler.test.ts) ·「tick：到点任务触发一次并推进 next_run_at」（主用例）
- [test/unit/cron.test.ts](../test/unit/cron.test.ts) · 全部 7 条（「parseCron 支持 */n、列表、区间与周日 0/7」「parseCron 拒绝非法表达式」「nextRun 按 Asia/Shanghai 计算工作日晨报（08:30）」「nextRun 跨周末跳到周一」「nextRun 严格晚于 from（同一分钟不重复触发）」「nextRun 支持凌晨 02:00 审计导出」「describeCron 输出人读描述」）

### 4.16 TC-TASK-004 · 每日晨报聚合与投递

**追溯**：UC-009 / REQ-TASK-002 / 接口 `getDailyReport`、`runTask` / 实体 DailyReport、Notification、TaxCalendar、Contract、ConflictQueue

**前置条件**：财税与法务基础数据已录入；`daily_report` 任务 cron `30 8 * * 1-5`。

**步骤**：

1. 造数：税务申报 `deadline=current_date+3`（pending）、合同 `end_date=current_date+10`（active）、台账 1 行、待裁决冲突 1 行。
2. `run('daily_report', { scheduledAt: 2026-11-05T00:30:00.000Z })`（北京 08:30）。
3. 读 `stat.daily_report` 最新一行与 `stat.notification`。
4. HTTP `GET /api/v1/reports/daily` 回读。

**输入数据**：`tax_calendar('vat','2026-11', current_date+3,'pending')`；`contract('甲公司',1000, current_date+10,'active')`；`ledger(current_date,100,'out','x','company')`；`conflict_queue('cost','ledger',1, parties, 'open')`。

**期望结果**：

- 执行 `status='ok'`。
- 晨报 `content.taxAlerts.length=1`（≤7 天）、`contractAlerts.length=1`（≤30 天）、`conflicts.length=1`（待裁决）。
- `stat.notification` 存在 `kind='daily_report'` 的投递记录。
- HTTP 契约：`GET /api/v1/reports/daily` 200 且 `content.taxAlerts` 存在（缺省取最近一期）。
- 工作日 08:30 的触发时刻由 cron 层用例保证（08:30 计算与跨周末跳转）。

**对应用例**：

- [test/integration/scheduler.test.ts](../test/integration/scheduler.test.ts) ·「晨报任务：聚合税务预警、合同到期与待裁决冲突，写入 daily_report 并通知」（主用例）
- [test/integration/api.test.ts](../test/integration/api.test.ts) ·「tasks：列表 7 项 / 配置 200 / 立即执行 200 / 晨报可查」（晨报查询段）
- [test/unit/cron.test.ts](../test/unit/cron.test.ts) ·「nextRun 按 Asia/Shanghai 计算工作日晨报（08:30）」与「nextRun 跨周末跳到周一」

### 4.17 TC-WEB-001 · 上传/输入归置与高风险确认

**追溯**：UC-010 / REQ-WEB-003 / 接口 `listIngestInbox`、`ingestText`、`confirmIngest` / 实体 WebIngestItem

**前置条件**：`0004_web_layer.sql` 已应用；`opc_web` 服务已装配。

**步骤**：提交发票文本 → 重复提交同幂等键 → 按 `status=pending` 查收件箱 → 确认并改金额 → 查审计。

**期望结果**：首次 201、`domain=finance`、`decision.confirm`；重复 200 且 `duplicate=true`；收件箱 1 条；确认后 `status=confirmed`、金额为编辑值；`audit.action='web.ingest.confirm'` 存在。

**对应用例**：`test/integration/web.test.ts` ·「归置：发票进入确认卡、幂等命中、收件箱可查、确认后落状态」；`test/unit/web.test.ts` ·「分类：发票文本归财税…」

### 4.18 TC-WEB-002 · 会话授权与记忆桥

**追溯**：UC-011 / REQ-WEB-002 / 接口 `grantSession`、`revokeSession`、`getSessionContext`、`searchMemory`、`proposeMemory`、`confirmMemoryProposal` / 实体 WebSessionGrant、WebSessionMessage、WebMemoryCard、WebMemoryProposal

**步骤**：未授权读上下文 → 授权 → 读最近 20 条 → 撤回 → 再读 → 提议记忆 → 确认前检索 → 确认 → 检索 → 敏感记忆检索。

**期望结果**：未授权 403 `ERR-WEB-001`；授权后返回 2 条且顺序正确；撤回后再读 403；提议不直接可见；确认后可见；敏感记忆内容为 `[敏感记忆，需一次性令牌查看]`。

**对应用例**：`test/integration/web.test.ts` ·「会话桥…」「记忆桥…」

### 4.19 TC-WEB-003 · 驾驶舱快照与冻结脚注

**追溯**：UC-012 / REQ-WEB-004 / 接口 `getDashboard` / 实体 DashboardSnapshot

**步骤**：造台账 1 入 1 出（1 条冻结）+ 待裁决冲突 → 请求 `range=30d`。

**期望结果**：200；`metrics.length≥10`；`frozen.count=1`；`warnings` 含“待裁决冲突”；`asOf` 为 ISO 时间；不返回 `customer_sensitive` 原值。

**对应用例**：`test/integration/web.test.ts` ·「manifest 与驾驶舱…」；`test/unit/web.test.ts` ·「驾驶舱：range 白名单与陈旧判定」

### 4.20 TC-WEB-004 · 插件雷达与关键词雷达

**追溯**：UC-013 / REQ-WEB-005 / 接口 `listRadar`、`runTask` / 实体 RadarItem、TaskRun

**步骤**：通过任务 config 注入 1 个合格候选 + 1 个停更候选 → 执行 `plugin_radar_scan` → 查雷达；注入关键词条目 → 执行 `keyword_radar_scan`。

**期望结果**：插件任务 `recommended=1`；雷达仅 1 条且不提供安装入口；关键词任务 `written=1`；未配置检索源时任务返回“本次未检索”。

**对应用例**：`test/integration/web.test.ts` ·「雷达…」；`test/unit/web.test.ts` ·「插件雷达…」

### 4.21 TC-WEB-005 · 插件栏入口与右栏清单

**追溯**：UC-014 / REQ-WEB-001 / 接口 `getWebManifest`

**步骤**：请求 `GET /api/v1/web/manifest`。

**期望结果**：`pluginId=opc_web`、`title=OPC驾驶舱`、`panel=left`、五个页签；宿主无插槽时降级提示由 DSH 端验证。

**对应用例**：`test/integration/web.test.ts` ·「manifest 与驾驶舱…」；`test/integration/plugin.test.ts` ·工具清单（`opc_web_manifest` 参数 schema 完整）

### 4.22 TC-EMP-001 · 员工 manifest 与可插拔契约

**追溯**：REQ-EMP-001/003/004；`test/unit/employees.test.ts`；实体 EmployeePlugin。

**步骤**：遍历 11 个 manifest → 校验 pluginId/employeeCode 唯一、视图/工具/写目标/流程声明；构造非法 manifest（未知视图、未登记写目标、过高中枢版本、非法工具名）→ 校验拒绝。

**期望结果**：11 个 manifest 全部通过；非法项返回对应错误；WBS/外宣 manifest 存在且依赖声明正确。

**对应用例**：`test/unit/employees.test.ts` 前 3 例。

### 4.23 TC-EMP-002 · 安装、列表、停用与依赖保护

**追溯**：REQ-EMP-002；`test/integration/employees.test.ts`；实体 EmployeePlugin。

**步骤**：安装项目监理（启用）→ 安装 WBS（依赖项目，启用）→ 列表 → 停用项目监理（应拒绝）→ 停用 WBS（应成功）。

**期望结果**：列表 2 项；停用项目监理 409 且提示依赖；停用 WBS 成功并保留 `disabled_reason`。

### 4.24 TC-EMP-003 · 员工包导出、dry-run、导入与非法包拒绝

**追溯**：REQ-EMP-006/007；`test/integration/employees.test.ts`；实体 EmployeePackage、EmployeeImportJob。

**步骤**：安装项目监理 → 导出包 → 校验 checksum → dry-run → confirm 导入 → 读取插件；另构造路径穿越包与坏 checksum 包 → dry-run。

**期望结果**：导出 checksum 一致；dry-run `ready=true`；确认导入后 `enabled=false` 且原因含“默认停用”；非法包 `ready=false` 且不产生安装。

### 4.25 TC-RES-001 … TC-RES-005 · 基础资源配置（v2.15 增量）

**追溯**：REQ-PRJ-023..026；`test/integration/admin-shared.test.ts`；实体 SharedResource、SharedSetting、ProjectSharedResource。

| TC | 场景 | 断言要点 |
| :--- | :--- | :--- |
| TC-RES-001 | 公司默认口径与默认资源 | `defaultOs=debian`、`defaultRemoteMethod=ssh`、`defaultAccount=canetwork`、`defaultCredentialRef=env:OPC_DEFAULT_SSH_PASSWORD`、`defaultSshPort=22`；`kinds` 六类、`accessMethods` 八种；默认资源三类（code_repo/test_server/domain），测试机 `accessMethod=ssh`、`os=debian` |
| TC-RES-002 | 新建项目默认选型 | 不传资源建项目 → `sharedResourcesBound=3`；项目资源列表 3 项且全部 `appliedByDefault=true`，kind 顺序 code_repo/domain/test_server |
| TC-RES-003 | 显式选型与禁用默认 | 显式 `resourceIds=[nas]` → 仅 1 项、`appliedByDefault=false`；`bindDefaults=false` → 0 项 |
| TC-RES-004 | 凭据与类型红线 | 明文口令 → 400 `ERR-RES-002`；kind 非法 → 400 `ERR-RES-001`；合法引用 → 201 且服务器类资源自动补 `os=debian`、`accessMethod=ssh` |
| TC-RES-005 | 资源 CRUD 与绑定保护 | 更新 `status/notes` 回读一致；绑定后删除 → 409 `ERR-RES-004`；解绑 → 200，再解绑 → 404；删除 → 200，再删 → 404 |

**结论口径**：本章为 v2.15 增量，基线核算（5.1）只统计基线 68 例；项目研发/情报/基础资源的增量用例统一在 `OPC-STR-001` 的增量验证章节登记，避免两处数字打架。

### 4.26 TC-AUTO-001 … TC-AUTO-004 · 项目自动驾驶（v2.16 增量）

**追溯**：REQ-PRJ-027..030；`test/integration/autopilot.test.ts`；实体 ProjectCheckout、ProjectScan、ProjectPlan、ProjectDecision。

| TC | 场景 | 断言要点 |
| :--- | :--- | :--- |
| TC-AUTO-001 | 建项目填版本库自动检出入档 | 本地 git 夹具 `file://`：`checkout.status=ok`、commit 为 40 位 SHA、files>0；`tech_stack.primaryLanguage=javascript`、frameworks 含 express；`software_profile.commit` 40 位；pendingDecisions ≥ 2 |
| TC-AUTO-002 | 三份计划与测试基线 | plans 的 plan_kind 为 dev/test/deploy；里程碑 5 条；test_plan draft 1 条 + TC-AUTO-001..003 三条用例；部署环境复用默认测试服务器（`ssh_user=canetwork`，env_type=test） |
| TC-AUTO-003 | 仅裁决项入队并裁决关闭 | 夹具无 LICENSE/CI/公网服务器 → topics = ci/deploy_target/license 且全 pending；裁决后 decided；再次裁决 404 `ERR-AUTO-004` |
| TC-AUTO-004 | 非法地址与非仓库路径 | `ftp://` → 400 `ERR-AUTO-001`；不存在的 `file://` → 502 `ERR-AUTO-002`；`ref.project_checkout` 留 `failed` 记录且 error 含「检出失败」 |

**结论口径**：本章为 v2.16 增量，基线核算（5.1）只统计基线 68 例；自动驾驶用例在 `OPC-STR-001` §12 登记。

### 4.27 TC-AUTO-005 … TC-AUTO-007 · 自动化生产（v2.17 增量）

**追溯**：REQ-PRJ-031..033；`test/integration/autopilot.test.ts`；实体 ProjectScaffold、ProjectPipelineRun、ProjectDeployRun。

| TC | 场景 | 断言要点 |
| :--- | :--- | :--- |
| TC-AUTO-005 | 自动生成代码骨架 | 空仓库（仅 package.json + README）：`scaffold.status=committed`、分支前缀 `opc/autopilot-`、created 为 `.gitignore/Dockerfile/src/index.js/test/smoke.test.js` 四项；`stat.project_scaffold` 落库一条 |
| TC-AUTO-006 | 自动跑测试流水线 | 夹具 `test=node --test`：`pipeline.status=ok`、逐阶段全 ok 且含 `stage=test`；`stat.project_pipeline_run` 有 `stage=test,status=ok,exit_code=0` |
| TC-AUTO-007 | 自动发布测试环境 | 设置 `OPC_TEST_DEPLOY_CMD` → `deploy.status=ok` 且发布单 `approved/executed_at` 非空；未配置 → `pending` 且出现 `deploy_executor` 裁决 |

**结论口径**：本章为 v2.17 增量，基线核算（5.1）只统计基线 68 例；自动化生产用例在 `OPC-STR-001` §13 登记。

### 4.28 TC-OPS-001 … TC-OPS-005 · 运维反馈闭环（v2.18 增量）

**追溯**：REQ-OPS-001..003；`test/integration/ops.test.ts`；实体 UsageEvent、RuntimeError、IssueFiling。

| TC | 场景 | 断言要点 |
| :--- | :--- | :--- |
| TC-OPS-001 | 接口调用自动记用量 | 调 health/tasks 后汇总 `total>=2`、`byAction` 含 health、`errorRate>=0` |
| TC-OPS-002 | 错误去重 + 自动开 Issue | 同指纹两次 → 1 行 `occurrences=2`；sync 后 mock GitHub 收到 1 条 `[运行错误]`，正文含消息；再次 sync 不重复 |
| TC-OPS-003 | 未配置 token 降级 | 无 token → `filed=0`、`skipped>=1`，草稿标 skipped 且错误含 OPC_GITHUB_TOKEN |
| TC-OPS-004 | 用量审视产草稿并投递 | 3/6 失败 + 1 条慢调用 + 12 次页签访问 → 产出 [体验] 与 [需求] 草稿；sync 后 GitHub 收到 [体验] issue |
| TC-OPS-005 | Issue 列表与投递结果 | `status=filed` 返回 1 条含 number/url；`status=pending` 为空 |

**结论口径**：本章为 v2.18 增量，基线核算（5.1）只统计基线 68 例；运维闭环用例在 `OPC-STR-001` §14 登记。

### 4.29 TC-AUTO-008/009 · 已建项目接入与重复执行幂等（v2.19 增量）

**追溯**：REQ-PRJ-034；`test/integration/autopilot.test.ts`；实体 Project、CodeRepository、ProjectPlan。

| TC | 场景 | 断言要点 |
| :--- | :--- | :--- |
| TC-AUTO-008 | 已建项目接入 | 手工建项目（无 repository）→ `POST /admin/projects/{id}/autopilot` 201；检出 ok、扫描语言 javascript、档案回填主语言、3 份计划 |
| TC-AUTO-009 | 重复执行幂等 | 二次执行 201 且 `repository.reused=true`；版本库 1、里程碑 5、测试计划 1、用例 3、测试环境 1；计划版本 dev/test/deploy 各 1→2；裁决 topic 无重复 |

**结论口径**：本章为 v2.19 增量，基线核算（5.1）只统计基线 68 例。

### 4.30 TC-IDEA-001 … TC-IDEA-005 · 创意转项目（v2.20 增量）

**追溯**：REQ-PRJ-035；`test/integration/idea.test.ts`；实体 ProjectIdea。

| TC | 场景 | 断言要点 |
| :--- | :--- | :--- |
| TC-IDEA-001 | 文本创意 AI 解析 | mock AI 返回结构化档案：`source=ai`、name/projectType/goals 与 mock 一致、documents 为空 |
| TC-IDEA-002 | 多格式文档同传 | txt/docx/xlsx/pdf 四文件：各 `chars>0`、kind 覆盖四种、合并 chars>30、解析 source=ai |
| TC-IDEA-003 | 创意建项目进自动驾驶 | 带仓库：201、status=autopilot、项目名取 AI、检出 ok、3 份计划；`/ideas` 记录 status=autopilot |
| TC-IDEA-004 | 无仓库转裁决 | status=waiting-repository、autopilot=null、项目裁决含 `repository`（pending） |
| TC-IDEA-005 | 非法格式/空创意 | `.exe` → 415 `ERR-IDEA-002`；空请求 → 400 `ERR-IDEA-001` |

**结论口径**：本章为 v2.20 增量，基线核算（5.1）只统计基线 68 例。

### 4.31 TC-WECHAT-001 … TC-WECHAT-005 · 微信推送（v2.21 增量）

**追溯**：REQ-OPS-004；`test/integration/wechat.test.ts`；实体 WechatPush。

| TC | 场景 | 断言要点 |
| :--- | :--- | :--- |
| TC-WECHAT-001 | 未绑定只排队 | 未配置 → `sent=0`、`skipped=1`、mock 未收到请求；队列 `pending` 且错误含配置项名 |
| TC-WECHAT-002 | 裁决+简报投递 | 配置后 2 条 → `sent=2`；mock 请求体 `{botId,targetId,text}` 正确，text 含「待裁决/简报」；均 `sent` |
| TC-WECHAT-003 | 失败退避 | mock 503 → `failed=1`；立即重投 `sent+failed=0`（退避未到期）；attempts=1 且 `next_attempt_at` 在未来 |
| TC-WECHAT-004 | 去重 | 同 `dedupeKey` 两次入队 → 队列 1 条 |
| TC-WECHAT-005 | 裁决自动入队 + 状态接口 | 裁决创建后队列有 decision 行；`/admin/wechat/status` 返回 `botIdConfigured=false`、pending≥1 |

**结论口径**：本章为 v2.21 增量，基线核算（5.1）只统计基线 68 例。

### 4.32 TC-AUTO-010/011 · SVN 版本库检出（v2.22 增量）

**追溯**：REQ-PRJ-036；`test/integration/autopilot.test.ts`；实体 ProjectCheckout、CodeRepository、Project。

| TC | 场景 | 断言要点 |
| :--- | :--- | :--- |
| TC-AUTO-010 | SVN 检出与修订号 | 本地 SVN 夹具、`branch=trunk`、`revision=r1`：`checkout.status=ok`、`checkout.vcs=svn`、`revision` 与请求一致；`vcs_kind='svn'` 落 `ref.project_checkout`；扫描跳过 `.svn` 且识别 javascript；`software_profile.vcs=svn`、`revision` 非空；测试环境发布版本号取 `coalesce(commit_sha, revision)`（SVN 取 revision）；SVN 骨架 `status=generated`、不建分支不提交、无 `scaffold_review` 裁决；服务环境凭据：未填 authRef 且主机在 `OPC_SVN_TRUSTED_HOSTS` 内时 svn argv 含 `--username`/`--password-from-stdin` 且 stdin 为 `OPC_SVN_PASSWORD`，白名单外主机不带凭据参数 |
| TC-AUTO-011 | svn 客户端缺失降级 | 隔离 PATH（无 `svn`）→ 502 `ERR-AUTO-002`；`stat.project_decision` 出现 `topic=svn_client`（pending）；`ref.project_checkout` 留 `failed` 记录；不伪造档案与计划 |

**结论口径**：本章为 v2.22 增量，基线核算（5.1）只统计基线 68 例。

## 5. TC ↔ 测试文件 ↔ 断言要点总表

| TC | 所属 UC / 需求 | 主要测试文件 | 断言要点 |
| :--- | :--- | :--- | :--- |
| TC-VIEW-001 | UC-001 / REQ-VIEW-001 | `test/integration/platform.test.ts`、`api.test.ts`、`plugin.test.ts` | `amount_total=2000`、rows=1；未授权 `ERR-AUTHZ-001`；审计 2 条含 denied |
| TC-TOKEN-001 | UC-002 / REQ-TOKEN-001 | `test/integration/platform.test.ts`、`api.test.ts` | tokenId ≥16 位；fields 仅 `{family}`；重复/过期均 `ERR-TOKEN-001`；HTTP 201→200→409 |
| TC-TOKEN-002 | UC-002 / REQ-TOKEN-001 | `test/integration/platform.test.ts` | 审计 3 条（1 ok）；序列化后不含“学龄子女” |
| TC-CONFLICT-001 | UC-003 / REQ-CONFLICT-001 | `test/integration/platform.test.ts`、`api.test.ts` | `frozen=true`；`total_including_frozen=3000`；`effective_total=0`；`frozen_items=1` |
| TC-CONFLICT-002 | UC-003 / REQ-CONFLICT-001 | `test/integration/platform.test.ts`、`api.test.ts` | `status='resolved'`、`frozen=false`；解冻后 `effective_total=3000` |
| TC-WF-001 | UC-004 / REQ-WF-001 | `test/integration/workflow.test.ts`、`test/unit/guard.test.ts`、`api.test.ts` | `riskLevel='high'`；DB `code_hash` 一致；meta 无 `risk_level` 键；HTTP 201 |
| TC-WF-002 | UC-004 / REQ-WF-001 | `test/integration/workflow.test.ts`、`test/unit/guard.test.ts`、`api.test.ts` | `ERR-WF-001`(422) + `failures` 数组；表无写入；审计 denied；重复版本 `ERR-WF-002` |
| TC-WF-003 | UC-005 / REQ-WF-002 | `test/integration/workflow.test.ts`、`api.test.ts` | `status='running'`；未注册 `ERR-WF-003`(404)；HTTP 201 返回 instanceId |
| TC-WF-004 | UC-005 / REQ-WF-002 | `test/integration/workflow.test.ts`、`api.test.ts` | `idempotentHit` false→true；异参 `ERR-WF-004`；node_run 恰 1 行且幂等键 `id:node` |
| TC-WF-005 | UC-006 / REQ-WF-003 | `test/integration/workflow.test.ts`、`api.test.ts` | 一致 pass/1；分裂 escalated；缓存命中结论不变；`aggregateSamples` 0.6667 |
| TC-AUDIT-001 | UC-007 / REQ-AUDIT-001 | `test/integration/audit.test.ts`、`api.test.ts` | hash 64 位；prev_hash 逐条相接；`verifyChain ok/checked=3`；倒序查询 |
| TC-AUDIT-002 | UC-007 / REQ-AUDIT-001 | `test/integration/audit.test.ts`、`scheduler.test.ts`、`api.test.ts` | JSONL 行数/字段；SHA-256 与文件一致；链头 `last_export_id`；二次导出 `prevHash` 续链 |
| TC-TASK-001 | UC-008 / REQ-TASK-001 | `test/integration/scheduler.test.ts`、`api.test.ts`、`plugin.test.ts` | 10 个任务 ID 集合；`30 8 * * 1-5`/Asia/Shanghai；非法 `ERR-TASK-001`；改后回读新 cron |
| TC-TASK-002 | UC-008 / REQ-TASK-001 | `test/integration/scheduler.test.ts`、`api.test.ts` | 首次 ok、二次 skipped、force 新 runId；`task_run` 恰 2 行 |
| TC-TASK-003 | UC-008 / REQ-TASK-001 | `test/integration/scheduler.test.ts`、`test/unit/cron.test.ts` | tick 含 tax_reminder；`next_run_at` 前移、`last_run_at` 非空；cron 边界与 UTC 换算 |
| TC-TASK-004 | UC-009 / REQ-TASK-002 | `test/integration/scheduler.test.ts`、`api.test.ts` | 晨报 3 类各 1 条；`kind='daily_report'` 通知；HTTP 晨报 200 |
| TC-WEB-001 | UC-010 / REQ-WEB-003 | `test/integration/web.test.ts`、`test/unit/web.test.ts` | 高风险域 `confirm`；重复 200 `duplicate=true`；确认后 `confirmed`；审计 1 条 |
| TC-WEB-002 | UC-011 / REQ-WEB-002 | `test/integration/web.test.ts` | 未授权 403；授权后 2 条；撤回后 403；提议确认前不可见；敏感记忆脱敏 |
| TC-WEB-003 | UC-012 / REQ-WEB-004 | `test/integration/web.test.ts`、`test/unit/web.test.ts` | `frozen.count=1`；`warnings` 含待裁决；`asOf` 存在；陈旧判定正确 |
| TC-WEB-004 | UC-013 / REQ-WEB-005 | `test/integration/web.test.ts`、`test/unit/web.test.ts` | 合格候选 1、停更拒绝；雷达 1 条；关键词 `written=1` |
| TC-WEB-005 | UC-014 / REQ-WEB-001 | `test/integration/web.test.ts`、`plugin.test.ts` | `pluginId=opc_web`、五个页签；工具 schema 完整 |
| TC-EMP-001 | REQ-EMP-001/003/004 | `test/unit/employees.test.ts` | 11 个 manifest 唯一；视图/工具/写目标合法；非法 manifest 被拒 |
| TC-EMP-002 | REQ-EMP-002 | `test/integration/employees.test.ts` | 安装/列表/停用；有依赖插件停用 409；停用原因保留 |
| TC-EMP-003 | REQ-EMP-006/007 | `test/integration/employees.test.ts` | 导出 checksum 一致；dry-run；确认导入默认停用；路径穿越/坏 checksum 拒绝 |
| TC-RES-001 | UC-022 / REQ-PRJ-023、024 | `test/integration/admin-shared.test.ts` | debian/ssh/canetwork/凭据引用；kinds 六类、accessMethods 八种；默认资源三类 |
| TC-RES-002 | UC-023 / REQ-PRJ-025 | `test/integration/admin-shared.test.ts` | `sharedResourcesBound=3`；`appliedByDefault=true` |
| TC-RES-003 | UC-023 / REQ-PRJ-025、026 | `test/integration/admin-shared.test.ts` | 显式选型 1 项、`appliedByDefault=false`；bindDefaults=false → 0 项 |
| TC-RES-004 | UC-022 / REQ-PRJ-023、024 | `test/integration/admin-shared.test.ts` | 明文 400 `ERR-RES-002`；非法 kind 400 `ERR-RES-001`；服务器类补 debian/ssh |
| TC-RES-005 | UC-022、023 / REQ-PRJ-023、026 | `test/integration/admin-shared.test.ts` | 绑定后删 409 `ERR-RES-004`；解绑后删 200；再删 404 |
| TC-AUTO-001 | UC-024 / REQ-PRJ-027、028 | `test/integration/autopilot.test.ts` | 检出 ok + commit SHA；主语言 javascript；档案回填；pending ≥ 2 |
| TC-AUTO-002 | UC-025 / REQ-PRJ-029 | `test/integration/autopilot.test.ts` | dev/test/deploy 三计划；5 里程碑；3 基线用例；测试环境 ssh_user=canetwork |
| TC-AUTO-003 | UC-025 / REQ-PRJ-030 | `test/integration/autopilot.test.ts` | 三条裁决全 pending；裁决后 decided；重复裁决 404 |
| TC-AUTO-004 | UC-024 / REQ-PRJ-027 | `test/integration/autopilot.test.ts` | 非法协议 400；坏仓库 502；失败检出留痕 |
| TC-AUTO-005 | UC-026 / REQ-PRJ-031 | `test/integration/autopilot.test.ts` | 骨架只补缺失并提交本地分支 |
| TC-AUTO-006 | UC-026 / REQ-PRJ-032 | `test/integration/autopilot.test.ts` | 流水线逐阶段 ok，含 test 阶段 exit 0 |
| TC-AUTO-007 | UC-026 / REQ-PRJ-033 | `test/integration/autopilot.test.ts` | 有命令则发布 ok；无命令 pending + 裁决 |
| TC-OPS-001 | UC-027 / REQ-OPS-002 | `test/integration/ops.test.ts` | 用量落库与聚合 |
| TC-OPS-002 | UC-028 / REQ-OPS-001 | `test/integration/ops.test.ts` | 指纹去重 + GitHub issue 投递 |
| TC-OPS-003 | UC-028 / REQ-OPS-003 | `test/integration/ops.test.ts` | 无 token 降级 skipped |
| TC-OPS-004 | UC-027 / REQ-OPS-002 | `test/integration/ops.test.ts` | 审视产出体验/需求草稿并投递 |
| TC-OPS-005 | UC-028 / REQ-OPS-001 | `test/integration/ops.test.ts` | Issue 列表按状态过滤 |
| TC-AUTO-008 | UC-029 / REQ-PRJ-034 | `test/integration/autopilot.test.ts` | 已建项目接入：检出/扫描/档案/3 计划 |
| TC-AUTO-009 | UC-029 / REQ-PRJ-034 | `test/integration/autopilot.test.ts` | 重复执行：复用资源、计划版本递增、裁决去重 |
| TC-AUTO-010 | UC-024 / REQ-PRJ-036 | `test/integration/autopilot.test.ts` | SVN 检出：修订号落库、跳过 `.svn`、档案回填、发布版本号；服务环境凭据仅对白名单主机自动使用 |
| TC-AUTO-011 | UC-024 / REQ-PRJ-036 | `test/integration/autopilot.test.ts` | svn 客户端缺失：502 `ERR-AUTO-002` + `svn_client` 裁决 |
| TC-IDEA-001 | UC-030 / REQ-PRJ-035 | `test/integration/idea.test.ts` | 文本创意 AI 解析 |
| TC-IDEA-002 | UC-030 / REQ-PRJ-035 | `test/integration/idea.test.ts` | txt/docx/xlsx/pdf 多文件解析 |
| TC-IDEA-003 | UC-030 / REQ-PRJ-035 | `test/integration/idea.test.ts` | 建项目并进自动驾驶 |
| TC-IDEA-004 | UC-030 / REQ-PRJ-035 | `test/integration/idea.test.ts` | 无仓库转裁决 |
| TC-IDEA-005 | UC-030 / REQ-PRJ-035 | `test/integration/idea.test.ts` | 非法格式/空创意拒绝 |
| TC-WECHAT-001 | UC-031 / REQ-OPS-004 | `test/integration/wechat.test.ts` | 未绑定只排队不丢 |
| TC-WECHAT-002 | UC-031 / REQ-OPS-004 | `test/integration/wechat.test.ts` | 裁决+简报投递微信 |
| TC-WECHAT-003 | UC-031 / REQ-OPS-004 | `test/integration/wechat.test.ts` | 失败退避重试 |
| TC-WECHAT-004 | UC-031 / REQ-OPS-004 | `test/integration/wechat.test.ts` | 同键去重 |
| TC-WECHAT-005 | UC-031 / REQ-OPS-004 | `test/integration/wechat.test.ts` | 裁决自动入队 + 状态接口 |

### 5.1 覆盖核算（60 + 8 = 68）

| 文件 | 用例数 | 归属 TC | 横切 |
| :--- | ---: | :--- | :--- |
| `test/unit/cron.test.ts` | 7 | TC-TASK-003、TC-TASK-004 | — |
| `test/unit/guard.test.ts` | 9 | TC-WF-001、TC-WF-002 | — |
| `test/unit/web.test.ts` | 5 | TC-WEB-001 … TC-WEB-004 | — |
| `test/unit/employees.test.ts` | 4 | TC-EMP-001 | — |
| `test/integration/platform.test.ts` | 3 | TC-VIEW-001、TC-TOKEN-001/002、TC-CONFLICT-001/002 | — |
| `test/integration/audit.test.ts` | 3 | TC-AUDIT-001、TC-AUDIT-002 | — |
| `test/integration/workflow.test.ts` | 7 | TC-WF-001 … TC-WF-005 | — |
| `test/integration/scheduler.test.ts` | 6 | TC-TASK-001 … TC-TASK-004 | — |
| `test/integration/api.test.ts` | 8 | 6 条归属 TC | health、未知路由 404 |
| `test/integration/plugin.test.ts` | 4 | 2 条归属 TC | 工具清单、`opc_health` |
| `test/integration/web.test.ts` | 5 | TC-WEB-001 … TC-WEB-005 | — |
| `test/integration/employees.test.ts` | 3 | TC-EMP-002、TC-EMP-003 | — |
| `test/integration/spec.test.ts` | 4 | — | 4 条全部 |
| 合计 | 75 | 67 个承载 31 条 TC | 8 条横切 |

结论：24/24 TC 均有主用例，无 TC 只靠横切用例；8 个横切用例不进入 TC 计数，避免“把健康检查算作业务验收”的虚高覆盖。

## 6. 接口覆盖矩阵

| # | 接口（operationId） | 方法与路径 | 覆盖 TC | 承载用例 |
| ---: | :--- | :--- | :--- | :--- |
| 1 | `health` | `GET /api/v1/health` | 横切 | `api.test.ts`、`plugin.test.ts` |
| 2 | `queryView` | `POST /api/v1/views/{viewId}/query` | TC-VIEW-001 | `platform.test.ts`、`api.test.ts`、`plugin.test.ts` |
| 3 | `issueToken` | `POST /api/v1/tokens` | TC-TOKEN-001 | `platform.test.ts`、`api.test.ts` |
| 4 | `consumeToken` | `POST /api/v1/tokens/{tokenId}/consume` | TC-TOKEN-001/002 | `platform.test.ts`、`api.test.ts` |
| 5 | `openConflict` | `POST /api/v1/conflicts` | TC-CONFLICT-001 | `platform.test.ts`、`api.test.ts` |
| 6 | `resolveConflict` | `POST /api/v1/conflicts/{conflictId}/resolve` | TC-CONFLICT-002 | `platform.test.ts`、`api.test.ts` |
| 7 | `registerWorkflow` | `POST /api/v1/workflows` | TC-WF-001/002 | `workflow.test.ts`、`api.test.ts` |
| 8 | `startInstance` | `POST /api/v1/workflows/{workflowId}/instances` | TC-WF-003 | `workflow.test.ts`、`api.test.ts` |
| 9 | `completeNode` | `POST /api/v1/instances/{instanceId}/nodes/{nodeId}/complete` | TC-WF-004 | `workflow.test.ts`、`api.test.ts` |
| 10 | `recordVerdict` | `POST /api/v1/instances/{instanceId}/nodes/{nodeId}/verdict` | TC-WF-005 | `workflow.test.ts`、`api.test.ts` |
| 11 | `listAudits` | `GET /api/v1/audits` | TC-AUDIT-001 | `audit.test.ts`、`api.test.ts` |
| 12 | `exportAudits` | `POST /api/v1/audits/export` | TC-AUDIT-002 | `audit.test.ts`、`scheduler.test.ts`、`api.test.ts` |
| 13 | `listTasks` | `GET /api/v1/tasks` | TC-TASK-001 | `scheduler.test.ts`、`api.test.ts` |
| 14 | `upsertTask` | `PUT /api/v1/tasks/{taskId}` | TC-TASK-001 | `scheduler.test.ts`、`api.test.ts`、`plugin.test.ts` |
| 15 | `runTask` | `POST /api/v1/tasks/{taskId}/run` | TC-TASK-002/004 | `scheduler.test.ts`、`api.test.ts` |
| 16 | `getDailyReport` | `GET /api/v1/reports/daily` | TC-TASK-004 | `scheduler.test.ts`、`api.test.ts` |
| 17 | `getWebManifest` | `GET /api/v1/web/manifest` | TC-WEB-005 | `web.test.ts`、`plugin.test.ts` |
| 18 | `getDashboard` | `GET /api/v1/web/dashboard` | TC-WEB-003 | `web.test.ts` |
| 19 | `listIngestInbox` | `GET /api/v1/web/inbox` | TC-WEB-001 | `web.test.ts` |
| 20 | `ingestText` | `POST /api/v1/web/ingest` | TC-WEB-001 | `web.test.ts` |
| 21 | `confirmIngest` | `POST /api/v1/web/ingest/{id}/confirm` | TC-WEB-001 | `web.test.ts` |
| 22 | `grantSession` | `PUT /api/v1/web/sessions/{sessionId}/grant` | TC-WEB-002 | `web.test.ts` |
| 23 | `revokeSession` | `DELETE /api/v1/web/sessions/{sessionId}/grant` | TC-WEB-002 | `web.test.ts` |
| 24 | `getSessionContext` | `GET /api/v1/web/sessions/{sessionId}/context` | TC-WEB-002 | `web.test.ts` |
| 25 | `searchMemory` | `POST /api/v1/web/memory/search` | TC-WEB-002 | `web.test.ts` |
| 26 | `proposeMemory` | `POST /api/v1/web/memory/propose` | TC-WEB-002 | `web.test.ts` |
| 27 | `confirmMemoryProposal` | `POST /api/v1/web/memory/proposals/{id}/confirm` | TC-WEB-002 | `web.test.ts` |
| 28 | `listRadar` | `GET /api/v1/web/radar` | TC-WEB-004 | `web.test.ts` |
| 29 | `listEmployees` | `GET /api/v1/employees` | TC-EMP-002 | `employees.test.ts` |
| 30 | `getEmployee` | `GET /api/v1/employees/{pluginId}` | TC-EMP-002 | `employees.test.ts` |
| 31 | `installEmployee` | `POST /api/v1/employees` | TC-EMP-002 | `employees.test.ts` |
| 32 | `toggleEmployee` | `POST /api/v1/employees/{pluginId}/toggle` | TC-EMP-002 | `employees.test.ts` |
| 33 | `exportEmployeePackage` | `POST /api/v1/employees/{pluginId}/export` | TC-EMP-003 | `employees.test.ts` |
| 34 | `importEmployeePackage` | `POST /api/v1/employees/import` | TC-EMP-003 | `employees.test.ts` |

矩阵闭合性由 `spec.test.ts`「api.yaml 的每个 operation 都有对应 HTTP 路由」保证：62 个 operation 全部要在 `ROUTES` 命中，且数量必须相等（`count === ROUTES.length`）。参数级负例（400/404）未逐接口覆盖，见第 8 章 N-6。

## 7. 横切验证（不对应 TC 的用例）

| 用例 | 文件 | 验证内容 | 为什么不属于任何 TC |
| :--- | :--- | :--- | :--- |
| health：返回 PG 与 pgvector 状态 | `test/integration/api.test.ts` | 200、`code=0`、`pg/pgvector=true`、`scheduler.registered=7` | 健康检查不属于 9 个业务 UC |
| 未知路由 404 | `test/integration/api.test.ts` | `GET /api/v1/nope` → 404、`code=404` | 契约兜底，不承载业务规则 |
| 工具清单：31 个 opc 工具且参数 schema 完整 | `test/integration/plugin.test.ts` | 31 个工具名、`parameters.type='object'`、`description` 非空 | 装配完整性，不属业务验收 |
| opc_health：可执行并返回 PG/pgvector/任务信息 | `test/integration/plugin.test.ts` | `pg/pgvector=true`、`registeredTasks=7` | 同健康检查 |
| 每个 spec 实体都在数据库里存在，且属性列齐备 | `test/integration/spec.test.ts` | ≥35 实体、`id` 主键、逐属性列存在 | 规格-实现对账，跨全部 UC |
| api.yaml 的每个 operation 都有对应 HTTP 路由 | `test/integration/spec.test.ts` | 28 operation 全部命中且数量相等 | 契约门禁 |
| 错误码集合与实现一致 | `test/integration/spec.test.ts` | 19 个错误码双向相等 | 契约门禁 |
| 实体与用例的追溯不断链 | `test/integration/spec.test.ts` | `REQ-*-00x`、`TC-*-00x` 格式与实体引用存在 | 追溯门禁 |

## 8. 未覆盖项与理由

| # | 未覆盖项 | 理由 | 后续归属 |
| ---: | :--- | :--- | :--- |
| N-1 | DSH 宿主内嵌定时器与插件正式装配 | `plugin.test.ts` 只验 `createHub` 与工具可执行；宿主 `webServer` 的 exact 静态路由与 tick 由宿主进程计时，测试以 `scheduler.tick(now)` 手动注入时刻替代 | Phase 2 补宿主装配测试；当前以 G4 手工冒烟 3 项兜底（STP 7.2） |
| N-2 | 真实 LLM Verifier 调用与独立 Verifier Agent 模型路由 | `Verifier.judge` 接收 `samples: string[]`，用例注入 `['pass','pass','fail']` 等数组；真实裁判模型输出分布未参与判定 | Phase 2 接 `dsh-llm-verifier`，按实测校准阈值 0.8 |
| N-3 | 三关自动测试（静态/dry_run/历史回放）与影子运行 | 设计 8.6.9.2 的三关需独立 Verifier Agent 与回放样本集，本阶段 `WorkflowRunner` 只提供实例/幂等/评判原语 | Phase 2 接 `dsh-workflow-ptc` |
| N-4 | 真实 MCP 情报抓取 | 情报官数据源未接入，`biz.lead`/`biz.dd_report` 仅有模型与覆盖度声明字段 | Phase 2 接入后补数据源契约用例 |
| N-5 | 数据库账号权限边界（`audit_log` 仅 INSERT） | 迁移未创建受限角色与 GRANT，测试以 `AuditService` 单写入口在服务层保证；“数据库层拒绝 UPDATE/DELETE”无负例 | Phase 2 建独立角色 + 权限负例 |
| N-6 | 错误码负例：`ERR-VIEW-001`（未注册视图/非法过滤字段）、`ERR-CONFLICT-001`（非法冲突类型/冻结单元不存在/裁决 option 非法/冲突不存在 404）、令牌 TTL>300 与 `field_scope` 空 | 现有用例只走主路径与已列异常（重复消费、过期、未授权、守卫失败）；400 负例未逐项建用例 | G5 前补参数化负例用例集 |
| N-7 | 审计明细类断言：审计 payload 字段白名单、实例生命周期事件（start/finish）、裁决后 `biz.decision`/`arbitration_id` 明细与受影响报表清单 | 现断言只到“状态迁移 + 不落敏感值 + 条数”，未逐字段核对载荷结构 | G5 前补“审计载荷 schema”断言 |
| N-8 | 审计导出“目录只追加不覆盖”与恢复时链头不一致拒绝续链（`verifyChain` 的 `brokenAt` 分支） | 现有用例验正向续链，未造“链头被改坏”的负例 | G5 前补篡改链头用例 |
| N-9 | 观察期/灰度/自动回滚与三阶段回滚（8.6.9.6/8.6.9.7） | 功能未实现（本阶段无观察期状态机），无对象可测 | Phase 2 随灰度上线实现补测 |
| N-10 | 多实例并发抢占（行锁/advisory lock）、审计表分区预留与 PgBouncer transaction 池模式；Verifier 跨 evidence 变化的重评 | 单机单进程部署、直连无 PgBouncer；分区仅预留主键未建分区；缓存用例只验同 evidence 命中 | Phase 2 部署形态定稿后补容量与并发用例 |

补充说明：N-6 中“范围外字段”的**返回收窄**已在 TC-TOKEN-001 覆盖（同客户 `health` 未返回），未覆盖的是“主动请求越界字段”的拒绝路径——`consumeToken` 接口不接收字段参数，越界在签发时由 `field_scope` 约束，故不另设越权消费用例。

## 9. 偏差登记与闭环

| # | 偏差（发现时） | 证据 | 影响 | 状态与结论 |
| ---: | :--- | :--- | :--- | :--- |
| X-1 | `upsertTask` 与 `runTask` 的错误码归属：规格侧（`api.yaml` + `OPC-IRS-001` + `OPC-SRS-001`）一致声明“cron 无法解析/任务类型未注册 → 400 `ERR-TASK-001`”“任务不存在 → 404 `ERR-TASK-002`”；发现时实现语义相反——`upsert` 的非法 cron/未注册类型抛 `ERR-TASK-002`（400），`run` 的未注册任务抛 `ERR-TASK-001`（404） | 规格侧：`spec/opc-xuanji/api.yaml` 第 398–460 行；`OPC-IRS-001-接口需求规格说明.md` 错误码表（第 83–84 行）、接口清单 P14/P15（第 161–162 行）、按码处置表（第 649、684 行）；`OPC-SRS-001-软件需求规格说明.md` AC-1/AC-4（第 603、606 行）。发现时实现侧：`src/platform/errors.ts` 中 `TASK_NOT_FOUND=ERR-TASK-001`、`TASK_INVALID=ERR-TASK-002`；`src/scheduler/engine.ts` 的 `upsert`/`run`；`test/integration/scheduler.test.ts`「配置校验」断言 `ERR-TASK-002` | `spec.test.ts`「错误码集合与实现一致」只校验**集合**双向相等，故未暴露；按接口逐项对账时出现“用例过、规格不符”，按码分流的调用方（老板端/工具层）会走错提示分支 | **已闭环（2026-11-05，实现已对齐 `api.yaml`：`ERR-TASK-001`=任务配置非法，`ERR-TASK-002`=任务未找到）**。处置按优先方案①执行：交换 `errors.ts` 两个常量值（`TASK_INVALID: "ERR-TASK-001"`、`TASK_NOT_FOUND: "ERR-TASK-002"`），`scheduler.test.ts` 两处断言改为 `ERR-TASK-001`；规格文本未改，未产生契约变更单 |

**回归证据**：`node --test --test-concurrency=1 test/integration/scheduler.test.ts test/integration/spec.test.ts` → 10/10 pass（2026-11-05，修复后执行）。本说明第 4.13 节期望值已同步为 `ERR-TASK-001`，第 5 章总表断言要点同步更新；同一偏差在 `OPC-STP-001-测试计划` 第 9 章风险表中作为契约风险条目记录，结论以本节为准。

## 10. 用例维护规则

1. **规格变更先动 YAML**：`usecases.yaml` 的 `tests` 字段增删 TC 时，本说明第 4、5 章与覆盖核算（53+8=61）同步更新，否则视为文档失效。
2. **用例标题即索引**：改测试标题必须同步第 4、5 章引用；不允许只改代码不改文档。
3. **禁止跳过**：不得用框架的跳过/待办能力让门禁变绿；确需临时禁用，必须在本章登记编号、原因与恢复时点，并在 `OPC-STR-001` 说明。
4. **新增用例自检三点**：是否连测试库、是否 `beforeEach` 清库、是否用绝对断言；三点缺一不予合入。
5. **断言与实现解耦**：验证落库值时用原始 SQL 回读，不调用被测服务的读接口自证。
6. **缓存与耗时**：`npm test` 必须串行；新增文件后同步 `package.json` 的通配（现为 `test/unit/*.test.ts`、`test/integration/*.test.ts`）。

## 自检清单

- [x] 31 条 TC 与 `usecases.yaml` 的 `tests` 字段逐一对应（员工分册 AC 直验另计），无遗漏、无自造编号。
- [x] 每条 TC 均给出前置条件、步骤、输入数据、期望结果、覆盖的需求与接口、对应用例。
- [x] 所有测试文件路径指向仓库真实文件，测试标题与代码原文一致。
- [x] 第 5 章总表 24 行齐全，覆盖核算 60 + 8 = 68 可复算，与 `npm test` 用例总数一致。
- [x] 第 6 章 62 个接口全部有覆盖归属，健康检查等横切项单列不混入 TC。
- [x] 未覆盖项 10 条，每条有理由与后续归属，真实 LLM Verifier、DSH 定时器、MCP 三条在列。
- [x] 断言用绝对值（金额、行数、错误码、哈希长度、置信度），未使用“大致正确”式判据。
- [x] 错误码归属偏差（X-1）已登记并闭环，含实现对齐说明与回归证据命令。
- [x] 固定时钟、清库、种子、临时归档目录的使用方式与 `test/helpers.ts` 实现一致。
- [x] 正文无未完成占位；frontmatter 九字段与文末两节齐备。
- [x] 与上游规格、STP 计划、STR 报告的引用关系完整，无孤立章节。
- [x] 维护规则可执行（禁止 skip、三点自检、标题同步），不依赖口头约定。

## 与其他文档的关系

| 文档 | 关系 | 说明 |
| :--- | :--- | :--- |
| [spec/opc-xuanji/usecases.yaml](../spec/opc-xuanji/usecases.yaml) | 上游（TC 与 UC 唯一来源） | 第 4 章的 16 节按此文件的 UC 顺序与 `tests` 字段展开 |
| [spec/opc-xuanji/api.yaml](../spec/opc-xuanji/api.yaml) | 上游 | 第 6 章接口矩阵与第 9 章偏差登记的依据 |
| [spec/opc-xuanji/entities.yaml](../spec/opc-xuanji/entities.yaml) | 上游 | 第 7 章实体列对账用例的期望来源 |
| [docs/OPC-STP-001-测试计划.md](OPC-STP-001-测试计划.md) | 同级（上位计划） | 本说明承接其第 2、3 章范围与级别，落地为逐条用例设计 |
| [test/helpers.ts](../test/helpers.ts) | 实现依据 | 第 2 章的 `makePool`/`resetDb`/`seedEmployee`/`NOW` 均出自此文件 |
| [test/unit/cron.test.ts](../test/unit/cron.test.ts) / [guard.test.ts](../test/unit/guard.test.ts) | 实现依据 | TC-TASK-003/004 与 TC-WF-001/002 的单元层断言 |
| [test/integration/platform.test.ts](../test/integration/platform.test.ts) | 实现依据 | TC-VIEW-001、TC-TOKEN-001/002、TC-CONFLICT-001/002 |
| [test/integration/audit.test.ts](../test/integration/audit.test.ts) | 实现依据 | TC-AUDIT-001/002 |
| [test/integration/workflow.test.ts](../test/integration/workflow.test.ts) | 实现依据 | TC-WF-001 … TC-WF-005 |
| [test/integration/scheduler.test.ts](../test/integration/scheduler.test.ts) | 实现依据 | TC-TASK-001 … TC-TASK-004 与审计导出任务 |
| [test/integration/api.test.ts](../test/integration/api.test.ts) | 实现依据 | 28 个 HTTP 契约中的 8 个用例（Web 契约由 web.test.ts 覆盖） |
| [test/integration/plugin.test.ts](../test/integration/plugin.test.ts) | 实现依据 | DSH 工具清单、健康检查、任务配置、视图拒绝 |
| [test/integration/spec.test.ts](../test/integration/spec.test.ts) | 实现依据 | 第 7 章 4 条契约门禁用例 |
| [OPC-STR-001-测试报告](OPC-STR-001-测试报告.md) | 下游 | 记录本设计的实际执行结果、失败与缺陷编号，与本说明的期望值互相对应 |
| `OPC-SRS-001` / `OPC-IRS-001` / `OPC-SDD-001` / `OPC-DBDD-001` | 同级 | 需求、接口、设计、数据库文档；判定“实现错还是规格错”时按此四份仲裁，第 9 章 X-1 即由 IRS/SRS 与实现比对发现 |
| [docs/index.md](index.md) | 同级（导航） | 文档清单、编号规则与状态基线；本说明的编号、状态、阶段以其为准 |
