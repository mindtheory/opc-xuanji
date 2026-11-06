/**
 * 中枢 Verifier 封装层：多数票 + 置信度 + evidence_hash 去重 + 高影响节点升级人工。
 *
 * 口径（产品设计 8.6.3 / 架构 3.2/3.3）：
 * - 采样投票只适用于“有可分辨差异”的场景；高影响节点若三票分裂或低于阈值，一律升级人工，不自动通过；
 * - evidence_hash 命中只省调用，不改判定：返回首次完整采样的 verdict；
 * - 绝对口径是 verdict/confidence，不把相对排名当结论。
 */
import { createHash } from "node:crypto";
import type { Pool } from "../db/pool.ts";
import { OpcError, ERR } from "../platform/errors.ts";
import type { AuditService } from "../audit/audit.ts";
import { canonicalJson } from "../platform/json.ts";

export type SampleVerdict = "pass" | "fail";

export interface AggregatedVerdict {
  finalVerdict: "pass" | "fail" | "escalated";
  confidence: number;
  escalated: boolean;
}

export interface JudgeInput {
  instanceId?: number;
  nodeId: string;
  samples: SampleVerdict[];
  evidence: Record<string, unknown>;
  highImpact: boolean;
  threshold?: number;
}

export interface JudgeResult extends AggregatedVerdict {
  verdictId: number;
  cacheHit: boolean;
  evidenceHash: string;
  sampling: number;
}

export const DEFAULT_THRESHOLD = 0.8;

/** 纯聚合：多数票 + 高影响节点低一致/低置信升级。 */
export function aggregateSamples(samples: SampleVerdict[], threshold: number, highImpact: boolean): AggregatedVerdict {
  if (samples.length === 0) throw new OpcError(ERR.WF_GUARD_FAILED, "Verifier 采样不能为空", 400);
  const pass = samples.filter((sample) => sample === "pass").length;
  const fail = samples.length - pass;
  const confidence = Math.round((Math.max(pass, fail) / samples.length) * 10_000) / 10_000;
  const split = pass > 0 && fail > 0;
  const escalated = highImpact && (split || confidence < threshold);
  const finalVerdict: "pass" | "fail" | "escalated" = escalated ? "escalated" : pass >= fail ? "pass" : "fail";
  return { finalVerdict, confidence, escalated };
}

export class Verifier {
  private readonly pool: Pool;
  private readonly audit: AuditService;

  constructor(pool: Pool, audit: AuditService) {
    this.pool = pool;
    this.audit = audit;
  }

  async judge(input: JudgeInput): Promise<JudgeResult> {
    const evidenceHash = createHash("sha256").update(canonicalJson(input.evidence), "utf8").digest("hex");
    const threshold = input.threshold ?? DEFAULT_THRESHOLD;
    const cached = await this.pool.query<{ id: number; verdict: "pass" | "fail" | "escalated"; confidence: string; escalated: boolean }>(
      "SELECT id, verdict, confidence, escalated FROM audit.verifier_verdict WHERE evidence_hash = $1 AND node_id = $2 ORDER BY id DESC LIMIT 1",
      [evidenceHash, input.nodeId],
    );
    if (cached.rows.length > 0) {
      const row = cached.rows[0];
      await this.audit.record({
        actor: "opc_verifier",
        action: "verifier.judge",
        result: "ok",
        objectType: "verifier",
        objectId: String(row.id),
        workflowInstanceId: input.instanceId ?? null,
        payload: { nodeId: input.nodeId, cacheHit: true, evidenceHash },
      });
      return {
        verdictId: row.id,
        finalVerdict: row.verdict,
        confidence: Number(row.confidence),
        escalated: row.escalated,
        cacheHit: true,
        evidenceHash,
        sampling: input.samples.length,
      };
    }

    const aggregated = aggregateSamples(input.samples, threshold, input.highImpact);
    const inserted = await this.pool.query<{ id: number }>(
      `INSERT INTO audit.verifier_verdict (instance_id, node_id, verdict, sampling, confidence, evidence_hash, escalated)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        input.instanceId ?? null,
        input.nodeId,
        aggregated.finalVerdict,
        input.samples.length,
        aggregated.confidence,
        evidenceHash,
        aggregated.escalated,
      ],
    );
    await this.audit.record({
      actor: "opc_verifier",
      action: "verifier.judge",
      result: "ok",
      objectType: "verifier",
      objectId: String(inserted.rows[0].id),
      workflowInstanceId: input.instanceId ?? null,
      payload: {
        nodeId: input.nodeId,
        samples: input.samples,
        confidence: aggregated.confidence,
        escalated: aggregated.escalated,
        evidenceHash,
      },
    });
    return { ...aggregated, verdictId: inserted.rows[0].id, cacheHit: false, evidenceHash, sampling: input.samples.length };
  }
}
