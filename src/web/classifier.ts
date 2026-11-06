/**
 * 网页表现层：上传/输入归置的确定性分类与决策。
 *
 * 设计边界（产品设计第九章 9.6）：
 * - 分类是规则优先的确定性逻辑，模型只作为后续补充；规则命中结果必须可解释。
 * - 财税/法务/客户/库存写入属高风险域，**无论置信度多高都必须人工确认**。
 * - 置信度低或未命中任何域时进入收件箱，不自动写库。
 */

export type DomainId =
  | "finance"
  | "legal"
  | "admin"
  | "strategy"
  | "project"
  | "intel"
  | "crm"
  | "inventory"
  | "vehicle"
  | "wbs"
  | "publicity"
  | "inbox";

export type IngestAction = "auto_draft" | "confirm" | "inbox";

export interface DomainScore {
  domain: Exclude<DomainId, "inbox">;
  score: number;
  matched: string[];
}

export interface Classification {
  domain: DomainId;
  confidence: number;
  matchedRules: string[];
  candidates: DomainScore[];
}

export interface ExtractedFields {
  amount?: number;
  date?: string;
  counterparty?: string;
  invoiceNo?: string;
  contractNo?: string;
  projectId?: number;
}

export interface IngestDecision {
  action: IngestAction;
  requiresHuman: boolean;
  reason: string;
  writeTarget: string;
}

interface Rule {
  domain: Exclude<DomainId, "inbox">;
  keyword: string;
  weight: number;
}

