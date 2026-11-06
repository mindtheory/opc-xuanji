/**
 * 视图级授权（粒度 = 视图，不做字段级）。
 *
 * 约定（产品设计 2.2）：
 * - 视图只返回聚合与索引字段，明细需二次派工；
 * - 敏感字段不落任何共享视图（view_customer_base 只给 sensitivity_level 标记，不 JOIN customer_sensitive）；
 * - 每次访问（通过或拒绝）都写审计，日志不落敏感值。
 */
import type { Pool } from "../db/pool.ts";
import { OpcError, ERR } from "./errors.ts";
import type { AuditService } from "../audit/audit.ts";

export interface ViewDefinition {
  id: string;
  description: string;
  columns: string[];
  build(filter: Record<string, unknown>, limit: number): { text: string; params: unknown[] };
}

const clampLimit = (limit: number | undefined): number => Math.min(Math.max(limit ?? 50, 1), 200);

function single(filter: Record<string, unknown>, key: string): string | null {
  const value = filter[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new OpcError(ERR.VIEW_UNKNOWN, `过滤字段 ${key} 必须是字符串`, 400);
  return value;
}

function assertKeys(filter: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(filter)) {
    if (!allowed.includes(key)) throw new OpcError(ERR.VIEW_UNKNOWN, `视图不支持过滤字段：${key}`, 400);
  }
}

export const VIEWS: Record<string, ViewDefinition> = {
  view_company_profile: {
    id: "view_company_profile",
    description: "公司档案（非敏感字段），全部员工可读",
    columns: ["id", "name", "entity_type", "tax_types", "updated_at"],
    build(filter, limit) {
      assertKeys(filter, []);
      return { text: "SELECT id, name, entity_type, tax_types, updated_at FROM biz.company_profile ORDER BY id LIMIT $1", params: [clampLimit(limit)] };
    },
  },
  view_ar_ap: {
    id: "view_ar_ap",
    description: "应收应付台账（按相对方+状态聚合，明细需二次派工）",
    columns: ["counterparty", "status", "amount_total", "due_min", "items"],
    build(filter, limit) {
      assertKeys(filter, ["status"]);
      return {
        text: `SELECT counterparty, status, sum(amount)::numeric(18,2) AS amount_total, min(due) AS due_min, count(*)::int AS items
               FROM biz.ar_ap WHERE ($1::text IS NULL OR status = $1) GROUP BY counterparty, status
               ORDER BY amount_total DESC LIMIT $2`,
        params: [single(filter, "status"), clampLimit(limit)],
      };
    },
  },
  view_project_status: {
    id: "view_project_status",
    description: "项目阶段/进度/成本汇总",
    columns: ["id", "name", "stage", "progress", "cost_actual"],
    build(filter, limit) {
      assertKeys(filter, ["stage"]);
      return {
        text: `SELECT id, name, stage, progress, cost_actual FROM biz.project
               WHERE ($1::text IS NULL OR stage = $1) ORDER BY progress DESC LIMIT $2`,
        params: [single(filter, "stage"), clampLimit(limit)],
      };
    },
  },
  view_customer_base: {
    id: "view_customer_base",
    description: "客户基础信息（敏感字段不落此视图，仅标 sensitivity_level）",
    columns: ["id", "name", "sensitivity_level", "payment_habit"],
    build(filter, limit) {
      assertKeys(filter, ["sensitivity_level"]);
      return {
        text: `SELECT id, name, sensitivity_level, payment_habit FROM biz.customer
               WHERE ($1::text IS NULL OR sensitivity_level = $1) ORDER BY id LIMIT $2`,
        params: [single(filter, "sensitivity_level"), clampLimit(limit)],
      };
    },
  },
  view_contract_index: {
    id: "view_contract_index",
    description: "合同索引（对方/金额/期限），不含条款正文",
    columns: ["id", "counterparty", "amount", "end_date", "status"],
    build(filter, limit) {
      assertKeys(filter, ["status"]);
      return {
        text: `SELECT id, counterparty, amount, end_date, status FROM biz.contract
               WHERE ($1::text IS NULL OR status = $1) ORDER BY end_date NULLS LAST LIMIT $2`,
        params: [single(filter, "status"), clampLimit(limit)],
      };
    },
  },
  view_stock_index: {
    id: "view_stock_index",
    description: "SKU 与库存汇总",
    columns: ["id", "name", "unit", "qty_on_hand", "safety_stock"],
    build(filter, limit) {
      assertKeys(filter, []);
      return {
        text: `SELECT s.id, s.name, s.unit,
                 coalesce(sum(CASE t.txn_type WHEN 'in' THEN t.qty WHEN 'out' THEN -t.qty ELSE t.qty END), 0)::numeric(18,2) AS qty_on_hand,
                 s.safety_stock
               FROM biz.sku s LEFT JOIN biz.stock_txn t ON t.sku_id = s.id
               GROUP BY s.id, s.name, s.unit, s.safety_stock ORDER BY s.id LIMIT $1`,
        params: [clampLimit(limit)],
      };
    },
  },
  view_vehicle_index: {
    id: "view_vehicle_index",
    description: "车辆与用车汇总（费用明细脱敏为汇总）",
    columns: ["plate", "trips", "km_total", "subsidy_total"],
    build(filter, limit) {
      assertKeys(filter, ["plate"]);
      return {
        text: `SELECT plate, count(*)::int AS trips, sum(km)::numeric(18,2) AS km_total,
                 sum(coalesce(subsidy, 0))::numeric(18,2) AS subsidy_total
               FROM biz.vehicle_log WHERE ($1::text IS NULL OR plate = $1) GROUP BY plate ORDER BY plate LIMIT $2`,
        params: [single(filter, "plate"), clampLimit(limit)],
      };
    },
  },
  view_okr: {
    id: "view_okr",
    description: "目标与关键结果（全部只读）",
    columns: ["id", "name", "key_results", "period"],
    build(filter, limit) {
      assertKeys(filter, ["period"]);
      return {
        text: `SELECT id, name, key_results, period FROM biz.objective
               WHERE ($1::text IS NULL OR period = $1) ORDER BY id LIMIT $2`,
        params: [single(filter, "period"), clampLimit(limit)],
      };
    },
  },
};

