/**
 * 情况采集器（公司情报中心的互联网采集适配器）。
 *
 * 老板口径（2026-11-21）：情报与项目无关，是公司对外的开放系统；建「情况采集」，
 * 从互联网与官方数据源（市监总局工商/统计局数据/工信部政策等）采集相关数据，汇总入公司记忆。
 *
 * 设计：
 * - 每个来源在 biz.source.checkpoint.kind 里声明解析器（gov_policy/stats_news/samr_news/rss/web/json），
 *   未声明的按 URL 域名自动匹配官方源，匹配不上走通用 web 列表页解析。
 * - 只抓公开列表页/公开 JSON 索引，标题+链接+日期入库；不伪造条目，抓不到就记失败。
 * - 单来源失败不影响其它来源；全部走超时与条数上限，尊重 rate limit（由调度间隔保证）。
 */

export interface CollectedItem {
  externalId?: string;
  url: string;
  title: string;
  summary?: string;
  publishedAt?: string;
}

export interface SourceSpec {
  id: number;
  name: string;
  url: string;
  /** biz.source.checkpoint.kind；缺省按 URL 自动识别 */
  kind: string;
  maxItems: number;
  /** checkpoint 里已见过的链接（增量：只回新链接） */
  seen: string[];
}

export interface CollectOutcome {
  kind: string;
  items: CollectedItem[];
  /** 本次新增链接（写回 checkpoint.seen） */
  fresh: string[];
  httpStatus: number | null;
  error?: string;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function detectKind(url: string): string {
  if (url.includes("gov.cn/zhengce")) return "gov_policy";
  if (url.includes("stats.gov.cn")) return "stats_news";
  if (url.includes("samr.gov.cn")) return "samr_news";
  if (url.includes("miit.gov.cn")) return "web_list";
  if (/\.json($|\?)/i.test(url)) return "json_list";
  if (/(rss|\.xml|feed)/i.test(url)) return "rss";
  return "web_list";
}

async function fetchText(url: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  const response = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "accept-language": "zh-CN,zh;q=0.9" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  const buf = await response.arrayBuffer();
  // 官方站多为 UTF-8；少数老页面 GBK，简单探测 meta
  let body = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (/charset=gb/i.test(body.slice(0, 2048))) {
    try { body = new TextDecoder("gb18030", { fatal: false }).decode(buf); } catch { /* 保留 utf-8 结果 */ }
  }
  return { status: response.status, body };
}

function absUrl(base: string, href: string): string {
  try { return new URL(href, base).toString(); } catch { return ""; }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

function dateFromText(s: string): string | undefined {
  const m = s.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return undefined;
}

/** 通用列表页解析：抓 <a href title>文本</a>，标题够长且像新闻才收。 */
function parseHtmlList(html: string, baseUrl: string, maxItems: number, seen: Set<string>): CollectedItem[] {
  const out: CollectedItem[] = [];
  const re = /<a\b[^>]*href="([^"]+)"[^>]*?(?:title="([^"]*)")?[^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null && out.length < maxItems * 3) {
    const href = match[1];
    const text = stripTags(match[3] || "");
    const title = text.length >= 8 ? text : stripTags(match[2] || "");
    if (title.length < 8) continue;
    if (/^(首页|登录|注册|更多|详细|下一页|关于我们|网站地图|当前位置|免责声明|版权)/.test(title)) continue;
    if (!/^(https?:)?[/.]/.test(href) && !href.startsWith("mailto")) continue;
    if (/\.(js|css|png|jpg|ico|svg|pdf|doc|xls)($|\?)/i.test(href)) continue;
    const url = absUrl(baseUrl, href);
    if (url === "" || seen.has(url)) continue;
    // 官方列表页正文链接通常带日期路径或 content_ 编号
    if (!/(20\d{2}|content_|t20\d{2}|\/n\d)/.test(url) && !dateFromText(title)) continue;
    out.push({ url, title: title.slice(0, 300), publishedAt: dateFromText(title) });
  }
  // 去重（同链接只留一条）
  const uniq = new Map<string, CollectedItem>();
  for (const item of out) if (!uniq.has(item.url)) uniq.set(item.url, item);
  return [...uniq.values()].slice(0, maxItems);
}

/** 中国政府网·最新政策：页面内 ./ZUIXINZHENGCE.json 全量政策索引（TITLE/URL/DOCRELPUBTIME）。 */
async function collectGovPolicy(spec: SourceSpec, timeoutMs: number, seen: Set<string>): Promise<CollectedItem[]> {
  const feedUrl = absUrl(spec.url, "./ZUIXINZHENGCE.json");
  const rows: Array<Record<string, string>> = [];
  try {
    const feed = await fetchText(feedUrl, timeoutMs);
    if (feed.status === 200) rows.push(...(JSON.parse(feed.body) as Array<Record<string, string>>));
  } catch { /* 回退页面解析 */ }
  if (rows.length === 0) {
    const page = await fetchText(spec.url, timeoutMs);
    if (page.status !== 200) throw new Error(`HTTP ${page.status}`);
    return parseHtmlList(page.body, spec.url, spec.maxItems, seen);
  }
  const out: CollectedItem[] = [];
  for (const row of rows) {
    const title = (row.TITLE || "").trim();
    const url = (row.URL || "").trim();
    if (title === "" || url === "" || seen.has(url)) continue;
    out.push({ url, title: title.slice(0, 300), publishedAt: dateFromText(row.DOCRELPUBTIME || "") });
    if (out.length >= spec.maxItems) break;
  }
  return out;
}

/** RSS 2.0 / Atom 极简解析（不引依赖）：item/entry → title/link/pubDate。 */
function parseRss(xml: string, maxItems: number, seen: Set<string>): CollectedItem[] {
  const out: CollectedItem[] = [];
  const entryRe = /<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entryRe.exec(xml)) !== null && out.length < maxItems) {
    const block = entry[0];
    const title = stripTags((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ""])[1]);
    let link = ((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [, ""])[1]).trim();
    if (link === "") {
      const href = block.match(/<link[^>]*href="([^"]+)"/i);
      if (href) link = href[1];
    }
    if (title === "" || link === "" || seen.has(link)) continue;
    const summary = stripTags((block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [, ""])[1]).slice(0, 400);
    const pub = ((block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) || [, ""])[1]).trim();
    let publishedAt = dateFromText(pub);
    if (publishedAt === undefined && pub !== "") {
      const d = new Date(pub);
      if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString().slice(0, 10);
    }
    out.push({ url: link, title: title.slice(0, 300), summary: summary || undefined, publishedAt });
  }
  return out;
}

