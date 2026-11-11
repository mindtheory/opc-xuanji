# PA-OPC-019 Web 界面「OPC驾驶舱」变更记录

- 变更编号：CR-2026-11-11-02
- 日期：2026-11-11
- 发起人：老板（需求提出：在插件栏显示名称「OPC驾驶舱」）
- 变更类型：需求增量（命名与交互位置修正）+ 设计/代码/测试同步
- 上游：产品设计 v2.12、技术架构 v2.12、OPC-SDD-003（应用层）
- 关联门禁：G1（需求命名）、G2（契约：manifest 标题/位置）、G3（实现：client 半）、G4（验证，待浏览器确认）

## 1. 原始需求

1. 给 mindtheory/opc-xuanji 增加 Web 界面；
2. 在 DSH 插件栏显示名称：**OPC驾驶舱**。

## 2. 与既有记录的关系

- 取代 PA-OPC-010 中的“OPC公司管理/右栏面板”命名与位置（PA-OPC-010 作为历史记录保留，不覆盖）；
- 面板能力沿用 PA-OPC-010 的驾驶舱聚合、收件箱归置、雷达与任务数据面，不新增业务裁决权。

## 3. 需求编号

| 编号 | 需求 | 文档 | 代码 | 测试 |
| :--- | :--- | :--- | :--- | :--- |
| REQ-WEB-001（修订） | 插件栏入口与只读驾驶舱面板 | SRS §8.4.1（AC-1 修订）；STD TC-WEB-005 | `client.js`（`sidebar.panellist` + `main`）、`package.json`（`dsh.client`、`exports./client`）、`src/api/http.ts`/`src/plugin/index.ts`（manifest 标题与左栏标识） | `test/integration/web.test.ts`（标题断言） |

## 4. 关键设计决策

| # | 决策 | 理由 | 代价/风险 |
| :--- | :--- | :--- | :--- |
| ADR-01 | 用 DSH Client 插件（`window.__ModuleLoader__.load` + `ctx.slots`）注册左栏入口与主面板 | 与 dsh-super-agents 面板同构，宿主原生插槽，不用 iframe/降级页 | 依赖宿主 `sidebar.panellist`/`main` 插槽存在（已实测存在） |
| ADR-02 | 面板只读，数据全部走宿主侧 `/api/v1/*` | 面板不写库、不派活，维持“员工不直连数据库”的边界 | 写操作仍需回中间会话（确认卡/令牌） |
| ADR-03 | 面板名称统一为「OPC驾驶舱」，manifest 的 `panel` 由 `right` 改 `left` | 与实际宿主左栏注册一致，避免契约与实现漂移 | 旧文档中的“右栏”表述需按 PA-OPC-010 历史口径保留说明 |
| ADR-04 | 30 秒自动刷新 + 手动刷新；失败保留旧数据并显示错误条 | 面板不可把一次请求失败放大成空白页 | 陈旧数据需 as-of 提示（已有） |

## 5. 验证证据

| 项 | 方式 | 结果 |
| :--- | :--- | :--- |
| 语法 | `node --check client.js` | PASS |
| 注册契约 | 桩 `__ModuleLoader__` + 桩 React/slots 执行 factory 与 apply | 注册 `main`（key=opc-xuanji）与 `sidebar.panellist`（id=opc-xuanji、order=27、label=OPC驾驶舱） |
| 数据面 | `GET /api/v1/health`、`/web/dashboard?range=30d`、`/web/inbox`、`/tasks`、`/web/radar` | 200 且 `{code:0,data}` 结构符合面板读取 |
| 单元/集成 | `node --test test/unit/*.test.ts`、`test/integration/*.test.ts` | 待本轮回归（含 web 测试标题断言） |

## 6. 回滚

- 代码：删除 `client.js`、还原 `package.json` 的 `exports./client` 与 `dsh.client`、还原 manifest 标题/位置；
- 无数据库迁移，回滚不涉及数据。
