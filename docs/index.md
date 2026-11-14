---
doc_id: OPC-SUM-001
title: OPC-玄机·一人公司中枢 文档索引
version: 0.4
status: 评审稿
stage: D5
owner: 项目集成者
upstream: [OPC-SRS-001, OPC-IRS-001, OPC-SDD-001, OPC-SDD-002, OPC-SDD-003, OPC-DBDD-001, OPC-STP-001, OPC-STD-001, OPC-STR-001, OPC-SDP-001, OPC-SCMP-001, OPC-SQAP-001, OPC-RMP-001, OPC-RTM-001, OPC-SVD-001]
gate: G6
updated: 2026-11-06
---

# OPC-玄机·一人公司中枢 文档索引

这份索引回答一个问题：**项目里的每份文档是什么、谁该读、处在什么状态、和哪份上游对得上**。读者是接手维护的工程师与验收人，避免“文档散落、编号重号、上游缺失”。

## 目录

1. 文档清单
2. 编号规则
3. 状态与基线
4. 过程资产索引
5. 文档与代码的对账方式
6. 维护约定

## 1. 文档清单

| 编号 | 名称 | 类型 | 阶段/门禁 | 状态 | 路径 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| OPC-SRS-001 | 软件需求规格说明 | SRS | D1/G1 | 评审稿 | `docs/OPC-SRS-001-软件需求规格说明.md` |
| OPC-IRS-001 | 接口需求规格说明 | IRS | D2/G2 | 评审稿 | `docs/OPC-IRS-001-接口需求规格说明.md` |
| OPC-SDD-001 | 系统设计说明 | SDD | D2/G2 | 评审稿 | `docs/OPC-SDD-001-系统设计说明.md` |
| OPC-SDD-002 | 主会话 Agent 设定与运行设计 | SDD | D2/G2 | 评审稿 | `docs/OPC-SDD-002-主会话Agent设定与运行设计.md` |
| OPC-SDD-003 | Super Agent 应用层设计（依赖 dsh-super-agents） | SDD | D2/G2 | 评审稿 | `docs/OPC-SDD-003-SuperAgent应用层设计.md` |
| OPC-DBDD-001 | 数据库设计说明 | DBDD | D2/G2 | 评审稿 | `docs/OPC-DBDD-001-数据库设计说明.md` |
| OPC-SDP-001 | 软件开发计划 | SDP | D0/G0 | 评审稿 | `docs/OPC-SDP-001-软件开发计划.md` |
| OPC-SCMP-001 | 配置管理计划 | SCMP | D0/G0 | 评审稿 | `docs/OPC-SCMP-001-配置管理计划.md` |
| OPC-SQAP-001 | 软件质量保证计划 | SQAP | D0/G0 | 评审稿 | `docs/OPC-SQAP-001-软件质量保证计划.md` |
| OPC-RMP-001 | 风险管理计划 | RMP | D0/G0 | 评审稿 | `docs/OPC-RMP-001-风险管理计划.md` |
| OPC-RTM-001 | 需求追踪矩阵 | RTM | D2/G2 | 评审稿 | `docs/OPC-RTM-001-需求追踪矩阵.md` |
| OPC-SVD-001 | 软件版本说明（v0.1.0） | SVD | D5/Release | 评审稿 | `docs/OPC-SVD-001-软件版本说明.md` |
| OPC-STP-001 | 测试计划 | STP | D4/G4 | 评审稿 | `docs/OPC-STP-001-测试计划.md` |
| OPC-STD-001 | 测试设计说明 | STD | D4/G4 | 评审稿 | `docs/OPC-STD-001-测试设计说明.md` |
| OPC-STR-001 | 测试报告 | STR | D4/G4 | 评审稿 | `docs/OPC-STR-001-测试报告.md` |
| OPC-SUM-001 | 文档索引（本文） | SUM | D5/G6 | 评审稿 | `docs/index.md` |
| OPC-SUM-002 | 员工需求分册索引 | SUM | D1/G1 | 评审稿 | `docs/员工需求/index.md` |
| OPC-SRS-101..111 | 11 个员工需求分册 | SRS | D1/G1 | 评审稿 | `docs/员工需求/` |
| — | 流程注册表与用例证据 | PA | D0–D4 | 基线 | `docs/过程资产/pa-index.md` |
| — | 架构/时序/ER/类图 | UML | D2 | 评审稿 | `docs/uml/` |

## 2. 编号规则

