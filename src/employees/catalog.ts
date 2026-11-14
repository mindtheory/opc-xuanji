/**
 * 员工插件目录：每个虚拟员工一个 manifest，声明身份、视图、工具、写目标、单员工流程与依赖。
 *
 * 设计边界（SRS §9 / 产品设计 §2.5）：
 * - 中枢按 manifest 装配，不维护硬编码员工名单；
 * - 停用/卸载只改变可用性，不删除业务数据；
 * - 员工包导入必须复用同一份 manifest 校验。
 */
import { knownViewIds } from "../platform/views.ts";

export interface EmployeeManifest {
  pluginId: string;
  employeeCode: string;
  displayName: string;
  version: string;
  minHubVersion: string;
  schemaVersion: string;
  requiredViews: string[];
  tools: string[];
  writeTargets: string[];
  singleWorkflows: string[];
  dependencies: string[];
}

export const ALLOWED_WRITE_TARGETS = new Set([
  "ledger",
  "reimbursement_voucher",
  "voucher_attachment",
  "account_subject",
  "accounting_voucher",
  "financial_statement",
  "statement_audit",
  "tax_calendar",
  "tax_filing",
  "business_report",
  "tax_plan",
  "financial_analysis",
  "ar_ap",
  "contract",
  "risk_rule",
  "legal_case",
  "ip_asset",
  "labor_doc",
  "compliance_item",
  "legal_opinion",
  "legal_archive",
  "counsel_engagement",
  "event",
  "action_item",
  "document",
  "seal_record",
  "license",
  "asset",
  "purchase",
  "travel",
  "visitor",
  "it_account",
  "attendance",
  "objective",
  "decision",
  "strategy_plan",
  "budget",
  "review",
  "scenario",
  "investment_case",
  "project",
  "project_charter",
  "project_plan",
  "milestone",
  "task",
  "task_dependency",
  "project_baseline",
  "project_change",
  "risk_issue",
  "status_report",
  "acceptance",
  "project_closure",
  "okr_link",
  "work_log",
  "code_repository",
  "artifact_repository",
  "deploy_environment",
  "release_order",
  "test_plan",
  "test_case",
  "test_suite",
  "test_run",
  "test_result",
  "defect",
  "lead",
  "dd_report",
  "intel_item",
  "supplier_risk",
  "intel_project_scope",
  "source",
  "source_binding",
  "watch_topic",
  "intel_tag",
  "intel_brief",
  "intel_collect_run",
  "intel_push_log",
  "intel_pipeline_run",
  "customer",
  "customer_sensitive",
  "contact",
  "commitment",
  "quote",
  "interaction",
  "complaint",
  "satisfaction",
  "segment",
  "vehicle_log",
  "subsidy_standard",
  "vehicle",
  "driver",
  "trip",
  "fuel",
  "maintenance",
  "insurance",
  "violation",
  "sku",
  "stock_txn",
  "warehouse",
  "supplier",
  "purchase_order",
  "transfer",
  "inventory_count",
  "batch",
  "replenish",
  "cost_sheet",
  "wbs_node",
  "wbs_baseline",
  "wbs_change",
  "wbs_dictionary",
  "wbs_dependency",
  "wbs_resource",
  "wbs_evm",
  "publication_plan",
  "publication",
  "publication_approval",
  "channel_account",
  "media_contact",
  "content_asset",
  "campaign",
  "crisis_case",
  "publicity_metric",
]);

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PLUGIN_ID = /^opc_[a-z][a-z0-9_]*$/;
const EMPLOYEE_CODE = /^[A-Z]{2,5}$/;
const TOOL_NAME = /^opc_[a-z][a-z0-9_]*$/;
const NODE_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const EMPLOYEE_MANIFESTS: EmployeeManifest[] = [
  {
    pluginId: "opc_finance",
    employeeCode: "FIN",
    displayName: "财税管家",
    version: "0.1.0",
    minHubVersion: "0.2.1",
    schemaVersion: "1",
    requiredViews: ["view_company_profile", "view_ar_ap", "view_project_status", "view_contract_index"],
    tools: ["opc_finance_ledger_write", "opc_finance_tax_calendar_upsert", "opc_finance_ar_ap_query", "opc_finance_reimburse_manage", "opc_finance_voucher_manage", "opc_finance_subject_manage", "opc_finance_statement_manage", "opc_finance_tax_manage", "opc_finance_business_report", "opc_finance_tax_plan", "opc_finance_analysis"],
    writeTargets: ["ledger", "reimbursement_voucher", "accounting_voucher", "account_subject", "financial_statement", "tax_calendar", "tax_filing", "business_report", "tax_plan", "ar_ap"],
    singleWorkflows: ["tax_monthly_prepare", "reimburse_review", "monthly_close", "annual_financial_report"],
    dependencies: [],
  },
  {
    pluginId: "opc_legal",
    employeeCode: "LEG",
    displayName: "法务官",
    version: "0.1.0",
    minHubVersion: "0.2.1",
    schemaVersion: "1",
    requiredViews: ["view_company_profile", "view_contract_index", "view_ar_ap", "view_project_status"],
    tools: ["opc_legal_contract_manage", "opc_legal_risk_scan", "opc_legal_governance_manage", "opc_legal_case_manage", "opc_legal_ip_manage", "opc_legal_labor_manage", "opc_legal_compliance_manage", "opc_legal_doc_manage", "opc_legal_counsel_manage"],
    writeTargets: ["contract", "risk_rule", "legal_case", "ip_asset", "labor_doc", "compliance_item", "legal_opinion", "legal_archive", "counsel_engagement"],
    singleWorkflows: ["contract_review", "contract_renewal", "legal_case_intake"],
    dependencies: [],
  },
  {
    pluginId: "opc_admin",
    employeeCode: "ADM",
    displayName: "行政总管",
    version: "0.1.0",
    minHubVersion: "0.2.1",
    schemaVersion: "1",
    requiredViews: ["view_company_profile", "view_customer_base", "view_project_status", "view_okr"],
    tools: ["opc_admin_event_manage", "opc_admin_action_item_manage", "opc_admin_document_manage", "opc_admin_seal_manage", "opc_admin_license_manage", "opc_admin_asset_manage", "opc_admin_purchase_manage", "opc_admin_travel_manage", "opc_admin_visitor_manage", "opc_admin_it_manage", "opc_admin_hr_manage"],
    writeTargets: ["event", "action_item", "document", "seal_record", "license", "asset", "purchase", "travel", "visitor", "it_account", "attendance"],
    singleWorkflows: ["meeting_closure", "seal_approval", "travel_approval", "onboarding_offboarding"],
    dependencies: [],
  },
  {
    pluginId: "opc_strategy",
    employeeCode: "STR",
    displayName: "战略参谋",
    version: "0.1.0",
    minHubVersion: "0.2.1",
    schemaVersion: "1",
    requiredViews: ["view_company_profile", "view_okr", "view_ar_ap", "view_project_status", "view_contract_index"],
    tools: ["opc_strategy_plan_manage", "opc_strategy_okr_manage", "opc_strategy_budget_manage", "opc_strategy_review_manage", "opc_strategy_decision_manage", "opc_strategy_market_manage", "opc_strategy_business_model_manage", "opc_strategy_org_manage", "opc_strategy_investment_manage"],
    writeTargets: ["objective", "decision", "strategy_plan", "budget", "review", "scenario", "investment_case"],
    singleWorkflows: ["annual_planning", "quarterly_review", "decision_review"],
    dependencies: [],
  },
  {
    pluginId: "opc_project",
    employeeCode: "PRJ",
    displayName: "项目监理",
    version: "0.2.0",
    minHubVersion: "0.2.1",
    schemaVersion: "1",
    requiredViews: ["view_company_profile", "view_project_status", "view_ar_ap", "view_contract_index", "view_okr"],
    tools: ["opc_project_status_update", "opc_project_acceptance_submit", "opc_project_lifecycle_manage", "opc_project_charter_manage", "opc_project_scope_manage", "opc_project_milestone_manage", "opc_project_task_manage", "opc_project_schedule_manage", "opc_project_progress_manage", "opc_project_okr_link", "opc_project_risk_manage", "opc_project_acceptance_manage", "opc_project_closure_manage", "opc_project_report_manage", "opc_project_repo_manage", "opc_project_artifact_manage", "opc_project_env_manage", "opc_project_release_manage", "opc_project_test_manage"],
    writeTargets: ["project", "project_charter", "project_plan", "milestone", "task", "task_dependency", "project_baseline", "project_change", "risk_issue", "status_report", "acceptance", "project_closure", "okr_link", "work_log", "code_repository", "artifact_repository", "deploy_environment", "release_order", "test_plan", "test_case", "test_suite", "test_run", "test_result", "defect"],
    singleWorkflows: ["project_stage_gate", "project_plan_baseline", "project_status_review", "project_closure", "project_release_flow", "project_test_review"],
    dependencies: [],
  },
  {
    pluginId: "opc_intel",
    employeeCode: "INT",
    displayName: "情报官",
    version: "0.2.0",
    minHubVersion: "0.2.1",
    schemaVersion: "1",
    requiredViews: ["view_company_profile", "view_customer_base", "view_project_status", "view_okr"],
    tools: ["opc_intel_industry_manage", "opc_intel_policy_manage", "opc_intel_competitor_manage", "opc_intel_lead_manage", "opc_intel_dd_manage", "opc_intel_supplier_manage", "opc_intel_sentiment_manage", "opc_intel_brief_manage", "opc_intel_source_manage", "opc_intel_project_scope_manage", "opc_intel_keyword_manage", "opc_intel_tag_manage", "opc_intel_collect_manage", "opc_intel_analysis_manage", "opc_intel_pipeline_manage", "opc_intel_push_manage"],
    writeTargets: ["lead", "dd_report", "intel_item", "supplier_risk", "intel_project_scope", "source", "source_binding", "watch_topic", "intel_tag", "intel_brief", "intel_collect_run", "intel_push_log", "intel_pipeline_run"],
    singleWorkflows: ["dd_report_flow", "policy_alert", "competitor_watch", "intel_daily_pipeline"],
    dependencies: [],
  },
  {
    pluginId: "opc_crm",
    employeeCode: "CRM",
    displayName: "客户管家",
    version: "0.1.0",
    minHubVersion: "0.2.1",
    schemaVersion: "1",
    requiredViews: ["view_company_profile", "view_customer_base", "view_ar_ap", "view_project_status", "view_contract_index"],
    tools: ["opc_crm_customer_manage", "opc_crm_contact_manage", "opc_crm_lead_manage", "opc_crm_commitment_manage", "opc_crm_quote_manage", "opc_crm_interaction_manage", "opc_crm_complaint_manage", "opc_crm_satisfaction_manage", "opc_crm_segment_manage"],
    writeTargets: ["customer", "customer_sensitive", "contact", "lead", "commitment", "quote", "interaction", "complaint", "satisfaction", "segment"],
    singleWorkflows: ["customer_onboarding", "renewal_review", "complaint_handling"],
    dependencies: [],
  },
  {
    pluginId: "opc_vehicle",
    employeeCode: "VEH",
    displayName: "车务官",
    version: "0.1.0",
    minHubVersion: "0.2.1",
    schemaVersion: "1",
    requiredViews: ["view_company_profile", "view_vehicle_index", "view_project_status", "view_customer_base", "view_ar_ap"],
    tools: ["opc_vehicle_asset_manage", "opc_vehicle_driver_manage", "opc_vehicle_trip_manage", "opc_vehicle_fuel_manage", "opc_vehicle_maintenance_manage", "opc_vehicle_insurance_manage", "opc_vehicle_violation_manage", "opc_vehicle_subsidy_manage", "opc_vehicle_cost_manage"],
    writeTargets: ["vehicle_log", "subsidy_standard", "vehicle", "driver", "trip", "fuel", "maintenance", "insurance", "violation"],
    singleWorkflows: ["vehicle_subsidy_calc", "vehicle_maintenance", "vehicle_insurance_renewal"],
    dependencies: [],
  },
  {
    pluginId: "opc_inv",
    employeeCode: "INV",
    displayName: "货栈总管",
    version: "0.1.0",
    minHubVersion: "0.2.1",
    schemaVersion: "1",
    requiredViews: ["view_company_profile", "view_stock_index", "view_project_status", "view_contract_index", "view_ar_ap"],
    tools: ["opc_inv_sku_manage", "opc_inv_warehouse_manage", "opc_inv_supplier_manage", "opc_inv_purchase_manage", "opc_inv_stock_in_manage", "opc_inv_stock_out_manage", "opc_inv_transfer_manage", "opc_inv_count_manage", "opc_inv_batch_manage", "opc_inv_replenish_manage", "opc_inv_cost_manage"],
    writeTargets: ["sku", "stock_txn", "warehouse", "supplier", "purchase_order", "transfer", "inventory_count", "batch", "replenish", "cost_sheet"],
    singleWorkflows: ["inv_stock_in", "inv_stock_out", "inventory_count", "purchase_replenish"],
    dependencies: [],
  },
  {
    pluginId: "opc_wbs",
    employeeCode: "WBS",
    displayName: "WBS 员工",
    version: "0.1.0",
    minHubVersion: "0.2.1",
    schemaVersion: "1",
    requiredViews: ["view_company_profile", "view_project_status", "view_contract_index", "view_okr"],
    tools: ["opc_wbs_decompose", "opc_wbs_dictionary_manage", "opc_wbs_code_manage", "opc_wbs_baseline_manage", "opc_wbs_change_manage", "opc_wbs_dependency_manage", "opc_wbs_resource_manage", "opc_wbs_progress_manage", "opc_wbs_evm_manage", "opc_wbs_template_manage", "opc_wbs_link"],
    writeTargets: ["wbs_node", "wbs_baseline", "wbs_change", "wbs_dictionary", "wbs_dependency", "wbs_resource", "wbs_evm"],
    singleWorkflows: ["wbs_baseline_change", "wbs_decompose_review"],
    dependencies: ["opc_project"],
  },
  {
    pluginId: "opc_publicity",
    employeeCode: "PUB",
    displayName: "外宣员工",
    version: "0.1.0",
    minHubVersion: "0.2.1",
    schemaVersion: "1",
    requiredViews: ["view_company_profile", "view_customer_base", "view_project_status", "view_okr", "view_contract_index"],
    tools: ["opc_publicity_strategy_manage", "opc_publicity_plan_manage", "opc_publicity_news_manage", "opc_publicity_media_manage", "opc_publicity_social_manage", "opc_publicity_content_manage", "opc_publicity_approval_manage", "opc_publicity_crisis_manage", "opc_publicity_event_manage", "opc_publicity_metric_manage", "opc_publicity_channel_manage"],
    writeTargets: ["publication_plan", "publication", "publication_approval", "channel_account", "media_contact", "content_asset", "campaign", "crisis_case", "publicity_metric"],
    singleWorkflows: ["publication_publish", "crisis_response", "campaign_review"],
    dependencies: ["opc_project", "opc_crm"],
  },
];

