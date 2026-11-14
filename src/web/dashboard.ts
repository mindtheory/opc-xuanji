/**
 * 驾驶舱聚合：只读聚合现有业务表，产出带 as_of / stale / warnings 的快照。
 *
 * 约束（产品设计 9.7 / 架构 8.6）：
 * - 面板不直接扫业务主表，统一经本服务；
 * - 一次快照在 REPEATABLE READ 只读事务内完成，返回统一 as_of；
 * - 敏感字段不 JOIN customer_sensitive；冻结事件按“总额（含冻结）+ 脚注”口径；
 * - 聚合失败保留上次快照并标注陈旧，不填充 0。
 */
import type { Pool } from "../db/pool.ts";

export type DashboardRange = "today" | "7d" | "30d" | "90d";

export interface DashboardMetric {
  id: string;
  label: string;
  value: number;
  unit: string;
  group: string;
  source: string;
}

export interface DashboardSnapshot {
  snapshotId: number | null;
  asOf: string;
  range: DashboardRange;
  stale: boolean;
  metrics: DashboardMetric[];
  frozen: { count: number; amount: number };
  warnings: string[];
}

const RANGE_DAYS: Record<DashboardRange, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };

export function parseRange(value: string | undefined): DashboardRange {
  if (value === "today" || value === "7d" || value === "30d" || value === "90d") return value;
  return "30d";
}

export function isSnapshotStale(asOf: Date, now: Date, maxAgeMinutes: number): boolean {
  return now.getTime() - asOf.getTime() > maxAgeMinutes * 60_000;
}

function metric(id: string, label: string, value: number, unit: string, group: string, source: string): DashboardMetric {
  return { id, label, value, unit, group, source };
}

export class DashboardService {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async snapshot(range: DashboardRange = "30d"): Promise<DashboardSnapshot> {
    const days = RANGE_DAYS[range];
    const client = await this.pool.connect();
    let asOf = new Date();
    let metrics: DashboardMetric[];
    let frozen: { count: number; amount: number };
    const warnings: string[] = [];
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      asOf = new Date();

