---
doc_id: OPC-STR-001
title: OPC-玄机·一人公司中枢 测试报告
version: 0.3
status: 评审稿
stage: D4
owner: 集成验证组
upstream: [OPC-STP-001, OPC-STD-001, OPC-SRS-001, OPC-IRS-001]
gate: G4
updated: 2026-11-06
---

# OPC-玄机·一人公司中枢 测试报告

本报告回答一个问题：**这一版代码在真实 PostgreSQL 上是否按契约工作、哪些结论有命令证据、哪些还没验证**。读者是项目集成者、验收人与后续维护者；结论只以命令输出与落盘日志为准，不以“看起来没问题”放行。

## 目录

1. 测试环境与版本
2. 执行结果汇总
3. 分层结果明细
4. 需求—用例—测试追溯
5. 缺陷与修复记录
6. 门禁判定
7. 未覆盖项与残余风险
8. 复现命令

## 1. 测试环境与版本

| 项 | 实测值 | 证据 |
| :--- | :--- | :--- |
| 运行时 | Node v24.21.0（`process.features.typescript=strip`） | `node -v` |
| 数据库 | PostgreSQL 17.11（Debian），`localhost:5432` | `select version()` |
| 向量扩展 | pgvector 0.8.0（`CREATE EXTENSION vector` 成功） | `select extname, extversion from pg_extension` |
| 业务库 / 测试库 | `opc` / `opc_test`（均 UTF8、`zh_CN.UTF-8`） | `pg_database` |
| 迁移链 | `0001_init.sql`、`0002_token_code.sql`、`0003_audit_export_cursor.sql` 全部应用 | `public._opc_migrations` |
| 类型检查 | `tsc --noEmit` 退出码 0 | `research/typecheck.log` |
| 规格门禁 | `check-spec.mjs --dir spec`：PASS（ERROR 0，WARN 83） | `research/check-spec.log` |

> 测试库与业务库物理隔离；`test/helpers.ts` 在 `NODE_ENV=test` 下若发现两个 DSN 相同会直接拒绝启动。

## 2. 执行结果汇总

```text
$ npm test
ℹ tests 51
ℹ pass 51
ℹ fail 0
ℹ duration_ms 6924.27266
[exit 0]
```

| 指标 | 结果 |
| :--- | :--- |
| 用例总数 | 51（单元 16 + 集成 35） |
| 通过 / 失败 / 跳过 | 51 / 0 / 0 |
| 首轮红灯 | 4 个测试文件全部失败（`ERR_MODULE_NOT_FOUND`：实现尚未编写） |
| 转绿方式 | 按模块实现后逐组转绿；断言未做任何放宽 |
| 总耗时 | 约 6.9 s（串行执行，含真实 PG 往返） |

## 3. 分层结果明细

| 层次 | 文件 | 用例数 | 覆盖点 |
| :--- | :--- | ---: | :--- |
| 单元 | `test/unit/cron.test.ts` | 7 | 5 字段解析、步长/区间/列表、周日 0/7、非法表达式、Asia/Shanghai 下次触发、跨周末、严格晚于、`describeCron` |
| 单元 | `test/unit/guard.test.ts` | 9 | 六项守卫各自拒绝路径、`risk_level` 自述即拒、节点命名、视图授权、幂等完整性、工具合法性、跨员工隔离、代码哈希、风险硬规则 high/medium/low |
| 集成 | `test/integration/platform.test.ts` | 3 | 视图授权聚合与拒绝审计、令牌单次消费/过期/审计不落敏感值、冲突冻结与“总额含冻结 + 有效额”口径、裁决解冻 |
| 集成 | `test/integration/audit.test.ts` | 3 | prev_hash 链、`verifyChain`、JSONL 导出 SHA-256、链头与导出游标续链、按动作/实例过滤 |
| 集成 | `test/integration/workflow.test.ts` | 7 | 注册成功/守卫失败/同版本 409、实例启动/幂等节点/异入参 409/生命周期、未注册 404、Verifier 多数票与升级人工、evidence 缓存、聚合函数 |
| 集成 | `test/integration/scheduler.test.ts` | 6 | 7 个默认任务落库、cron/任务类型校验、同计划时间幂等与 force 重跑、审计导出任务、晨报聚合写入、tick 推进 next_run_at |
| 集成 | `test/integration/api.test.ts` | 8 | health、视图 200/403、令牌 201→200→409、冲突 201→200、注册 201/422、实例与幂等节点、Verifier、审计查询/导出、任务列表/配置/执行、晨报、未知路由 404 |
| 集成 | `test/integration/plugin.test.ts` | 4 | 16 个工具定义完整、`opc_health` 可执行、任务配置增改、未授权视图错误码 |
| 集成 | `test/integration/spec.test.ts` | 4 | 37 个实体表与列在 DB 存在、16 个 API operation 均有路由、错误码集合一致、REQ/UC/TC 追溯无悬空 |

