/**
 * 流程实例与幂等写节点。
 *
 * 幂等键 = instance_id + node_id（产品设计 8.6.5）：
 * 同键同入参 → 返回既有结果（idempotentHit=true），不重复入库；
 * 同键异入参 → ERR-WF-004（409），写审计。
 */
import { createHash } from "node:crypto";
import type { Pool } from "../db/pool.ts";
import { withTx } from "../db/pool.ts";
import { OpcError, ERR } from "../platform/errors.ts";
import type { AuditService } from "../audit/audit.ts";
import { canonicalJson } from "../platform/json.ts";
import { WorkflowRegistry } from "./registry.ts";

export interface StartInput {
  workflowId: string;
  version?: string;
  context?: Record<string, unknown>;
}

export interface InstanceResult {
  instanceId: number;
  workflowId: string;
  version: string;
  status: string;
  deadlineImpact: boolean;
}

export interface InstanceListRow {
  id: number;
  workflow_id: string;
  version: string;
  status: string;
  deadline_impact: boolean;
  started_at: Date;
  ended_at: Date | null;
}

export interface NodeRunRow {
  node_id: string;
  idempotency_key: string;
  status: string;
  output: unknown;
  started_at: Date;
  ended_at: Date | null;
}

export class WorkflowRunner {
  private readonly pool: Pool;
  private readonly audit: AuditService;
  private readonly registry: WorkflowRegistry;

  constructor(pool: Pool, audit: AuditService, registry?: WorkflowRegistry) {
    this.pool = pool;
    this.audit = audit;
    this.registry = registry ?? new WorkflowRegistry(pool, audit);
  }

  async start(input: StartInput): Promise<InstanceResult> {
    const definition = await this.registry.get(input.workflowId, input.version);
    const deadlineImpact = definition.meta?.deadline_impact === true;
    const inserted = await this.pool.query<{ id: number; status: string }>(
      `INSERT INTO audit.workflow_instance (workflow_id, version, status, deadline_impact)
       VALUES ($1,$2,'running',$3) RETURNING id, status`,
      [input.workflowId, definition.version, deadlineImpact],
    );
    const instanceId = inserted.rows[0].id;
    await this.audit.record({
      actor: "opc_hub",
      action: "workflow.instance.start",
      result: "ok",
      objectType: "workflow_instance",
      objectId: String(instanceId),
      workflowInstanceId: instanceId,
      payload: { workflowId: input.workflowId, version: definition.version, context: input.context ?? null },
    });
    return {
      instanceId,
      workflowId: input.workflowId,
      version: definition.version,
      status: inserted.rows[0].status,
      deadlineImpact,
    };
  }

