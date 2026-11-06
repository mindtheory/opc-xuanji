/**
 * Workflow Registry 准入守卫 + 风险等级硬规则（纯函数，不碰数据库，便于单测）。
 *
 * 六项守卫（产品设计 2.4 / 8.6.9.5）：
 *   meta_schema / views / idempotency / tools / isolation / code_hash，任一失败即拒绝注册。
 * 风险等级只由写入目标域与硬条件判定，meta 中禁止出现 risk_level 字段（自述即违规）。
 */
import { createHash } from "node:crypto";

export interface WorkflowMeta {
  id: string;
  version: string;
  name: string;
  owner_plugin: string;
  scope: "single" | "cross";
  required_views?: string[];
  key_nodes?: string[];
  human_gates?: string[];
  human_gate_policy?: Record<string, { timeout_policy?: string }>;
  deadline_impact?: boolean;
  indirect_deadline?: { type?: string; max_days?: number } | null;
  idempotent_nodes?: string[];
  write_nodes?: string[];
  tools?: string[];
  verifier_policy?: Record<string, { sampling?: number; confidence_threshold?: number }>;
  depends_on_workflows?: string[];
  private_refs?: string[];
  impact_amount?: number;
  [key: string]: unknown;
}

export interface EmployeeProfile {
  pluginId: string;
  scope: "single" | "cross";
  requiredViews: string[];
  tools: string[];
  writeTargets: string[];
  enabled: boolean;
}

export interface GuardFailure {
  item: string;
  detail: string;
}

export interface RiskResult {
  level: "high" | "medium" | "low";
  reasons: string[];
}

export interface GuardResult {
  ok: boolean;
  failures: GuardFailure[];
  riskLevel: "high" | "medium" | "low";
  riskReasons: string[];
}

export interface GuardInput {
  meta: WorkflowMeta;
  code: string;
  testedCodeHash: string;
  employee: EmployeeProfile;
  knownViews: Set<string> | string[];
  monthlyFlow?: number;
}

const HIGH_DOMAINS = new Set(["ledger", "contract", "customer_sensitive", "audit_log", "token"]);
const MEDIUM_DOMAINS = new Set(["stock_txn", "vehicle_log", "subsidy_standard", "ar_ap", "tax_calendar"]);
const NODE_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const REQUIRED_FIELDS = ["id", "version", "name", "owner_plugin", "scope", "required_views", "key_nodes"] as const;

