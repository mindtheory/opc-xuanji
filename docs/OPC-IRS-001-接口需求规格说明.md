---
doc_id: OPC-IRS-001
title: OPC-玄机 · 一人公司中枢 接口需求规格说明
version: 0.4
status: 评审稿
stage: D1
owner: 玄机文档组
upstream: ["spec/opc-xuanji/api.yaml（0.4.0，62 operation）", "spec/opc-xuanji/usecases.yaml（v2.11 基线）", "OPC-SRS-001-软件需求规格说明.md（v0.3）", "PA-OPC-023", "OPC-玄机 · 技术选型与系统架构.md（v2.12）"]
gate: G1
updated: 2026-11-14
---

# OPC-玄机 · 一人公司中枢 接口需求规格说明

本文档解决"中枢对外到底承诺什么形状"这个问题：把 `spec/opc-xuanji/api.yaml` 的 89 个 `/api/v1` operation 与 DSH 上的 `opc_*` 工具，写成开发可直接照做、测试可直接照验的接口需求——每个接口的用途、调用方、入参出参、错误码、幂等与重试、鉴权与审计六项齐全，并且统一 Result 口径（成功 `code=0`；失败 `code=<http 状态>` + `errorCode` + `message` + `details`）。使用者与时机：后端在 D2 设计前用它确定契约边界；前端/插件在联调前用它对齐字段；测试在 G2 契约门禁前用它逐 operation 断言。凡本文未在 `api.yaml` 登记的错误码、字段、枚举值，一律视为契约外内容，不得实现。

## 目录

