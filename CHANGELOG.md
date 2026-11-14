# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **SVN 版本库支持（v2.22）**：`OPC-SRS-105` 新增 REQ-PRJ-036（SVN 版本库检出，公司主用版本库）；自动驾驶 `repository` 入参增加 `kind?:'git'|'svn'`、`revision?`，工具 `opc_project_bootstrap` 增加平铺参数 `repositoryKind`/`revision`，`kind` 显式优先、`svn://`/`svn+ssh://` 推断 svn、其余默认 git；新增迁移 `0014_autopilot_svn.sql`，`ref.project_checkout` 增 `vcs_kind varchar(8) NOT NULL DEFAULT 'git'`（CHECK git/svn）与 `revision varchar(32)`（表数仍 91，该表列数 13→15）；SVN 检出走 CLI（subversion ≥1.10），`branch` 为主干/分支路径、`revision`=HEAD|数字|r数字，密码经 stdin、凭据仅 `env:` 引用；svn 客户端缺失返回 502 `ERR-AUTO-002` 并登记 `topic=svn_client` 裁决；扫描跳过 `.svn`/`.hg`，`software_profile` 增加 `vcs`/`revision`；SVN 骨架只落工作副本（`status=generated`、不建分支不提交、无 `scaffold_review` 裁决），测试环境发布版本号=`coalesce(commit_sha, revision)`，响应增加 `repository.kind` 与 `checkout.vcs`/`revision`；测试新增 TC-AUTO-010/011（`autopilot.test.ts` 9→11，全量 127→129）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-031`。
- **微信推送（v2.21）**：检查 `dsh-channel-wechat`（未安装、且设计上不支持主动推送）后，改用已安装的 dsh-im（BotHarness）主动投递端点；新增 `stat.wechat_push`（表 90→91）与 `src/notify/wechat.ts`：裁决与每日简报自动入队并推微信，失败 2s→300s 退避 5 次，未绑定只排队不丢；裁决创建与晨报生成自动挂钩；新增任务 `wechat_push`（每分钟）、工具 `opc_wechat_status/push`（40→42）、4 个 operation（P98–P101，110→114）与错误码 `ERR-WECHAT-001`（35 个）；老板绑定微信后可直接在微信里对话使用全部 `opc_*` 工具；测试新增 `wechat.test.ts` 5 例（全量 127/127）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-030`。
- **创意转项目（v2.20）**：`OPC-SRS-105` 新增 REQ-PRJ-035；新增 `stat.project_idea`（实体 89→90）与 `src/domains/project/idea.ts`、`src/platform/documents.ts`；支持创意文本或文档上传（txt/md/csv/json/yml/docx/xlsx/pdf，多文件，单文件≤10MB/总量≤20MB），docx/xlsx 用内置 zlib 解析 OOXML、PDF 走文本层提取，不新增依赖；AI 解析出项目名/类型/范围/目标/风险/待确认问题/工期（AI 不可用降级规则），自动建项目并绑定默认资源；有仓库进自动驾驶，无仓库转 `repository` 裁决；新增 3 个 operation（P95–P97，契约 107→110）、2 个错误码 `ERR-IDEA-001/002`（34 个）与工具 `opc_project_from_idea`（39→40）；管理面「自动驾驶」页签新增「从创意新建项目」卡片（多文件上传、解析预览）；测试新增 `idea.test.ts` 5 例（全量 122/122）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-029`。
- **已建项目接入自动驾驶（v2.19）**：`OPC-SRS-105` 新增 REQ-PRJ-034；`POST /admin/projects/{projectId}/autopilot` 对已有项目可用，重复执行复用同 URL 版本库与测试环境、里程碑/测试用例/裁决去重、计划按 `(project_id, plan_kind)` 版本递增（修复二次执行撞 UNIQUE）；管理面「自动驾驶」页签新增「对已选项目执行」区块并自动预填已登记仓库；测试新增 TC-AUTO-008/009（autopilot.test.ts 9/9，全量 117/117）；文档同步 SRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-028`。
- **运维反馈闭环（v2.18）**：`OPC-SRS-001` §8.5 新增 REQ-OPS-001..003（运行错误自动开 Issue、用量遥测与使用习惯审视、反馈投递治理）；新增 `migrations/0011_ops_feedback.sql`（3 张表，实体 86→89）与 `src/ops/feedback.ts`；HTTP 入口自动记录动作/状态/耗时（不记请求体），5xx 按指纹去重后自动开 GitHub Issue（单轮5/单日20、正文脱敏、未配置 token 只攒草稿）；规则审视 + 可选 AI（OpenAI 兼容，只发聚合统计）产出 [体验]/[需求]/[流程] Issue 草稿；新增定时任务 `issue_autofile`/`usage_insight` 与工具 `opc_ops_usage_summary`/`opc_ops_issues_sync`（37→39）；新增 4 个管理面 operation（P91–P94，契约 103→107）与错误码 ERR-OPS-001/002（32 个）；测试新增 `ops.test.ts` 5 例（GitHub 本地 mock、AI 规则路径）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-027`。
- **自动化生产（v2.17）**：`OPC-SRS-105` 新增 REQ-PRJ-031..033（自动生成代码骨架、自动跑测试流水线、自动发布测试环境）；新增 `migrations/0010_autopilot_production.sql`（3 张表，实体 83→86）；`ProjectAutopilotService` 增加 `generateScaffold`（只补缺失文件、提交本地分支不推远端）、`runPipeline`（lint/build/test，300s 超时、最小环境、默认不装依赖）、`deployTestEnvironment`（建测试环境发布单、执行 `OPC_TEST_DEPLOY_CMD` 并健康检查、无命令转裁决）；新增 operation `deployProjectTest`（P90，契约 102→103）与错误码 `ERR-AUTO-005`（30 个）；新增 `scaffold_review`/`pipeline_failed`/`deploy_executor`/`deploy_failed` 裁决项；管理面新增「自动驾驶」页签（12→13）：填版本库一键自动生产、查看检出/扫描/计划/流水线/发布、就地裁决；克隆默认目录改为 `~/.opc-workspaces`（可用 `OPC_WORKSPACE_ROOT` 覆盖），避免 `/tmp` 小分区被撑满；测试新增 TC-AUTO-005..007（autopilot.test.ts 7/7）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-026`。
- **项目自动驾驶（v2.16）**：`OPC-SRS-105` 新增 REQ-PRJ-027..030（建项目自动检出、静态扫描与档案回填、自动生成开发/测试/部署计划、裁决队列与人工放行）；新增 `src/domains/project/autopilot.ts` 与 `migrations/0009_project_autopilot.sql`（4 张表，实体 79→83）；建项目支持 `repository:{url,branch?,authRef?}`，浅克隆后只读扫描并回填 `tech_stack/software_profile`，自动生成 5 个里程碑、测试计划草案 + 3 条基线用例、部署计划（复用公司默认测试服务器）；新增 5 个 HTTP operation（P85–P89，契约 97→102）、4 个错误码 `ERR-AUTO-001..004` 与工具 `opc_project_bootstrap`（36→37）；仅「无 LICENSE / 无测试 / 无 CI / 无生产服务器 / 技术栈歧义」等需老板拍板事项进入 `stat.project_decision` 等待裁决，未裁决不放行生产；新增集成测试 `test/integration/autopilot.test.ts`（TC-AUTO-001..004，本地 git 夹具）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-025`。
- **公司基础资源配置（v2.15）**：`OPC-SRS-105` 新增 REQ-PRJ-023..026（公司基础资源目录六类、远程管理方式与公司默认口径、新建项目默认选型、项目绑定与追溯）；新增 `migrations/0008_shared_resources.sql`（3 张表：`ref.shared_resource`/`ref.shared_setting`/`ref.project_shared_resource`，实体 76→79）；`AdminService` 新增 8 个共享资源方法与 8 个 HTTP operation（P77–P84，契约 89→97）、4 个错误码 `ERR-RES-001..004`；新建项目默认按 `is_default + active` 选型绑定，`resourceIds` 可显式覆盖；公司默认 Debian + SSH、默认账号 `canetwork`，口令只以 `env:OPC_DEFAULT_SSH_PASSWORD` 引用登记；新增集成测试 `test/integration/admin-shared.test.ts`（TC-RES-001..005）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-024`。
- **项目管理与情报管理 Web 面**：新增 `/api/v1/admin/*` 管理面 27 个 operation 与「项目管理」「情报管理」两个页签；项目侧覆盖里程碑/版本库/制品库/环境/发布/测试计划/用例/套件/批次/缺陷/工时 CRUD 与发布审批；情报侧覆盖情报空间/数据源/绑定/主题/标签 CRUD、条目状态处理、日报详情与五阶段流水线手动触发；驾驶舱新增项目研发与情报指标。
- `client.js` 新增可复用管理组件（项目选择、KPI、分割视图、通用 CRUD 表单、状态徽标、详情面板）与 27 条管理面路由的前端接线。

- **软件研发项目管理**：`OPC-SRS-105` 新增 REQ-PRJ-016..022（项目起点与软件研发档案、Git/SVN 版本库、Maven/Docker 制品库、开发/测试/生产 SSH 部署环境、发布单与人工审批、测试计划/用例/批次/结果与缺陷、测试 Agent 协同、里程碑与时间管理）；新增 `src/domains/project/software.ts` 与 15 个 HTTP operation（`/api/v1/projects/*`、`/api/v1/releases/*`、`/api/v1/test-runs*`）；新增 12 张表（`0006_project_software.sql`，实体 54→66）；凭据仅接受 `env:/secret:/vault:/ssh-agent:` 引用，生产强制人工审批；`opc_project` manifest 升至 `0.2.0` 并扩展工具/写目标/流程。
- `docs/过程资产/PA-OPC-022-软件研发项目管理需求扩展.md`: change record, boundaries, landing status, and verification.

- **情报日报与数据源管理（v2.13）**：`OPC-SRS-106` 新增 REQ-INT-011..018（项目情报空间、数据源健康、项目关键词/标签、定时采集、分析与去重评分、日报汇总、推送送达、五阶段流水线）；新增 `src/domains/intel/daily.ts` 本地规则流水线与 5 个定时任务（`intel_source_collect/analyze/aggregate/brief/push`）；新增 10 张表（`0007_intel_daily.sql`，实体 66→76）；`opc_intel` manifest 升至 `0.2.0` 并扩展工具/写目标/`intel_daily_pipeline`。
- `docs/过程资产/PA-OPC-023-情报日报与数据源管理需求细化.md`: change record, boundaries, landing status, and verification.

- **Hindsight 记忆导入与同步**：`src/memory/hindsight.ts`（Hindsight API 桥：health/stats/list/import，超时与 `ERR-HINDSIGHT-001` 归一）+ `src/memory/sync.ts`（导入、推送 OPC 记忆卡→Hindsight、拉取 Hindsight→OPC 记忆提案、双向同步，全部写审计）；OPC 记忆卡以 `document_id=opc-memory-<id>` 幂等写入，敏感卡永不推送，拉取方向生成 pending 提案并自动去重。HTTP 契约 +4 operation（`/api/v1/memory/hindsight*`，共 47）；面板新增「记忆同步」页签（状态条、JSON/文本导入、推送/拉取/双向、远端记忆列表）。配置 `hindsightUrl`/`hindsightBank`（env `OPC_HINDSIGHT_URL`/`OPC_HINDSIGHT_BANK`；内网实测服务 `http://192.168.1.12:8888`，bank 与 dsh-hindsight-memory 插件一致 `coding-agent::workspace`）。
- `docs/过程资产/PA-OPC-021-Hindsight记忆导入与同步.md`: change record with ADRs and verification.

- **OPC驾驶舱升级为全功能 Web 控制台**（11 个模块页签：驾驶舱/员工/业务域/流程/任务/审计/冲突/收件箱/记忆/雷达/设置）：员工矩阵可见 11 个员工并支持安装、启用停用、部署角色卡、派活、员工包导出导入；流程可见注册版本/实例并支持注册、启动实例、完成节点、Verifier 评判；任务可立即执行与启停；审计可过滤与导出；冲突可裁决；收件箱可确认归置；记忆可检索与提案；设置页含智能体健康与全局暂停。
- 服务端契约 +5 operation：`listWorkflows`、`listWorkflowInstances`、`getWorkflowInstance`、`agentRuns`、`listConflicts`；`GET /api/v1/employees` 响应增加 `catalog`（11 个员工 manifest）。
- `apply` 增注册 `/api/v1` **前缀路由**（DSH webServer 最长前缀匹配），动态路径在浏览器端可达。

- **Web 界面「OPC驾驶舱」**：浏览器半 `client.js` 通过 DSH Client 插件机制注册左栏入口（`sidebar.panellist`，order 27）与主面板（`main`），展示健康条（PG/pgvector/调度/员工智能体）、范围快照指标（今日/7天/30天/90天 + 冻结脚注 + as-of）、待归置、定时任务与雷达；数据只读、30 秒自动刷新。`package.json` 增 `exports./client` 与 `dsh.client`；manifest 标题统一为「OPC驾驶舱」、`panel=left`（取代 PA-OPC-010 的「OPC公司管理/右栏」口径，历史记录保留）。
- `docs/过程资产/PA-OPC-019-Web驾驶舱界面.md`: change record for the cockpit panel (ADR, verification, rollback).

- **Super Agent application layer (OPC-SDD-003)**: opc-xuanji now builds on [dsh-super-agents](https://github.com/mindtheory/dsh-super-agents) as the application layer — `src/agents/bridge.ts` (loopback HTTP bridge with timeout/degradation/idempotent upsert) and `src/agents/service.ts` (deploy employees as persona cards, dispatch cognitive tasks and collect artifacts, health aggregation, global pause); 5 new tools (`opc_agent_deploy/dispatch/result/health/pause`, 36 total) and 4 new HTTP operations (`/api/v1/agents/*`, 38 total); `/api/v1/health` and `opc_health` gain an `agents` section plus `degraded` flag; new error code `ERR-AGENT-001`; soft dependency — without dsh-super-agents the agent tools degrade gracefully and everything else keeps working.
- `docs/OPC-SDD-003-SuperAgent应用层设计.md`: application-layer positioning, concept mapping (employee→persona card, cognitive task→Run), bridge contract, dual-track scheduling, health/pause/degradation, acceptance scenarios, and rejected alternatives.
- `AGENTS.md`: main-session agent operating charter (five proactives, reporting rhythm, decision-card rules, boundary and compliance).
- `OPC-SDD-002`: main-session agent persona, work loop, discovery, planning, execution, reporting, decision cards, metrics, and AC-AGT-01..10.
- `OPC-SDP-001`: software development plan with roles, WBS, G0–G6 gates, milestones, resources, and change control.
- `OPC-SCMP-001`: configuration management plan with configuration items, baselines, change control, backup, and audit.
- `OPC-SQAP-001`: software quality assurance plan with quality goals, reviews, metrics, and nonconformance handling.
- `OPC-RMP-001`: risk management plan with 18 registered risks, scoring, mitigations, and fallbacks.
- `OPC-RTM-001`: requirements traceability matrix from REQ/UC/TC to code and tests.
- `OPC-SVD-001`: v0.1.0 software version description, installation, compatibility, evidence, and known limitations.
- `PA-OPC-018`: change record for the main-session agent and management documentation additions.

### Fixed

- 项目监理（SRS-105）集成测试修复：`date` 列按 `YYYY-MM-DD` 字符串返回（此前经 `Date` 序列化为 ISO 时间戳）；`jsonb` 列参数显式 `JSON.stringify`（此前进 PG 数组字面量导致 `22P02`）；`test_run` 状态更新改用 `$2::varchar`（此前 PG 无法推导参数类型，`42P08`）。
- 集成断言同步默认定时任务数 10→15（新增 5 个 `intel_*` 任务）。

### Changed

- Bumped GitHub Actions dependencies: `actions/checkout@v7`, `actions/setup-node@v7`.
- `docs/index.md`: registered the new design, management, traceability, and version documents; added SDP/RMP to the document type list.

### Planned

- Real DSH Web host adapter (native slot / sandbox iframe / postMessage bridge) end-to-end verification.
- Domain implementations for the 11 employee lines (finance, legal, admin, strategy, project, intel, crm, vehicle, inventory, WBS, publicity).
- Gantt chart UI, critical-path/EVM calculations, and OKR roll-up for project supervision.
- Employee package signing/verification and real package file export.

## [0.1.0] - 2026-11-06

### Added

- DSH Bundle plugin scaffold (`opc-xuanji`) with `cordis.patch.yml` and 31 registered `opc_*` tools.
- HTTP `/api/v1` contract with 34 operations: platform, workflow, audit, scheduler, web presentation, and employee catalog/package.
- PostgreSQL 17 / pgvector schema with 54 entities and 5 additive migrations (`0001`–`0005`).
- 10 scheduled automation tasks: daily report, tax/contract reminders, invoice backlog, conflict escalation, audit export, monthly archive, dashboard refresh, plugin radar, keyword radar.
- Web presentation layer: sidebar entry, right-side dashboard, session/memory bridge, upload ingestion, inbox/confirmation, radar, and dashboard snapshot.
- Employee requirement set split into 11 standalone documents (`docs/员工需求/OPC-SRS-101..111`) covering 130 requirements.
- Pluggable employee manifests with views, tools, write targets, single-employee workflows, dependencies, install/enable/disable, and dependency protection.
- Employee package import/export (`opc-employee-package` v1) with checksum, dry-run, default-disabled install, rollback, and audit.
- Finance employee expanded to CFO/accounting/tax/business-reporting scope: reimbursement vouchers, chart of accounts, vouchers, three statements, statement audit, internal control, tax filing, business reporting, R&D super deduction, tax planning, analysis, archive.
- Project supervision expanded to full lifecycle: stage gates, charter, scope/WBS link, milestones, task dependencies/resources, Gantt/baseline/critical path, EVM, OKR linkage, risk/change, acceptance, closure, templates/RACI.
- WBS and publicity employees added, with detailed requirements and manifests.
- Project governance docs: SRS/IRS/SDD/DBDD/STP/STD/STR, UML, process assets (`PA-OPC-*`), and documentation/spec gates.
- GitHub release scaffolding: CI, release workflow, issue/PR templates, security policy, contributing guide, code of conduct, and release notes.

### Changed

- Employee requirements moved out of the main SRS into per-employee documents; the main SRS now keeps cross-cutting plugin/package requirements and an index.
- Design docs and specs aligned to v2.12 scope (web layer, employee packaging, 11 employee lines).
- `spec:check` and `docs:check` now run local lightweight gates suitable for GitHub CI; stricter CD-PTC gates remain optional.

### Fixed

- Employee package import rejects path traversal, checksum mismatch, unsafe file types, missing dependencies, and incompatible hub versions.
- Disabling an employee plugin is blocked when another installed plugin depends on it.
- Dashboard and reports keep `as_of`, stale flags, and frozen-conflict footnotes instead of silently filling zeros.

### Security

- No business data or credentials in employee packages by default; package import is dry-run first and installs disabled.
- Employee plugins declare `write_targets`; high-risk writes remain behind human confirmation.
- Sensitive customer fields stay in private storage; cross-domain access uses one-time tokens.
- Audit is append-only through the central `opc_hub.audit.record()` path.

### Known Limitations

- Integration tests run in CI against PostgreSQL 17 + pgvector; a local run still requires `OPC_TEST_DSN` and a reachable test database.
- DSH Web host slot/session-event/memory-plugin contracts still need end-to-end verification against the real DSH runtime.
- Domain tables/tools/workflows for most employee lines are requirements/manifest placeholders; Phase 2 implements them.
- Employee package files are manifest-only today; workflow/config file export and signature verification are planned.
- `spec:check`/`docs:check` are lightweight local gates; the external CD-PTC gates are stricter and remain optional.

[Unreleased]: https://github.com/mindtheory/opc-xuanji/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mindtheory/opc-xuanji/releases/tag/v0.1.0
