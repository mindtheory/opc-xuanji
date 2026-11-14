# PA-OPC-030 微信推送（裁决/简报 → 微信）与绑定状态记录

- 变更编号：CR-2026-11-14-09
- 日期：2026-11-14
- 发起人：老板
- 变更类型：新增能力（平台·微信推送）
- 关联：`OPC-SRS-001` §8.5/§12、`OPC-DBDD-001`、`OPC-IRS-001`、`OPC-RTM-001`、`OPC-STD-001`、`OPC-STP-001`、`OPC-STR-001`、`OPC-SDD-001`、`spec/opc-xuanji/*`、`migrations/0013_wechat_push.sql`、`src/notify/wechat.ts`、`src/scheduler/tasks/index.ts`、`test/integration/wechat.test.ts`

## 1. 原始需求

检查 dsh-channel-wechat 状态，如果可用，为 opc-xuanji 增加微信 bot 绑定功能：驾驶舱需要老板裁决的内容直接推送微信、简报直接推送微信，老板可以通过微信发送信息查询和使用各项功能。

## 2. 通道检查结论

| 通道 | 状态 | 结论 |
| :--- | :--- | :--- |
| `dsh-channel-wechat`（npm v0.2.8） | **未安装**；README 明确「主动推送不在范围内」 | 不适合作推送通道；只做「微信 ↔ DSH 会话」 |
| `deepseekbot`（BotHarness，profile 已装） | 已安装运行；`messaging_bindings=0`（**未绑定任何 IM 渠道**）；默认 bot `bot-74cf6ec4…` 未注册到投递服务 | **主动投递端点在线**：`POST /api/dsh-im/delivery/messages`（探测返回 `unknown-bot`） |
| 旧微信集成配置 | `~/.dsh/integrations/dsh-weixin` 有账号 `wx_574491…` | 无运行期连接证据，不直接复用 |

**结论**：主动推送采用 BotHarness 的主动投递端点（支持微信/企微等多渠道），OPC 侧做成完整出站队列；微信 bot 绑定需老板在 GUI 里扫码一次（`设置 → IM 机器人 → 绑定微信`），绑定后填入 `OPC_WECHAT_BOT_ID` / `OPC_WECHAT_TARGET_ID` 即可推送。老板在微信里发消息即进入 DSH 会话，可直接使用全部 `opc_*` 工具（查询与操作）。

## 3. 变更内容

- `OPC-SRS-001` §8.5 新增 `REQ-OPS-004`（裁决与简报微信推送），主文档功能需求 42→43。
- 新增迁移 `migrations/0013_wechat_push.sql` 与实体 `WechatPush`（表 90→91，实体 91）。
- 新增 `src/notify/wechat.ts`（`WechatPushService`）：
  - `enqueue / enqueueDecision / enqueueBrief`：裁决与简报入队，`dedupeKey` 唯一去重；
  - `deliverPending`：经 `POST /api/dsh-im/delivery/messages`（`{botId,targetId,text}`）投递，失败按 2s→300s 退避重试 5 次，超限 `failed`；
  - `status / list / sendNow`：状态、队列与手动发一条。
- 钩子：自动驾驶 `createDecisions` / `recordDecision` 生成裁决时自动入队；`daily_report` 晨报生成时入队简报。
- 定时任务 +1：`wechat_push`（每分钟投递到期消息）；工具 +2：`opc_wechat_status`、`opc_wechat_push`（40→42）。
- 管理面 +4 operation（P98–P101，契约 110→114）、+1 错误码 `ERR-WECHAT-001`（35 个）。
- 计数同步：用例 30→31；TC 55→60；测试 122→127。
- 文档同步：`OPC-SRS-001`、`OPC-DBDD-001`（§3.15）、`OPC-IRS-001`、`OPC-RTM-001`、`OPC-STD-001`（§4.31）、`OPC-STP-001`（§18）、`OPC-STR-001`（§17）、`OPC-SDD-001`、`docs/index.md`、`pa-index`、`CHANGELOG`、`README`。

## 4. 关键边界

- **未绑定不丢**：缺 `OPC_WECHAT_BOT_ID` / `OPC_WECHAT_TARGET_ID` 时只入队（pending），10 分钟后重试；不阻塞裁决与晨报。
- **不刷屏**：同 `dedupeKey` 只入队一次；单轮投递上限 20 条。
- **可追溯**：每次投递结果（成功/失败、错误码、attempts）落库并写审计；正文入队前脱敏。
- **不直连微信协议**：复用 dsh-im 投递端点，不实现微信协议、不落 token；老板微信会话由 BotHarness 负责。

## 5. 落地进度

- 迁移：业务库与测试库均已应用 `0013_wechat_push.sql`。
- 契约：`npm run spec:check` PASS（91 实体 / 31 用例 / 21 模块；114 operation / 35 errorCodes）。
- 测试：`wechat.test.ts` 5/5 pass（投递端点本地 mock）；全量 `npm test` 全绿（见 `OPC-STR-001` §17）。
- 状态探测：`/api/dsh-im/delivery/messages` 在线；默认 bot 未注册（`unknown-bot`），需 GUI 绑定微信。
- 部署：`dsh-web` 重启后生效。

## 6. 绑定与启用步骤（一次性）

1. DSH GUI → 设置 → IM 机器人 → 绑定微信（扫码登录）；
2. 记录 botId / targetId（或从机器人页复制调用参数）；
3. 在部署机 `.env` 写入：
   ```bash
   OPC_WECHAT_BOT_ID=<botId>
   OPC_WECHAT_TARGET_ID=<targetId>
   # OPC_WECHAT_DELIVERY_URL=http://127.0.0.1:3081/api/dsh-im/delivery/messages
   ```
4. 重启 `dsh-web`；`GET /api/v1/admin/wechat/status` 应显示 `botIdConfigured=true`、`targetIdConfigured=true`。

## 7. 回滚

- 代码：`git reset --hard <上一提交>` 后重启。
- 数据：`0013` 只新增 1 张队列表；回滚代码无需删表（删表会丢未发消息）。
- 配置：移除 `OPC_WECHAT_*` 即停止投递，队列保留。
