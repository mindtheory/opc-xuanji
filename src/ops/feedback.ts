/**
 * 运维闭环（SRS-001 REQ-OPS-001..003）：
 * 1) 运行错误自动去重登记，并通过 GitHub API 自动开 Issue（未配置凭据时只攒草稿）；
 * 2) 用量遥测：只记录动作与状态，不记录业务内容/敏感值；按天聚合供 AI 审视；
 * 3) AI 审视使用习惯：产出体验改进、需求缺口、工作流便捷化三类 Issue 草稿。
 *
 * 边界：GitHub 未配置 → 草稿留 pending/skipped，不影响主流程；Issue 去重 + 单轮/单日限额；
 * 默认不注入任何标签（避免 422），可用 OPC_GITHUB_LABELS 指定已存在的标签。
 */
import { createHash } from "node:crypto";
import type { Pool } from "../db/pool.ts";
import type { AuditService } from "../audit/audit.ts";
import { OpcError, ERR } from "../platform/errors.ts";

type Row = Record<string, unknown>;

const DEFAULT_REPO = "mindtheory/opc-xuanji";
const DEFAULT_API_BASE = "https://api.github.com";
const MAX_PER_RUN = 5;
const MAX_PER_DAY = 20;

const SECRET_LIKE = /(token|password|passwd|secret|api[_-]?key|authorization)\s*[:=]\s*\S+/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;

function scrub(text: string): string {
  return text.replace(SECRET_LIKE, "$1=***").replace(LONG_TOKEN, "***");
}

