# PA-OPC-021 Hindsight 记忆导入与同步变更记录

- 变更编号：CR-2026-11-11-04
- 日期：2026-11-11
- 发起人：老板（需求提出：提供 hindsight 记忆插件的记忆导入和同步功能）
- 变更类型：需求增量（记忆互操作）+ 契约/代码/测试/文档同步
- 上游：OPC-SDD-003（应用层）、产品设计 8.4（记忆桥）、dsh-hindsight-memory（Hindsight 客户端插件）、vectorize-io/hindsight openapi
- 关联门禁：G2（契约 +4 operation +1 错误码）、G3（实现：`src/memory/*` + 面板页签）、G4（验证：桩服务端到端、82/82 回归、门禁绿）

## 1. 原始需求

为 Hindsight 记忆插件提供记忆**导入**与**同步**能力。

## 2. 交付

### 2.1 服务端

| 组件 | 说明 |
| :--- | :--- |
| `src/memory/hindsight.ts` | `HindsightBridge`：Hindsight API（`/health`、`/banks/{bank}/stats`、`/memories/list`、`/memories` 写入）的 HTTP 桥；10s 超时、`ERR-HINDSIGHT-001` 归一、`fetchImpl` 可注入；另含两个纯函数 `cardToItem`（OPC 记忆卡→记忆项，敏感卡返回 null）与 `itemToProposal`（Hindsight 记忆→OPC 记忆提案） |
| `src/memory/sync.ts` | `HindsightSyncService`：`status`（可达性+bank 统计+OPC 卡片/待确认提案数）、`list`、`import`（批量导入）、`syncPush`（OPC 记忆卡→Hindsight）、`syncPull`（Hindsight→OPC 记忆提案）、`syncBoth`；全部写审计 |
| `src/api/http.ts` | +4 operation：`GET /api/v1/memory/hindsight`、`GET .../memories`、`POST .../import`、`POST .../sync`（direction: push/pull/both） |
| 错误码 | 新增 `ERR-HINDSIGHT-001`（api.yaml errorCodes 同步） |
| 配置 | `HubConfig.hindsightUrl/hindsightBank`，环境变量 `OPC_HINDSIGHT_URL` / `OPC_HINDSIGHT_BANK`；**内网服务实测位于 `192.168.1.12:8888`**（`.25:8888` 无响应），bank 与 dsh-hindsight-memory 插件一致为 `coding-agent::workspace`（4993 节点/149894 链接/641 文档） |

### 2.2 面板

新增页签「记忆同步」（第 12 个页签）：

- 状态条：可达性、bank、记忆节点/链接/文档数、最后写入时间、OPC 卡片与待确认提案数
- 导入：粘贴 JSON 数组（`[{content, context?, tags?, timestamp?, document_id?}]`）或直接粘一段文本作单条 → 导入 Hindsight
- 同步：`推送 OPC 记忆卡 →`（敏感卡自动跳过）、`← 拉取为记忆提案`（去重）、`双向同步`
- Hindsight 记忆列表（最近 50 条，含标签/时间/状态）

## 3. 关键设计决策

| # | 决策 | 理由 | 代价/风险 |
| :--- | :--- | :--- | :--- |
| ADR-01 | 导入/推送都以 `document_id = opc-memory-<cardId>` 写入 | Hindsight 按 document_id 覆盖同一文档 → 重复同步不产生重复记忆 | 卡片内容变更会覆盖远端文档（符合"同步"语义） |
| ADR-02 | 敏感记忆卡（`sensitive=true`）永不推送 | 敏感内容受一次性令牌保护，不应外流到记忆库 | 敏感卡需在 OPC 内单独查看 |
| ADR-03 | 拉取方向生成「记忆提案（pending）」而非直接写共享记忆 | 延续 OPC「记忆必须老板确认后落库」的口径 | 多一步确认；提案带 `hindsight:<id>` 来源引用，重复拉取自动跳过 |
| ADR-04 | 桥复用 agents/bridge 的纪律（超时、错误码、可注入 fetch） | 一致的可测性与降级体验 | 服务不可达时页签显示"不可达"，其余页签不受影响 |
| ADR-05 | 不做 Hindsight 全库迁移（transfer/import 需 multipart zip） | 本次需求是"记忆导入与同步"，单条/批量 JSON 已覆盖；全库迁移属运维动作 | 大规模迁移后续可接 transfer API |

## 4. 验证证据

| 项 | 方式 | 结果 |
| :--- | :--- | :--- |
| 单元 | `node --test test/unit/hindsight.test.ts`（桩 Hindsight） | 7/7 PASS（请求形状、分页、import async 开关、错误映射、转换函数） |
| 端到端（桩） | 桩 Hindsight + 独立 API 服务（真实 PG，测试库） | status/list/import/push/pull/both 全通过；敏感卡跳过；`opc-memory-1` 幂等 document_id；二次拉取 `skipped:1` 去重 |
| 端到端（真实服务） | 直连内网 `192.168.1.12:8888` | status 可达、bank `coding-agent::workspace`、nodes=4993/links=149894/docs=641；memories/list 正常；pull(3) 生成 3 条提案后清理 |
| 渲染 | 迷你渲染器 | 「记忆同步」页签渲染通过 |
| 回归 | `npm test` | 82/82 PASS；typecheck/spec/docs 门禁绿 |

## 5. 回滚

- 代码：删除 `src/memory/`、回退 4 个 route 与 api.yaml 操作、还原面板页签；
- 无数据库迁移；回滚不涉及数据。
