#!/usr/bin/env node
/**
 * gen-spec.mjs —— 由内嵌的规格数据生成 spec/opc-xuanji/entities.yaml（块式 YAML）。
 *
 * 为什么生成而不是手写：CD-PTC 的 check-spec.mjs 只接受块式 YAML（不支持流式映射），
 * 而 45 个实体的字段表手写极易缩进/逗号出错。规格的唯一事实来源是本文件里的 ENTITIES 数据，
 * 生成物 entities.yaml 必须与 DDL 同提交；改动实体时先改这里再 `node scripts/gen-spec.mjs`。
 *
 * 用法：node scripts/gen-spec.mjs [--check]   # --check 只校验生成物是否与数据一致（CI 用）
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = join(HERE, "..", "spec", "opc-xuanji", "entities.yaml");

/** [name, type, nullable=false, unique=false] */
const S = (name, type, nullable = true) => ({ name, type, nullable });
const attr = (name, type) => [name, type];

const ENTITIES = [
  // ---------------- platform ----------------
  ["CompanyProfile", "biz.company_profile", "platform", "entity",
    [S("name", "varchar(128)", false), S("entity_type", "varchar(32)", false), S("tax_types", "jsonb"), S("bank_accounts", "jsonb"), S("owner_preferences", "jsonb"), S("updated_at", "timestamptz")],
    [["employees", "EmployeePlugin", "1:N"]]],
  ["ViewGrant", "ref.view_grant", "platform", "code-table",
    [S("view_id", "varchar(64)", false), S("plugin_id", "varchar(64)", false), S("granted_by", "varchar(64)"), S("granted_at", "timestamptz"), S("status", "varchar(16)", false)], []],
  ["Token", "ref.token", "platform", "entity",
    [S("token_code", "varchar(64)", false), S("task_id", "varchar(64)", false), S("plugin_id", "varchar(64)", false), S("scope", "jsonb", false), S("issued_at", "timestamptz", false), S("expires_at", "timestamptz", false), S("used", "boolean", false)], []],
  ["EmployeePlugin", "ref.employee_plugin", "platform", "code-table",
    [S("plugin_id", "varchar(64)", false), S("display_name", "varchar(64)", false), S("scope", "varchar(16)", false), S("required_views", "jsonb"), S("tools", "jsonb"), S("write_targets", "jsonb"), S("enabled", "boolean", false), S("version", "varchar(16)", false), S("manifest", "jsonb"), S("installed_at", "timestamptz"), S("disabled_reason", "text"), S("package_code", "varchar(64)")], []],
  ["ConflictQueue", "biz.conflict_queue", "platform", "entity",
    [S("conflict_type", "varchar(32)", false), S("frozen_unit_type", "varchar(32)", false), S("frozen_unit_id", "bigint", false), S("parties", "jsonb", false), S("diff_fields", "jsonb"), S("detected_at", "timestamptz", false), S("status", "varchar(16)", false), S("arbitration_id", "bigint")],
    [["arbitration", "Decision", "N:1"]]],
  ["Embedding", "vec.embedding", "platform", "entity",
    [S("source_type", "varchar(32)", false), S("source_id", "bigint", false), S("content_hash", "varchar(64)", false), S("embedding", "vector(1024)", false), S("model_id", "varchar(64)", false), S("dimension", "integer", false), S("created_at", "timestamptz")],
    [], [["embedding", 1024, "hnsw"]]],
  // ---------------- finance ----------------
  ["Ledger", "biz.ledger", "finance", "entity",
    [S("entry_date", "date", false), S("amount", "numeric(18,2)", false), S("direction", "varchar(8)", false), S("category", "varchar(32)", false), S("entity", "varchar(16)", false), S("invoice_id", "varchar(64)"), S("project_id", "bigint"), S("note", "text"), S("conflict_frozen", "boolean", false)],
    [["project", "Project", "N:1"]]],
  ["TaxCalendar", "biz.tax_calendar", "finance", "entity",
    [S("tax_type", "varchar(32)", false), S("period", "varchar(16)", false), S("deadline", "date", false), S("status", "varchar(16)", false), S("source_version", "varchar(32)")], []],
  ["ArAp", "biz.ar_ap", "finance", "entity",
    [S("counterparty", "varchar(128)", false), S("amount", "numeric(18,2)", false), S("due", "date"), S("status", "varchar(16)", false), S("contract_id", "bigint"), S("project_id", "bigint")], []],
  // ---------------- legal ----------------
  ["Contract", "biz.contract", "legal", "entity",
    [S("counterparty", "varchar(128)", false), S("amount", "numeric(18,2)"), S("start_date", "date"), S("end_date", "date"), S("status", "varchar(16)", false), S("risk_flags", "jsonb"), S("conflict_frozen", "boolean", false)], []],
  ["RiskRule", "ref.risk_rule", "legal", "code-table",
    [S("rule_id", "varchar(32)", false), S("trigger", "text", false), S("suggestion", "text"), S("source", "varchar(128)"), S("confirmed_by", "varchar(64)"), S("version", "varchar(16)")], []],
  // ---------------- admin ----------------
  ["Event", "biz.event", "admin", "entity",
    [S("start_at", "timestamptz", false), S("participants", "jsonb"), S("related_customer", "bigint"), S("related_project", "bigint"), S("source", "varchar(16)")], []],
  ["ActionItem", "biz.action_item", "admin", "entity",
    [S("meeting_id", "bigint"), S("owner", "varchar(64)", false), S("due", "date"), S("status", "varchar(16)", false)], []],
  // ---------------- strategy ----------------
  ["Objective", "biz.objective", "strategy", "entity",
    [S("name", "varchar(128)", false), S("key_results", "jsonb"), S("period", "varchar(16)")], []],
  ["Decision", "biz.decision", "strategy", "entity",
    [S("decided_on", "date", false), S("context", "text"), S("choices", "jsonb"), S("chosen", "text"), S("rationale", "text")], []],
  // ---------------- project ----------------
  ["Project", "biz.project", "project", "entity",
    [S("name", "varchar(128)", false), S("project_type", "varchar(32)"), S("stage", "varchar(32)", false), S("progress", "integer", false), S("blockers", "jsonb"), S("milestones", "jsonb"), S("cost_actual", "numeric(18,2)"), S("start_date", "date"), S("target_end_date", "date"), S("actual_start_date", "date"), S("actual_end_date", "date"), S("timezone", "varchar(64)"), S("work_calendar", "jsonb"), S("tech_stack", "jsonb"), S("software_profile", "jsonb")],
    [["milestones", "ProjectMilestone", "1:N"], ["repositories", "CodeRepository", "1:N"], ["artifactRepositories", "ArtifactRepository", "1:N"], ["environments", "DeployEnvironment", "1:N"], ["testPlans", "TestPlan", "1:N"]]],
  // ---------------- project：软件研发要素（v2.12） ----------------
  ["ProjectMilestone", "biz.project_milestone", "project", "entity",
    [S("project_id", "bigint", false), S("name", "varchar(128)", false), S("stage", "varchar(32)"), S("target_date", "date", false), S("actual_date", "date"), S("status", "varchar(16)", false), S("owner", "varchar(64)"), S("dependencies", "jsonb"), S("evidence", "text")], []],
  ["WorkLog", "biz.work_log", "project", "entity",
    [S("project_id", "bigint", false), S("task_id", "bigint"), S("worker", "varchar(64)", false), S("work_date", "date", false), S("hours", "numeric(6,2)", false), S("source", "varchar(16)", false), S("note", "text")], []],
  ["CodeRepository", "ref.code_repository", "project", "entity",
    [S("project_id", "bigint", false), S("name", "varchar(128)", false), S("kind", "varchar(8)", false), S("url", "text", false), S("default_ref", "varchar(128)"), S("auth_ref", "varchar(128)"), S("sync_mode", "varchar(16)", false), S("sync_status", "varchar(16)", false), S("last_synced_at", "timestamptz")], []],
  ["ArtifactRepository", "ref.artifact_repository", "project", "entity",
    [S("project_id", "bigint", false), S("name", "varchar(128)", false), S("kind", "varchar(16)", false), S("url", "text", false), S("namespace", "varchar(128)"), S("auth_ref", "varchar(128)"), S("retention_policy", "jsonb"), S("status", "varchar(16)", false)], []],
  ["DeployEnvironment", "ref.deploy_environment", "project", "entity",
    [S("project_id", "bigint", false), S("env_type", "varchar(16)", false), S("name", "varchar(128)", false), S("host", "varchar(255)", false), S("port", "integer", false), S("ssh_user", "varchar(64)", false), S("auth_ref", "varchar(128)"), S("jump_host_ref", "varchar(128)"), S("isolation_level", "varchar(16)", false), S("approval_policy", "varchar(16)", false), S("status", "varchar(16)", false)], []],
  ["ReleaseOrder", "biz.release_order", "project", "entity",
    [S("project_id", "bigint", false), S("environment_id", "bigint", false), S("version", "varchar(64)", false), S("artifact_refs", "jsonb"), S("repo_refs", "jsonb"), S("change_note", "text"), S("rollback_version", "varchar(64)"), S("requested_by", "varchar(64)", false), S("approved_by", "varchar(64)"), S("status", "varchar(16)", false), S("executed_at", "timestamptz"), S("health_check", "jsonb")], []],
  ["TestPlan", "biz.test_plan", "project", "entity",
    [S("project_id", "bigint", false), S("version", "varchar(64)", false), S("scope", "text"), S("test_types", "jsonb"), S("entry_criteria", "text"), S("exit_criteria", "text"), S("environment_id", "bigint"), S("owner", "varchar(64)"), S("start_date", "date"), S("end_date", "date"), S("status", "varchar(16)", false)], []],
  ["TestCase", "biz.test_case", "project", "entity",
    [S("project_id", "bigint", false), S("plan_id", "bigint"), S("case_code", "varchar(64)", false), S("title", "varchar(256)", false), S("preconditions", "text"), S("steps", "jsonb"), S("expected", "text"), S("priority", "varchar(8)", false), S("kind", "varchar(8)", false), S("requirement_ref", "varchar(64)"), S("version", "varchar(16)", false), S("status", "varchar(16)", false)], []],
  ["TestSuite", "biz.test_suite", "project", "entity",
    [S("project_id", "bigint", false), S("name", "varchar(128)", false), S("case_ids", "jsonb"), S("environment_id", "bigint"), S("status", "varchar(16)", false)], []],
  ["TestRun", "biz.test_run", "project", "entity",
    [S("project_id", "bigint", false), S("plan_id", "bigint"), S("suite_id", "bigint"), S("environment_id", "bigint"), S("version", "varchar(64)", false), S("executor", "varchar(64)", false), S("executor_type", "varchar(16)", false), S("started_at", "timestamptz"), S("ended_at", "timestamptz"), S("status", "varchar(16)", false)], []],
  ["TestResult", "biz.test_result", "project", "entity",
    [S("run_id", "bigint", false), S("case_id", "bigint", false), S("result", "varchar(16)", false), S("evidence", "text"), S("failure_reason", "text"), S("executed_at", "timestamptz")], []],
  ["Defect", "biz.defect", "project", "entity",
    [S("project_id", "bigint", false), S("severity", "varchar(8)", false), S("title", "varchar(256)", false), S("repro_steps", "text"), S("affected_version", "varchar(64)"), S("test_case_id", "bigint"), S("requirement_ref", "varchar(64)"), S("owner", "varchar(64)"), S("status", "varchar(16)", false), S("regression_result", "varchar(16)")], []],
  // ---------------- crm ----------------
  ["Customer", "biz.customer", "crm", "entity",
    [S("name", "varchar(128)", false), S("decision_makers", "jsonb"), S("preferences", "jsonb"), S("payment_habit", "varchar(32)"), S("price_floor", "numeric(18,2)"), S("sensitivity_level", "varchar(16)")],
    [["commitments", "Commitment", "1:N"]]],
  ["CustomerSensitive", "biz.customer_sensitive", "crm", "entity",
    [S("customer_id", "bigint", false), S("field", "varchar(64)", false), S("value", "text"), S("level", "varchar(16)", false)], []],
  ["Commitment", "biz.commitment", "crm", "entity",
    [S("customer_id", "bigint", false), S("content", "text", false), S("due", "date"), S("source", "varchar(16)", false), S("status", "varchar(16)", false)], []],
  ["Quote", "biz.quote", "crm", "entity",
    [S("customer_id", "bigint", false), S("amount", "numeric(18,2)", false), S("quoted_on", "date"), S("rationale", "text"), S("project_id", "bigint")], []],
  // ---------------- inventory ----------------
  ["Sku", "biz.sku", "inventory", "entity",
    [S("name", "varchar(128)", false), S("aliases", "jsonb"), S("unit", "varchar(16)", false), S("safety_stock", "numeric(18,2)")],
    [["transactions", "StockTxn", "1:N"]]],
  ["StockTxn", "biz.stock_txn", "inventory", "entity",
    [S("sku_id", "bigint", false), S("qty", "numeric(18,2)", false), S("unit_price", "numeric(18,4)"), S("txn_type", "varchar(8)", false), S("invoice_status", "varchar(16)"), S("project_id", "bigint"), S("supplier_id", "bigint"), S("reversal_of", "bigint"), S("confidence", "numeric(3,2)"), S("conflict_frozen", "boolean", false)], []],
  // ---------------- vehicle ----------------
  ["VehicleLog", "biz.vehicle_log", "vehicle", "entity",
    [S("plate", "varchar(16)", false), S("trip_date", "date", false), S("km", "numeric(10,2)", false), S("purpose", "varchar(128)"), S("driver", "varchar(64)"), S("subsidy", "numeric(18,2)"), S("evidence_complete", "boolean", false), S("conflict_frozen", "boolean", false)], []],
  ["SubsidyStandard", "biz.subsidy_standard", "vehicle", "entity",
    [S("region", "varchar(32)", false), S("year", "integer", false), S("rule", "jsonb", false), S("official_source_type", "varchar(32)", false), S("source_url", "text"), S("doc_no", "varchar(64)"), S("published_at", "date"), S("collected_at", "timestamptz"), S("confirmed_by", "varchar(64)"), S("version", "integer", false), S("status", "varchar(16)", false)], []],
  // ---------------- intel ----------------
  ["Lead", "biz.lead", "intel", "entity",
    [S("source", "varchar(64)"), S("name", "varchar(128)", false), S("score", "numeric(5,2)"), S("status", "varchar(16)", false)], []],
  ["DdReport", "biz.dd_report", "intel", "entity",
    [S("target", "varchar(128)", false), S("dimensions", "jsonb"), S("conclusion", "text"), S("data_sources", "jsonb"), S("coverage_disclaimer", "text")], []],
  // ---------------- intel：日报流水线与数据源（v2.13） ----------------
  ["IntelProjectScope", "biz.intel_project_scope", "intel", "entity",
    [S("project_id", "bigint", false), S("name", "varchar(128)", false), S("timezone", "varchar(64)", false), S("brief_time", "varchar(5)", false), S("lookback_hours", "integer", false), S("max_items", "integer", false), S("push_channels", "jsonb"), S("recipients", "jsonb"), S("quiet_hours", "jsonb"), S("template", "varchar(64)"), S("status", "varchar(16)", false), S("config_version", "varchar(16)", false), S("last_brief_at", "timestamptz")],
    [["items", "IntelItem", "1:N"], ["briefs", "IntelBrief", "1:N"]]],
  ["Source", "biz.source", "intel", "entity",
    [S("name", "varchar(128)", false), S("source_type", "varchar(16)", false), S("url", "text"), S("auth_ref", "varchar(128)"), S("credibility", "numeric(3,2)", false), S("copyright_status", "varchar(16)", false), S("license_note", "text"), S("collect_interval_minutes", "integer", false), S("rate_limit_per_hour", "integer", false), S("timeout_ms", "integer", false), S("enabled", "boolean", false), S("status", "varchar(16)", false), S("last_success_at", "timestamptz"), S("last_failure_at", "timestamptz"), S("consecutive_failures", "integer", false), S("last_error", "text"), S("checkpoint", "jsonb"), S("created_by", "varchar(64)")],
    [["bindings", "SourceBinding", "1:N"], ["items", "IntelItem", "1:N"]]],
  ["SourceBinding", "biz.source_binding", "intel", "entity",
    [S("source_id", "bigint", false), S("project_id", "bigint", false), S("enabled", "boolean", false), S("priority", "integer", false), S("tags", "jsonb")], []],
  ["WatchTopic", "biz.watch_topic", "intel", "entity",
    [S("project_id", "bigint", false), S("keyword", "varchar(128)", false), S("match_type", "varchar(16)", false), S("synonyms", "jsonb"), S("exclude_terms", "jsonb"), S("tags", "jsonb"), S("priority", "integer", false), S("enabled", "boolean", false), S("version", "integer", false), S("created_by", "varchar(64)")], []],
  ["IntelTag", "biz.intel_tag", "intel", "entity",
    [S("project_id", "bigint", false), S("name", "varchar(64)", false), S("category", "varchar(32)"), S("parent_id", "bigint"), S("color", "varchar(16)"), S("description", "text"), S("status", "varchar(16)", false)], []],
  ["IntelItem", "biz.intel_item", "intel", "entity",
    [S("project_id", "bigint", false), S("source_id", "bigint"), S("external_id", "varchar(256)"), S("url", "text"), S("title", "varchar(512)", false), S("summary", "text"), S("content_hash", "varchar(64)"), S("language", "varchar(16)"), S("author", "varchar(128)"), S("published_at", "timestamptz"), S("collected_at", "timestamptz", false), S("entities", "jsonb"), S("tags", "jsonb"), S("relevance_score", "numeric(5,2)"), S("sentiment", "varchar(16)"), S("info_type", "varchar(16)"), S("risk_level", "varchar(16)"), S("confidence", "numeric(3,2)"), S("dedupe_group", "varchar(64)"), S("status", "varchar(16)", false), S("analysis", "jsonb"), S("idempotency_key", "varchar(256)", false)], []],
  ["IntelCollectRun", "stat.intel_collect_run", "intel", "entity",
    [S("source_id", "bigint"), S("project_id", "bigint"), S("idempotency_key", "varchar(160)", false), S("started_at", "timestamptz", false), S("ended_at", "timestamptz"), S("status", "varchar(16)", false), S("fetched", "integer", false), S("inserted", "integer", false), S("duplicates", "integer", false), S("http_status", "integer"), S("latency_ms", "integer"), S("error", "text"), S("checkpoint_before", "jsonb"), S("checkpoint_after", "jsonb")], []],
  ["IntelBrief", "biz.intel_brief", "intel", "entity",
    [S("project_id", "bigint", false), S("brief_date", "date", false), S("brief_type", "varchar(16)", false), S("title", "varchar(256)", false), S("status", "varchar(16)", false), S("coverage", "jsonb"), S("sections", "jsonb"), S("item_ids", "jsonb"), S("source_count", "integer", false), S("item_count", "integer", false), S("generated_at", "timestamptz", false), S("pushed_at", "timestamptz"), S("version", "integer", false)], []],
  ["IntelPushLog", "stat.intel_push_log", "intel", "entity",
    [S("brief_id", "bigint", false), S("project_id", "bigint", false), S("channel", "varchar(16)", false), S("target", "varchar(256)", false), S("status", "varchar(16)", false), S("attempts", "integer", false), S("sent_at", "timestamptz"), S("acked_at", "timestamptz"), S("error", "text")], []],
  ["IntelPipelineRun", "stat.intel_pipeline_run", "intel", "entity",
    [S("project_id", "bigint", false), S("pipeline_date", "date", false), S("stage", "varchar(16)", false), S("status", "varchar(16)", false), S("started_at", "timestamptz", false), S("ended_at", "timestamptz"), S("counters", "jsonb"), S("error", "text"), S("idempotency_key", "varchar(160)", false)], []],
  // ---------------- workflow ----------------
  ["WorkflowRegistry", "ref.workflow_registry", "workflow", "entity",
    [S("workflow_id", "varchar(64)", false), S("version", "varchar(16)", false), S("owner_plugin", "varchar(64)", false), S("scope", "varchar(16)", false), S("meta", "jsonb", false), S("code_hash", "varchar(64)", false), S("risk_level", "varchar(8)", false), S("status", "varchar(16)", false), S("registered_at", "timestamptz", false)],
    [["instances", "WorkflowInstance", "1:N"]]],
  ["WorkflowInstance", "audit.workflow_instance", "workflow", "entity",
    [S("instance_uuid", "uuid", false), S("workflow_id", "varchar(64)", false), S("version", "varchar(16)", false), S("status", "varchar(16)", false), S("deadline_impact", "boolean", false), S("started_at", "timestamptz", false), S("ended_at", "timestamptz")], []],
  ["WorkflowNodeRun", "audit.workflow_node_run", "workflow", "entity",
    [S("instance_id", "bigint", false), S("node_id", "varchar(64)", false), S("idempotency_key", "varchar(128)", false), S("status", "varchar(16)", false), S("output", "jsonb"), S("started_at", "timestamptz"), S("ended_at", "timestamptz")], []],
  ["VerifierVerdict", "audit.verifier_verdict", "workflow", "entity",
    [S("instance_id", "bigint"), S("node_id", "varchar(64)"), S("verdict", "varchar(16)", false), S("sampling", "integer", false), S("confidence", "numeric(3,2)"), S("evidence_hash", "varchar(64)"), S("escalated", "boolean", false), S("created_at", "timestamptz")], []],
  // ---------------- audit ----------------
  ["AuditLog", "audit.audit_log", "audit", "entity",
    [S("created_at", "timestamptz", false), S("workflow_instance_id", "bigint"), S("actor", "varchar(64)", false), S("action", "varchar(64)", false), S("object_type", "varchar(64)"), S("object_id", "varchar(64)"), S("result", "varchar(16)", false), S("payload", "jsonb"), S("schema_version", "varchar(16)", false), S("test_mode", "boolean", false), S("prev_hash", "varchar(64)"), S("hash", "varchar(64)", false)], []],
  ["AuditChainHead", "audit.audit_chain_head", "audit", "entity",
    [S("last_hash", "varchar(64)"), S("last_export_id", "bigint"), S("updated_at", "timestamptz")], []],
  ["AuditExport", "audit.audit_export", "audit", "entity",
    [S("file_path", "text", false), S("sha256", "varchar(64)", false), S("prev_export_hash", "varchar(64)"), S("row_count", "integer", false), S("last_audit_id", "bigint"), S("exported_at", "timestamptz", false)], []],
  // ---------------- scheduler ----------------
  ["TaskSchedule", "stat.task_schedule", "scheduler", "entity",
    [S("task_id", "varchar(64)", false), S("cron", "varchar(64)", false), S("timezone", "varchar(64)", false), S("enabled", "boolean", false), S("config", "jsonb"), S("last_run_at", "timestamptz"), S("next_run_at", "timestamptz")], []],
  ["TaskRun", "stat.task_run", "scheduler", "entity",
    [S("task_id", "varchar(64)", false), S("scheduled_at", "timestamptz", false), S("started_at", "timestamptz"), S("ended_at", "timestamptz"), S("status", "varchar(16)", false), S("attempt", "integer", false), S("error", "text"), S("result", "jsonb")], []],
  ["Notification", "stat.notification", "scheduler", "entity",
    [S("kind", "varchar(32)", false), S("level", "varchar(16)", false), S("payload", "jsonb"), S("status", "varchar(16)", false), S("created_at", "timestamptz", false)], []],
  ["DailyReport", "stat.daily_report", "scheduler", "entity",
    [S("report_date", "date", false), S("content", "jsonb", false), S("sent_at", "timestamptz")], []],
  // ---------------- wbs / publicity / employees（v2.11） ----------------
  ["WbsNode", "biz.wbs_node", "wbs", "entity",
    [S("project_id", "bigint", false), S("parent_id", "bigint"), S("node_code", "varchar(32)", false), S("name", "varchar(128)", false), S("deliverable", "text"), S("owner", "varchar(64)"), S("estimate_hours", "numeric(10,2)"), S("start_date", "date"), S("end_date", "date"), S("status", "varchar(16)", false), S("progress", "integer", false), S("dependencies", "jsonb"), S("acceptance_criteria", "text"), S("baseline_version", "varchar(16)"), S("conflict_frozen", "boolean", false)], []],
  ["WbsBaseline", "biz.wbs_baseline", "wbs", "entity",
    [S("project_id", "bigint", false), S("version", "varchar(16)", false), S("snapshot", "jsonb", false), S("approved_by", "varchar(64)"), S("approved_at", "timestamptz"), S("status", "varchar(16)", false)], []],
  ["WbsChange", "biz.wbs_change", "wbs", "entity",
    [S("wbs_id", "bigint", false), S("change_type", "varchar(16)", false), S("reason", "text"), S("impact", "text"), S("requested_by", "varchar(64)"), S("approved_by", "varchar(64)"), S("status", "varchar(16)", false), S("decided_at", "timestamptz")], []],
  ["PublicationPlan", "biz.publication_plan", "publicity", "entity",
    [S("period", "varchar(16)", false), S("theme", "varchar(128)", false), S("channel_mix", "jsonb"), S("owner", "varchar(64)"), S("status", "varchar(16)", false)], []],
  ["Publication", "biz.publication", "publicity", "entity",
    [S("plan_id", "bigint"), S("channel", "varchar(32)", false), S("title", "varchar(256)", false), S("content", "text", false), S("audience", "varchar(128)"), S("status", "varchar(16)", false), S("risk_level", "varchar(8)", false), S("scheduled_at", "timestamptz"), S("published_at", "timestamptz"), S("external_url", "text"), S("source_refs", "jsonb")], []],
  ["PublicationApproval", "biz.publication_approval", "publicity", "entity",
    [S("publication_id", "bigint", false), S("reviewer", "varchar(64)", false), S("decision", "varchar(16)", false), S("comment", "text"), S("decided_at", "timestamptz")], []],
  ["ChannelAccount", "biz.channel_account", "publicity", "entity",
    [S("channel", "varchar(32)", false), S("account_name", "varchar(128)", false), S("owner", "varchar(64)"), S("status", "varchar(16)", false), S("last_sync_at", "timestamptz")], []],
  ["EmployeePackage", "ref.employee_package", "employees", "entity",
    [S("package_code", "varchar(64)", false), S("plugin_id", "varchar(64)", false), S("version", "varchar(16)", false), S("manifest", "jsonb", false), S("checksum", "varchar(64)", false), S("signature", "varchar(128)"), S("size_bytes", "integer", false), S("status", "varchar(16)", false), S("created_by", "varchar(64)"), S("source", "varchar(32)"), S("created_at", "timestamptz")], []],
  ["EmployeeImportJob", "ref.employee_import_job", "employees", "entity",
    [S("package_code", "varchar(64)", false), S("dry_run", "boolean", false), S("status", "varchar(16)", false), S("report", "jsonb"), S("created_at", "timestamptz"), S("decided_at", "timestamptz"), S("decided_by", "varchar(64)")], []],
  // ---------------- web（v2.10 网页表现层） ----------------
  ["WebIngestItem", "stat.web_ingest_item", "web", "entity",
    [S("source_type", "varchar(16)", false), S("source_ref", "varchar(128)", false), S("raw_text", "text", false), S("content_hash", "varchar(64)", false), S("extracted", "jsonb"), S("domain", "varchar(16)", false), S("confidence", "numeric(4,3)", false), S("status", "varchar(16)", false), S("requires_human", "boolean", false), S("idempotency_key", "varchar(128)", false), S("created_at", "timestamptz"), S("confirmed_by", "varchar(64)"), S("confirmed_at", "timestamptz")], []],
  ["WebSessionGrant", "ref.web_session_grant", "web", "entity",
    [S("session_id", "varchar(128)", false), S("message_scope", "varchar(32)", false), S("purpose", "varchar(128)", false), S("granted_by", "varchar(64)", false), S("granted_at", "timestamptz"), S("expires_at", "timestamptz", false), S("revoked_at", "timestamptz"), S("status", "varchar(16)", false)], []],
  ["WebSessionMessage", "stat.web_session_message", "web", "entity",
    [S("session_id", "varchar(128)", false), S("message_id", "varchar(128)", false), S("role", "varchar(16)", false), S("content", "text", false), S("created_at", "timestamptz")], []],
  ["WebMemoryCard", "stat.web_memory_card", "web", "entity",
    [S("scope", "varchar(32)", false), S("title", "varchar(128)", false), S("content", "text", false), S("source_refs", "jsonb", false), S("confidence", "numeric(3,2)", false), S("content_hash", "varchar(64)", false), S("sensitive", "boolean", false), S("created_at", "timestamptz")], []],
  ["WebMemoryProposal", "stat.web_memory_proposal", "web", "entity",
    [S("memory_type", "varchar(32)", false), S("title", "varchar(128)", false), S("content", "text", false), S("source_refs", "jsonb", false), S("confidence", "numeric(3,2)", false), S("status", "varchar(16)", false), S("created_at", "timestamptz"), S("confirmed_at", "timestamptz")], []],
  ["DashboardSnapshot", "stat.dashboard_snapshot", "web", "entity",
    [S("range_key", "varchar(16)", false), S("as_of", "timestamptz", false), S("stale", "boolean", false), S("payload", "jsonb", false), S("warnings", "jsonb", false), S("generated_at", "timestamptz")], []],
  ["BriefItem", "stat.brief_item", "web", "entity",
    [S("brief_date", "date", false), S("brief_type", "varchar(16)", false), S("title", "varchar(128)", false), S("summary", "text", false), S("source_refs", "jsonb", false), S("priority", "varchar(8)", false), S("status", "varchar(16)", false), S("created_at", "timestamptz")], []],
  // ---------------- 项目自动驾驶（v2.16） ----------------
  ["ProjectCheckout", "ref.project_checkout", "project", "entity",
    [S("project_id", "bigint", false), S("repository_id", "bigint"), S("url", "text", false), S("branch", "varchar(128)"), S("commit_sha", "varchar(64)"), S("workspace_path", "text"), S("file_count", "integer"), S("size_bytes", "bigint"), S("status", "varchar(16)", false), S("error", "text"), S("checked_out_at", "timestamptz"), S("created_at", "timestamptz")], []],
  ["ProjectScan", "stat.project_scan", "project", "entity",
    [S("project_id", "bigint", false), S("checkout_id", "bigint"), S("scanner_version", "varchar(16)", false), S("languages", "jsonb"), S("manifests", "jsonb"), S("structure", "jsonb"), S("tests", "jsonb"), S("ci", "jsonb"), S("findings", "jsonb"), S("status", "varchar(16)", false), S("created_at", "timestamptz")], []],
  ["ProjectPlan", "stat.project_plan", "project", "entity",
    [S("project_id", "bigint", false), S("plan_kind", "varchar(8)", false), S("version", "integer", false), S("title", "varchar(128)", false), S("content", "jsonb", false), S("status", "varchar(16)", false), S("generated_at", "timestamptz")], []],
  ["ProjectDecision", "stat.project_decision", "project", "entity",
    [S("project_id", "bigint", false), S("topic", "varchar(32)", false), S("question", "text", false), S("options", "jsonb"), S("risk_level", "varchar(8)", false), S("status", "varchar(16)", false), S("decision", "text"), S("decided_by", "varchar(64)"), S("decided_at", "timestamptz"), S("payload", "jsonb"), S("created_at", "timestamptz")], []],
  ["ProjectScaffold", "stat.project_scaffold", "project", "entity",
    [S("project_id", "bigint", false), S("checkout_id", "bigint"), S("branch", "varchar(128)"), S("files", "jsonb"), S("status", "varchar(16)", false), S("error", "text"), S("created_at", "timestamptz")], []],
  ["ProjectPipelineRun", "stat.project_pipeline_run", "project", "entity",
    [S("project_id", "bigint", false), S("checkout_id", "bigint"), S("stage", "varchar(16)", false), S("command", "text", false), S("exit_code", "integer"), S("status", "varchar(16)", false), S("log_tail", "text"), S("duration_ms", "integer"), S("created_at", "timestamptz")], []],
  ["ProjectDeployRun", "stat.project_deploy_run", "project", "entity",
    [S("project_id", "bigint", false), S("release_id", "bigint"), S("environment_id", "bigint"), S("command", "text"), S("health_url", "text"), S("exit_code", "integer"), S("status", "varchar(16)", false), S("log_tail", "text"), S("started_at", "timestamptz"), S("ended_at", "timestamptz"), S("created_at", "timestamptz")], []],
  // ---------------- 运维闭环（v2.18） ----------------
  ["UsageEvent", "stat.usage_event", "platform", "event",
    [S("channel", "varchar(16)", false), S("action", "varchar(160)", false), S("status_code", "integer"), S("duration_ms", "integer"), S("error_code", "varchar(32)"), S("session_ref", "varchar(64)"), S("meta", "jsonb"), S("occurred_at", "timestamptz")], []],
  ["RuntimeError", "stat.runtime_error", "platform", "entity",
    [S("fingerprint", "varchar(64)", false), S("method", "varchar(8)"), S("route", "varchar(200)"), S("status_code", "integer"), S("error_code", "varchar(32)"), S("message", "text"), S("occurrences", "integer", false), S("first_seen", "timestamptz"), S("last_seen", "timestamptz"), S("filed_issue_id", "bigint")], []],
  ["IssueFiling", "stat.issue_filing", "platform", "entity",
    [S("fingerprint", "varchar(64)", false), S("source", "varchar(16)", false), S("title", "varchar(256)", false), S("body", "text", false), S("severity", "varchar(8)", false), S("status", "varchar(16)", false), S("github_number", "integer"), S("github_url", "text"), S("error", "text"), S("attempts", "integer", false), S("created_at", "timestamptz"), S("filed_at", "timestamptz")], []],
  ["ProjectIdea", "stat.project_idea", "project", "entity",
    [S("project_id", "bigint", false), S("idea", "text", false), S("analysis", "jsonb"), S("source", "varchar(8)", false), S("model", "varchar(64)"), S("status", "varchar(24)", false), S("error", "text"), S("created_at", "timestamptz")], []],
  // ---------------- 基础资源配置（v2.14 公司共享资产） ----------------
  ["SharedResource", "ref.shared_resource", "platform", "entity",
    [S("kind", "varchar(24)", false), S("code", "varchar(64)"), S("name", "varchar(128)", false), S("endpoint", "text"), S("access_method", "varchar(24)", false), S("default_account", "varchar(64)"), S("credential_ref", "varchar(128)"), S("os", "varchar(64)"), S("location", "varchar(128)"), S("capacity", "varchar(128)"), S("specs", "jsonb"), S("tags", "jsonb"), S("is_default", "boolean", false), S("status", "varchar(16)", false), S("notes", "text"), S("created_at", "timestamptz"), S("updated_at", "timestamptz")], []],
  ["SharedSetting", "ref.shared_setting", "platform", "code-table",
    [S("key", "varchar(64)", false), S("value", "jsonb", false), S("updated_at", "timestamptz")], []],
  ["ProjectSharedResource", "ref.project_shared_resource", "project", "entity",
    [S("project_id", "bigint", false), S("resource_id", "bigint", false), S("role", "varchar(16)", false), S("applied_by_default", "boolean", false), S("created_at", "timestamptz")], []],
  ["RadarItem", "stat.radar_item", "web", "entity",
    [S("radar_type", "varchar(16)", false), S("title", "varchar(256)", false), S("url", "text", false), S("published_at", "date"), S("score", "numeric(5,2)", false), S("reason", "text", false), S("risks", "jsonb", false), S("dedupe_key", "varchar(256)", false), S("status", "varchar(16)", false), S("created_at", "timestamptz")], []],
];