## 4. 需求—用例—测试追溯

`spec/opc-xuanji/usecases.yaml` 的 9 个用例全部有测试映射，且被 `test/integration/spec.test.ts` 自动校验追溯不断链：

| 用例 | 需求 | 用例标识 | 对应测试 |
| :--- | :--- | :--- | :--- |
| UC-001 视图级授权查询 | REQ-VIEW-001 | TC-VIEW-001 | platform・“视图授权…”；api・“views…” |
| UC-002 一次性令牌 | REQ-TOKEN-001 | TC-TOKEN-001/002 | platform・“一次性令牌…”；api・“tokens…” |
| UC-003 冲突冻结与裁决 | REQ-CONFLICT-001 | TC-CONFLICT-001/002 | platform・“冲突冻结…”；api・“conflicts…” |
| UC-004 流程注册与准入守卫 | REQ-WF-001 | TC-WF-001/002 | workflow・“注册…”×3；guard 单元 9 例 |
| UC-005 实例与幂等节点 | REQ-WF-002 | TC-WF-003/004 | workflow・“实例…”×2；api・“workflows…” |
| UC-006 Verifier 评判 | REQ-WF-003 | TC-WF-005 | workflow・“Verifier…”；verifier 聚合单测 |
| UC-007 审计写入与哈希链 | REQ-AUDIT-001 | TC-AUDIT-001/002 | audit 集成 3 例；api・“audits…” |
| UC-008 定时任务配置与执行 | REQ-TASK-001 | TC-TASK-001/002/003 | scheduler 集成 6 例；plugin・工具 4 例 |
| UC-009 晨报聚合 | REQ-TASK-002 | TC-TASK-004 | scheduler・“晨报任务…”；api・“tasks…” |

## 5. 缺陷与修复记录

测试期间发现并修复的真实缺陷（均先在测试里复现）：

| # | 现象 | 根因 | 修复 | 回归证据 |
| :--- | :--- | :--- | :--- | :--- |
| D-01 | 并行跑集成测试时 `TRUNCATE` 报 40P01 死锁 | 多个测试文件共用一个测试库，各自清库互相等锁 | `resetDb` 加会话级 advisory lock 串行化 + `--test-concurrency=1` | 全量 51 例串行通过 |
| D-02 | 第二次 `audit.export()` 把历史记录重复导出 | 导出没有游标，`sinceId` 默认 0 | 增加 `audit_export.last_audit_id`（迁移 0003），下次默认续导 | audit・“导出 JSONL…”断言第二次 rowCount=1 |
| D-03 | 令牌 ID 为自增主键可被枚举 | 令牌直接用 `id` 对外 | 新增不可猜测 `token_code`（16 字节 hex，迁移 0002），消费按 code 查 | platform・令牌用例 + api 令牌 409 |
| D-04 | `meta.id` 与 `workflowId` 不一致时被拒绝但**没有审计** | 校验分支在统一审计之前提前抛出 | 该分支先写 `workflow.register/denied` 再抛 | workflow・“守卫失败…”断言审计存在 |
| D-05 | 单动词节点（如 `reconcile`）被节点命名规则误杀 | 正则强制 `verb_noun` 下划线 | 放宽为 snake_case（`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`） | guard 单元 9 例 |
| D-06 | 工具抛错只有中文消息，模型侧无法按码分流 | 工具边界未包装错误码 | `createHub` 统一包装为 `ERR-xxx-000: message` | plugin・“未授权视图错误码” |

## 6. 门禁判定

| 门 | 判据 | 结果 |
| :--- | :--- | :--- |
| G1 建模 | entities/modules/usecases 完整、引用无悬空 | PASS（check-spec ERROR 0） |
| G2 契约 | api.yaml 16 operation 与实现路由一一对应、错误码登记齐全 | PASS（`spec.test.ts` 对账） |
| G3 实现 | `tsc --noEmit` 0 错误、单元 16/16 | PASS |
| G4 验证 | 集成 35/35（真实 PG 17.11 + pgvector） | PASS |

