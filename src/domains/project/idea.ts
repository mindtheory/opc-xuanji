/**
 * 创意转项目（SRS-105 REQ-PRJ-035）：
 * 用户输入一段创意 → AI 解析/完善成项目档案（名称、类型、范围、目标、技术栈提示、风险、待确认问题、工期）
 * → 自动建项目并进入自动驾驶；无 AI 配置时用规则兜底；无版本库时转裁决等待老板补。
 *
 * 边界：AI 只做解析与完善，不臆造事实；解析结果与原文都落 stat.project_idea 留痕；
 * 解析失败不阻塞建项目（降级为规则解析），错误只记录不抛出。
 */
import type { Pool } from "../../db/pool.ts";
import type { AuditService } from "../../audit/audit.ts";

export interface IdeaAnalysis {
  name: string;
  projectType: string;
  stage: string;
  scope: string;
  goals: string[];
  techStackHints: string[];
  risks: string[];
  openQuestions: string[];
  suggestedRepository?: string | null;
  weeks: number;
  confidence: number;
  source: "ai" | "rule";
  model?: string | null;
  raw?: unknown;
  documents?: Array<{ name: string; kind: string; chars: number }>;
}

type Row = Record<string, unknown>;

const DEFAULT_STAGE = "planning";
const SOFTWARE_HINTS = ["系统", "平台", "应用", "app", "软件", "服务", "后台", "小程序", "网站", "接口", "api", "工具", "ai", "智能"];

function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const cut = clean.split(/[。！？.!?\n]/).filter((part) => part.trim() !== "")[0] ?? clean;
  return cut.slice(0, 40);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export class IdeaService {
  private readonly pool: Pool;
  private readonly audit: AuditService;

  constructor(pool: Pool, audit: AuditService) {
    this.pool = pool;
    this.audit = audit;
  }

  /** 规则解析：AI 不可用或失败时的兜底，保证「创意 → 项目」永远走得通。 */
  private ruleAnalysis(idea: string): IdeaAnalysis {
    const text = idea.trim();
    const isSoftware = SOFTWARE_HINTS.some((hint) => text.toLowerCase().includes(hint));
    const sentences = text.split(/[。！？.!?\n]/).map((part) => part.trim()).filter((part) => part !== "");
    const name = firstSentence(text) || "创意项目";
    const goals = sentences
      .slice(0, 3)
      .map((sentence) => sentence.slice(0, 60))
      .filter((sentence) => sentence !== "");
    return {
      name,
      projectType: isSoftware ? "software" : "business",
      stage: DEFAULT_STAGE,
      scope: text.slice(0, 800),
      goals: goals.length > 0 ? goals : [text.slice(0, 60)],
      techStackHints: isSoftware ? ["待确认技术栈"] : [],
      risks: ["创意尚未经过可行性验证", "需求边界待澄清"],
      openQuestions: ["目标用户与验收标准是什么？", "预算与时间窗是什么？"],
      suggestedRepository: null,
      weeks: clamp(Math.ceil(text.length / 300) + 2, 2, 12),
      confidence: 0.35,
      source: "rule",
    };
  }

  private aiConfig(): { apiKey: string; baseUrl: string; model: string } | null {
    if (process.env.OPC_AI_DISABLED === "1") return null;
    const apiKey = process.env.OPC_AI_API_KEY ?? process.env.DEEPSEEK_API_KEY;
    if (apiKey === undefined || apiKey.trim() === "") return null;
    return {
      apiKey,
      baseUrl: (process.env.OPC_AI_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, ""),
      model: process.env.OPC_AI_MODEL ?? "deepseek-chat",
    };
  }

  /** 解析创意：优先 AI，失败降级规则；永远返回可用结构。 */
  async analyze(idea: string): Promise<IdeaAnalysis> {
    const text = idea.trim();
    const config = this.aiConfig();
    if (config === null) return this.ruleAnalysis(text);
    const prompt = [
      "你是 OPC-玄机 的项目立案助理。把用户创意解析成项目档案，只输出 JSON（不要 markdown）。",
      '字段：{"name":"项目名(≤40字)","projectType":"software|business|ops|content|other","scope":"范围(≤300字)","goals":["目标1","目标2"],"techStackHints":["技术栈提示"],"risks":["风险"],"openQuestions":["需要老板拍板的问题"],"suggestedRepository":"可选的仓库地址或空","weeks":整数 2-12,"confidence":0-1}',
      "要求：不臆造事实；缺信息就写进 openQuestions；name 用中文短语；只输出 JSON。",
      `创意：${text.slice(0, 4000)}`,
    ].join("\n");
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.3,
          messages: [
            { role: "system", content: "只输出严格 JSON，不要解释。" },
            { role: "user", content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) return this.ruleAnalysis(text);
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content ?? "";
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (start < 0 || end <= start) return this.ruleAnalysis(text);
      const parsed = JSON.parse(content.slice(start, end + 1)) as Row;
      const fallback = this.ruleAnalysis(text);
      const asStringArray = (value: unknown, fallbackValue: string[]): string[] =>
        Array.isArray(value) && value.length > 0 ? value.map((item) => String(item).slice(0, 120)).slice(0, 8) : fallbackValue;
      return {
        name: String(parsed.name ?? fallback.name).slice(0, 60),
        projectType: ["software", "business", "ops", "content", "other"].includes(String(parsed.projectType)) ? String(parsed.projectType) : fallback.projectType,
        stage: DEFAULT_STAGE,
        scope: String(parsed.scope ?? fallback.scope).slice(0, 1200),
        goals: asStringArray(parsed.goals, fallback.goals),
        techStackHints: asStringArray(parsed.techStackHints, fallback.techStackHints),
        risks: asStringArray(parsed.risks, fallback.risks),
        openQuestions: asStringArray(parsed.openQuestions, fallback.openQuestions),
        suggestedRepository: typeof parsed.suggestedRepository === "string" && parsed.suggestedRepository.trim() !== "" ? parsed.suggestedRepository.trim() : null,
        weeks: clamp(Number(parsed.weeks) || fallback.weeks, 2, 12),
        confidence: clamp((Number(parsed.confidence) || 0.6) * 100, 20, 95) / 100,
        source: "ai",
        model: config.model,
        raw: parsed,
      };
    } catch {
      return this.ruleAnalysis(text);
    }
  }

  async save(projectId: number, idea: string, analysis: IdeaAnalysis, status: string, error: string | null = null): Promise<Row> {
    const result = await this.pool.query(
      `INSERT INTO stat.project_idea (project_id, idea, analysis, source, model, status, error)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7) RETURNING id, project_id, source, model, status, created_at`,
      [projectId, idea.slice(0, 4000), JSON.stringify(analysis), analysis.source, analysis.model ?? null, status, error],
    );
    await this.audit.record({ actor: "boss", action: "project.idea.create", result: "ok", objectType: "ProjectIdea", objectId: String((result.rows[0] as Row).id), payload: { projectId, source: analysis.source, confidence: analysis.confidence } });
    return result.rows[0] as Row;
  }

  async updateStatus(projectId: number, status: string, error: string | null = null): Promise<void> {
    await this.pool.query(
      "UPDATE stat.project_idea SET status = $2, error = $3 WHERE project_id = $1",
      [projectId, status, error],
    );
  }

  async list(projectId: number): Promise<Row[]> {
    const result = await this.pool.query("SELECT * FROM stat.project_idea WHERE project_id = $1 ORDER BY id DESC", [projectId]);
    return result.rows;
  }
}