/** 错误消息：额外截断到 8 行，避免堆栈灌库。 */
function scrubMessage(text: string): string {
  return scrub(text).split("\n").slice(0, 8).join("\n").slice(0, 1500);
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface UsageEntry {
  channel?: "api" | "ui" | "task" | "tool";
  action: string;
  statusCode?: number | null;
  durationMs?: number | null;
  errorCode?: string | null;
  sessionRef?: string | null;
  meta?: Row | null;
}

export class UsageService {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /** 记录一条用量事件（只记动作/状态/耗时，不记请求体）。 */
  async record(entry: UsageEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO stat.usage_event (channel, action, status_code, duration_ms, error_code, session_ref, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        entry.channel ?? "api",
        entry.action.slice(0, 160),
        entry.statusCode ?? null,
        entry.durationMs ?? null,
        entry.errorCode ?? null,
        entry.sessionRef ?? null,
        entry.meta === undefined || entry.meta === null ? null : JSON.stringify(entry.meta).slice(0, 2000),
      ],
    );
  }

  async summary(days = 7): Promise<Row> {
    const window = Math.min(Math.max(days, 1), 90);
    const [totals, byAction, byDay, uiTabs] = await Promise.all([
      this.pool.query<{ total: number; errors: number; slow: number }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status_code >= 400)::int AS errors,
                count(*) FILTER (WHERE duration_ms > 1500)::int AS slow
         FROM stat.usage_event WHERE occurred_at > now() - ($1 || ' days')::interval`,
        [String(window)],
      ),
      this.pool.query(
        `SELECT action,
                count(*)::int AS calls,
                count(*) FILTER (WHERE status_code >= 400)::int AS errors,
                coalesce(round(avg(duration_ms))::int, 0) AS avg_ms,
                coalesce(max(duration_ms)::int, 0) AS max_ms
         FROM stat.usage_event
         WHERE occurred_at > now() - ($1 || ' days')::interval
         GROUP BY action ORDER BY calls DESC LIMIT 50`,
        [String(window)],
      ),
      this.pool.query(
        `SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day, count(*)::int AS calls
         FROM stat.usage_event WHERE occurred_at > now() - ($1 || ' days')::interval
         GROUP BY 1 ORDER BY 1`,
        [String(window)],
      ),
      this.pool.query(
        `SELECT action, count(*)::int AS calls FROM stat.usage_event
         WHERE channel = 'ui' AND occurred_at > now() - ($1 || ' days')::interval
         GROUP BY action ORDER BY calls DESC LIMIT 30`,
        [String(window)],
      ),
    ]);
    const total = totals.rows[0]?.total ?? 0;
    const errors = totals.rows[0]?.errors ?? 0;
    return {
      days: window,
      total,
      errors,
      slow: totals.rows[0]?.slow ?? 0,
      errorRate: total === 0 ? 0 : Math.round((errors / total) * 1000) / 10,
      byAction: byAction.rows,
      byDay: byDay.rows,
      uiTabs: uiTabs.rows,
    };
  }

  async listEvents(limit = 100): Promise<Row[]> {
    const capped = Math.min(Math.max(limit, 1), 500);
    const result = await this.pool.query(
      `SELECT id, channel, action, status_code, duration_ms, error_code, occurred_at
       FROM stat.usage_event ORDER BY id DESC LIMIT $1`,
      [capped],
    );
    return result.rows;
  }

  /** 规则/ AI 审视：产出体验、需求、工作流三类 Issue 草稿（pending，等 sync 去开）。 */
  async insightDrafts(days = 7): Promise<Row[]> {
    const summary = await this.summary(days);
    const drafts: Array<{ title: string; body: string; severity: string; source: "usage_insight" }> = [];
    const actions = summary.byAction as Array<{ action: string; calls: number; errors: number; avg_ms: number; max_ms: number }>;

    for (const item of actions) {
      const rate = item.calls === 0 ? 0 : Math.round((item.errors / item.calls) * 100) / 100;
      if (item.errors >= 3 && rate >= 0.2) {
        drafts.push({
          severity: "high",
          source: "usage_insight",
          title: `[体验] 高频失败操作：${item.action}（${item.errors}/${item.calls} 失败）`,
          body: `近 ${days} 天该操作失败率 ${Math.round(rate * 100)}%，建议优先排查错误码与交互反馈。\n\n- 动作：\`${item.action}\`\n- 调用 ${item.calls} 次 / 失败 ${item.errors} 次\n- 平均耗时 ${item.avg_ms}ms\n\n（由 OPC 用量审视自动生成，数据不含业务内容）`,
        });
      }
      if (item.avg_ms >= 1500) {
        drafts.push({
          severity: "medium",
          source: "usage_insight",
          title: `[性能] 慢操作：${item.action}（均 ${item.avg_ms}ms / 峰 ${item.max_ms}ms）`,
          body: `近 ${days} 天该操作平均耗时 ${item.avg_ms}ms、峰值 ${item.max_ms}ms，建议优化或加缓存/异步。\n\n- 动作：\`${item.action}\`\n- 调用 ${item.calls} 次\n\n（由 OPC 用量审视自动生成）`,
        });
      }
    }

    const tabs = summary.uiTabs as Array<{ action: string; calls: number }>;
    const totalUi = tabs.reduce((sum, item) => sum + item.calls, 0);
    if (totalUi >= 10) {
      const known = ["cockpit", "domains", "employees", "projects", "autopilot", "workflows", "tasks", "audits", "conflicts", "inbox", "memory", "hindsight", "radar", "intel", "settings"];
      const used = new Set(tabs.map((item) => item.action.replace(/^ui\.tab\./, "")));
      const unused = known.filter((tab) => !used.has(tab));
      if (unused.length > 0) {
        drafts.push({
          severity: "low",
          source: "usage_insight",
          title: `[需求] 低频/未使用页签：${unused.join("、")}`,
          body: `近 ${days} 天这些页签没有访问记录，可能是入口过深、价值不足或可以合并：${unused.join("、")}。\n\n建议评估：合并入口、加引导或补默认数据。\n\n（由 OPC 用量审视自动生成）`,
        });
      }
    }

    const ai = await this.aiDrafts(summary, days);
    drafts.push(...ai);

    const created: Row[] = [];
    for (const draft of drafts) {
      const fingerprint = sha(`usage_insight:${draft.title}`);
      const row = await this.pool.query(
        `INSERT INTO stat.issue_filing (fingerprint, source, title, body, severity, status)
         VALUES ($1,'usage_insight',$2,$3,$4,'pending')
         ON CONFLICT (fingerprint) DO NOTHING RETURNING id, title, severity, status`,
        [fingerprint, draft.title.slice(0, 250), scrub(draft.body), draft.severity],
      );
      if (row.rows.length > 0) created.push(row.rows[0] as Row);
    }
    return created;
  }

  /** AI 审视（可关闭/未配置则跳过）：OpenAI 兼容端点，只发送聚合统计，不发送业务内容。 */
  private async aiDrafts(summary: Row, days: number): Promise<Array<{ title: string; body: string; severity: string; source: "usage_insight" }>> {
    if (process.env.OPC_AI_DISABLED === "1") return [];
    const apiKey = process.env.OPC_AI_API_KEY ?? process.env.DEEPSEEK_API_KEY;
    if (apiKey === undefined || apiKey.trim() === "") return [];
    const baseUrl = (process.env.OPC_AI_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, "");
    const model = process.env.OPC_AI_MODEL ?? "deepseek-chat";
    const payload = {
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: "你是 OPC-玄机 的产品体验分析师。只输出 JSON 数组，每项含 title/body/severity（low|medium|high）。title 前缀用 [体验]/[需求]/[流程] 之一。" },
        { role: "user", content: `近 ${days} 天用量聚合（不含业务内容）：\n${JSON.stringify(summary).slice(0, 4000)}\n\n请给出 3-5 条可执行的改进建议（体验、需求缺口、更便捷的工作流）。` },
      ],
    };
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content ?? "";
      const start = text.indexOf("[");
      const end = text.lastIndexOf("]");
      if (start < 0 || end <= start) return [];
      const parsed = JSON.parse(text.slice(start, end + 1)) as Array<{ title?: string; body?: string; severity?: string }>;
      return parsed
        .filter((item) => typeof item.title === "string" && item.title.trim() !== "")
        .slice(0, 5)
        .map((item) => ({
          title: String(item.title).slice(0, 200),
          body: scrub(String(item.body ?? "")),
          severity: ["low", "medium", "high"].includes(String(item.severity)) ? String(item.severity) : "medium",
          source: "usage_insight" as const,
        }));
    } catch {
      return [];
    }
  }
}