/* ---------- 极简块式 YAML 生成器（只覆盖本规格用到的形状） ---------- */
const NEEDS_QUOTE = /^(true|false|null|~|-?\d+(\.\d+)?)$|[:#{}[\],&*!|>'"%@`]/;

function scalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  if (NEEDS_QUOTE.test(text) || text.trim() !== text || text === "") return JSON.stringify(text);
  return text;
}

function emit(value, indent) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const lines = emit(item, indent + 2);
        return `${pad}- ${lines.trimStart()}`;
      }
      return `${pad}- ${scalar(item)}`;
    }).join("\n");
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).map(([key, child]) => {
      if (Array.isArray(child)) {
        if (child.length === 0) return `${pad}${key}: []`;
        return `${pad}${key}:\n${emit(child, indent + 2)}`;
      }
      if (child !== null && typeof child === "object") {
        return `${pad}${key}:\n${emit(child, indent + 2)}`;
      }
      return `${pad}${key}: ${scalar(child)}`;
    }).join("\n");
  }
  return `${pad}${scalar(value)}`;
}

function build() {
  const doc = {
    package: "OPC-玄机 · 一人公司中枢",
    baselineTag: "v2.11-20261106",
    schemaMapping: [],
    entities: ENTITIES.map(([name, table, module, kind, attributes, relations, vector]) => {
      const entity = {
        name,
        table,
        module,
        kind,
        primaryKey: { strategy: "identity", type: "bigint", column: "id" },
        attributes: attributes.map((a) => {
          const row = { name: a.name, type: a.type };
          if (a.nullable !== undefined) row.nullable = a.nullable;
          return row;
        }),
      };
      if (relations && relations.length > 0) {
        entity.relations = relations.map(([relName, target, cardinality]) => ({ name: relName, target, cardinality }));
      }
      if (vector && vector.length > 0) {
        entity.vector = vector.map(([vecName, dimension, index]) => ({ name: vecName, dimension, index }));
      }
      return entity;
    }),
  };
  return `# 由 scripts/gen-spec.mjs 生成，勿手改；改实体请改生成器后重跑。\n${emit(doc, 0)}\n`;
}

const output = build();
if (process.argv.includes("--check")) {
  const current = await readFile(SPEC, "utf8").catch(() => "");
  if (current !== output) {
    console.error("entities.yaml 与生成器数据不一致，请重跑 node scripts/gen-spec.mjs");
    process.exit(1);
  }
  console.log("entities.yaml 与生成器一致");
} else {
  await writeFile(SPEC, output, "utf8");
  console.log(`wrote ${SPEC} (${output.split("\n").length - 1} lines, ${ENTITIES.length} entities)`);
}
