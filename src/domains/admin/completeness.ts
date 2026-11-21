/**
 * 信息完善度巡检（v2.30）：每天定时检查整个系统各项信息的完善程度——
 * 公司基础信息、公司战略（记忆）、项目档案、情报来源等。
 * 口径：AI 能自动补全的直接补（项目简介、战略记忆草案走提议确认）；
 * 补不了的生成提问卡（stat.project_decision，project_id=0 公司级哨兵），
 * 老板在「设置 → 信息完善度巡检」回答后自动回填对应字段。
 * 巡检结果快照存 ref.shared_setting（键 completeness.last_run），设置键 completeness.settings。
 */
import type { Pool } from "../../db/pool.ts";
import type { AuditService } from "../../audit/audit.ts";
import { OpcError, ERR } from "../../platform/errors.ts";

type Row = Record<string, unknown>;

export const COMPLETENESS_SETTINGS_KEY = "completeness.settings";
export const COMPLETENESS_LAST_RUN_KEY = "completeness.last_run";
/** 公司级提问卡哨兵：stat.project_decision.project_id 无外键，0 = 公司（非项目）。 */
export const COMPANY_SENTINEL_PROJECT = 0;

export interface CompletenessSettings {
  enabled: boolean;
  autoFill: boolean;
  maxQuestionsPerRun: number;
}

const SETTINGS_DEFAULTS: CompletenessSettings = { enabled: true, autoFill: true, maxQuestionsPerRun: 5 };

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

function normalizeSettings(raw: Row): CompletenessSettings {
  return {
    enabled: raw.enabled === undefined ? SETTINGS_DEFAULTS.enabled : raw.enabled === true,
    autoFill: raw.autoFill === undefined ? SETTINGS_DEFAULTS.autoFill : raw.autoFill === true,
    maxQuestionsPerRun: clampInt(raw.maxQuestionsPerRun, 1, 20, SETTINGS_DEFAULTS.maxQuestionsPerRun),
  };
}

/** 提问卡可回填的公司基础信息字段白名单（fieldKey → 列名）。 */
const PROFILE_FIELD_COLUMNS: Record<string, string> = {
  industry: "industry",
  legalPerson: "legal_person",
  establishedDate: "established_date",
  registeredCapital: "registered_capital",
  creditCode: "credit_code",
  businessScope: "business_scope",
  website: "website",
  officeAddress: "office_address",
  email: "email",
  employeeCount: "employee_count",
};

interface CheckItem {
  domain: string;
  key: string;
  label: string;
  filled: boolean;
  weight: number;
  /** 提问卡文案（未填时向老板怎么问）。 */
  question?: string;
  /** 提问选项。 */
  options?: Array<{ label: string; impact?: string }>;
}

/** 简易 AI 通道（与创意立案同一组环境变量）；不可用返回 null，巡检降级为只提问。 */
function aiConfig(): { apiKey: string; baseUrl: string; model: string } | null {
  if (process.env.OPC_AI_DISABLED === "1") return null;
  const apiKey = process.env.OPC_AI_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") return null;
  return {
    apiKey,
    baseUrl: (process.env.OPC_AI_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, ""),
    model: process.env.OPC_AI_MODEL ?? "deepseek-chat",
  };
}

async function aiChat(prompt: string, timeoutMs = 60_000): Promise<string | null> {
  const config = aiConfig();
  if (config === null) return null;
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.3,
        messages: [
          { role: "system", content: "你是公司运营助理，按指令输出，不臆造事实。" },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    return content.trim() === "" ? null : content;
  } catch {
    return null;
  }
}

export class CompletenessService {
  pool: Pool;
  audit: AuditService;

  constructor(pool: Pool, audit: AuditService) {
    this.pool = pool;
    this.audit = audit;
  }

  async getSettings(): Promise<CompletenessSettings> {
    const rows = await this.pool.query<{ value: Row }>(
      "SELECT value FROM ref.shared_setting WHERE key = $1",
      [COMPLETENESS_SETTINGS_KEY],
    );
    return normalizeSettings(rows.rows[0]?.value ?? {});
  }