export function manifestByPlugin(pluginId: string): EmployeeManifest | undefined {
  return EMPLOYEE_MANIFESTS.find((manifest) => manifest.pluginId === pluginId);
}

export function validateManifest(manifest: EmployeeManifest, hubVersion = "0.2.1"): string[] {
  const errors: string[] = [];
  if (!PLUGIN_ID.test(manifest.pluginId)) errors.push(`pluginId 非法：${manifest.pluginId}`);
  if (!EMPLOYEE_CODE.test(manifest.employeeCode)) errors.push(`employeeCode 非法：${manifest.employeeCode}`);
  if (manifest.displayName.trim() === "") errors.push("displayName 不能为空");
  if (!VERSION.test(manifest.version)) errors.push(`version 非 semver：${manifest.version}`);
  if (!VERSION.test(manifest.minHubVersion)) errors.push(`minHubVersion 非 semver：${manifest.minHubVersion}`);
  if (compareSemver(manifest.minHubVersion, hubVersion) > 0) {
    errors.push(`minHubVersion ${manifest.minHubVersion} 高于当前中枢 ${hubVersion}`);
  }
  if (manifest.schemaVersion.trim() === "") errors.push("schemaVersion 不能为空");
  const known = new Set(knownViewIds());
  for (const view of manifest.requiredViews) {
    if (!known.has(view)) errors.push(`未知视图：${view}`);
  }
  if (manifest.tools.length === 0) errors.push("tools 不能为空");
  for (const tool of manifest.tools) {
    if (!TOOL_NAME.test(tool)) errors.push(`工具名非法：${tool}`);
  }
  if (manifest.writeTargets.length === 0) errors.push("writeTargets 不能为空");
  for (const target of manifest.writeTargets) {
    if (!ALLOWED_WRITE_TARGETS.has(target)) errors.push(`写目标未登记：${target}`);
  }
  for (const workflow of manifest.singleWorkflows) {
    if (!NODE_NAME.test(workflow)) errors.push(`单员工流程名非法：${workflow}`);
  }
  for (const dependency of manifest.dependencies) {
    if (!PLUGIN_ID.test(dependency)) errors.push(`依赖插件 id 非法：${dependency}`);
  }
  return errors;
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}
