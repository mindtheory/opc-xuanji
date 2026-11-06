/**
 * 一次性令牌：跨域读取敏感字段的唯一通道。
 *
 * 规则（产品设计 2.2 / 8.2）：绑定单次任务、单字段范围、有效期 ≤ 5 分钟；使用一次即失效；
 * 对外只暴露不可猜测的 token_code；审计只落令牌 ID 与字段名，不落字段值。
 */
import { randomBytes } from "node:crypto";
import type { Pool } from "../db/pool.ts";
import { withTx } from "../db/pool.ts";
import { OpcError, ERR } from "./errors.ts";
import type { AuditService } from "../audit/audit.ts";
import { VIEWS } from "./views.ts";

export const MAX_TTL_SECONDS = 300;

export interface IssueTokenInput {
  taskId: string;
  pluginId: string;
  viewId: string;
  fields: string[];
  customerId?: number;
  ttlSeconds?: number;
}

export interface ConsumeTokenInput {
  taskId: string;
}

export class TokenService {
  private readonly pool: Pool;
  private readonly audit: AuditService;
  private readonly clock: () => Date;

  constructor(pool: Pool, audit: AuditService, clock: () => Date = () => new Date()) {
    this.pool = pool;
    this.audit = audit;
    this.clock = clock;
  }

  async issue(input: IssueTokenInput): Promise<{ tokenId: string; expiresAt: Date }> {
    if (VIEWS[input.viewId] === undefined) throw new OpcError(ERR.VIEW_UNKNOWN, `未注册的视图：${input.viewId}`, 404);
    if (!Array.isArray(input.fields) || input.fields.length === 0) {
      throw new OpcError(ERR.TOKEN_INVALID, "field_scope 不能为空", 400);
    }
    if (input.fields.some((field) => typeof field !== "string" || field.trim() === "")) {
      throw new OpcError(ERR.TOKEN_INVALID, "field_scope 含非法字段名", 400);
    }
    const ttl = input.ttlSeconds ?? MAX_TTL_SECONDS;
    if (!Number.isInteger(ttl) || ttl <= 0 || ttl > MAX_TTL_SECONDS) {
      throw new OpcError(ERR.TOKEN_INVALID, `有效期必须在 1..${MAX_TTL_SECONDS} 秒内`, 400);
    }
    const tokenCode = randomBytes(16).toString("hex");
    const expiresAt = new Date(this.clock().getTime() + ttl * 1000);
    const scope = { viewId: input.viewId, fields: input.fields, customerId: input.customerId ?? null };
    const inserted = await this.pool.query<{ id: number }>(
      `INSERT INTO ref.token (token_code, task_id, plugin_id, scope, expires_at)
       VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id`,
      [tokenCode, input.taskId, input.pluginId, JSON.stringify(scope), expiresAt],
    );
    await this.audit.record({
      actor: input.pluginId,
      action: "token.issue",
      result: "ok",
      objectType: "token",
      objectId: String(inserted.rows[0].id),
      payload: { taskId: input.taskId, viewId: input.viewId, fields: input.fields, ttlSeconds: ttl },
    });
    return { tokenId: tokenCode, expiresAt };
  }

  async consume(tokenCode: string, input: ConsumeTokenInput): Promise<{ tokenId: string; fields: Record<string, string> }> {
    const outcome = await withTx(this.pool, async (client) => {
      const row = await client.query<{ id: number; task_id: string; plugin_id: string; scope: { viewId: string; fields: string[]; customerId: number | null }; expires_at: Date; used: boolean }>(
        "SELECT id, task_id, plugin_id, scope, expires_at, used FROM ref.token WHERE token_code = $1 FOR UPDATE",
        [tokenCode],
      );
      const token = row.rows[0];
      if (token === undefined) return { ok: false as const, reason: "令牌不存在" };
      if (token.used) return { ok: false as const, reason: "令牌已使用" };
      if (token.task_id !== input.taskId) return { ok: false as const, reason: "令牌与任务不匹配" };
      if (new Date(token.expires_at).getTime() <= this.clock().getTime()) return { ok: false as const, reason: "令牌已过期" };
      const fields: Record<string, string> = {};
      if (token.scope.customerId !== null && token.scope.fields.length > 0) {
        const values = await client.query<{ field: string; value: string | null }>(
          "SELECT field, value FROM biz.customer_sensitive WHERE customer_id = $1 AND field = ANY($2::text[])",
          [token.scope.customerId, token.scope.fields],
        );
        for (const item of values.rows) fields[item.field] = item.value ?? "";
      }
      await client.query("UPDATE ref.token SET used = true WHERE id = $1", [token.id]);
      return { ok: true as const, id: token.id, pluginId: token.plugin_id, fields, viewId: token.scope.viewId };
    });

    if (!outcome.ok) {
      await this.audit.record({
        actor: "opc_token",
        action: "token.consume",
        result: "denied",
        objectType: "token",
        payload: { taskId: input.taskId, reason: outcome.reason },
      });
      throw new OpcError(ERR.TOKEN_INVALID, `令牌不可用：${outcome.reason}`, 409);
    }
    await this.audit.record({
      actor: outcome.pluginId,
      action: "token.consume",
      result: "ok",
      objectType: "token",
      objectId: String(outcome.id),
      payload: { taskId: input.taskId, viewId: outcome.viewId, fields: Object.keys(outcome.fields) },
    });
    return { tokenId: tokenCode, fields: outcome.fields };
  }
}
