/**
 * 闲鱼 RPA（Playwright 持久化上下文）：登录（扫码 QR 交给老板手机确认）、雷达搜索、上架、拉单、发货。
 *
 * 安全边界：
 * - 登录态持久化目录 OPC_SALES_PROFILE（默认 ~/opc-sales/profile），首次需老板扫码；登录态失效时生成 QR 推微信；
 * - 所有页面动作走 takeAction 额度（每日上限、急停）；
 * - 不做任何资金操作；上架/发货由 SalesService 的老板确认卡点驱动；
 * - 选择器集中在本文件顶部，闲鱼改版只改这里。
 */
import { chromium, type BrowserContext } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { OpcError, ERR } from "../../platform/errors.ts";
import type { SalesService } from "./service.ts";

type Row = Record<string, unknown>;

const PROFILE_DIR = process.env.OPC_SALES_PROFILE?.trim() || join(process.env.HOME ?? "/tmp", "opc-sales", "profile");
const QR_PATH = process.env.OPC_SALES_QR_PATH?.trim() || join(process.env.HOME ?? "/tmp", "opc-sales", "login-qr.png");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SELECTORS = {
  searchResultItem: '[class*="search-item"], [class*="item-card"], a[href*="item?id"]',
  loginQr: '[class*="qrcode"] img, img[alt*="二维码"], #qrcode-img',
  loginAvatar: '[class*="avatar"], [class*="user-info"], a[href*="space"]',
  orderRow: '[class*="order-item"], [class*="sold-item"], tr[class*="order"]',
};

export class GoofishRpa {
  private context: BrowserContext | null = null;
  private readonly sales: SalesService;

  constructor(sales: SalesService) {
    this.sales = sales;
  }

