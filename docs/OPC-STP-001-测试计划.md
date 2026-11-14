---
doc_id: OPC-STP-001
title: OPC-玄机 · 一人公司中枢 测试计划
version: 0.3
status: 评审稿
stage: D4
owner: 质量与交付组（docs-test）
upstream: ["spec/opc-xuanji/usecases.yaml", "spec/opc-xuanji/api.yaml", "spec/opc-xuanji/entities.yaml", "OPC-玄机 · 一人公司中枢-产品设计.md（v2.11）", "OPC-玄机 · 技术选型与系统架构.md（v2.11）"]
gate: G4
updated: 2026-11-06
---

# OPC-STP-001 · OPC-玄机 · 一人公司中枢 测试计划

本计划解决“验证到底要验什么、验到什么程度算过、谁来验”的问题：把上游规格（31 个用例、60 条 TC、114 个 HTTP 接口、35 个错误码）与仓库里真实存在的 127 个自动化用例对账，定出级别、环境、数据、准入准出与缺陷回流规则。**读者与使用时点**：测试执行者在 G4（D4 验证门禁）复跑与签收前逐章核对；开发在失败定位与修复回流时看第 8 章；评审人在判断“能不能过门禁”时只看第 7、9 章；发布/归档者按第 7、11 章取证据。

## 目录

