/**
 * 定时自动化任务集成测试：配置驱动（cron/时区/参数）、幂等执行、晨报聚合、审计导出任务。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "../../src/db/pool.ts";
import { makePool, resetDb } from "../helpers.ts";
import { AuditService } from "../../src/audit/audit.ts";
import { Scheduler } from "../../src/scheduler/engine.ts";
import { defaultTasks } from "../../src/scheduler/tasks/index.ts";
import { OpcError } from "../../src/platform/errors.ts";

let pool: Pool;
let audit: AuditService;
let scheduler: Scheduler;
let archiveDir: string;

before(async () => {
  pool = makePool();
  audit = new AuditService(pool, { schemaVersion: "1" });
  archiveDir = await mkdtemp(join(tmpdir(), "opc-archive-"));
  scheduler = new Scheduler(pool, audit, { archiveDir });
  for (const task of defaultTasks()) scheduler.register(task);
  await scheduler.seedDefaults();
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDb(pool);
  // 清库会清掉调度配置：每个用例重新落默认任务配置
  await scheduler.seedDefaults();
});

test("默认任务集已按配置落库（晨报/税务/合同/审计/缺票/冲突/月度归档）", async () => {
  const tasks = await scheduler.list();
  const ids = tasks.map((task) => task.taskId).sort();
  assert.deepEqual(ids, [
    "audit_export",
    "conflict_escalation",
    "contract_expiry",
    "daily_report",
    "dashboard_refresh",
    "invoice_backlog",
    "keyword_radar_scan",
    "monthly_archive",
    "plugin_radar_scan",
    "tax_reminder",
  ]);
  const report = tasks.find((task) => task.taskId === "daily_report");
  assert.equal(report?.cron, "30 8 * * 1-5");
  assert.equal(report?.timezone, "Asia/Shanghai");
  assert.ok(report?.nextRunAt instanceof Date);
});

test("配置校验：非法 cron 与未注册任务类型拒绝", async () => {
  await assert.rejects(
    () => scheduler.upsert("daily_report", { cron: "99 * * * *", timezone: "Asia/Shanghai" }),
    (error: unknown) => error instanceof OpcError && error.errorCode === "ERR-TASK-001",
  );
  await assert.rejects(
    () => scheduler.upsert("not_registered", { cron: "0 9 * * *", timezone: "Asia/Shanghai" }),
    (error: unknown) => error instanceof OpcError && error.errorCode === "ERR-TASK-001",
  );
});

test("执行幂等：同一计划时间只执行一次，force 可强制重跑", async () => {
  const scheduledAt = new Date("2026-11-05T01:00:00.000Z");
  const first = await scheduler.run("audit_export", { scheduledAt });
  assert.equal(first.skipped, false);
  assert.equal(first.status, "ok");

  const second = await scheduler.run("audit_export", { scheduledAt });
  assert.equal(second.skipped, true);

  const forced = await scheduler.run("audit_export", { scheduledAt, force: true });
  assert.equal(forced.skipped, false);
  assert.notEqual(forced.runId, first.runId);

  const runs = await pool.query("SELECT count(*)::int AS n FROM stat.task_run WHERE task_id = 'audit_export'");
  assert.equal(runs.rows[0].n, 2);
});

test("审计导出任务：有记录时产出 JSONL 文件并写 task_run 结果", async () => {
  await audit.record({ actor: "opc_hub", action: "dispatch", result: "ok" });
  const result = await scheduler.run("audit_export", { scheduledAt: new Date("2026-11-05T02:00:00.000Z") });
  const payload = result.result as { filePath?: string; rowCount?: number };
  assert.ok(payload.filePath?.endsWith(".jsonl"));
  assert.equal(payload.rowCount, 1);
  const files = await readdir(archiveDir, { recursive: true });
  assert.ok(files.some((name) => String(name).endsWith(".jsonl")));
});

test("晨报任务：聚合税务预警、合同到期与待裁决冲突，写入 daily_report 并通知", async () => {
  await pool.query(`INSERT INTO biz.tax_calendar (tax_type, period, deadline, status) VALUES ('vat', '2026-11', current_date + 3, 'pending')`);
  await pool.query(`INSERT INTO biz.contract (counterparty, amount, end_date, status) VALUES ('甲公司', 1000, current_date + 10, 'active')`);
  await pool.query(`INSERT INTO biz.ledger (entry_date, amount, direction, category, entity) VALUES (current_date, 100, 'out', 'x', 'company')`);
  await pool.query(`INSERT INTO biz.conflict_queue (conflict_type, frozen_unit_type, frozen_unit_id, parties, status) VALUES ('cost','ledger',1,'[{"p":"a"},{"p":"b"}]'::jsonb,'open')`);

  const result = await scheduler.run("daily_report", { scheduledAt: new Date("2026-11-05T00:30:00.000Z") });
  assert.equal(result.status, "ok");
  const rows = await pool.query<{ content: { taxAlerts: unknown[]; contractAlerts: unknown[]; conflicts: unknown[] } }>(
    "SELECT content FROM stat.daily_report ORDER BY id DESC LIMIT 1",
  );
  assert.equal(rows.rows[0].content.taxAlerts.length, 1);
  assert.equal(rows.rows[0].content.contractAlerts.length, 1);
  assert.equal(rows.rows[0].content.conflicts.length, 1);

  const notifications = await pool.query("SELECT kind, level FROM stat.notification");
  assert.ok(notifications.rows.some((row: { kind: string; level: string }) => row.kind === "daily_report"));
});

test("tick：到点任务触发一次并推进 next_run_at", async () => {
  await scheduler.upsert("tax_reminder", { cron: "0 9 * * *", timezone: "Asia/Shanghai", enabled: true, config: {} });
  const now = new Date("2026-11-05T01:00:00.000Z"); // 北京 09:00
  await pool.query("UPDATE stat.task_schedule SET next_run_at = $1 WHERE task_id = 'tax_reminder'", [now]);
  const ran = await scheduler.tick(new Date(now.getTime() + 1000));
  assert.ok(ran.some((item) => item.taskId === "tax_reminder"));
  const row = await pool.query<{ next_run_at: Date; last_run_at: Date }>(
    "SELECT next_run_at, last_run_at FROM stat.task_schedule WHERE task_id = 'tax_reminder'",
  );
  assert.ok(new Date(row.rows[0].next_run_at).getTime() > now.getTime());
  assert.ok(row.rows[0].last_run_at !== null);
});
