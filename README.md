# OPC-玄机 · 一人公司中枢

![CI](https://github.com/mindtheory/opc-xuanji/actions/workflows/ci.yml/badge.svg)
![Release](https://img.shields.io/github/v/release/mindtheory/opc-xuanji)
![License](https://img.shields.io/badge/license-proprietary-lightgrey)

运行在 **DeepSeek Harness（DSH ≥ 0.2.1）** 上的 Bundle 插件：以「中枢调度 + 专业员工矩阵 + 三级沉淀 + TS 流程固化」补全一人公司在财税、法务、行政、战略、项目、情报、客户、车务、进销存上的职能短板，并把**公司日常经营中需要定期执行的事**做成配置驱动的自动化任务。

- 上游设计：《OPC-玄机 · 一人公司中枢-产品设计.md》v2.12、《OPC-玄机 · 技术选型与系统架构.md》v2.12（与本仓库同目录）、《OPC-SDD-003 Super Agent 应用层设计》（应用层定位）
- 交付形态：TypeScript 服务层（Node ≥ 24.9，原生类型擦除直接运行 `.ts`）+ DSH cordis 插件入口（36 个 `opc_*` 工具）+ HTTP `/api/v1` 契约（38 个 operation）+ PostgreSQL 17 / pgvector 数据层
- 应用层依赖：**[mindtheory/dsh-super-agents](https://github.com/mindtheory/dsh-super-agents)**（软依赖，同 profile 安装即得员工超级智能体：部署/派活/回流/健康；未装则 agent 类工具降级，其余功能不受影响）
- 当前阶段：**v0.1.0 已发布**。CI 在 Node 24.9/24/26 上单元与门禁全绿；PostgreSQL 17 + pgvector 集成 **68/68** 通过。本地跑集成仍需 `OPC_TEST_DSN`。

## 目录结构

```
opc-xuanji/
├── OPC-玄机 · 一人公司中枢-产品设计.md      # 上游设计（v2.10，已同步 Web 需求）
├── OPC-玄机 · 技术选型与系统架构.md          # 上游设计（v2.10，已同步 Web 架构）
├── spec/opc-xuanji/                          # 工程规格包（契约冻结，G1/G2）
│   ├── entities.yaml  api.yaml  modules.yaml  usecases.yaml
├── migrations/                               # 只追加的 SQL 迁移链
│   ├── 0001_init.sql  0002_token_code.sql  0003_audit_export_cursor.sql  0004_web_layer.sql  0005_employee_lines.sql
├── src/
│   ├── platform/    # 中枢平台：config/env/errors/views/token/conflict/json
│   ├── audit/       # 审计统一写入口：哈希链、JSONL 导出、链头
│   ├── workflow/    # 流程：guard/registry/instances/verifier/diagnose
│   ├── scheduler/   # 自动化：cron/engine/tasks
│   ├── web/         # 网页表现层：归置/会话/记忆/驾驶舱/雷达
│   ├── employees/   # 员工 manifest、目录、员工包导入导出
│   ├── agents/      # Super Agent 应用层：桥（依赖 dsh-super-agents）、部署/派活/回流
│   ├── api/         # HTTP /api/v1 契约层
│   ├── plugin/      # DSH cordis 插件入口（36 个工具）
│   └── db/          # 连接池与迁移执行器
├── scripts/         # gen-spec / migrate / serve
├── test/            # 单元 25 + 集成 43（新增 Web/员工用例需测试库）
├── docs/员工需求/   # 11 个员工需求分册（一人一份）
├── docs/            # 软件工程文档（SRS/IRS/SDD/DBDD/SDP/SCMP/SQAP/RMP/RTM/SVD/STP/STD/STR + UML + PA）
├── AGENTS.md        # 主会话 Agent 运行章程（幕僚长/COO 行为约定）
└── cordis.patch.yml # DSH bundle 装配
```

## 快速开始

前置：Node ≥ 24.9；可访问的 PostgreSQL 17（本地或私有部署），目标库已由 DBA 安装 `vector` 扩展（0.8.0）。

```bash
npm install
cp .env.example .env      # 填入 OPC_PG_DSN / OPC_TEST_DSN（仓库不保存口令）

# 1) 建库（DBA/超级用户执行一次）
#    CREATE ROLE opc LOGIN PASSWORD '<set-a-strong-password>';
#    CREATE DATABASE opc      OWNER opc;
#    CREATE DATABASE opc_test OWNER opc;          -- 集成测试专用，禁止指向业务库
#    \c opc      CREATE EXTENSION IF NOT EXISTS vector, pgcrypto, unaccent;
#    \c opc_test CREATE EXTENSION IF NOT EXISTS vector, pgcrypto, unaccent;

# 2) 迁移（业务库 / 测试库）
npm run migrate
npm run migrate:test

# 3) 全量测试（单元 + 集成，串行执行避免共享测试库死锁）
npm test

# 4) 类型检查 / 规格门禁
npm run typecheck
npm run spec:check
npm run docs:check

# 5) 独立 API + 调度进程（headless 常驻）
npm run serve -- --port 3082 --tick 60000
curl -s http://127.0.0.1:3082/api/v1/health | head
```

## 配置项（环境变量）

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `OPC_PG_DSN` | 无（必填） | 业务库连接串，见 `.env.example`；仓库不保存口令 |
| `OPC_TEST_DSN` | 无（必填） | 集成测试库；`NODE_ENV=test` 下与业务库相同会直接拒绝启动 |
| `OPC_ARCHIVE_DIR` | `<repo>/archive` | 审计归档根目录（`audit/YYYY/MM/audit-*.jsonl`） |
| `OPC_TIMEZONE` | `Asia/Shanghai` | 调度默认时区 |
| `OPC_SCHEMA_VERSION` | `1` | 审计归档 `schema_version`（可迁移性） |
| `OPC_TEST_DSN` / `dsn` 插件配置 | — | DSH 装配时由 `cordis.patch.yml` 传入 |

## 架构摘要

| 层 | 承担者 | 关键实现 |
| :--- | :--- | :--- |
| 中枢（Service） | `src/platform`、`src/workflow` | 视图级授权（8 个视图）、一次性令牌（≤5 分钟、单次）、冲突冻结与裁决、审计哈希链、Registry 六项准入守卫、风险硬规则、Verifier 封装、诊断 |
| 员工（Subagent / 函数） | `ref.employee_plugin` + 工具注册 | 员工不直连库：读经视图、写经中枢、审计统一入口；`write_targets` 决定风险等级 |
| 流程（TS 固化） | `ref.workflow_registry` + `audit.workflow_*` | 版本不可变、代码哈希与测试哈希一致、幂等键 `instance_id + node_id`、三关测试与影子运行在 Phase 2 接 `dsh-workflow-ptc` |
| 数据（共享层） | `biz/ref/audit/stat/vec` | 54 张表（37 基线 + 8 Web + 9 员工线）；审计 `(id, created_at)` 复合主键为分区预留；pgvector HNSW `m=16, ef_construction=64` |

### HTTP 契约（`/api/v1`）

`health`、`views/{viewId}/query`、`tokens`、`tokens/{id}/consume`、`conflicts`、`conflicts/{id}/resolve`、`workflows`、`workflows/{id}/instances`、`instances/{id}/nodes/{nodeId}/complete`、`instances/{id}/nodes/{nodeId}/verdict`、`audits`、`audits/export`、`tasks`、`tasks/{id}`、`tasks/{id}/run`、`reports/daily`，Web 表现层 `web/manifest`、`web/dashboard`、`web/inbox`、`web/ingest`、`web/ingest/{id}/confirm`、`web/sessions/{id}/grant`、`web/sessions/{id}/context`、`web/memory/search`、`web/memory/propose`、`web/memory/proposals/{id}/confirm`、`web/radar`，员工 `employees`、`employees/{id}`、`employees/{id}/toggle`、`employees/{id}/export`、`employees/import`，以及 Super Agent `agents/health`、`agents/deploy`、`agents/dispatch`、`agents/pause`。完整定义见 [spec/opc-xuanji/api.yaml](spec/opc-xuanji/api.yaml)。

### Web 界面（DSH 插件栏「OPC驾驶舱」）

浏览器半 `client.js` 向宿主注册左栏入口 **OPC驾驶舱**（`sidebar.panellist`，order 27，紧邻「超级智能体」）与主面板（`main`），只读展示：

- 健康条：PostgreSQL、pgvector 版本、调度任务（启用/注册）、员工智能体（可达/暂停/队列/运行中）
- 范围快照：今日 / 7 天 / 30 天 / 90 天，按 group 渲染驾驶舱指标 + 冻结事件脚注 + as-of/陈旧标记
- 待归置（收件箱）、定时任务（含下次触发）、插件与关键词雷达

面板数据全部来自宿主侧 `/api/v1/*`（驾驶舱聚合、收件箱、任务、雷达），自身不写库、不派活；30 秒自动刷新，失败显示错误条不清空旧数据。注册模式与 dsh-super-agents 一致（`window.__ModuleLoader__.load` + `ctx.slots.inject/register`）。

### DSH 工具（`opc_*`）

36 个：基线 16 个 + Web 10 个（`opc_web_*`）+ 员工目录/员工包 5 个（`opc_employee_list`、`opc_employee_install`、`opc_employee_toggle`、`opc_employee_export`、`opc_employee_import`）+ Super Agent 5 个（`opc_agent_deploy`、`opc_agent_dispatch`、`opc_agent_result`、`opc_agent_health`、`opc_agent_pause`）。

插件装配（DSH profile 的 `cordis.patch.yml`）：

```yaml
- insert:
    - id: opc-xuanji
      name: 'opc-xuanji'
      config:
        dsn: 'postgresql://<user>:<password>@localhost:5432/opc'
        timezone: 'Asia/Shanghai'
        enableScheduler: true
        # superAgentsUrl: 'http://127.0.0.1:3081'   # dsh-super-agents 面板地址（默认即此值）
```

## 定时自动化任务（配置驱动，可增删改）

任务定义在 `src/scheduler/tasks/index.ts`，调度配置存 `stat.task_schedule`，老板可用 `opc_task_upsert` 或 `PUT /api/v1/tasks/{taskId}` 修改 cron / 时区 / 参数：

| 任务 ID | 默认 cron（Asia/Shanghai） | 内容 |
| :--- | :--- | :--- |
| `daily_report` | `30 8 * * 1-5` | 晨报：税务预警、合同到期、待裁决冲突、近 7 天升级人工统计 |
| `tax_reminder` | `0 9 * * *` | 申报截止 ≤7 天提醒 |
| `contract_expiry` | `0 9 * * *` | 合同到期 ≤30 天提醒 |
| `invoice_backlog` | `0 10 * * 5` | 缺票入库积压（阈值可配 `invoiceBacklogThreshold`） |
| `conflict_escalation` | `0 * * * *` | 冲突 >7 天每日提醒、>30 天进月报口径 |
| `audit_export` | `0 2 * * *` | 审计增量导出 JSONL + SHA-256 + 链头 |
| `monthly_archive` | `0 3 1 * *` | 月度归档并通知 |
| `dashboard_refresh` | `*/15 * * * *` | 驾驶舱读模型刷新；失败保留上次快照并标注陈旧 |
| `plugin_radar_scan` | `0 6 * * 1` | 检索适用 DSH 插件并写雷达；只推荐不自动安装 |
| `keyword_radar_scan` | `0 7 * * *` | 公司发展关键词检索；未配置检索源时标注“本次未检索” |

执行幂等：`(task_id, scheduled_at)` 唯一；`force=true` 以毫秒级新计划时间重跑且保留历史。失败写 `task_run.status=failed` + 即时告警通知 + 审计。

## 测试与门禁

```bash
npm test          # 68 用例：单元 25 + 集成 43（本地需 OPC_TEST_DSN；CI 已全绿）
npm run typecheck # tsc --noEmit，0 错误
npm run spec:check# check-spec：PASS（ERROR 0）
npm run docs:check# check-docs：frontmatter/文末两节/编号
```

测试全部打在真实 PostgreSQL（`opc_test`）上，不依赖 mock 数据库；用例定义、期望与追溯见 [docs/OPC-STD-001-测试设计说明.md](docs/OPC-STD-001-测试设计说明.md)，最新结果见 [docs/OPC-STR-001-测试报告.md](docs/OPC-STR-001-测试报告.md)。

## 已知边界与 Phase 2

1. **Workflow 执行引擎**：Phase 1 由 `WorkflowRunner` 提供实例/幂等/评判原语；真实 `WorkflowStartRequest` 的 `AbortSignal.timeout(300_000)` 绑定与三关自动测试（静态/dry_run/历史回放）在 Phase 2 接 `dsh-workflow-ptc` 时落地。
2. **Verifier 模型调用**：`Verifier` 已实现采样投票/置信度/evidence 去重/升级人工，但真实 `dsh-llm-verifier` 调用与独立 Verifier Agent 模型路由属 Phase 2。
3. **DSH 内嵌路由**：插件只注册静态 `/api/v1` 路径；带路径参数的动态路由由 `scripts/serve.ts` 独立进程提供（DSH `webServer` 的 exact 路由不解析路径参数）。
4. **MCP 情报采集**：情报官的 MCP 数据源未接入，`biz.lead`/`biz.dd_report` 只提供数据模型与覆盖度声明字段。
5. **PgBouncer**：单机部署可直连；启用 transaction 池时，`SET LOCAL` 类查询须走事务内或直连通道（见架构文档 2.4）。
6. **Web 宿主插槽**：`opc_web` 已实现服务层/HTTP/DSH 工具；真实 DSH 右侧面板插槽、会话事件与 `WebHostAdapter` 仍需按宿主实际契约做端到端验证。
7. **外部检索源**：插件雷达/关键词雷达已实现候选评分、硬过滤与入库；真实 DSH 插件市场/MCP 检索适配器未接入，未配置时任务明确标注“本次未检索”。
8. **员工包**：manifest/包校验、dry-run、导入默认停用已实现；包内流程文件目前为空（manifest-only），签名验签与真实 DSH 运行时安装/卸载待接入。

## 项目治理与发布

| 文档 | 用途 |
| :--- | :--- |
| [AGENTS.md](AGENTS.md) | 主会话 Agent 运行章程：五个主动、汇报节奏、裁决卡规范 |
| [OPC-SDD-002 主会话 Agent 设定](docs/OPC-SDD-002-主会话Agent设定与运行设计.md) | Agent 人格、工作循环、验收 AC-AGT-01..10 |
| [OPC-SDP-001 软件开发计划](docs/OPC-SDP-001-软件开发计划.md) | 目标、WBS、G0–G6、里程碑、变更控制 |
| [OPC-SCMP-001 配置管理计划](docs/OPC-SCMP-001-配置管理计划.md) | 配置项、基线、变更、备份、审计 |
| [OPC-SQAP-001 质量保证计划](docs/OPC-SQAP-001-软件质量保证计划.md) | 质量目标、评审、度量、不符合项 |
| [OPC-RMP-001 风险管理计划](docs/OPC-RMP-001-风险管理计划.md) | 风险登记、评分、应对与兜底 |
| [OPC-RTM-001 需求追踪矩阵](docs/OPC-RTM-001-需求追踪矩阵.md) | 需求→用例→接口→代码→测试追踪 |
| [OPC-SVD-001 版本说明](docs/OPC-SVD-001-软件版本说明.md) | v0.1.0 内容、安装、兼容与已知限制 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录（Keep a Changelog / SemVer） |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 分支、提交、spec→docs→code→tests 流程与 PR 检查 |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | 社区行为准则 |
| [SECURITY.md](SECURITY.md) | 漏洞私密报告与安全边界 |
| [SUPPORT.md](SUPPORT.md) | 文档入口与提问方式 |
| [docs/releases/](docs/releases/) | 发布说明与发布流程 |
| [LICENSE](LICENSE) | 专有许可（All rights reserved） |

当前版本：`0.1.0`。发布流程见 [docs/releases/README.md](docs/releases/README.md)；发布说明见 [docs/releases/v0.1.0.md](docs/releases/v0.1.0.md)；发布与 CI 证据见 [PA-OPC-016](docs/过程资产/PA-OPC-016-v0.1.0发布证据.md)。

## 版本库

- 仓库：Git `main` 分支，发布标签 `v0.1.0`。
- 提交信息格式：`[模块] 动词: 说明 (需求/缺陷ID)`；发布时打 `v<semver>` 标签。
- `.gitignore` 已排除 `node_modules`、`.env*`、`archive`、`coverage`、`*.log`、`tags/`。
