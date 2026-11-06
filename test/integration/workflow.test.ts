/**
 * Workflow Registry / 实例幂等 / Verifier 集成测试（真实 PG / opc_test）。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Pool } from "../../src/db/pool.ts";
import { makePool, resetDb, seedEmployee } from "../helpers.ts";
import { AuditService } from "../../src/audit/audit.ts";
import { WorkflowRegistry } from "../../src/workflow/registry.ts";
import { WorkflowRunner } from "../../src/workflow/instances.ts";
import { Verifier, aggregateSamples } from "../../src/workflow/verifier.ts";
import type { WorkflowMeta } from "../../src/workflow/guard.ts";
import { OpcError } from "../../src/platform/errors.ts";

let pool: Pool;
let audit: AuditService;
let registry: WorkflowRegistry;
let runner: WorkflowRunner;

const CODE = "export const meta = { id: 'tax_monthly_prepare' };\n";
const CODE_HASH = createHash("sha256").update(CODE, "utf8").digest("hex");

function meta(overrides: Partial<WorkflowMeta> = {}): WorkflowMeta {
  return {
    id: "tax_monthly_prepare",
    version: "1.0.0",
    name: "月度税务申报准备",
    owner_plugin: "opc_finance",
    scope: "single" as const,
    required_views: ["view_ar_ap"],
    key_nodes: ["collect_invoices", "reconcile", "tax_calc", "review_gate"],
    human_gates: ["review_gate"],
    human_gate_policy: { review_gate: { timeout_policy: "hold" } },
    deadline_impact: true,
    idempotent_nodes: ["write_ledger"],
    write_nodes: ["write_ledger"],
    tools: ["opc_ledger_write"],
    verifier_policy: { reconcile: { sampling: 3, confidence_threshold: 0.8 } },
    ...overrides,
  };
}

before(async () => {
  pool = makePool();
  audit = new AuditService(pool, { schemaVersion: "1" });
  registry = new WorkflowRegistry(pool, audit);
  runner = new WorkflowRunner(pool, audit);
  await seedEmployee(pool, "opc_finance", {
    views: ["view_ar_ap"],
    tools: ["opc_ledger_write"],
    writeTargets: ["ledger"],
  });
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDb(pool);
  await seedEmployee(pool, "opc_finance", {
    views: ["view_ar_ap"],
    tools: ["opc_ledger_write"],
    writeTargets: ["ledger"],
  });
});

test("注册：守卫通过则记录硬规则风险等级（high）", async () => {
  const result = await registry.register({
    workflowId: "tax_monthly_prepare",
    version: "1.0.0",
    ownerPlugin: "opc_finance",
    meta: meta(),
    code: CODE,
    testedCodeHash: CODE_HASH,
  });
  assert.equal(result.riskLevel, "high");
  assert.equal(result.status, "registered");

  const row = await pool.query<{ risk_level: string; code_hash: string; meta: Record<string, unknown> }>(
    "SELECT risk_level, code_hash, meta FROM ref.workflow_registry WHERE workflow_id = $1 AND version = $2",
    ["tax_monthly_prepare", "1.0.0"],
  );
  assert.equal(row.rows[0].risk_level, "high");
  assert.equal(row.rows[0].code_hash, CODE_HASH);
  assert.equal(Object.hasOwn(row.rows[0].meta, "risk_level"), false);
});

test("注册：守卫失败拒绝写入并返回逐项失败原因", async () => {
  await assert.rejects(
    () => registry.register({ workflowId: "bad_flow", version: "1.0.0", ownerPlugin: "opc_finance", meta: meta({ risk_level: "low" }), code: CODE, testedCodeHash: CODE_HASH }),
    (error: unknown) => error instanceof OpcError && error.errorCode === "ERR-WF-001" && Array.isArray((error.details as { failures: unknown[] }).failures),
  );
  const rows = await pool.query("SELECT 1 FROM ref.workflow_registry WHERE workflow_id = 'bad_flow'");
  assert.equal(rows.rows.length, 0);

  const audits = await audit.list({ action: "workflow.register", limit: 10 });
  assert.equal(audits.rows[0].result, "denied");
});

test("注册：同版本重复注册返回 409（版本不可变）", async () => {
  const input = { workflowId: "tax_monthly_prepare", version: "1.0.0", ownerPlugin: "opc_finance", meta: meta(), code: CODE, testedCodeHash: CODE_HASH };
  await registry.register(input);
  await assert.rejects(
    () => registry.register(input),
    (error: unknown) => error instanceof OpcError && error.errorCode === "ERR-WF-002",
  );
});

test("实例：写节点幂等（同入参跳过、异入参 409），生命周期可查", async () => {
  await registry.register({ workflowId: "tax_monthly_prepare", version: "1.0.0", ownerPlugin: "opc_finance", meta: meta(), code: CODE, testedCodeHash: CODE_HASH });
  const instance = await runner.start({ workflowId: "tax_monthly_prepare", version: "1.0.0", context: { period: "2026-10" } });
  assert.equal(instance.status, "running");

  const first = await runner.completeNode({ instanceId: instance.instanceId, nodeId: "write_ledger", payload: { amount: 1200 } });
  assert.equal(first.idempotentHit, false);
  assert.equal(first.status, "done");

  const second = await runner.completeNode({ instanceId: instance.instanceId, nodeId: "write_ledger", payload: { amount: 1200 } });
  assert.equal(second.idempotentHit, true);
  assert.equal(second.status, "done");

  await assert.rejects(
    () => runner.completeNode({ instanceId: instance.instanceId, nodeId: "write_ledger", payload: { amount: 9999 } }),
    (error: unknown) => error instanceof OpcError && error.errorCode === "ERR-WF-004",
  );

  const done = await runner.finish(instance.instanceId, "completed");
  assert.equal(done.status, "completed");

  const nodeRuns = await pool.query("SELECT idempotency_key FROM audit.workflow_node_run WHERE instance_id = $1", [instance.instanceId]);
  assert.equal(nodeRuns.rows.length, 1);
  assert.equal(nodeRuns.rows[0].idempotency_key, `${instance.instanceId}:write_ledger`);
});

test("实例：未注册流程启动返回 404", async () => {
  await assert.rejects(
    () => runner.start({ workflowId: "not_exists", version: "1.0.0" }),
    (error: unknown) => error instanceof OpcError && error.errorCode === "ERR-WF-003",
  );
});

test("Verifier：多数票 + 高影响节点低一致升级人工 + evidence 缓存", async () => {
  await registry.register({ workflowId: "tax_monthly_prepare", version: "1.0.0", ownerPlugin: "opc_finance", meta: meta(), code: CODE, testedCodeHash: CODE_HASH });
  const instance = await runner.start({ workflowId: "tax_monthly_prepare", version: "1.0.0" });
  const verifier = new Verifier(pool, audit);

  const consistent = await verifier.judge({
    instanceId: instance.instanceId,
    nodeId: "reconcile",
    samples: ["pass", "pass", "pass"],
    evidence: { invoice_total: 1200, ledger_total: 1200, diff_count: 0 },
    highImpact: true,
  });
  assert.equal(consistent.finalVerdict, "pass");
  assert.equal(consistent.confidence, 1);
  assert.equal(consistent.escalated, false);
  assert.equal(consistent.cacheHit, false);

  const split = await verifier.judge({
    instanceId: instance.instanceId,
    nodeId: "tax_calc",
    samples: ["pass", "pass", "fail"],
    evidence: { tax_rate: 0.031, industry_low: 0.02, industry_high: 0.04 },
    highImpact: true,
  });
  assert.equal(split.escalated, true);
  assert.equal(split.finalVerdict, "escalated");

  const cached = await verifier.judge({
    instanceId: instance.instanceId,
    nodeId: "tax_calc",
    samples: ["pass", "pass", "fail"],
    evidence: { tax_rate: 0.031, industry_low: 0.02, industry_high: 0.04 },
    highImpact: true,
  });
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.finalVerdict, "escalated");
});

test("聚合函数：非高影响节点低一致不升级，按多数票判定", () => {
  assert.deepEqual(aggregateSamples(["pass", "fail", "fail"], 0.8, false), { finalVerdict: "fail", confidence: 0.6667, escalated: false });
  assert.deepEqual(aggregateSamples(["pass", "pass", "fail"], 0.8, false), { finalVerdict: "pass", confidence: 0.6667, escalated: false });
  assert.equal(aggregateSamples(["pass", "fail", "fail"], 0.8, true).escalated, true);
});