  private async launch(): Promise<BrowserContext> {
    if (this.context !== null) return this.context;
    await mkdir(PROFILE_DIR, { recursive: true });
    this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: (process.env.OPC_SALES_HEADFUL === "1") ? false : true,
      userAgent: UA,
      viewport: { width: 1380, height: 900 },
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    });
    return this.context;
  }

  async close(): Promise<void> {
    if (this.context !== null) { await this.context.close().catch(() => undefined); this.context = null; }
  }

  /** 登录态探测：能打开个人页即视为已登录；未登录时抓登录 QR 存盘供推送。 */
  async ensureLogin(): Promise<{ loggedIn: boolean; qrPath: string | null }> {
    const context = await this.launch();
    const page = await context.newPage();
    try {
      await page.goto("https://www.goofish.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(2500);
      const avatar = await page.$(SELECTORS.loginAvatar);
      if (avatar !== null) return { loggedIn: true, qrPath: null };
      // 未登录：打开登录页取二维码图片
      const qr = await page.$(SELECTORS.loginQr);
      if (qr !== null) {
        await mkdir(join(QR_PATH, ".."), { recursive: true });
        await qr.screenshot({ path: QR_PATH });
        return { loggedIn: false, qrPath: QR_PATH };
      }
      return { loggedIn: false, qrPath: null };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /** 雷达：按关键词搜索闲鱼在售同类商品，作为需求热度证据；返回线索候选。 */
  async radarSearch(keywords: string[], perKeyword = 12): Promise<Row[]> {
    const context = await this.launch();
    const page = await context.newPage();
    const items: Row[] = [];
    try {
      for (const keyword of keywords) {
        try {
          await page.goto(`https://www.goofish.com/search?q=${encodeURIComponent(keyword)}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
          await page.waitForTimeout(3500);
          const cards = await page.$$(SELECTORS.searchResultItem);
          for (const card of cards.slice(0, perKeyword)) {
            const text = (await card.evaluate((el) => el.innerText.slice(0, 300))).replace(/\s+/g, " ").trim();
            if (text.length < 8) continue;
            const priceMatch = text.match(/([0-9]+(?:\.[0-9]{1,2})?)/);
            items.push({ keyword, text: text.slice(0, 260), price: priceMatch ? Number(priceMatch[1]) : null });
          }
        } catch { /* 单关键词失败不影响整体 */ }
      }
      return items;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /** 上架商品（老板已确认 listing 状态的商品）：打开发布页填表提交。 */
  async publishProduct(product: Row): Promise<{ ok: boolean; itemId: string | null; note: string }> {
    const context = await this.launch();
    const page = await context.newPage();
    try {
      await page.goto("https://www.goofish.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
      // 闲鱼网页版发布入口能力随灰度变化：不可用时回退「人工粘贴发布」，素材已生成不阻塞
      const publishEntry = await page.$('a[href*="publish"], [class*="publish"]');
      if (publishEntry === null) {
        return { ok: false, itemId: null, note: "网页端发布入口不可用（灰度/改版）：素材已生成，请在闲鱼 App 粘贴发布（标题+详情+价格）" };
      }
      await publishEntry.click();
      await page.waitForTimeout(3000);
      const materials = (product.materials ?? {}) as Row;
      const titleInput = await page.$('input[placeholder*="标题"], input[class*="title"]');
      if (titleInput === null) return { ok: false, itemId: null, note: "发布表单结构变化，需人工发布（素材已生成）" };
      await titleInput.fill(String(materials.title ?? product.title).slice(0, 30));
      const descInput = await page.$('textarea, [contenteditable="true"]');
      if (descInput !== null) await descInput.fill(String(materials.detail ?? "").slice(0, 1000));
      const priceInput = await page.$('input[placeholder*="价格"], input[class*="price"]');
      if (priceInput !== null) await priceInput.fill(String(product.price));
      return { ok: false, itemId: null, note: "发布表单已预填但未自动提交（发布动作保留人工点击确认，避免误发）" };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /** 拉取「我卖出的」订单列表（虚拟服务待发货单）。 */
  async fetchSoldOrders(): Promise<Row[]> {
    const context = await this.launch();
    const page = await context.newPage();
    try {
      await page.goto("https://www.goofish.com/personal?tab=sold", { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(3500);
      const rows = await page.$$(SELECTORS.orderRow);
      const orders: Row[] = [];
      for (const row of rows) {
        const text = (await row.evaluate((el) => el.innerText.slice(0, 400))).replace(/\s+/g, " ").trim();
        if (text.length < 10) continue;
        const idMatch = text.match(/订单号[：: ]*([0-9]{10,20})/);
        const priceMatch = text.match(/¥\s?([0-9]+(?:\.[0-9]{1,2})?)/);
        orders.push({
          platformOrderId: idMatch?.[1] ?? `gf-${Buffer.from(text.slice(0, 40)).toString("base64url").slice(0, 20)}`,
          title: text.slice(0, 120),
          amount: priceMatch ? Number(priceMatch[1]) : null,
          demandText: text,
        });
      }
      return orders;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /** 平台侧发货（老板确认后）：定位订单点「发货」；虚拟商品发货弹窗填交付摘要。 */
  async shipOrder(platformOrderId: string, deliverableNote: string): Promise<{ ok: boolean; note: string }> {
    const context = await this.launch();
    const page = await context.newPage();
    try {
      await page.goto("https://www.goofish.com/personal?tab=sold", { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(3500);
      const target = await page.$(`text=${platformOrderId.slice(0, 16)}`);
      if (target === null) return { ok: false, note: "平台订单未在列表定位到，请人工核对" };
      const shipButton = await page.$('button:has-text("发货")');
      if (shipButton === null) return { ok: false, note: "未找到发货按钮（可能已发货或改版）" };
      await shipButton.click();
      await page.waitForTimeout(2000);
      const confirm = await page.$('button:has-text("确认发货"), button:has-text("确定")');
      if (confirm !== null) await confirm.click();
      return { ok: true, note: `已点击发货（交付摘要：${deliverableNote.slice(0, 60)}）` };
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}

/** 订单值守：拉「我卖出的」→ 入库 → 新单自动生产交付物 → 微信提醒老板确认发货。 */
export async function runSalesOrderListen(sales: SalesService, rpa: GoofishRpa, notify?: (text: string) => Promise<void>): Promise<Row> {
  const config = await sales.getConfig();
  if (config.enabled !== true) return { skipped: "disabled" };
  const runId = await sales.startRun("listen");
  try {
    const login = await rpa.ensureLogin();
    if (!login.loggedIn) {
      if (login.qrPath !== null && notify !== undefined) await notify(`虚拟销售：闲鱼登录态失效，请扫码重新登录。二维码：${login.qrPath}`);
      await sales.finishRun(runId, "failed", { reason: "not_logged_in" }, "登录态失效");
      return { runId, skipped: "not_logged_in" };
    }
    if (!(await sales.takeAction())) {
      await sales.finishRun(runId, "failed", { reason: "action_cap" }, "达到每日动作上限，已自动急停");
      return { runId, skipped: "action_cap" };
    }
    const sold = await rpa.fetchSoldOrders();
    let ingested = 0;
    let generated = 0;
    for (const item of sold) {
      const order = await sales.ingestOrder(item);
      const status = String(order.status);
      if (status === "new") {
        ingested += 1;
        try {
          await sales.generateDeliverable(Number(order.id));
          generated += 1;
          if (notify !== undefined) await notify(`虚拟销售：订单 ${order.platformOrderId} 交付物已自动生成，请到「虚拟销售」确认发货。`);
        } catch { /* 生产失败已记订单 failed，晨报兜底 */ }
      }
    }
    await sales.finishRun(runId, "ok", { sold: sold.length, ingested, generated });
    return { runId, sold: sold.length, ingested, generated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sales.finishRun(runId, "failed", {}, message.slice(0, 500));
    throw new OpcError(ERR.SALES_RPA, `订单值守失败：${message.slice(0, 200)}`, 502);
  } finally {
    await rpa.close();
  }
}

/** 上架值守：把老板确认过（listing）的商品逐个走发布流程；成功标 listed，失败回 ready 并记原因。 */
export async function runSalesListing(sales: SalesService, rpa: GoofishRpa, notify?: (text: string) => Promise<void>): Promise<Row> {
  const config = await sales.getConfig();
  if (config.enabled !== true) return { skipped: "disabled" };
  const runId = await sales.startRun("list");
  try {
    const pending = await sales.listProducts("listing", 5);
    let published = 0;
    let fallback = 0;
    for (const product of pending) {
      if (!(await sales.takeAction())) break;
      const result = await rpa.publishProduct(product);
      if (result.ok) {
        await sales.markListed(Number(product.id), result.itemId);
        published += 1;
      } else {
        await sales.markListingFallback(Number(product.id), result.note);
        fallback += 1;
        if (notify !== undefined) await notify(`虚拟销售：商品「${String(product.title).slice(0, 20)}」无法全自动上架（${result.note.slice(0, 60)}），素材已备好请人工发布。`);
      }
    }
    await sales.finishRun(runId, "ok", { pending: pending.length, published, fallback });
    return { runId, pending: pending.length, published, fallback };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sales.finishRun(runId, "failed", {}, message.slice(0, 500));
    throw new OpcError(ERR.SALES_RPA, `上架值守失败：${message.slice(0, 200)}`, 502);
  } finally {
    await rpa.close();
  }
}

/** 雷达任务编排：登录检查 → 关键词搜索 → AI 归纳线索 → 入库待老板拍板。 */
export async function runSalesRadar(sales: SalesService, rpa: GoofishRpa, notify?: (text: string) => Promise<void>): Promise<Row> {
  const config = await sales.getConfig();
  if (config.enabled !== true) return { skipped: "disabled" };
  const runId = await sales.startRun("radar");
  try {
    const login = await rpa.ensureLogin();
    if (!login.loggedIn) {
      if (login.qrPath !== null && notify !== undefined) await notify(`虚拟销售：闲鱼登录态失效，请扫码重新登录。二维码：${login.qrPath}`);
      await sales.finishRun(runId, "failed", { reason: "not_logged_in" }, login.qrPath !== null ? `登录态失效，QR 已推送：${login.qrPath}` : "登录态失效且未取到二维码");
      return { runId, skipped: "not_logged_in", qrPath: login.qrPath };
    }
    const categories = (config.categories ?? []) as string[];
    const customKeywords = (config.keywords ?? []) as string[];
    const keywords = [...new Set([...customKeywords, ...categories.flatMap((c) => SALES_KEYWORDS[c] ?? [])])];
    if (!(await sales.takeAction())) {
      await sales.finishRun(runId, "failed", { reason: "action_cap" }, "达到每日动作上限，已自动急停");
      return { runId, skipped: "action_cap" };
    }
    const evidence = await rpa.radarSearch(keywords.slice(0, 20));
    const leads = await distillLeads(sales, categories, evidence);
    const added = await sales.ingestLeads(leads, runId);
    await sales.finishRun(runId, "ok", { keywords: keywords.length, evidence: evidence.length, newLeads: added });
    if (added > 0 && notify !== undefined) await notify(`虚拟销售雷达：新发现 ${added} 条需求线索，请到「虚拟销售」页拍板转商品。`);
    return { runId, evidence: evidence.length, newLeads: added };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sales.finishRun(runId, "failed", {}, message.slice(0, 500));
    throw new OpcError(ERR.SALES_RPA, `销售雷达失败：${message.slice(0, 200)}`, 502);
  } finally {
    await rpa.close();
  }
}

const SALES_KEYWORDS: Record<string, string[]> = {
  copywriting: ["文案代写", "短视频脚本", "带货文案", "简历润色"],
  fiction: ["小说代写", "故事定制", "剧本代写"],
  planning: ["活动策划", "商业计划书", "营销方案"],
  courseware: ["学习资料整理", "笔记整理", "题库定制"],
  software: ["脚本定制", "服务器部署", "bug修复", "建站"],
};

/** 用 AI 把搜索证据归纳为可上架的服务线索（AI 不可用则按关键词模板生成）。 */
async function distillLeads(sales: SalesService, categories: string[], evidence: Row[]): Promise<Row[]> {
  const sample = evidence.slice(0, 60).map((e) => `${e.keyword}|${e.text}`).join("\n").slice(0, 6000);
  const ai = await sales.generateLeadCandidates(categories, sample);
  if (ai.length > 0) return ai;
  const byKeyword = new Map<string, number>();
  for (const e of evidence) byKeyword.set(String(e.keyword), (byKeyword.get(String(e.keyword)) ?? 0) + 1);
  return [...byKeyword.entries()].map(([keyword, count]) => ({
    category: categories.find((c) => (SALES_KEYWORDS[c] ?? []).includes(keyword)) ?? categories[0] ?? "copywriting",
    title: `${keyword}（雷达发现 ${count} 个在售同类）`,
    demandNote: `关键词「${keyword}」当日在售样本 ${count} 个，需求热度中${count >= 5 ? "高" : "等"}。`,
    source: "radar-rule",
    evidence: evidence.filter((e) => e.keyword === keyword).slice(0, 5),
    aiScore: Math.min(0.9, 0.4 + count * 0.05),
  }));
}
