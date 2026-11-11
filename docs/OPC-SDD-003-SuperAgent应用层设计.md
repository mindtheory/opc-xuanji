---
doc_id: OPC-SDD-003
title: OPC-玄机 · 一人公司中枢 Super Agent 应用层设计
version: 0.1
status: 评审稿
stage: D2
owner: OPC-玄机 产品与架构组
upstream: ["OPC-SDD-001 系统设计说明", "OPC-SDD-002 主会话 Agent 设定与运行设计", "OPC-SRS-001 软件需求规格说明", "dsh-super-agents docs/000–005（理念/领域/架构/工程/提示词/面板运维）", "deepseek-ai/dsh-superagent-prototype（理念基准）"]
gate: G2
updated: 2026-11-11
---

# OPC-玄机 · 一人公司中枢 Super Agent 应用层设计（OPC-SDD-003）

本文解决一个问题：**OPC-玄机如何作为应用层构建在 dsh-super-agents（基础设施层）之上**——员工矩阵怎样变成可自主干活的超级智能体、认知任务怎样派给它们、结果怎样回流到中枢的数据与审计、以及这套组合要遵守哪些从官方原型（dsh-superagent-prototype）继承的理念与纪律。读者：开发按第 4–7 章实现与验收；产品在装配 DSH Profile 时按第 8 章配置；评审在 G2 用第 9 章场景判断"员工是不是真的会自己干活"。

## 目录

