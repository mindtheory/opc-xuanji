---
doc_id: OPC-SVD-001
title: OPC-玄机 · 一人公司中枢 软件版本说明（v0.1.0）
version: 0.1
status: 评审稿
stage: D5
owner: 项目集成者
upstream: ["OPC-SDP-001 软件开发计划", "OPC-SCMP-001 配置管理计划", "OPC-STR-001 测试报告", "docs/releases/v0.1.0.md"]
gate: Release
updated: 2026-11-06
---

# OPC-玄机 · 一人公司中枢 软件版本说明（OPC-SVD-001）

本文是 **v0.1.0** 的版本说明书：说明这个版本包含什么、装什么、怎么装、验证到什么程度、有哪些已知限制。它面向三类读者：老板/验收人看第 1、2、8 章；运维看第 4、5、7 章；接手者看第 3、6 章。本文不重复开发计划与测试设计，只做**版本级的事实清单与可复现入口**。所有数字来自 `docs/releases/v0.1.0.md`、`CHANGELOG.md`、`docs/OPC-STR-001-测试报告.md` 与 CI run `42153267527`。

## 目录

1. [版本标识](#1-版本标识)
2. [版本内容](#2-版本内容)
3. [交付物清单](#3-交付物清单)
4. [安装与升级](#4-安装与升级)
5. [配置项](#5-配置项)
6. [兼容性](#6-兼容性)
7. [验证证据](#7-验证证据)
8. [已知限制](#8-已知限制)
9. [变更记录](#9-变更记录)
10. [自检清单](#10-自检清单)
11. [与其他文档的关系](#11-与其他文档的关系)

## 1. 版本标识

| 项 | 值 |
| :--- | :--- |
| 产品名 | OPC-玄机 · 一人公司中枢 |
| 包名 | `opc-xuanji` |
| 版本 | **0.1.0** |
| 发布日期 | 2026-11-06 |
| Git tag | `v0.1.0` |
| Git 分支 | `main` |
| 交付快照 | Git tag `v0.1.0` |
| 发布类型 | DSH Bundle 插件 + 规格基线 |
| 许可证 | UNLICENSED（专有） |

## 2. 版本内容

### 2.1 能力概览

- **DSH Bundle 插件**：`opc-xuanji`，`cordis.patch.yml` 装配，31 个 `opc_*` 工具，34 个 HTTP `/api/v1` operation。
- **数据层**：PostgreSQL 17 + pgvector，54 个实体，5 条只追加迁移（`0001`–`0005`）。
- **自动化**：10 个定时任务，覆盖晨报、税务/合同提醒、缺票积压、冲突升级、审计导出、月度归档、驾驶舱刷新、插件雷达、关键词雷达。
- **Web 表现层**：插件栏入口、右侧驾驶舱、会话桥/记忆桥、上传归置与确认、收件箱、雷达、驾驶舱快照（`as_of`/陈旧/冻结脚注）。
- **员工需求**：11 份独立分册（`docs/员工需求/OPC-SRS-101..111`），130 条需求。
- **可插拔员工**：manifest 声明视图、工具、写目标、单员工流程、依赖；支持安装、启用、停用、依赖保护。
- **员工包**：`opc-employee-package` v1，校验和、dry-run、默认停用安装、失败回滚、审计。
- **财税/项目深度**：财税覆盖 CFO/会计/税务/经营分析；项目覆盖全生命周期、里程碑、甘特/基线/关键路径、EVM、OKR 联动。
- **治理**：SRS/IRS/SDD/DBDD/STP/STD/STR、UML、过程资产、`spec:check`/`docs:check` 门禁。

### 2.2 不包含（Phase 2）

- 真实 DSH Web 宿主插槽/iframe/postMessage 端到端适配。
- 11 条员工线的完整业务实现（表已建、manifest 与需求已就绪）。
- 真实 `dsh-llm-verifier` 调用与独立 Verifier 模型路由。
- 流程三关测试、影子运行、自动固化闭环。
- 员工包签名/验签与真实运行时装载。
- PgBouncer 接入、审计分区、生产 GRANT 演练、性能压测。

## 3. 交付物清单

| 类别 | 交付物 | 路径 | 说明 |
| :--- | :--- | :--- | :--- |
| 代码 | 平台/流程/审计/调度/Web/员工/API/插件 | `src/` | TypeScript，Node 原生运行 |
| 脚本 | 迁移、服务、规格生成、门禁 | `scripts/` | `migrate.ts`、`serve.ts`、`gen-spec.mjs`、`check-spec.mjs`、`check-docs.mjs` |
| 规格 | 实体/API/模块/用例 | `spec/opc-xuanji/*.yaml` | 54 实体 / 34 operation / 20 模块 / 14 用例 |
| 迁移 | 5 条只追加 SQL | `migrations/0001..0005` | 基线 + 令牌 + 审计游标 + Web + 员工线 |
| 测试 | 单元 25 + 集成 68 | `test/` | `node --test` |
| 文档 | 软件工程文档 | `docs/` | SRS/IRS/SDD/DBDD/STP/STD/STR/SUM + 管理文档 |
| 员工分册 | 11 份 | `docs/员工需求/` | 130 条需求 |
| 过程资产 | 门禁/发布/变更证据 | `docs/过程资产/` | PA-OPC-001..018 |
| 发布说明 | v0.1.0 | `docs/releases/v0.1.0.md` | 面向发布 |
| 装配 | Bundle 配置 | `cordis.patch.yml` | DSH profile 引用 |
| 环境模板 | 变量占位 | `.env.example` | 不含口令 |

## 4. 安装与升级

### 4.1 前置条件

| 项 | 要求 |
| :--- | :--- |
| Node.js | ≥ 24.9 |
| PostgreSQL | 17，目标库安装 `vector`、`pgcrypto`、`unaccent` |
| pgvector | 0.8.0（实测） |
| DSH | ≥ 0.2.1 |
| 磁盘 | 审计归档目录可写 |
| 网络 | 不要求公网；模型可指向本地 |

### 4.2 安装步骤

```bash
npm ci
cp .env.example .env       # 填入 OPC_PG_DSN / OPC_TEST_DSN
npm run migrate            # 业务库
npm run migrate:test       # 测试库（集成测试用）
npm run typecheck
npm run test:unit
npm run spec:check
npm run docs:check
```

建库（DBA/超级用户执行一次）：

```sql
CREATE ROLE opc LOGIN PASSWORD '<set-a-strong-password>';
CREATE DATABASE opc      OWNER opc;
CREATE DATABASE opc_test OWNER opc;   -- 集成测试专用，禁止指向业务库
\c opc      CREATE EXTENSION IF NOT EXISTS vector, pgcrypto, unaccent;
\c opc_test CREATE EXTENSION IF NOT EXISTS vector, pgcrypto, unaccent;
```

启动独立服务：

```bash
npm run serve -- --port 3082 --tick 60000
curl -s http://127.0.0.1:3082/api/v1/health
```

### 4.3 DSH 装配

```yaml
- insert:
    - id: opc-xuanji
      name: 'opc-xuanji'
      config:
        dsn: 'postgresql://<user>:<password>@localhost:5432/opc'
        timezone: 'Asia/Shanghai'
        enableScheduler: true
```

### 4.4 升级与回滚

- 升级：拉取新 tag → `npm ci` → 应用新迁移 → 跑门禁 → 重启服务。
- 迁移只追加，不删旧文件；破坏性变更须按发布说明先备份。
- 回滚：切回上一 tag → 数据库按备份/回滚脚本恢复；审计归档不回滚。
- 发布 tag 不移动、不删除。

## 5. 配置项

| 变量 | 默认 | 必填 | 说明 |
| :--- | :--- | :-: | :--- |
| `OPC_PG_DSN` | 无 | 是 | 业务库连接串；仓库不保存口令 |
| `OPC_TEST_DSN` | 无 | 集成测试时 | 测试库；与业务库相同会拒绝启动 |
| `OPC_ARCHIVE_DIR` | `<repo>/archive` | 否 | 审计归档根目录 |
| `OPC_TIMEZONE` | `Asia/Shanghai` | 否 | 调度默认时区 |
| `OPC_SCHEMA_VERSION` | `1` | 否 | 审计归档 schema 版本 |

Bundle 配置：`dsn`、`timezone`、`enableScheduler`、`companyProfile`、`dataPolicy` 等，见 `cordis.patch.yml` 与 SDD §7。

## 6. 兼容性

| 对象 | 兼容范围 | 验证 |
| :--- | :--- | :--- |
| Node.js | 24.9 / 24 / 26 | CI 矩阵全绿 |
| DSH | ≥ 0.2.1 | Bundle 装配；宿主契约 Phase 2 验证 |
| PostgreSQL | 17 | 实测 17.11 |
| pgvector | 0.8.0 | 实测 |
| TypeScript | 7.0.2（dev） | `tsc --noEmit` |
| 浏览器/面板 | DSH Web 宿主 | 宿主适配 Phase 2 |

## 7. 验证证据

### 7.1 门禁结果

| 检查 | 结果 | 证据 |
| :--- | :--- | :--- |
| `npm run typecheck` | exit 0 | CI run `42153267527` |
| `npm run test:unit` | 25/25 pass | CI / STR |
| `node scripts/gen-spec.mjs --check` | PASS（54 实体） | CI |
| API 契约 | 34 operations ↔ 34 routes | CI / `spec.test.ts` |
| 错误码 | 14 | `spec` / IRS |
| `npm run spec:check` | PASS（54 实体 / 14 用例 / 20 模块） | CI |
| `npm run docs:check` | PASS（基线 20 份；本次新增后重跑） | CI / 本地 |
| 集成测试 | **68/68 pass** | CI run `42153267527`（PG17 + pgvector） |

### 7.2 测试覆盖

| 层次 | 用例数 | 覆盖 |
| :--- | :-: | :--- |
| 单元 | 25 | cron、guard、Web 分类/评分/陈旧、员工 manifest/包 |
| 集成 | 68 | 平台、流程、审计、调度、API、Web、员工、规格对账 |
| 契约 | 34 operation | `api.yaml` ↔ 路由 |
| 规格对账 | 54 实体 / 54 表 | `entities.yaml` ↔ `information_schema` |

### 7.3 未验证/未覆盖

- 真实 DSH Web 宿主插槽、会话事件、记忆插件契约。
- 真实 LLM Verifier 模型调用。
- 生产 `opc_app` 角色 GRANT 与恢复演练。
- PgBouncer、审计分区、性能 p95。
- 员工包签名/验签与真实运行时装载。

以上均登记在 `OPC-STR-001`、`OPC-SDD-001` 10.1、`OPC-RMP-001`，不宣称通过。

## 8. 已知限制

1. 本地跑集成测试仍需 `OPC_TEST_DSN` 与可达的 PG17 + pgvector；CI 已跑通 68/68。
2. DSH Web 宿主适配未端到端验证；面板/会话桥可能需按宿主契约调整。
3. 多数员工线的表/工具/流程为 Phase 2；当前可用的是平台能力、manifest、员工包与部分 Web/调度能力。
4. 员工包目前只含 manifest；流程/配置文件导出与签名验签待后续。
5. `spec:check`/`docs:check` 为轻量本地门禁；外部 CD-PTC 门禁更严格，仍可选。
6. 审计只追加依赖部署期数据库权限；当前应用账号仍是表 owner，生产需另建 `opc_app`。
7. PgBouncer 未部署，当前直连 PG；高并发前需评估连接数。

## 9. 变更记录

### 9.1 v0.1.0（2026-11-06）

新增：DSH Bundle 插件、34 operation、54 实体、5 条迁移、10 个任务、Web 表现层、11 份员工分册、员工 manifest/员工包、财税/项目深度扩展、治理文档与 CI。

变更：员工需求从主 SRS 拆到分册；设计文档对齐 v2.12；门禁改为可独立运行的轻量脚本。

修复：员工包路径穿越/校验和/依赖/版本校验；依赖保护；驾驶舱 `as_of`/陈旧/冻结脚注；不静默填 0。

### 9.2 后续计划

- v0.2.0（计划）：真实 Verifier、Web 宿主适配、法务/项目线落地。
- 具体以 `CHANGELOG.md` 与 `docs/releases/` 为准。

## 10. 自检清单

- [x] frontmatter 九字段齐全，`doc_id` 为 `OPC-SVD-001`，`status` 为评审稿，`updated` 为 2026-11-06。
- [x] 版本标识（0.1.0、日期、tag、快照、门禁标签）与发布说明一致。
- [x] 版本内容覆盖插件、数据、自动化、Web、员工、治理，并单列 Phase 2 不含项。
- [x] 交付物清单含路径与说明，能找到实际文件。
- [x] 安装、DSH 装配、升级、回滚步骤可复现。
- [x] 配置项与 `.env.example`、SDD §7 一致，未写入口令。
- [x] 兼容性（Node/PG/pgvector/DSH/TS）有验证或标注待验证。
- [x] 验证证据（25/25、68/68、CI run、spec/docs 门禁）有出处。
- [x] 未验证/未覆盖项与 STR、SDD 10.1、RMP 一致，不冒充通过。
- [x] 已知限制 7 条具体、可操作。
- [x] 变更记录区分新增/变更/修复，后续计划不承诺未排期能力。

## 11. 与其他文档的关系

| 文档 | 关系 | 说明 |
| :--- | :--- | :--- |
| [docs/releases/v0.1.0.md](releases/v0.1.0.md) | 同层 | 面向发布的精简版 |
| [CHANGELOG.md](../CHANGELOG.md) | 上游 | 版本变更历史 |
| [OPC-SDP-001 软件开发计划](OPC-SDP-001-软件开发计划.md) | 上游 | 里程碑与发布门禁 |
| [OPC-SCMP-001 配置管理计划](OPC-SCMP-001-配置管理计划.md) | 上游 | 基线、tag、发布检查单 |
| [OPC-STR-001 测试报告](OPC-STR-001-测试报告.md) | 上游 | 测试结果与未覆盖项 |
| [OPC-RMP-001 风险管理计划](OPC-RMP-001-风险管理计划.md) | 下游 | 已知限制转风险 |
| [OPC-SDD-001 系统设计说明](OPC-SDD-001-系统设计说明.md) | 上游 | 部署拓扑、Phase 2 清单 |
| [README.md](../README.md) | 同层 | 快速开始与架构摘要 |
