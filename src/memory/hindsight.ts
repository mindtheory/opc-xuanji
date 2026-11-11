/**
 * Hindsight 记忆桥（记忆导入与同步）：opc-xuanji 应用层对 Hindsight 记忆服务的唯一出口。
 *
 * 依赖的服务：vectorize-io/hindsight（默认 http://127.0.0.1:28888，bank 默认 dsh）。
 * API（取自其 openapi.json）：
 *   GET  /health
 *   GET  /v1/default/banks/{bank}/stats
 *   GET  /v1/default/banks/{bank}/memories/list?limit=&offset=
 *   POST /v1/default/banks/{bank}/memories        { items: [{content, context, timestamp, document_id, tags, metadata}], async }
 *   POST /v1/default/banks/{bank}/memories/recall
 *
 * 契约纪律（与 agents/bridge 同构）：
 * - 每请求超时（默认 10s；健康探测 2s），失败统一 ERR-HINDSIGHT-001，调用方降级；
 * - 导入幂等：OPC 记忆卡以 document_id = `opc-memory-<id>` + tag `source:opc` 写入，
 *   重复推送由 Hindsight 按 document_id 覆盖同一文档，不产生重复记忆；
 * - 拉取方向不直接写 OPC 记忆卡：转换为「记忆提案」（pending），由老板确认后落库；
 * - fetchImpl 可注入，单元测试用本地桩服务器验证请求形状与错误映射。
 */
import { OpcError, ERR } from "../platform/errors.ts";

export interface HindsightItem {
  content: string;
  context?: string;
  timestamp?: string;
  document_id?: string;
  tags?: string[];
  metadata?: Record<string, string>;
}

export interface HindsightStats {
  totalNodes: number;
  totalLinks: number;
  totalDocuments: number;
  lastWriteAt: string | null;
  pendingOperations: number;
}

export interface HindsightMemory {
  id: string;
  text: string;
  context: string | null;
  tags: string[];
  state: string;
  factType: string | null;
  date: string | null;
}

export interface HindsightMemoryPage {
  items: HindsightMemory[];
  total: number;
  limit: number;
  offset: number;
}