1. [通用约定（Result 口径与横切规则）](#1-通用约定result-口径与横切规则)
2. [接口清单（89 个 /api/v1 operation）](#2-接口清单89-个-apiv1-operation)
3. [平台类接口（P1–P6）](#3-平台类接口p1p6)
4. [流程类接口（P7–P10）](#4-流程类接口p7p10)
5. [审计类接口（P11–P12）](#5-审计类接口p11p12)
6. [调度类接口（P13–P16）](#6-调度类接口p13p16)
7. [Web 表现层接口（P17–P28）](#7-web-表现层接口p17p28)
8. [DSH 工具契约（工具即接口）](#8-dsh-工具契约工具即接口)
9. [错误码与失败语义总表](#9-错误码与失败语义总表)
10. [接口验收与追溯](#10-接口验收与追溯)

## 1. 通用约定（Result 口径与横切规则）

### 1.1 Result 口径（唯一口径，所有接口所有工具一律适用）

| 场景 | `code` | 其余字段 | HTTP 状态 | 示例来源 |
| :----------- | :------------------ | :----------------------------------------- | :----------- | :-------------------- |
| 成功 | `0` | `data`（对象或数组） | 200 / 201 | `src/api/http.ts` 成功分支 |
| 失败 | **等于 HTTP 状态码** | `errorCode`（`ERR-<域>-<3位>`）、`message`、`details` | 400/403/404/409/422/500/503 | `src/api/http.ts` 异常分支 |

成功响应示例（`queryView`）：

```json
{
  "code": 0,
  "data": {
    "viewId": "view_ar_ap",
    "rows": [
      { "counterparty": "某某商行", "amount": 12800.00, "due": "2026-11-20", "status": "未结" }
    ],
    "rowCount": 1
  }
}
```

失败响应示例（未授权视图，HTTP 403）：

```json
{
  "code": 403,
  "errorCode": "ERR-AUTHZ-001",
  "message": "视图未授权：pluginId=opc_finance 未获得 view_vehicle_index",
  "details": null
}
```

三条不可协商的规则：

- **R1** 成功一定是 `code=0` 且带 `data`；失败一定不带 `data`，只有 `errorCode`/`message`/`details`。
- **R2** 失败时 `code` 与 HTTP 状态码必须一致，禁止 `HTTP 200 + code=500` 这种"软失败"。
- **R3** `message` 面向人（中文、可读、含定位信息），`errorCode` 面向程序（稳定、不复用、不随文案变）。调用方按 `errorCode` 分流，禁止按 `message` 文本匹配。

### 1.2 错误码登记与 HTTP 映射

| errorCode | 默认 HTTP | 语义 | 出现在哪些接口 |
| :---------------- | :------- | :------------------------------------- | :----------------------------------------------- |
| ERR-VIEW-001 | 400 | 视图 ID 未登记（8 个视图之外） | queryView |
| ERR-AUTHZ-001 | 403 | 视图未授权 / 越权访问 | queryView |
| ERR-TOKEN-001 | 400 / 409 | 令牌范围或有效期非法；令牌已用或已过期 | issueToken、consumeToken |
| ERR-CONFLICT-001 | 400 / 404 | 冻结单元不合法；冲突不存在 | openConflict、resolveConflict |
| ERR-WF-001 | 422 | 准入守卫失败；Verifier 评判不合法 | registerWorkflow、recordVerdict |
| ERR-WF-002 | 409 | 流程版本冲突（同版本重复注册且内容不同） | registerWorkflow |
| ERR-WF-003 | 404 | 流程未注册或版本不存在 | startInstance |
| ERR-WF-004 | 409 | 幂等键冲突且入参不同 | completeNode |
| ERR-AUDIT-001 | 500 | 审计写入或导出失败 | listAudits、exportAudits |
| ERR-TASK-001 | 400 | cron 无法解析或任务类型未注册 | upsertTask |
| ERR-TASK-002 | 404 | 任务不存在 | runTask |
| ERR-RES-001 | 400 | 基础资源参数或类型非法 | createSharedResource、updateSharedResource、bindProjectSharedResources |
| ERR-RES-002 | 400 | 凭据不是 `env:/secret:/vault:/ssh-agent:` 引用（疑似明文） | createSharedResource、updateSharedResource |
| ERR-RES-003 | 404 | 基础资源或项目绑定不存在 | updateSharedResource、deleteSharedResource、unbindProjectSharedResource |
| ERR-RES-004 | 409 | 基础资源仍被项目绑定，不能删除 | deleteSharedResource |
| ERR-AUTO-001 | 400 | 自动驾驶参数非法（仓库地址/项目不存在/未装配服务） | createAdminProject、bootstrapProjectAutopilot |
| ERR-AUTO-002 | 502 | 版本库检出失败（地址不可达/非仓库/超时/缺少 svn 客户端） | bootstrapProjectAutopilot |
| ERR-AUTO-003 | 400 | 检出凭据不是可用的 env: 引用 | bootstrapProjectAutopilot |
| ERR-AUTO-004 | 404 | 裁决项不存在或已处理 | decideProjectDecision |
| ERR-AUTO-005 | 502 | 测试环境发布执行失败（命令/健康检查） | deployProjectTest |
| ERR-OPS-001 | 400 / 503 | 运维反馈参数/服务未装配 | getUsageSummary、generateUsageInsight、listIssues、syncIssues |
| ERR-OPS-002 | 502 | GitHub 投递失败（网络/鉴权/限流） | syncIssues |
| ERR-IDEA-001 | 400 | 创意为空/过长/文档字段非法 | analyzeIdea、createProjectFromIdea |
| ERR-IDEA-002 | 413 / 415 / 422 | 文档过大、格式不支持或解析不出文本 | analyzeIdea、createProjectFromIdea |
| ERR-WECHAT-001 | 400 / 503 | 微信推送参数非法或服务未装配 | getWechatStatus、pushWechatText、syncWechatOutbox |
| ERR-SYS-001 | 500 / 503 | 未分类系统错误；依赖不可用 | 全部接口（兜底） |

错误码以 `api.yaml` 的 `errorCodes`（当前 35 个）为唯一事实来源，本表登记平台与基础资源主要码；项目/情报/员工码见 §7.5、§7.6 与 §9.1。新增错误码必须先登记 `api.yaml` 再实现。

### 1.3 调用方与鉴权约定

| 调用方 | 可达接口 | 鉴权要求 | 出处 |
| :----------------- | :----------------------------------------- | :------------------------------------------------------------- | :------------- |
| 员工插件（经中枢工具层） | 视图、令牌、冲突登记、流程实例与节点、审计写入 | `pluginId` 已在 `ref.employee_plugin` 注册且 `enabled=true`；`required_views` 覆盖目标视图 | 产品设计 §2.4、§8.2 |
| 老板交互层（DSH Web） | 全部接口，含裁决、任务配置、晨报 | 唯一人类决策者，全视图；裁决与观察期确认仅此通道 | 产品设计 §3、§8.2 |
| 中枢平台能力（Registry / Verifier / audit / diagnose） | 流程注册、评判、审计导出 | 平台能力，不注册业务工具、不参与派工竞争；非员工 | 产品设计 §三、§2.4 |
| 调度器 | 任务执行、晨报产出 | 内部进程身份，按任务配置执行 | 产品设计 §六；UC-008 |
| 兼职 / 外包 / 只读 | 视图只读子集 | 模块白名单；默认禁用财税、法务、客户敏感视图；只读不可写不可裁决 | 产品设计 §8.2 |

鉴权判定顺序固定为：①身份与注册状态 → ②视图/字段范围授权 → ③入参 schema 校验 → ④执行。任一步失败即返回对应错误码，**失败也必须写审计**（视图访问与令牌场景强制，其余接口同）。

### 1.4 审计要求（横切）

| 接口类别 | 审计动作名 | 必录字段 |
| :----------------------- | :------------------- | :------------------------------------------------------------------- |
| 健康检查 | 不写审计 | — |
| 视图查询 | `view.query` | pluginId、viewId、结果（通过/拒绝）、workflow_instance_id（流程内自动注入） |
| 令牌签发 / 消费 | `token.issue`、`token.consume` | token_id、task_id、字段名清单、结果；**不落字段值** |
| 冲突登记 / 裁决 | `conflict.open`、`conflict.resolve` | conflict_id、冻结单元、choice、受影响报表清单 |
| 流程注册 / 实例 / 节点 / 评判 | `workflow.register`、`workflow.start`、`node.complete`、`verdict.record` | workflow_instance_id、node_id、守卫结果或 verdict、evidence_hash |
| 审计查询 / 导出 | `audit.query`、`audit.export` | 查询条件、导出文件路径、SHA-256、rowCount、prev_hash |
| 任务配置 / 执行 | `task.upsert`、`task.run` | task_id、cron、scheduled_at、幂等命中与否、执行结果 |

审计**只经中枢统一写入口** `opc_hub.audit.record` 落库；数据库角色对 `audit.audit_log` 只有 INSERT 权限（产品设计 §8.4；架构 §七）。任何接口实现不得直写审计表。

### 1.5 幂等与重试总约定

| 约定 | 内容 |
| :----------- | :----------------------------------------------------------------------------------------------------------------- |
| 天然幂等 | 只读接口（health、listAudits、listTasks、getDailyReport、queryView）可安全重试，调用方重试次数不限但须退避。 |
| 幂等键 | 写节点用 `(instanceId, nodeId)`；任务执行用 `(taskId, scheduled_at)`；两者均由中枢生成或校验，不由调用方自造。 |
| 一次性 | `consumeToken` 只能成功一次；收到 409 后**不得重试**，须重新走 `issueToken`。 |
| 不可重试 | `issueToken`、`openConflict`、`registerWorkflow`、`runTask`（非 force）在超时后不得盲目重试，须先查询既有结果再决定。 |
| 可重试 | `exportAudits` 失败按重试 3 次处理，仍失败则即时告警（不静默失败）；`recordVerdict` 可按 `evidence_hash` 去重后重试。 |
| 重试上限 | 审计导出重试 3 次；自动修复迭代 `max_iterations` 默认 5；两者数值来自产品设计 §8.4、§8.6.9.3，不得改口径。 |

### 1.6 数据格式约定

| 项 | 约定 |
| :------------- | :------------------------------------------------------------------------------- |
| 请求体 | JSON，字段名 camelCase（与 `api.yaml` 的 schema 一致，如 `pluginId`、`fieldScope`、`ttlSeconds`） |
| 存储字段 | snake_case（与 `entities.yaml` 一致，如 `plugin_id`、`field_scope`、`expires_at`）；接口层做一次映射，不在契约中混用 |
| 时间 | RFC 3339 字符串，带时区偏移（如 `2026-11-05T08:30:00+08:00`）；日期用 `format: date`（如 `2026-11-05`） |
| 时区 | 中枢默认 `Asia/Shanghai`；任务以自身配置的 `timezone` 为准 |
| 分页 | `limit` 为正整数，`listAudits` 的 `limit` 上限 500（`api.yaml` 已声明 `maximum: 500`）；不提供 offset 游标之外的排序参数 |
| 空值 | 未提供的可选字段不出现或为 `null`，不用空字符串代替缺失 |
| 金额 | 十进制数，单位为元；不做隐式单位换算 |

### 1.7 契约治理

- `api.yaml` 是接口契约的唯一事实来源；本文与 `api.yaml` 冲突时以 `api.yaml` 为准，并回写本文。
- 新增/修改接口、字段、枚举、错误码，必须先改 `api.yaml`，再改本文，再改实现，同一需求同一提交序列（不允许先改代码后补 spec）。
- 破坏性变更（删字段、改语义、收紧必填）须在本文"与其他文档的关系"记录变更点并升 `version`。

## 2. 接口清单（114 个 /api/v1 operation）

> 本表详列 P1–P49（平台/流程/调度/Web/员工/项目研发）。P50–P101 管理面（项目/情报 Web 控制台、公司基础资源、项目自动驾驶与自动化生产、运维反馈、创意转项目、微信推送）见 §7.6；完整 operationId、路径与方法以 `spec/opc-xuanji/api.yaml` 为准。

| # | 方法 | 路径 | operationId | 用途 | 主要调用方 | 成功码 | 错误码 | 对应 REQ |
| :--- | :--- | :------------------------------------------ | :--------------- | :-------------------------------- | :----------------- | :----- | :----------------------- | :--------------------- |
| P1 | GET | `/api/v1/health` | health | 进程 + PG + pgvector + 调度器状态 | 运维 / 看板 | 200 | ERR-SYS-001 | REQ-NFR-019 |
| P2 | POST | `/api/v1/views/{viewId}/query` | queryView | 视图级授权只读查询 | 员工插件 | 200 | ERR-AUTHZ-001、ERR-VIEW-001 | REQ-VIEW-001..004 |
| P3 | POST | `/api/v1/tokens` | issueToken | 签发一次性令牌 | 中枢 | 201 | ERR-TOKEN-001 | REQ-TOKEN-001、002 |
| P4 | POST | `/api/v1/tokens/{tokenId}/consume` | consumeToken | 消费一次性令牌 | 员工插件 | 200 | ERR-TOKEN-001 | REQ-TOKEN-001..003 |
| P5 | POST | `/api/v1/conflicts` | openConflict | 登记冲突并冻结业务事件 | 员工插件 / 中枢 | 201 | ERR-CONFLICT-001 | REQ-CONFLICT-001、002 |
| P6 | POST | `/api/v1/conflicts/{conflictId}/resolve` | resolveConflict | 老板裁决冲突 | 老板 | 200 | ERR-CONFLICT-001 | REQ-CONFLICT-003 |
| P7 | POST | `/api/v1/workflows` | registerWorkflow | 注册流程版本（六项守卫） | 中枢 Registry | 201 | ERR-WF-001、ERR-WF-002 | REQ-WF-001、004、006..009 |
| P8 | POST | `/api/v1/workflows/{workflowId}/instances` | startInstance | 启动流程实例 | 员工插件 / 中枢 | 201 | ERR-WF-003 | REQ-WF-002 |
| P9 | POST | `/api/v1/instances/{instanceId}/nodes/{nodeId}/complete` | completeNode | 完成写节点（幂等） | 员工插件 | 200 | ERR-WF-004 | REQ-WF-002 |
| P10 | POST | `/api/v1/instances/{instanceId}/nodes/{nodeId}/verdict` | recordVerdict | 记录 Verifier 评判 | Verifier | 200 | ERR-WF-001 | REQ-WF-003、005 |
| P11 | GET | `/api/v1/audits` | listAudits | 审计分页查询 | 老板 / 审计归档任务 | 200 | ERR-AUDIT-001 | REQ-AUDIT-001 |
| P12 | POST | `/api/v1/audits/export` | exportAudits | 增量导出 JSONL + SHA-256 | 审计归档任务 | 201 | ERR-AUDIT-001 | REQ-AUDIT-002..004 |
| P13 | GET | `/api/v1/tasks` | listTasks | 列出定时任务与下次触发时间 | 老板 | 200 | ERR-SYS-001 | REQ-TASK-001 |
| P14 | PUT | `/api/v1/tasks/{taskId}` | upsertTask | 新增/更新定时任务 | 老板 | 200 | ERR-TASK-001 | REQ-TASK-001 |
| P15 | POST | `/api/v1/tasks/{taskId}/run` | runTask | 立即执行一次任务 | 老板 / 调度器 | 200 | ERR-TASK-002 | REQ-TASK-001、003 |
| P16 | GET | `/api/v1/reports/daily` | getDailyReport | 读取指定日期晨报 | 老板 | 200 | ERR-SYS-001 | REQ-TASK-002 |
| P17 | GET | `/api/v1/web/manifest` | getWebManifest | 插件栏入口与右栏页签 | 老板 / DSH Web | 200 | — | REQ-WEB-001 |
| P18 | GET | `/api/v1/web/dashboard` | getDashboard | 驾驶舱只读快照 | 老板 / DSH Web | 200 | — | REQ-WEB-004 |
| P19 | GET | `/api/v1/web/inbox` | listIngestInbox | 待归置收件箱 | 老板 | 200 | — | REQ-WEB-003 |
| P20 | POST | `/api/v1/web/ingest` | ingestText | 归置上传/会话输入 | 老板 / opc_web | 201/200 | ERR-WEB-001 | REQ-WEB-003 |
| P21 | POST | `/api/v1/web/ingest/{id}/confirm` | confirmIngest | 确认/忽略归置项 | 老板 | 200 | ERR-WEB-001 | REQ-WEB-003 |
| P22 | PUT | `/api/v1/web/sessions/{sessionId}/grant` | grantSession | 授予会话读取范围 | 老板 | 201 | ERR-WEB-001 | REQ-WEB-002 |
| P23 | DELETE | `/api/v1/web/sessions/{sessionId}/grant` | revokeSession | 撤回会话授权 | 老板 | 200 | ERR-WEB-001 | REQ-WEB-002 |
| P24 | GET | `/api/v1/web/sessions/{sessionId}/context` | getSessionContext | 读取已授权会话 | opc_web | 200 | ERR-WEB-001 | REQ-WEB-002 |
| P25 | POST | `/api/v1/web/memory/search` | searchMemory | 按 scope 检索记忆 | opc_web | 200 | ERR-WEB-001 | REQ-WEB-002 |
| P26 | POST | `/api/v1/web/memory/propose` | proposeMemory | 提出记忆写入建议 | opc_web | 201 | ERR-WEB-001 | REQ-WEB-002 |
| P27 | POST | `/api/v1/web/memory/proposals/{id}/confirm` | confirmMemoryProposal | 确认记忆提议 | 老板 | 200 | ERR-WEB-001 | REQ-WEB-002 |
| P28 | GET | `/api/v1/web/radar` | listRadar | 读取插件/关键词雷达 | 老板 / DSH Web | 200 | — | REQ-WEB-005 |
| P29 | GET | `/api/v1/employees` | listEmployees | 员工插件清单 | 老板 / 中枢 | 200 | — | REQ-EMP-001 |
| P30 | GET | `/api/v1/employees/{pluginId}` | getEmployee | 单个员工插件 | 老板 / 中枢 | 200 | ERR-EMP-001 | REQ-EMP-001 |
| P31 | POST | `/api/v1/employees` | installEmployee | 安装员工 manifest（默认停用） | 老板 / 中枢 | 201 | ERR-EMP-001 | REQ-EMP-002 |
| P32 | POST | `/api/v1/employees/{pluginId}/toggle` | toggleEmployee | 启用/停用员工插件 | 老板 | 200 | ERR-EMP-001 | REQ-EMP-002 |
| P33 | POST | `/api/v1/employees/{pluginId}/export` | exportEmployeePackage | 导出员工包 | 老板 | 201 | ERR-EMP-001 | REQ-EMP-006 |
| P34 | POST | `/api/v1/employees/import` | importEmployeePackage | 导入员工包（dry-run/确认） | 老板 | 200/422 | ERR-EMP-001 | REQ-EMP-007 |
| P35 | GET | `/api/v1/projects/{projectId}/milestones` | listProjectMilestones | 列出项目里程碑/关键节点 | 老板 / 项目监理 | 200 | ERR-PRJ-001 | REQ-PRJ-016、022 |
| P36 | POST | `/api/v1/projects/{projectId}/milestones` | createProjectMilestone | 新建里程碑/关键节点 | 项目监理 | 201 | ERR-PRJ-001 | REQ-PRJ-016、022 |
| P37 | GET | `/api/v1/projects/{projectId}/repositories` | listCodeRepositories | 列出 Git/SVN 版本库 | 老板 / 项目监理 | 200 | ERR-PRJ-001 | REQ-PRJ-017 |
| P38 | POST | `/api/v1/projects/{projectId}/repositories` | registerCodeRepository | 登记 Git/SVN 版本库 | 项目监理 | 201 | ERR-PRJ-001、003 | REQ-PRJ-017 |
| P39 | GET | `/api/v1/projects/{projectId}/artifacts` | listArtifactRepositories | 列出 Maven/Docker 制品库 | 老板 / 项目监理 | 200 | ERR-PRJ-001 | REQ-PRJ-018 |
| P40 | POST | `/api/v1/projects/{projectId}/artifacts` | registerArtifactRepository | 登记 Maven/Docker 制品库 | 项目监理 | 201 | ERR-PRJ-001、003 | REQ-PRJ-018 |
| P41 | GET | `/api/v1/projects/{projectId}/environments` | listDeployEnvironments | 列出部署环境 | 老板 / 项目监理 | 200 | ERR-PRJ-001 | REQ-PRJ-019 |
| P42 | POST | `/api/v1/projects/{projectId}/environments` | registerDeployEnvironment | 登记 SSH 部署环境 | 项目监理 | 201 | ERR-PRJ-001、003 | REQ-PRJ-019 |
| P43 | GET | `/api/v1/projects/{projectId}/releases` | listReleaseOrders | 列出发布单 | 老板 / 项目监理 | 200 | ERR-PRJ-001 | REQ-PRJ-019 |
| P44 | POST | `/api/v1/projects/{projectId}/releases` | createReleaseOrder | 创建发布单 | 项目监理 | 201 | ERR-PRJ-001 | REQ-PRJ-019 |
| P45 | POST | `/api/v1/releases/{releaseId}/approve` | approveReleaseOrder | 审批发布单 | 老板 | 200 | ERR-PRJ-001、002 | REQ-PRJ-019 |
| P46 | POST | `/api/v1/projects/{projectId}/test-plans` | createTestPlan | 创建测试计划 | 项目监理 / 测试 Agent | 201 | ERR-PRJ-001 | REQ-PRJ-020 |
| P47 | POST | `/api/v1/test-runs` | createTestRun | 创建测试执行批次 | 项目监理 / 测试 Agent | 201 | ERR-PRJ-001 | REQ-PRJ-020、021 |
| P48 | POST | `/api/v1/test-runs/{runId}/results` | recordTestResult | 记录逐用例结果 | 项目监理 / 测试 Agent | 201 | ERR-PRJ-001 | REQ-PRJ-020、021 |
| P49 | GET | `/api/v1/projects/{projectId}/defects` | listDefects | 列出项目缺陷 | 老板 / 项目监理 | 200 | ERR-PRJ-001 | REQ-PRJ-020、021 |

服务地址：`http://127.0.0.1:3081`（单机部署，DSH Web 内嵌路由；`api.yaml` servers 段）。七个 tag 对应章节：`platform`→§3，`workflow`→§4，`audit`→§5，`scheduler`→§6，`web`→§7，`employees`→§7.4，`project`→§7.5。

## 3. 平台类接口（P1–P6）

### 3.1 P1 GET /api/v1/health — 健康检查

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 一次性判断进程、PostgreSQL、pgvector、调度器四项是否就绪 |
| 调用方 | 运维、看板、Onboarding 预检脚本 |
| 鉴权 | 本机访问；不返回任何业务数据 |
| 幂等与重试 | 天然幂等，可任意重试 |
| 审计 | 不写审计（健康检查高频，写审计会污染日志） |

**入参**：无。

**出参**（`HealthResult`）：

| 字段 | 类型 | 说明 |
| :------------- | :------ | :------------------------------------------------------------------- |
| `code` | integer | 固定 0 |
| `data.status` | string | 总体状态（`ok` 表示四项全绿） |
| `data.version` | string | 中枢版本 |
| `data.pg` | boolean | PostgreSQL 连通性 |
| `data.pgvector` | boolean | pgvector 扩展可用性 |
| `data.scheduler` | object | 调度器状态（运行中与否、下次触发时间） |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :------------ | :------------------------- | :-------------------------------------- |
| 503 | ERR-SYS-001 | 数据库不可用 | 判为不可用，触发运维告警；不重试到无限次 |

### 3.2 P2 POST /api/v1/views/{viewId}/query — 视图级授权查询

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 以视图级授权查询聚合数据，只读，自动写审计 |
| 调用方 | 员工插件（`required_views` 已声明该视图） |
| 鉴权 | `pluginId` 已注册且启用 + `ref.view_grant` 有生效授权；8 视图固定清单见 SRS §3.2 |
| 幂等与重试 | 天然幂等（只读），可重试；重试不改变审计条数口径（每次请求各记一条） |
| 审计 | `view.query`，通过或拒绝都写 |

**入参**：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :--------- | :----- | :------ | :--- | :------------------- | :----------------------------------------------------- |
| `viewId` | path | string | 是 | 必须是 8 个已登记视图之一 | 目标视图 |
| `pluginId` | body | string | 是 | 已注册且 `enabled=true` | 发起查询的员工插件 |
| `filter` | body | object | 否 | 键必须是视图暴露的字段 | 过滤条件；不得用于筛选敏感字段 |
| `limit` | body | integer | 否 | 正整数 | 返回行数上限 |

**出参**（`ViewRowsResult`）：

| 字段 | 类型 | 说明 |
| :-------------- | :------- | :------------------------------------------------------------------ |
| `code` | integer | 固定 0 |
| `data.viewId` | string | 回显视图 ID |
| `data.rows` | object[] | 仅含该视图定义的聚合与索引字段；不含敏感字段 |
| `data.rowCount` | integer | 返回行数 |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :-------------- | :--------------------------------------------- | :----------------------------------------------- |
| 403 | ERR-AUTHZ-001 | 未登记授权、授权非生效、插件已停用、越权筛选敏感字段 | 不重试；向中枢申请授权或改用 `need_detail` 二次派工 |
| 400 | ERR-VIEW-001 | `viewId` 不在 8 个已登记视图内 | 不重试；检查视图 ID 拼写或申请新增视图（走复核流程） |

### 3.3 P3 POST /api/v1/tokens — 签发一次性令牌

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 为跨域读取敏感字段签发令牌：绑定单次任务、单字段范围、有效期 ≤ 5 分钟 |
| 调用方 | 中枢（在已派工任务上下文中签发） |
| 鉴权 | 发起任务必须是中枢已派工任务；`fieldScope` 必须落在该视图可授权的字段范围内 |
| 幂等与重试 | **非幂等**：每次调用签发新令牌；超时后不得盲目重试，应先查是否已签发 |
| 审计 | `token.issue`，记录 token_id、task_id、字段名，不记录字段值 |

**入参**（`IssueTokenRequest`）：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :------------- | :--- | :-------- | :--- | :--------------------------------------------- | :------------------------- |
| `taskId` | body | string | 是 | 必须是已派工任务 | 令牌绑定任务 |
| `pluginId` | body | string | 是 | 已注册员工插件 | 令牌绑定插件 |
| `viewId` | body | string | 是 | 8 个视图之一 | 令牌绑定的视图域 |
| `fieldScope` | body | string[] | 是 | 非空；每项为字段名 | 单字段范围（可多字段，但仍在同一视图域内） |
| `ttlSeconds` | body | integer | 否 | `maximum: 300` | 有效期；不传时取实现默认值且不得 > 300 |

**出参**（`TokenResult`）：

| 字段 | 类型 | 说明 |
| :---------------- | :-------- | :------------------------------------------ |
| `code` | integer | 固定 0 |
| `data.tokenId` | string | 令牌 ID（日志与审计只记此 ID） |
| `data.expiresAt` | date-time | 过期时刻；`expiresAt − 签发时刻 ≤ 300 秒` |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :------------ | :------------------------------------------------------------------------- | :------------------------------- |
| 400 | ERR-TOKEN-001 | 四必填项缺失；`ttlSeconds > 300`；`fieldScope` 为空或超出视图可授权字段 | 修正参数后重发；不可用改小 `ttlSeconds` 之外的手段绕过 |

### 3.4 P4 POST /api/v1/tokens/{tokenId}/consume — 消费一次性令牌

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 凭令牌一次性获取授权字段值；消费成功即置已用 |
| 调用方 | 员工插件 |
| 鉴权 | 令牌未使用、未过期；请求 `taskId` 与签发时一致；插件与令牌绑定的 `pluginId` 一致 |
| 幂等与重试 | **一次性**：成功一次即失效；409 后**不得重试**，须重新 `issueToken` |
| 审计 | `token.consume`，记录 token_id、task_id、字段名、结果；不记录字段值 |

**入参**：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :-------- | :----- | :------ | :--- | :------------------- | :--------------------- |
| `tokenId` | path | string | 是 | 已签发未使用的令牌 | 令牌 ID |
| `taskId` | body | string | 是 | 与签发时一致 | 任务一致性校验 |

**出参**（`TokenConsumeResult`）：

| 字段 | 类型 | 说明 |
| :-------------- | :------ | :----------------------------------------------------- |
| `code` | integer | 固定 0 |
| `data.tokenId` | string | 回显令牌 ID |
| `data.fields` | object | 授权字段名 → 值；键集合是签发 `fieldScope` 的子集，不得超出 |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :------------ | :---------------------------------------------------------- | :------------------------------------- |
| 409 | ERR-TOKEN-001 | 令牌已使用、已过期、`taskId` 不匹配 | **不重试**；重新发起任务取新令牌，并在上下文提示"令牌失效" |
| 400 | ERR-TOKEN-001 | `tokenId` 格式非法或 `taskId` 缺失 | 修正请求；不得用猜测的 tokenId 探测 |

### 3.5 P5 POST /api/v1/conflicts — 登记冲突并冻结

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 登记两个及以上员工对同一业务事实的不一致写入/归属，并冻结该业务事件 |
| 调用方 | 员工插件（检出不一致时）、中枢（自动检出时） |
| 鉴权 | 冻结单元必须存在且可判定；同一冻结单元同时只允许一个未裁决冲突 |
| 幂等与重试 | 同一冻结单元重复登记返回既有 `conflictId` 且 `frozen` 保持 true，不产生第二条队列记录 |
| 审计 | `conflict.open`，记录 conflict_id、冻结单元、参与方、差异字段 |

**入参**（`OpenConflictRequest`）：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :---------------- | :--- | :-------- | :--- | :--------------------------------------------------------------------------- | :----------------------------- |
| `conflictType` | body | string | 是 | 枚举 `cost`/`customer`/`stock_batch`/`contract_amount` | 冲突类型 |
| `frozenUnitType` | body | string | 是 | 冻结单元类型（业务事件 / 客户关系期 / 出入库事件 / 合同） | 冻结粒度 |
| `frozenUnitId` | body | integer | 是 | 对应实体存在 | 冻结单元主键 |
| `parties` | body | object[] | 是 | 至少两方，各含员工插件标识与原始依据 | 双方依据供老板评判 |
| `diffFields` | body | string[] | 否 | 差异字段名 | 冲突具体落在哪些字段 |

**出参**（`ConflictResult`）：

| 字段 | 类型 | 说明 |
| :---------------- | :------ | :----------------------------- |
| `code` | integer | 固定 0 |
| `data.conflictId` | integer | 冲突 ID |
| `data.status` | string | 队列状态（`open` 等） |
| `data.frozen` | boolean | 是否已冻结；登记成功必须为 true |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :---------------- | :----------------------------------------------------- | :----------------------------- |
| 400 | ERR-CONFLICT-001 | `conflictType` 不在四类枚举内；冻结单元不存在或类型不合法 | 修正类型或先落业务事件再登记冲突 |

**推送分级**（接口返回后由中枢执行，非接口入参）：单笔金额 ≥ 月均流水 5% 或涉合同/客户承诺即时推送；其余按小时聚合；22:00–08:00 入次日晨报（截止日 12h 内冲突除外）。

### 3.6 P6 POST /api/v1/conflicts/{conflictId}/resolve — 老板裁决

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 老板裁决冲突，清除冻结标记，写裁决记录并生成受影响报表清单 |
| 调用方 | 老板（唯一具备裁决权的人类角色） |
| 鉴权 | 仅老板通道；员工与外部角色调用一律拒绝 |
| 幂等与重试 | 同一 `conflictId` 已裁决后重复提交同 `choice` 返回既有结果；不同 `choice` 返回错误，避免覆盖历史裁决 |
| 审计 | `conflict.resolve`，记录 conflict_id、choice、受影响报表清单 |

**入参**（`ResolveConflictRequest`）：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :------------- | :----- | :------ | :--- | :----------------------------------------- | :------------------------------------- |
| `conflictId` | path | integer | 是 | 存在且未裁决 | 目标冲突 |
| `choice` | body | string | 是 | 枚举 `A`/`B`/`manual`/`later` | 裁决方式 |
| `manualValue` | body | object | 条件 | `choice=manual` 时必填 | 手动填写值 |
| `note` | body | string | 否 | — | 裁决说明，入 `arbitration_log` |

**出参**：同 `ConflictResult`（`data.frozen` 裁决后为 false；`data.status` 为已裁决状态），并附受影响报表清单。

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :---------------- | :--------------------------------------------------------------- | :----------------------------------- |
| 404 | ERR-CONFLICT-001 | 冲突 ID 不存在 | 刷新队列后重试；不得用相近 ID 探测 |
| 400 | ERR-CONFLICT-001 | `choice` 不在四值枚举内；`choice=manual` 但缺 `manualValue` | 补齐参数；`later` 分支静默 24 小时后提醒一次 |

## 4. 流程类接口（P7–P10）

### 4.1 P7 POST /api/v1/workflows — 注册流程版本

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 注册流程版本：六项准入守卫 + 风险等级硬规则计算，失败拒绝注册 |
| 调用方 | 中枢 Registry（自动注册）或老板显式要求固化 |
| 鉴权 | 平台能力通道；`ownerPlugin` 必须已注册；`required_views` 必须全在授权表内 |
| 幂等与重试 | **非幂等**：同 `workflowId + version` 内容相同返回既有注册结果；内容不同返回 409 `ERR-WF-002` |
| 审计 | `workflow.register`，记录守卫逐项结果、计算出的 risk_level、代码哈希 |

**入参**（`RegisterWorkflowRequest`）：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :--------------- | :--- | :------ | :--- | :------------------------------------------------------------------- | :----------------------------- |
| `workflowId` | body | string | 是 | 稳定标识，不复用 | 流程 ID |
| `version` | body | string | 是 | 版本号 | 版本（不可变执行，旧版本保留可回滚） |
| `ownerPlugin` | body | string | 是 | 已注册员工插件 | 归属插件 |
| `meta` | body | object | 是 | 必须通过 JSON schema 校验；**不得含 `risk_level` 字段** | 流程元信息 |
| `code` | body | string | 是 | 脚本正文 | 流程代码 |
| `testReportHash` | body | string | 否 | 与 `code` 哈希一致 | 测试通过时的代码哈希（守卫第六项依据） |

`meta` 必须声明的关键字段（缺一即守卫失败）：`required_views`、`key_nodes`、`human_gates`、`idempotent_nodes`、`deadline_impact`（`false` 时须给 `indirect_deadline`）、`verifier_policy`、`max_retry`。

**出参**（`WorkflowResult`）：

| 字段 | 类型 | 说明 |
| :---------------- | :------ | :----------------------------------------------------- |
| `code` | integer | 固定 0 |
| `data.workflowId` | string | 流程 ID |
| `data.version` | string | 已注册版本 |
| `data.riskLevel` | string | 硬规则计算出的风险等级：`high`/`medium`/`low` |
| `data.status` | string | 注册后状态 |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :---------- | :--------------------------------------------------------------------------------------- | :----------------------------------------------------- |
| 422 | ERR-WF-001 | 六项守卫任一失败：meta schema、视图授权、幂等完整性、工具合法性、跨员工隔离、代码哈希 | 读 `failures[]` 逐项修；**不得静默降级**；中枢知会老板 |
| 409 | ERR-WF-002 | 同 `workflowId + version` 已存在且内容不同 | 升版本号重新注册；不得覆盖已注册版本 |

**守卫失败响应示例**（HTTP 422，`GuardFailureResult`）：

```json
{
  "code": 422,
  "message": "准入守卫失败：2 项未通过",
  "failures": [
    { "item": "视图授权", "detail": "required_views 含 view_stock_index，opc_finance 未获授权" },
    { "item": "代码哈希", "detail": "注册代码哈希与测试通过时哈希不一致，需重跑测试" }
  ]
}
```

### 4.2 P8 POST /api/v1/workflows/{workflowId}/instances — 启动实例

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 以指定版本启动流程实例，校验视图授权并记录生命周期事件 |
| 调用方 | 员工插件、中枢 |
| 鉴权 | 流程已注册；所用版本的 `required_views` 在授权表内 |
| 幂等与重试 | 每次调用创建新实例（不幂等）；超时后重试前须查询是否已创建实例 |
| 审计 | `workflow.start`，记录 instance_id、workflowId、version、context 摘要 |

**入参**：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :------------- | :----- | :------ | :--- | :-------------------- | :----------------------------------- |
| `workflowId` | path | string | 是 | 已注册 | 流程 ID |
| `version` | body | string | 否 | 已注册版本 | 缺省取当前生效版本 |
| `context` | body | object | 否 | — | 启动上下文（最小必要上下文） |

**出参**（`InstanceResult`）：

| 字段 | 类型 | 说明 |
| :---------------- | :------ | :------------- |
| `code` | integer | 固定 0 |
| `data.instanceId` | integer | 实例 ID（审计聚合键） |
| `data.workflowId` | string | 流程 ID |
| `data.version` | string | 实际使用版本 |
| `data.status` | string | 实例状态 |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :---------- | :----------------------------------------- | :--------------------------------------- |
| 404 | ERR-WF-003 | 流程未注册、版本不存在、`required_views` 未获授权 | 先注册或用已生效版本；无授权视图须先走授权复核 |

### 4.3 P9 POST /api/v1/instances/{instanceId}/nodes/{nodeId}/complete — 完成写节点

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 以 `(instanceId, nodeId)` 为幂等键执行写节点，重复执行返回既有结果 |
| 调用方 | 员工插件（流程上下文内） |
| 鉴权 | 实例处于运行中；节点属于该实例；写工具在所属员工注册工具内 |
| 幂等与重试 | 幂等键 `(instanceId, nodeId)`：同键同参返回既有结果（`idempotentHit=true`）；同键不同参返回 409；中断恢复时已执行节点自动跳过 |
| 审计 | `node.complete`，记录幂等键、节点状态、输出摘要、是否幂等命中 |

**入参**（`CompleteNodeRequest`）：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :----------- | :----- | :------ | :--- | :------------------------------ | :------------------------- |
| `instanceId` | path | integer | 是 | 存在且运行中 | 实例 ID |
| `nodeId` | path | string | 是 | 属于该实例的写节点 | 节点 ID |
| `payload` | body | object | 是 | 与该节点入参 schema 一致 | 节点输入；参与幂等键的入参比对 |

**出参**（`NodeRunResult`）：

| 字段 | 类型 | 说明 |
| :------------------ | :------ | :------------------------------------------ |
| `code` | integer | 固定 0 |
| `data.nodeId` | string | 节点 ID |
| `data.status` | string | 节点状态 |
| `data.idempotentHit` | boolean | true 表示本次为幂等命中，未产生新写入 |
| `data.output` | object | 节点输出；幂等命中时与首次一致 |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :---------- | :------------------------------------------------------------------- | :--------------------------------------------- |
| 409 | ERR-WF-004 | 同 `(instanceId, nodeId)` 已执行但本次入参不同 | **不重试**；核对入参或改用正确节点；事件入审计待人工判断 |

### 4.4 P10 POST /api/v1/instances/{instanceId}/nodes/{nodeId}/verdict — 记录 Verifier 评判

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 记录评判：采样投票、置信度、`evidence_hash` 去重、低置信且高影响则升级人工 |
| 调用方 | 中枢 Verifier（独立于执行 Agent 的模型配置） |
| 鉴权 | 平台能力通道；实例运行中且节点属于 `key_nodes` |
| 幂等与重试 | 同 `evidence_hash` 重复提交返回 `cacheHit=true` 且结论不变；可安全重试 |
| 审计 | `verdict.record`，记录 sampling、verdict、confidence、escalated、evidence_hash |

**入参**（`VerdictRequest`）：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :---------- | :----- | :------ | :--- | :--------------------------------------- | :--------------------------------------------------------------- |
| `instanceId` | path | integer | 是 | 存在且运行中 | 实例 ID |
| `nodeId` | path | string | 是 | 属于 `key_nodes` | 节点 ID |
| `verdict` | body | string | 是 | 枚举 `pass`/`fail` | 本次判定 |
| `sampling` | body | integer | 是 | 高影响节点为 3 | 采样次数；与 `verifier_policy` 一致 |
| `confidence` | body | number | 否 | 0–1 | 最终置信度；低于阈值 0.8 且节点高影响则升级 |
| `evidence` | body | object | 否 | — | 判定证据；其关键字段集决定 `evidence_hash` |
| `escalated` | body | boolean | 否 | — | 是否升级人工 |

**出参**（`VerdictResult`）：

| 字段 | 类型 | 说明 |
| :------------------ | :------ | :----------------------------------------------------------- |
| `code` | integer | 固定 0 |
| `data.verdictId` | integer | 评判记录 ID |
| `data.finalVerdict` | string | 最终判定（聚合采样后的结论） |
| `data.confidence` | number | 最终置信度 |
| `data.escalated` | boolean | 是否升级人工裁决 |
| `data.cacheHit` | boolean | true 仅表示省去重复调用，**不表示通过** |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :---------- | :----------------------------------------------------------- | :----------------------------------------- |
| 422 | ERR-WF-001 | `verdict` 非枚举值；`sampling` 缺失；节点不属于 `key_nodes`；实例不在运行中 | 修正后重发；Verifier 不可用时节点阻塞，不降级为默认通过 |

**`evidence_hash` 字段集口径**（写入流程 `meta.verifier_policy`）：税务流程取"发票合计、流水合计、差异计数"；补贴流程取"文号、发布日期、适用期"；库存流程取"SKU、数量、单价、相对方"。

## 5. 审计类接口（P11–P12）

### 5.1 P11 GET /api/v1/audits — 审计查询

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 按实例、动作、时间范围查询审计分页，支持 `workflow_instance_id` 聚合 |
| 调用方 | 老板、审计归档任务 |
| 鉴权 | 老板通道或归档任务身份；员工插件不得查询全量审计 |
| 幂等与重试 | 天然幂等，可重试 |
| 审计 | `audit.query`，记录查询条件与返回条数 |

**入参**：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :----------- | :---- | :------ | :--- | :-------------- | :----------------------------- |
| `instanceId` | query | integer | 否 | — | 按实例聚合 |
| `action` | query | string | 否 | 已登记动作名 | 按动作过滤 |
| `limit` | query | integer | 否 | `maximum: 500` | 返回条数上限，超限即校验失败 |

**出参**（`AuditPageResult`）：

| 字段 | 类型 | 说明 |
| :------------ | :------- | :----------------- |
| `code` | integer | 固定 0 |
| `data.rows` | object[] | 审计记录数组 |
| `data.total` | integer | 命中总数 |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :-------------- | :------------------------- | :------------------------------------------------------- |
| 500 | ERR-AUDIT-001 | 审计存储不可用、查询失败 | 重试并告警；**不得**降级为返回空数组（空数组会被误读为"无违规"） |

### 5.2 P12 POST /api/v1/audits/export — 增量导出

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 增量导出 JSONL + SHA-256，更新哈希链头 `audit.audit_chain_head` |
| 调用方 | 审计归档任务（每日 02:00；每月 1 日全量归档） |
| 鉴权 | 归档任务身份；写入 `archive/audit/YYYY/MM/`，只追加不覆盖 |
| 幂等与重试 | 按 `sinceId` 续导可重入；失败重试 3 次后即时告警；已导出记录不重复写（增量游标可续） |
| 审计 | `audit.export`，记录 filePath、sha256、rowCount、prev_hash |

**入参**（`ExportAuditsRequest`）：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :-------- | :--- | :------ | :--- | :------------------------- | :----------------------------- |
| `sinceId` | body | integer | 否 | 为上次导出的最大 id | 增量起点；缺省取链头游标 |
| `outDir` | body | string | 否 | 必须位于审计归档根目录内 | 输出目录；缺省按月目录生成 |

**出参**（`ExportResult`）：

| 字段 | 类型 | 说明 |
| :-------------- | :------ | :------------------------------------------------------- |
| `code` | integer | 固定 0 |
| `data.filePath` | string | 导出文件路径 |
| `data.sha256` | string | 全文 SHA-256 校验值 |
| `data.rowCount` | integer | 本次导出行数 |
| `data.prevHash` | string | 上一条导出文件哈希（链式依据） |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :-------------- | :----------------------------------------------------------- | :----------------------------------------------------------- |
| 500 | ERR-AUDIT-001 | 写入失败、哈希计算失败、链头表更新失败 | 重试 3 次；仍失败即刻告警；恢复时先校验链头与最后导出文件一致性，不一致则拒绝续链 |

**导出文件头必含四项**：`schema_version`、上一条文件哈希、本条文件哈希、链头表快照。

## 6. 调度类接口（P13–P16）

### 6.1 P13 GET /api/v1/tasks — 任务列表

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 列出已配置的定时任务，含下次触发时间与最近运行状态 |
| 调用方 | 老板、看板 |
| 鉴权 | 老板通道 |
| 幂等与重试 | 天然幂等 |
| 审计 | 不写审计（只读浏览） |

**入参**：无。

**出参**（`TaskListResult`）：`code=0`，`data.tasks[]` 每项含 `taskId`、`cron`、`timezone`、`enabled`、`nextRunAt`、最近运行状态。

**错误码**：无专属码；失败走 `ERR-SYS-001`（500/503）。

### 6.2 P14 PUT /api/v1/tasks/{taskId} — 新增/更新定时任务

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 以 `cron + 时区 + 参数` 配置驱动新增或更新任务 |
| 调用方 | 老板 |
| 鉴权 | 老板通道；任务类型必须已注册 |
| 幂等与重试 | 幂等（同 `taskId` 同内容重复提交结果一致）；建议 PUT 语义整体覆盖 |
| 审计 | `task.upsert`，记录 taskId、cron、timezone、enabled、nextRunAt |

**入参**（`UpsertTaskRequest`）：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :--------- | :----- | :------ | :--- | :--------------------------- | :----------------------------------- |
| `taskId` | path | string | 是 | 稳定标识 | 任务 ID |
| `cron` | body | string | 是 | 可解析；任务类型已注册 | cron 表达式 |
| `timezone` | body | string | 是 | 合法 IANA 时区 | 任务时区 |
| `enabled` | body | boolean | 否 | 缺省为 true | 是否参与调度 |
| `config` | body | object | 否 | 键与任务类型定义一致 | 任务参数 |

**出参**（`TaskResult`）：

| 字段 | 类型 | 说明 |
| :-------------- | :-------- | :--------------------------------- |
| `code` | integer | 固定 0 |
| `data.taskId` | string | 任务 ID |
| `data.cron` | string | 已保存的 cron |
| `data.nextRunAt` | date-time | 由 `cron + timezone` 推算的下次触发时间 |
| `data.enabled` | boolean | 是否参与调度 |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :------------ | :--------------------------------------------- | :----------------------------------- |
| 400 | ERR-TASK-001 | cron 无法解析；任务类型未注册；`timezone` 非法 | 修正表达式或时区；不保存半成品配置 |

### 6.3 P15 POST /api/v1/tasks/{taskId}/run — 立即执行一次

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 手动触发一次任务；幂等键按计划时间，可 `force` 显式绕过 |
| 调用方 | 老板（手动补跑）、调度器（到点触发） |
| 鉴权 | 老板通道或调度器身份 |
| 幂等与重试 | 幂等键 `(taskId, scheduled_at)`：重复触发 `skipped=true`；`force=true` 显式绕过并写审计 |
| 审计 | `task.run`，记录 scheduled_at、是否跳过、执行结果 |

**入参**（`RunTaskRequest`）：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :------------ | :----- | :-------- | :--- | :------------------ | :------------------------------------------------- |
| `taskId` | path | string | 是 | 任务存在 | 目标任务 |
| `force` | body | boolean | 否 | 缺省 false | 显式绕过幂等（写审计） |
| `scheduledAt` | body | date-time | 否 | — | 指定计划时间；缺省取当前计划时间，参与幂等键构造 |

**出参**（`TaskRunResult`）：

| 字段 | 类型 | 说明 |
| :-------------- | :------ | :----------------------------------- |
| `code` | integer | 固定 0 |
| `data.runId` | integer | 运行记录 ID |
| `data.taskId` | string | 任务 ID |
| `data.status` | string | 运行状态 |
| `data.skipped` | boolean | true 表示幂等跳过，未真正执行 |
| `data.result` | object | 任务产出摘要 |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :------------ | :----------------- | :------------------------------------------------- |
| 404 | ERR-TASK-002 | 任务不存在 | 先 `listTasks` 确认 taskId；不得用相近 ID 重试 |

### 6.4 P16 GET /api/v1/reports/daily — 读取晨报

| 项 | 内容 |
| :--------- | :--------------------------------------------------------------------------- |
| 用途 | 读取指定日期晨报，缺省最近一期 |
| 调用方 | 老板、看板 |
| 鉴权 | 老板通道 |
| 幂等与重试 | 天然幂等 |
| 审计 | 不写审计（只读浏览） |

**入参**：

| 名称 | 位置 | 类型 | 必填 | 约束 | 说明 |
| :----- | :---- | :------ | :--- | :------------- | :----------------------------- |
| `date` | query | string | 否 | `format: date` | 晨报日期；缺省最近一期 |

**出参**（`DailyReportResult`）：

| 字段 | 类型 | 说明 |
| :------------------ | :------ | :----------------------------------------- |
| `code` | integer | 固定 0 |
| `data.reportDate` | string | 晨报日期 |
| `data.content` | object | 晨报内容（五项汇总口径，见 SRS §8.2） |

**错误码**：

| HTTP | errorCode | 触发条件 | 调用方处理 |
| :--- | :------------ | :------------------------- | :--------------------------------------------- |
| 404 | ERR-SYS-001 | 尚无晨报或该日期无晨报 | 提示"当日尚无晨报"，不伪造空晨报 |

**晨报内容五项口径**（不可增删）：税务申报 ≤ 7 天、合同到期 ≤ 30 天、待裁决冲突、低置信升级、观察期异常。

## 7. Web 表现层接口（P17–P28）

> **接口声明**：本节 `WebHostAdapter`、`/api/v1/web/*` 为 OPC-玄机对 DSH Web/会话/记忆能力的封装约定；DSH 实际插槽、会话事件与鉴权契约以宿主为准（架构 §8.1）。

### 7.1 横切约定

| 项 | 约定 |
| :--- | :--- |
| 鉴权 | DSH 会话 + `opc_hub` capability token；老板全视图，兼职/外包按模块白名单；匿名一律 401 |
| 响应信封 | `{ code: 0, data, as_of?, warnings? }`；失败 `{ code:<http>, errorCode, message, details }` |
| 写幂等 | `POST` 支持 `Idempotency-Key`；归置接口另以 `content_hash + source_ref` 去重；重复返回 200 + `duplicate=true` |
| 审计 | 面板访问、授权/撤回、上下文读取、记忆检索/提议/确认、归置确认/忽略、任务运行统一写 `audit.audit_log` |
| 敏感字段 | 不 JOIN `biz.customer_sensitive`；敏感记忆只返回 `[敏感记忆，需一次性令牌查看]`；跨域单字段走一次性令牌 |
| 错误码 | 统一 `ERR-WEB-001`（参数非法/未授权/状态冲突/不存在），按 HTTP 400/403/404/409 区分 |
| 实时 | v1 可用 SSE/15s 轮询；只推 `snapshot_version`/`as_of`，不推明细 |

### 7.2 接口明细

| 接口 | 入参 | 出参 | 失败语义 |
| :--- | :--- | :--- | :--- |
| P17 `GET /web/manifest` | — | `pluginId, title, panel, schemaVersion, tabs[], capabilities[]` | 宿主不可用由 DSH 处理 |
| P18 `GET /web/dashboard?range=` | `range ∈ {today,7d,30d,90d}`，缺省 `30d` | `snapshotId, asOf, range, stale, metrics[], frozen{count,amount}, warnings[]` | 聚合失败保留上次快照并标 `stale` |
| P19 `GET /web/inbox?status=&limit=` | `status` 可选；`limit` 1–200 | `items[], total` | 无数据返回空数组，不报 404 |
| P20 `POST /web/ingest` | `sourceType, sourceRef, text, idempotencyKey?` | `item{...}, duplicate` | 文本/来源为空 400；重复 200 |
| P21 `POST /web/ingest/{id}/confirm` | `action ∈ {confirm,ignore}`，`editedExtracted?` | `item` | 不存在 404；已处理 409 |
| P22 `PUT /web/sessions/{id}/grant` | `purpose, ttlSeconds? (60..86400), messageScope?` | `id, sessionId, purpose, messageScope, expiresAt` | 用途/会话为空 400 |
| P23 `DELETE /web/sessions/{id}/grant` | — | `revoked` | 无活动授权返回 `revoked=0` |
| P24 `GET /web/sessions/{id}/context` | — | `grantId, expiresAt, messages[]`（最近 20 条） | 未授权/过期 403 `ERR-WEB-001` |
| P25 `POST /web/memory/search` | `query, scopes[], purpose, limit?` | `cards[], total` | 空 query/scope 400；敏感内容脱敏 |
| P26 `POST /web/memory/propose` | `type, title, content, sourceRefs[], confidence` | `proposalId, status` | 无来源引用 400 |
| P27 `POST /web/memory/proposals/{id}/confirm` | `confirmedBy?` | `memoryId, created` | 不存在 404；已处理 409 |
| P28 `GET /web/radar?type=&status=&limit=` | `type ∈ {plugin,keyword}` 可选 | `items[], total` | 无数据空数组；不自动安装 |

### 7.3 与 DSH 工具的关系

Web 接口与 DSH 工具共用同一批服务实例（`createHub` 装配一次）：`opc_web_ingest`、`opc_web_inbox`、`opc_web_confirm`、`opc_web_dashboard`、`opc_web_session_grant`、`opc_web_session_context`、`opc_web_memory_search`、`opc_web_memory_propose`、`opc_web_radar` 与 P17–P28 一一映射；不存在“工具绕过 HTTP 校验”的旁路。

### 7.4 员工插件与员工包接口（P29–P34）

| 接口 | 入参 | 出参 | 失败语义 |
| :--- | :--- | :--- | :--- |
| P29 `GET /employees` | — | `items[], total`（manifest/版本/启用状态） | 无数据返回空数组 |
| P30 `GET /employees/{pluginId}` | — | 单个员工 manifest 与状态 | 不存在 404 `ERR-EMP-001` |
| P31 `POST /employees` | `manifest, enabled?, packageCode?, actor?` | 安装后的员工 | manifest 非法/依赖缺失 422 |
| P32 `POST /employees/{pluginId}/toggle` | `enabled, reason?, actor?` | 更新后的员工 | 有依赖未先停用 409 |
| P33 `POST /employees/{pluginId}/export` | — | `opc-employee-package` v1 + `packageCode` | 不存在 404；默认不含业务数据 |
| P34 `POST /employees/import` | `package, dryRun?, confirm?, actor?` | 校验/导入报告 | 校验失败 422；confirm 才安装，默认停用 |

**员工包校验**：格式/大小 → checksum → manifest schema → pluginId/version → minHubVersion/schemaVersion → 依赖 → 视图/工具/写目标 → 路径穿越/文件类型 → dry-run → 老板确认 → 安装（默认停用）→ 二次确认启用。

**与 DSH 工具**：`opc_employee_list`、`opc_employee_install`、`opc_employee_toggle`、`opc_employee_export`、`opc_employee_import` 与 P29–P34 一一映射；导入导出与停用同样走审计。

### 7.5 项目研发接口（P35–P49）

| 接口 | 入参 | 出参 | 失败语义 |
| :--- | :--- | :--- | :--- |
| P35 `GET /projects/{projectId}/milestones` | — | `milestones[]` | 项目不存在 404 `ERR-PRJ-001` |
| P36 `POST /projects/{projectId}/milestones` | `name, targetDate, stage?, actualDate?, status?, owner?, dependencies?, evidence?` | `milestone` | 日期非法/必填缺失 400；创建写审计 |
| P37 `GET /projects/{projectId}/repositories` | — | `repositories[]` | 项目不存在 404 |
| P38 `POST /projects/{projectId}/repositories` | `name, kind ∈ {git,svn}, url, defaultRef?, authRef?, syncMode?` | `repository` | 明文 `authRef` 400 `ERR-PRJ-003` |
| P39 `GET /projects/{projectId}/artifacts` | — | `artifacts[]` | 项目不存在 404 |
| P40 `POST /projects/{projectId}/artifacts` | `name, kind ∈ {maven,docker,npm,other}, url, namespace?, authRef?, retentionPolicy?` | `artifact` | 明文 `authRef` 400 `ERR-PRJ-003` |
| P41 `GET /projects/{projectId}/environments` | — | `environments[]` | 项目不存在 404 |
| P42 `POST /projects/{projectId}/environments` | `envType ∈ {dev,test,staging,prod}, name, host, sshUser, port?, authRef?, jumpHostRef?, isolationLevel?, approvalPolicy?` | `environment` | 生产 `auto` 400；凭据明文 400 |
| P43 `GET /projects/{projectId}/releases` | — | `releases[]` | 项目不存在 404 |
| P44 `POST /projects/{projectId}/releases` | `environmentId, version, requestedBy, artifactRefs?, repoRefs?, changeNote?, rollbackVersion?` | `release` | 环境不属于项目 404；生产缺回滚版本 400 |
| P45 `POST /releases/{releaseId}/approve` | `approver` | `release` | 不存在 404；非 pending 409 `ERR-PRJ-002` |
| P46 `POST /projects/{projectId}/test-plans` | `version, scope?, testTypes?, entryCriteria?, exitCriteria?, environmentId?, owner?, startDate?, endDate?` | `testPlan` | 必填缺失 400；初始 `draft` |
| P47 `POST /test-runs` | `projectId, version, executor, executorType?, planId?, suiteId?, environmentId?` | `testRun` | 项目不存在 404；初始 `running` |
| P48 `POST /test-runs/{runId}/results` | `caseId, result ∈ {passed,failed,blocked,skipped}, evidence?, failureReason?` | `testResult` | 批次不存在 404；失败/阻塞置批次 `failed` |
| P49 `GET /projects/{projectId}/defects` | — | `defects[]` | 项目不存在 404；空列表返回 `[]` |

**项目研发安全口径**：`authRef` 只接受 `env:`、`secret:`、`vault:`、`ssh-agent:` 前缀；接口不返回明文凭据；生产环境强制 `approvalPolicy=manual`；本层不执行 SSH 命令、Git/SVN 同步与制品推送，执行器在 Phase 2 接入并单独审计。

### 7.6 管理面接口（P50–P101，Web 控制台）

管理面是 Web 控制台的 BFF，统一挂在 `/api/v1/admin` 下；资源型 CRUD 通过 `resource` 路径白名单复用同一组路由，避免为每张表重复定义协议。

| 组 | 接口 | 用途 |
| :--- | :--- | :--- |
| 项目 | `GET/POST /admin/projects`、`PUT /admin/projects/{projectId}`、`GET /admin/projects/{projectId}/summary` | 项目列表、新建、更新与研发 KPI 汇总 |
| 项目子资源 | `GET/POST /admin/projects/{projectId}/{resource}`、`PUT/DELETE /admin/projects/{projectId}/{resource}/{resourceId}` | `resource ∈ {milestones,repositories,artifacts,environments,test-plans,test-cases,test-suites,defects,work-logs}`；创建/更新/删除均写审计；有引用的环境/计划/用例/套件删除返回 409 |
| 发布 | `GET/POST /admin/projects/{projectId}/releases`、`POST /admin/releases/{releaseId}/approve\|reject`、`DELETE /admin/releases/{releaseId}` | 发布单创建与人工审批；生产仍强制回滚版本与 manual 审批 |
| 测试 | `GET/POST /admin/projects/{projectId}/test-runs`、`POST /admin/test-runs/{runId}/results` | 测试批次与逐用例结果 |
| 情报资源 | `GET/POST/PUT/DELETE /admin/intel/{resource}` | `resource ∈ {scopes,sources,bindings,topics,tags}`；项目隔离由 `projectId` 强制 |
| 情报条目/日报/流水线 | `GET /admin/intel/items`、`PUT /admin/intel/items/{itemId}`、`GET /admin/intel/briefs[/{briefId}]`、`GET /admin/intel/runs`、`POST /admin/intel/run/{stage}`、`GET /admin/intel/summary` | 条目状态、日报详情、运行记录、手动触发 analyze/aggregate/brief/push 与 KPI |
| 公司基础资源 | `GET/POST /admin/shared-resources`、`GET /admin/shared-resources/defaults`、`PUT/DELETE /admin/shared-resources/{resourceId}`、`GET/POST /admin/projects/{projectId}/shared-resources`、`DELETE /admin/projects/{projectId}/shared-resources/{resourceId}` | 六类共享资源（版本库/制品库/测试服务器/NAS/公网服务器/域名）登记与默认口径（debian/ssh/canetwork）；新建项目默认选型绑定；明文凭据 400 `ERR-RES-002`，被绑定删除 409 `ERR-RES-004` |
| 项目自动驾驶 | `POST/GET /admin/projects/{projectId}/autopilot`、`GET /admin/projects/{projectId}/plans`、`GET /admin/projects/{projectId}/decisions`、`POST /admin/projects/{projectId}/decisions/{decisionId}/decide` | 建项目填版本库即检出（Git 浅克隆 / SVN checkout）→ 静态扫描 → 回填档案 → 生成开发/测试/部署计划 → 仅裁决项入队；svn 客户端缺失或检出失败 502 `ERR-AUTO-002`，裁决重复 404 `ERR-AUTO-004` |
| 自动化生产 | `POST /admin/projects/{projectId}/deploy-test` | 自动发布测试环境：建发布单 → 执行 `OPC_TEST_DEPLOY_CMD` 或显式命令 → 健康检查；无命令 202 转裁决，执行失败 502 `ERR-AUTO-005` |
| 运维反馈 | `GET /admin/usage/summary`、`POST /admin/usage/insight`、`GET /admin/issues`、`POST /admin/issues/sync` | 用量回顾（动作/状态/耗时聚合）、AI/规则审视产出体验需求草稿、Issue 草稿列表与投递（去重 + 单轮5/单日20 限额；未配置 token 保留草稿） |
| 创意转项目 | `POST /admin/ideas/analyze`、`POST /admin/projects/from-idea`、`GET /admin/projects/{projectId}/ideas` | 文本/文档创意（txt/md/docx/xlsx/pdf，多文件）经 AI/规则解析后自动建项目并进自动驾驶；无仓库转 repository 裁决；不支持格式 415 `ERR-IDEA-002` |
| 微信推送 | `GET /admin/wechat/status`、`GET /admin/wechat/outbox`、`POST /admin/wechat/push`、`POST /admin/wechat/sync` | 裁决/简报 → 微信（BotHarness 主动投递）；未绑定只排队；失败退避 5 次；正文脱敏 |

**失败语义**：项目侧复用 `ERR-PRJ-001..003`；情报侧新增 `ERR-INT-001`（参数/状态非法）与 `ERR-INT-002`（资源不存在）；基础资源侧 `ERR-RES-001`（参数/类型非法）、`ERR-RES-002`（凭据非引用）、`ERR-RES-003`（资源/绑定不存在）、`ERR-RES-004`（仍被项目绑定）。所有写操作记录 `actor=boss` 审计；不返回明文凭据。

**P85 `POST /admin/projects/{projectId}/autopilot` 契约细节（v2.22 增补）**：

| 项 | 内容 |
| :--- | :--- |
| 入参 | `repository:{url, kind?, branch?, revision?, authRef?, name?}`（`url` 必填，不从已登记版本库隐式回填）；工具 `opc_project_bootstrap` 的平铺参数 `repositoryKind`、`revision` 与 `repository.kind`、`repository.revision` 语义相同 |
| 版本库类型 | `kind ∈ {git,svn}`；显式优先，`svn://`、`svn+ssh://` 推断 svn，其余默认 git |
| Git 语义 | `branch`=分支；检出提交落 `commit_sha` |
| SVN 语义 | `branch`=主干/分支路径（相对 URI，如 `trunk`、`branches/release-1.0`，也接受绝对 URL）；`revision`=`HEAD`\|数字\|`r数字`，默认 `HEAD`；检出修订号落 `revision` |
| 出参 | `bootstrap.repository.kind`（git/svn）；`bootstrap.checkout.vcs`（git/svn）与 `revision`（git 为 null、svn 为实际修订号）；svn 时 `commit=null` |
| 失败 | 参数/凭据非法 400 `ERR-AUTO-001/003`；检出失败或缺少 svn 客户端 502 `ERR-AUTO-002`（后者登记 `topic=svn_client` 裁决） |

**SVN 检出与客户端口径**：SVN 检出走本机 CLI（subversion ≥1.10），认证密码经 stdin 传送，凭据仅接受 `env:` 引用，不落库、不进日志；svn 客户端缺失时返回 502 `ERR-AUTO-002` 并登记 `topic=svn_client` 裁决，不伪造工作副本、档案与计划；扫描跳过 `.git/.svn/.hg/node_modules/dist`；SVN 骨架只落工作副本（`status=generated`）、不建本地分支不提交、不产生 `scaffold_review` 裁决；测试环境发布版本号取 `coalesce(commit_sha, revision)`。

## 8. DSH 工具契约（工具即接口）

### 8.1 "工具即接口"的八条约定（与 Java/TS 实现语言无关）

| 编号 | 约定 | 说明 |
| :--- | :---------------------- | :----------------------------------------------------------------------------------------------------------- |
| TI-1 | 命名固定式 | `opc_<域族>_<动词>_<名词>`；域族取产品设计 §8.1 的十一族 `finance`/`legal`/`admin`/`strategy`/`project`/`intel`/`crm`/`inv`/`vehicle` 加中枢族 `hub`、表现层族 `web`、员工目录族 `employee`、WBS 族 `wbs`、外宣族 `publicity`。新增工具只增不改，不改既有工具名与语义 |
| TI-2 | 契约先于实现 | 工具名、必填参数、返回结构、失败语义登记在本章；实现须与之一致；未登记的工具视为内部实现细节，不构成对外契约 |
| TI-3 | 同一 Result 信封 | 工具返回与 HTTP 同一口径：成功 `code=0` + `data`；失败 `code=<http 状态>` + `errorCode` + `message` + `details`（§1.1） |
| TI-4 | 校验先于副作用 | 入参 schema 与 `meta` 校验必须在任何副作用之前完成；校验失败不产生写入（与架构 §3.1"meta 校验发生在任何执行之前"同构） |
| TI-5 | 写工具必须声明写域 | 员工插件注册时为每个写工具声明 `write_targets`；Registry 据此判定风险等级，不看流程自述（架构 §七） |
| TI-6 | 写工具必须支持幂等键 | 同键同参返回既有结果并置 `idempotentHit=true`；同键不同参返回 `ERR-WF-004`；禁止"重试即重写" |
| TI-7 | 不许把失败改成成功 | 工具不得降级返回"默认通过"；Verifier 不可用时节点阻塞；降级只能按 SRS §11.4 的显式路径 |
| TI-8 | 审计由中枢注入，禁止递归派工 | 工具调用自动落审计并注入 `workflow_instance_id`，实现方不得自行写 audit；员工不得递归派工，工具集封闭 |

### 8.2 中枢工具（`opc_hub_*`）

| 工具名 | 用途 | 必填参数 | 返回结构 | 失败语义 |
| :---------------------------- | :----------------------- | :------------------------------------------------ | :------------------------------------------------------------ | :----------------------------------------------------- |
| `opc_hub_view_query` | 视图只读查询 | `pluginId`、`viewId` | `{code,data:{viewId,rows,rowCount}}` | 越权/未知视图：`ERR-AUTHZ-001` / `ERR-VIEW-001`，不返回空集代替拒绝 |
| `opc_hub_token_issue` | 签发一次性令牌 | `taskId`、`pluginId`、`viewId`、`fieldScope` | `{code,data:{tokenId,expiresAt}}` | 范围/有效期非法：`ERR-TOKEN-001`，不签发半成品令牌 |
| `opc_hub_token_consume` | 消费令牌 | `tokenId`、`taskId` | `{code,data:{tokenId,fields}}` | 已用/过期/任务不符：`ERR-TOKEN-001`，不重试、不返回旧值 |
| `opc_hub_conflict_open` | 登记冲突并冻结 | `conflictType`、`frozenUnitType`、`frozenUnitId`、`parties` | `{code,data:{conflictId,status,frozen}}` | 类型越界/单元不存在：`ERR-CONFLICT-001`；同单元重复登记返回既有记录 |
| `opc_hub_conflict_resolve` | 老板裁决 | `conflictId`、`choice` | `{code,data:{conflictId,status,frozen}}` | 冲突不存在：`ERR-CONFLICT-001`（404）；`manual` 缺值：同码（400） |
| `opc_hub_workflow_register` | 注册流程版本 | `workflowId`、`version`、`ownerPlugin`、`meta`、`code` | `{code,data:{workflowId,version,riskLevel,status}}` | 守卫失败：`ERR-WF-001`（422，带 `failures[]`）；版本冲突：`ERR-WF-002` |
| `opc_hub_workflow_start` | 启动实例 | `workflowId` | `{code,data:{instanceId,workflowId,version,status}}` | 未注册/无授权：`ERR-WF-003` |
| `opc_hub_node_complete` | 完成写节点（幂等） | `instanceId`、`nodeId`、`payload` | `{code,data:{nodeId,status,idempotentHit,output}}` | 幂等键冲突：`ERR-WF-004`；不得覆盖既有写入 |
| `opc_hub_verdict_record` | 记录评判 | `instanceId`、`nodeId`、`verdict`、`sampling` | `{code,data:{verdictId,finalVerdict,confidence,escalated,cacheHit}}` | 参数非法/节点不在 `key_nodes`：`ERR-WF-001` |
| `opc_hub_diagnose` | 定位失败环节并给建议 | `instanceId`、`nodeId`、`verdict` | `{code,data:{localization,evidence,suggestion,impact}}` | 无可用证据：`ERR-WF-001`，输出"证据不足"而非猜测结论 |
| `opc_hub_audit_record` | 审计统一写入口 | `action`、`actor`、`object`、`result` | `{code,data:{auditId,chainSeq}}` | 写入失败：`ERR-AUDIT-001`；业务动作随之失败（不出现无审计的业务结果） |
| `opc_hub_audit_export` | 增量导出审计 | 无（可选 `sinceId`） | `{code,data:{filePath,sha256,rowCount,prevHash}}` | 导出失败：`ERR-AUDIT-001`，重试 3 次后告警 |
| `opc_hub_task_upsert` | 配置定时任务 | `taskId`、`cron`、`timezone` | `{code,data:{taskId,cron,nextRunAt,enabled}}` | cron/类型非法：`ERR-TASK-001` |
| `opc_hub_task_run` | 立即执行任务 | `taskId` | `{code,data:{runId,taskId,status,skipped,result}}` | 任务不存在：`ERR-TASK-002`；重复触发返回 `skipped=true` |

### 8.3 员工工具（十一族）

| 工具名 | 用途 | 必填参数 | 返回结构 | 失败语义 |
| :----------------------------- | :-------------------- | :------------------------------------------------------- | :-------------------------------------------------------- | :----------------------------------------------------- |
| `opc_finance_ledger_write` | 台账写入（幂等） | `date`、`amount`、`direction`、`category`、`entity` | `{code,data:{ledgerId,idempotentHit,conflictFrozen}}` | 幂等冲突：`ERR-WF-004`；命中冻结：返回 `conflictFrozen=true` 并挂起该条 |
| `opc_finance_tax_calendar_upsert` | 申报日历维护 | `taxType`、`period`、`deadline` | `{code,data:{calendarId,sourceVersion}}` | 参数缺失：`ERR-SYS-001`（400）；不写无来源版本的条目 |
| `opc_finance_ar_ap_query` | 应收应付查询 | 无 | `{code,data:{rows,rowCount}}` | 无数据返回空集 + `数据不足，无法判断` 标注，不猜测 |
| `opc_legal_contract_upsert` | 合同台账写入 | `counterparty`、`amount`、`term` | `{code,data:{contractId,conflictFrozen}}` | 冻结命中：挂起并推裁决；不静默跳过 |
| `opc_legal_risk_scan` | 签约前风险扫描 | `contractId` | `{code,data:{hits[],disclaimer}}` | 规则库缺失：返回"数据不足"并保留 `disclaimer`，不给风险结论 |
| `opc_admin_event_upsert` | 日程登记 | `time`、`participants` | `{code,data:{eventId,conflicts[]}}` | 时间冲突：返回 `conflicts[]`，不覆盖原日程 |
| `opc_admin_action_item_upsert` | 行动项登记 | `meetingId`、`owner`、`due` | `{code,data:{actionItemId,status}}` | 缺 `owner`/`due`：拒绝写入 |
| `opc_strategy_objective_upsert` | 目标登记 | `objective`、`keyResults` | `{code,data:{objectiveId,frozenFootnote}}` | 取数遇冻结：`frozenFootnote` 必填，不静默剔除 |
| `opc_strategy_decision_log` | 决策留痕 | `context`、`choices`、`chosen`、`rationale` | `{code,data:{decisionId}}` | 缺 `rationale`：拒绝写入（不许无理由决策留痕） |
| `opc_project_status_update` | 项目状态更新 | `projectId`、`stage`、`progress` | `{code,data:{projectId,blockers[]}}` | 进度回退须带原因，否则拒绝 |
| `opc_project_acceptance_submit` | 提交验收 | `projectId`、`deliverables` | `{code,data:{acceptanceId,humanGate}}` | 缺交付物清单：拒绝；`humanGate=hold` 时不自动通过 |
| `opc_intel_lead_capture` | 线索入库 | `source`、`score` | `{code,data:{leadId,score}}` | 无来源：拒绝（线索必须可溯源） |
| `opc_intel_dd_report_write` | 尽调报告写入 | `target`、`dimensions`、`conclusion`、`dataSources`、`coverageDisclaimer` | `{code,data:{ddReportId}}` | 缺覆盖度声明块：拒绝写入 |
| `opc_crm_customer_upsert` | 客户记忆卡维护 | `customerId`（或新建标识） | `{code,data:{customerId,sensitivityLevel}}` | 缺敏感级别：拒绝并提示标注 |
| `opc_crm_commitment_upsert` | 承诺登记 | `customerId`、`content`、`due`、`source` | `{code,data:{commitmentId,pendingConfirm}}` | 默认 `pendingConfirm=true`，未经老板确认不计入统计 |
| `opc_crm_sensitive_write` | 敏感字段私有写入 | `customerId`、`field`、`value`、`level` | `{code,data:{sensitiveId}}` | 只写 `biz.customer_sensitive`；不得回写视图或中枢 |
| `opc_vehicle_log_write` | 用车台账 | `date`、`mileage`、`purpose` | `{code,data:{vehicleLogId,voucherMissing[]}}` | 有补贴缺协议/里程：拦截入账并返回缺失项 |
| `opc_vehicle_subsidy_confirm` | 补贴标准确认 | `standardId`、`decision` | `{code,data:{standardId,status}}` | 非官方来源：拒绝进入候选；候选不参与计算 |
| `opc_inv_stock_txn_write` | 出入库（幂等） | `skuId`、`qty`、`unitPrice`、`type` | `{code,data:{stockTxnId,idempotentHit,confirmCard}}` | 四要素不全：返回确认卡，不落库 |
| `opc_inv_sku_upsert` | SKU 维护 | `name`、`unit` | `{code,data:{skuId,aliases[]}}` | 一别名多 SKU：拒绝，要求消歧 |

#### 8.3.1 情报日报与数据源工具（`opc_intel_*`，v2.13 契约）

| 工具名 | 用途 | 必填参数 | 返回结构 | 失败语义 |
| :--- | :--- | :--- | :--- | :--- |
| `opc_intel_source_manage` | 数据源注册/更新/停用 | `name`、`sourceType` | `{code,data:{sourceId,status}}` | 缺 `authRef` 却要求认证：拒绝；版权 `restricted` 不启用采集 |
| `opc_intel_project_scope_manage` | 项目情报空间配置 | `projectId`、`name`、`timezone`、`briefTime` | `{code,data:{projectId,configVersion}}` | 同一项目重复建空间：409；`briefTime` 非法：400 |
| `opc_intel_keyword_manage` | 项目关键词维护 | `projectId`、`keyword`、`matchType` | `{code,data:{topicId,version}}` | 非法正则/布尔式：400；跨项目改关键词：403 |
| `opc_intel_tag_manage` | 项目标签字典维护 | `projectId`、`name` | `{code,data:{tagId,status}}` | 同项目重名：409；跨项目引用：403 |
| `opc_intel_collect_manage` | 触发采集/重跑来源 | `projectId`（可选 `sourceId`） | `{code,data:{collectRunId,status,fetched,inserted}}` | 未配置适配器：标 `blocked`，不返回虚构条数 |
| `opc_intel_analysis_manage` | 触发分析/重跑条目 | `projectId`（可选 `itemId`） | `{code,data:{analyzed,filtered}}` | 无待分析条目返回 0 并标注“本期无新增” |
| `opc_intel_brief_manage` | 生成/读取项目日报 | `projectId`、`briefDate` | `{code,data:{briefId,version,status,itemCount}}` | 无条目生成空白简报；已推送版本不覆盖 |
| `opc_intel_pipeline_manage` | 查询/重跑流水线阶段 | `projectId`、`stage` | `{code,data:{stage,status,counters}}` | 前置未完成：`skipped` 并带原因，不伪造成功 |
| `opc_intel_push_manage` | 推送日报/查询送达 | `briefId` | `{code,data:{sent,pending,status}}` | 外部渠道不可用：降级 inapp 并标“外部渠道未送达” |

上述工具与 `OPC-SRS-106` REQ-INT-011..018 对应；本地规则流水线已在 `src/domains/intel/daily.ts` 落地，外部采集与投递适配器属 Phase 2，未配置时按失败语义降级。

工具族与 `modules.yaml` 的模块一一对应：`finance`→`opc.domains.finance`，`legal`→`opc.domains.legal`，`admin`→`opc.domains.admin`，`strategy`→`opc.domains.strategy`，`project`→`opc.domains.project`，`intel`→`opc.domains.intel`，`crm`→`opc.domains.crm`，`vehicle`→`opc.domains.vehicle`，`inv`→`opc.domains.inventory`，`hub`→`opc.platform` + `opc.workflow` + `opc.scheduler` + `opc.audit`。

### 8.4 网页表现层工具（`opc_web_*`）

| 工具名 | 用途 | 必填参数 | 失败语义 |
| :--- | :--- | :--- | :--- |
| `opc_web_manifest` | 返回插件栏/右栏清单 | — | 无 |
| `opc_web_ingest` | 归置会话/上传输入 | `sourceType`、`sourceRef`、`text` | 文本/来源为空 `ERR-WEB-001` |
| `opc_web_inbox` | 读取待归置收件箱 | —（可选 `status`/`limit`） | 无 |
| `opc_web_confirm` | 确认/忽略归置项 | `id` | 不存在 404、已处理 409 |
| `opc_web_dashboard` | 驾驶舱快照 | —（可选 `range`） | 聚合失败保留上次快照并标陈旧 |
| `opc_web_session_grant` | 授予会话读取范围 | `sessionId`、`purpose` | 用途/会话为空 `ERR-WEB-001` |
| `opc_web_session_context` | 读取已授权会话 | `sessionId` | 未授权/过期 403 |
| `opc_web_memory_search` | 按 scope 检索记忆 | `query`、`scopes`、`purpose` | 空 query/scope 400 |
| `opc_web_memory_propose` | 提出记忆写入建议 | `type`、`title`、`content`、`sourceRefs` | 无来源 400 |
| `opc_web_radar` | 读取插件/关键词雷达 | —（可选 `type`/`status`） | 无数据空数组；不自动安装 |

### 8.5 员工插件工具（`opc_employee_*`）

| 工具名 | 用途 | 必填参数 | 失败语义 |
| :--- | :--- | :--- | :--- |
| `opc_employee_list` | 列出员工插件与 manifest | — | 无数据空数组 |
| `opc_employee_install` | 按 manifest 安装（默认停用） | `manifest` | manifest 非法/依赖缺失 `ERR-EMP-001` |
| `opc_employee_toggle` | 启用/停用 | `pluginId`、`enabled` | 有依赖未先停用 409 |
| `opc_employee_export` | 导出员工包 | `pluginId` | 不存在 404；默认不含业务数据 |
| `opc_employee_import` | 导入员工包（dry-run/confirm） | `package` | 校验失败 422；confirm 才安装 |

### 8.6 工具返回结构（统一信封）

```json
{
  "code": 0,
  "data": {
    "nodeId": "write_ledger",
    "status": "done",
    "idempotentHit": true,
    "output": { "ledgerId": 1042 }
  }
}
```

失败信封（工具层与 HTTP 层同构，便于同一套断言复用）：

```json
{
  "code": 409,
  "errorCode": "ERR-WF-004",
  "message": "幂等键冲突：instanceId=7 nodeId=write_ledger 入参与首次不同",
  "details": { "firstPayloadHash": "3f2a…", "currentPayloadHash": "9c71…" }
}
```

### 8.7 工具层的三条额外禁令

- 不得在工具内部吞掉错误后返回 `code=0`（TI-7）；调用方按 `errorCode` 分流，不按 `message` 文本。
- 不得让同一 `evidence_hash` 的重复评判改变结论（只置 `cacheHit=true`）。
- 不得让工具绕过视图授权直接读表；跨域一律"视图 → `need_detail` → 令牌"三选一，且三条路径都进审计。

## 9. 错误码与失败语义总表

### 9.1 接口 × 错误码矩阵

| 接口 | ERR-VIEW-001 | ERR-AUTHZ-001 | ERR-TOKEN-001 | ERR-CONFLICT-001 | ERR-WF-001 | ERR-WF-002 | ERR-WF-003 | ERR-WF-004 | ERR-AUDIT-001 | ERR-TASK-001 | ERR-TASK-002 | ERR-WEB-001 | ERR-EMP-001 | ERR-PRJ-001 | ERR-PRJ-002 | ERR-PRJ-003 | ERR-SYS-001 |
| :---------------------- | :----------: | :----------: | :----------: | :----------: | :----------: | :----------: | :----------: | :----------: | :----------: | :----------: | :----------: | :----------: | :----------: | :----------: | :----------: | :----------: | :----------: |
| P1 health |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P2 queryView | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P3 issueToken |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P4 consumeToken |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P5 openConflict |  |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P6 resolveConflict |  |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P7 registerWorkflow |  |  |  |  | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  | ✓ |
| P8 startInstance |  |  |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |  | ✓ |
| P9 completeNode |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |  |  |  | ✓ |
| P10 recordVerdict |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P11 listAudits |  |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |  |  | ✓ |
| P12 exportAudits |  |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |  |  | ✓ |
| P13 listTasks |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P14 upsertTask |  |  |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |  | ✓ |
| P15 runTask |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  |  |  | ✓ |
| P16 getDailyReport |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P17 getWebManifest |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P18 getDashboard |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P19 listIngestInbox |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P20 ingestText |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  |  | ✓ |
| P21 confirmIngest |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  |  | ✓ |
| P22 grantSession |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  |  | ✓ |
| P23 revokeSession |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  |  | ✓ |
| P24 getSessionContext |  |  | ✓ |  |  |  |  |  |  |  |  | ✓ |  |  |  |  | ✓ |
| P25 searchMemory |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  |  | ✓ |
| P26 proposeMemory |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  |  | ✓ |
| P27 confirmMemoryProposal |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  |  | ✓ |
| P28 listRadar |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P29 listEmployees |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| P30 getEmployee |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  | ✓ |
| P31 installEmployee |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  | ✓ |
| P32 toggleEmployee |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  | ✓ |
| P33 exportEmployeePackage |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  | ✓ |
| P34 importEmployeePackage |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  | ✓ |
| P35 listProjectMilestones |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  | ✓ |
| P36 createProjectMilestone |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  | ✓ |
| P37 listCodeRepositories |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  | ✓ |
| P38 registerCodeRepository |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  | ✓ | ✓ |
| P39 listArtifactRepositories |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  | ✓ |
| P40 registerArtifactRepository |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  | ✓ | ✓ |
| P41 listDeployEnvironments |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  | ✓ |
| P42 registerDeployEnvironment |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  | ✓ | ✓ |
| P43 listReleaseOrders |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  | ✓ |
| P44 createReleaseOrder |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  | ✓ |
| P45 approveReleaseOrder |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ | ✓ |  | ✓ |
| P46 createTestPlan |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  | ✓ |
| P47 createTestRun |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  | ✓ |
| P48 recordTestResult |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  | ✓ |
| P49 listDefects |  |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  | ✓ |

#### 9.1.1 基础资源接口错误码（P77–P84）

| 接口 | ERR-RES-001 | ERR-RES-002 | ERR-RES-003 | ERR-RES-004 |
| :--- | :---: | :---: | :---: | :---: |
| P77 listSharedResources |  |  |  |  |
| P78 createSharedResource | ✓ | ✓ |  |  |
| P79 getSharedResourceDefaults |  |  |  |  |
| P80 updateSharedResource | ✓ | ✓ | ✓ |  |
| P81 deleteSharedResource |  |  | ✓ | ✓ |
| P82 listProjectSharedResources |  |  |  |  |
| P83 bindProjectSharedResources | ✓ |  |  |  |
| P84 unbindProjectSharedResource |  |  | ✓ |  |

#### 9.1.2 项目自动驾驶接口错误码（P85–P89）

| 接口 | ERR-AUTO-001 | ERR-AUTO-002 | ERR-AUTO-003 | ERR-AUTO-004 |
| :--- | :---: | :---: | :---: | :---: |
| P85 bootstrapProjectAutopilot | ✓ | ✓ | ✓ |  |
| P86 getProjectAutopilot | ✓ |  |  |  |
| P87 listProjectPlans |  |  |  |  |
| P88 listProjectDecisions |  |  |  |  |
| P89 decideProjectDecision |  |  |  | ✓ |
| P90 deployProjectTest |  |  |  |  |
| P91 getUsageSummary |  |  |  |  |
| P92 generateUsageInsight |  |  |  |  |
| P93 listIssues |  |  |  |  |
| P94 syncIssues |  |  |  |  |
| P95 analyzeIdea |  |  |  |  |
| P96 createProjectFromIdea |  |  |  |  |
| P97 listProjectIdeas |  |  |  |  |
| P98 getWechatStatus |  |  |  |  |
| P99 listWechatOutbox |  |  |  |  |
| P100 pushWechatText |  |  |  |  |
| P101 syncWechatOutbox |  |  |  |  |

### 9.2 失败语义三原则

| 原则 | 内容 | 反例（禁止实现） |
| :--- | :--------------------------------------------------------------------------------------- | :------------------------------------------- |
| F1 | 失败必须显式：返回错误码，不返回空数据冒充成功 | 无授权时返回 `{code:0,data:{rows:[]}}` |
| F2 | 失败必须留痕：视图、令牌、流程、任务四类失败都写审计 | 越权尝试不写审计，导致无法发现探测行为 |
| F3 | 失败不得静默降级：Verifier 不可用、审计导出失败、守卫失败都必须暴露 | 守卫失败仍注册成功；导出失败返回上一版哈希 |

## 10. 接口验收与追溯

### 10.1 接口—需求—用例—测试映射

| 接口 | REQ | UC | TC | 契约断言（G2 门禁必查） |
| :-------- | :--------------------------------- | :------- | :------------------------ | :------------------------------------------------------------- |
| P1 | REQ-NFR-019 | — | — | 四项状态字段齐全（`pg`/`pgvector`/`scheduler`/`version`） |
| P2 | REQ-VIEW-001..004 | UC-001 | TC-VIEW-001 | 未授权 403 + `ERR-AUTHZ-001`；每次查询一条审计；返回不含敏感字段 |
| P3 | REQ-TOKEN-001、002 | UC-002 | TC-TOKEN-001 | `expiresAt − 签发时刻 ≤ 300`；四必填缺失即 400 |
| P4 | REQ-TOKEN-001..003 | UC-002 | TC-TOKEN-001、002 | 二次消费 409；审计无字段值 |
| P5 | REQ-CONFLICT-001、002 | UC-003 | TC-CONFLICT-001 | 四类枚举；`frozen=true`；汇总返回总额含冻结 + 脚注 |
| P6 | REQ-CONFLICT-003 | UC-003 | TC-CONFLICT-002 | 四值枚举；裁决后 `frozen=false`；写 `arbitration_log` |
| P7 | REQ-WF-001、004、006..009 | UC-004 | TC-WF-001、002 | 六项守卫逐项可复现失败；422 带 `failures[]`；`meta` 含 `risk_level` 被拒 |
| P8 | REQ-WF-002 | UC-005 | TC-WF-003 | 未注册 404 `ERR-WF-003`；实例写生命周期事件 |
| P9 | REQ-WF-002 | UC-005 | TC-WF-003、004 | 同键同参 `idempotentHit=true`；同键不同参 409 `ERR-WF-004` |
| P10 | REQ-WF-003、005 | UC-006 | TC-WF-005 | 低置信且高影响 `escalated=true`；`cacheHit` 不改结论 |
| P11 | REQ-AUDIT-001 | UC-007 | TC-AUDIT-001 | `limit > 500` 拒绝；失败不返回空数组 |
| P12 | REQ-AUDIT-002..004 | UC-007 | TC-AUDIT-002 | 返回 `sha256` 与 `prevHash`；链头更新；只追加 |
| P13 | REQ-TASK-001 | UC-008 | TC-TASK-001 | 返回 `nextRunAt` 与最近运行状态 |
| P14 | REQ-TASK-001 | UC-008 | TC-TASK-001 | cron 非法 400 `ERR-TASK-001`；`nextRunAt` 与 cron+timezone 一致 |
| P15 | REQ-TASK-001、003 | UC-008 | TC-TASK-002、003 | 重复触发 `skipped=true`；`force` 写审计 |
| P16 | REQ-TASK-002 | UC-009 | TC-TASK-004 | 五项汇总口径齐全；无晨报 404 |
| P17 | REQ-WEB-001 | UC-014 | TC-WEB-005 | `pluginId=opc_web`；五个页签；无插槽时明确降级 |
| P18 | REQ-WEB-004 | UC-012 | TC-WEB-003 | 统一 `asOf`；`stale` 与 `warnings`；不填 0 |
| P19 | REQ-WEB-003 | UC-010 | TC-WEB-001 | 空收件箱返回空数组；`limit` 1–200 |
| P20 | REQ-WEB-003 | UC-010 | TC-WEB-001 | 高风险域 `confirm`；重复 200 `duplicate=true` |
| P21 | REQ-WEB-003 | UC-010 | TC-WEB-001 | 已处理 409；确认写审计 |
| P22 | REQ-WEB-002 | UC-011 | TC-WEB-002 | TTL 60–86400；授权写审计 |
| P23 | REQ-WEB-002 | UC-011 | TC-WEB-002 | 撤回后下一次读取 403 |
| P24 | REQ-WEB-002 | UC-011 | TC-WEB-002 | 默认最近 20 条；未授权 403 |
| P25 | REQ-WEB-002 | UC-011 | TC-WEB-002 | 必须指定 scope；敏感记忆脱敏 |
| P26 | REQ-WEB-002 | UC-011 | TC-WEB-002 | 无来源引用 400；不直接落库 |
| P27 | REQ-WEB-002 | UC-011 | TC-WEB-002 | 确认后落库；重复确认 409 |
| P28 | REQ-WEB-005 | UC-013 | TC-WEB-004 | 只读；不自动安装；附来源与风险 |
| P29 | REQ-EMP-001 | — | TC-EMP-002 | 返回 11 个 manifest 与启用状态 |
| P30 | REQ-EMP-001 | — | TC-EMP-002 | 不存在 404 `ERR-EMP-001` |
| P31 | REQ-EMP-002 | — | TC-EMP-002 | manifest 非法/依赖缺失 422；默认停用 |
| P32 | REQ-EMP-002 | — | TC-EMP-002 | 有依赖插件未先停用 409 |
| P33 | REQ-EMP-006 | — | TC-EMP-003 | 包 checksum 一致；默认不含业务数据 |
| P34 | REQ-EMP-007 | — | TC-EMP-003 | dry-run/confirm；非法包 422；导入默认停用 |
| P35 | REQ-PRJ-016、022 | UC-015、021 | TC-PRJ-001、007 | 项目不存在 404 `ERR-PRJ-001`；里程碑目标日期不被自动改写 |
| P36 | REQ-PRJ-016、022 | UC-015、021 | TC-PRJ-001、007 | 必填 `name/targetDate`；创建写审计 |
| P37 | REQ-PRJ-017 | UC-016 | TC-PRJ-002 | 返回登记列表；不返回凭据明文 |
| P38 | REQ-PRJ-017 | UC-016 | TC-PRJ-002 | 明文 `authRef` 400 `ERR-PRJ-003`；`env:/secret:/vault:/ssh-agent:` 通过 |
| P39 | REQ-PRJ-018 | UC-017 | TC-PRJ-003 | 返回制品库列表；保留策略只展示 |
| P40 | REQ-PRJ-018 | UC-017 | TC-PRJ-003 | 明文凭据拒绝；登记写审计 |
| P41 | REQ-PRJ-019 | UC-018 | TC-PRJ-004 | 返回环境列表；不返回凭据明文 |
| P42 | REQ-PRJ-019 | UC-018 | TC-PRJ-004 | 生产 `approvalPolicy=auto` 400；`manual` 通过 |
| P43 | REQ-PRJ-019 | UC-018 | TC-PRJ-004 | 发布单列表按 id 倒序 |
| P44 | REQ-PRJ-019 | UC-018 | TC-PRJ-004 | 生产缺 `rollbackVersion` 400；非生产自动策略 `policy:auto` |
| P45 | REQ-PRJ-019 | UC-018 | TC-PRJ-004 | 非 pending 409 `ERR-PRJ-002`；审批写审计 |
| P46 | REQ-PRJ-020 | UC-019 | TC-PRJ-005、006 | 进入/退出标准落库；初始 `draft` |
| P47 | REQ-PRJ-020、021 | UC-019、020 | TC-PRJ-005、006 | `executorType` 枚举 human/agent/ci；初始 `running` |
| P48 | REQ-PRJ-020、021 | UC-019、020 | TC-PRJ-005、006 | blocked/skipped 不计通过；失败置批次 `failed` |
| P49 | REQ-PRJ-020、021 | UC-019、020 | TC-PRJ-005、006 | 返回缺陷列表；空列表返回 `[]` |
| P77 | REQ-PRJ-023 | UC-022 | TC-RES-001 | 按 kind/status 过滤；返回六类资源目录 |
| P78 | REQ-PRJ-023、024 | UC-022 | TC-RES-001、004 | 类型非法 400 `ERR-RES-001`；明文凭据 400 `ERR-RES-002` |
| P79 | REQ-PRJ-024 | UC-022 | TC-RES-001 | 返回默认口径 debian/ssh/canetwork 与各类型默认资源 |
| P80 | REQ-PRJ-023 | UC-022 | TC-RES-005 | 不存在 404 `ERR-RES-003`；更新写审计 |
| P81 | REQ-PRJ-023、026 | UC-022 | TC-RES-005 | 被绑定 409 `ERR-RES-004`；删除写审计 |
| P82 | REQ-PRJ-026 | UC-023 | TC-RES-002、003 | 返回绑定含 appliedByDefault 来源标记 |
| P83 | REQ-PRJ-025 | UC-023 | TC-RES-003 | 显式选型覆盖默认；非法资源 400 `ERR-RES-001` |
| P84 | REQ-PRJ-026 | UC-023 | TC-RES-005 | 未绑定 404 `ERR-RES-003`；解绑写审计 |
| P85 | REQ-PRJ-027..029、036 | UC-024、025 | TC-AUTO-001..003、010、011 | Git/SVN 双协议检出；svn 修订号落库；svn 客户端缺失 502 `ERR-AUTO-002` + `svn_client` 裁决；只读扫描；三计划 draft |
| P86 | REQ-PRJ-027、028 | UC-024 | TC-AUTO-001 | 返回最近检出/扫描/计划/裁决与回填档案 |
| P87 | REQ-PRJ-029 | UC-025 | TC-AUTO-002 | 返回 dev/test/deploy 三份计划 |
| P88 | REQ-PRJ-030 | UC-025 | TC-AUTO-003 | 默认全部；`status=pending` 仅待裁决 |
| P89 | REQ-PRJ-030 | UC-025 | TC-AUTO-003、004 | 非 pending 404 `ERR-AUTO-004`；裁决写审计 |
| P90 | REQ-PRJ-033 | UC-026 | TC-AUTO-007 | 建发布单并执行发布；无命令 202 pending 转裁决；失败 502 `ERR-AUTO-005` |
| P91 | REQ-OPS-002 | UC-027 | TC-OPS-001 | 按天聚合调用量/错误率/慢操作/页签分布 |
| P92 | REQ-OPS-002 | UC-027 | TC-OPS-004 | 产出 [体验]/[需求]/[流程] 草稿并去重 |
| P93 | REQ-OPS-001 | UC-028 | TC-OPS-005 | 返回草稿与投递结果，可按 status 过滤 |
| P94 | REQ-OPS-001、003 | UC-028 | TC-OPS-002、003 | 去重 + 限额投递；未配置 token 标 skipped 不失败 |
| P95 | REQ-PRJ-035 | UC-030 | TC-IDEA-001、002、005 | 文本/多格式文档解析；非法格式 415 `ERR-IDEA-002` |
| P96 | REQ-PRJ-035 | UC-030 | TC-IDEA-003、004 | 建项目 + 默认资源绑定；有仓库进自动驾驶，无仓库转裁决 |
| P97 | REQ-PRJ-035 | UC-030 | TC-IDEA-003 | 返回创意原文/解析/来源/状态 |
| P98 | REQ-OPS-004 | UC-031 | TC-WECHAT-001、005 | 返回配置状态、待投递/失败/近24h已发 |
| P99 | REQ-OPS-004 | UC-031 | TC-WECHAT-005 | 队列列表（含最近错误与下次重试） |
| P100 | REQ-OPS-004 | UC-031 | TC-WECHAT-002 | 未配置只入队；配置后投递 |
| P101 | REQ-OPS-004 | UC-031 | TC-WECHAT-003 | 到期投递，失败退避 |

### 10.2 G2 契约门禁验收命令

```bash
# 文档规范（frontmatter / 文末两节 / 编号）
node "scripts/check-docs.mjs" --dir /path/to/opc-xuanji/docs
# spec 引用完整性（api ↔ entities ↔ modules ↔ usecases）
node "scripts/check-spec.mjs" --dir /path/to/opc-xuanji/spec/opc-xuanji
```

### 10.3 契约变更判据

| 变更类型 | 是否破坏性 | 处理 |
| :--------------------------- | :--------- | :----------------------------------------------------------------------- |
| 新增可选字段 / 新增错误码 | 否 | 先改 `api.yaml`，再改本文，再实现；同提交序列 |
| 收紧必填、改枚举、改语义 | 是 | 升本文 `version`，在 §9.4 记录变更点，G2 重新过门禁 |
| 删除字段或接口 | 是 | 走变更单并在 `pa-index.md` 登记；旧版本保留一个发布周期可读 |
| 改 `code`/`errorCode` 口径 | 是 | 直接拒绝——`code=0` 与"失败码 = HTTP 状态"是唯一口径，不参与变更 |

### 10.4 变更记录

| 版本 | 日期 | 变更点 | 依据 |
| :--- | :--------- | :--------------------------------------- | :--------------------------- |
| 0.1 | 2026-11-05 | 首版：16 个接口 + 34 个工具契约 + Result 口径 | `api.yaml` 0.1.0；`usecases.yaml` |
| 0.2 | 2026-11-06 | v2.10：新增 P17–P28 Web 接口、`ERR-WEB-001`、10 个 `opc_web_*` 工具 | `api.yaml` 0.2.0；UC-010..014 |
| 0.3 | 2026-11-06 | v2.11：新增 P29–P34 员工插件/员工包接口、`ERR-EMP-001`、5 个 `opc_employee_*` 工具 | `api.yaml` 0.3.0；员工分册 |
| 0.4 | 2026-11-14 | v2.12：新增 P35–P49 项目研发接口、`ERR-PRJ-001..003` | `api.yaml` 0.4.0；SRS-105 REQ-PRJ-016..022 |

## 自检清单

- [ ] frontmatter 九字段齐全，`doc_id` 为 `OPC-IRS-001` 且与 SRS 不重号，`updated` 为 2026-11-06。
- [ ] 首段写明"解决什么问题/谁何时用"，`## 目录` 覆盖 9 章且锚点可跳转。
- [ ] 114 个 operation 与 `api.yaml` 的 paths 数量、方法、路径、operationId 逐一对应，无增无减。
- [ ] 每个接口六项齐全：用途、调用方、入参、出参、错误码、幂等与重试 + 审计。
- [ ] Result 口径写死为"成功 `code=0`；失败 `code=<http 状态>` + `errorCode` + `message` + `details`"，并有成功/失败两个可复制示例。
- [ ] 35 个错误码全部登记并与 `api.yaml` 的 `errorCodes` 一一对应（含 ERR-RES、ERR-AUTO、ERR-OPS、ERR-IDEA、ERR-WECHAT）。
- [ ] 工具契约表含工具名、用途、必填参数、返回结构、失败语义五列，覆盖 `hub` + 十一族共 31 个实现工具（含员工目录/员工包）。
- [ ] TI-1..TI-8 八条"工具即接口"约定齐备，且明确与 Java/TS 实现语言无关。
- [ ] §8.1 矩阵中每个接口的 ✓ 与 §3~§6 各接口错误码表述一致。
- [ ] §10.1 映射覆盖 UC-001..031 全部三十一个用例与 114 个接口（管理面 52 个见 §7.6）。
- [ ] 全文无未决占位标记，无 `api.yaml` 与设计文档之外的新增数值或字段。
- [ ] 文末两节齐备，`## 与其他文档的关系` 位于全文最后。

## 与其他文档的关系

| 方向 | 文档 | 关系 |
| :--- | :--------------------------------------------------------- | :----------------------------------------------------------------------------- |
| 上游 | `spec/opc-xuanji/api.yaml`（0.1.0） | 接口契约的唯一事实来源；本文 §2~§6 的路径、方法、operationId、schema、错误码、状态码全部取自该文件，冲突以它为准 |
| 上游 | `spec/opc-xuanji/usecases.yaml`（baselineTag `gate-G2-20261105`） | 接口与用例/测试的映射依据；本文 §9.1 的 UC 与 TC 列直接引用其条目 |
| 上游 | `OPC-SRS-001-软件需求规格说明.md` | 需求的接口层展开对象；本文每个接口标注对应 REQ，SRS §12 追溯表的"接口"列反向指向本文 |
| 上游 | `OPC-玄机 · 技术选型与系统架构.md`（v2.11） | 横切约束来源：超时绑定（`AbortSignal.timeout(300_000)`）、缓存与 `evidence_hash` 口径、PgBouncer 不支持跨语句 `SET`、审计链头表、`write_targets` 判定规则 |
| 上游 | `spec/opc-xuanji/entities.yaml` | 出参字段的存储侧依据（snake_case 列名 → camelCase 接口字段的映射）；76 个实体与接口的 `x-entity` 标注对应 |
| 上游 | `spec/opc-xuanji/modules.yaml` | 工具族到模块的归属依据；§7.3 末尾给出九个域族与 `opc.*` 包的对应 |
| 下游 | `OPC-SDD-001-系统设计说明.md` | 按本文契约做分层与实现设计；接口实现不得超出本文登记的错误码与字段 |
| 下游 | `OPC-STD-001-测试设计说明.md`、`OPC-STP-001-测试计划.md` | 按本文 §9.1 的契约断言生成契约测试；`TC-*` 与接口一一对应 |
| 下游 | `docs/index.md`（OPC-SUM-001） | 本文 `doc_id` 在索引中登记为 IRS 类、D2/G2 阶段；状态推进与基线打标在此登记 |
| 平级 | `docs/uml/`（时序图） | 时序图的调用顺序须与本文的鉴权判定顺序（身份 → 授权 → 校验 → 执行）一致 |

- 版本联动：本文 `version: 0.1` 依赖 `api.yaml` 0.1.0 与 SRS `OPC-SRS-001` v0.1；`api.yaml` 升版须同步复核本文 §2~§8 并更新 `updated`。
- 契约纪律：spec → 文档 → 代码 → 测试的变更顺序不可倒置；本文任何字段改动都必须先在 `api.yaml` 出现。