const RULES: Rule[] = [
  // 财税
  { domain: "finance", keyword: "发票", weight: 3 },
  { domain: "finance", keyword: "报销", weight: 2 },
  { domain: "finance", keyword: "税务", weight: 2 },
  { domain: "finance", keyword: "申报", weight: 2 },
  { domain: "finance", keyword: "应收", weight: 2 },
  { domain: "finance", keyword: "应付", weight: 2 },
  { domain: "finance", keyword: "付款", weight: 1 },
  { domain: "finance", keyword: "收款", weight: 1 },
  { domain: "finance", keyword: "工资", weight: 2 },
  { domain: "finance", keyword: "社保", weight: 1 },
  { domain: "finance", keyword: "现金流", weight: 2 },
  { domain: "finance", keyword: "税", weight: 1 },
  // 法务
  { domain: "legal", keyword: "合同", weight: 3 },
  { domain: "legal", keyword: "条款", weight: 2 },
  { domain: "legal", keyword: "违约", weight: 2 },
  { domain: "legal", keyword: "股权", weight: 2 },
  { domain: "legal", keyword: "诉讼", weight: 2 },
  { domain: "legal", keyword: "律师", weight: 2 },
  { domain: "legal", keyword: "合规", weight: 1 },
  { domain: "legal", keyword: "保密", weight: 1 },
  // 行政
  { domain: "admin", keyword: "日程", weight: 2 },
  { domain: "admin", keyword: "会议", weight: 2 },
  { domain: "admin", keyword: "纪要", weight: 2 },
  { domain: "admin", keyword: "差旅", weight: 1 },
  { domain: "admin", keyword: "请假", weight: 1 },
  { domain: "admin", keyword: "办公", weight: 1 },
  { domain: "admin", keyword: "印章", weight: 1 },
  // 战略
  { domain: "strategy", keyword: "战略", weight: 2 },
  { domain: "strategy", keyword: "OKR", weight: 3 },
  { domain: "strategy", keyword: "复盘", weight: 2 },
  { domain: "strategy", keyword: "决策", weight: 2 },
  { domain: "strategy", keyword: "规划", weight: 2 },
  { domain: "strategy", keyword: "增长", weight: 1 },
  // 项目
  { domain: "project", keyword: "项目", weight: 2 },
  { domain: "project", keyword: "交付", weight: 2 },
  { domain: "project", keyword: "里程碑", weight: 2 },
  { domain: "project", keyword: "验收", weight: 2 },
  { domain: "project", keyword: "阻塞", weight: 2 },
  { domain: "project", keyword: "排期", weight: 1 },
  // 情报
  { domain: "intel", keyword: "政策", weight: 2 },
  { domain: "intel", keyword: "竞品", weight: 2 },
  { domain: "intel", keyword: "行业", weight: 1 },
  { domain: "intel", keyword: "尽调", weight: 2 },
  { domain: "intel", keyword: "商机", weight: 2 },
  { domain: "intel", keyword: "补贴", weight: 2 },
  { domain: "intel", keyword: "情报", weight: 2 },
  // 客户
  { domain: "crm", keyword: "客户", weight: 3 },
  { domain: "crm", keyword: "联系人", weight: 2 },
  { domain: "crm", keyword: "拜访", weight: 2 },
  { domain: "crm", keyword: "续约", weight: 2 },
  { domain: "crm", keyword: "承诺", weight: 2 },
  { domain: "crm", keyword: "投诉", weight: 2 },
  { domain: "crm", keyword: "报价", weight: 1 },
  // 库存
  { domain: "inventory", keyword: "库存", weight: 3 },
  { domain: "inventory", keyword: "SKU", weight: 2 },
  { domain: "inventory", keyword: "入库", weight: 3 },
  { domain: "inventory", keyword: "出库", weight: 3 },
  { domain: "inventory", keyword: "采购", weight: 2 },
  { domain: "inventory", keyword: "供应商", weight: 2 },
  { domain: "inventory", keyword: "盘点", weight: 2 },
  { domain: "inventory", keyword: "缺票", weight: 2 },
  // 车务
  { domain: "vehicle", keyword: "车辆", weight: 3 },
  { domain: "vehicle", keyword: "用车", weight: 2 },
  { domain: "vehicle", keyword: "里程", weight: 2 },
  { domain: "vehicle", keyword: "加油", weight: 2 },
  { domain: "vehicle", keyword: "年检", weight: 2 },
  { domain: "vehicle", keyword: "违章", weight: 2 },
  { domain: "vehicle", keyword: "私车公用", weight: 3 },
  // WBS
  { domain: "wbs", keyword: "WBS", weight: 3 },
  { domain: "wbs", keyword: "工作分解", weight: 3 },
  { domain: "wbs", keyword: "工作包", weight: 2 },
  { domain: "wbs", keyword: "基线", weight: 2 },
  { domain: "wbs", keyword: "关键路径", weight: 2 },
  { domain: "wbs", keyword: "任务分解", weight: 2 },
  { domain: "wbs", keyword: "工期", weight: 1 },
  { domain: "wbs", keyword: "工时", weight: 1 },
  { domain: "wbs", keyword: "交付物", weight: 1 },
  // 外宣
  { domain: "publicity", keyword: "外宣", weight: 3 },
  { domain: "publicity", keyword: "新闻稿", weight: 3 },
  { domain: "publicity", keyword: "稿件", weight: 2 },
  { domain: "publicity", keyword: "社媒", weight: 2 },
  { domain: "publicity", keyword: "公众号", weight: 2 },
  { domain: "publicity", keyword: "发布", weight: 2 },
  { domain: "publicity", keyword: "宣传", weight: 2 },
  { domain: "publicity", keyword: "品牌", weight: 2 },
  { domain: "publicity", keyword: "公关", weight: 2 },
  { domain: "publicity", keyword: "媒体", weight: 1 },
];

export const HIGH_RISK_DOMAINS: ReadonlySet<DomainId> = new Set(["finance", "legal", "crm", "inventory", "wbs", "publicity"]);