1. [分层定位：应用层与基础设施层](#1-分层定位应用层与基础设施层)
2. [理念映射：注意力预算进一人公司](#2-理念映射注意力预算进一人公司)
3. [领域概念映射](#3-领域概念映射)
4. [集成契约：Bridge](#4-集成契约bridge)
5. [员工部署：manifest → 角色卡](#5-员工部署manifest--角色卡)
6. [任务双轨制：确定性任务与认知任务](#6-任务双轨制确定性任务与认知任务)
7. [健康、暂停与降级](#7-健康暂停与降级)
8. [配置与装配](#8-配置与装配)
9. [验收场景](#9-验收场景)
10. [被拒绝的方案](#10-被拒绝的方案)
11. [自检清单](#11-自检清单)
12. [与其他文档的关系](#12-与其他文档的关系)

## 1. 分层定位：应用层与基础设施层

```
┌─────────────────────────────────────────────────────────┐
│ 应用层  opc-xuanji（本仓库）                              │
│  业务规则：账/合同/税/库存/项目… 的表、视图、流程、审计    │
│  员工矩阵：11 个员工 manifest（身份、视图、工具、写目标）  │
│  确定性调度：stat.task_schedule（SQL 任务，幂等已内建）   │
│  桥：src/agents/bridge.ts —— 唯一跨层出口                │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP（回环）+ 工具面
┌──────────────────────────┴──────────────────────────────┐
│ 基础设施层  dsh-super-agents（mindtheory/dsh-super-agents）│
│  角色卡（Agent）· 调度（Schedule）· 运行（Run）·          │
│  产物（Artifact）· 经验册（Playbook）· 健康板 · 全局暂停  │
└──────────────────────────┬──────────────────────────────┘
                           │ sessionController
┌──────────────────────────┴──────────────────────────────┐
│ DSH 宿主：会话、模型、工具注册、Web                        │
└─────────────────────────────────────────────────────────┘
```

依赖方向**严格单向**：opc-xuanji 依赖 dsh-super-agents，反向零依赖。dsh-super-agents 不知道 OPC 的存在；OPC 的任何业务表、审计链、令牌机制都不下沉。两层的连接只有两个面：

1. **HTTP 契约**（`/api/dsh-super-agents/*`，回环）：Bridge 用它做角色卡同步、派活、回收、健康。选 HTTP 而非进程内直调的原因：两插件装配顺序解耦、可独立重启、可在测试里用桩服务器替代（见 §4）。
2. **工具面**（`sa_*` 注册在宿主）：主会话（幕僚长）可以直接对 `sa_*` 说话干活；opc_* 工具提供的是**带业务语义的编排**（部署员工、按员工派活并回流审计），两者并存不冲突。

中枢的既有边界不变：**员工不直连数据库**，一切写库经中枢视图与令牌。派给超级智能体的任务产出是**产物文件**，回流后由人（或流程）决定是否入库——产物本身不是授权。

## 2. 理念映射：注意力预算进一人公司

继承 dsh-super-agents docs/000（源头是官方原型）的核心原则：**拿走尽可能少的人类注意力，给出尽可能多的价值**。落到一人公司：

| 原则 | 原型出处 | OPC 落地 |
| --- | --- | --- |
| 只在被要求或规则允许时行动 | 000 | 员工 agent 不自主发起写库；认知任务由调度（老板写下的规则）或幕僚长派活触发 |
| 只在人必须行动时说话 | 000 | 员工 Run 的产物第一行是一句话结论；晨报/预警走既有 digest 通道，不新增消息面 |
| 一次只问一个具体问题 | 000 | 裁决卡（SDD-002 §9）是唯一"问老板"的结构，员工 agent 无权直接问人 |
| 按影响停下 | 000 | 认知任务产物若含"未完成："前缀，回流状态为 draft，进待办不进台账 |
| 诚实报告 | 000 | `done_no_artifact` 视为失败级事实（需要人），与中枢审计口径一致 |
| 概念要少、设置要少 | 000 | 桥不引入新概念：员工=角色卡、派活=Run、沉淀=Playbook，全部复用基础设施层概念 |

## 3. 领域概念映射

| OPC 概念 | 基础设施层概念 | 映射规则 |
| --- | --- | --- |
| 员工（EmployeeManifest） | Agent 角色卡 | `pluginId` ↔ agent 名；`displayName + employeeCode + 职责段` 渲染 systemRole；员工 `tools` 不进角色卡（员工工具仍由中枢 opc_* 承担，agent 只产文书） |
| 员工沉淀（三级沉淀之"经验"） | Playbook | 员工启用 learn，Run 后自动蒸馏；playbook 即员工经验册 |
| 认知类定时任务 | Schedule（cron + tz） | 由 `opc_agent_schedule` 登记到基础设施层，tz 固定 Asia/Shanghai（中枢口径） |
| 任务执行 | Run + Artifact | 产物落 `<archiveDir>/agent-runs/`（run cwd 内），第一行一句话结论 |
| 中枢健康（/api/v1/health） | 健康板 | health 聚合 sa_health 条目；`error` 条目透传为中枢 health 的 degraded |
| 全局暂停 | sa_health pause | 中枢 `opc_agent_pause` 代理；暂停期间确定性任务照常（它们是 SQL），认知任务停发 |

Run 状态判定表直接复用基础设施层（001-domain），OPC 侧不另立状态机；回流映射：`done → 产物待审`、`done_no_artifact/failed/timeout/interrupted → 需要人`。

## 4. 集成契约：Bridge

`src/agents/bridge.ts` 是唯一跨层出口，类 `SuperAgentsBridge`：

```
构造(baseUrl, fetchImpl?, timeoutMs?)       // baseUrl 默认 http://127.0.0.1:3081
health(): {ok, paused, problems[], queue, active}
upsertAgent({name, systemRole, model?, cwd?, learn?}): agent
listAgents(): agent[]
dispatch(agentId, prompt, opts?): runId
runResult(runId): {status, resultText}
runs(agentId?, limit?): run[]
pause(on: boolean): void
```

契约纪律（继承基础设施层 002-architecture 的端口思想）：

- **超时与降级**：每请求默认 8s；连接失败抛 `OpcError(ERR.AGENT_UNAVAILABLE)`（`ERR-AGENT-001`），调用方（工具层）转成对用户可读的降级文案，不崩中枢。
- **幂等**：`upsertAgent` 以 agent 名为键（先 list 后 create/update），重复部署安全；`dispatch` 不做幂等承诺（人确实可能连派两单），但返回 runId 供追踪。
- **无凭据**：桥只走回环 HTTP，不带任何 token；跨主机部署属于被拒方案（§10）。
- **可测**：`fetchImpl` 可注入，单元测试用本地桩 HTTP 服务器验证请求形状与错误映射，不依赖真实插件。

## 5. 员工部署：manifest → 角色卡

`opc_employee_deploy(pluginId)`：读取员工 manifest（catalog/package 既有校验），渲染角色卡并 upsert 到基础设施层：

- systemRole 模板（固定文本，可被员工包 `agentRole` 字段覆盖）：员工身份 + 汇报口径（第一行一句话结论）+ 边界（不写库、不问人、产物即交付）。
- `cwd` 默认 `<archiveDir>/agent-runs/<pluginId>`（保证产物可回流、可审计定位）。
- `learn: true`（员工经验册默认开启；员工包可关）。
- 部署结果写审计（action=`employee.deploy`，复用 AuditService 哈希链）。
- 停用员工（`opc_employee_toggle false`）不删角色卡——与"停用不删数据"的既有口径一致；停用的员工由桥在 dispatch 时拒绝（agent.enabled=false 时基础设施层本就拒派）。

## 6. 任务双轨制：确定性任务与认知任务

中枢调度保持双轨，边界清晰：

| 轨道 | 载体 | 适合 | 例子 |
| --- | --- | --- | --- |
| 确定性任务 | `stat.task_schedule`（既有 Scheduler，(task_id, scheduled_at) 幂等） | SQL 可完成、结果结构化 | 晨报聚合、税务预警、审计导出、月归档 |
| 认知任务 | dsh-super-agents Schedule/Run | 需要读文档、写分析、做判断 | 合同到期前的续约要点草拟、竞对情报周报、客户跟进话术 |

判断口径：**能用 SQL 说清楚"要什么"的留在确定性轨道；需要"像人一样读和写"的走认知轨道。** 认知任务经 `opc_agent_schedule` 登记（cron + tz=Asia/Shanghai + 员工 agentId + 任务文本），到点由基础设施层自动派 Run；产物回流由幕僚长在会话中回收（`opc_agent_result`），需要入库的走既有视图/令牌流程。

## 7. 健康、暂停与降级

- `GET /api/v1/health` 增加 `agents` 段：`{reachable, paused, problems[], queue, active}`；`reachable=false` 或存在 `error` 条目时整体 status 仍 `ok` 但 `degraded:true`（中枢自身没坏，是依赖降级）。
- `opc_agent_health`：工具面同数据，供幕僚长巡检。
- `opc_agent_pause(on)`：代理基础设施层全局暂停；确定性任务不受影响（口径见 §6）。
- 降级文案统一：桥不可用时所有 agent 类工具返回同一错误码 `ERR-AGENT-001` 与指引（"确认 dsh-super-agents 已安装并在同一 web profile 启用"）。

## 8. 配置与装配

`HubConfig` 新增 `superAgentsUrl?: string`（默认 `http://127.0.0.1:3081`）；`cordis.patch.yml` 注释示例同步。装配前置：同一 DSH profile 安装 dsh-super-agents（其面板 API 默认回环可达）。无 dsh-super-agents 时中枢完整可用（确定性轨道、视图、审计全部照常），仅 agent 类工具降级——**软依赖，非硬依赖**。

## 9. 验收场景

1. **部署**：`opc_employee_deploy("finance")` → 基础设施层出现「财税管家」角色卡；重复部署不产生第二张卡（幂等）。
2. **派活回流**：`opc_agent_dispatch(agentId, "草拟本月进项缺失发票清单要点")` → 返回 runId；`opc_agent_result` 拿到产物，第一行为一句话结论。
3. **认知调度**：`opc_agent_schedule` 挂 `0 9 * * 1`（周一 09:00 Asia/Shanghai）→ 到点自动 Run（基础设施层 runs 列表可见，occurrence 幂等）。
4. **降级**：桩环境关闭基础设施层 → `opc_agent_health` 返回 `reachable:false`，dispatch 返回 `ERR-AGENT-001`，中枢其余功能不受影响。
5. **暂停**：`opc_agent_pause(true)` → 基础设施层 paused=true；确定性任务下一次 tick 照常执行；认知调度不触发。
6. **审计**：deploy 与 pause 操作在 audit 哈希链中可查（action 前缀 `employee.` / `agent.`）。

## 10. 被拒绝的方案

| 方案 | 拒绝理由 |
| --- | --- |
| 进程内直调 dsh-super-agents 内部函数 | 插件间私有 API 不稳定；装配顺序耦合；测试无法隔离。HTTP 契约是公开且已验证的面 |
| 把 OPC 业务表迁进 dsh-super-agents | 基础设施层必须业务无关（其 001 被拒概念：事件源/业务域不进核心） |
| 员工 agent 直接写 OPC 数据库 | 破坏"员工不直连数据库"的既有硬边界与令牌审计 |
| 用 sa_schedule 全面替换 stat.task_schedule | 确定性任务需要 SQL 事务内幂等与审计哈希链，SQL 轨道更合适；双轨边界见 §6 |
| 跨主机部署基础设施层（HTTP 走公网） | 回环信任模型被破坏；需要引入鉴权体系，超出应用层职责 |
| 员工 agent 之间直接互发消息 | 继承基础设施层被拒概念：注意力不可审计；协作只经产物与中枢编排 |

## 11. 自检清单

- [x] 依赖方向单向（opc → dsh-super-agents），反向零依赖（§1）
- [x] 不新增业务概念，全部映射到基础设施层既有概念（§3）
- [x] 员工不直连数据库的边界未被破坏（§5、§10）
- [x] 桥有超时、错误码、幂等与可测性约定（§4）
- [x] 软依赖：无基础设施层时中枢完整可用（§8）
- [x] 错误码 ERR-AGENT-001/002 已登记 api.yaml（防漂移测试同步）
- [x] 验收场景可执行、可回归（§9）

## 12. 与其他文档的关系

- 上游：OPC-SDD-001（模块划分，本文新增 `agents` 模块）、OPC-SDD-002（幕僚长使用 agent 工具的行为约定）、OPC-SRS-001（员工矩阵需求不变）。
- 平行：dsh-super-agents docs/000–005 —— 本文是其"应用层接入范例"，理念与纪律以该系列为准。
- 下游：spec/opc-xuanji/modules.yaml 新增 `agents` 模块；api.yaml errorCodes 增补；README/CHANGELOG 同步。
