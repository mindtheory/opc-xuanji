/**
 * Registry 准入守卫与风险硬规则单元测试（先写测试后实现）。
 *
 * 关键约束来自产品设计 2.4/8.6.9.5：
 * - 六项守卫任一失败即拒绝注册，不做静默降级；
 * - 风险等级由硬规则按“写入目标域”判定，meta 里的 risk_level 一律视为违规；
 * - 高风险条件：deadline_impact / 涉财税法务或客户敏感字段 / 含 human_gates / 有下游依赖流程 / 单次金额超月均流水 5%。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { evaluateGuard, computeRisk, type WorkflowMeta } from "../../src/workflow/guard.ts";

const code = "export const meta = {};\n";
const codeHash = createHash("sha256").update(code, "utf8").digest("hex");

const employee = {
  pluginId: "opc_finance",
  scope: "single" as const,
  requiredViews: ["view_ar_ap", "view_project_status"],
  tools: ["opc_ledger_write", "opc_tax_calc"],
  writeTargets: ["ledger"],
  enabled: true,
};

function meta(overrides: Record<string, unknown> = {}): WorkflowMeta {
  return {
    id: "tax_monthly_prepare",
    version: "1.0.0",
    name: "月度税务申报准备",
    owner_plugin: "opc_finance",
    scope: "single" as const,
    required_views: ["view_ar_ap", "view_project_status"],
    key_nodes: ["collect_invoices", "reconcile", "tax_calc", "review_gate"],
    human_gates: ["review_gate"],
    human_gate_policy: { review_gate: { timeout_policy: "hold" } },
    deadline_impact: true,
    idempotent_nodes: ["write_ledger"],
    write_nodes: ["write_ledger"],
    tools: ["opc_ledger_write", "opc_tax_calc"],
    verifier_policy: { reconcile: { sampling: 3, confidence_threshold: 0.8 } },
    ...overrides,
  };
}

const KNOWN_VIEWS = new Set([
  "view_company_profile",
  "view_ar_ap",
  "view_project_status",
  "view_customer_base",
  "view_contract_index",
  "view_stock_index",
  "view_vehicle_index",
  "view_okr",
]);

function guard(overrides: Record<string, unknown> = {}, emp = employee) {
  return evaluateGuard({
    meta: meta(overrides),
    code,
    testedCodeHash: codeHash,
    employee: emp,
    knownViews: KNOWN_VIEWS,
    monthlyFlow: 200_000,
  });
}

test("合规流程通过六项守卫，且因 deadline_impact 判高风险", () => {
  const result = guard();
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(result.riskLevel, "high");
  assert.ok(result.riskReasons.some((r) => r.includes("deadline_impact")));
});

test("meta 自述 risk_level 直接拒绝", () => {
  const result = guard({ risk_level: "low" });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.item === "meta_schema"));
});

test("缺少必需字段 / 节点命名不合规范 拒绝", () => {
  assert.equal(guard({ owner_plugin: "" }).ok, false);
  assert.equal(guard({ key_nodes: ["BadNode"] }).ok, false);
  assert.equal(guard({ human_gates: ["review_gate"] }).ok, true); // gate 必须在 key_nodes 内
  assert.equal(guard({ human_gates: ["not_a_key_node"] }).ok, false);
});

test("视图授权守卫：未在授权表内的视图拒绝", () => {
  const result = guard({ required_views: ["view_ar_ap", "view_stock_index"] });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.item === "views"));
});

test("幂等完整性守卫：写节点必须全部登记幂等键", () => {
  const result = guard({ write_nodes: ["write_ledger", "write_invoice"], idempotent_nodes: ["write_ledger"] });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.item === "idempotency"));
});

test("工具合法性守卫：未注册工具拒绝", () => {
  const result = guard({ tools: ["opc_ledger_write", "opc_admin_calendar"] });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.item === "tools"));
});

test("跨员工隔离守卫：owner 不一致或引用他人私有数据拒绝", () => {
  assert.equal(guard({ owner_plugin: "opc_legal" }).ok, false);
  assert.equal(guard({ private_refs: ["biz.customer_sensitive"] }).ok, false);
});

test("代码哈希守卫：注册哈希必须等于测试通过时哈希", () => {
  const result = evaluateGuard({
    meta: meta(),
    code,
    testedCodeHash: "deadbeef",
    employee,
    knownViews: KNOWN_VIEWS,
    monthlyFlow: 200_000,
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.item === "code_hash"));
});

test("风险硬规则：无 deadline、不涉敏感域、无 human gate 判中/低", () => {
  const low = computeRisk({
    meta: meta({ deadline_impact: false, human_gates: [], idempotent_nodes: ["write_ledger"], write_nodes: ["write_ledger"] }),
    employee: { ...employee, writeTargets: ["sku"] },
    monthlyFlow: 200_000,
  });
  assert.equal(low.level, "low");

  const medium = computeRisk({
    meta: meta({ deadline_impact: false, human_gates: [], scope: "cross" }),
    employee: { ...employee, writeTargets: ["stock_txn"] },
    monthlyFlow: 200_000,
  });
  assert.equal(medium.level, "medium");

  assert.equal(
    computeRisk({
      meta: meta({ deadline_impact: true }),
      employee: { ...employee, writeTargets: ["sku"] },
      monthlyFlow: 200_000,
    }).level,
    "high",
  );
  assert.equal(
    computeRisk({
      meta: meta({ deadline_impact: false, human_gates: [], impact_amount: 50_000 }),
      employee: { ...employee, writeTargets: ["ledger"] },
      monthlyFlow: 200_000,
    }).level,
    "high",
  );
  assert.equal(
    computeRisk({
      meta: meta({ deadline_impact: false, human_gates: [], depends_on_workflows: ["project_acceptance_flow"] }),
      employee: { ...employee, writeTargets: ["sku"] },
      monthlyFlow: 200_000,
    }).level,
    "high",
  );
});
