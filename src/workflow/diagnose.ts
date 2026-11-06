/**
 * 异常根因诊断（中枢内部能力，Phase 1 不做独立插件）。
 *
 * 输出诊断卡：失败环节定位 / 证据引用 / 流程修改建议 / 影响面评估；
 * 结论分流到四条处置路径（数据问题 / 流程设计问题 / 外部异常 / 不适合固化）。
 */
import type { WorkflowMeta } from "./guard.ts";

export type RootCause = "data" | "design" | "external" | "not_suitable";

export interface DiagnoseInput {
  nodeId: string;
  verdict: string;
  evidence?: Record<string, unknown>;
  meta?: WorkflowMeta;
  history?: { sameNodeFailures?: number };
}

export interface DiagnoseResult {
  rootCause: RootCause;
  location: string;
  advice: string;
  impact: string;
  evidenceRefs: string[];
}

const REQUIRED_EVIDENCE: Record<string, string[]> = {
  reconcile: ["invoice_total", "ledger_total"],
  tax_calc: ["tax_rate"],
  write_ledger: ["amount"],
};

export function diagnose(input: DiagnoseInput): DiagnoseResult {
  const evidence = input.evidence ?? {};
  const required = REQUIRED_EVIDENCE[input.nodeId] ?? [];
  const missing = required.filter((key) => evidence[key] === undefined || evidence[key] === null);
  const evidenceRefs = Object.keys(evidence);

  if (missing.length > 0) {
    return {
      rootCause: "data",
      location: input.nodeId,
      advice: `先补齐上游数据（缺 ${missing.join(",")}），不要改流程版本`,
      impact: "仅影响本实例，修复数据后可重跑",
      evidenceRefs,
    };
  }
  if (input.meta?.verifier_policy?.[input.nodeId] === undefined) {
    return {
      rootCause: "design",
      location: input.nodeId,
      advice: `为节点 ${input.nodeId} 在 meta.verifier_policy 声明 sampling 与 confidence_threshold，再重跑三关测试`,
      impact: "影响后续同类实例的评判口径",
      evidenceRefs,
    };
  }
  if (input.verdict === "fail" && (input.history?.sameNodeFailures ?? 0) >= 3) {
    return {
      rootCause: "not_suitable",
      location: input.nodeId,
      advice: "节点历史失败次数过多，建议回退为技能形态并补充 3 个典型实例后再固化",
      impact: "该流程暂不固化，保留技能路径",
      evidenceRefs,
    };
  }
  if (input.verdict === "fail") {
    return {
      rootCause: "design",
      location: input.nodeId,
      advice: `按 Verifier 失败原因修脚本（步骤顺序/验收条件可结构化），不要放宽判定口径`,
      impact: "影响该流程版本，需重跑三关测试与准入守卫",
      evidenceRefs,
    };
  }
  return {
    rootCause: "external",
    location: input.nodeId,
    advice: "判定通过但产出异常，按 8.5 降级路径处理并标注数据源不可用",
    impact: "不影响流程版本，记录降级事件",
    evidenceRefs,
  };
}