## 7. 未覆盖项与残余风险

1. **DSH 运行时内嵌行为**：插件 `apply()` 的工具注册/`webServer` 精确路由/`setInterval` tick 只在 `createHub` 层测过，未在真实 DSH 进程内做端到端加载验证（需 profile 装配与重启）。
2. **真实 Verifier 调用**：采样投票与升级逻辑已测，`dsh-llm-verifier` 的真实模型调用、A/B 交换轮次与成本模型未接入。
3. **Workflow 三关测试与影子运行**：静态检查/dry_run/历史回放依赖 `dsh-workflow-ptc`，Phase 2 落地；当前以“注册守卫 + 幂等 + 评判”原语覆盖。
4. **MCP 情报数据源**：尽调覆盖度声明只有数据结构，未接真实数据源，结论不得用于实际签约决策。
5. **并发与容量**：调度器单进程串行 tick、PG 连接池 6；多实例并发部署时的任务抢占（行锁/ advisory lock）未做压测。
6. **审计只追加的强制力**：应用角色 `opc` 是表 owner，理论上可 UPDATE/DELETE；生产应另建 `opc_app` 角色仅授予 INSERT（已写入 DBDD 部署清单，尚未在测试环境演练）。
7. **DSH Web 宿主插槽**：`WebHostAdapter` 三档适配未在真实 DSH Web 进程验证；右侧面板/会话事件/记忆插件契约仍需联调。
8. **Web/员工集成测试**：本机未执行；CI 已在 PostgreSQL 17 + pgvector 上跑通 68/68（run `42153267527`）。本地复跑仍需 `OPC_TEST_DSN`。
9. **外部检索源**：插件雷达/关键词雷达用任务 config 注入候选验证；插件市场/MCP 适配器未接入。

## 8. 复现命令

```bash
cd /path/to/opc-xuanji
npm install
npm run migrate && npm run migrate:test
npm test 2>&1 | tee research/test-run.log
node node_modules/typescript/bin/tsc --noEmit
node scripts/check-spec.mjs --dir spec
```

## 9. v2.10 增量验证（2026-11-06）

本节追加记录网页表现层增量，不覆盖第 1–8 节的 D4 基线结果。

| 项 | 结果 | 证据/说明 |
| :--- | :--- | :--- |
| 本机运行时 | Node v22.23.3（类型擦除） | 仅用于本轮增量；正式 CI 仍按 Node ≥24.9 矩阵 |
| 单元测试（`npm run test:unit`） | 21/21 pass | 基线 16 + Web 5（分类/抽取/决策、插件评分、陈旧判定） |
| 类型检查（`npx tsc --noEmit`） | exit 0 | 包含新增 `src/web/*.ts`、P17–P28 路由与 10 个 Web 工具 |
| 规格生成一致性（`node scripts/gen-spec.mjs --check`） | PASS | 45 实体与生成器一致 |
| 新增集成用例（`test/integration/web.test.ts`） | 未执行（环境缺失） | `npm test` 因 `缺少 OPC_PG_DSN` 在 8 个集成文件启动阶段失败；单元 21 通过，见 `research/web-full-test-run.log` |
| 契约门禁（`check-spec` / `spec.test.ts`） | 未执行（环境缺失） | 本机无 `check-spec.mjs` 与测试库；已用脚本核对 api.yaml 28 operation ↔ ROUTES 28 条，见 `research/web-spec-check.log` |
| 迁移 `0004_web_layer.sql` | 未在真实库应用 | 需测试库执行后跑 `spec.test.ts` 与 Web 集成用例 |

**结论**：Web 层代码与单元测试通过；集成/契约结论待具备 `OPC_TEST_DSN` 与 `check-spec` 脚本的环境补测。未通过项不得据此宣称 G4 通过，沿用“未覆盖项”口径。

## 10. v2.11 员工分册 / 可插拔 / 员工包增量验证（2026-11-06）

本节追加记录员工分册、WBS/外宣与员工包增量，不覆盖第 1–9 节结果。

