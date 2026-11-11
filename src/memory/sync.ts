/**
 * Hindsight 记忆同步服务：导入（写 Hindsight）与双向同步（推送 OPC 记忆卡 / 拉取为记忆提案）。
 *
 * 口径：
 * - 导入与推送都走 Hindsight /memories，document_id 固定，重复推送覆盖不重复；
 * - 敏感记忆卡（sensitive=true）永不推送，避免把一次性令牌保护的内容外流；
 * - 拉取不直接落 OPC 记忆卡，统一生成「记忆提案（pending）」，老板确认后才进共享记忆；
 * - 每次操作写审计（action 前缀 memory.hindsight.*）。
 */
import { OpcError, ERR } from "../platform/errors.ts";
import type { AuditService } from "../audit/audit.ts";
import type { Pool } from "../db/pool.ts";
import { cardToItem, itemToProposal, type HindsightBridge, type HindsightItem } from "./hindsight.ts";

export interface MemoryStatus {
  reachable: boolean;
  error?: string;
  bank: string;
  stats?: { totalNodes: number; totalLinks: number; totalDocuments: number; lastWriteAt: string | null; pendingOperations: number };
  opcCards: number;
  pendingProposals: number;
}

export class HindsightSyncService {
  private readonly bridge: HindsightBridge;
  private readonly pool: Pool;
  private readonly audit: AuditService;

  constructor(bridge: HindsightBridge, pool: Pool, audit: AuditService) {
    this.bridge = bridge;
    this.pool = pool;
    this.audit = audit;
  }

  async status(): Promise<MemoryStatus> {
    const health = await this.bridge.healthSafe();
    let stats: MemoryStatus["stats"];
    let error = health.error;
    if (health.reachable) {
      try {
        stats = await this.bridge.stats();
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    const cards = await this.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM stat.web_memory_card");
    const proposals = await this.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM stat.web_memory_proposal WHERE status = 'pending'");
    return {
      reachable: health.reachable,
      error,
      bank: this.bridge.bank,
      stats,
      opcCards: cards.rows[0]?.n ?? 0,
      pendingProposals: proposals.rows[0]?.n ?? 0,
    };
  }

  async list(limit = 50, offset = 0): Promise<{ items: unknown[]; total: number; limit: number; offset: number }> {
    return this.bridge.listMemories(limit, offset);
  }

  /** 直接导入（面板粘贴/文件解析后的 items）。 */
  async import(input: { items: HindsightItem[]; async?: boolean }): Promise<{ accepted: number }> {
    const items: HindsightItem[] = [];
    for (const raw of input.items) {
      const content = typeof raw?.content === "string" ? raw.content.trim() : "";
      if (content === "") throw new OpcError(ERR.HINDSIGHT_UNAVAILABLE, "导入项缺少 content", 400);
      const item: HindsightItem = { content };
      if (typeof raw.context === "string" && raw.context.trim() !== "") item.context = raw.context;
      if (typeof raw.timestamp === "string" && raw.timestamp.trim() !== "") item.timestamp = raw.timestamp;
      if (typeof raw.document_id === "string" && raw.document_id.trim() !== "") item.document_id = raw.document_id;
      if (Array.isArray(raw.tags)) item.tags = raw.tags.filter((t) => typeof t === "string");
      if (raw.metadata !== undefined && typeof raw.metadata === "object" && raw.metadata !== null) item.metadata = raw.metadata as Record<string, string>;
      items.push(item);
    }
    if (items.length === 0) throw new OpcError(ERR.HINDSIGHT_UNAVAILABLE, "没有可导入的记忆项", 400);
    const result = await this.bridge.importItems(items, { async: input.async === true });
    await this.audit.record({
      actor: "opc_hub",
      action: "memory.hindsight.import",
      result: "ok",
      objectType: "hindsight_memory",
      payload: { accepted: result.accepted, async: input.async === true },
    });
    return result;
  }

  /** 推送：OPC 记忆卡 → Hindsight（敏感卡跳过）。 */
  async syncPush(): Promise<{ pushed: number; skippedSensitive: number }> {
    const rows = await this.pool.query<{
      id: number;
      scope: string;
      title: string;
      content: string;
      source_refs: string[];
      confidence: string | number;
      sensitive: boolean;
      created_at: Date;
    }>("SELECT id, scope, title, content, source_refs, confidence, sensitive, created_at FROM stat.web_memory_card ORDER BY id");
    const items: HindsightItem[] = [];
    let skipped = 0;
    for (const row of rows.rows) {
      const item = cardToItem({
        id: row.id,
        scope: row.scope,
        title: row.title,
        content: row.content,
        sourceRefs: row.source_refs ?? [],
        confidence: Number(row.confidence),
        sensitive: row.sensitive,
        createdAt: row.created_at,
      });
      if (item === null) {
        skipped += 1;
        continue;
      }
      items.push(item);
    }
    const result = items.length > 0 ? await this.bridge.importItems(items) : { accepted: 0 };
    await this.audit.record({
      actor: "opc_hub",
      action: "memory.hindsight.sync.push",
      result: "ok",
      objectType: "hindsight_memory",
      payload: { pushed: result.accepted, skippedSensitive: skipped, cards: rows.rows.length },
    });
    return { pushed: result.accepted, skippedSensitive: skipped };
  }

  /** 拉取：Hindsight 记忆 → OPC 记忆提案（pending，去重靠 source_refs 包含 hindsight:<id>）。 */
  async syncPull(limit = 50): Promise<{ pulled: number; created: number; skipped: number }> {
    const page = await this.bridge.listMemories(limit, 0);
    let created = 0;
    let skipped = 0;
    for (const memory of page.items) {
      const proposal = itemToProposal(memory);
      if (proposal === null) {
        skipped += 1;
        continue;
      }
      const exists = await this.pool.query(
        "SELECT 1 FROM stat.web_memory_proposal WHERE source_refs @> $1::jsonb LIMIT 1",
        [JSON.stringify([`hindsight:${memory.id}`])],
      );
      if (exists.rows.length > 0) {
        skipped += 1;
        continue;
      }
      await this.pool.query(
        `INSERT INTO stat.web_memory_proposal (memory_type, title, content, source_refs, confidence)
         VALUES ($1,$2,$3,$4::jsonb,$5)`,
        [proposal.type, proposal.title, proposal.content, JSON.stringify(proposal.sourceRefs), proposal.confidence],
      );
      created += 1;
    }
    await this.audit.record({
      actor: "opc_hub",
      action: "memory.hindsight.sync.pull",
      result: "ok",
      objectType: "web_memory_proposal",
      payload: { pulled: page.items.length, created, skipped },
    });
    return { pulled: page.items.length, created, skipped };
  }

  /** 双向：先推后拉。 */
  async syncBoth(limit = 50): Promise<{ push: { pushed: number; skippedSensitive: number }; pull: { pulled: number; created: number; skipped: number } }> {
    const push = await this.syncPush();
    const pull = await this.syncPull(limit);
    return { push, pull };
  }
}