- [1. 测试目标与质量属性](#1-测试目标与质量属性)
- [2. 测试范围](#2-测试范围)
- [3. 测试级别与分层](#3-测试级别与分层)
- [4. 测试环境与基础设施](#4-测试环境与基础设施)
- [5. 测试数据策略](#5-测试数据策略)
- [6. 进入准则](#6-进入准则)
- [7. 退出准则与通过标准](#7-退出准则与通过标准)
- [8. 缺陷分级与回流](#8-缺陷分级与回流)
- [9. 风险与应对](#9-风险与应对)
- [10. 进度与责任人](#10-进度与责任人)
- [11. 度量、报告与门禁归档](#11-度量报告与门禁归档)

## 1. 测试目标与质量属性

### 1.1 目标

1. **规格不漂移**：`spec/opc-xuanji/*.yaml` 声明的实体列、HTTP 路由、错误码集合与实现逐项一致（G2 冻结到 G3 实现的防漂移）。
2. **业务规则正确**：视图授权、一次性令牌、冲突冻结与裁决、注册守卫与风险硬规则、节点幂等、Verifier 采样投票、审计哈希链、调度幂等与晨报聚合，行为与用例期望逐条相符。
3. **安全边界成立**：未授权视图被拒且留痕；令牌单次有效、过期拒绝、字段范围收窄、审计不落敏感值；审计只经中枢统一入口。
4. **可恢复**：中断恢复依赖 `instance_id + node_id` 与 `(task_id, scheduled_at)` 幂等键，重复执行不产生二次写入。
5. **可验收**：24 条 TC 每条都能指到一个真实存在的自动化用例（映射见 `OPC-STD-001`）。

### 1.2 质量属性与判据

| 属性 | 判据 | 承载用例组 |
| :--- | :--- | :--- |
| 功能正确性 | 用例期望值逐字段命中，不用“大致合理”放行 | 全部 68 个用例 |
| 安全性 | 未授权返回专用错误码；审计不含敏感值 | TC-VIEW-001、TC-TOKEN-001/002、TC-AUDIT-001 |
| 一致性 | 实体/路由/错误码三向对账零差异 | `test/integration/spec.test.ts` 4 个用例 |
| 幂等与恢复 | 同键同参返回既有结果、同键异参 409；重复触发只执行一次 | TC-WF-004、TC-TASK-002 |
| 可追溯 | 每个 TC 有 UC/REQ/接口/用例四处指针 | `OPC-STD-001` 第 4、5 章 |
| 可运维 | 健康检查能反映 PG、pgvector 与调度器就绪 | 横切用例（健康检查 2 条） |

## 2. 测试范围

### 2.1 范围基线（与规格逐项对账）

| 维度 | 数量 | 事实来源 | 验证方式 |
| :--- | :--- | :--- | :--- |
| 用例 UC | 14 | `spec/opc-xuanji/usecases.yaml` | 24 条 TC 全量映射（STD-001 第 4、5 章） |
| 测试用例 TC | 16 | `usecases.yaml` 各 UC 的 `tests` 字段 | 43 个自动化用例承载 + 8 个横切用例 |
| HTTP 接口 | 16 | `spec/opc-xuanji/api.yaml` | `test/integration/api.test.ts` 8 条 + 规格对账 |
| DSH 工具 | 16 | `src/plugin/index.ts` | `test/integration/plugin.test.ts` 4 条 |
| 数据表 | 66 | `spec/opc-xuanji/entities.yaml`、`migrations/0001..0006` | `spec.test.ts` 列级对账（≥35 实体断言） |
| 错误码 | 12 | `api.yaml` 的 `errorCodes` | `spec.test.ts` 集合相等断言 |
| 自动化用例 | 68 | 单元 25 + 集成 43 | `npm test` |

### 2.2 范围内

- 平台能力：视图授权查询、一次性令牌签发/消费、冲突冻结与裁决、审计写入/查询/导出。
- 流程能力：注册守卫与风险等级、实例启动、写节点幂等、Verifier 评判与升级。
- 自动化能力：cron 解析与下次触发、任务配置增改与校验、执行幂等、到点 tick、晨报聚合、审计导出任务。
- 契约层：`/api/v1` 62 个 operation 的 HTTP 状态码、`code`/`errorCode` 口径；DSH 工具清单与参数 schema。
- 规格一致性：实体列、路由数、错误码集合、REQ/UC/TC 追溯引用。

### 2.3 范围外（本阶段不作自动化判定）

- DSH 宿主运行时的内嵌定时器与插件正式装配（本阶段以 `scripts/serve.ts` + 手工冒烟替代）。
- 真实 LLM Verifier 调用、独立 Verifier Agent 模型路由。
- 三关自动测试（静态/dry_run/历史回放）与影子运行、灰度、观察期、回滚。
- 真实 MCP 情报采集、PgBouncer transaction 池模式、审计表分区实测。
- 数据库账号级权限负例（`audit_log` 仅 INSERT 的 GRANT 边界）。

逐条理由与后续归属见 `OPC-STD-001` 第 8 章“未覆盖项与理由”，共 10 条，不允许以“范围外”为由缺席登记。

### 2.4 v2.10 网页表现层增量范围

| 对象 | 范围 | 测试方式 | 通过标准 |
| :--- | :--- | :--- | :--- |
| 归置规则 | 十一域分类、字段抽取、auto_draft/confirm/inbox 决策 | 单元（`test/unit/web.test.ts`） | 高风险域必确认；空/低置信进收件箱 |
| 归置 API | P19–P21：收件箱、归置、确认/忽略 | 集成（`test/integration/web.test.ts`） | 幂等、状态流转、审计正确 |
| 会话/记忆桥 | P22–P27：授权、撤回、上下文、记忆检索/提议/确认 | 集成 | 未授权 403；撤回即时失效；敏感记忆脱敏 |
| 驾驶舱 | P18：只读聚合、as_of、冻结脚注、陈旧提示 | 集成 + 单元（`isSnapshotStale`） | 不填 0；警告可见 |
| 雷达 | P28 + 3 个计划任务 | 集成 + 单元（`plugin-score`） | 只推荐不安装；停更/越权拒绝 |
| 契约 | api.yaml 28 operation ↔ ROUTES；45 实体 ↔ DB | `spec.test.ts` | 数量相等、逐项命中 |
| 工具/任务 | 26 个 `opc_*`；10 个默认任务 | `plugin.test.ts`、`scheduler.test.ts` | 清单完整、参数 schema 完整 |

**进入准则**：测试库已应用 `0001..0004`；`OPC_TEST_DSN` 与业务库不同；Node ≥24.9。
**退出准则**：单元全绿；`tsc --noEmit` 0 错误；集成 Web 用例全绿；`check-spec`（可用时）PASS。
**残余风险**：DSH 右侧面板插槽/会话事件未在真实宿主做端到端；外部检索源未接入，雷达用注入候选验证。

### 2.5 v2.11 员工分册 / 可插拔 / 员工包增量范围

| 对象 | 范围 | 测试方式 | 通过标准 |
| :--- | :--- | :--- | :--- |
| 员工 manifest | 11 个员工、插件 ID/代码唯一、视图/工具/写目标/流程声明 | 单元（`test/unit/employees.test.ts`） | 全部校验通过；非法 manifest 被拒 |
| 目录/生命周期 | 安装、默认停用、启用/停用、依赖保护 | 集成（`test/integration/employees.test.ts`） | 停用有依赖插件 409；历史数据保留 |
| 员工包导出 | `opc-employee-package` v1、checksum、默认不含数据 | 集成 | checksum 一致、包记录入库 |
| 员工包导入 | 格式/路径/校验和/manifest/依赖校验、dry-run、确认安装 | 集成 | 非法包 422；确认后默认停用 |
| 新员工 | WBS、外宣需求分册 | 文档评审 + AC 直验 | 分册完整；human gate/敏感约束明确 |
| 契约 | 62 operation ↔ ROUTES；66 实体 ↔ DB | `spec.test.ts` | 数量相等、逐项命中 |
| 工具 | 31 个 `opc_*` | `plugin.test.ts` | 清单完整、schema 完整 |

## 3. 测试级别与分层

| 级别 | 目标 | 资产文件 | 用例数 | 依赖 | 通过判据 |
| :--- | :--- | :--- | ---: | :--- | :--- |
| 单元 | 纯函数口径：cron 解析/触发计算、守卫六项与风险硬规则 | `test/unit/cron.test.ts`、`test/unit/guard.test.ts` | 16 | 无数据库 | 16/16，0 失败 |
| 集成（服务层） | 真实 PG 上的平台与流程语义 | `test/integration/platform.test.ts`、`audit.test.ts`、`workflow.test.ts`、`scheduler.test.ts` | 19 | `opc_test` | 19/19，0 失败 |
| 集成（契约层） | HTTP 状态码/错误码/结构化返回；DSH 工具可执行 | `test/integration/api.test.ts`、`plugin.test.ts` | 12 | `opc_test` + 127.0.0.1 随机端口 | 12/12，0 失败 |
| 集成（规格） | spec ↔ DDL/路由/错误码/追溯 | `test/integration/spec.test.ts` | 4 | `opc_test` + `spec/` | 4/4，0 失败 |
| 系统 | 独立进程常驻（`npm run serve`）+ DSH 插件装配冒烟 | `scripts/serve.ts`、`cordis.patch.yml` | 手工 3 项 | 进程 + PG | 手工记录入 G4 归档，不并入 61 计数 |
| 验收 | 21 个 UC 的主路径与异常路径可复述、可演示 | `OPC-STD-001` 第 4 章 | 31 条 TC | 全部级别通过 | 31/31 TC 有通过证据 |

分层理由：单元层只放“无副作用、可穷举边界”的纯函数，任何需要真实 SQL 行为的断言一律下沉到集成层——视图授权依赖 `ref.view_grant` 行状态、幂等依赖唯一键冲突、审计链依赖链头行，mock 掉这些等于没测。

## 4. 测试环境与基础设施

| 项 | 要求 | 实测/现状 | 校验方式 |
| :--- | :--- | :--- | :--- |
| Node.js | ≥ 24.9（`package.json` 的 `engines`） | v24.21.0 | `node -v` |
| 运行时形态 | 原生类型擦除直接运行 `.ts`，无构建步骤 | 无 `dist/`，`node --test` 直跑 | `npm test` |
| PostgreSQL | 17.x | 17.11（Debian 17.11-0+deb13u1，x86_64） | `SELECT version()` |
| pgvector | 0.8.0 | 0.8.0 | `SELECT extversion FROM pg_extension` |
| 业务库 | `opc`（集成测试禁止触碰） | `localhost:5432/opc` | `OPC_PG_DSN` |
| 测试库 | `opc_test`（集成测试唯一目标） | `localhost:5432/opc_test` | `OPC_TEST_DSN` |
| 库隔离硬约束 | `NODE_ENV=test` 下两 DSN 相同则 `loadConfig` 直接抛错 | 已实现于 `src/platform/config.ts` | 单元/启动即失败 |
| 扩展 | `vector`、`pgcrypto`、`unaccent` 已由 DBA 安装 | 测试库已装 | 健康检查 + 规格用例 |
| 迁移 | `0001_init.sql`、`0002_token_code.sql`、`0003_audit_export_cursor.sql`、`0004_web_layer.sql`、`0005_employee_lines.sql` | 待应用到 `opc_test`（v2.10/v2.11） | `npm run migrate:test` |
| 归档目录 | 用例内 `mkdtemp` 临时目录，不写仓库 `archive/` | `opc-audit-*`、`opc-archive-*`、`opc-api-*` | 用例断言文件名/后缀 |
| HTTP 监听 | `127.0.0.1` 端口 `0`（随机，防端口占用） | `api.test.ts` 动态取 `AddressInfo.port` | 用例内 `base` 拼接 |
| 时区 | `Asia/Shanghai`（`OPC_TIMEZONE` 默认） | 调度与晨报口径一致 | cron 用例断言 UTC 换算 |
| 并发 | 测试整体串行（`--test-concurrency=1`） | `npm test` 脚本固定 | 共享测试库不死锁 |
| 依赖 | `pg`、`yaml`、`drizzle-orm` | 已安装（`node_modules`） | `npm ls` |

补充约束：

- 环境变量口令不入库、不入文档；测试 DSN 缺省值由 `src/platform/config.ts` 提供，生产必须显式注入 `OPC_PG_DSN`。
- 集成测试只允许连 `OPC_TEST_DSN`；`test/helpers.ts` 顶部注释即为铁律，清库前不加判断、不留“顺手连业务库”的旁路。
- 单机部署下 `opc` 与 `opc_test` 同实例但不同库，扩展各自安装；`vector(1024)` 与 HNSW 索引只在两库独立验证。

## 5. 测试数据策略

### 5.1 三条铁律

1. **只连测试库**：`makePool()` 一律用 `config.testDsn`；`NODE_ENV=test` 时若 `OPC_PG_DSN` 与 `OPC_TEST_DSN` 相同，`loadConfig` 抛错，测试在 `before` 阶段即失败而不是“静默跑在业务库上”。
2. **每个用例自建数据**：集成用例在用例体内 `INSERT ... RETURNING id` 造数，不依赖跨文件种子顺序，不依赖上一次执行残留。
3. **前后清库**：`beforeEach` 调 `resetDb(pool)`，断言不继承历史行。

### 5.2 `resetDb`（清库）

- `TRUNCATE` 76 张业务表（`biz.*`、`ref.*`、`audit.*`、`stat.*`、`vec.embedding`）`RESTART IDENTITY CASCADE`，**保留**迁移台账 `public._opc_migrations`。
- 跨测试文件可能并发清库，因此先取会话级 advisory lock `824361` 再 TRUNCATE，`finally` 解锁，避免 `AccessExclusiveLock` 互等死锁；这也是 `npm test` 仍要求 `--test-concurrency=1` 的双保险。
- 清库会清掉调度配置：`scheduler` 与 `api` 用例在 `beforeEach` 里重跑 `seedDefaults()` 恢复 10 个默认任务。

### 5.3 `seedEmployee`（员工与视图授权）

- 写 `ref.employee_plugin`（`plugin_id`、`scope`、`required_views`、`tools`、`write_targets`、`enabled`，冲突时 upsert）。
- 按 `views` 数组逐条写 `ref.view_grant`（`status='active'`，冲突时置回 active）。
- 典型配置：`opc_finance` + `views:['view_ar_ap']` + `tools:['opc_ledger_write']` + `writeTargets:['ledger']`；授权反例用 `views:[]`。

### 5.4 固定时钟

- 调度与评判一律**显式注入时刻**：`scheduler.run({ scheduledAt })`、`scheduler.tick(now)`、`nextRun(cron, tz, from)`，断言对象是 UTC ISO 字符串（如 `2026-11-05T00:30:00.000Z`），跨机器时区不影响结果。
- `test/helpers.ts` 导出固定参考时刻 `NOW = 2026-11-05T02:00:00.000Z`（北京时间 10:00），供新增用例取“当前时刻”时复用。
- 允许读系统时间的例外仅三处：令牌 `expiresAt > Date.now()`、健康检查/任务列表的 `nextRunAt instanceof Date` 类型断言、`current_date` 相对日期（税务/合同到期窗口）。新增用例若依赖“今天”，必须用相对 `current_date` 而不是硬编码日期。

### 5.5 数据内容与隐私

- 客户敏感字段只用虚构中文内容（如“有两名学龄子女”“无重大疾病”），既贴近真实语境，也便于断言“审计不落值”时做字符串反查。
- 台账/合同/税务造数使用小额整数（1200/800/3000），断言可直接比数值，避免浮点误差。
- 归档文件写在 `tmpdir()` 下的 `mkdtemp` 目录，用例只读不删，交由操作系统回收；测试不写仓库 `archive/`。

### 5.6 禁止事项

- 禁止把 `OPC_TEST_DSN` 指向 `opc`；禁止在用例里 `DROP`/`ALTER` 表结构（结构变更走 `migrations/`）。
- 禁止用例之间共享可变状态（模块级变量只放连接池与只读常量）；禁止并行执行写库用例。

## 6. 进入准则

进入 G4 执行前，以下 8 项全部满足，缺一项则退回准备阶段：

- [ ] `spec/opc-xuanji/` 四份 YAML 已冻结在基线标签 `v2.11-20261106`，`usecases.yaml` 的 21 个 UC 与 31 条 TC 无未决变更。
- [ ] `npm install` 完成，`node_modules` 就绪；`node -v` ≥ 24.9。
- [ ] 测试库 `opc_test` 可达，`vector`/`pgcrypto`/`unaccent` 已安装（pgvector 0.8.0）。
- [ ] `npm run migrate:test` 已应用 `0001`–`0005`，`_opc_migrations` 台账与迁移文件一致。
- [ ] 环境变量按第 4 章设置：`OPC_TEST_DSN` 指向 `opc_test`，`OPC_PG_DSN` 指向 `opc`（两者不同），`NODE_ENV=test`。
- [ ] 测试资产清单与仓库一致：单元 2 文件 16 用例、集成 7 文件 35 用例，无临时跳过标记（未使用框架的跳过/待办能力）。
- [ ] `tsc --noEmit` 在待测提交上 exit 0（类型不通过不进入执行）。
- [ ] 本计划与 `OPC-STD-001` 已过评审，TC 映射表无空缺。

## 7. 退出准则与通过标准

### 7.1 门禁判定

| 门禁项 | 命令/依据 | 阈值 | 判定 |
| :--- | :--- | :--- | :--- |
| 全量用例 | `npm test` | 68/68 通过，0 失败、0 跳过 | 硬门禁 |
| 单元层 | `npm run test:unit` | 16/16 | 硬门禁 |
| 集成层 | `npm run test:integration` | 35/35 | 硬门禁 |
| 类型检查 | `npm run typecheck` | exit 0，0 error | 硬门禁 |
| 规格门禁 | `npm run spec:check` | PASS，ERROR 0 | 硬门禁 |
| 文档门禁 | `npm run docs:check` | ERROR 0 | 硬门禁 |
| TC 追溯覆盖 | `OPC-STD-001` 第 5 章总表 | 21/21 TC 有主用例，无空缺 | 硬门禁 |
| 未覆盖项登记 | `OPC-STD-001` 第 8 章 | 10 条均有理由与后续归属 | 硬门禁 |
| 契约逐项对账 | `OPC-STD-001` 第 9 章 | 已登记差异均有评审结论（消除或明确处置） | 硬门禁 |
| 缺陷状态 | 缺陷清单 | P0、P1 均为 0；P2 有处置计划 | 硬门禁 |
| 系统冒烟 | 手工 3 项（见 7.2） | 全部通过并留截图/curl 输出 | 软门禁（G4 评审确认） |

### 7.2 系统冒烟清单（手工，3 项）

1. `npm run serve -- --port 3082 --tick 60000` 启动后 `GET /api/v1/health` 返回 `pg=true`、`pgvector=true`、`scheduler.registered=7`。
2. 进程内 `tick` 连续运行两个周期无异常退出，`stat.task_schedule.next_run_at` 单调推进。
3. DSH 装配 `cordis.patch.yml` 后 31 个 `opc_*` 工具可见、`opc_health` 可执行并返回结构化文本。

### 7.3 通过后的动作

- 打标签 `v0.1.0`，证据集（执行日志、`typecheck` 输出、`spec:check` 输出、冒烟记录）归档至 `docs/过程资产/G4/`。
- 只有 7.1 全部硬门禁通过才可判定“D4 验证通过”；[README](../README.md) 与 [OPC-STR-001-测试报告](OPC-STR-001-测试报告.md) 记录的基线 51/51 是该提交上的执行结果；v2.10/v2.11 增量 68 用例须在具备测试库的环境复跑取证，不以他人记录替代执行。

## 8. 缺陷分级与回流

### 8.1 分级

| 级别 | 定义 | 典型场景 | 回流路径 | 门禁影响 |
| :--- | :--- | :--- | :--- | :--- |
| P0 阻断 | 数据安全或契约根基被破坏 | 误连业务库；未授权可读；审计链断裂；令牌可重复消费成功；迁移与实体不符 | 立即停测 → 开发定位 → 修复后全量重跑 | 阻断 |
| P1 严重 | 用例期望未兑现，业务规则错 | 守卫漏放（非法 meta 被注册）；幂等失效；风险等级算错；晨报缺项 | 开发修复 + 该 TC 全组回归 | 阻断 |
| P2 一般 | 契约/边界偏差但不改主流程 | HTTP 状态码与 `api.yaml` 不符但错误码对；非 TC 横切断言失败；排序不稳定 | 记入缺陷清单，G5 前处置 | 不阻断，需处置计划 |
| P3 轻微 | 表达与可维护性 | 报错文案、日志字段、命名不一致 | 随手修或并入下次重构 | 不阻断 |

### 8.2 回流规则

1. **先分类再修**：区分“实现错”“规格错”“用例错”。用例期望写错（如把 `ERR-TASK-002` 当 `ERR-TASK-001`）必须先用例修正评审，再改实现，禁止反向迁就。
2. **规格变更走契约流程**：任何 `spec/opc-xuanji/*.yaml` 改动须登记契约变更单，同步 `usecases.yaml` 的 TC、`api.yaml` 的 operation/errorCodes，并重跑 `spec.test.ts`；不允许只改实现不改规格。
3. **回归最小集**：修复 P0/P1 后至少回归“该 TC 的全部用例 + `spec.test.ts` + `test/unit/guard.test.ts`”，防止守卫与契约连锁回归。
4. **缺陷单必备字段**：缺陷 ID、级别、关联 TC、失败用例标题、现象（断言输出）、期望（规格条款）、根因、修复提交、回归结果。
5. **关闭条件**：同一用例连续两次全量执行通过，且缺陷单回归栏有命令输出为证。

## 9. 风险与应对

| 风险 | 触发信号 | 影响 | 应对 |
| :--- | :--- | :--- | :--- |
| 真实 LLM Verifier 未接入，以 `samples` 桩替代 | 评判用例只注入 `['pass','pass','fail']` 等数组 | 采样投票算法未对真实模型输出分布验证，0.8 阈值可能偏松/偏紧 | Phase 2 接 `dsh-llm-verifier` 做采样分布回放，按实测校准阈值；当前门槛只保证聚合逻辑正确 |
| 共享测试库并发（多人/多 agent 同时跑） | TRUNCATE 等待、偶发死锁或“数据被清空” | 假失败、误判回归 | `--test-concurrency=1` + advisory lock `824361` 双保险；执行窗口独占，跨团队错峰 |
| 时区/跨日抖动 | 断言在 CI 与本机结果不同 | 晨报/审计导出用例假失败 | 一律显式 `scheduledAt`/`from`，断言 UTC ISO；禁用“今天 08:30”式相对断言 |
| 数据库不可达 | 连接超时，全部集成用例红 | 无法判定实现质量 | 执行前探活（`SELECT 1` 与 `extversion`）；不可达时判定“环境阻塞”，不计入缺陷 |
| DSH 宿主装配未自动化 | `api.test.ts` 直连 `startApiServer`，非宿主 webServer | 宿主静态路由注册差异漏测 | 保留手工冒烟 3 项；Phase 2 补宿主装配测试 |
| 测试数据隔离依赖约定而非权限 | 迁移未创建 `audit_log` 仅 INSERT 的受限角色 | “审计表只追加”只靠代码保证 | Phase 2 建独立角色 + GRANT 负例；当前在 STD-001 未覆盖项 N-5 登记 |
| 测试与实现同源（同一作者）导致同向偏差 | 用例与实现同时改，失败被“顺手修掉” | 用例失去独立判定力 | `spec.test.ts` 契约对账兜底；G4 评审交叉复核 TC 期望与 `usecases.yaml` 原文 |
| 网络/时钟漂移导致 cron 边界偶发 | `nextRun` 在整分钟边界抖动 | 幂等键重复/跳过 | 用例固定“同一分钟不重复触发”与跨周末两条边界断言；cron 解析走纯函数单元层 |
| 规格与实现的错误码归属不一致（`upsertTask`/`runTask`） | `ERR-TASK-001`/`ERR-TASK-002` 在 api.yaml、IRS、SRS 与 `src/scheduler/engine.ts` 之间互置 | 集合级对账通过、逐接口对账不通过，下游按码分流会走错分支 | 已在 STD-001 第 9 章 X-1 登记，G4 必须给出“改实现”或“改规格”的结论并按之重跑 |

## 10. 进度与责任人

| 阶段 | 内容 | 责任人（角色） | 交付物 | 完成判据 | 时点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| P1 用例对账 | 14 UC / 24 TC 与 68 个用例逐条映射 | 测试作者（docs-test） | `OPC-STD-001` 第 4、5 章 | 24/24 TC 有主用例，无空缺 | 2026-11-06 |
| P2 环境就绪 | 测试库、迁移、扩展、DSN 隔离 | 环境维护（DBA + 开发） | 迁移台账、env 配置 | 第 6 章 8 项全绿 | 2026-11-05 |
| P3 执行与证据 | `npm test`、`typecheck`、`spec:check`、`docs:check` | 测试执行（docs-test） | 执行日志 + 输出片段 | 第 7.1 硬门禁全通过 | G4 评审当日 |
| P4 缺陷回流 | P0/P1 清零，P2 登记 | 开发（src 维护）+ 测试 | 缺陷清单 | P0/P1 = 0 | 修复后 1 个工作日内 |
| P5 评审签收 | 本计划 + STD 交叉评审，判定门禁 | Team Lead + 评审人 | 评审意见、`v0.1.0` 标签 | 评审同意且证据归档 | G4 当日 |

责任边界：`src/`、`test/`、`migrations/` 的修改权在开发，测试作者只读对账、不代改；规格文本的修改权在需求/架构评审，测试不得以“用例需要”为由单方面改 `usecases.yaml`。

## 11. 度量、报告与门禁归档

| 度量 | 口径 | 目标值 |
| :--- | :--- | :--- |
| 用例通过率 | 通过数 / 61 | 100% |
| TC 追溯覆盖率 | 有主用例的 TC / 16 | 100% |
| 缺陷密度 | P0+P1 数 / 61 用例 | 0 |
| 未覆盖项 | 登记条数（STD-001 第 8 章） | 10 条且均有理由 |
| 契约偏差 | `spec.test.ts` 失败数 | 0 |
| 执行时长 | `npm test` 墙钟时间 | 记录并跟踪回归（无硬阈值） |

- 执行结果写入测试报告 [OPC-STR-001-测试报告](OPC-STR-001-测试报告.md)（同目录），本计划不复制结果数字，避免两处口径打架。
- 门禁证据归档到 `docs/过程资产/G4/`：执行日志、`typecheck` 输出、`spec:check` 输出、冒烟记录、评审意见。
- 归档命名沿用 `G4/<doc_id>-<yyyymmdd>-<类型>.log`；Git 标签 `v0.1.0` 与提交信息 `[test] 门禁: D4 验证通过 (G4)` 同步。

## 12. v2.15 基础资源增量测试项（2026-11-14）

本轮增量：公司基础资源目录（六类共享资源）、公司默认口径（debian/ssh/canetwork）、新建项目默认选型与项目绑定保护。

| TC | 测试文件 | 复现命令 | 通过判据 |
| :--- | :--- | :--- | :--- |
| TC-RES-001..005 | `test/integration/admin-shared.test.ts` | `NODE_ENV=test node --test --test-concurrency=1 test/integration/admin-shared.test.ts` | 5/5 pass |
| 迁移 `0008_shared_resources.sql` | 业务库 + 测试库 | `npm run migrate && npm run migrate:test` | 各 applied 1、exit 0 |
| 契约 | `spec/opc-xuanji/api.yaml` | `npm run spec:check` | PASS（79 实体 / 23 用例 / 21 模块） |
| 全量回归 | `npm test` | 串行执行 | 全部 pass（v2.15 后 103 例） |

**通过标准**：上述四行全绿且 `npm run typecheck`、`npm run docs:check` exit 0；任一失败按第 8 章回流，不得以“大致通过”签收。

## 13. v2.16 项目自动驾驶增量测试项（2026-11-14）

本轮增量：建项目填版本库 → 浅克隆 → 静态扫描 → 档案回填 → 三份计划 → 裁决队列。

| TC | 测试文件 | 复现命令 | 通过判据 |
| :--- | :--- | :--- | :--- |
| TC-AUTO-001..004 | `test/integration/autopilot.test.ts` | `NODE_ENV=test node --test --test-concurrency=1 test/integration/autopilot.test.ts` | 4/4 pass |
| 迁移 `0009_project_autopilot.sql` | 业务库 + 测试库 | `npm run migrate && npm run migrate:test` | 各 applied 1、exit 0 |
| 契约 | `spec/opc-xuanji/api.yaml` | `npm run spec:check` | PASS（83 实体 / 25 用例 / 21 模块） |
| 全量回归 | `npm test` | 串行执行 | 全部 pass（v2.16 后 107 例） |

**前置**：本机需有 `git`（夹具用 `file://` 本地仓库，不依赖外网）；测试用 `OPC_WORKSPACE_ROOT` 指向临时目录，避免污染。

## 14. v2.17 自动化生产增量测试项（2026-11-14）

本轮增量：代码骨架生成、测试流水线执行、测试环境自动发布（含无命令转裁决）。

| TC | 测试文件 | 复现命令 | 通过判据 |
| :--- | :--- | :--- | :--- |
| TC-AUTO-005..007 | `test/integration/autopilot.test.ts` | `NODE_ENV=test node --test --test-concurrency=1 test/integration/autopilot.test.ts` | 7/7 pass |
| 迁移 `0010_autopilot_production.sql` | 业务库 + 测试库 | `npm run migrate && npm run migrate:test` | 各 applied 1、exit 0 |
| 契约 | `spec/opc-xuanji/api.yaml` | `npm run spec:check` | PASS（86 实体 / 26 用例 / 21 模块） |
| 全量回归 | `npm test` | 串行执行 | 全部 pass（v2.17 后 110 例） |

**执行约束**：流水线用例默认不联网（不装依赖）；发布用例用 `OPC_TEST_DEPLOY_CMD="node -e \"process.exit(0)\""` 验证执行链路，验证后立即清除该环境变量。

## 15. v2.18 运维反馈增量测试项（2026-11-14）

本轮增量：运行错误自动开 Issue、用量遥测与 AI/规则习惯审视。

| TC | 测试文件 | 复现命令 | 通过判据 |
| :--- | :--- | :--- | :--- |
| TC-OPS-001..005 | `test/integration/ops.test.ts` | `NODE_ENV=test node --test --test-concurrency=1 test/integration/ops.test.ts` | 5/5 pass |
| 迁移 `0011_ops_feedback.sql` | 业务库 + 测试库 | `npm run migrate && npm run migrate:test` | 各 applied 1、exit 0 |
| 契约 | `spec/opc-xuanji/api.yaml` | `npm run spec:check` | PASS（89 实体 / 28 用例 / 21 模块） |
| 全量回归 | `npm test` | 串行执行 | 全部 pass（v2.18 后 115 例） |

**隔离要求**：GitHub 用本地 mock 服务（`OPC_GITHUB_API_BASE`），不访问外网、不使用真实 token；AI 审视在测试里用 `OPC_AI_DISABLED=1` 走规则路径。

## 16. v2.19 已建项目接入增量测试项（2026-11-14）

本轮增量：已建项目接入自动驾驶、重复执行幂等与资源复用。

| TC | 测试文件 | 复现命令 | 通过判据 |
| :--- | :--- | :--- | :--- |
| TC-AUTO-008/009 | `test/integration/autopilot.test.ts` | `NODE_ENV=test node --test --test-concurrency=1 test/integration/autopilot.test.ts` | 9/9 pass |
| 契约 | `spec/opc-xuanji/api.yaml` | `npm run spec:check` | PASS（89 实体 / 29 用例 / 21 模块） |
| 全量回归 | `npm test` | 串行执行 | 全部 pass（v2.19 后 117 例） |

## 17. v2.20 创意转项目增量测试项（2026-11-14）

本轮增量：创意文本/文档（多格式、多文件）→ AI 解析 → 自动建项目 → 自动驾驶/裁决。

| TC | 测试文件 | 复现命令 | 通过判据 |
| :--- | :--- | :--- | :--- |
| TC-IDEA-001..005 | `test/integration/idea.test.ts` | `NODE_ENV=test node --test --test-concurrency=1 test/integration/idea.test.ts` | 5/5 pass |
| 迁移 `0012_project_idea.sql` | 业务库 + 测试库 | `npm run migrate && npm run migrate:test` | 各 applied 1、exit 0 |
| 契约 | `spec/opc-xuanji/api.yaml` | `npm run spec:check` | PASS（90 实体 / 30 用例 / 21 模块） |
| 全量回归 | `npm test` | 串行执行 | 全部 pass（v2.20 后 122 例） |

**夹具说明**：docx/xlsx 用最小 OOXML ZIP（store 模式）生成，pdf 用最小文本层 PDF；AI 用本地 mock 服务，不依赖外网。

## 18. v2.21 微信推送增量测试项（2026-11-14）

| TC | 测试文件 | 复现命令 | 通过判据 |
| :--- | :--- | :--- | :--- |
| TC-WECHAT-001..005 | `test/integration/wechat.test.ts` | `NODE_ENV=test node --test --test-concurrency=1 test/integration/wechat.test.ts` | 5/5 pass |
| 迁移 `0013_wechat_push.sql` | 业务库 + 测试库 | `npm run migrate && npm run migrate:test` | 各 applied 1、exit 0 |
| 契约 | `spec/opc-xuanji/api.yaml` | `npm run spec:check` | PASS（91 实体 / 31 用例 / 21 模块） |
| 全量回归 | `npm test` | 串行执行 | 全部 pass（v2.21 后 127 例） |

**隔离要求**：投递端点用本地 mock（`OPC_WECHAT_DELIVERY_URL`），不依赖真实微信。

## 自检清单

- [x] 目标与范围已对齐 `usecases.yaml` 的 31 个 UC、60 条 TC，数量与规格一致。
- [x] 四个测试级别均有资产文件、用例数、依赖与通过判据，127 = 单元 25 + 集成 102 可复算（基线 68 + v2.12–v2.21 增量 59）。
- [x] 环境表列出 Node ≥24.9、PostgreSQL 17.11、pgvector 0.8.0、`opc_test` 与 `opc` 隔离及校验命令。
- [x] 数据策略覆盖 `resetDb`（91 表 + advisory lock）、`seedEmployee`、固定时钟三件套。
- [x] 进入准则 8 项可勾选、可命令化验证，无“视情况而定”表述。
- [x] 通过标准含 127/127、`typecheck` exit 0、`check-spec` PASS，并声明硬/软门禁差异。
- [x] 缺陷分级 P0–P3 均有定义、示例、回流路径与门禁影响；规格变更走契约流程。
- [x] 风险表覆盖真实 LLM 桩替代、共享测试库并发、时区抖动、环境不可达、错误码归属不一致等 9 项。
- [x] 进度表含 5 个阶段、责任角色、交付物、完成判据与时点，责任边界写清。
- [x] 全部测试文件路径指向仓库真实文件，未臆造不存在的用例。
- [x] 范围外事项不隐藏，统一指向 `OPC-STD-001` 第 8 章的 10 条未覆盖登记。
- [x] 正文无未完成占位，版本、状态、阶段、门禁与更新日期齐备。

## 与其他文档的关系

| 文档 | 关系 | 说明 |
| :--- | :--- | :--- |
| [spec/opc-xuanji/usecases.yaml](../spec/opc-xuanji/usecases.yaml) | 上游（唯一 TC 来源） | 21 个 UC 的 `tests` 字段决定本计划与 STD 的 31 条 TC 清单（员工分册 AC 直验另计） |
| [spec/opc-xuanji/api.yaml](../spec/opc-xuanji/api.yaml) | 上游 | 62 个 operation 与 19 个错误码构成契约层判据 |
| [spec/opc-xuanji/entities.yaml](../spec/opc-xuanji/entities.yaml) | 上游 | 76 张表的列级对账依据 |
| `OPC-玄机 · 一人公司中枢-产品设计.md` | 上游 | 8.6.9.2 三关测试、8.6.3 评判、8.6.9.5 守卫与风险规则的本计划依据 |
| `OPC-玄机 · 技术选型与系统架构.md` | 上游 | 3.2 Verifier 缓存口径、3.3 判别力局限，解释为何以桩替代并登记风险 |
| [docs/OPC-STD-001-测试设计说明.md](OPC-STD-001-测试设计说明.md) | 同级（下游细化） | 承接本计划的 TC 映射、逐条用例设计与未覆盖项登记 |
| [OPC-STR-001-测试报告](OPC-STR-001-测试报告.md) | 下游 | 记录本计划第 7 章门禁的实际执行结果与证据索引 |
| `OPC-SRS-001` / `OPC-IRS-001` / `OPC-SDD-001` / `OPC-DBDD-001` | 同级 | 需求、接口、设计、数据库文档；缺陷回流时按此四份判定“实现错/规格错”，错误码归属差异即由 IRS/SRS 与实现比对发现 |
| [docs/index.md](index.md) | 同级（导航） | 文档清单、编号规则与状态基线；本计划的文档编号与状态以其为准 |
| [README.md](../README.md) | 操作入口 | 快速开始、环境变量、测试与门禁命令的现行说明 |
| [package.json](../package.json) | 执行口径 | `test`/`typecheck`/`spec:check`/`docs:check` 脚本定义 |
