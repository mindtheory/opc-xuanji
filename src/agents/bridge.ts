/**
 * Super Agent 桥（OPC-SDD-003 §4）：opc-xuanji 依赖 dsh-super-agents 的唯一跨层出口。
 *
 * 契约纪律：
 * - 只走回环 HTTP（/api/dsh-super-agents/*），无凭据、无进程内直调（依赖方向单向）；
 * - 每请求超时（默认 8s），连接失败/非 2xx 统一抛 OpcError(ERR.AGENT_UNAVAILABLE)，
 *   调用方（工具层）转成对用户可读的降级文案，绝不拖垮中枢其余功能；
 * - upsertAgent 以 agent 名为键幂等（先 list 后 create/update）；
 * - fetchImpl 可注入，单元测试用本地桩服务器验证请求形状与错误映射。
 */
import { OpcError, ERR } from "../platform/errors.ts";

export interface BridgeAgentRow {
  id: string;
  name: string;
  systemRole?: string;
  model?: string;
  cwd?: string;
  learn?: boolean;
  enabled?: boolean;
}

export interface BridgeHealth {
  ok: boolean;
  paused: boolean;
  problems: { name: string; level: string; note: string }[];
  health: { name: string; level: string; note: string }[];
  queue: number;
  active: number;
}

export interface BridgeRunRow {
  id: string;
  agentId: string;
  kind: string;
  status: string;
  createdAt: string;
  endedAt?: string;
  error?: string;
  resultHead?: string;
}

export interface BridgeRunDetail {
  run: BridgeRunRow;
  artifact: string;
  logTail: string;
}

export interface BridgeOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_BASE = "http://127.0.0.1:3081";
const UNAVAILABLE_HINT = "dsh-super-agents 不可达：确认它已安装并在同一 web profile 启用（默认回环 3081）";

export class SuperAgentsBridge {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: BridgeOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  /** 健康板；不可达时返回 reachable:false（供 /health 聚合，不抛错）。短超时，避免拖慢健康检查。 */
  async healthSafe(shortTimeoutMs = 2_000): Promise<{ reachable: boolean; paused?: boolean; problems?: BridgeHealth["problems"]; queue?: number; active?: number; error?: string }> {
    try {
      const h = await this.request<BridgeHealth>("/api/dsh-super-agents/health", { timeoutMs: shortTimeoutMs });
      return { reachable: true, paused: h.paused, problems: h.problems, queue: h.queue, active: h.active };
    } catch (error) {
      return { reachable: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** 底层请求：超时 + 错误码归一。非 2xx / 网络失败一律 ERR-AGENT-001。 */
  private async request<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = init.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method ?? "GET",
        signal: controller.signal,
        ...(init.body !== undefined
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }
          : {}),
      });
      const text = await response.text();
      let data: unknown = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new OpcError(ERR.AGENT_UNAVAILABLE, `dsh-super-agents 响应非 JSON（${path}）`, 502);
      }
      if (!response.ok) {
        const detail = (data as { error?: string }).error ?? `HTTP ${response.status}`;
        throw new OpcError(ERR.AGENT_UNAVAILABLE, `dsh-super-agents ${path} 失败：${detail}`, 502);
      }
      return data as T;
    } catch (error) {
      if (error instanceof OpcError) throw error;
      const reason = error instanceof Error && error.name === "AbortError" ? `超时 ${this.timeoutMs}ms` : String((error as Error)?.message ?? error);
      throw new OpcError(ERR.AGENT_UNAVAILABLE, `${UNAVAILABLE_HINT}（${reason}）`, 502);
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<BridgeHealth> {
    return this.request<BridgeHealth>("/api/dsh-super-agents/health");
  }

  async listAgents(): Promise<BridgeAgentRow[]> {
    const data = await this.request<{ agents: BridgeAgentRow[] }>("/api/dsh-super-agents/state");
    return data.agents ?? [];
  }

  /** 运行记录（按 agentId 过滤可选；只读）。 */
  async runs(agentId?: string): Promise<BridgeRunRow[]> {
    const data = await this.request<{ runs?: BridgeRunRow[] }>("/api/dsh-super-agents/state");
    const runs = data.runs ?? [];
    return agentId === undefined ? runs : runs.filter((r) => r.agentId === agentId);
  }

  /** 以 name 为键幂等 upsert：存在则 update，否则 create。 */
  async upsertAgent(input: { name: string; systemRole: string; model?: string; cwd?: string; learn?: boolean }): Promise<BridgeAgentRow> {
    const existing = (await this.listAgents()).find((a) => a.name === input.name);
    const body = existing
      ? { id: existing.id, ...input }
      : input;
    const data = await this.request<{ ok: boolean; agent: BridgeAgentRow }>("/api/dsh-super-agents/agent-save", {
      method: "POST",
      body,
    });
    return data.agent;
  }

  async dispatch(agentId: string, prompt: string): Promise<{ runId: string }> {
    return this.request<{ ok: boolean; runId: string }>("/api/dsh-super-agents/run", {
      method: "POST",
      body: { agentId, prompt },
    });
  }

  async runDetail(runId: string): Promise<BridgeRunDetail> {
    return this.request<BridgeRunDetail>(`/api/dsh-super-agents/run-detail?runId=${encodeURIComponent(runId)}`);
  }

  /** 全局暂停/恢复认知调度（确定性 SQL 任务不受影响，SDD-003 §7）。 */
  async setPaused(paused: boolean): Promise<void> {
    // 基础设施层的 pause/resume 走 sa_health 工具；HTTP 面用 state 观察。
    // 桥侧提供 pause 端点兼容：若插件未提供则抛 AGENT_UNAVAILABLE。
    await this.request("/api/dsh-super-agents/pause", { method: "POST", body: { paused } });
  }
}