| 项 | 结果 | 证据/说明 |
| :--- | :--- | :--- |
| 本机运行时 | Node v22.23.3（类型擦除） | 正式 CI 仍按 Node ≥24.9 矩阵 |
| 单元测试（`npm run test:unit`） | 25/25 pass | 基线 21 + 员工 manifest/包格式 4 |
| 类型检查（`npx tsc --noEmit`） | exit 0 | 含 `src/employees/*`、P29–P34、5 个 `opc_employee_*` 工具 |
| 规格生成一致性（`node scripts/gen-spec.mjs --check`） | PASS | 54 实体与生成器一致 |
| 契约核对 | 34 operation ↔ 34 routes；14 错误码 | 见 `research/web-spec-check.log` 更新版 |
| 本机全量测试（`npm test`） | 环境缺失 | 本机无 `OPC_TEST_DSN`，9 个集成文件启动阶段失败；CI 已补跑，见下 |
| CI 单元/门禁矩阵 | 26 个作业步骤全部通过 | GitHub Actions run `42153267527`；Node 24.9/24/26 的 typecheck、单元、gen-spec、spec、docs 门禁全绿 |
| CI 集成（`npm test`） | **68/68 pass** | GitHub Actions run `42153267527`；PostgreSQL 17 + pgvector service；`0001..0005` 迁移已应用 |
| 迁移 `0005_employee_lines.sql` | 已在 CI 测试库应用 | `npm test` 68/68 通过，含员工包/Web/流程/审计用例 |

**结论**：v0.1.0 的单元、契约、集成在 GitHub Actions 全部通过（68/68）；本机仅因缺少 `OPC_TEST_DSN` 未复跑集成。CI 证据：https://github.com/mindtheory/opc-xuanji/actions/runs/42153267527 。

## 11. v2.15 基础资源增量验证（2026-11-14）

本节追加记录基础资源配置（REQ-PRJ-023..026）的验证结果，不覆盖第 1–10 节。

| 项 | 结果 | 证据/说明 |
| :--- | :--- | :--- |
| 迁移 `0008_shared_resources.sql` | 业务库 applied 1 / 测试库 applied 1 | `npm run migrate`、`npm run migrate:test` 均 exit 0 |
| 新增集成用例（`admin-shared.test.ts`） | **5/5 pass** | TC-RES-001..005，`node --test` 输出 pass 5 / fail 0 |
| 全量测试（`npm test`） | **103/103 pass** | v2.13 基线 98 + v2.15 增量 5；串行执行无超时 |
| 类型检查 | exit 0 | `npm run typecheck` 无输出 |
| 规格门禁 | PASS（79 实体 / 23 用例 / 21 模块） | `npm run spec:check` |
| 文档门禁 | PASS（28 份文档） | `npm run docs:check` |
| 安全项 | 明文口令入库被拒 | TC-RES-004 断言 400 `ERR-RES-002`；库内仅存 `env:OPC_DEFAULT_SSH_PASSWORD` 引用 |

**结论**：基础资源配置在迁移、接口、单元/集成、契约与文档五个层面均已验证；部署后由发版值守按 `npm test` 全量回归。

## 12. v2.16 项目自动驾驶增量验证（2026-11-14）

本节追加记录项目自动驾驶（REQ-PRJ-027..030）的验证结果，不覆盖第 1–11 节。

| 项 | 结果 | 证据/说明 |
| :--- | :--- | :--- |
| 迁移 `0009_project_autopilot.sql` | 业务库 applied 1 / 测试库 applied 1 | `npm run migrate`、`npm run migrate:test` 均 exit 0 |
| 新增集成用例（`autopilot.test.ts`） | **4/4 pass** | TC-AUTO-001..004，夹具为本地 `file://` git 仓库（无外网依赖） |
| 全量测试（`npm test`） | **107/107 pass** | v2.15 基线 103 + v2.16 增量 4 |
| 类型检查 | exit 0 | `npm run typecheck` 无输出 |
| 规格门禁 | PASS（83 实体 / 25 用例 / 21 模块；102 operation） | `npm run spec:check` |
| 文档门禁 | PASS（28 份文档） | `npm run docs:check` |
| 安全项 | 只读扫描、无仓库代码执行、失败不伪造 | 检出仅 `git clone` + 读文件；无 `npm install`/`build`/`run` 调用 |
| 裁决口径 | 仅 license/ci/deploy_target 三项入队 | 夹具已有测试目录，故无 test_baseline；无公网服务器 → deploy_target |

**结论**：自动驾驶在迁移、接口、扫描、计划生成、裁决闭环与门禁五个层面均已验证；生产发布仍需人工审批，不因自动化放行。

## 13. v2.17 自动化生产增量验证（2026-11-14）

本节追加记录自动化生产（REQ-PRJ-031..033）的验证结果，不覆盖第 1–12 节。

