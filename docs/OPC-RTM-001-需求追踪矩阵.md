---
doc_id: OPC-RTM-001
title: OPC-玄机 · 一人公司中枢 需求追踪矩阵
version: 0.1
status: 评审稿
stage: D2
owner: 集成验证组
upstream: ["OPC-SRS-001 软件需求规格说明", "OPC-IRS-001 接口需求规格说明", "OPC-STP-001 测试计划", "OPC-STD-001 测试设计说明", "spec/opc-xuanji/usecases.yaml"]
gate: G2
updated: 2026-11-06
---

# OPC-玄机 · 一人公司中枢 需求追踪矩阵（OPC-RTM-001）

本文解决“每条需求最后被谁实现、被哪个测试验证、证据在哪”的问题。SRS 回答“验收看哪几条”，IRS 回答“接口长什么样”，STP/STD 回答“怎么测”，本文把三者与 `src/`、`test/`、`spec/` 对齐成一张可查的矩阵。使用者与时机：开发在改代码前查影响面；测试在补用例前查缺口；评审在 G2/G4 用它证明“没有漏项、没有自创需求”。本文不新增需求；矩阵中的 REQ/UC/TC 编号与 `usecases.yaml`、SRS §12、STD 映射总表一致，冲突时以 SRS 与 `usecases.yaml` 为准。

## 目录

