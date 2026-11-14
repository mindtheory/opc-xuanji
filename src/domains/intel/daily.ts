/**
 * 情报日报流水线（本地可执行部分）：采集入库 → 规则分析/去重评分 → 汇总 → 生成简报 → 推送。
 *
 * 边界：
 * - 外部采集适配器不在本文件内实现；任务可接收采集器产出的 intelItems，未配置适配器时
 *   把来源标记为 blocked，绝不伪造条目。
 * - 分析只做可解释的关键词/标签匹配，不把推断写成事实；信息类型缺省为 unknown。
 * - 简报按 (项目, 日期, 类型, 版本) 版本化；已推送版本不覆盖。
 * - 推送外部渠道未配置时落 inapp 站内记录并标注“外部渠道未送达”。
 */
import { createHash } from "node:crypto";
import type { Pool } from "../../db/pool.ts";
import { partsInZone } from "../../scheduler/cron.ts";

export interface WatchRule {
  keyword: string;
  matchType: "exact" | "phrase" | "regex" | "boolean";
  synonyms: string[];
  excludeTerms: string[];
  tags: string[];
  priority: number;
}

export interface ScoreInput {
  title: string;
  summary?: string | null;
  tags?: string[];
  tagNames?: string[];
  infoType?: string | null;
  riskLevel?: string | null;
  sourceCredibility?: number | null;
}

export interface ScoreResult {
  matchedKeywords: string[];
  matchedTags: string[];
  excludedBy: string[];
  score: number;
  reason: string;
}

export interface RawIntelItem {
  projectId?: number;
  sourceId?: number;
  externalId?: string;
  url?: string;
  title: string;
  summary?: string;
  publishedAt?: string;
  author?: string;
  language?: string;
  tags?: string[];
  entities?: Record<string, unknown>;
  sentiment?: string;
  infoType?: string;
  riskLevel?: string;
  confidence?: number;
}

export interface IntelScope {
  projectId: number;
  name: string;
  timezone: string;
  briefTime: string;
  lookbackHours: number;
  maxItems: number;
  pushChannels: Array<{ channel: string; target: string }>;
  quietHours: { start: string; end: string } | null;
  template: string | null;
}

export interface CollectResult {
  projects: number;
  sourcesDue: number;
  inserted: number;
  duplicates: number;
  blocked: number;
  skipped: number;
}

export interface BriefResult {
  projectId: number;
  briefId: number | null;
  itemCount: number;
  version: number | null;
  skipped: boolean;
}

interface ItemRow {
  id: number;
  project_id: number;
  source_id: number | null;
  title: string;
  summary: string | null;
  url: string | null;
  tags: string[] | null;
  info_type: string | null;
  risk_level: string | null;
  confidence: string | null;
  credibility: string | null;
  relevance_score: string | null;
  published_at: Date | null;
  source_name: string | null;
  sentiment: string | null;
}

const pad = (value: number): string => String(value).padStart(2, "0");

let forceSeq = 0;

function forceKey(options: { force?: boolean }): string {
  if (options.force !== true) return "";
  forceSeq += 1;
  return `:f${Date.now()}:${forceSeq}`;
}