const WRITE_TARGETS: Record<DomainId, string> = {
  finance: "ledger",
  legal: "contract",
  admin: "event",
  strategy: "objective",
  project: "project",
  intel: "lead",
  crm: "customer",
  inventory: "stock_txn",
  vehicle: "vehicle_log",
  wbs: "wbs_node",
  publicity: "publication",
  inbox: "inbox",
};

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function classifyText(input: string): Classification {
  const text = normalize(input);
  if (text === "") {
    return { domain: "inbox", confidence: 0, matchedRules: [], candidates: [] };
  }

  const scores = new Map<Exclude<DomainId, "inbox">, { score: number; matched: string[] }>();
  for (const rule of RULES) {
    if (!text.includes(rule.keyword)) continue;
    const current = scores.get(rule.domain) ?? { score: 0, matched: [] };
    current.score += rule.weight;
    current.matched.push(rule.keyword);
    scores.set(rule.domain, current);
  }

  const candidates = [...scores.entries()]
    .map(([domain, value]) => ({ domain, score: value.score, matched: value.matched }))
    .sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));

  if (candidates.length === 0) {
    return { domain: "inbox", confidence: 0, matchedRules: [], candidates: [] };
  }

  const top = candidates[0];
  const confidence = Math.min(0.99, top.score / (top.score + 3));
  return {
    domain: top.domain,
    confidence: Number(confidence.toFixed(3)),
    matchedRules: top.matched,
    candidates,
  };
}

function parseAmount(text: string): number | undefined {
  const patterns = [
    /(?:金额|价税合计|合计|总额|报价|付款|收款)\s*[:：]?\s*[¥￥]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/,
    /[¥￥]\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/,
    /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*元/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match !== null) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

function parseDate(text: string): string | undefined {
  const full = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/.exec(text);
  if (full !== null) {
    const [, year, month, day] = full;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return undefined;
}

export function extractFields(input: string): ExtractedFields {
  const text = normalize(input);
  const fields: ExtractedFields = {};
  const amount = parseAmount(text);
  if (amount !== undefined) fields.amount = amount;
  const date = parseDate(text);
  if (date !== undefined) fields.date = date;
  const counterparty = /(?:对方|客户|供应商|相对方)\s*[:：]\s*([^\s，,。;；]{2,30})/.exec(text);
  if (counterparty !== null) fields.counterparty = counterparty[1];
  const invoiceNo = /(?:发票号|发票号码)\s*[:：]?\s*([0-9A-Za-z]{6,})/.exec(text);
  if (invoiceNo !== null) fields.invoiceNo = invoiceNo[1];
  const contractNo = /(?:合同号|合同编号)\s*[:：]?\s*([0-9A-Za-z-]{4,})/.exec(text);
  if (contractNo !== null) fields.contractNo = contractNo[1];
  const projectId = /(?:项目ID|项目编号)\s*[:：]?\s*(\d+)/.exec(text);
  if (projectId !== null) fields.projectId = Number(projectId[1]);
  return fields;
}

export function decideIngest(classification: Classification): IngestDecision {
  if (classification.domain === "inbox") {
    return {
      action: "inbox",
      requiresHuman: true,
      reason: "未匹配到明确业务域，进入待归置收件箱",
      writeTarget: "inbox",
    };
  }
  const writeTarget = WRITE_TARGETS[classification.domain];
  if (HIGH_RISK_DOMAINS.has(classification.domain)) {
    return {
      action: "confirm",
      requiresHuman: true,
      reason: "高风险域写入必须人工确认",
      writeTarget,
    };
  }
  if (classification.confidence >= 0.85) {
    return {
      action: "auto_draft",
      requiresHuman: false,
      reason: "高置信度归置为草稿，等待右栏确认",
      writeTarget,
    };
  }
  if (classification.confidence >= 0.55) {
    return {
      action: "confirm",
      requiresHuman: true,
      reason: "中等置信度，生成归置卡由老板确认",
      writeTarget,
    };
  }
  return {
    action: "inbox",
    requiresHuman: true,
    reason: "置信度不足，进入待归置收件箱",
    writeTarget: "inbox",
  };
}