export class IssueReporter {
  private readonly pool: Pool;
  private readonly audit: AuditService;

  constructor(pool: Pool, audit: AuditService) {
    this.pool = pool;
    this.audit = audit;
  }

  config(): { token: string; repo: string; apiBase: string; labels: string[]; maxPerRun: number } {
    return {
      token: (process.env.OPC_GITHUB_TOKEN ?? "").trim(),
      repo: (process.env.OPC_GITHUB_REPO ?? DEFAULT_REPO).trim(),
      apiBase: (process.env.OPC_GITHUB_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, ""),
      labels: (process.env.OPC_GITHUB_LABELS ?? "").split(",").map((item) => item.trim()).filter((item) => item !== ""),
      maxPerRun: Math.min(Math.max(Number(process.env.OPC_GITHUB_MAX_PER_RUN ?? MAX_PER_RUN) || MAX_PER_RUN, 1), 20),
    };
  }

  /** 运行错误去重登记（同指纹累加次数，不落敏感值）。 */
  async recordRuntimeError(input: { method?: string; route: string; statusCode: number; errorCode?: string | null; message: string }): Promise<Row> {
    const clean = scrubMessage(input.message).slice(0, 1000);
    const fingerprint = sha(`${input.method ?? ""}|${input.route}|${input.errorCode ?? ""}|${clean.slice(0, 120)}`);
    const result = await this.pool.query(
      `INSERT INTO stat.runtime_error (fingerprint, method, route, status_code, error_code, message)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (fingerprint) DO UPDATE SET occurrences = stat.runtime_error.occurrences + 1, last_seen = now()
       RETURNING id, fingerprint, occurrences`,
      [fingerprint, input.method ?? null, input.route.slice(0, 200), input.statusCode, input.errorCode ?? null, clean],
    );
    return result.rows[0] as Row;
  }

  /** 把未上报的运行错误转成 Issue 草稿（再统一 sync 到 GitHub）。 */
  async stageRuntimeErrors(): Promise<number> {
    const rows = await this.pool.query(
      `SELECT * FROM stat.runtime_error
       WHERE filed_issue_id IS NULL AND last_seen > now() - interval '30 days'
       ORDER BY occurrences DESC, last_seen DESC LIMIT 20`,
    );
    let staged = 0;
    for (const row of rows.rows as Row[]) {
      const fingerprint = `runtime_error:${String(row.fingerprint)}`;
      const title = `[运行错误] ${String(row.method ?? "?")} ${String(row.route ?? "")}（${String(row.error_code ?? row.status_code)}）`;
      const body = [
        "自动登记自 OPC-玄机 运行错误。",
        "",
        `- 指纹：\`${String(row.fingerprint).slice(0, 12)}\``,
        `- 接口：\`${String(row.method ?? "")} ${String(row.route ?? "")}\``,
        `- HTTP 状态：${String(row.status_code ?? "")} / 错误码：${String(row.error_code ?? "-")}`,
        `- 累计次数：${String(row.occurrences)}`,
        `- 首次：${String(row.first_seen)} / 最近：${String(row.last_seen)}`,
        "",
        "```",
        String(row.message ?? "").slice(0, 800),
        "```",
      ].join("\n");
      const inserted = await this.pool.query(
        `INSERT INTO stat.issue_filing (fingerprint, source, title, body, severity, status)
         VALUES ($1,'runtime_error',$2,$3,'high','pending')
         ON CONFLICT (fingerprint) DO NOTHING RETURNING id`,
        [sha(fingerprint), title.slice(0, 250), scrub(body)],
      );
      if (inserted.rows.length > 0) {
        staged += 1;
        await this.pool.query("UPDATE stat.runtime_error SET filed_issue_id = $1 WHERE id = $2", [(inserted.rows[0] as Row).id, row.id]);
      } else {
        await this.pool.query("UPDATE stat.runtime_error SET filed_issue_id = (SELECT id FROM stat.issue_filing WHERE fingerprint = $1) WHERE id = $2", [sha(fingerprint), row.id]);
      }
    }
    return staged;
  }

