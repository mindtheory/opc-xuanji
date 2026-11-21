# PA-OPC-036 虚拟销售自动经营（闲鱼虚拟服务：雷达→上架→接单→交付→收款记账）

- 变更编号：CR-2026-11-21-15
- 日期：2026-11-21
- 发起人：老板
- 变更类型：新增能力（新业务域 sales：虚拟商品线上交付）
- 关联：`OPC-SRS-001` §12.3（REQ-SALES-001）、`OPC-IRS-001` §7.6（P107–P119）、`OPC-DBDD-001` §2.3/§5（0018）、`OPC-RTM-001`、`OPC-STD-001` §4.37、`spec/opc-xuanji/usecases.yaml`（UC-034）、`migrations/0018_sales.sql`、`src/domains/sales/service.ts`、`src/domains/sales/rpa.ts`、`src/scheduler/tasks/index.ts`、`src/api/http.ts`、`client.js`、`test/integration/sales.test.ts`

## 1. 原始需求

老板要求：**新增虚拟销售功能：自动检索闲鱼、淘宝、小红书等网站，寻找可以虚拟交付的虚拟产品（文案、小说、策划、课程、学习资料、软件、服务器部署维护等网上可交付的工作），自动接单、自动交付、自动收款，做成自动任务每天循环做。**

老板拍板：平台模式选**全自动化（RPA 模拟真人）**（放弃半自动推荐项）；品类全选（文案代写/小说故事/策划方案/课程与学习资料/软件与服务器部署）；上架渠道先做**闲鱼**。

已知约束（老板知悉）：闲鱼/淘宝/小红书无开放 API，RPA 违反平台规则存在封号风险（须专用账号+限速+急停）；收款无法脱离平台担保自动化（系统只记账）；离线生产（发现/素材/交付物）可全自动。

## 2. 变更内容

- 迁移 `0018_sales.sql`：新增 `sales` schema 与 5 表（92→97）——`sales.config`（单行：开关/品类/关键词/价格区间/每日动作上限/今日动作/急停原因）、`sales.lead`（雷达线索：品类/标题/需求注记/证据/AI 评分/状态机 new→promoted|rejected）、`sales.product`（商品：素材 jsonb/交付规格/状态机 draft→ready→listing→listed|paused）、`sales.order`（订单：平台订单号幂等/买家/金额/交付物路径/状态机 new→generating→generated→shipping→shipped→settled|failed）、`sales.run`（radar/list/listen 运行留痕）。
- `SalesService`（`domains/sales/service.ts`）：品类目录 `SALES_CATEGORIES`（关键词/价格区间/交付规格）；配置读写与风控额度 `takeAction()`（超限自动急停）；线索去重入库与拍板 `decideLead`（promote 即 AI 生成素材建 ready 商品）；商品确认上架/人工发布回写/暂停；订单幂等入库、`generateDeliverable`（AI 按品类规格生成交付文档落盘 `OPC_SALES_ROOT/orders/<id>/交付说明.md`，AI 不可用落人工生产兜底）、确认发货、收款记账；AI 走 idea.ts 同款配置（`OPC_AI_*` env），全部有规则兜底。
- `GoofishRpa`（`domains/sales/rpa.ts`）：Playwright 1.65 持久化上下文（`OPC_SALES_PROFILE`，默认 `~/opc-sales/profile`）；`ensureLogin` 登录态探测 + 失效抓 QR 存盘（推微信给老板扫码）；`radarSearch` 关键词搜索在售样本；`publishProduct` 发布预填（网页端发布入口受灰度限制时回退「素材备好人工发布」，不自动提交发布按钮）；`fetchSoldOrders` 拉「我卖出的」；`shipOrder` 平台侧点发货。选择器集中在文件顶部，改版只改一处。编排函数 `runSalesRadar/runSalesOrderListen/runSalesListing`：登录检查→额度→执行→run 留痕→微信通知老板拍板。
- 调度任务（默认**停用**，待老板扫码登录后启用）：`sales_radar`（每日 09:30 发现线索）、`sales_orders`（每 30 分钟拉单+自动生产交付物）、`sales_listing`（每 2 小时执行已确认上架单）。
- HTTP 13 端点（P107–P119）：config GET/PUT、leads GET、leads/{id}/decide、products GET、products/{id}/confirm-listing|manual-listed|pause、orders GET、orders/{id}/generate|confirm-ship、runs GET、radar/run POST；错误码新增 `ERR-SALES-001`（参数/状态非法）、`ERR-SALES-002`（RPA 执行失败）。
- 管理面「虚拟销售」页签（左栏「经营」组）：配置卡（总开关急停/今日额度/价格区间/立即跑雷达）+ 线索拍板 + 商品上架确认 + 订单生产/发货 + 运行记录四段。
- 测试：`sales.test.ts` 5 例（TC-SALES-001..005：风控急停/线索去重拍板/商品状态机/订单闭环/HTTP 契约）；全量 146→151；`test/helpers.ts` resetDb 增 sales 5 表。

## 3. 关键边界

- **不做资金操作**：收款永远走闲鱼平台担保交易；系统只在平台确认收款后记账 `settled`。
- **老板确认卡点**：上架（confirm-listing）与发货（confirm-ship）必须老板在页面/微信确认，RPA 不越过卡点自动发布、自动提交。
- **风控护栏**：`sales.config.enabled` 全局急停（默认 false）；`daily_action_cap` 当日动作上限，超限自动急停并微信告警；RPA 动作限速、单关键词失败不拖垮整轮；建议专用闲鱼账号小流量试运行。
- **AI 兜底**：素材与交付物生成在 AI 不可用（`OPC_AI_DISABLED`/无 key/超时）时落规则模板，交付物兜底标注「需人工生产」，不假装已交付。
- **审计**：配置更新、线索拍板、上架确认、发货确认、订单入库/生产全部写 `sales.*` 审计。

## 4. 遗留与后续

- 闲鱼登录需老板用**专用账号**扫码一次（登录态持久化在 `OPC_SALES_PROFILE`）；失效时 QR 图推微信。
- 网页端发布入口受闲鱼灰度控制，不可用时走「人工粘贴发布 + 页面点已上架」兜底闭环。
- 淘宝/小红书渠道未接（同构可扩：新增 rpa 适配器 + 品类渠道字段）。
- 自动客服回聊（买家私聊答疑）未做，列入后续。
