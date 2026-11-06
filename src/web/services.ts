/**
 * 网页表现层服务：归置收件箱、会话授权、记忆桥、雷达。
 *
 * 统一约束：
 * - 所有写操作经本服务并写审计（opc_hub.audit.record），前端不直连业务表；
 * - 高风险域写回只标记为“已确认”，具体业务写入仍由员工插件/中枢完成；
 * - 会话/记忆读取必须带授权范围，未授权一律拒绝，不静默返回空。
 */
import { createHash } from "node:crypto";
import type { Pool } from "../db/pool.ts";
import type { AuditService } from "../audit/audit.ts";
import { OpcError, ERR } from "../platform/errors.ts";
import { classifyText, decideIngest, extractFields, type Classification, type ExtractedFields, type IngestDecision } from "./classifier.ts";
import { evaluatePluginCandidate, type CompanyProfileLite, type PluginCandidate } from "./plugin-score.ts";

export type IngestSourceType = "session_message" | "upload" | "voice" | "manual";
export type IngestStatus = "auto_draft" | "pending" | "confirmed" | "ignored" | "inbox";

export interface IngestRow {
  id: number;
  sourceType: IngestSourceType;
  sourceRef: string;
  rawText: string;
  contentHash: string;
  extracted: ExtractedFields;
  domain: string;
  confidence: number;
  status: IngestStatus;
  requiresHuman: boolean;
  idempotencyKey: string;
  createdAt: Date;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  decision: IngestDecision;
  classification: Classification;
}

interface IngestDbRow {
  id: number;
  source_type: IngestSourceType;
  source_ref: string;
  raw_text: string;
  content_hash: string;
  extracted: ExtractedFields;
  domain: string;
  confidence: string | number;
  status: IngestStatus;
  requires_human: boolean;
  idempotency_key: string;
  created_at: Date;
  confirmed_by: string | null;
  confirmed_at: Date | null;
}

function mapIngest(row: IngestDbRow): IngestRow {
  const classification = classifyText(row.raw_text);
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    rawText: row.raw_text,
    contentHash: row.content_hash,
    extracted: row.extracted ?? {},
    domain: row.domain,
    confidence: Number(row.confidence),
    status: row.status,
    requiresHuman: row.requires_human,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    decision: decideIngest(classification),
    classification,
  };
}

function hashOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export class IngestService {
  private readonly pool: Pool;
  private readonly audit: AuditService;

  constructor(pool: Pool, audit: AuditService) {
    this.pool = pool;
    this.audit = audit;
  }

  async ingest(input: { sourceType: IngestSourceType; sourceRef: string; text: string; idempotencyKey?: string }): Promise<{ item: IngestRow; duplicate: boolean }> {
    const text = input.text.trim();
    if (!["session_message", "upload", "voice", "manual"].includes(input.sourceType)) {
      throw new OpcError(ERR.WEB_INVALID, `不支持的 sourceType：${input.sourceType}`, 400);
    }
    if (text === "") throw new OpcError(ERR.WEB_INVALID, "归置文本不能为空", 400);
    if (input.sourceRef.trim() === "") throw new OpcError(ERR.WEB_INVALID, "sourceRef 不能为空", 400);
    const classification = classifyText(text);
    const extracted = extractFields(text);
    const decision = decideIngest(classification);
    const contentHash = hashOf(text);
    const idempotencyKey = input.idempotencyKey?.trim() || `${input.sourceType}:${input.sourceRef}:${contentHash}`;
    const status: IngestStatus =
      decision.action === "auto_draft" ? "auto_draft" : decision.action === "confirm" ? "pending" : "inbox";

    const inserted = await this.pool.query<IngestDbRow>(
      `INSERT INTO stat.web_ingest_item
         (source_type, source_ref, raw_text, content_hash, extracted, domain, confidence, status, requires_human, idempotency_key)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        input.sourceType,
        input.sourceRef,
        text,
        contentHash,
        JSON.stringify(extracted),
        classification.domain,
        classification.confidence,
        status,
        decision.requiresHuman,
        idempotencyKey,
      ],
    );

    let row = inserted.rows[0];
    let duplicate = false;
    if (row === undefined) {
      duplicate = true;
      const existing = await this.pool.query<IngestDbRow>(
        `SELECT * FROM stat.web_ingest_item
         WHERE idempotency_key = $1 OR (source_ref = $2 AND content_hash = $3)
         ORDER BY id DESC LIMIT 1`,
        [idempotencyKey, input.sourceRef, contentHash],
      );
      row = existing.rows[0];
      if (row === undefined) throw new OpcError(ERR.WEB_INVALID, "归置写入冲突但未找到既有记录", 500);
    }

    await this.audit.record({
      actor: "opc_web",
      action: "web.ingest",
      result: "ok",
      objectType: "web_ingest_item",
      objectId: String(row.id),
      payload: {
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        domain: classification.domain,
        confidence: classification.confidence,
        action: decision.action,
        requiresHuman: decision.requiresHuman,
        duplicate,
      },
    });

    return { item: mapIngest(row), duplicate };
  }

  async list(status: IngestStatus | undefined, limit = 50): Promise<IngestRow[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const result =
      status === undefined
        ? await this.pool.query<IngestDbRow>("SELECT * FROM stat.web_ingest_item ORDER BY id DESC LIMIT $1", [safeLimit])
        : await this.pool.query<IngestDbRow>(
            "SELECT * FROM stat.web_ingest_item WHERE status = $1 ORDER BY id DESC LIMIT $2",
            [status, safeLimit],
          );
    return result.rows.map(mapIngest);
  }

  async confirm(id: number, input: { action: "confirm" | "ignore"; editedExtracted?: ExtractedFields; confirmedBy?: string }): Promise<IngestRow> {
    if (!Number.isInteger(id) || id <= 0) throw new OpcError(ERR.WEB_INVALID, "归置项 id 非法", 400);
    const existing = await this.pool.query<IngestDbRow>("SELECT * FROM stat.web_ingest_item WHERE id = $1", [id]);
    const current = existing.rows[0];
    if (current === undefined) throw new OpcError(ERR.WEB_INVALID, `归置项不存在：${id}`, 404);
    if (current.status === "confirmed" || current.status === "ignored") {
      throw new OpcError(ERR.WEB_INVALID, `归置项已处理：${current.status}`, 409);
    }
    const status: IngestStatus = input.action === "confirm" ? "confirmed" : "ignored";
    const extracted = input.editedExtracted ?? current.extracted;
    const updated = await this.pool.query<IngestDbRow>(
      `UPDATE stat.web_ingest_item
       SET status = $1, extracted = $2::jsonb, confirmed_by = $3, confirmed_at = now()
       WHERE id = $4 RETURNING *`,
      [status, JSON.stringify(extracted), input.confirmedBy ?? "boss", id],
    );
    await this.audit.record({
      actor: "opc_web",
      action: "web.ingest.confirm",
      result: "ok",
      objectType: "web_ingest_item",
      objectId: String(id),
      payload: { status, edited: input.editedExtracted !== undefined },
    });
    return mapIngest(updated.rows[0]);
  }
}

export interface SessionGrant {
  id: number;
  sessionId: string;
  purpose: string;
  messageScope: string;
  expiresAt: Date;
}

export interface SessionMessage {
  messageId: string;
  role: string;
  content: string;
  createdAt: Date;
}

export class SessionGrantService {
  private readonly pool: Pool;
  private readonly audit: AuditService;

  constructor(pool: Pool, audit: AuditService) {
    this.pool = pool;
    this.audit = audit;
  }

  async grant(sessionId: string, input: { purpose: string; ttlSeconds?: number; messageScope?: string; grantedBy?: string }): Promise<SessionGrant> {
    if (sessionId.trim() === "") throw new OpcError(ERR.WEB_INVALID, "sessionId 不能为空", 400);
    if (input.purpose.trim() === "") throw new OpcError(ERR.WEB_INVALID, "授权用途不能为空", 400);
    const ttl = Math.min(Math.max(input.ttlSeconds ?? 86_400, 60), 86_400);
    const inserted = await this.pool.query<{ id: number; session_id: string; purpose: string; message_scope: string; expires_at: Date }>(
      `INSERT INTO ref.web_session_grant (session_id, message_scope, purpose, granted_by, expires_at)
       VALUES ($1,$2,$3,$4, now() + ($5::text || ' seconds')::interval) RETURNING id, session_id, purpose, message_scope, expires_at`,
      [sessionId, input.messageScope ?? "recent_20", input.purpose, input.grantedBy ?? "boss", ttl],
    );
    const row = inserted.rows[0];
    await this.audit.record({
      actor: "opc_web",
      action: "web.session.grant",
      result: "ok",
      objectType: "web_session_grant",
      objectId: String(row.id),
      payload: { sessionId, purpose: input.purpose, ttlSeconds: ttl },
    });
    return { id: row.id, sessionId: row.session_id, purpose: row.purpose, messageScope: row.message_scope, expiresAt: row.expires_at };
  }

  async revoke(sessionId: string): Promise<{ revoked: number }> {
    const updated = await this.pool.query(
      "UPDATE ref.web_session_grant SET status = 'revoked', revoked_at = now() WHERE session_id = $1 AND status = 'active'",
      [sessionId],
    );
    await this.audit.record({
      actor: "opc_web",
      action: "web.session.revoke",
      result: "ok",
      objectType: "web_session_grant",
      objectId: sessionId,
      payload: { revoked: updated.rowCount ?? 0 },
    });
    return { revoked: updated.rowCount ?? 0 };
  }

  async context(sessionId: string): Promise<{ grantId: number; expiresAt: Date; messages: SessionMessage[] }> {
    const grant = await this.pool.query<{ id: number; expires_at: Date }>(
      `SELECT id, expires_at FROM ref.web_session_grant
       WHERE session_id = $1 AND status = 'active' AND expires_at > now()
       ORDER BY id DESC LIMIT 1`,
      [sessionId],
    );
    const row = grant.rows[0];
    if (row === undefined) throw new OpcError(ERR.WEB_INVALID, "会话未授权或授权已过期", 403);
    const messages = await this.pool.query<{ message_id: string; role: string; content: string; created_at: Date }>(
      `SELECT message_id, role, content, created_at FROM stat.web_session_message
       WHERE session_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20`,
      [sessionId],
    );
    await this.audit.record({
      actor: "opc_web",
      action: "web.session.context",
      result: "ok",
      objectType: "web_session_grant",
      objectId: String(row.id),
      payload: { sessionId, returned: messages.rows.length },
    });
    return {
      grantId: row.id,
      expiresAt: row.expires_at,
      messages: messages.rows.reverse().map((item) => ({
        messageId: item.message_id,
        role: item.role,
        content: item.content,
        createdAt: item.created_at,
      })),
    };
  }
}

export type MemoryScope = "company_profile" | "experience" | "skill" | "customer" | "session_digest";

export interface MemoryCard {
  id: number;
  scope: MemoryScope;
  title: string;
  content: string;
  sourceRefs: string[];
  confidence: number;
  sensitive: boolean;
  createdAt: Date;
}

export class MemoryService {
  private readonly pool: Pool;
  private readonly audit: AuditService;

  constructor(pool: Pool, audit: AuditService) {
    this.pool = pool;
    this.audit = audit;
  }

  async search(input: { query: string; scopes: MemoryScope[]; limit?: number; purpose: string }): Promise<MemoryCard[]> {
    if (input.query.trim() === "") throw new OpcError(ERR.WEB_INVALID, "记忆检索词不能为空", 400);
    if (input.purpose.trim() === "") throw new OpcError(ERR.WEB_INVALID, "记忆检索用途不能为空", 400);
    const allowedScopes = new Set(["company_profile", "experience", "skill", "customer", "session_digest"]);
    if (input.scopes.length === 0) throw new OpcError(ERR.WEB_INVALID, "必须指定记忆 scope", 400);
    if (input.scopes.some((scope) => !allowedScopes.has(scope))) {
      throw new OpcError(ERR.WEB_INVALID, "包含不支持的记忆 scope", 400);
    }
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
    const result = await this.pool.query<{
      id: number;
      scope: MemoryScope;
      title: string;
      content: string;
      source_refs: string[];
      confidence: string | number;
      sensitive: boolean;
      created_at: Date;
    }>(
      `SELECT id, scope, title, content, source_refs, confidence, sensitive, created_at
       FROM stat.web_memory_card
       WHERE scope = ANY($1::text[]) AND (title ILIKE $2 OR content ILIKE $2)
       ORDER BY confidence DESC, id DESC LIMIT $3`,
      [input.scopes, `%${input.query}%`, limit],
    );
    await this.audit.record({
      actor: "opc_web",
      action: "web.memory.search",
      result: "ok",
      objectType: "web_memory_card",
      payload: { query: input.query, scopes: input.scopes, purpose: input.purpose, returned: result.rows.length },
    });
    return result.rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      title: row.title,
      content: row.sensitive ? "[敏感记忆，需一次性令牌查看]" : row.content,
      sourceRefs: row.source_refs ?? [],
      confidence: Number(row.confidence),
      sensitive: row.sensitive,
      createdAt: row.created_at,
    }));
  }

  async propose(input: { type: MemoryScope; title: string; content: string; sourceRefs: string[]; confidence: number }): Promise<{ proposalId: number; status: string }> {
    if (!["company_profile", "experience", "skill", "customer", "session_digest"].includes(input.type)) {
      throw new OpcError(ERR.WEB_INVALID, `不支持的记忆类型：${input.type}`, 400);
    }
    if (input.title.trim() === "" || input.content.trim() === "") throw new OpcError(ERR.WEB_INVALID, "记忆标题与内容不能为空", 400);
    if (input.sourceRefs.length === 0) throw new OpcError(ERR.WEB_INVALID, "记忆提议必须带来源引用", 400);
    if (!(input.confidence >= 0 && input.confidence <= 1)) throw new OpcError(ERR.WEB_INVALID, "置信度必须在 0..1", 400);
    const inserted = await this.pool.query<{ id: number; status: string }>(
      `INSERT INTO stat.web_memory_proposal (memory_type, title, content, source_refs, confidence)
       VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id, status`,
      [input.type, input.title, input.content, JSON.stringify(input.sourceRefs), input.confidence],
    );
    await this.audit.record({
      actor: "opc_web",
      action: "web.memory.propose",
      result: "ok",
      objectType: "web_memory_proposal",
      objectId: String(inserted.rows[0].id),
      payload: { type: input.type, sourceRefs: input.sourceRefs, confidence: input.confidence },
    });
    return { proposalId: inserted.rows[0].id, status: inserted.rows[0].status };
  }

  async confirm(proposalId: number, confirmedBy = "boss"): Promise<{ memoryId: number; created: boolean }> {
    const proposal = await this.pool.query<{
      id: number;
      memory_type: MemoryScope;
      title: string;
      content: string;
      source_refs: string[];
      confidence: string | number;
      status: string;
    }>("SELECT * FROM stat.web_memory_proposal WHERE id = $1", [proposalId]);
    const row = proposal.rows[0];
    if (row === undefined) throw new OpcError(ERR.WEB_INVALID, `记忆提议不存在：${proposalId}`, 404);
    if (row.status !== "pending") throw new OpcError(ERR.WEB_INVALID, `记忆提议已处理：${row.status}`, 409);
    const contentHash = hashOf(`${row.memory_type}:${row.content}`);
    const inserted = await this.pool.query<{ id: number }>(
      `INSERT INTO stat.web_memory_card (scope, title, content, source_refs, confidence, content_hash, sensitive)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
       ON CONFLICT (scope, content_hash) DO NOTHING RETURNING id`,
      [row.memory_type, row.title, row.content, JSON.stringify(row.source_refs ?? []), Number(row.confidence), contentHash, row.memory_type === "customer"],
    );
    let memoryId = inserted.rows[0]?.id;
    let created = memoryId !== undefined;
    if (memoryId === undefined) {
      const existing = await this.pool.query<{ id: number }>(
        "SELECT id FROM stat.web_memory_card WHERE scope = $1 AND content_hash = $2",
        [row.memory_type, contentHash],
      );
      memoryId = existing.rows[0]?.id;
      if (memoryId === undefined) throw new OpcError(ERR.WEB_INVALID, "记忆落库冲突但未找到既有记录", 500);
    }
    await this.pool.query("UPDATE stat.web_memory_proposal SET status = 'confirmed', confirmed_at = now() WHERE id = $1", [proposalId]);
    await this.audit.record({
      actor: "opc_web",
      action: "web.memory.confirm",
      result: "ok",
      objectType: "web_memory_card",
      objectId: String(memoryId),
      payload: { proposalId, confirmedBy, created },
    });
    return { memoryId, created };
  }
}

export type RadarType = "plugin" | "keyword";

export interface RadarRow {
  id: number;
  radarType: RadarType;
  title: string;
  url: string;
  publishedAt: string | null;
  score: number;
  reason: string;
  risks: string[];
  status: string;
}

export class RadarService {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async list(input: { type?: RadarType; status?: string; limit?: number } = {}): Promise<RadarRow[]> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (input.type !== undefined) {
      params.push(input.type);
      conditions.push(`radar_type = $${params.length}`);
    }
    if (input.status !== undefined) {
      params.push(input.status);
      conditions.push(`status = $${params.length}`);
    }
    params.push(limit);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.pool.query<{
      id: number;
      radar_type: RadarType;
      title: string;
      url: string;
      published_at: string | null;
      score: string | number;
      reason: string;
      risks: string[];
      status: string;
    }>(
      `SELECT id, radar_type, title, url, published_at::text, score, reason, risks, status
       FROM stat.radar_item ${where} ORDER BY score DESC, published_at DESC NULLS LAST, id DESC LIMIT $${params.length}`,
      params,
    );
    return result.rows.map((row) => ({
      id: row.id,
      radarType: row.radar_type,
      title: row.title,
      url: row.url,
      publishedAt: row.published_at,
      score: Number(row.score),
      reason: row.reason,
      risks: row.risks ?? [],
      status: row.status,
    }));
  }

  async upsert(items: Array<{ type: RadarType; title: string; url: string; publishedAt?: string; score: number; reason: string; risks?: string[]; dedupeKey: string }>): Promise<number> {
    let written = 0;
    for (const item of items) {
      if (item.type !== "plugin" && item.type !== "keyword") {
        throw new OpcError(ERR.WEB_INVALID, `不支持的雷达类型：${item.type}`, 400);
      }
      if (item.title.trim() === "" || item.url.trim() === "" || item.dedupeKey.trim() === "") {
        throw new OpcError(ERR.WEB_INVALID, "雷达条目 title/url/dedupeKey 不能为空", 400);
      }
      const inserted = await this.pool.query(
        `INSERT INTO stat.radar_item (radar_type, title, url, published_at, score, reason, risks, dedupe_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
         ON CONFLICT (radar_type, dedupe_key) DO NOTHING`,
        [item.type, item.title, item.url, item.publishedAt ?? null, item.score, item.reason, JSON.stringify(item.risks ?? []), item.dedupeKey],
      );
      written += inserted.rowCount ?? 0;
    }
    return written;
  }

  async recommendPlugins(candidates: PluginCandidate[], profile: CompanyProfileLite, now: Date = new Date()): Promise<{ recommended: number; rejected: number }> {
    let recommended = 0;
    let rejected = 0;
    for (const candidate of candidates) {
      const evaluation = evaluatePluginCandidate(candidate, profile, now);
      if (!evaluation.eligible) {
        rejected += 1;
        continue;
      }
      const written = await this.upsert([
        {
          type: "plugin",
          title: candidate.name,
          url: candidate.url,
          publishedAt: candidate.lastUpdatedAt.slice(0, 10),
          score: evaluation.score,
          reason: evaluation.reasons.join("；") || "通过硬过滤",
          risks: evaluation.risks,
          dedupeKey: `${candidate.id}:${candidate.lastUpdatedAt}`,
        },
      ]);
      recommended += written;
    }
    return { recommended, rejected };
  }
}