  /** 把 pending 草稿投递到 GitHub（限额 + 去重）；未配置 token 时标 skipped。 */
  async sync(): Promise<Row> {
    const config = this.config();
    const staged = await this.stageRuntimeErrors();
    const pending = await this.pool.query(
      `SELECT id, fingerprint, source, title, body, severity FROM stat.issue_filing
       WHERE status IN ('pending','skipped') OR (status = 'failed' AND attempts < 3)
       ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id LIMIT $1`,
      [config.maxPerRun],
    );
    if (pending.rows.length === 0) return { staged, filed: 0, failed: 0, skipped: 0, note: "没有待投递草稿" };
    if (config.token === "") {
      for (const row of pending.rows as Row[]) {
        await this.pool.query("UPDATE stat.issue_filing SET status = 'skipped', error = $2, attempts = attempts + 1 WHERE id = $1", [row.id, "未配置 OPC_GITHUB_TOKEN"]);
      }
      await this.audit.record({ actor: "boss", action: "issue.sync.skipped", result: "ok", objectType: "IssueFiling", objectId: String(pending.rows.length), payload: { reason: "no-token" } });
      return { staged, filed: 0, failed: 0, skipped: pending.rows.length, note: "未配置 OPC_GITHUB_TOKEN，草稿保留" };
    }
    const today = await this.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM stat.issue_filing WHERE status = 'filed' AND filed_at > now() - interval '1 day'",
    );
    if ((today.rows[0]?.n ?? 0) >= MAX_PER_DAY) {
      return { staged, filed: 0, failed: 0, skipped: 0, note: `达到单日上限 ${MAX_PER_DAY}` };
    }
    let filed = 0;
    let failed = 0;
    for (const row of pending.rows as Row[]) {
      try {
        const response = await fetch(`${config.apiBase}/repos/${config.repo}/issues`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/vnd.github+json",
            authorization: `Bearer ${config.token}`,
            "user-agent": "opc-xuanji-autofile",
          },
          body: JSON.stringify({ title: String(row.title), body: String(row.body), ...(config.labels.length > 0 ? { labels: config.labels } : {}) }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`GitHub ${response.status}: ${text.slice(0, 200)}`);
        }
        const data = (await response.json()) as { number?: number; html_url?: string };
        await this.pool.query(
          "UPDATE stat.issue_filing SET status = 'filed', github_number = $2, github_url = $3, filed_at = now(), attempts = attempts + 1, error = NULL WHERE id = $1",
          [row.id, data.number ?? null, data.html_url ?? null],
        );
        filed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.pool.query(
          "UPDATE stat.issue_filing SET status = 'failed', error = $2, attempts = attempts + 1 WHERE id = $1",
          [row.id, scrub(message).slice(0, 500)],
        );
        failed += 1;
      }
    }
    await this.audit.record({ actor: "boss", action: "issue.sync", result: failed > 0 ? "error" : "ok", objectType: "IssueFiling", objectId: String(filed), payload: { staged, filed, failed } });
    return { staged, filed, failed, skipped: 0 };
  }

  async listIssues(status: string | null = null, limit = 50): Promise<Row[]> {
    const capped = Math.min(Math.max(limit, 1), 200);
    const result = await this.pool.query(
      `SELECT id, fingerprint, source, title, severity, status, github_number, github_url, error, attempts, created_at, filed_at
       FROM stat.issue_filing WHERE ($1::text IS NULL OR status = $1) ORDER BY id DESC LIMIT $2`,
      [status, capped],
    );
    return result.rows;
  }

  async listRuntimeErrors(limit = 50): Promise<Row[]> {
    const capped = Math.min(Math.max(limit, 1), 200);
    const result = await this.pool.query(
      `SELECT id, method, route, status_code, error_code, message, occurrences, first_seen, last_seen, filed_issue_id
       FROM stat.runtime_error ORDER BY last_seen DESC LIMIT $1`,
      [capped],
    );
    return result.rows;
  }
}

export function opsError(message: string, status = 400): OpcError {
  return new OpcError(ERR.OPS_INVALID, message, status);
}