function asSet(value: Set<string> | string[]): Set<string> {
  return value instanceof Set ? value : new Set(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function codeHashOf(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/** 风险等级硬规则：满足任一高风险条件即 high；否则按写入目标域命中中风险；都不命中为 low。 */
export function computeRisk(input: { meta: WorkflowMeta; employee: Pick<EmployeeProfile, "writeTargets" | "scope">; monthlyFlow?: number }): RiskResult {
  const { meta, employee, monthlyFlow } = input;
  const reasons: string[] = [];
  const targets = new Set(employee.writeTargets ?? []);
  const highHits = [...targets].filter((target) => HIGH_DOMAINS.has(target));

  if (meta.deadline_impact === true) reasons.push("deadline_impact=true（停滞即影响法定/合同截止日）");
  if ((meta.human_gates ?? []).length > 0) reasons.push("含 human_gates（人工审批节点）");
  if (highHits.length > 0) reasons.push(`写入目标域涉及敏感域：${highHits.join(",")}`);
  if ((meta.depends_on_workflows ?? []).length > 0) reasons.push(`存在下游依赖流程：${(meta.depends_on_workflows ?? []).join(",")}`);
  if (
    typeof meta.impact_amount === "number" &&
    typeof monthlyFlow === "number" &&
    monthlyFlow > 0 &&
    meta.impact_amount > monthlyFlow * 0.05
  ) {
    reasons.push(`单次运行金额 ${meta.impact_amount} 超过月均流水 5%（${Math.round(monthlyFlow * 0.05)}）`);
  }
  if (reasons.length > 0) return { level: "high", reasons };

  const mediumHits = [...targets].filter((target) => MEDIUM_DOMAINS.has(target));
  if (mediumHits.length > 0) return { level: "medium", reasons: [`写入目标域需观察：${mediumHits.join(",")}`] };
  if (meta.scope === "cross" || (employee.scope === "cross" && meta.scope !== "single")) {
    return { level: "medium", reasons: ["跨员工流程"] };
  }
  return { level: "low", reasons: ["无高风险条件，写入目标域为一般域"] };
}

function checkMetaSchema(meta: WorkflowMeta): GuardFailure[] {
  const failures: GuardFailure[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (meta[field] === undefined || meta[field] === null || meta[field] === "") {
      failures.push({ item: "meta_schema", detail: `缺少必需字段 ${field}` });
    }
  }
  if (Object.hasOwn(meta, "risk_level")) {
    failures.push({ item: "meta_schema", detail: "meta 中出现 risk_level：风险等级只允许 Registry 硬规则计算" });
  }
  if (meta.scope !== "single" && meta.scope !== "cross") {
    failures.push({ item: "meta_schema", detail: `scope 只能是 single/cross，收到 ${String(meta.scope)}` });
  }
  for (const node of [...(meta.key_nodes ?? []), ...(meta.idempotent_nodes ?? []), ...(meta.write_nodes ?? [])]) {
    if (!NODE_NAME.test(node)) {
      failures.push({ item: "meta_schema", detail: `节点命名不合规范（应为 verb_noun 小写连写）：${node}` });
    }
  }
  for (const gate of meta.human_gates ?? []) {
    if (!(meta.key_nodes ?? []).includes(gate)) {
      failures.push({ item: "meta_schema", detail: `human_gate ${gate} 不在 key_nodes 内` });
    }
  }
  if (typeof meta.deadline_impact !== "boolean") {
    failures.push({ item: "meta_schema", detail: "deadline_impact 必须是布尔值（不得省略以规避告警）" });
  }
  return failures;
}

/** 六项守卫 + 风险等级；ok=false 时 failures 逐项说明，调用方必须拒绝注册。 */
export function evaluateGuard(input: GuardInput): GuardResult {
  const { meta, employee, code, testedCodeHash } = input;
  const knownViews = asSet(input.knownViews);
  const failures: GuardFailure[] = [];

  failures.push(...checkMetaSchema(meta));

  // 视图授权：既要在中枢授权表内，也要在该员工注册的 required_views 内
  const employeeViews = new Set(employee.requiredViews);
  for (const view of meta.required_views ?? []) {
    if (!knownViews.has(view)) failures.push({ item: "views", detail: `视图 ${view} 不在中枢视图授权表内` });
    else if (!employeeViews.has(view)) failures.push({ item: "views", detail: `视图 ${view} 未授权给 ${employee.pluginId}` });
  }

  // 幂等完整性：所有写节点都必须登记幂等键
  const idempotent = new Set(meta.idempotent_nodes ?? []);
  for (const node of meta.write_nodes ?? []) {
    if (!idempotent.has(node)) failures.push({ item: "idempotency", detail: `写节点 ${node} 未登记幂等键` });
  }

  // 工具合法性：meta.tools 必须在员工注册工具内
  const registeredTools = new Set(employee.tools ?? []);
  for (const tool of meta.tools ?? []) {
    if (!registeredTools.has(tool)) failures.push({ item: "tools", detail: `工具 ${tool} 未在 ${employee.pluginId} 注册` });
  }

  // 跨员工隔离：owner/scope 一致，且不得引用其他员工私有数据
  if (meta.owner_plugin !== employee.pluginId) {
    failures.push({ item: "isolation", detail: `owner_plugin ${meta.owner_plugin} 与员工 ${employee.pluginId} 不一致` });
  }
  if (employee.scope === "single" && meta.scope !== "single") {
    failures.push({ item: "isolation", detail: "单员工插件只能注册 scope=single 的流程" });
  }
  if ((meta.private_refs ?? []).length > 0) {
    failures.push({ item: "isolation", detail: `流程引用了其他员工私有数据：${(meta.private_refs ?? []).join(",")}` });
  }
  if (!employee.enabled) failures.push({ item: "isolation", detail: `员工插件 ${employee.pluginId} 已停用` });

  // 代码哈希：注册哈希必须等于测试通过时的哈希
  const actualHash = codeHashOf(code);
  if (actualHash !== testedCodeHash) {
    failures.push({ item: "code_hash", detail: `代码哈希不一致：测试通过=${testedCodeHash.slice(0, 12)}，当前=${actualHash.slice(0, 12)}` });
  }

  const risk = computeRisk({ meta, employee, monthlyFlow: input.monthlyFlow });
  return { ok: failures.length === 0, failures, riskLevel: risk.level, riskReasons: risk.reasons };
}