export interface HindsightBridgeOptions {
  baseUrl?: string;
  bankId?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_BASE = "http://127.0.0.1:28888";
const DEFAULT_BANK = "dsh";
const UNAVAILABLE_HINT = "Hindsight 记忆服务不可达：确认服务已启动（默认 127.0.0.1:28888）";

export class HindsightBridge {
  private readonly baseUrl: string;
  private readonly bankId: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HindsightBridgeOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.bankId = options.bankId?.trim() || DEFAULT_BANK;
    this.apiKey = options.apiKey?.trim() || undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  get bank(): string {
    return this.bankId;
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = init.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (init.body !== undefined) headers["content-type"] = "application/json";
      if (this.apiKey !== undefined) headers.authorization = `Bearer ${this.apiKey}`;
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers,
        signal: controller.signal,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
      const text = await response.text();
      let data: unknown = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new OpcError(ERR.HINDSIGHT_UNAVAILABLE, `Hindsight 响应非 JSON（${path}）`, 502);
      }
      if (!response.ok) {
        const detail = (data as { detail?: string; error?: string }).detail ?? (data as { error?: string }).error ?? `HTTP ${response.status}`;
        throw new OpcError(ERR.HINDSIGHT_UNAVAILABLE, `Hindsight ${path} 失败：${String(detail).slice(0, 200)}`, 502);
      }
      return data as T;
    } catch (error) {
      if (error instanceof OpcError) throw error;
      const reason = error instanceof Error && error.name === "AbortError" ? `超时 ${timeout}ms` : String((error as Error)?.message ?? error);
      throw new OpcError(ERR.HINDSIGHT_UNAVAILABLE, `${UNAVAILABLE_HINT}（${reason}）`, 502);
    } finally {
      clearTimeout(timer);
    }
  }

  /** 健康探测：短超时，供 /health 与面板聚合，不抛错。 */
  async healthSafe(shortTimeoutMs = 2_000): Promise<{ reachable: boolean; error?: string }> {
    try {
      await this.request("/health", { timeoutMs: shortTimeoutMs });
      return { reachable: true };
    } catch (error) {
      return { reachable: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async stats(): Promise<HindsightStats> {
    const data = await this.request<{
      bank_id?: string;
      total_nodes?: number;
      total_links?: number;
      total_documents?: number;
      last_memory_write_at?: string | null;
      pending_operations?: number;
    }>(`/v1/default/banks/${encodeURIComponent(this.bankId)}/stats`);
    return {
      totalNodes: data.total_nodes ?? 0,
      totalLinks: data.total_links ?? 0,
      totalDocuments: data.total_documents ?? 0,
      lastWriteAt: data.last_memory_write_at ?? null,
      pendingOperations: data.pending_operations ?? 0,
    };
  }

  async listMemories(limit = 50, offset = 0): Promise<HindsightMemoryPage> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const data = await this.request<{
      items?: Array<{
        id?: string;
        text?: string;
        context?: string | null;
        tags?: string[];
        state?: string;
        fact_type?: string | null;
        date?: string | null;
      }>;
      total?: number;
      limit?: number;
      offset?: number;
    }>(`/v1/default/banks/${encodeURIComponent(this.bankId)}/memories/list?limit=${safeLimit}&offset=${Math.max(offset, 0)}`);
    return {
      items: (data.items ?? []).map((row) => ({
        id: row.id ?? "",
        text: row.text ?? "",
        context: row.context ?? null,
        tags: row.tags ?? [],
        state: row.state ?? "valid",
        factType: row.fact_type ?? null,
        date: row.date ?? null,
      })),
      total: data.total ?? 0,
      limit: data.limit ?? safeLimit,
      offset: data.offset ?? offset,
    };
  }

  /** 批量导入（异步=false 时等待摄入完成；idempotent 靠 document_id）。 */
  async importItems(items: HindsightItem[], options: { async?: boolean } = {}): Promise<{ accepted: number }> {
    if (items.length === 0) return { accepted: 0 };
    await this.request(`/v1/default/banks/${encodeURIComponent(this.bankId)}/memories`, {
      method: "POST",
      body: { items, async: options.async === true },
    });
    return { accepted: items.length };
  }
}

/** OPC 记忆卡（含敏感标记）→ Hindsight 记忆项：敏感内容不推送。 */
export interface OpcMemoryCard {
  id: number;
  scope: string;
  title: string;
  content: string;
  sourceRefs: string[];
  confidence: number;
  sensitive: boolean;
  createdAt: string | Date;
}

export function cardToItem(card: OpcMemoryCard): HindsightItem | null {
  if (card.sensitive) return null;
  const stamp = card.createdAt instanceof Date ? card.createdAt.toISOString() : String(card.createdAt);
  return {
    content: `【${card.scope}】${card.title}\n${card.content}`,
    context: `OPC-玄机 记忆卡 #${card.id}（来源 ${card.sourceRefs.join("、") || "本机"}）`,
    timestamp: stamp,
    document_id: `opc-memory-${card.id}`,
    tags: ["source:opc", `scope:${card.scope}`],
    metadata: { opc_card_id: String(card.id), scope: card.scope, confidence: String(card.confidence) },
  };
}

export interface PulledProposal {
  type: string;
  title: string;
  content: string;
  sourceRefs: string[];
  confidence: number;
}

/** Hindsight 记忆 → OPC 记忆提案：标题取首行（截断），来源引用 hindsight:<id>。 */
export function itemToProposal(memory: HindsightMemory, defaultType = "experience"): PulledProposal | null {
  const text = memory.text?.trim() ?? "";
  if (text === "") return null;
  const firstLine = text.split("\n")[0].trim();
  const title = firstLine.length > 120 ? firstLine.slice(0, 120) : firstLine;
  const known = ["company_profile", "experience", "skill", "customer", "session_digest"];
  const scopeTag = memory.tags.find((tag) => tag.startsWith("scope:"));
  const scope = scopeTag === undefined ? defaultType : scopeTag.slice("scope:".length);
  return {
    type: known.includes(scope) ? scope : defaultType,
    title: title === "" ? `Hindsight 记忆 ${memory.id}` : title,
    content: text,
    sourceRefs: [`hindsight:${memory.id}`],
    confidence: 0.6,
  };
}