1. [追踪规则](#1-追踪规则)
2. [总览](#2-总览)
3. [平台功能需求矩阵](#3-平台功能需求矩阵)
4. [员工线需求矩阵](#4-员工线需求矩阵)
5. [非功能需求矩阵](#5-非功能需求矩阵)
6. [用例与测试映射](#6-用例与测试映射)
7. [缺口与处置](#7-缺口与处置)
8. [自检清单](#8-自检清单)
9. [与其他文档的关系](#9-与其他文档的关系)

## 1. 追踪规则

### 1.1 追踪链

```text
产品设计/架构（为什么）
  → SRS REQ（验收什么）
  → UC（谁在什么场景用）
  → IRS operation / DSH 工具（接口形状）
  → src 模块（谁实现）
  → TC（怎么验）
  → 测试文件（在哪验）
  → PA/STR（证据）
```

### 1.2 规则

1. 每条 REQ 至少有一个 AC；至少映射到一个 UC 或一个测试文件。
2. 每个 UC 至少映射一个 TC；TC 必须能在 `test/` 找到实际断言。
3. 每个 operation/工具必须有实现与契约测试。
4. 编号不复用、不跳号；新增需求走 SRS 修订。
5. 未覆盖项必须显式标注“未覆盖 + 归属阶段”，不得留空冒充通过。

### 1.3 数量口径

| 对象 | 数量 | 来源 |
| :--- | :--- | :--- |
| 主文档功能需求 | 39 条（VIEW 4 + TOKEN 3 + CONFLICT 3 + WF 9 + AUDIT 4 + TASK 3 + WEB 6 + EMP 7） | SRS §4 |
| 员工需求 | 130 条（11 份分册） | `docs/员工需求/` |
| 非功能需求 | 26 条（NFR-001..022 + NFR-WEB-001..004） | SRS §10 |
| 用例 | 14 条（UC-001..014） | `usecases.yaml` |
| HTTP operation | 34 个 | `api.yaml` |
| DSH 工具 | 31 个 | `src/plugin/index.ts` |
| 实体 | 54 个 | `entities.yaml` / `migrations/` |
| 模块 | 20 条 | `modules.yaml` |

## 2. 总览

| 域 | REQ 数 | UC | 主要实现 | 主要测试 | 状态 |
| :--- | :-: | :--- | :--- | :--- | :--- |
| VIEW | 4 | UC-001 | `src/platform/views.ts` | `test/integration/platform.test.ts`、`api.test.ts` | 已实现 |
| TOKEN | 3 | UC-002 | `src/platform/token.ts` | `test/integration/platform.test.ts` | 已实现 |
| CONFLICT | 3 | UC-003 | `src/platform/conflict.ts` | `test/integration/platform.test.ts` | 已实现 |
| WF | 9 | UC-004/005/006 | `src/workflow/*.ts` | `test/integration/workflow.test.ts`、`unit/guard.test.ts` | 已实现（三关/影子 Phase 2） |
| AUDIT | 4 | UC-007 | `src/audit/audit.ts` | `test/integration/audit.test.ts` | 已实现 |
| TASK | 3 | UC-008/009 | `src/scheduler/*.ts` | `test/integration/scheduler.test.ts`、`unit/cron.test.ts` | 已实现 |
| WEB | 6 | UC-010..014 | `src/web/*.ts`、`src/api/http.ts` | `test/integration/web.test.ts`、`unit/web.test.ts` | 已实现（宿主适配 Phase 2） |
| EMP | 7 | — | `src/employees/*.ts` | `test/integration/employees.test.ts`、`unit/employees.test.ts` | 已实现（签名 Phase 2） |
| NFR | 26 | — | 跨模块 | 跨测试 + 人工审计 | 已实现/部分 Phase 2 |
| 员工分册 | 130 | 见各分册 | manifest 已实现，业务域 Phase 2 | `unit/employees.test.ts` | manifest 已实现；业务 Phase 2 |

## 3. 平台功能需求矩阵

| REQ | 需求名称 | UC | TC | 接口/工具 | 实现 | 测试文件 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| REQ-VIEW-001 | 视图级授权查询与拒绝审计 | UC-001 | TC-VIEW-001 | queryView | `platform/views.ts` | `platform.test.ts`、`api.test.ts` |
| REQ-VIEW-002 | 视图清单与员工授权声明 | UC-001 | TC-VIEW-001 | queryView / listEmployees | `platform/views.ts`、`employees/catalog.ts` | `platform.test.ts`、`employees.test.ts` |
| REQ-VIEW-003 | 敏感字段不落视图 | UC-002 | TC-TOKEN-002 | queryView | `platform/views.ts` | `platform.test.ts` |
| REQ-VIEW-004 | 跨域明细二次派工 | UC-001 | TC-VIEW-001 | queryView / need_detail | `platform/views.ts` | `platform.test.ts` |
| REQ-TOKEN-001 | 一次性令牌签发与消费 | UC-002 | TC-TOKEN-001 | issueToken / consumeToken | `platform/token.ts` | `platform.test.ts` |
| REQ-TOKEN-002 | 令牌范围与有效期约束 | UC-002 | TC-TOKEN-002 | issueToken / consumeToken | `platform/token.ts` | `platform.test.ts` |
| REQ-TOKEN-003 | 令牌日志不落敏感值 | UC-002 | TC-TOKEN-001 | consumeToken | `platform/token.ts`、`audit/audit.ts` | `platform.test.ts`、`audit.test.ts` |
| REQ-CONFLICT-001 | 冲突登记与冻结 | UC-003 | TC-CONFLICT-001 | openConflict | `platform/conflict.ts` | `platform.test.ts` |
| REQ-CONFLICT-002 | 汇总口径：总额含冻结 + 脚注 | UC-003 | TC-CONFLICT-001 | openConflict | `platform/conflict.ts` | `platform.test.ts` |
| REQ-CONFLICT-003 | 裁决卡与裁决后处置 | UC-003 | TC-CONFLICT-002 | resolveConflict | `platform/conflict.ts` | `platform.test.ts` |
| REQ-WF-001 | 流程注册与六项准入守卫 | UC-004 | TC-WF-001/002 | registerWorkflow | `workflow/registry.ts`、`guard.ts` | `workflow.test.ts`、`unit/guard.test.ts` |
| REQ-WF-002 | 流程实例与幂等节点 | UC-005 | TC-WF-003/004 | startInstance / completeNode | `workflow/instances.ts` | `workflow.test.ts` |
| REQ-WF-003 | Verifier 评判与低置信升级 | UC-006 | TC-WF-005 | recordVerdict | `workflow/verifier.ts` | `workflow.test.ts` |
| REQ-WF-004 | 风险等级硬规则 | UC-004 | TC-WF-002 | registerWorkflow | `workflow/registry.ts` | `unit/guard.test.ts` |
| REQ-WF-005 | 异常根因诊断与分流 | UC-006 | TC-WF-005 | recordVerdict / diagnose | `workflow/diagnose.ts` | `workflow.test.ts` |
| REQ-WF-006 | Registry 只读快照与高可用 | UC-004 | TC-WF-001 | registerWorkflow | `workflow/registry.ts` | `workflow.test.ts` |
| REQ-WF-007 | 回滚分阶段机制 | UC-004 | TC-WF-001 | registerWorkflow | `workflow/registry.ts` | `workflow.test.ts` |
| REQ-WF-008 | 灰度上线、观察期与膨胀治理 | UC-004 | TC-WF-002 | registerWorkflow | `workflow/registry.ts` | `workflow.test.ts` |
| REQ-WF-009 | 沙箱、三关测试与超时绑定 | UC-004 | TC-WF-001/003 | registerWorkflow / completeNode | `workflow/registry.ts`、`instances.ts` | `workflow.test.ts` |
| REQ-AUDIT-001 | 审计唯一写入口与记录范围 | UC-007 | TC-AUDIT-001 | listAudits | `audit/audit.ts` | `audit.test.ts` |
| REQ-AUDIT-002 | 哈希链增量导出与链头持久化 | UC-007 | TC-AUDIT-002 | exportAudits | `audit/audit.ts` | `audit.test.ts` |
| REQ-AUDIT-003 | 保留期、格式与可迁移性 | UC-007 | TC-AUDIT-002 | exportAudits | `audit/audit.ts` | `audit.test.ts` |
| REQ-AUDIT-004 | 恢复一致性校验与失败告警 | UC-007 | TC-AUDIT-001 | listAudits / verifyChain | `audit/audit.ts` | `audit.test.ts` |
| REQ-TASK-001 | 定时任务配置与执行 | UC-008 | TC-TASK-001 | listTasks / upsertTask / runTask | `scheduler/engine.ts`、`tasks/index.ts` | `scheduler.test.ts` |
| REQ-TASK-002 | 每日晨报聚合产出 | UC-009 | TC-TASK-004 | getDailyReport / runTask | `scheduler/tasks/index.ts` | `scheduler.test.ts`、`api.test.ts` |
| REQ-TASK-003 | 任务幂等、重试与告警 | UC-008 | TC-TASK-002/003 | runTask | `scheduler/engine.ts` | `scheduler.test.ts`、`unit/cron.test.ts` |
| REQ-WEB-001 | 插件栏入口与右侧面板 | UC-014 | TC-WEB-005 | getWebManifest | `web/services.ts`、`api/http.ts` | `web.test.ts` |
| REQ-WEB-002 | 会话桥与记忆桥 | UC-011 | TC-WEB-002 | grantSession / getSessionContext / searchMemory | `web/services.ts` | `web.test.ts` |
| REQ-WEB-003 | 上传/输入归置到十一域 | UC-010 | TC-WEB-001 | ingestText / confirmIngest | `web/classifier.ts`、`web/services.ts` | `web.test.ts`、`unit/web.test.ts` |
| REQ-WEB-004 | 驾驶舱只读聚合 | UC-012 | TC-WEB-003 | getDashboard | `web/dashboard.ts` | `web.test.ts` |
| REQ-WEB-005 | 插件雷达与关键词雷达 | UC-013 | TC-WEB-004 | listRadar / runTask | `web/plugin-score.ts`、`scheduler/tasks/index.ts` | `web.test.ts`、`unit/web.test.ts` |
| REQ-WEB-006 | 表现层权限、审计与隐私 | UC-011/012 | TC-WEB-002/003 | 全部 web 接口 | `web/services.ts`、`api/http.ts` | `web.test.ts` |
| REQ-EMP-001 | 员工插件清单与 manifest | — | TC-EMP-001 | listEmployees / opc_employee_list | `employees/catalog.ts` | `employees.test.ts`、`unit/employees.test.ts` |
| REQ-EMP-002 | 安装、启用、停用与卸载 | — | TC-EMP-002 | toggleEmployee / opc_employee_toggle | `employees/index.ts` | `employees.test.ts` |
| REQ-EMP-003 | 派工隔离与最小权限 | — | TC-EMP-001 | 装配与工具注册 | `employees/catalog.ts`、`plugin/index.ts` | `employees.test.ts` |
| REQ-EMP-004 | 版本、兼容与依赖 | — | TC-EMP-001 | listEmployees / importEmployeePackage | `employees/catalog.ts`、`employees/package.ts` | `employees.test.ts` |
| REQ-EMP-005 | 单员工/跨员工流程归属 | UC-004 | TC-WF-001 | registerWorkflow | `workflow/registry.ts` | `workflow.test.ts` |
| REQ-EMP-006 | 员工包导出 | — | TC-EMP-003 | exportEmployeePackage / opc_employee_export | `employees/package.ts` | `employees.test.ts` |
| REQ-EMP-007 | 员工包导入 | — | TC-EMP-003 | importEmployeePackage / opc_employee_import | `employees/package.ts` | `employees.test.ts` |

## 4. 员工线需求矩阵

员工分册的详细 REQ 见各文档；本表只追踪“需求文档 → manifest → 业务实现状态”。

| 文档 | 员工 | 员工代码 | 插件 ID | REQ 数 | manifest | 业务实现 | 测试 |
| :--- | :--- | :--- | :--- | :-: | :--- | :--- | :--- |
| OPC-SRS-101 | 财税管家 | FIN | `opc_finance` | 15 | `employees/catalog.ts` | Phase 2 | `unit/employees.test.ts` |
| OPC-SRS-102 | 法务官 | LEG | `opc_legal` | 12 | `employees/catalog.ts` | Phase 2 | `unit/employees.test.ts` |
| OPC-SRS-103 | 行政总管 | ADM | `opc_admin` | 12 | `employees/catalog.ts` | Phase 2 | `unit/employees.test.ts` |
| OPC-SRS-104 | 战略参谋 | STR | `opc_strategy` | 10 | `employees/catalog.ts` | Phase 2 | `unit/employees.test.ts` |
| OPC-SRS-105 | 项目监理 | PRJ | `opc_project` | 15 | `employees/catalog.ts` | Phase 2 | `unit/employees.test.ts` |
| OPC-SRS-106 | 情报官 | INT | `opc_intel` | 10 | `employees/catalog.ts` | Phase 2 | `unit/employees.test.ts` |
| OPC-SRS-107 | 客户管家 | CRM | `opc_crm` | 12 | `employees/catalog.ts` | Phase 2 | `unit/employees.test.ts` |
| OPC-SRS-108 | 车务官 | VEH | `opc_vehicle` | 12 | `employees/catalog.ts` | Phase 2 | `unit/employees.test.ts` |
| OPC-SRS-109 | 货栈总管 | INV | `opc_inv` | 12 | `employees/catalog.ts` | Phase 2 | `unit/employees.test.ts` |
| OPC-SRS-110 | WBS 员工 | WBS | `opc_wbs` | 10 | `employees/catalog.ts` | Phase 2 | `unit/employees.test.ts` |
| OPC-SRS-111 | 外宣员工 | PUB | `opc_publicity` | 10 | `employees/catalog.ts` | Phase 2 | `unit/employees.test.ts` |
| **合计** | — | — | — | **130** | 已实现 | 待 Phase 2 | manifest 校验已覆盖 |

> 说明：REQ 数为各分册文档中 `REQ-*` 条目统计，具体编号以各分册为准；业务实现未落地前，测试只覆盖 manifest、依赖、导入导出与隔离约束，不宣称业务功能通过。

## 5. 非功能需求矩阵

| REQ | 主题 | 验证方式 | 证据/测试 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| REQ-NFR-001 | 单机容量基线 | 配置审计 + 部署文档 | SDD §9、架构 §5.1 | 已定义 |
| REQ-NFR-002 | 连接与池化 | 连接池测试 + 审计 | `src/db/pool.ts`、SDD §9 | 已实现（PgBouncer 未启用） |
| REQ-NFR-003 | 向量检索参数 | 迁移/索引检查 | `migrations/`、DBDD | 已实现 |
| REQ-NFR-004 | Workflow 并发上限 | 配置检查 | `workflow/instances.ts` | 已实现 |
| REQ-NFR-005 | Verifier 调用成本 | 配置检查 | `workflow/verifier.ts` | 接口已定，真实模型 Phase 2 |
| REQ-NFR-006 | 定时任务时点 | cron 单测 | `unit/cron.test.ts` | 已实现 |
| REQ-NFR-007 | 备份 RPO/RTO | 恢复演练 | RMP R-06 | 待演练 |
| REQ-NFR-008 | 关键表逻辑备份 | 运维检查单 | SCMP §7 | 已定义 |
| REQ-NFR-009 | 失败重试与告警 | 调度/审计测试 | `scheduler.test.ts`、`audit.test.ts` | 已实现 |
| REQ-NFR-010 | 中断恢复幂等 | 流程测试 | `workflow.test.ts` | 已实现 |
| REQ-NFR-011 | 流程高可用演练 | 演练记录 | RMP R-01 | 待演练 |
| REQ-NFR-012 | 工作流超时取消 | 流程测试 | `workflow.test.ts` | 已实现 |
| REQ-NFR-013 | 数据不出私有网络 | 配置审计 | 架构 §七、部署文档 | 已定义 |
| REQ-NFR-014 | 审计写入权限最小化 | 部署审计 | DBDD §5.3 | 已定义，待演练 |
| REQ-NFR-015 | 审计完整性 | 哈希链测试 | `audit.test.ts` | 已实现 |
| REQ-NFR-016 | 敏感字段隔离 | 平台/令牌测试 | `platform.test.ts` | 已实现 |
| REQ-NFR-017 | 审计保留期 | 配置/代码审计 | `audit/audit.ts`、DBDD | 已实现 |
| REQ-NFR-018 | 测试与生产隔离 | 启动检查 + 测试 | `test/helpers.ts` | 已实现 |
| REQ-NFR-019 | 轻量可观测 | 健康检查/运维 | `api/http.ts`、SDD §9.3 | 已实现 |
| REQ-NFR-020 | 扩展触发条件 | 容量复盘 | 架构 §5.2 | 已定义 |
| REQ-NFR-021 | 迁移单向约束 | 迁移审计 | `scripts/migrate.ts` | 已实现 |
| REQ-NFR-022 | 向量维度变更 Runbook | 演练 | 架构 §2.1 | 待演练 |
| REQ-NFR-WEB-001 | 首屏与交互性能 | 性能测试 | `web.test.ts`（部分） | 部分覆盖 |
| REQ-NFR-WEB-002 | 隔离与最小暴露 | 安全审计 | `web.test.ts` | 已实现 |
| REQ-NFR-WEB-003 | 授权可撤回 | 会话测试 | `web.test.ts` | 已实现 |
| REQ-NFR-WEB-004 | 计划任务可恢复 | 调度测试 | `scheduler.test.ts` | 已实现 |

## 6. 用例与测试映射

| UC | 标题 | REQ | TC | 测试位置 |
| :--- | :--- | :--- | :--- | :--- |
| UC-001 | 视图级授权查询共享数据 | REQ-VIEW-001 | TC-VIEW-001 | `test/integration/platform.test.ts` |
| UC-002 | 一次性令牌签发与消费 | REQ-TOKEN-001 | TC-TOKEN-001/002 | `test/integration/platform.test.ts` |
| UC-003 | 冲突冻结与老板裁决 | REQ-CONFLICT-001 | TC-CONFLICT-001/002 | `test/integration/platform.test.ts` |
| UC-004 | 流程注册与准入守卫 | REQ-WF-001 | TC-WF-001/002 | `test/integration/workflow.test.ts`、`unit/guard.test.ts` |
| UC-005 | 流程实例与幂等节点 | REQ-WF-002 | TC-WF-003/004 | `test/integration/workflow.test.ts` |
| UC-006 | Verifier 评判与低置信升级 | REQ-WF-003 | TC-WF-005 | `test/integration/workflow.test.ts` |
| UC-007 | 审计写入与哈希链导出 | REQ-AUDIT-001 | TC-AUDIT-001/002 | `test/integration/audit.test.ts` |
| UC-008 | 定时自动化任务的配置与执行 | REQ-TASK-001 | TC-TASK-001/002/003 | `test/integration/scheduler.test.ts` |
| UC-009 | 每日晨报聚合产出 | REQ-TASK-002 | TC-TASK-004 | `test/integration/scheduler.test.ts` |
| UC-010 | 上传/输入归置到十一域 | REQ-WEB-003 | TC-WEB-001 | `test/integration/web.test.ts` |
| UC-011 | 会话与记忆授权读取 | REQ-WEB-002 | TC-WEB-002 | `test/integration/web.test.ts` |
| UC-012 | 驾驶舱快照聚合 | REQ-WEB-004 | TC-WEB-003 | `test/integration/web.test.ts` |
| UC-013 | 插件雷达与关键词雷达 | REQ-WEB-005 | TC-WEB-004 | `test/integration/web.test.ts` |
| UC-014 | 插件栏入口与右栏清单 | REQ-WEB-001 | TC-WEB-005 | `test/integration/web.test.ts` |

## 7. 缺口与处置

| 缺口 | 影响 | 处置 | 归属 |
| :--- | :--- | :--- | :--- |
| 真实 LLM Verifier 调用未接 | 流程评判依赖调用方 samples | Phase 2 接 `dsh-llm-verifier`；当前高风险人工复核 | P2 |
| 三关测试/影子运行未落地 | 自动固化闭环不完整 | Phase 2 接 `dsh-workflow-ptc` | P2 |
| 11 条员工线业务实现未落地 | 员工功能不可用 | 按法务→项目→情报→货栈→车务分批 | P2 |
| DSH Web 宿主未真实验证 | 面板/会话桥可能不兼容 | 三档适配验证 | P2 |
| 员工包签名/验签未实现 | 导入来源可信度不足 | Phase 2 加签名与可信源 | P2 |
| 备份恢复未演练 | RPO/RTO 未证实 | 每月一次恢复演练 | 运维 |
| PgBouncer 未启用 | 高并发连接风险 | 监控 + 扩容 + 必要时启用 | P2 |
| 性能 p95 未完整压测 | 驾驶舱性能未知 | 4C/16G 基准测试 | P2 |

> 缺口不隐藏：未覆盖项在 `OPC-STR-001` 与 `OPC-RMP-001` 均有对应登记；修复后在本表更新状态并补测试。

## 8. 自检清单

- [x] frontmatter 九字段齐全，`doc_id` 为 `OPC-RTM-001`，`status` 为评审稿，`updated` 为 2026-11-06。
- [x] 追踪链覆盖“需求→用例→接口→实现→测试→证据”。
- [x] 数量口径（39/130/26/14/34/31/54/20）与 SRS、README、spec、发布说明一致。
- [x] 平台 39 条功能需求逐条映射 UC/TC/接口/实现/测试文件。
- [x] 11 份员工分册按文档、插件 ID、REQ 数、manifest、实现状态、测试映射。
- [x] 26 条 NFR 逐条给验证方式、证据与状态，区分已实现/已定义/待演练。
- [x] 14 条 UC 全部映射到测试位置。
- [x] 缺口表与 SDD 10.1、STR 未覆盖项、RMP 风险一致。
- [x] 明确未覆盖项标注归属阶段，不把 Phase 2 写成通过。

## 9. 与其他文档的关系

| 文档 | 关系 | 说明 |
| :--- | :--- | :--- |
| [OPC-SRS-001 软件需求规格说明](OPC-SRS-001-软件需求规格说明.md) | 上游 | REQ 与 AC 的唯一来源 |
| [OPC-IRS-001 接口需求规格说明](OPC-IRS-001-接口需求规格说明.md) | 上游 | operation/工具契约 |
| [OPC-SDD-001 系统设计说明](OPC-SDD-001-系统设计说明.md) | 上游 | 模块、Phase 2 清单、偏差 |
| [OPC-STP-001 测试计划](OPC-STP-001-测试计划.md) | 上游 | 测试范围与策略 |
| [OPC-STD-001 测试设计说明](OPC-STD-001-测试设计说明.md) | 上游 | TC 设计与映射总表 |
| [OPC-STR-001 测试报告](OPC-STR-001-测试报告.md) | 下游 | 实际执行结果与未覆盖项 |
| [OPC-SQAP-001 软件质量保证计划](OPC-SQAP-001-软件质量保证计划.md) | 下游 | 覆盖率与门禁度量 |
| [spec/opc-xuanji/usecases.yaml](../spec/opc-xuanji/usecases.yaml) | 数据源 | UC/REQ/TC 的机器可读登记 |
| [docs/员工需求/index.md](员工需求/index.md) | 数据源 | 11 份员工分册索引 |
