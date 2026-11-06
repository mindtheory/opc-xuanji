# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
