# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