      const ledger = await client.query<{ inflow: string; outflow: string; frozen_amount: string }>(
        `SELECT coalesce(sum(amount) FILTER (WHERE direction = 'in'), 0)::text AS inflow,
                coalesce(sum(amount) FILTER (WHERE direction = 'out'), 0)::text AS outflow,
                coalesce(sum(amount) FILTER (WHERE conflict_frozen), 0)::text AS frozen_amount
         FROM biz.ledger WHERE entry_date >= current_date - $1::int`,
        [days],
      );
      const arAp = await client.query<{ open_count: number; open_amount: string }>(
        `SELECT count(*)::int AS open_count, coalesce(sum(amount), 0)::text AS open_amount
         FROM biz.ar_ap WHERE status = 'open'`,
      );
      const tax = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM biz.tax_calendar WHERE status = 'pending' AND deadline BETWEEN current_date AND current_date + 7",
      );
      const contracts = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM biz.contract WHERE status = 'active' AND end_date BETWEEN current_date AND current_date + 30",
      );
      const projects = await client.query<{ blocked: number; running: number }>(
        `SELECT count(*) FILTER (WHERE jsonb_array_length(coalesce(blockers, '[]'::jsonb)) > 0)::int AS blocked,
                count(*)::int AS running
         FROM biz.project WHERE stage <> 'done'`,
      );
      const conflicts = await client.query<{ n: number; frozen_amount: string }>(
        `SELECT count(*)::int AS n, coalesce(sum(0), 0)::text AS frozen_amount
         FROM biz.conflict_queue WHERE status IN ('open','later')`,
      );
      const workflow = await client.query<{ running: number; blocked: number }>(
        `SELECT count(*) FILTER (WHERE status = 'running')::int AS running,
                count(*) FILTER (WHERE status IN ('blocked','awaiting_decision'))::int AS blocked
         FROM audit.workflow_instance`,
      );
      const taskFailures = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM stat.task_run WHERE status = 'failed' AND started_at > now() - interval '24 hours'",
      );
      const inbox = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM stat.web_ingest_item WHERE status IN ('inbox','pending','auto_draft')",
      );
      const radar = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM stat.radar_item WHERE status = 'new'",
      );
      const wbs = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM biz.wbs_node WHERE status IN ('blocked','in_progress') AND end_date < current_date",
      );
      const publication = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM biz.publication WHERE status IN ('pending','approved','scheduled')",
      );
      const projectPulse = await client.query<{
        milestones_overdue: number;
        milestones_due_7d: number;
        releases_pending: number;
        defects_open: number;
        test_failures: number;
        test_results: number;
        test_passed: number;
        repos_failed: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM biz.project_milestone
             WHERE target_date < current_date AND status NOT IN ('achieved','cancelled')) AS milestones_overdue,
           (SELECT count(*)::int FROM biz.project_milestone
             WHERE target_date BETWEEN current_date AND current_date + 7
               AND status NOT IN ('achieved','cancelled')) AS milestones_due_7d,
           (SELECT count(*)::int FROM biz.release_order WHERE status = 'pending') AS releases_pending,
           (SELECT count(*)::int FROM biz.defect WHERE status IN ('open','in_progress','reopened')) AS defects_open,
           (SELECT count(*)::int FROM biz.test_run WHERE status IN ('failed','blocked')) AS test_failures,
           (SELECT count(*)::int FROM biz.test_result) AS test_results,
           (SELECT count(*)::int FROM biz.test_result WHERE result = 'passed') AS test_passed,
           (SELECT count(*)::int FROM ref.code_repository WHERE sync_status = 'failed') AS repos_failed`,
      );
      const intelPulse = await client.query<{
        scopes_active: number;
        sources_active: number;
        sources_blocked: number;
        items_new: number;
        briefs_7d: number;
        pipeline_failures: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM biz.intel_project_scope WHERE status = 'active') AS scopes_active,
           (SELECT count(*)::int FROM biz.source WHERE status = 'active') AS sources_active,
           (SELECT count(*)::int FROM biz.source WHERE status = 'blocked') AS sources_blocked,
           (SELECT count(*)::int FROM biz.intel_item WHERE collected_at >= now() - ($1::int * interval '1 day')) AS items_new,
           (SELECT count(*)::int FROM biz.intel_brief WHERE brief_date >= current_date - 7) AS briefs_7d,
           (SELECT count(*)::int FROM stat.intel_pipeline_run
             WHERE status = 'failed' AND started_at > now() - interval '24 hours') AS pipeline_failures`,
        [days],
      );

      await client.query("COMMIT");

      const ledgerRow = ledger.rows[0] ?? { inflow: "0", outflow: "0", frozen_amount: "0" };
      const arRow = arAp.rows[0] ?? { open_count: 0, open_amount: "0" };
      const projectRow = projects.rows[0] ?? { blocked: 0, running: 0 };
      const workflowRow = workflow.rows[0] ?? { running: 0, blocked: 0 };
      const conflictRow = conflicts.rows[0] ?? { n: 0, frozen_amount: "0" };
      const projectPulseRow = projectPulse.rows[0] ?? {
        milestones_overdue: 0,
        milestones_due_7d: 0,
        releases_pending: 0,
        defects_open: 0,
        test_failures: 0,
        test_results: 0,
        test_passed: 0,
        repos_failed: 0,
      };
      const intelPulseRow = intelPulse.rows[0] ?? {
        scopes_active: 0,
        sources_active: 0,
        sources_blocked: 0,
        items_new: 0,
        briefs_7d: 0,
        pipeline_failures: 0,
      };
      const testPassRate = projectPulseRow.test_results === 0 ? 0 : Math.round((projectPulseRow.test_passed / projectPulseRow.test_results) * 1000) / 10;

      frozen = { count: conflictRow.n, amount: Number(ledgerRow.frozen_amount) };
      metrics = [
        metric("cash_inflow", "现金流入", Number(ledgerRow.inflow), "CNY", "finance", "biz.ledger"),
        metric("cash_outflow", "现金流出", Number(ledgerRow.outflow), "CNY", "finance", "biz.ledger"),
        metric("ar_ap_open", "应收应付未结", Number(arRow.open_amount), "CNY", "finance", "biz.ar_ap"),
        metric("ar_ap_count", "未结笔数", arRow.open_count, "count", "finance", "biz.ar_ap"),
        metric("tax_due_7d", "7 天内申报", tax.rows[0]?.n ?? 0, "count", "finance", "biz.tax_calendar"),
        metric("contract_expiring_30d", "30 天内到期合同", contracts.rows[0]?.n ?? 0, "count", "legal", "biz.contract"),
        metric("project_blocked", "阻塞项目", projectRow.blocked, "count", "project", "biz.project"),
        metric("project_running", "进行中项目", projectRow.running, "count", "project", "biz.project"),
        metric("conflict_open", "待裁决冲突", conflictRow.n, "count", "platform", "biz.conflict_queue"),
        metric("workflow_running", "运行中流程", workflowRow.running, "count", "workflow", "audit.workflow_instance"),
        metric("workflow_blocked", "阻塞流程", workflowRow.blocked, "count", "workflow", "audit.workflow_instance"),
        metric("task_failures_24h", "24h 任务失败", taskFailures.rows[0]?.n ?? 0, "count", "scheduler", "stat.task_run"),
        metric("ingest_pending", "待归置", inbox.rows[0]?.n ?? 0, "count", "web", "stat.web_ingest_item"),
        metric("radar_new", "雷达新条目", radar.rows[0]?.n ?? 0, "count", "web", "stat.radar_item"),
        metric("wbs_overdue", "WBS 逾期工作包", wbs.rows[0]?.n ?? 0, "count", "wbs", "biz.wbs_node"),
        metric("publication_pending", "外宣待发/待审", publication.rows[0]?.n ?? 0, "count", "publicity", "biz.publication"),
        metric("project_milestones_overdue", "逾期里程碑", projectPulseRow.milestones_overdue, "count", "project", "biz.project_milestone"),
        metric("project_milestones_due_7d", "7 天内里程碑", projectPulseRow.milestones_due_7d, "count", "project", "biz.project_milestone"),
        metric("project_releases_pending", "待批发布单", projectPulseRow.releases_pending, "count", "project", "biz.release_order"),
        metric("project_defects_open", "未关闭缺陷", projectPulseRow.defects_open, "count", "project", "biz.defect"),
        metric("project_test_failures", "失败/阻塞测试批次", projectPulseRow.test_failures, "count", "project", "biz.test_run"),
        metric("project_test_pass_rate", "测试通过率", testPassRate, "%", "project", "biz.test_result"),
        metric("project_repos_failed", "版本库同步异常", projectPulseRow.repos_failed, "count", "project", "ref.code_repository"),
        metric("intel_scopes_active", "情报空间", intelPulseRow.scopes_active, "count", "intel", "biz.intel_project_scope"),
        metric("intel_sources_active", "活跃情报源", intelPulseRow.sources_active, "count", "intel", "biz.source"),
        metric("intel_sources_blocked", "异常情报源", intelPulseRow.sources_blocked, "count", "intel", "biz.source"),
        metric("intel_items_new", "区间新增情报", intelPulseRow.items_new, "count", "intel", "biz.intel_item"),
        metric("intel_briefs_7d", "7 天日报", intelPulseRow.briefs_7d, "count", "intel", "biz.intel_brief"),
        metric("intel_pipeline_failures", "24h 流水线失败", intelPulseRow.pipeline_failures, "count", "intel", "stat.intel_pipeline_run"),
      ];
      if (frozen.count > 0) warnings.push(`含 ${frozen.count} 笔待裁决冲突，总额含冻结，暂缓计入`);
      if (Number(ledgerRow.inflow) === 0 && Number(ledgerRow.outflow) === 0) warnings.push("所选区间无台账数据");
      if (projectPulseRow.test_failures > 0) warnings.push(`有 ${projectPulseRow.test_failures} 个测试批次失败或阻塞`);
      if (intelPulseRow.sources_blocked > 0) warnings.push(`有 ${intelPulseRow.sources_blocked} 个情报源处于 blocked`);
      if (intelPulseRow.pipeline_failures > 0) warnings.push(`24h 内有 ${intelPulseRow.pipeline_failures} 次情报流水线失败`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      const last = await this.pool.query<{
        id: number;
        as_of: Date;
        payload: { metrics?: DashboardMetric[]; frozen?: { count: number; amount: number } };
        warnings: string[];
      }>(
        "SELECT id, as_of, payload, warnings FROM stat.dashboard_snapshot WHERE range_key = $1 ORDER BY generated_at DESC LIMIT 1",
        [range],
      );
      const row = last.rows[0];
      if (row === undefined) throw error;
      return {
        snapshotId: row.id,
        asOf: row.as_of.toISOString(),
        range,
        stale: true,
        metrics: row.payload?.metrics ?? [],
        frozen: row.payload?.frozen ?? { count: 0, amount: 0 },
        warnings: [...(row.warnings ?? []), `聚合失败，返回上次快照：${error instanceof Error ? error.message : String(error)}`],
      };
    } finally {
      client.release();
    }

    let snapshotId: number | null = null;
    try {
      const inserted = await this.pool.query<{ id: number }>(
        `INSERT INTO stat.dashboard_snapshot (range_key, as_of, stale, payload, warnings)
         VALUES ($1,$2,false,$3::jsonb,$4::jsonb) RETURNING id`,
        [range, asOf, JSON.stringify({ metrics, frozen }), JSON.stringify(warnings)],
      );
      snapshotId = inserted.rows[0]?.id ?? null;
    } catch (error) {
      warnings.push(`快照落库失败：${error instanceof Error ? error.message : String(error)}`);
    }

    return { snapshotId, asOf: asOf.toISOString(), range, stale: false, metrics, frozen, warnings };
  }
}