  async completeNode(input: { instanceId: number; nodeId: string; payload: Record<string, unknown> }): Promise<{ nodeId: string; status: string; idempotentHit: boolean; output: unknown }> {
    const payloadHash = createHash("sha256").update(canonicalJson(input.payload), "utf8").digest("hex");
    const idempotencyKey = `${input.instanceId}:${input.nodeId}`;
    const outcome = await withTx(this.pool, async (client) => {
      const instance = await client.query("SELECT 1 FROM audit.workflow_instance WHERE id = $1 FOR UPDATE", [input.instanceId]);
      if (instance.rows.length === 0) {
        throw new OpcError(ERR.WF_NOT_FOUND, `流程实例不存在：${input.instanceId}`, 404);
      }
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO audit.workflow_node_run (instance_id, node_id, idempotency_key, status, payload_hash, output, started_at, ended_at)
         VALUES ($1,$2,$3,'done',$4,$5::jsonb, now(), now())
         ON CONFLICT (instance_id, node_id) DO NOTHING RETURNING id`,
        [input.instanceId, input.nodeId, idempotencyKey, payloadHash, JSON.stringify(input.payload)],
      );
      if (inserted.rowCount === 1) {
        return { hit: false as const, output: input.payload };
      }
      const existing = await client.query<{ payload_hash: string; output: unknown }>(
        "SELECT payload_hash, output FROM audit.workflow_node_run WHERE instance_id = $1 AND node_id = $2",
        [input.instanceId, input.nodeId],
      );
      const row = existing.rows[0];
      if (row !== undefined && row.payload_hash === payloadHash) {
        return { hit: true as const, output: row.output };
      }
      return { hit: false as const, conflict: true as const };
    });

    if ("conflict" in outcome) {
      await this.audit.record({
        actor: "opc_hub",
        action: "workflow.node.reject",
        result: "denied",
        objectType: "workflow_node",
        objectId: idempotencyKey,
        workflowInstanceId: input.instanceId,
        payload: { nodeId: input.nodeId, reason: "idempotency_mismatch", payloadHash },
      });
      throw new OpcError(ERR.WF_IDEMPOTENCY, `幂等键冲突且入参不同：${idempotencyKey}`, 409);
    }
    if (!outcome.hit) {
      await this.audit.record({
        actor: "opc_hub",
        action: "workflow.node.done",
        result: "ok",
        objectType: "workflow_node",
        objectId: idempotencyKey,
        workflowInstanceId: input.instanceId,
        payload: { nodeId: input.nodeId, payloadHash },
      });
    }
    return { nodeId: input.nodeId, status: "done", idempotentHit: outcome.hit, output: outcome.output };
  }

  /** 只读列表：运维/驾驶舱用（可按 workflowId 过滤）。 */
  async list(workflowId?: string, limit = 100): Promise<InstanceListRow[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const result =
      workflowId === undefined
        ? await this.pool.query<InstanceListRow>(
            `SELECT id, workflow_id, version, status, deadline_impact, started_at, ended_at
             FROM audit.workflow_instance ORDER BY started_at DESC, id DESC LIMIT $1`,
            [safeLimit],
          )
        : await this.pool.query<InstanceListRow>(
            `SELECT id, workflow_id, version, status, deadline_impact, started_at, ended_at
             FROM audit.workflow_instance WHERE workflow_id = $1 ORDER BY started_at DESC, id DESC LIMIT $2`,
            [workflowId, safeLimit],
          );
    return result.rows;
  }

  /** 只读详情：实例 + 节点运行记录（运维/驾驶舱用）。 */
  async get(instanceId: number): Promise<{ instance: InstanceListRow; nodes: NodeRunRow[] }> {
    const instance = await this.pool.query<InstanceListRow>(
      `SELECT id, workflow_id, version, status, deadline_impact, started_at, ended_at
       FROM audit.workflow_instance WHERE id = $1`,
      [instanceId],
    );
    const row = instance.rows[0];
    if (row === undefined) throw new OpcError(ERR.WF_NOT_FOUND, `实例不存在：${instanceId}`, 404);
    const nodes = await this.pool.query<NodeRunRow>(
      `SELECT node_id, idempotency_key, status, output, started_at, ended_at
       FROM audit.workflow_node_run WHERE instance_id = $1 ORDER BY id`,
      [instanceId],
    );
    return { instance: row, nodes: nodes.rows };
  }

  async finish(instanceId: number, status: "completed" | "failed" | "blocked" | "awaiting_decision" = "completed"): Promise<{ instanceId: number; status: string }> {
    const updated = await this.pool.query(
      "UPDATE audit.workflow_instance SET status = $1, ended_at = now() WHERE id = $2 AND status = 'running'",
      [status, instanceId],
    );
    if (updated.rowCount === 0) throw new OpcError(ERR.WF_NOT_FOUND, `实例不存在或已结束：${instanceId}`, 404);
    await this.audit.record({
      actor: "opc_hub",
      action: "workflow.instance.finish",
      result: "ok",
      objectType: "workflow_instance",
      objectId: String(instanceId),
      workflowInstanceId: instanceId,
      payload: { status },
    });
    return { instanceId, status };
  }
}
