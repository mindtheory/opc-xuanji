/**
 * 冲突冻结与裁决。
 *
 * 口径（产品设计 2.3 / 8.3）：冻结单元 = 最适宜老板评判的业务事件；
 * 汇总查询「不剔除」冻结记录，返回 total_including_frozen 与 frozen_items，
 * 由渲染层生成“总额（含冻结）+ 脚注”；裁决后清除冻结标记并写裁决记录。
 */
import type { Pool } from "../db/pool.ts";
import { withTx } from "../db/pool.ts";
import { OpcError, ERR } from "./errors.ts";
import type { AuditService } from "../audit/audit.ts";

const UNITS: Record<string, { table: string; amount: string }> = {
  ledger: { table: "biz.ledger", amount: "amount" },
  contract: { table: "biz.contract", amount: "coalesce(amount, 0)" },
  stock_txn: { table: "biz.stock_txn", amount: "coalesce(qty * unit_price, 0)" },
  vehicle_log: { table: "biz.vehicle_log", amount: "coalesce(subsidy, 0)" },
};

const CONFLICT_TYPES = new Set(["cost", "customer", "stock_batch", "contract_amount"]);

export interface OpenConflictInput {
  conflictType: string;
  frozenUnitType: string;
  frozenUnitId: number;
  parties: unknown[];
  diffFields?: string[];
  note?: string;
}

export interface ConflictRow {
  id: number;
  conflict_type: string;
  frozen_unit_type: string;
  frozen_unit_id: number;
  parties: unknown;
  diff_fields: unknown;
  detected_at: Date;
  status: string;
}

export interface ConflictSummary {
  total_including_frozen: number;
  effective_total: number;
  frozen_items: number[];
}

export class ConflictService {
  private readonly pool: Pool;
  private readonly audit: AuditService;

  constructor(pool: Pool, audit: AuditService) {
    this.pool = pool;
    this.audit = audit;
  }

  /** 只读列表：运维/驾驶舱用（可按 status 过滤）。 */
  async list(status?: string): Promise<ConflictRow[]> {
    const result =
      status === undefined
        ? await this.pool.query<ConflictRow>(
            `SELECT id, conflict_type, frozen_unit_type, frozen_unit_id, parties, diff_fields, detected_at, status
             FROM biz.conflict_queue ORDER BY detected_at DESC, id DESC LIMIT 200`,
          )
        : await this.pool.query<ConflictRow>(
            `SELECT id, conflict_type, frozen_unit_type, frozen_unit_id, parties, diff_fields, detected_at, status
             FROM biz.conflict_queue WHERE status = $1 ORDER BY detected_at DESC, id DESC LIMIT 200`,
            [status],
          );
    return result.rows;
  }