/** 公开 JSON 列表：数组或 {list|items|data:[...]}，字段容错 title/url/link/date/time。 */
function parseJsonList(body: string, baseUrl: string, maxItems: number, seen: Set<string>): CollectedItem[] {
  const data = JSON.parse(body) as unknown;
  const rows = Array.isArray(data)
    ? data
    : (data && typeof data === "object" ? ((data as Record<string, unknown>).list ?? (data as Record<string, unknown>).items ?? (data as Record<string, unknown>).data ?? []) : []);
  const out: CollectedItem[] = [];
  for (const raw of rows as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== "object") continue;
    const title = String(raw.title ?? raw.TITLE ?? raw.name ?? "").trim();
    const href = String(raw.url ?? raw.URL ?? raw.link ?? raw.href ?? "").trim();
    if (title === "" || href === "") continue;
    const url = absUrl(baseUrl, href);
    if (seen.has(url)) continue;
    out.push({
      url,
      title: title.slice(0, 300),
      summary: raw.summary != null || raw.description != null ? String(raw.summary ?? raw.description).slice(0, 400) : undefined,
      publishedAt: dateFromText(String(raw.date ?? raw.time ?? raw.publishedAt ?? "")),
    });
    if (out.length >= maxItems) break;
  }
  return out;
}

/** 单来源采集入口：按 kind 分派，返回增量条目与失败原因。 */
export async function collectSource(spec: SourceSpec, timeoutMs = 20_000): Promise<CollectOutcome> {
  const kind = spec.kind !== "" ? spec.kind : detectKind(spec.url);
  const seen = new Set(spec.seen);
  try {
    let items: CollectedItem[];
    let httpStatus: number | null = 200;
    if (kind === "gov_policy") {
      items = await collectGovPolicy(spec, timeoutMs, seen);
    } else if (kind === "rss") {
      const page = await fetchText(spec.url, timeoutMs);
      httpStatus = page.status;
      if (page.status !== 200) throw new Error(`HTTP ${page.status}`);
      items = parseRss(page.body, spec.maxItems, seen);
    } else if (kind === "json_list") {
      const page = await fetchText(spec.url, timeoutMs);
      httpStatus = page.status;
      if (page.status !== 200) throw new Error(`HTTP ${page.status}`);
      items = parseJsonList(page.body, spec.url, spec.maxItems, seen);
    } else {
      // stats_news / samr_news / web_list / miit：公开列表页解析（stats 相对链接基于列表页地址）
      const page = await fetchText(spec.url, timeoutMs);
      httpStatus = page.status;
      if (page.status !== 200) throw new Error(`HTTP ${page.status}`);
      items = parseHtmlList(page.body, spec.url, spec.maxItems, seen);
    }
    const fresh = items.map((item) => item.url);
    return { kind, items, fresh, httpStatus };
  } catch (error) {
    return { kind, items: [], fresh: [], httpStatus: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export { detectKind };
