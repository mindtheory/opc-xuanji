/**
 * 公司情报中心（v2.29）：情报与项目无关，是公司对外的开放系统。
 *
 * 老板口径（2026-11-21）：建「情况采集」，从互联网与官方数据源（市监总局/统计局/工信部政策等）
 * 采集相关数据，汇总入公司记忆。
 *
 * 数据流：biz.source（启用的公开来源）→ collectors 抓取 → biz.intel_item（project_id=NULL 公司级）
 * → 每日摘要 → stat.web_memory_proposal（scope=market_intel，老板确认后落公司记忆）。
 * 设置存 ref.shared_setting（键 intel.collect.settings）。
 */
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "../../db/pool.ts";
import type { AuditService } from "../../audit/audit.ts";
import { OpcError, ERR } from "../../platform/errors.ts";
import { collectSource, detectKind, type CollectedItem } from "./collectors.ts";

export interface IntelCollectSettings {
  enabled: boolean;
  maxItemsPerSource: number;
  memoryDailyCap: number;
  memoryMinScore: number;
}

export const INTEL_COLLECT_SETTINGS_KEY = "intel.collect.settings";
export const INTEL_COLLECT_SETTINGS_DEFAULTS: IntelCollectSettings = {
  enabled: true,
  maxItemsPerSource: 20,
  memoryDailyCap: 10,
  memoryMinScore: 0,
};

function hashOf(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeCollectSettings(raw: unknown): IntelCollectSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const int = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(Math.round(n), min), max);
  };
  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : INTEL_COLLECT_SETTINGS_DEFAULTS.enabled,
    maxItemsPerSource: int(obj.maxItemsPerSource, INTEL_COLLECT_SETTINGS_DEFAULTS.maxItemsPerSource, 1, 100),
    memoryDailyCap: int(obj.memoryDailyCap, INTEL_COLLECT_SETTINGS_DEFAULTS.memoryDailyCap, 1, 50),
    memoryMinScore: int(obj.memoryMinScore, INTEL_COLLECT_SETTINGS_DEFAULTS.memoryMinScore, 0, 100),
  };
}

export interface CompanyCollectResult {
  enabled: boolean;
  due: number;
  collected: number;
  inserted: number;
  duplicates: number;
  failed: number;
  sources: Array<{ id: number; name: string; kind: string; fetched: number; inserted: number; error?: string }>;
}

export interface CompanyMemoryResult {
  proposals: number;
  skipped: number;
  items: number;
  titles: string[];
}

export class CompanyIntelService {
  private readonly pool: Pool;
  private readonly audit: AuditService;

  constructor(pool: Pool, audit: AuditService) {
    this.pool = pool;
    this.audit = audit;
  }

  async getSettings(): Promise<IntelCollectSettings> {
    const rows = await this.pool.query<{ value: unknown }>(
      "SELECT value FROM ref.shared_setting WHERE key = $1",
      [INTEL_COLLECT_SETTINGS_KEY],
    );
    return normalizeCollectSettings(rows.rows[0]?.value ?? null);
  }