export function knownViewIds(): string[] {
  return Object.keys(VIEWS);
}

export interface ViewQueryInput {
  pluginId: string;
  viewId: string;
  filter?: Record<string, unknown>;
  limit?: number;
}

export interface ViewQueryResult {
  viewId: string;
  rows: Record<string, unknown>[];
  rowCount: number;
}

export class ViewService {
  private readonly pool: Pool;
  private readonly audit: AuditService;

  constructor(pool: Pool, audit: AuditService) {
    this.pool = pool;
    this.audit = audit;
  }

  async query(input: ViewQueryInput): Promise<ViewQueryResult> {
    const view = VIEWS[input.viewId];
    if (view === undefined) {
      throw new OpcError(ERR.VIEW_UNKNOWN, `未注册的视图：${input.viewId}`, 404);
    }
    const filter = input.filter ?? {};
    const employee = await this.pool.query(
      "SELECT plugin_id FROM ref.employee_plugin WHERE plugin_id = $1 AND enabled",
      [input.pluginId],
    );
    const grant = await this.pool.query(
      "SELECT 1 FROM ref.view_grant WHERE view_id = $1 AND plugin_id = $2 AND status = 'active'",
      [input.viewId, input.pluginId],
    );
    const allowed = employee.rows.length > 0 && grant.rows.length > 0;
    if (!allowed) {
      await this.audit.record({
        actor: input.pluginId,
        action: "view.query",
        result: "denied",
        objectType: "view",
        objectId: input.viewId,
        payload: { pluginId: input.pluginId, filter },
      });
      throw new OpcError(ERR.AUTHZ_DENIED, `${input.pluginId} 未获授权访问 ${input.viewId}`, 403, {
        viewId: input.viewId,
        pluginId: input.pluginId,
      });
    }

    const built = view.build(filter, input.limit ?? 50);
    const rows = (await this.pool.query(built.text, built.params)).rows as Record<string, unknown>[];
    await this.audit.record({
      actor: input.pluginId,
      action: "view.query",
      result: "ok",
      objectType: "view",
      objectId: input.viewId,
      payload: { pluginId: input.pluginId, filter, rowCount: rows.length },
    });
    return { viewId: input.viewId, rows, rowCount: rows.length };
  }
}
