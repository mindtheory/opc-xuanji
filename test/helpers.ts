/**
 * 集成测试公共装置：测试库连接、清库、种子数据。
 *
 * 铁律：集成测试只允许连 OPC_TEST_DSN（默认 opc_test），并在 before/after 清库，
 * 不得触碰业务库 opc —— loadConfig 在 NODE_ENV=test 下会拒绝两库同串。
 */
import { loadConfig } from "../src/platform/config.ts";
import { createPool, type Pool } from "../src/db/pool.ts";

export const config = loadConfig();
export const testDsn = config.testDsn;

const TABLES = [
  "stat.issue_filing",
  "stat.runtime_error",
  "stat.usage_event",
  "stat.project_deploy_run",
  "stat.project_pipeline_run",
  "stat.project_scaffold",
  "stat.project_decision",
  "stat.project_plan",
  "stat.project_scan",
  "ref.project_checkout",
  "ref.project_shared_resource",
  "ref.shared_resource",
  "ref.shared_setting",
  "stat.intel_push_log",
  "stat.intel_pipeline_run",
  "stat.intel_collect_run",
  "biz.intel_brief",
  "biz.intel_item",
  "biz.intel_tag",
  "biz.watch_topic",
  "biz.source_binding",
  "biz.source",
  "biz.intel_project_scope",
  "biz.test_result",
  "biz.test_run",
  "biz.test_suite",
  "biz.test_case",
  "biz.test_plan",
  "biz.defect",
  "biz.release_order",
  "biz.work_log",
  "biz.project_milestone",
  "ref.deploy_environment",
  "ref.artifact_repository",
  "ref.code_repository",
  "audit.verifier_verdict",
  "audit.workflow_node_run",
  "audit.workflow_instance",
  "audit.audit_export",
  "audit.audit_chain_head",
  "audit.audit_log",
  "stat.task_run",
  "stat.task_schedule",
  "stat.notification",
  "stat.daily_report",
  "stat.web_ingest_item",
  "stat.web_session_message",
  "stat.web_memory_card",
  "stat.web_memory_proposal",
  "stat.dashboard_snapshot",
  "stat.brief_item",
  "stat.radar_item",
  "ref.web_session_grant",
  "ref.employee_import_job",
  "ref.employee_package",
  "biz.wbs_change",
  "biz.wbs_node",
  "biz.wbs_baseline",
  "biz.publication_approval",
  "biz.publication",
  "biz.publication_plan",
  "biz.channel_account",
  "ref.token",
  "ref.view_grant",
  "ref.employee_plugin",
  "ref.risk_rule",
  "ref.workflow_registry",
  "biz.conflict_queue",
  "biz.ledger",
  "biz.tax_calendar",
  "biz.ar_ap",
  "biz.contract",
  "biz.event",
  "biz.action_item",
  "biz.objective",
  "biz.decision",
  "biz.project",
  "biz.customer_sensitive",
  "biz.commitment",
  "biz.quote",
  "biz.customer",
  "biz.stock_txn",
  "biz.sku",
  "biz.vehicle_log",
  "biz.subsidy_standard",
  "biz.lead",
  "biz.dd_report",
  "biz.company_profile",
  "vec.embedding",
];

export function makePool(): Pool {
  return createPool(testDsn, { max: 4 });
}

/** 清空全部业务表（保留迁移台账）。 */
export async function resetDb(pool: Pool): Promise<void> {
  // 跨测试文件可能并发清库：用会话级 advisory lock 串行化，避免 TRUNCATE 的 AccessExclusiveLock 死锁
  await pool.query("SELECT pg_advisory_lock(824361)");
  try {
    await pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  } finally {
    await pool.query("SELECT pg_advisory_unlock(824361)");
  }
}

/** 注册一个员工插件（默认给全部视图授权）。 */
export async function seedEmployee(
  pool: Pool,
  pluginId: string,
  options: { views?: string[]; tools?: string[]; writeTargets?: string[]; scope?: "single" | "cross"; enabled?: boolean } = {},
): Promise<void> {
  const views = options.views ?? [];
  await pool.query(
    `INSERT INTO ref.employee_plugin (plugin_id, display_name, scope, required_views, tools, write_targets, enabled)
     VALUES ($1, $1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6)
     ON CONFLICT (plugin_id) DO UPDATE SET required_views = EXCLUDED.required_views,
       tools = EXCLUDED.tools, write_targets = EXCLUDED.write_targets, enabled = EXCLUDED.enabled`,
    [
      pluginId,
      options.scope ?? "single",
      JSON.stringify(views),
      JSON.stringify(options.tools ?? []),
      JSON.stringify(options.writeTargets ?? []),
      options.enabled ?? true,
    ],
  );
  for (const view of views) {
    await pool.query(
      `INSERT INTO ref.view_grant (view_id, plugin_id, status) VALUES ($1, $2, 'active')
       ON CONFLICT (view_id, plugin_id) DO UPDATE SET status = 'active'`,
      [view, pluginId],
    );
  }
}

/** 固定测试时间，避免时区/跨日抖动。 */
export const NOW = new Date("2026-11-05T02:00:00.000Z"); // 北京时间 10:00
