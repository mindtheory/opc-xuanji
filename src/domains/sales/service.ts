/**
 * 虚拟销售中枢（v2.27）：AI 雷达发现闲鱼虚拟服务需求 → 生成上架素材 → 老板确认 → RPA 上架/接单 →
 * AI 自动生产交付物 → 老板确认发货 → 平台担保收款记账。收款环节永远走平台，系统只记账。
 *
 * 风控护栏（老板拍板全自动化，但账号安全优先）：
 * - 全局急停 sales.config.enabled=false 时所有任务空转；
 * - 每日动作上限 daily_action_cap（浏览/上架/发货合计），超限自动暂停并微信告警；
 * - 所有上架/发货必须老板确认卡点（confirm 接口），RPA 不做资金操作；
 * - 全部写审计（sales.* 动作）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "../../db/pool.ts";
import { OpcError, ERR } from "../../platform/errors.ts";
import type { AuditService } from "../../audit/audit.ts";

type Row = Record<string, unknown>;

export const SALES_CATEGORIES: Record<string, { label: string; keywords: string[]; priceRange: [number, number]; delivery: string }> = {
  copywriting: { label: "文案代写", keywords: ["文案代写", "短视频脚本", "朋友圈文案", "带货文案", "简历润色"], priceRange: [10, 200], delivery: "按需求产出文案正文（多版本），txt/md 交付" },
  fiction: { label: "小说/故事代写", keywords: ["小说代写", "故事定制", "同人文", "剧本", "有声书稿"], priceRange: [30, 800], delivery: "大纲+正文（按字数计），md/docx 交付" },
  planning: { label: "策划方案", keywords: ["活动策划", "商业计划书", "营销方案", "路演PPT", "品牌策划"], priceRange: [50, 1500], delivery: "结构化方案文档（背景/目标/打法/预算/排期），md/docx 交付" },
  courseware: { label: "课程与学习资料", keywords: ["学习资料整理", "考研笔记", "题库", "课程讲义", "知识梳理"], priceRange: [10, 300], delivery: "原创整理笔记/题库（不倒卖他人版权资料），md/pdf 交付" },
  software: { label: "软件与服务器部署", keywords: ["脚本定制", "爬虫代写", "服务器部署", "建站", "bug修复", "远程运维"], priceRange: [50, 2000], delivery: "源码+部署说明；服务器操作需买家提供环境并另行确认" },
};

const LEAD_STATUS = ["new", "promoted", "rejected"] as const;
const PRODUCT_STATUS = ["draft", "ready", "listing", "listed", "paused"] as const;
const ORDER_STATUS = ["new", "generating", "generated", "shipping", "shipped", "settled", "failed"] as const;

export class SalesService {
  private readonly pool: Pool;
  private readonly audit: AuditService;
  private readonly opts: { deliverableRoot: string };

  constructor(pool: Pool, audit: AuditService, opts?: { deliverableRoot: string }) {
    this.pool = pool;
    this.audit = audit;
    this.opts = opts ?? { deliverableRoot: join(process.env.OPC_SALES_ROOT?.trim() || join(process.env.HOME ?? "/tmp", "opc-sales")) };
  }

  // ---------- 配置 ----------

  async getConfig(): Promise<Row> {
    const current = await this.pool.query<Row>("SELECT * FROM sales.config ORDER BY id LIMIT 1");
    if (current.rows.length > 0) return this.normalizeConfig(current.rows[0]);
    const dayRoll = await this.pool.query(
      `UPDATE sales.config SET actions_today = 0, action_day = current_date WHERE action_day < current_date RETURNING *`,
    );
    if (dayRoll.rows.length > 0) return this.normalizeConfig(dayRoll.rows[0]);
    const inserted = await this.pool.query("INSERT INTO sales.config DEFAULT VALUES RETURNING *");
    return this.normalizeConfig(inserted.rows[0] as Row);
  }

  private normalizeConfig(row: Row): Row {
    return {
      enabled: row.enabled === true,
      categories: row.categories,
      keywords: row.keywords,
      priceFloor: Number(row.price_floor),
      priceCap: Number(row.price_cap),
      dailyActionCap: Number(row.daily_action_cap),
      actionsToday: Number(row.actions_today),
      pauseReason: row.pause_reason,
    };
  }

  async updateConfig(input: Row): Promise<Row> {
    const current = await this.getConfig();
    const next = {
      enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled === true,
      categories: Array.isArray(input.categories) ? input.categories.map(String).filter((c) => c in SALES_CATEGORIES) : (current.categories as string[]),
      keywords: Array.isArray(input.keywords) ? input.keywords.map((k) => String(k).slice(0, 40)).slice(0, 60) : (current.keywords as string[]),
      priceFloor: Number(input.priceFloor !== undefined ? Number(input.priceFloor) : current.priceFloor),
      priceCap: Number(input.priceCap !== undefined ? Number(input.priceCap) : current.priceCap),
      dailyActionCap: Number(input.dailyActionCap !== undefined ? Number(input.dailyActionCap) : current.dailyActionCap),
      pauseReason: input.pauseReason === undefined ? current.pauseReason : String(input.pauseReason).slice(0, 200),
    };
    if (!(next.priceFloor > 0 && next.priceCap >= next.priceFloor)) throw new OpcError(ERR.SALES_INVALID, "价格区间非法：需 0 < 下限 ≤ 上限", 400);
    if (next.categories.length === 0) throw new OpcError(ERR.SALES_INVALID, "至少保留一个品类", 400);
    await this.pool.query(
      `UPDATE sales.config SET enabled=$1, categories=$2::jsonb, keywords=$3::jsonb, price_floor=$4, price_cap=$5,
         daily_action_cap=$6, pause_reason=$7, updated_at=now() WHERE id=(SELECT min(id) FROM sales.config)`,
      [next.enabled, JSON.stringify(next.categories), JSON.stringify(next.keywords), next.priceFloor, next.priceCap, next.dailyActionCap, next.pauseReason],
    );
    await this.audit.record({ actor: "boss", action: "sales.config.update", result: "ok", objectType: "SalesConfig", objectId: "1", payload: { enabled: next.enabled, categories: next.categories.length, dailyActionCap: next.dailyActionCap } });
    return this.getConfig();
  }

  /** 风控护栏：占用一次当日动作额度；超限自动急停并返回 false。RPA 每次平台动作前调用。 */
  async takeAction(): Promise<boolean> {
    const config = await this.getConfig();
    if (config.enabled !== true) return false;
    if (Number(config.actionsToday) >= Number(config.dailyActionCap)) {
      await this.pool.query("UPDATE sales.config SET enabled=false, pause_reason='达到每日动作上限，自动急停（次日可手动恢复）', updated_at=now() WHERE id=(SELECT min(id) FROM sales.config)");
      return false;
    }
    await this.pool.query("UPDATE sales.config SET actions_today = actions_today + 1, updated_at = now() WHERE id=(SELECT min(id) FROM sales.config)");
    return true;
  }

  // ---------- 线索（雷达产物） ----------

  async listLeads(status: string | null, limit = 50): Promise<Row[]> {
    const filtered = status !== null && (LEAD_STATUS as readonly string[]).includes(status);
    const rows = await this.pool.query<Row>(
      `SELECT * FROM sales.lead ${filtered ? "WHERE status = $1" : ""} ORDER BY ai_score DESC NULLS LAST, id DESC LIMIT $${filtered ? "2" : "1"}`,
      filtered ? [status, limit] : [limit],
    );
    return rows.rows.map((r) => ({
      id: r.id, category: r.category, categoryLabel: SALES_CATEGORIES[String(r.category)]?.label ?? r.category,
      title: r.title, demandNote: r.demand_note, source: r.source, evidence: r.evidence,
      aiScore: r.ai_score === null ? null : Number(r.ai_score), status: r.status, productId: r.product_id, createdAt: r.created_at,
    }));
  }

  /** 雷达写入线索（按标题去重）；返回新增条数。 */
  async ingestLeads(items: Row[], runId: number | null): Promise<number> {
    let added = 0;
    for (const item of items) {
      const category = String(item.category ?? "");
      const title = String(item.title ?? "").trim().slice(0, 200);
      if (!(category in SALES_CATEGORIES) || title === "") continue;
      const dup = await this.pool.query("SELECT 1 FROM sales.lead WHERE title = $1 LIMIT 1", [title]);
      if (dup.rows.length > 0) continue;
      await this.pool.query(
        `INSERT INTO sales.lead (category, title, demand_note, source, evidence, ai_score, run_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
        [category, title, String(item.demandNote ?? "").slice(0, 2000), String(item.source ?? "keyword").slice(0, 32),
         JSON.stringify(item.evidence ?? []), item.aiScore === undefined ? null : Math.max(0, Math.min(1, Number(item.aiScore))), runId],
      );
      added += 1;
    }
    return added;
  }

  /** 老板拍板：线索 → 商品（AI 生成素材）或淘汰。 */
  async decideLead(leadId: number, action: "promote" | "reject", price: number | null, decidedBy: string): Promise<Row> {
    const lead = await this.pool.query<Row>("SELECT * FROM sales.lead WHERE id = $1", [leadId]);
    if (lead.rows.length === 0) throw new OpcError(ERR.SALES_INVALID, `线索 ${leadId} 不存在`, 404);
    if (lead.rows[0].status !== "new") throw new OpcError(ERR.SALES_INVALID, "该线索已处理", 409);
    if (action === "reject") {
      await this.pool.query("UPDATE sales.lead SET status='rejected', decided_by=$2, decided_at=now() WHERE id=$1", [leadId, decidedBy]);
      await this.audit.record({ actor: decidedBy, action: "sales.lead.reject", result: "ok", objectType: "SalesLead", objectId: String(leadId), payload: {} });
      return { id: leadId, status: "rejected" };
    }
    const category = String(lead.rows[0].category);
    const meta = SALES_CATEGORIES[category];
    const resolvedPrice = price ?? Math.round((meta.priceRange[0] + meta.priceRange[1]) / 2);
    const materials = await this.generateListing(lead.rows[0].title as string, category, resolvedPrice);
    const product = await this.pool.query(
      `INSERT INTO sales.product (lead_id, category, title, price, materials, delivery_spec, status)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,'ready') RETURNING *`,
      [leadId, category, lead.rows[0].title, resolvedPrice, JSON.stringify(materials), meta.delivery],
    );
    await this.pool.query("UPDATE sales.lead SET status='promoted', product_id=$2, decided_by=$3, decided_at=now() WHERE id=$1", [leadId, product.rows[0].id, decidedBy]);
    await this.audit.record({ actor: decidedBy, action: "sales.lead.promote", result: "ok", objectType: "SalesLead", objectId: String(leadId), payload: { productId: product.rows[0].id, price: resolvedPrice } });
    return this.getProduct(Number(product.rows[0].id));
  }

  // ---------- 商品 ----------

  async listProducts(status: string | null, limit = 50): Promise<Row[]> {
    const where = status && (PRODUCT_STATUS as readonly string[]).includes(status) ? "WHERE status = $2" : "";
    const params: unknown[] = [limit];
    if (where !== "") params.push(status);
    const rows = await this.pool.query<Row>(`SELECT * FROM sales.product ${where} ORDER BY id DESC LIMIT $1`, params);
    return rows.rows.map((r) => this.mapProduct(r));
  }

  async getProduct(id: number): Promise<Row> {
    const rows = await this.pool.query<Row>("SELECT * FROM sales.product WHERE id = $1", [id]);
    if (rows.rows.length === 0) throw new OpcError(ERR.SALES_INVALID, `商品 ${id} 不存在`, 404);
    return this.mapProduct(rows.rows[0]);
  }

  private mapProduct(r: Row): Row {
    return {
      id: r.id, leadId: r.lead_id, category: r.category, categoryLabel: SALES_CATEGORIES[String(r.category)]?.label ?? r.category,
      title: r.title, price: Number(r.price), materials: r.materials, deliverySpec: r.delivery_spec,
      status: r.status, platformItemId: r.platform_item_id, listedAt: r.listed_at, pausedReason: r.paused_reason, createdAt: r.created_at,
    };
  }

  /** 老板确认上架：标记 listing，实际平台动作由 RPA 值守执行。 */
  async confirmListing(productId: number, decidedBy: string): Promise<Row> {
    const product = await this.getProduct(productId);
    if (product.status !== "ready") throw new OpcError(ERR.SALES_INVALID, "仅素材就绪（ready）的商品可确认上架", 409);
    await this.pool.query("UPDATE sales.product SET status='listing', updated_at=now() WHERE id=$1", [productId]);
    await this.audit.record({ actor: decidedBy, action: "sales.product.confirm-listing", result: "ok", objectType: "SalesProduct", objectId: String(productId), payload: {} });
    return this.getProduct(productId);
  }

  async pauseProduct(productId: number, reason: string, decidedBy: string): Promise<Row> {
    await this.getProduct(productId);
    await this.pool.query("UPDATE sales.product SET status='paused', paused_reason=$2, updated_at=now() WHERE id=$1", [productId, reason.slice(0, 200)]);
    await this.audit.record({ actor: decidedBy, action: "sales.product.pause", result: "ok", objectType: "SalesProduct", objectId: String(productId), payload: { reason } });
    return this.getProduct(productId);
  }

  /** RPA 上架成功回写。 */
  async markListed(productId: number, platformItemId: string | null): Promise<Row> {
    await this.pool.query("UPDATE sales.product SET status='listed', platform_item_id=$2, listed_at=now(), updated_at=now() WHERE id=$1", [productId, platformItemId]);
    return this.getProduct(productId);
  }

  /** RPA 无法全自动上架：回 ready 并记原因（素材已备好，人工发布后页面上再点「已上架」）。 */
  async markListingFallback(productId: number, note: string): Promise<Row> {
    await this.pool.query("UPDATE sales.product SET status='ready', paused_reason=$2, updated_at=now() WHERE id=$1", [productId, note.slice(0, 200)]);
    return this.getProduct(productId);
  }

  /** 人工发布完成回写（网页端发布入口不可用时的兜底闭环）；必须先走确认上架。 */
  async markListedManual(productId: number, decidedBy: string): Promise<Row> {
    const product = await this.getProduct(productId);
    if (product.status !== "listing") throw new OpcError(ERR.SALES_INVALID, `仅已确认上架（listing）的商品可标记已上架（当前 ${product.status}）`, 409);
    await this.pool.query("UPDATE sales.product SET status='listed', listed_at=now(), paused_reason=NULL, updated_at=now() WHERE id=$1", [productId]);
    await this.audit.record({ actor: decidedBy, action: "sales.product.manual-listed", result: "ok", objectType: "SalesProduct", objectId: String(productId), payload: {} });
    return this.getProduct(productId);
  }

  // ---------- 订单 ----------

  async listOrders(status: string | null, limit = 50): Promise<Row[]> {
    const where = status && (ORDER_STATUS as readonly string[]).includes(status) ? "WHERE status = $2" : "";
    const params: unknown[] = [limit];
    if (where !== "") params.push(status);
    const rows = await this.pool.query<Row>(`SELECT * FROM sales.order ${where} ORDER BY id DESC LIMIT $1`, params);
    return rows.rows.map((r) => ({
      id: r.id, productId: r.product_id, platformOrderId: r.platform_order_id, buyerNick: r.buyer_nick,
      title: r.title, demandText: r.demand_text, amount: r.amount === null ? null : Number(r.amount),
      status: r.status, deliverablePath: r.deliverable_path, deliverableNote: r.deliverable_note,
      error: r.error, shippedAt: r.shipped_at, settledAt: r.settled_at, createdAt: r.created_at,
    }));
  }

  /** RPA 拉单入库（按平台订单号幂等）。 */
  async ingestOrder(input: Row): Promise<Row> {
    const platformOrderId = String(input.platformOrderId ?? "").trim();
    if (platformOrderId === "") throw new OpcError(ERR.SALES_INVALID, "缺少平台订单号", 400);
    const existing = await this.pool.query<Row>("SELECT * FROM sales.order WHERE platform_order_id = $1", [platformOrderId]);
    if (existing.rows.length > 0) return this.mapOrder(existing.rows[0]);
    const inserted = await this.pool.query(
      `INSERT INTO sales.order (product_id, platform_order_id, buyer_nick, title, demand_text, amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,'new') RETURNING *`,
      [input.productId ?? null, platformOrderId.slice(0, 64), String(input.buyerNick ?? "").slice(0, 128),
       String(input.title ?? "").slice(0, 200), String(input.demandText ?? "").slice(0, 4000),
       input.amount === undefined || input.amount === null ? null : Number(input.amount)],
    );
    await this.audit.record({ actor: "sales-rpa", action: "sales.order.ingest", result: "ok", objectType: "SalesOrder", objectId: String(inserted.rows[0].id), payload: { platformOrderId } });
    return this.mapOrder(inserted.rows[0] as Row);
  }

  private mapOrder(r: Row): Row {
    return { id: r.id, platformOrderId: r.platform_order_id, status: r.status, deliverablePath: r.deliverable_path };
  }

  /** 自动生产交付物：AI 按品类规格生成，落盘 OPC_SALES_ROOT/orders/<id>/。 */
  async generateDeliverable(orderId: number): Promise<Row> {
    const rows = await this.pool.query<Row>("SELECT * FROM sales.order WHERE id = $1", [orderId]);
    if (rows.rows.length === 0) throw new OpcError(ERR.SALES_INVALID, `订单 ${orderId} 不存在`, 404);
    const order = rows.rows[0];
    if (order.status !== "new" && order.status !== "failed") throw new OpcError(ERR.SALES_INVALID, `订单状态 ${order.status} 不可生产`, 409);
    await this.pool.query("UPDATE sales.order SET status='generating', updated_at=now() WHERE id=$1", [orderId]);
    try {
      let category = "copywriting";
      if (order.product_id !== null) {
        const product = await this.pool.query<Row>("SELECT category FROM sales.product WHERE id=$1", [order.product_id]);
        if (product.rows.length > 0) category = String(product.rows[0].category);
      }
      const content = await this.generateDelivery(category, String(order.demand_text ?? order.title ?? ""));
      const dir = join(this.opts.deliverableRoot, "orders", String(orderId));
      await mkdir(dir, { recursive: true });
      const file = join(dir, "交付说明.md");
      await writeFile(file, content, "utf8");
      await this.pool.query("UPDATE sales.order SET status='generated', deliverable_path=$2, deliverable_note=$3, updated_at=now() WHERE id=$1", [orderId, file, content.slice(0, 400)]);
      await this.audit.record({ actor: "sales-agent", action: "sales.order.generate", result: "ok", objectType: "SalesOrder", objectId: String(orderId), payload: { category, file } });
      return { id: orderId, status: "generated", deliverablePath: file };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.pool.query("UPDATE sales.order SET status='failed', error=$2, updated_at=now() WHERE id=$1", [orderId, message.slice(0, 500)]);
      throw error;
    }
  }

  /** 老板确认发货：标记 shipped，RPA 值守在平台点发货；收款由平台担保交易完成。 */
  async confirmShip(orderId: number, decidedBy: string): Promise<Row> {
    const rows = await this.pool.query<Row>("SELECT * FROM sales.order WHERE id = $1", [orderId]);
    if (rows.rows.length === 0) throw new OpcError(ERR.SALES_INVALID, `订单 ${orderId} 不存在`, 404);
    if (rows.rows[0].status !== "generated") throw new OpcError(ERR.SALES_INVALID, "交付物未生成，不能发货", 409);
    await this.pool.query("UPDATE sales.order SET status='shipping', shipped_at=now(), updated_at=now() WHERE id=$1", [orderId]);
    await this.audit.record({ actor: decidedBy, action: "sales.order.confirm-ship", result: "ok", objectType: "SalesOrder", objectId: String(orderId), payload: {} });
    return { id: orderId, status: "shipping" };
  }

  /** RPA 确认平台已发货/已收款：记账。 */
  async markSettled(orderId: number, settled: boolean): Promise<Row> {
    await this.pool.query(
      settled
        ? "UPDATE sales.order SET status='settled', settled_at=now(), updated_at=now() WHERE id=$1"
        : "UPDATE sales.order SET status='shipped', updated_at=now() WHERE id=$1",
      [orderId],
    );
    return { id: orderId, status: settled ? "settled" : "shipped" };
  }

  // ---------- 运行记录 ----------

  async startRun(kind: string): Promise<number> {
    const rows = await this.pool.query("INSERT INTO sales.run (kind) VALUES ($1) RETURNING id", [kind]);
    return Number((rows.rows[0] as Row).id);
  }

  async finishRun(runId: number, status: string, summary: Row, error?: string): Promise<void> {
    await this.pool.query("UPDATE sales.run SET status=$2, summary=$3::jsonb, error=$4, ended_at=now() WHERE id=$1", [runId, status, JSON.stringify(summary), error ?? null]);
  }

  async listRuns(limit = 20): Promise<Row[]> {
    const rows = await this.pool.query<Row>("SELECT * FROM sales.run ORDER BY id DESC LIMIT $1", [limit]);
    return rows.rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, summary: r.summary, error: r.error, startedAt: r.started_at, endedAt: r.ended_at }));
  }

  // ---------- AI 生成 ----------

  private aiConfig(): { apiKey: string; baseUrl: string; model: string } | null {
    if (process.env.OPC_AI_DISABLED === "1") return null;
    const apiKey = process.env.OPC_AI_API_KEY ?? process.env.DEEPSEEK_API_KEY;
    if (apiKey === undefined || apiKey.trim() === "") return null;
    return { apiKey, baseUrl: (process.env.OPC_AI_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, ""), model: process.env.OPC_AI_MODEL ?? "deepseek-chat" };
  }

  private async aiChat(system: string, user: string, maxTokens = 1600): Promise<string | null> {
    const config = this.aiConfig();
    if (config === null) return null;
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, temperature: 0.6, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? null;
    } catch {
      return null;
    }
  }

  /** 把雷达搜索证据归纳为可上架服务线索（AI 归纳；失败返回空数组由调用方走规则兜底）。 */
  async generateLeadCandidates(categories: string[], evidenceSample: string): Promise<Row[]> {
    if (evidenceSample.trim() === "") return [];
    const labels = categories.map((c) => `${c}=${SALES_CATEGORIES[c]?.label ?? c}`).join(", ");
    const ai = await this.aiChat(
      "你是虚拟电商选品分析师。从闲鱼在售样本归纳可上架的虚拟服务线索，只输出 JSON 数组（不要 markdown）。",
      `可选品类（category 取冒号前英文码）：${labels}\n样本（每行「关键词|商品文本」）：\n${evidenceSample}\n字段：[{"category":"品类码","title":"服务线索标题(≤60字)","demandNote":"需求判断依据(≤200字)","aiScore":0到1小数}]，最多 8 条，只归纳确有需求的品类，不臆造。`,
      1200,
    );
    if (ai === null) return [];
    try {
      const start = ai.indexOf("[");
      const end = ai.lastIndexOf("]");
      const parsed = JSON.parse(ai.slice(start, end + 1)) as Row[];
      return parsed
        .filter((item) => typeof item.title === "string" && String(item.title).trim() !== "")
        .slice(0, 8)
        .map((item) => ({
          category: String(item.category ?? ""),
          title: String(item.title).slice(0, 200),
          demandNote: String(item.demandNote ?? "").slice(0, 500),
          source: "radar-ai",
          evidence: [],
          aiScore: item.aiScore === undefined ? 0.5 : Math.max(0, Math.min(1, Number(item.aiScore))),
        }));
    } catch {
      return [];
    }
  }

  /** 上架素材：标题/卖点/详情/定价话术；AI 不可用时给规则兜底模板。 */
  async generateListing(title: string, category: string, price: number): Promise<Row> {
    const meta = SALES_CATEGORIES[category] ?? SALES_CATEGORIES.copywriting;
    const ai = await this.aiChat(
      "你是闲鱼虚拟服务运营专家。为给定服务生成上架素材，只输出 JSON（不要 markdown 代码块）。",
      `服务：${title}\n品类：${meta.label}\n建议价：${price}元\n交付方式：${meta.delivery}\n字段：{"title":"闲鱼标题(≤30字,带场景词)","sellingPoints":["卖点1","卖点2","卖点3"],"detail":"详情正文(≤600字,含服务范围/流程/时效/须知,不承诺平台违禁词)","tags":["标签1","标签2","标签3"]}`,
    );
    if (ai !== null) {
      try {
        const start = ai.indexOf("{");
        const end = ai.lastIndexOf("}");
        const parsed = JSON.parse(ai.slice(start, end + 1)) as Row;
        return {
          title: String(parsed.title ?? title).slice(0, 60),
          sellingPoints: Array.isArray(parsed.sellingPoints) ? parsed.sellingPoints.map((s) => String(s).slice(0, 80)).slice(0, 6) : [meta.label, "当天出稿", "不满意可改"],
          detail: String(parsed.detail ?? "").slice(0, 1200),
          tags: Array.isArray(parsed.tags) ? parsed.tags.map((s) => String(s).slice(0, 20)).slice(0, 8) : [meta.label],
          price,
          source: "ai",
        };
      } catch { /* 落兜底 */ }
    }
    return {
      title: title.slice(0, 60),
      sellingPoints: [meta.label, "在线沟通当天开工", "交付前不限次数修改"],
      detail: `【服务范围】${meta.label}\n【交付方式】${meta.delivery}\n【流程】拍下→沟通需求→开工→初稿交付→按反馈修改→确认收货\n【须知】虚拟商品，发货后不支持无理由退款；具体需求请先私聊确认。`,
      tags: [meta.label],
      price,
      source: "rule",
    };
  }

  /** 交付物正文：按品类规格生成完整可交付文档。 */
  async generateDelivery(category: string, demand: string): Promise<string> {
    const meta = SALES_CATEGORIES[category] ?? SALES_CATEGORIES.copywriting;
    const ai = await this.aiChat(
      "你是按买家需求交付虚拟服务的专业写手。直接输出交付文档 Markdown（不要解释、不要代码块包裹）。",
      `品类：${meta.label}\n交付规格：${meta.delivery}\n买家需求：${demand.slice(0, 3000)}\n要求：内容完整可直接交付；结构清晰；中文；结尾附「修改说明」小节（说明如何提修改意见）。`,
      3000,
    );
    if (ai !== null && ai.trim().length > 80) return ai.trim();
    return `# ${meta.label} 交付单\n\n## 买家需求\n${demand || "（未填写，请私聊补充）"}\n\n## 交付内容\n（AI 暂不可用，本单需人工生产后交付）\n\n## 修改说明\n收到本交付物后如有修改意见，请私聊发送具体修改点，48 小时内免费修改。`;
  }
}
