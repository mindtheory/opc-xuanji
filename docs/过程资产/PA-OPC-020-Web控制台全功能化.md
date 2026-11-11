# PA-OPC-020 Web 控制台全功能化变更记录

- 变更编号：CR-2026-11-11-03
- 日期：2026-11-11
- 发起人：老板（需求提出：驾驶舱要能操作插件全部功能、看到所有员工与模块、类似传统软件）
- 变更类型：需求增量（只读看板 → 全功能控制台）+ 设计/契约/代码/测试同步
- 上游：OPC-SDD-003（应用层）、产品设计 v2.12、技术架构 v2.12、PA-OPC-019（驾驶舱首版）
- 关联门禁：G2（契约：+5 个只读 operation）、G3（实现：client.js 控制台 + 3 个服务列表方法 + 前缀路由）、G4（验证：路由 200/404、桩环境注册、75/75 回归）

## 1. 原始需求

1. OPC驾驶舱 Web 页面应能对插件的**所有功能进行操作**；
2. 能看到**所有员工**，并对员工进行相关操作（安装/启用停用/部署角色卡/派活/导出）；
3. 能看到**各个功能模块、各个流程**，并对模块进行操作（类似传统管理软件）。

## 2. 面板结构（11 个模块页签）

| 页签 | 覆盖操作 | 后端 |
| :--- | :--- | :--- |
| 驾驶舱 | 健康条（PG/pgvector/调度/智能体）、今日/7天/30天/90天快照指标、冻结脚注、晨报 | `/health`、`/web/dashboard`、`/reports/daily` |
| 员工 | 11 个员工目录、安装/重装、启用停用、部署角色卡、派活、员工包导出/导入、运行记录 | `/employees`（含 catalog）、`/employees/{id}/toggle|export`、`/employees`（导入）、`/agents/deploy|dispatch|runs` |
| 业务域 | 9 个经营域 + 平台域聚合指标、授权视图清单 | `/web/dashboard` |
| 流程 | 注册（六项守卫）、版本列表、实例列表、启动实例、实例详情与节点、完成节点、Verifier 评判 | `/workflows`（GET/POST）、`/workflows/{id}/instances`（GET/POST）、`/instances/{id}`、`/instances/{id}/nodes/{nodeId}/complete|verdict` |
| 任务 | 任务列表、立即执行、启用停用、下次触发、晨报 | `/tasks`、`/tasks/{id}/run`、`/tasks/{id}` |
| 审计 | 动作过滤查询、JSONL 导出（SHA-256 + 链头） | `/audits`、`/audits/export` |
| 冲突 | 冲突队列、裁决（A/B/manual/later + 备注） | `/conflicts`（GET/POST）、`/conflicts/{id}/resolve` |
| 收件箱 | 归置项列表、确认/忽略、新增归置 | `/web/inbox`、`/web/ingest`、`/web/ingest/{id}/confirm` |
| 记忆 | 按 scope 检索、记忆提案、确认提案 | `/web/memory/search`、`/propose`、`/proposals/{id}/confirm` |
| 雷达 | 插件/关键词雷达列表 | `/web/radar` |
| 设置 | 智能体健康与全局暂停、manifest | `/agents/health`、`/agents/pause`、`/web/manifest` |

## 3. 关键设计决策（ADR）

| # | 决策 | 理由 | 代价/风险 |
| :--- | :--- | :--- | :--- |
| ADR-01 | 单 client.js 内做多页签控制台（React 组件 + 通用 Table/Field/Area/Select） | DSH Client 插件按单文件模块加载；通用组件控制体积 | 文件较大（≈917 行），需保持可读 |
| ADR-02 | 服务端补 4 个只读端点 + 1 个冲突列表，响应扩展员工目录 | 面板要"看到"才能"操作"，避免前端编造数据 | 契约 +5 operation（38→43），与 ROUTES 同步 |
| ADR-03 | apply 注册 `/api/v1` 前缀路由兜住动态路径 | DSH webServer 最长前缀匹配；浏览器端可访问 `/employees/{id}` 等 | 与独立 serve 共用同一 handler，无重复逻辑 |
| ADR-04 | 写操作一律走既有中枢入口（流程/令牌/审计/视图），面板不写业务表 | 维持"员工不直连数据库"与审计哈希链 | 面板只做编排与确认，不新增裁决权 |
| ADR-05 | 操作成功 flash 提示 + 自动刷新；失败保留旧数据并标红 | 传统软件手感，但不掩盖错误 | 需用户手动重试 |

## 4. 契约变更（G2）

| operation | 说明 |
| :--- | :--- |
| `listWorkflows` | GET /api/v1/workflows（流程版本列表） |
| `listWorkflowInstances` | GET /api/v1/workflows/{workflowId}/instances（实例列表） |
| `getWorkflowInstance` | GET /api/v1/instances/{instanceId}（实例 + 节点） |
| `agentRuns` | GET /api/v1/agents/runs（智能体运行记录） |
| `listConflicts` | GET /api/v1/conflicts（冲突队列） |

`GET /api/v1/employees` 响应增加 `catalog`（11 个员工 manifest），供员工矩阵渲染；安装状态仍以 `items` 为准。

## 5. 验证证据

| 项 | 方式 | 结果 |
| :--- | :--- | :--- |
| 语法 | `node --check client.js` | PASS（917 行） |
| 注册契约 | 桩 `__ModuleLoader__` + 桩 React/slots 执行 factory 与 apply | `main`(key=opc-xuanji)、`sidebar.panellist`(label=OPC驾驶舱) |
| 服务端点 | 独立 `startApiServer` 实测 7 项 | workflows/conflicts/employees.catalog/agents.runs/instances/instance.detail(404)/health 全部符合 |
| 契约对账 | `grep operationId` = 43，`ROUTES` = 43 | PASS（spec 漂移测试会复核） |
| 回归 | `npm test` | 75/75 PASS；typecheck/spec/docs 门禁绿 |

## 6. 回滚

- 代码：还原 `client.js`、删除 5 个只读端点与 `list()` 方法、还原 `api.yaml`；
- 无数据库迁移；回滚不涉及数据。