| 项 | 结果 | 证据/说明 |
| :--- | :--- | :--- |
| 迁移 `0010_autopilot_production.sql` | 业务库 applied 1 / 测试库 applied 1 | `npm run migrate`、`npm run migrate:test` 均 exit 0 |
| 自动化生产用例（`autopilot.test.ts`） | **7/7 pass** | TC-AUTO-001..007；骨架/流水线/发布链路均用本地夹具，无外网依赖 |
| 全量测试（`npm test`） | **110/110 pass** | v2.16 基线 107 + v2.17 增量 3 |
| 类型检查 | exit 0 | `npm run typecheck` 无输出 |
| 规格门禁 | PASS（86 实体 / 26 用例 / 21 模块；103 operation / 30 errorCodes） | `npm run spec:check` |
| 文档门禁 | PASS（28 份文档） | `npm run docs:check` |
| 安全项 | 骨架不推送远端、默认不装依赖、发布无命令转裁决 | 流水线最小 env + 300s 超时；发布仅执行显式配置的命令 |
| 磁盘 | `/tmp` 曾满（2.7G tmpfs），已清理陈旧临时产物；克隆默认落 `~/.opc-workspaces` | 可用 `OPC_WORKSPACE_ROOT` 覆盖 |

**结论**：自动化生产在迁移、接口、骨架、流水线、测试环境发布与门禁六个层面均已验证；生产发布仍只走人工审批。

## 14. v2.18 运维反馈增量验证（2026-11-14）

本节追加记录运维闭环（REQ-OPS-001..003）的验证结果，不覆盖第 1–13 节。

| 项 | 结果 | 证据/说明 |
| :--- | :--- | :--- |
| 迁移 `0011_ops_feedback.sql` | 业务库 applied 1 / 测试库 applied 1 | `npm run migrate`、`npm run migrate:test` 均 exit 0 |
| 新增用例（`ops.test.ts`） | **5/5 pass** | TC-OPS-001..005；GitHub 用本地 mock，AI 用规则路径 |
| 全量测试（`npm test`） | **115/115 pass** | v2.17 基线 110 + v2.18 增量 5 |
| 类型检查 | exit 0 | `npm run typecheck` 无输出 |
| 规格门禁 | PASS（89 实体 / 28 用例 / 21 模块；107 operation / 32 errorCodes） | `npm run spec:check` |
| 文档门禁 | PASS（28 份文档） | `npm run docs:check` |
| 隐私项 | 遥测无请求体、Issue 正文脱敏 | 长 token 与 `token=/password=` 模式替换为 *** |
| 降级项 | 未配置 token 不失败 | 草稿标 skipped 并保留，主流程不受影响 |

**结论**：运维闭环在迁移、接口、遥测、去重、投递与降级六个层面均已验证；真实 GitHub 投递需在部署机配置 token 后由定时任务执行。

## 15. v2.19 已建项目接入增量验证（2026-11-14）

| 项 | 结果 | 证据/说明 |
| :--- | :--- | :--- |
| 自动驾驶用例（`autopilot.test.ts`） | **9/9 pass** | 新增 TC-AUTO-008（已建项目接入）、TC-AUTO-009（重复执行幂等） |
| 重复执行幂等 | 版本库 1 / 里程碑 5 / 测试计划 1 / 用例 3 / 环境 1；计划版本 1→2 | 二次执行返回 `repository.reused=true` |
| 全量测试（`npm test`） | **117/117 pass** | v2.18 基线 115 + v2.19 增量 2 |
| 类型检查 | exit 0 | `npm run typecheck` |
| 规格门禁 | PASS（89 实体 / 29 用例 / 21 模块） | `npm run spec:check` |
| 文档门禁 | PASS（28 份文档） | `npm run docs:check` |

**结论**：已建项目可一键接入自动驾驶；重复执行不产生重复资源，计划保留版本历史。

## 16. v2.20 创意转项目增量验证（2026-11-14）