/** 指定时区的日历日（YYYY-MM-DD）。 */
export function localDate(now: Date, timeZone: string): string {
  const parts = partsInZone(now, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** 指定时区的本地时刻（HH:MM）。 */
export function localTime(now: Date, timeZone: string): string {
  const parts = partsInZone(now, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

function textOf(input: ScoreInput): string {
  return `${input.title} ${input.summary ?? ""}`.toLowerCase();
}

function hit(rule: WatchRule, text: string): boolean {
  const alternatives = [rule.keyword, ...rule.synonyms].filter((value) => value.trim() !== "");
  if (rule.matchType === "regex") {
    for (const alternative of alternatives) {
      try {
        if (new RegExp(alternative, "i").test(text)) return true;
      } catch {
        // 非法正则视为未命中，由上层标注规则错误
      }
    }
    return false;
  }
  if (rule.matchType === "boolean") {
    return alternatives.some((alternative) =>
      alternative
        .split("|")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
        .some((part) => text.includes(part)),
    );
  }
  return alternatives.some((alternative) => text.includes(alternative.toLowerCase()));
}

/** 可解释评分：只返回规则命中结果，不做事实判断。 */
export function scoreIntelItem(rules: WatchRule[], input: ScoreInput): ScoreResult {
  const text = textOf(input);
  const matchedKeywords: string[] = [];
  const matchedTags = new Set<string>();
  const excludedBy: string[] = [];
  let priorityScore = 0;

  for (const rule of rules) {
    for (const term of rule.excludeTerms) {
      if (term.trim() !== "" && text.includes(term.toLowerCase())) excludedBy.push(term);
    }
    if (!hit(rule, text)) continue;
    matchedKeywords.push(rule.keyword);
    priorityScore += rule.priority;
    for (const tag of rule.tags) matchedTags.add(tag);
  }

  const availableTags = new Set([...(input.tagNames ?? []), ...(input.tags ?? [])]);
  for (const tag of input.tags ?? []) {
    if (availableTags.has(tag)) matchedTags.add(tag);
  }

  const riskBoost = input.riskLevel === "critical" ? 25 : input.riskLevel === "high" ? 15 : input.riskLevel === "medium" ? 5 : 0;
  const tagScore = Math.min(matchedTags.size * 5, 20);
  const base = matchedKeywords.length > 0 ? 25 : 0;
  const rawScore = base + Math.min(priorityScore, 40) + tagScore + riskBoost;
  const score = excludedBy.length > 0 ? 0 : Math.min(100, Math.round(rawScore * 100) / 100);
  const reason =
    excludedBy.length > 0
      ? `命中排除词：${excludedBy.join("、")}`
      : matchedKeywords.length > 0 || matchedTags.size > 0
        ? `命中关键词 ${matchedKeywords.length} 个、标签 ${matchedTags.size} 个`
        : "未命中关键词/标签";

  return { matchedKeywords, matchedTags: [...matchedTags], excludedBy, score, reason };
}

function hashOf(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseChannels(value: unknown): Array<{ channel: string; target: string }> {
  if (!Array.isArray(value) || value.length === 0) return [{ channel: "inapp", target: "owner" }];
  const output: Array<{ channel: string; target: string }> = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() !== "") output.push({ channel: entry.trim(), target: "owner" });
    else if (entry !== null && typeof entry === "object") {
      const item = entry as { channel?: unknown; target?: unknown };
      if (typeof item.channel === "string" && item.channel.trim() !== "") {
        output.push({ channel: item.channel.trim(), target: typeof item.target === "string" ? item.target : "owner" });
      }
    }
  }
  // 外部渠道不可用时必须有站内兜底，不能静默丢简报。
  if (!output.some((item) => item.channel === "inapp")) output.push({ channel: "inapp", target: "owner" });
  return output.length > 0 ? output : [{ channel: "inapp", target: "owner" }];
}

function parseQuietHours(value: unknown): { start: string; end: string } | null {
  if (value === null || typeof value !== "object") return null;
  const item = value as { start?: unknown; end?: unknown };
  if (typeof item.start !== "string" || typeof item.end !== "string") return null;
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(item.start) || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(item.end)) return null;
  return { start: item.start, end: item.end };
}

function inQuietHours(now: Date, timeZone: string, quiet: { start: string; end: string } | null): boolean {
  if (quiet === null) return false;
  const current = localTime(now, timeZone);
  if (quiet.start <= quiet.end) return current >= quiet.start && current < quiet.end;
  return current >= quiet.start || current < quiet.end;
}

function hasUrgent(sections: unknown): boolean {
  if (sections === null || typeof sections !== "object") return false;
  const risk = (sections as { risk?: unknown }).risk;
  if (Array.isArray(risk) && risk.length > 0) return true;
  const headline = (sections as { headline?: unknown }).headline;
  return Array.isArray(headline) && headline.some((entry) => {
    if (entry === null || typeof entry !== "object") return false;
    const level = (entry as { riskLevel?: unknown }).riskLevel;
    return level === "high" || level === "critical";
  });
}

function sectionOf(item: ItemRow): string {
  const tags = (item.tags ?? []).map((tag) => String(tag)).join(",");
  if (/政策|监管|policy|regulation/i.test(tags)) return "policy";
  if (/竞品|竞争|competitor/i.test(tags)) return "competitor";
  if (/线索|商机|lead/i.test(tags)) return "lead";
  if (/供应商|交易对手|supplier/i.test(tags) || item.risk_level === "high" || item.risk_level === "critical") return "risk";
  if (/舆情|sentiment/i.test(tags)) return "sentiment";
  return "other";
}

export class IntelPipelineService {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async scopes(projectId?: number): Promise<IntelScope[]> {
    const rows = await this.pool.query<{
      project_id: number;
      name: string;
      timezone: string;
      brief_time: string;
      lookback_hours: number;
      max_items: number;
      push_channels: unknown;
      quiet_hours: unknown;
      template: string | null;
    }>(
      `SELECT project_id, name, timezone, brief_time, lookback_hours, max_items, push_channels, quiet_hours, template
       FROM biz.intel_project_scope
       WHERE status = 'active' AND ($1::bigint IS NULL OR project_id = $1)
       ORDER BY project_id`,
      [projectId ?? null],
    );
    return rows.rows.map((row) => ({
      projectId: Number(row.project_id),
      name: row.name,
      timezone: row.timezone,
      briefTime: row.brief_time,
      lookbackHours: row.lookback_hours,
      maxItems: row.max_items,
      pushChannels: parseChannels(row.push_channels),
      quietHours: parseQuietHours(row.quiet_hours),
      template: row.template,
    }));
  }

  private async pipelineRun(
    projectId: number,
    date: string,
    stage: string,
    key: string,
    fn: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown> | null> {
    const inserted = await this.pool.query<{ id: number }>(
      `INSERT INTO stat.intel_pipeline_run (project_id, pipeline_date, stage, status, idempotency_key)
       VALUES ($1, $2, $3, 'running', $4)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [projectId, date, stage, key],
    );
    const id = inserted.rows[0]?.id;
    if (id === undefined) return null;
    try {
      const counters = await fn();
      await this.pool.query(
        "UPDATE stat.intel_pipeline_run SET status = 'ok', counters = $1::jsonb, ended_at = now() WHERE id = $2",
        [JSON.stringify(counters), id],
      );
      return counters;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.pool.query("UPDATE stat.intel_pipeline_run SET status = 'failed', error = $1, ended_at = now() WHERE id = $2", [
        message,
        id,
      ]);
      throw error;
    }
  }

  /** 采集阶段：摄取采集器产出；未配置适配器的到期来源标 blocked，不生成条目。 */
  async collectAll(now: Date, rawItems: RawIntelItem[] = [], options: { force?: boolean; projectId?: number } = {}): Promise<CollectResult> {
    const scopes = await this.scopes(options.projectId);
    const result: CollectResult = { projects: scopes.length, sourcesDue: 0, inserted: 0, duplicates: 0, blocked: 0, skipped: 0 };
    for (const scope of scopes) {
      const date = localDate(now, scope.timezone);
      const collectSlot = Math.floor(now.getTime() / 1_800_000);
      const stageKey = `collect:${scope.projectId}:${collectSlot}${forceKey(options)}`;
      const counters = await this.pipelineRun(scope.projectId, date, "collect", stageKey, async () => {
        const projectItems = rawItems.filter((item) => item.projectId === scope.projectId);
        for (const item of projectItems) {
          const ingested = await this.ingest(scope.projectId, item, now);
          result.inserted += ingested.inserted;
          result.duplicates += ingested.duplicates;
        }
        const due = await this.dueSources(scope.projectId, now);
        result.sourcesDue += due.length;
        for (const source of due) {
          const slot = Math.floor(now.getTime() / (source.intervalMinutes * 60_000));
          const key = `collect:${source.id}:${slot}${forceKey(options)}`;
          const run = await this.pool.query<{ id: number }>(
            `INSERT INTO stat.intel_collect_run (source_id, project_id, idempotency_key, status, checkpoint_before)
             VALUES ($1,$2,$3,'running',$4::jsonb)
             ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
            [source.id, scope.projectId, key, JSON.stringify(source.checkpoint ?? null)],
          );
          const runId = run.rows[0]?.id;
          if (runId === undefined) {
            result.skipped += 1;
            continue;
          }
          const sourceItems = rawItems.filter((item) => item.sourceId === source.id);
          if (sourceItems.length === 0) {
            result.blocked += 1;
            await this.pool.query(
              `UPDATE stat.intel_collect_run SET status = 'blocked', ended_at = now(),
                 error = '未配置采集适配器，本次未采集' WHERE id = $1`,
              [runId],
            );
            await this.pool.query(
              `UPDATE biz.source SET last_failure_at = $1,
                 consecutive_failures = consecutive_failures + 1,
                 last_error = '未配置采集适配器，本次未采集',
                 status = CASE WHEN consecutive_failures + 1 >= 3 THEN 'blocked' ELSE status END
               WHERE id = $2`,
              [now, source.id],
            );
            continue;
          }
          await this.pool.query(
            `UPDATE stat.intel_collect_run SET status = 'ok', ended_at = now(),
               fetched = $1, inserted = $1, checkpoint_after = $2::jsonb WHERE id = $3`,
            [sourceItems.length, JSON.stringify(source.checkpoint ?? null), runId],
          );
          await this.pool.query(
            `UPDATE biz.source SET last_success_at = $1, consecutive_failures = 0, last_error = NULL WHERE id = $2`,
            [now, source.id],
          );
        }
        return { inserted: result.inserted, duplicates: result.duplicates, sourcesDue: due.length, blocked: result.blocked };
      });
      if (counters === null) result.skipped += 1;
    }
    return result;
  }

  private async dueSources(
    projectId: number,
    now: Date,
  ): Promise<Array<{ id: number; intervalMinutes: number; checkpoint: unknown; credibility: string | null }>> {
    const rows = await this.pool.query<{
      id: number;
      collect_interval_minutes: number;
      checkpoint: unknown;
      credibility: string | null;
    }>(
      `SELECT s.id, s.collect_interval_minutes, s.checkpoint, s.credibility
       FROM biz.source s
       JOIN biz.source_binding b ON b.source_id = s.id
       WHERE b.project_id = $1 AND b.enabled AND s.enabled AND s.status = 'active'
         AND (s.last_success_at IS NULL
              OR s.last_success_at + make_interval(mins => s.collect_interval_minutes) <= $2)
       ORDER BY b.priority, s.id`,
      [projectId, now],
    );
    return rows.rows.map((row) => ({
      id: Number(row.id),
      intervalMinutes: row.collect_interval_minutes,
      checkpoint: row.checkpoint,
      credibility: row.credibility,
    }));
  }

  private async ingest(projectId: number, item: RawIntelItem, now: Date): Promise<{ inserted: number; duplicates: number }> {
    const title = item.title?.trim() ?? "";
    if (title === "") return { inserted: 0, duplicates: 0 };
    if (item.sourceId === undefined && (item.url ?? "").trim() === "") return { inserted: 0, duplicates: 0 };
    const contentHash = hashOf(`${title}\n${item.summary ?? ""}\n${item.url ?? ""}`);
    const idempotencyKey = item.externalId
      ? `src:${item.sourceId ?? "manual"}:${item.externalId}`
      : `hash:${contentHash}`;
    const result = await this.pool.query<{ id: number }>(
      `INSERT INTO biz.intel_item
         (project_id, source_id, external_id, url, title, summary, content_hash, language, author,
          published_at, collected_at, entities, tags, sentiment, info_type, risk_level, confidence,
          status, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,'collected',$18)
       ON CONFLICT (project_id, idempotency_key) DO NOTHING RETURNING id`,
      [
        projectId,
        item.sourceId ?? null,
        item.externalId ?? null,
        item.url ?? null,
        title,
        item.summary ?? null,
        contentHash,
        item.language ?? null,
        item.author ?? null,
        item.publishedAt ?? null,
        now,
        JSON.stringify(item.entities ?? {}),
        JSON.stringify(item.tags ?? []),
        item.sentiment ?? "unknown",
        item.infoType ?? "unknown",
        item.riskLevel ?? "unknown",
        item.confidence ?? null,
        idempotencyKey,
      ],
    );
    return result.rows[0] === undefined ? { inserted: 0, duplicates: 1 } : { inserted: 1, duplicates: 0 };
  }

  /** 分析阶段：按项目关键词/标签评分、去重标记；只输出可解释结果。 */
  async analyze(now: Date, options: { force?: boolean; projectId?: number } = {}): Promise<{ projects: number; analyzed: number; filtered: number }> {
    const scopes = await this.scopes(options.projectId);
    let analyzed = 0;
    let filtered = 0;
    for (const scope of scopes) {
      const date = localDate(now, scope.timezone);
      const hourSlot = `${date}:${partsInZone(now, scope.timezone).hour}`;
      const key = `analyze:${scope.projectId}:${hourSlot}${forceKey(options)}`;
      const counters = await this.pipelineRun(scope.projectId, date, "analyze", key, async () => {
        const local = await this.analyzeProject(scope, now);
        analyzed += local.analyzed;
        filtered += local.filtered;
        return local;
      });
      if (counters === null) continue;
    }
    return { projects: scopes.length, analyzed, filtered };
  }

  private async analyzeProject(scope: IntelScope, now: Date): Promise<{ analyzed: number; filtered: number }> {
    const rules = await this.pool.query<{
      keyword: string;
      match_type: WatchRule["matchType"];
      synonyms: string[] | null;
      exclude_terms: string[] | null;
      tags: string[] | null;
      priority: number;
    }>(
      `SELECT keyword, match_type, synonyms, exclude_terms, tags, priority
       FROM biz.watch_topic WHERE project_id = $1 AND enabled ORDER BY priority DESC, id`,
      [scope.projectId],
    );
    const tagRows = await this.pool.query<{ name: string }>(
      "SELECT name FROM biz.intel_tag WHERE project_id = $1 AND status = 'active'",
      [scope.projectId],
    );
    const rulesList: WatchRule[] = rules.rows.map((row) => ({
      keyword: row.keyword,
      matchType: row.match_type,
      synonyms: row.synonyms ?? [],
      excludeTerms: row.exclude_terms ?? [],
      tags: row.tags ?? [],
      priority: row.priority,
    }));
    const tagNames = tagRows.rows.map((row) => row.name);
    const since = new Date(now.getTime() - scope.lookbackHours * 3_600_000);
    const rows = await this.pool.query<ItemRow>(
      `SELECT i.id, i.project_id, i.source_id, i.title, i.summary, i.url, i.tags, i.info_type,
              i.risk_level, i.confidence, s.credibility
       FROM biz.intel_item i
       LEFT JOIN biz.source s ON s.id = i.source_id
       WHERE i.project_id = $1 AND i.status = 'collected'
         AND coalesce(i.published_at, i.collected_at) >= $2
       ORDER BY i.id LIMIT 500`,
      [scope.projectId, since],
    );
    let analyzed = 0;
    let filtered = 0;
    for (const item of rows.rows) {
      const score = scoreIntelItem(rulesList, {
        title: item.title,
        summary: item.summary,
        tags: item.tags ?? [],
        tagNames,
        infoType: item.info_type,
        riskLevel: item.risk_level,
        sourceCredibility: toNumber(item.credibility),
      });
      const status = score.excludedBy.length > 0 ? "filtered" : "analyzed";
      if (status === "filtered") filtered += 1;
      else analyzed += 1;
      const confidence = toNumber(item.confidence) ?? toNumber(item.credibility) ?? 0.5;
      await this.pool.query(
        `UPDATE biz.intel_item SET relevance_score = $1, tags = $2::jsonb, info_type = coalesce(info_type, 'unknown'),
           risk_level = coalesce(risk_level, 'unknown'), sentiment = coalesce(sentiment, 'unknown'),
           confidence = $3, status = $4, analysis = $5::jsonb WHERE id = $6`,
        [
          score.score,
          JSON.stringify(score.matchedTags),
          confidence,
          status,
          JSON.stringify({ ruleVersion: "intel-score-v1", ...score, analyzedAt: now.toISOString() }),
          item.id,
        ],
      );
    }
    return { analyzed, filtered };
  }

  /** 汇总阶段：只统计本轮窗口内的条目状态，作为简报覆盖度依据。 */
  async aggregate(now: Date, options: { force?: boolean; projectId?: number } = {}): Promise<{ projects: number; items: number }> {
    const scopes = await this.scopes(options.projectId);
    let items = 0;
    for (const scope of scopes) {
      const date = localDate(now, scope.timezone);
      const key = `aggregate:${scope.projectId}:${date}${forceKey(options)}`;
      const counters = await this.pipelineRun(scope.projectId, date, "aggregate", key, async () => {
        const since = new Date(now.getTime() - scope.lookbackHours * 3_600_000);
        const rows = await this.pool.query<{ status: string; n: number }>(
          `SELECT status, count(*)::int AS n FROM biz.intel_item
           WHERE project_id = $1 AND coalesce(published_at, collected_at) >= $2 GROUP BY status`,
          [scope.projectId, since],
        );
        const byStatus: Record<string, number> = {};
        for (const row of rows.rows) byStatus[row.status] = row.n;
        items += rows.rows.reduce((sum, row) => sum + row.n, 0);
        return { byStatus };
      });
      if (counters === null) continue;
    }
    return { projects: scopes.length, items };
  }

  /** 简报阶段：按项目本地 brief_time 到点生成；同日已存在则跳过，重跑另起版本。 */
  async buildBriefs(now: Date, options: { force?: boolean; projectId?: number } = {}): Promise<BriefResult[]> {
    const scopes = await this.scopes(options.projectId);
    const output: BriefResult[] = [];
    for (const scope of scopes) {
      const date = localDate(now, scope.timezone);
      if (!options.force && localTime(now, scope.timezone) < scope.briefTime) {
        output.push({ projectId: scope.projectId, briefId: null, itemCount: 0, version: null, skipped: true });
        continue;
      }
      const key = `brief:${scope.projectId}:${date}${forceKey(options)}`;
      const counters = await this.pipelineRun(scope.projectId, date, "brief", key, async () => {
        return (await this.buildProjectBrief(scope, now, date)) as unknown as Record<string, unknown>;
      });
      if (counters === null) {
        output.push({ projectId: scope.projectId, briefId: null, itemCount: 0, version: null, skipped: true });
        continue;
      }
      output.push({
        projectId: scope.projectId,
        briefId: Number(counters.briefId ?? 0) || null,
        itemCount: Number(counters.itemCount ?? 0),
        version: Number(counters.version ?? 0) || null,
        skipped: counters.skipped === true,
      });
    }
    return output;
  }

  private async buildProjectBrief(scope: IntelScope, now: Date, date: string): Promise<object> {
    const existing = await this.pool.query<{ version: number }>(
      `SELECT max(version)::int AS version FROM biz.intel_brief
       WHERE project_id = $1 AND brief_date = $2 AND brief_type = 'daily'`,
      [scope.projectId, date],
    );
    const version = (existing.rows[0]?.version ?? 0) + 1;
    const since = new Date(now.getTime() - scope.lookbackHours * 3_600_000);
    const rows = await this.pool.query<ItemRow>(
      `SELECT i.id, i.project_id, i.source_id, i.title, i.summary, i.url, i.tags, i.info_type,
              i.risk_level, i.confidence, i.relevance_score, i.published_at, i.sentiment,
              s.name AS source_name, s.credibility
       FROM biz.intel_item i
       LEFT JOIN biz.source s ON s.id = i.source_id
       WHERE i.project_id = $1 AND i.status IN ('analyzed','briefed')
         AND coalesce(i.published_at, i.collected_at) >= $2
       ORDER BY i.relevance_score DESC NULLS LAST, i.published_at DESC NULLS LAST
       LIMIT $3`,
      [scope.projectId, since, scope.maxItems],
    );
    const sections: Record<string, Array<Record<string, unknown>>> = {
      headline: [],
      policy: [],
      competitor: [],
      lead: [],
      risk: [],
      sentiment: [],
      other: [],
    };
    const itemIds: number[] = [];
    const sources = new Set<number>();
    for (const item of rows.rows) {
      const section = sectionOf(item);
      const entry = {
        id: item.id,
        title: item.title,
        summary: item.summary,
        url: item.url,
        sourceId: item.source_id,
        sourceName: item.source_name,
        publishedAt: item.published_at?.toISOString() ?? null,
        score: toNumber(item.relevance_score),
        tags: item.tags ?? [],
        riskLevel: item.risk_level,
        infoType: item.info_type,
        confidence: toNumber(item.confidence),
        sentiment: item.sentiment,
        impact: item.risk_level === "critical" || item.risk_level === "high" ? "需优先关注" : "常规关注",
      };
      if (sections.headline.length < 3) sections.headline.push(entry);
      sections[section].push(entry);
      itemIds.push(item.id);
      if (item.source_id !== null) sources.add(item.source_id);
    }
    const collect = await this.pool.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM stat.intel_collect_run
       WHERE project_id = $1 AND started_at >= $2 GROUP BY status`,
      [scope.projectId, since],
    );
    const collectStats: Record<string, number> = {};
    for (const row of collect.rows) collectStats[row.status] = row.n;
    const gaps: string[] = [];
    if (itemIds.length === 0) gaps.push("本期无合格新增条目");
    if ((collectStats.failed ?? 0) > 0) gaps.push(`采集失败 ${collectStats.failed} 次`);
    if ((collectStats.blocked ?? 0) > 0) gaps.push(`来源未配置适配器 ${collectStats.blocked} 次`);
    const coverage = {
      lookbackHours: scope.lookbackHours,
      sourceCount: sources.size,
      itemCount: itemIds.length,
      collect: collectStats,
      gaps,
      disclaimer: "情报为事实汇总与规则命中结果，不构成投资/法律意见；未检索项不代表不存在。",
    };
    const inserted = await this.pool.query<{ id: number }>(
      `INSERT INTO biz.intel_brief
         (project_id, brief_date, brief_type, title, status, coverage, sections, item_ids,
          source_count, item_count, generated_at, version)
       VALUES ($1,$2,'daily',$3,'ready',$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10)
       RETURNING id`,
      [
        scope.projectId,
        date,
        `${scope.name} 情报日报 ${date}`,
        JSON.stringify(coverage),
        JSON.stringify(sections),
        JSON.stringify(itemIds),
        sources.size,
        itemIds.length,
        now,
        version,
      ],
    );
    if (itemIds.length > 0) {
      await this.pool.query("UPDATE biz.intel_item SET status = 'briefed' WHERE id = ANY($1::bigint[])", [itemIds]);
    }
    await this.pool.query("UPDATE biz.intel_project_scope SET last_brief_at = $1 WHERE project_id = $2", [now, scope.projectId]);
    return { briefId: inserted.rows[0]?.id ?? null, itemCount: itemIds.length, version, skipped: false };
  }

  /** 推送阶段：外部渠道无适配器时落 inapp 并标明未送达，不静默失败。 */
  async push(now: Date, options: { force?: boolean; projectId?: number } = {}): Promise<{ projects: number; briefs: number; sent: number; pending: number }> {
    const scopes = await this.scopes(options.projectId);
    let briefs = 0;
    let sent = 0;
    let pending = 0;
    for (const scope of scopes) {
      const date = localDate(now, scope.timezone);
      const pushSlot = Math.floor(now.getTime() / 600_000);
      const key = `push:${scope.projectId}:${pushSlot}${forceKey(options)}`;
      const counters = await this.pipelineRun(scope.projectId, date, "push", key, async () => {
        const rows = await this.pool.query<{ id: number; title: string; sections: unknown }>(
          `SELECT id, title, sections FROM biz.intel_brief
           WHERE project_id = $1 AND status = 'ready'
           ORDER BY brief_date, version`,
          [scope.projectId],
        );
        for (const brief of rows.rows) {
          if (inQuietHours(now, scope.timezone, scope.quietHours) && !hasUrgent(brief.sections)) {
            pending += 1;
            continue;
          }
          briefs += 1;
          for (const channel of scope.pushChannels) {
            const delivered = channel.channel === "inapp";
            const inserted = await this.pool.query(
              `INSERT INTO stat.intel_push_log
                 (brief_id, project_id, channel, target, status, attempts, sent_at, error)
               VALUES ($1,$2,$3,$4,$5,1,$6,$7)
               ON CONFLICT (brief_id, channel, target) DO NOTHING`,
              [
                brief.id,
                scope.projectId,
                channel.channel,
                channel.target,
                delivered ? "sent" : "pending",
                delivered ? now : null,
                delivered ? null : "未配置外部投递适配器，已降级为站内待办",
              ],
            );
            if ((inserted.rowCount ?? 0) > 0) {
              if (delivered) sent += 1;
              else pending += 1;
            }
          }
          await this.pool.query("UPDATE biz.intel_brief SET status = 'pushed', pushed_at = $1 WHERE id = $2", [now, brief.id]);
          await this.pool.query(
            `INSERT INTO stat.notification (kind, level, payload, status)
             VALUES ('intel_brief', 'digest', $1::jsonb, 'pending')`,
            [JSON.stringify({ projectId: scope.projectId, briefId: brief.id, title: brief.title, channels: scope.pushChannels })],
          );
        }
        return { briefs: rows.rows.length, sent, pending };
      });
      if (counters === null) continue;
    }
    return { projects: scopes.length, briefs, sent, pending };
  }
}
