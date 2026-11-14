---
doc_id: OPC-SUM-002
title: 员工需求分册索引
version: 0.1
status: 评审稿
stage: D1
owner: 玄机文档组
upstream: [OPC-SRS-001]
gate: G1
updated: 2026-11-06
---

# 员工需求分册索引

员工线需求从 `OPC-SRS-001` 拆分为一人一份独立文档。主 SRS 只保留平台级约束、员工插件可插拔/打包导入导出要求与索引；本目录每份文档负责该员工的定位、可插拔契约、功能需求与验收。

| 文档 | 员工 | 员工代码 | 插件 ID | 主要写入 | 分册 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| OPC-SRS-101 | 财税管家（CFO/会计/税务/工商/分析） | FIN | `opc_finance` | 报销/凭证/科目/报表/税务/工商/税筹/分析 | [财税管家](OPC-SRS-101-财税管家.md) |
| OPC-SRS-102 | 法务官 | LEG | `opc_legal` | contract / risk_rule | [法务官](OPC-SRS-102-法务官.md) |
| OPC-SRS-103 | 行政总管 | ADM | `opc_admin` | event / action_item | [行政总管](OPC-SRS-103-行政总管.md) |
| OPC-SRS-104 | 战略参谋 | STR | `opc_strategy` | objective / decision | [战略参谋](OPC-SRS-104-战略参谋.md) |
| OPC-SRS-105 | 项目监理（全生命周期/里程碑/甘特/OKR/软件研发要素） | PRJ | `opc_project` | 项目/章程/里程碑/任务/依赖/基线/变更/风险/验收/收尾/OKR/Git-SVN/制品库/环境发布/测试 | [项目监理](OPC-SRS-105-项目监理.md) |
| OPC-SRS-106 | 情报官（项目日报/数据源/关键词标签/五阶段流水线） | INT | `opc_intel` | 项目空间/数据源/关键词标签/条目/日报/采集与推送运行/线索/尽调 | [情报官](OPC-SRS-106-情报官.md) |
| OPC-SRS-107 | 客户管家 | CRM | `opc_crm` | customer / customer_sensitive / commitment / quote | [客户管家](OPC-SRS-107-客户管家.md) |
| OPC-SRS-108 | 车务官 | VEH | `opc_vehicle` | vehicle_log / subsidy_standard | [车务官](OPC-SRS-108-车务官.md) |
| OPC-SRS-109 | 货栈总管 | INV | `opc_inv` | sku / stock_txn | [货栈总管](OPC-SRS-109-货栈总管.md) |
| OPC-SRS-110 | WBS 员工 | WBS | `opc_wbs` | wbs_node / wbs_baseline / wbs_change | [WBS 员工](OPC-SRS-110-WBS员工.md) |
| OPC-SRS-111 | 外宣员工 | PUB | `opc_publicity` | publication_plan / publication / publication_approval / channel_account | [外宣员工](OPC-SRS-111-外宣员工.md) |

## 可插拔统一约定

1. 每个员工一个插件 ID、一份 manifest；manifest 声明 `required_views`、`tools`、`write_targets`、`single_workflows`、`dependencies`、`min_hub_version`。
2. 停用后不再派工、工具不可见、单员工流程不启动；历史数据只读保留。
3. 卸载默认保留业务数据；删除须老板确认并写数据删除审计。
4. 员工之间不得直连私有表；跨域明细经 `need_detail` 或一次性令牌。
5. 员工包导入导出见 `OPC-SRS-001` REQ-EMP-006/007 与 `OPC-IRS-001` P29–P34。

## 自检清单

- [x] 11 个员工均有独立分册，编号唯一。
- [x] 每份分册声明插件 ID、视图、工具、写目标与单员工流程。
- [x] 主 SRS 不再重复员工详细需求，只保留索引与平台约束。
- [x] 新员工（WBS、外宣）已纳入分册与可插拔契约。

## 与其他文档的关系

- 上游：`OPC-SRS-001`（主需求）、产品设计 §三/§四。
- 下游：`OPC-IRS-001`（工具契约）、`OPC-SDD-001`（模块设计）、`OPC-DBDD-001`（表结构）、`OPC-STD-001`（测试设计）。