- 项目文档：`OPC-<TYPE>-<3位>`，TYPE ∈ {SRS, IRS, SDD, DBDD, SDP, SCMP, SQAP, RMP, RTM, SVD, STP, STD, STR, SUM, ICD, SyRS, RTP, TEMP, ADR, PA, LC}。
- 需求：`REQ-<域>-<3位>`，域与 `spec/opc-xuanji/usecases.yaml` 的 `requirement` 一致（VIEW/TOKEN/CONFLICT/WF/AUDIT/TASK 等）。
- 用例/测试：`UC-<3位>` 与 `TC-<域>-<3位>`，与 `usecases.yaml` 双向可查。
- 过程资产：`PA-OPC-<3位>`，一行一条登记在 `docs/过程资产/pa-index.md`。

## 3. 状态与基线

状态机：`草稿 → 评审稿 → 已批准 → 基线 → 废弃`。进入 `基线` 必须打 Git tag 并在本索引登记；本次交付的 G1/G2/G4 证据见 `docs/过程资产/G*/` 下的报告；v2.10 增量见 `PA-OPC-010`，v2.11 增量见 `PA-OPC-012`，全员工需求标准化见 `PA-OPC-015`，v0.1.0 发布证据见 `PA-OPC-016`，依赖升级合并记录见 `PA-OPC-017`，主会话 Agent 设定与管理文档增补见 `PA-OPC-018`，软件研发项目管理需求扩展见 `PA-OPC-022`，情报日报与数据源管理需求细化见 `PA-OPC-023`，基础资源配置见 `PA-OPC-024`，项目自动驾驶见 `PA-OPC-025`，自动化生产见 `PA-OPC-026`，运维反馈闭环见 `PA-OPC-027`，已建项目接入自动驾驶见 `PA-OPC-028`，创意转项目见 `PA-OPC-029`，微信推送见 `PA-OPC-030`，SVN 版本库支持见 `PA-OPC-031`；`OPC-STR-001` 记录基线 51 个用例与 Web/员工层增量结果；员工分册索引见 `docs/员工需求/index.md`。交付快照：Git **`v0.1.0`**；v2.10 Web 层与 v2.11 员工分册/员工包为工作副本增量，尚未打新发布标签。

## 4. 过程资产索引

门禁证据（G1 规格、G2 契约、G3 实现、G4 验证）与测试日志统一在 `docs/过程资产/`，检索入口是 `pa-index.md`；`research/` 下保留原始命令输出（`test-run.log`、`typecheck.log`、`check-spec.log`）。

## 5. 文档与代码的对账方式

- `spec/opc-xuanji/entities.yaml` ↔ `migrations/*.sql` ↔ `information_schema`：由 `test/integration/spec.test.ts` 自动对账。
- `spec/opc-xuanji/api.yaml` ↔ `src/api/http.ts` 路由：同一测试逐 operation 断言。
- `usecases.yaml` 的 TC ↔ `test/**/*.test.ts`：见 `OPC-STD-001` 的映射总表。
- 文档改动后执行 `npm run docs:check`，退出码非 0 不放行。

## 6. 维护约定

1. 新增/修改需求先改 `spec/` 再改文档，最后改代码与测试（spec → docs → code → tests）。
2. 一份文档一个主题，编号唯一；拆分类文档在标题里带父编号。
3. 文档中的数字（阈值、维度、保留期）必须能在设计文档或 DDL 找到出处，不得自创。
4. 归档类文档（`OPC-STR-001`、PA 证据）只追加不改写，修订另起版本号。

## 自检清单

- [x] 文档清单中的路径全部存在
- [x] 编号唯一且符合 `OPC-<TYPE>-<3位>`
- [x] 每份文档标注阶段与门禁
- [x] 状态机与基线规则已写明
- [x] 过程资产入口指向 `pa-index.md`
- [x] 文档-代码对账有可执行测试支撑
- [x] 维护约定覆盖 spec→docs→code→tests 顺序
- [x] 本文与 SRS/IRS/SDD/DBDD/STP/STD/STR 的上游关系已列
- [x] 管理类文档（SDP/SCMP/SQAP/RMP/RTM/SVD）与主会话 Agent 设计已登记

## 与其他文档的关系

- 上游：`OPC-SRS-001`（需求来源）、`OPC-IRS-001`（接口契约）、`OPC-SDD-001`（设计）、`OPC-SDD-002`（主会话 Agent 设定）、`OPC-DBDD-001`（库表）、`OPC-STP-001`/`OPC-STD-001`（测试设计）、`OPC-STR-001`（测试证据）。
- 管理文档：`OPC-SDP-001`（开发计划）、`OPC-SCMP-001`（配置管理）、`OPC-SQAP-001`（质量保证）、`OPC-RMP-001`（风险管理）、`OPC-RTM-001`（追踪矩阵）、`OPC-SVD-001`（版本说明）。
- 下游：发布说明、运维手册（Phase 2）、经验卡（`docs/过程资产/LC-*.md`）。