| 项 | 结果 | 证据/说明 |
| :--- | :--- | :--- |
| 迁移 `0012_project_idea.sql` | 业务库 applied 1 / 测试库 applied 1 | `npm run migrate`、`npm run migrate:test` 均 exit 0 |
| 新增用例（`idea.test.ts`） | **5/5 pass** | TC-IDEA-001..005；docx/xlsx/pdf 用本地夹具，AI 用本地 mock |
| 全量测试（`npm test`） | **122/122 pass** | v2.19 基线 117 + v2.20 增量 5 |
| 类型检查 | exit 0 | `npm run typecheck` |
| 规格门禁 | PASS（90 实体 / 30 用例 / 21 模块；110 operation / 34 errorCodes） | `npm run spec:check` |
| 文档门禁 | PASS（28 份文档） | `npm run docs:check` |
| 降级项 | AI 不可用 → 规则解析；文档解析失败 → 明确错误码 | `ERR-IDEA-002`，不静默返回空 |

**结论**：创意转项目在文档解析、AI 解析、建项目、接入自动驾驶/裁决与降级五个层面均已验证。

## 17. v2.21 微信推送增量验证（2026-11-14）

| 项 | 结果 | 证据/说明 |
| :--- | :--- | :--- |
| 迁移 `0013_wechat_push.sql` | 业务库 applied 1 / 测试库 applied 1 | exit 0 |
| 新增用例（`wechat.test.ts`） | **5/5 pass** | 投递端点本地 mock；覆盖未绑定/投递/退避/去重/裁决入队 |
| 全量测试（`npm test`） | **127/127 pass** | v2.20 基线 122 + v2.21 增量 5 |
| 类型检查 / 规格 / 文档 | 全绿 | typecheck exit 0；spec 91/31/21；docs 28 份 |
| 绑定探测 | `/api/dsh-im/delivery/messages` 在线但 `unknown-bot` | BotHarness 已装、未绑定微信渠道；绑定后配置 botId/targetId 即可推送 |

**结论**：OPC 侧推送链路（入队/投递/退避/去重/状态）已验证；真实微信投递需先在 GUI 绑定微信 bot。

## 18. v2.22 SVN 版本库检出增量验证（2026-11-14）

| 项 | 结果 | 证据/说明 |
| :--- | :--- | :--- |
| 迁移 `0014_autopilot_svn.sql` | 业务库 applied 1 / 测试库 applied 1 | exit 0；表数仍 91，`ref.project_checkout` 13→15 列 |
| 新增用例（`autopilot.test.ts`） | **2/2 pass** | TC-AUTO-010（SVN 检出/修订号/扫描/档案/发布版本号）、TC-AUTO-011（svn 缺失 502 + `svn_client` 裁决） |
| 自动驾驶用例（`autopilot.test.ts`） | **11/11 pass** | 9→11 增量，其余 9 例无回归 |
| 全量测试（`npm test`） | **129/129 pass** | v2.21 基线 127 + v2.22 增量 2 |
| 类型检查 / 规格 / 文档 | 全绿 | typecheck exit 0；spec 91/31/21；docs 28 份 |
| 安全项 | 密码经 stdin、凭据仅 `env:` 引用 | 检出进程不落明文、不写日志；svn 缺失不伪造工作副本与档案 |
| 口径项 | `vcs_kind`/`revision` 落库；扫描跳过 `.svn`/`.hg`；发布版本号 `coalesce(commit_sha, revision)` | TC-AUTO-010 断言 `checkout.vcs=svn`、`software_profile.vcs=svn` |

**结论**：SVN 与 Git 双协议检出在迁移、检出、扫描、档案回填、发布版本号与降级六个层面均已验证；SVN 骨架只落工作副本、不提交，生产发布仍需人工审批。

## 自检清单

- [x] 用例总数与通过数以 `npm test` 输出为准，未手工改写
- [x] 每个用例组均有可复现命令
- [x] 缺陷记录含“现象/根因/修复/回归证据”四要素
- [x] 未覆盖项按“依赖外部能力/需真实运行时/需容量环境”分类列出
- [x] 门禁结论可追溯到 `research/*.log`
- [x] 测试库与业务库 DSN 不同、清库策略已说明
- [x] 未覆盖项均有明确归属阶段（Phase 2 / 部署演练）
- [x] 复现命令在本机连续执行两次结果一致（无跨日/时区抖动）

## 与其他文档的关系

- 上游：`OPC-STP-001`（测试计划，定义范围与准则）、`OPC-STD-001`（测试设计，TC 到代码的映射）、`OPC-SRS-001` / `OPC-IRS-001`（需求与接口契约）
- 下游：`PA-OPC-*`（过程资产：G4 证据）、`OPC-SDD-001`（缺陷修复回写设计）、发布说明
- 同级：`OPC-DBDD-001`（迁移链与审计游标变更的库表依据）