  async updateSettings(input: Record<string, unknown>): Promise<IntelCollectSettings> {
    for (const key of ["maxItemsPerSource", "memoryDailyCap", "memoryMinScore"] as const) {
      if (input[key] !== undefined && !Number.isFinite(Number(input[key]))) {
        throw new OpcError(ERR.INT_INVALID, `${key} 必须是整数`, 400);
      }
    }
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
      throw new OpcError(ERR.INT_INVALID, "enabled 必须是布尔值", 400);
    }
    const current = await this.getSettings();
    const next = normalizeCollectSettings({ ...current, ...input });
    await this.pool.query(
      `INSERT INTO ref.shared_setting (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
      [INTEL_COLLECT_SETTINGS_KEY, JSON.stringify(next)],
    );
    await this.audit.record({
      actor: "opc_admin",
      action: "intel.company.settings.update",
      result: "ok",
      objectType: "shared_setting",
      objectId: INTEL_COLLECT_SETTINGS_KEY,
      payload: next,
    });
    return next;
  }

  /** 到期判定与项目流水线一致：last_success_at + interval <= now（force 忽略间隔）。 */
  private async dueSources(now: Date, force: boolean): Promise<Array<{ id: number; name: string; url: string; kind: string; timeoutMs: number; seen: string[] }>> {
    const rows = await this.pool.query<{
      id: number; name: string; url: string | null; checkpoint: Record<string, unknown> | null; timeout_ms: number;
    }>(
      `SELECT id, name, url, checkpoint, timeout_ms FROM biz.source
       WHERE enabled AND status = 'active' AND source_type IN ('web','rss','api') AND url IS NOT NULL
         AND ($1::boolean OR last_success_at IS NULL OR last_success_at + make_interval(mins => collect_interval_minutes) <= $2)
       ORDER BY id`,
      [force, now],
    );
    return rows.rows
      .filter((row) => (row.url ?? "").trim() !== "")
      .map((row) => ({
        id: Number(row.id),
        name: row.name,
        url: (row.url as string).trim(),
        kind: typeof row.checkpoint?.kind === "string" ? (row.checkpoint.kind as string) : detectKind(row.url ?? ""),
        timeoutMs: Number(row.timeout_ms) || 20_000,
        seen: Array.isArray(row.checkpoint?.seen) ? (row.checkpoint.seen as unknown[]).map(String) : [],
      }));
  }

  /** 情况采集：抓公开来源 → 公司级条目入库（project_id=NULL）→ 更新来源健康与增量游标。 */
  async collectAll(now = new Date(), options: { force?: boolean } = {}): Promise<CompanyCollectResult> {
    const settings = await this.getSettings();
    if (!settings.enabled) return { enabled: false, due: 0, collected: 0, inserted: 0, duplicates: 0, failed: 0, sources: [] };
    const due = await this.dueSources(now, options.force === true);
    const result: CompanyCollectResult = { enabled: true, due: due.length, collected: 0, inserted: 0, duplicates: 0, failed: 0, sources: [] };
    for (const source of due) {
      const slot = Math.floor(now.getTime() / 60_000);
      const run = await this.pool.query<{ id: number }>(
        `INSERT INTO stat.intel_collect_run (source_id, project_id, idempotency_key, status)
         VALUES ($1, NULL, $2, 'running')
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [source.id, options.force === true ? `company:${source.id}:${slot}:${randomUUID()}` : `company:${source.id}:${slot}`],
      );
      const runId = run.rows[0]?.id;
      if (runId === undefined) continue;
      const started = Date.now();
      const outcome = await collectSource({ id: source.id, name: source.name, url: source.url, kind: source.kind, maxItems: settings.maxItemsPerSource, seen: source.seen }, source.timeoutMs);
      let inserted = 0;
      let duplicates = 0;
      if (outcome.error === undefined) {
        for (const item of outcome.items) {
          const ingested = await this.ingestCompany(source.id, item, now);
          inserted += ingested.inserted;
          duplicates += ingested.duplicates;
        }
        const latency = Date.now() - started;
        await this.pool.query(
          `UPDATE biz.source SET last_success_at = $2, last_error = NULL, consecutive_failures = 0,
             checkpoint = jsonb_set(
               COALESCE(checkpoint, '{}'::jsonb), '{seen}',
               (SELECT COALESCE(jsonb_agg(u), '[]'::jsonb) FROM (SELECT u FROM jsonb_array_elements_text(
                   COALESCE(checkpoint->'seen','[]'::jsonb) || $3::jsonb) AS u GROUP BY u) capped LIMIT 400)             )
           WHERE id = $1`,
          [source.id, now, JSON.stringify(outcome.fresh)],
        );
        await this.pool.query(
          `UPDATE stat.intel_collect_run SET status='ok', ended_at=now(), fetched=$2, inserted=$3, duplicates=$4, http_status=$5, latency_ms=$6 WHERE id=$1`,
          [runId, outcome.items.length, inserted, duplicates, outcome.httpStatus, latency],
        );
        result.collected += outcome.items.length;
        result.inserted += inserted;
        result.duplicates += duplicates;
      } else {
        await this.pool.query(
          `UPDATE biz.source SET last_failure_at = now(), last_error = $2, consecutive_failures = consecutive_failures + 1 WHERE id = $1`,
          [source.id, outcome.error.slice(0, 500)],
        );
        await this.pool.query(
          `UPDATE stat.intel_collect_run SET status='failed', ended_at=now(), error=$2 WHERE id=$1`,
          [runId, outcome.error.slice(0, 500)],
        );
        result.failed += 1;
      }
      result.sources.push({ id: source.id, name: source.name, kind: outcome.kind, fetched: outcome.items.length, inserted, ...(outcome.error !== undefined ? { error: outcome.error } : {}) });
    }
    await this.audit.record({
      actor: "opc_admin",
      action: "intel.company.collect",
      result: "ok",
      objectType: "intel_item",
      payload: { due: result.due, collected: result.collected, inserted: result.inserted, failed: result.failed },
    });
    return result;
  }

  private async ingestCompany(sourceId: number, item: CollectedItem, now: Date): Promise<{ inserted: number; duplicates: number }> {
    const title = item.title.trim();
    if (title === "" || item.url.trim() === "") return { inserted: 0, duplicates: 0 };
    const contentHash = hashOf(`${title}\n${item.summary ?? ""}\n${item.url}`);
    const idempotencyKey = `company:src:${sourceId}:${hashOf(item.url).slice(0, 32)}`;
    const inserted = await this.pool.query(
      `INSERT INTO biz.intel_item
         (project_id, source_id, external_id, url, title, summary, content_hash, published_at, collected_at, status, idempotency_key)
       VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, 'collected', $9)
       ON CONFLICT (idempotency_key) WHERE project_id IS NULL DO NOTHING RETURNING id`,
      [sourceId, item.externalId ?? null, item.url.slice(0, 2000), title.slice(0, 500), item.summary ?? null, contentHash, item.publishedAt ?? null, now, idempotencyKey],
    );
    return (inserted.rowCount ?? 0) > 0 ? { inserted: 1, duplicates: 0 } : { inserted: 0, duplicates: 1 };
  }

  /** 汇总入公司记忆：近 24h 公司级条目按来源生成 market_intel 记忆提议（老板确认后落库）。 */
  async memoryDigest(now = new Date()): Promise<CompanyMemoryResult> {
    const settings = await this.getSettings();
    const rows = await this.pool.query<{ id: number; source_name: string | null; title: string; url: string | null; published_at: Date | null; relevance_score: string | null }>(
      `SELECT i.id, s.name AS source_name, i.title, i.url, i.published_at, i.relevance_score
       FROM biz.intel_item i
       LEFT JOIN biz.source s ON s.id = i.source_id
       WHERE i.project_id IS NULL AND i.status IN ('collected','analyzed') AND i.collected_at >= $1
       ORDER BY i.source_id NULLS LAST, i.collected_at DESC`,
      [new Date(now.getTime() - 24 * 3600_000)],
    );
    const result: CompanyMemoryResult = { proposals: 0, skipped: 0, items: rows.rowCount ?? 0, titles: [] };
    const bySource = new Map<string, typeof rows.rows>();
    for (const row of rows.rows) {
      const score = row.relevance_score === null ? null : Number(row.relevance_score) * 100;
      if (score !== null && score < settings.memoryMinScore) { result.skipped += 1; continue; }
      const key = row.source_name ?? "其它来源";
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key)!.push(row);
    }
    const day = now.toISOString().slice(0, 10);
    for (const [sourceName, items] of bySource) {
      if (result.proposals >= settings.memoryDailyCap) { result.skipped += items.length; continue; }
      const refs = items.map((item) => item.url).filter((u): u is string => u !== null).slice(0, 20);
      if (refs.length === 0) { result.skipped += items.length; continue; }
      const lines = items.slice(0, 30).map((item) => {
        const date = item.published_at instanceof Date ? item.published_at.toISOString().slice(0, 10) : "";
        return `- ${item.title}${date !== "" ? `（${date}）` : ""}${item.url ? ` ${item.url}` : ""}`;
      });
      const title = `市场情报摘要 · ${sourceName} · ${day}`;
      const content = `来源：${sourceName}；共 ${items.length} 条（${day} 采集汇总）：\n${lines.join("\n")}`;
      const dup = await this.pool.query(
        "SELECT 1 FROM stat.web_memory_proposal WHERE memory_type = 'market_intel' AND title = $1 LIMIT 1",
        [title],
      );
      if ((dup.rowCount ?? 0) > 0) { result.skipped += items.length; continue; }
      await this.pool.query(
        `INSERT INTO stat.web_memory_proposal (memory_type, title, content, source_refs, confidence)
         VALUES ('market_intel', $1, $2, $3::jsonb, 0.6)`,
        [title, content.slice(0, 8000), JSON.stringify(refs)],
      );
      result.proposals += 1;
      result.titles.push(title);
      await this.pool.query(
        `UPDATE biz.intel_item SET status = 'briefed' WHERE id = ANY($1::bigint[])`,
        [items.map((item) => Number(item.id))],
      );
    }
    if (result.proposals > 0) {
      await this.audit.record({
        actor: "opc_admin",
        action: "intel.company.memory",
        result: "ok",
        objectType: "web_memory_proposal",
        payload: { proposals: result.proposals, items: result.items },
      });
    }
    return result;
  }

  /** 待确认的市场情报记忆提议（老板在情报页一键确认落库）。 */
  async listProposals(limit: number): Promise<Array<Record<string, unknown>>> {
    const rows = await this.pool.query(
      `SELECT id, title, content, source_refs, confidence, status, created_at
       FROM stat.web_memory_proposal WHERE memory_type = 'market_intel' AND status = $1
       ORDER BY id DESC LIMIT $2`,
      ["pending", Math.min(Math.max(limit, 1), 100)],
    );
    return rows.rows;
  }

  /** 公司情报总览 KPI。 */
  async summary(): Promise<Record<string, unknown>> {
    const rows = await this.pool.query<Record<string, unknown>>(
      `SELECT
         (SELECT count(*) FROM biz.source WHERE enabled AND status='active') AS sources_active,
         (SELECT count(*) FROM biz.source WHERE NOT enabled OR status <> 'active') AS sources_paused,
         (SELECT count(*) FROM biz.source WHERE consecutive_failures >= 3) AS sources_failing,
         (SELECT count(*) FROM biz.intel_item WHERE project_id IS NULL AND collected_at >= now() - interval '24 hours') AS items_24h,
         (SELECT count(*) FROM biz.intel_item WHERE project_id IS NULL) AS items_total,
         (SELECT count(*) FROM biz.intel_item WHERE project_id IS NULL AND status = 'briefed') AS items_briefed,
         (SELECT count(*) FROM stat.web_memory_proposal WHERE memory_type='market_intel' AND status='pending') AS memory_pending,
         (SELECT count(*) FROM stat.web_memory_proposal WHERE memory_type='market_intel' AND status='confirmed') AS memory_confirmed,
         (SELECT count(*) FROM stat.intel_collect_run WHERE project_id IS NULL AND status='failed' AND started_at >= now() - interval '24 hours') AS failures_24h`,
    );
    const row = rows.rows[0];
    const num = (key: string) => Number(row[key] ?? 0);
    return {
      sourcesActive: num("sources_active"),
      sourcesPaused: num("sources_paused"),
      sourcesFailing: num("sources_failing"),
      items24h: num("items_24h"),
      itemsTotal: num("items_total"),
      itemsBriefed: num("items_briefed"),
      memoryPending: num("memory_pending"),
      memoryConfirmed: num("memory_confirmed"),
      failures24h: num("failures_24h"),
    };
  }

  /** 公司级情报条目列表（project_id IS NULL）。 */
  async listItems(status: string | null, limit: number): Promise<Array<Record<string, unknown>>> {
    const rows = await this.pool.query(
      `SELECT i.id, i.source_id, s.name AS source_name, i.url, i.title, i.summary, i.published_at, i.collected_at, i.status
       FROM biz.intel_item i LEFT JOIN biz.source s ON s.id = i.source_id
       WHERE i.project_id IS NULL AND ($1::text IS NULL OR i.status = $1)
       ORDER BY i.collected_at DESC, i.id DESC LIMIT $2`,
      [status, Math.min(Math.max(limit, 1), 500)],
    );
    return rows.rows;
  }
}