  async open(input: OpenConflictInput): Promise<{ conflictId: number; status: string; frozen: boolean }> {
    if (!CONFLICT_TYPES.has(input.conflictType)) {
      throw new OpcError(ERR.CONFLICT_INVALID, `未知冲突类型：${input.conflictType}`, 400);
    }
    const unit = UNITS[input.frozenUnitType];
    if (unit === undefined) {
      throw new OpcError(ERR.CONFLICT_INVALID, `不支持的冻结单元：${input.frozenUnitType}`, 400);
    }
    if (!Array.isArray(input.parties) || input.parties.length < 2) {
      throw new OpcError(ERR.CONFLICT_INVALID, "冲突至少需要两方证据", 400);
    }
    return withTx(this.pool, async (client) => {
      const frozenUnit = await client.query(`SELECT 1 FROM ${unit.table} WHERE id = $1 FOR UPDATE`, [input.frozenUnitId]);
      if (frozenUnit.rows.length === 0) {
        throw new OpcError(ERR.CONFLICT_INVALID, `冻结单元不存在：${input.frozenUnitType}#${input.frozenUnitId}`, 404);
      }
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO biz.conflict_queue (conflict_type, frozen_unit_type, frozen_unit_id, parties, diff_fields, status)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'open') RETURNING id`,
        [
          input.conflictType,
          input.frozenUnitType,
          input.frozenUnitId,
          JSON.stringify(input.parties),
          JSON.stringify(input.diffFields ?? []),
        ],
      );
      await client.query(`UPDATE ${unit.table} SET conflict_frozen = true WHERE id = $1`, [input.frozenUnitId]);
      const conflictId = inserted.rows[0].id;
      await this.audit.record({
        actor: "opc_hub",
        action: "conflict.open",
        result: "ok",
        objectType: "conflict",
        objectId: String(conflictId),
        payload: { ...input, note: input.note ?? null },
      });
      return { conflictId, status: "open", frozen: true };
    });
  }

  async resolve(conflictId: number, input: { choice: string; manualValue?: unknown; note?: string }): Promise<{ conflictId: number; status: string; frozen: boolean }> {
    if (!["A", "B", "manual", "later"].includes(input.choice)) {
      throw new OpcError(ERR.CONFLICT_INVALID, `裁决选项非法：${input.choice}`, 400);
    }
    return withTx(this.pool, async (client) => {
      const found = await client.query<{ id: number; frozen_unit_type: string; frozen_unit_id: number; status: string; parties: unknown }>(
        "SELECT id, frozen_unit_type, frozen_unit_id, status, parties FROM biz.conflict_queue WHERE id = $1 FOR UPDATE",
        [conflictId],
      );
      const conflict = found.rows[0];
      if (conflict === undefined) throw new OpcError(ERR.CONFLICT_INVALID, `冲突不存在：${conflictId}`, 404);
      if (conflict.status === "resolved") return { conflictId, status: "resolved", frozen: false };
      if (input.choice === "later") {
        await client.query("UPDATE biz.conflict_queue SET status = 'later' WHERE id = $1", [conflictId]);
        await this.audit.record({
          actor: "boss",
          action: "conflict.defer",
          result: "ok",
          objectType: "conflict",
          objectId: String(conflictId),
          payload: { note: input.note ?? null },
        });
        return { conflictId, status: "later", frozen: true };
      }
      const decision = await client.query<{ id: number }>(
        `INSERT INTO biz.decision (decided_on, context, choices, chosen, rationale)
         VALUES (current_date, $1, $2::jsonb, $3, $4) RETURNING id`,
        [`冲突裁决 #${conflictId}（${conflict.frozen_unit_type}#${conflict.frozen_unit_id}）`, JSON.stringify(conflict.parties), input.choice, input.note ?? null],
      );
      const unit = UNITS[conflict.frozen_unit_type];
      if (unit !== undefined) {
        await client.query(`UPDATE ${unit.table} SET conflict_frozen = false WHERE id = $1`, [conflict.frozen_unit_id]);
      }
      await client.query(
        "UPDATE biz.conflict_queue SET status = 'resolved', arbitration_id = $1 WHERE id = $2",
        [decision.rows[0].id, conflictId],
      );
      await this.audit.record({
        actor: "boss",
        action: "conflict.resolve",
        result: "ok",
        objectType: "conflict",
        objectId: String(conflictId),
        payload: { choice: input.choice, decisionId: decision.rows[0].id, note: input.note ?? null },
      });
      return { conflictId, status: "resolved", frozen: false };
    });
  }

  async summaryIncludingFrozen(frozenUnitType: string): Promise<ConflictSummary> {
    const unit = UNITS[frozenUnitType];
    if (unit === undefined) throw new OpcError(ERR.CONFLICT_INVALID, `不支持的冻结单元：${frozenUnitType}`, 400);
    const result = await this.pool.query<{ total_including_frozen: string; effective_total: string; frozen_items: number[] }>(
      `SELECT coalesce(sum(${unit.amount}), 0)::text AS total_including_frozen,
              coalesce(sum(${unit.amount}) FILTER (WHERE NOT conflict_frozen), 0)::text AS effective_total,
              coalesce(json_agg(id) FILTER (WHERE conflict_frozen), '[]'::json) AS frozen_items
       FROM ${unit.table}`,
    );
    const row = result.rows[0];
    return {
      total_including_frozen: Number(row.total_including_frozen),
      effective_total: Number(row.effective_total),
      frozen_items: row.frozen_items ?? [],
    };
  }
}