  async updateSettings(input: Row): Promise<CompletenessSettings> {
    for (const key of ["enabled", "autoFill"]) {
      if (input[key] !== undefined && typeof input[key] !== "boolean") {
        throw new OpcError(ERR.WEB_INVALID, `${key} 必须是布尔值`, 400);
      }
    }
    if (input.maxQuestionsPerRun !== undefined && !Number.isFinite(Number(input.maxQuestionsPerRun))) {
      throw new OpcError(ERR.WEB_INVALID, "maxQuestionsPerRun 必须是数字", 400);
    }
    const current = await this.getSettings();
    const next = normalizeSettings({ ...current, ...input });
    await this.pool.query(
      `INSERT INTO ref.shared_setting (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
      [COMPLETENESS_SETTINGS_KEY, JSON.stringify(next)],
    );
    await this.audit.record({
      actor: "opc_admin",
      action: "completeness.settings.update",
      result: "ok",
      objectType: "shared_setting",
      objectId: COMPLETENESS_SETTINGS_KEY,
      payload: next,
    });
    return next;
  }

  /** 逐项检查各域完善度，返回明细与得分（0–100）。 */
  async checklist(): Promise<{ score: number; domains: Array<{ domain: string; items: Array<Record<string, unknown>> }> }> {
    const items = await this.checklistInternal();
    const byDomain = new Map<string, Array<Record<string, unknown>>>();
    for (const item of items) {
      if (!byDomain.has(item.domain)) byDomain.set(item.domain, []);
      byDomain.get(item.domain)!.push({ key: item.key, label: item.label, filled: item.filled, weight: item.weight });
    }
    return {
      score: scoreOf(items),
      domains: [...byDomain.entries()].map(([domain, list]) => ({ domain, items: list })),
    };
  }

  private async checklistInternal(): Promise<CheckItem[]> {
    const items: CheckItem[] = [];
    const push = (item: CheckItem) => items.push(item);
    const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

    // —— 公司基础信息 ——
    const profileRows = await this.pool.query(
      `SELECT industry, legal_person, established_date, registered_capital, credit_code, business_scope,
              website, office_address, email, employee_count, phone, tax_types, bank_accounts
       FROM biz.company_profile ORDER BY id LIMIT 1`,
    );
    const p = (profileRows.rows[0] ?? {}) as Row;
    const jsonEmpty = (v: unknown) => {
      if (blank(v)) return true;
      try {
        const parsed = typeof v === "string" ? JSON.parse(v) : v;
        return !Array.isArray(parsed) || parsed.length === 0;
      } catch {
        return true;
      }
    };
    push({ domain: "公司基础信息", key: "industry", label: "所属行业", filled: !blank(p.industry), weight: 2, question: "公司主营业务所属行业是什么？（如：软件开发 / 信息技术服务）", options: [{ label: "软件开发与信息技术服务", impact: "按现有业务登记" }, { label: "其它（自定义回答）" }] });
    push({ domain: "公司基础信息", key: "legalPerson", label: "法定代表人", filled: !blank(p.legal_person), weight: 3, question: "公司法定代表人是谁？（工商登记口径）" });
    push({ domain: "公司基础信息", key: "establishedDate", label: "成立日期", filled: !blank(p.established_date), weight: 2, question: "公司成立日期（营业执照上的日期）？" });
    push({ domain: "公司基础信息", key: "creditCode", label: "统一社会信用代码", filled: !blank(p.credit_code), weight: 3, question: "统一社会信用代码（营业执照 18 位）？" });
    push({ domain: "公司基础信息", key: "registeredCapital", label: "注册资本", filled: !blank(p.registered_capital), weight: 1, question: "注册资本是多少？（如：100 万元人民币）" });
    push({ domain: "公司基础信息", key: "businessScope", label: "经营范围", filled: !blank(p.business_scope), weight: 2, question: "营业执照上的经营范围摘要？" });
    push({ domain: "公司基础信息", key: "website", label: "公司官网", filled: !blank(p.website), weight: 1, question: "公司有官网吗？地址是什么？", options: [{ label: "暂无官网", impact: "登记为无，不再追问" }] });
    push({ domain: "公司基础信息", key: "officeAddress", label: "办公地址", filled: !blank(p.office_address), weight: 1, question: "日常办公地址在哪里？" });
    push({ domain: "公司基础信息", key: "email", label: "对外邮箱", filled: !blank(p.email), weight: 1, question: "对外联系邮箱用哪个？" });
    push({ domain: "公司基础信息", key: "employeeCount", label: "团队规模", filled: !blank(p.employee_count), weight: 1, question: "目前团队多少人？（大致区间即可）", options: [{ label: "5 人以内" }, { label: "5–20 人" }, { label: "20 人以上" }] });
    push({ domain: "公司基础信息", key: "taxTypes", label: "税种登记", filled: !jsonEmpty(p.tax_types), weight: 2, question: "公司登记了哪些税种？（增值税/企业所得税等）" });
    push({ domain: "公司基础信息", key: "bankAccounts", label: "银行账户", filled: !jsonEmpty(p.bank_accounts), weight: 2, question: "公司主要收款银行账户（开户行+账号后四位）登记了吗？" });

    // —— 公司战略与记忆 ——
    const strategyRows = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM stat.web_memory_card
       WHERE scope = 'company_profile' AND (title ILIKE '%战略%' OR content ILIKE '%战略%' OR content ILIKE '%目标%')`,
    );
    push({ domain: "公司战略与记忆", key: "strategy", label: "公司战略（记忆）", filled: Number(strategyRows.rows[0]?.n ?? 0) > 0, weight: 4, question: "公司今年的战略重点是什么？（如：先做 OPC-玄机 产品化，再拓客）", options: [{ label: "让 AI 根据现有情报起草一版", impact: "生成战略草案，确认后入公司记忆" }] });
    const profileMemRows = await this.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM stat.web_memory_card WHERE scope = 'company_profile'",
    );
    push({ domain: "公司战略与记忆", key: "profileMemory", label: "公司画像记忆", filled: Number(profileMemRows.rows[0]?.n ?? 0) > 0, weight: 2 });
    const intelMemRows = await this.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM stat.web_memory_card WHERE scope = 'market_intel'",
    );
    push({ domain: "公司战略与记忆", key: "marketIntelMemory", label: "市场情报入记忆", filled: Number(intelMemRows.rows[0]?.n ?? 0) > 0, weight: 1 });

    // —— 项目档案 ——
    const projects = await this.pool.query<{ id: number; name: string; description: string | null; tech_stack: unknown }>(
      "SELECT id, name, description, tech_stack FROM biz.project WHERE archived_at IS NULL ORDER BY id",
    );
    for (const proj of projects.rows) {
      push({ domain: "项目档案", key: `project:${proj.id}:description`, label: `项目「${proj.name}」简介`, filled: !blank(proj.description), weight: 1 });
      push({ domain: "项目档案", key: `project:${proj.id}:techStack`, label: `项目「${proj.name}」技术栈`, filled: !blank(proj.tech_stack) && !jsonEmpty(proj.tech_stack), weight: 1 });
    }

    // —— 情报与来源 ——
    const srcRows = await this.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM biz.source WHERE enabled AND status = 'active'",
    );
    push({ domain: "情报与来源", key: "intelSources", label: "启用的情报来源", filled: Number(srcRows.rows[0]?.n ?? 0) > 0, weight: 1 });
    return items;
  }

  /** 一次巡检：算完善度 → AI 自动补全（项目简介/战略草案）→ 缺口生成提问卡（去重、限量）。 */
  async inspect(now: Date, options: { force?: boolean } = {}): Promise<Row> {
    const settings = await this.getSettings();
    if (!settings.enabled && options.force !== true) {
      return { enabled: false, score: 0, autoFilled: 0, questions: 0, skipped: "disabled" };
    }
    const checklist = await this.checklistInternal();
    const missing = checklist.filter((item) => !item.filled && item.question !== undefined);

    let autoFilled = 0;
    if (settings.autoFill) {
      autoFilled += await this.autoFillProjectDescriptions();
      autoFilled += await this.autoFillStrategyDraft(checklist);
    }

    // 提问卡：同 fieldKey 已有 pending 卡则不重复；每轮限量。
    let questions = 0;
    const pendingRows = await this.pool.query<{ payload: Row }>(
      `SELECT payload FROM stat.project_decision
       WHERE project_id = $1 AND status = 'pending' AND payload->>'kind' = 'completeness'`,
      [COMPANY_SENTINEL_PROJECT],
    );
    const pendingKeys = new Set(pendingRows.rows.map((row) => String((row.payload ?? {}).fieldKey ?? "")));
    for (const item of missing) {
      if (questions >= settings.maxQuestionsPerRun) break;
      if (pendingKeys.has(item.key)) continue;
      // 战略草案已出（AI 起草待确认）时不再追问战略
      if (item.key === "strategy" && autoFilled > 0) continue;
      await this.pool.query(
        `INSERT INTO stat.project_decision (project_id, topic, question, options, risk_level, status, payload)
         VALUES ($1,$2,$3,$4::jsonb,'low','pending',$5::jsonb)`,
        [
          COMPANY_SENTINEL_PROJECT,
          `信息完善度 · ${item.label}`,
          item.question ?? item.label,
          JSON.stringify(item.options ?? []),
          JSON.stringify({ kind: "completeness", fieldKey: item.key, domain: item.domain, askedAt: now.toISOString() }),
        ],
      );
      questions += 1;
    }

    const summary = {
      enabled: true,
      ranAt: now.toISOString(),
      score: scoreOf(checklist),
      checked: checklist.length,
      missing: checklist.filter((item) => !item.filled).length,
      autoFilled,
      questions,
    };
    await this.pool.query(
      `INSERT INTO ref.shared_setting (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
      [COMPLETENESS_LAST_RUN_KEY, JSON.stringify(summary)],
    );
    await this.audit.record({
      actor: "opc_admin",
      action: "completeness.inspect",
      result: "ok",
      objectType: "shared_setting",
      objectId: COMPLETENESS_LAST_RUN_KEY,
      payload: summary,
    });
    return summary;
  }

  /** AI 补全：缺简介的活跃项目，按项目名/类型/技术栈起草并直接回填（低风险字段，留审计）。 */
  private async autoFillProjectDescriptions(): Promise<number> {
    const rows = await this.pool.query<{ id: number; name: string; project_type: string }>(
      "SELECT id, name, project_type FROM biz.project WHERE archived_at IS NULL AND (description IS NULL OR trim(description) = '') ORDER BY id LIMIT 5",
    );
    let filled = 0;
    for (const proj of rows.rows) {
      const draft = await aiChat(
        `为公司项目「${proj.name}」（类型：${proj.project_type}）起草一句 40–80 字的中文项目简介，只输出简介本身，不要引号、不要解释。若信息不足就写通用但准确的描述，不得臆造具体数字。`,
        30_000,
      );
      if (draft === null) continue;
      const text = draft.replace(/^["“「]+|["”」]+$/g, "").slice(0, 500);
      if (text.length < 8) continue;
      const updated = await this.pool.query(
        "UPDATE biz.project SET description = $2 WHERE id = $1 AND (description IS NULL OR trim(description) = '') RETURNING id",
        [proj.id, text],
      );
      if (updated.rows.length === 0) continue;
      filled += 1;
      await this.audit.record({
        actor: "opc_admin",
        action: "completeness.autofill.project_description",
        result: "ok",
        objectType: "project",
        objectId: String(proj.id),
        payload: { source: "ai", text: text.slice(0, 200) },
      });
    }
    return filled;
  }

  /** AI 补全：无战略记忆时，基于现有记忆与市场情报生成「公司战略草案」记忆提议（老板确认后落库）。 */
  private async autoFillStrategyDraft(checklist: CheckItem[]): Promise<number> {
    const strategy = checklist.find((item) => item.key === "strategy");
    if (strategy === undefined || strategy.filled) return 0;
    const dup = await this.pool.query(
      "SELECT 1 FROM stat.web_memory_proposal WHERE memory_type = 'company_profile' AND title = $1 LIMIT 1",
      ["公司战略草案（AI 巡检起草）"],
    );
    if (dup.rows.length > 0) return 0;
    const memoryRows = await this.pool.query<{ title: string; content: string }>(
      "SELECT title, left(content, 400) AS content FROM stat.web_memory_card ORDER BY id DESC LIMIT 12",
    );
    const intelRows = await this.pool.query<{ title: string }>(
      "SELECT title FROM biz.intel_item WHERE project_id IS NULL ORDER BY id DESC LIMIT 15",
    );
    if (memoryRows.rows.length === 0 && intelRows.rows.length === 0) return 0;
    const refs = [
      ...memoryRows.rows.slice(0, 5).map((row) => `memory:${String(row.title).slice(0, 60)}`),
      ...intelRows.rows.slice(0, 5).map((row) => String(row.title).slice(0, 120)),
    ];
    const draft = await aiChat(
      [
        "根据以下公司现有记忆与市场情报，起草一份 200–400 字的《公司战略草案》，包含：定位、本年度重点方向（3 条以内）、近期可执行动作（3 条以内）。",
        "只输出草案正文，不要标题、不要臆造数字。",
        `记忆：${memoryRows.rows.map((row) => `${row.title}：${row.content}`).join("；").slice(0, 3000) || "（无）"}`,
        `近期市场情报标题：${intelRows.rows.map((row) => row.title).join("；").slice(0, 1500) || "（无）"}`,
      ].join("\n"),
      45_000,
    );
    if (draft === null || draft.length < 40) return 0;
    await this.pool.query(
      `INSERT INTO stat.web_memory_proposal (memory_type, title, content, source_refs, confidence)
       VALUES ('company_profile', $1, $2, $3::jsonb, 0.5)`,
      ["公司战略草案（AI 巡检起草）", draft.slice(0, 4000), JSON.stringify(refs)],
    );
    await this.audit.record({
      actor: "opc_admin",
      action: "completeness.autofill.strategy_draft",
      result: "ok",
      objectType: "web_memory_proposal",
      objectId: "公司战略草案（AI 巡检起草）",
      payload: { refs: refs.length },
    });
    return 1;
  }

  /** 巡检页数据：设置 + 最近一次快照 + 完善度明细 + 待回答提问卡。 */
  async overview(): Promise<Row> {
    const [settings, lastRun, checklist, questions] = await Promise.all([
      this.getSettings(),
      this.pool.query<{ value: Row }>("SELECT value FROM ref.shared_setting WHERE key = $1", [COMPLETENESS_LAST_RUN_KEY]),
      this.checklist(),
      this.listQuestions(),
    ]);
    return { settings, lastRun: lastRun.rows[0]?.value ?? null, ...checklist, questions };
  }

  async listQuestions(): Promise<Array<Row>> {
    const rows = await this.pool.query(
      `SELECT id, topic, question, options, status, decision, decided_at, payload, created_at
       FROM stat.project_decision
       WHERE project_id = $1 AND payload->>'kind' = 'completeness'
       ORDER BY (status = 'pending') DESC, id DESC LIMIT 30`,
      [COMPANY_SENTINEL_PROJECT],
    );
    return rows.rows as Row[];
  }

  /** 老板回答提问：战略类走记忆草案提示；公司基础信息字段直接回填；其余仅记录裁决。 */
  async answer(decisionId: number, input: { answer?: string; later?: boolean }): Promise<Row> {
    const answer = typeof input.answer === "string" ? input.answer.trim() : "";
    const later = input.later === true;
    if (answer === "" && !later) throw new OpcError(ERR.WEB_INVALID, "请填写回答，或选择「稍后提供」", 400);
    const rows = await this.pool.query(
      `SELECT id, payload FROM stat.project_decision
       WHERE id = $1 AND project_id = $2 AND status = 'pending'`,
      [decisionId, COMPANY_SENTINEL_PROJECT],
    );
    const row = rows.rows[0] as { id: number; payload: Row } | undefined;
    if (row === undefined) throw new OpcError(ERR.WEB_INVALID, `提问不存在或已回答：${decisionId}`, 404);
    const fieldKey = String((row.payload ?? {}).fieldKey ?? "");
    let appliedTo: string | null = null;
    if (!later && answer !== "") {
      const column = PROFILE_FIELD_COLUMNS[fieldKey];
      if (column !== undefined) {
        if (answer.length > 500) throw new OpcError(ERR.WEB_INVALID, "回答过长（≤500 字）", 400);
        // 类型安全回填：date/integer 列先规整，规整不了只记裁决不回填（避免脏数据）
        let value: string | number = answer;
        if (column === "established_date") {
          const m = answer.match(/(20\d{2})\D{0,2}(\d{1,2})\D{0,2}(\d{1,2})/);
          if (m === null) value = "";
          else value = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
        } else if (column === "employee_count") {
          const digits = answer.replace(/\D+/g, "");
          value = digits === "" ? "" : Number(digits);
        }
        if (value !== "") {
          const updated = await this.pool.query(
            `UPDATE biz.company_profile SET ${column} = $1, updated_at = now(), updated_by = '老板（巡检回答）' WHERE id = (SELECT id FROM biz.company_profile ORDER BY id LIMIT 1) RETURNING id`,
            [value],
          );
          if (updated.rows.length > 0) appliedTo = fieldKey;
        }
      }
    }
    await this.pool.query(
      `UPDATE stat.project_decision SET status = 'decided', decision = $2, decided_by = '老板', decided_at = now() WHERE id = $1`,
      [decisionId, later ? "稍后提供" : answer],
    );
    await this.audit.record({
      actor: "opc_admin",
      action: "completeness.question.answer",
      result: "ok",
      objectType: "project_decision",
      objectId: String(decisionId),
      payload: { fieldKey, appliedTo, later },
    });
    return { id: decisionId, fieldKey, appliedTo, later };
  }
}

function scoreOf(checklist: CheckItem[]): number {
  const totalWeight = checklist.reduce((sum, item) => sum + item.weight, 0);
  const filledWeight = checklist.filter((item) => item.filled).reduce((sum, item) => sum + item.weight, 0);
  return totalWeight === 0 ? 100 : Math.round((filledWeight / totalWeight) * 100);
}
