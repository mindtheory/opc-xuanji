/**
 * 定时自动化任务引擎：配置驱动（cron + 时区 + 参数）、幂等执行、失败告警与审计。
 *
 * 任务定义注册在 Scheduler.tasks，调度配置存 stat.task_schedule（老板可增删改）；
 * 每次执行以 (task_id, scheduled_at) 为幂等键写 stat.task_run，重复触发直接跳过；
 * force=true 时以毫秒级新计划时间重跑（保留历史，不覆盖）。
 */
import type { Pool } from "../db/pool.ts";
import { OpcError, ERR } from "../platform/errors.ts";
import type { AuditService } from "../audit/audit.ts";
import { nextRun, parseCron } from "./cron.ts";

export interface TaskContext {
  pool: Pool;
  audit: AuditService;
  now: Date;
  archiveDir: string;
  config: Record<string, unknown>;
  notify(kind: string, level: "instant" | "digest" | "info", payload: Record<string, unknown>): Promise<void>;
}

export interface TaskDefinition {
  id: string;
  name: string;
  defaults: { cron: string; timezone?: string; enabled?: boolean };
  handler(context: TaskContext): Promise<Record<string, unknown>>;
}

export interface TaskRow {
  taskId: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  config: Record<string, unknown>;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastRunStatus: string | null;
}

export interface RunResult {
  runId: number;
  taskId: string;
  status: string;
  skipped: boolean;
  result: Record<string, unknown> | null;
}

export interface SchedulerOptions {
  archiveDir: string;
  timezone?: string;
  clock?: () => Date;
}

export class Scheduler {
  private readonly pool: Pool;
  private readonly audit: AuditService;
  private readonly options: SchedulerOptions;
  private readonly tasks = new Map<string, TaskDefinition>();

  constructor(pool: Pool, audit: AuditService, options: SchedulerOptions) {
    this.pool = pool;
    this.audit = audit;
    this.options = options;
  }

  register(definition: TaskDefinition): void {
    if (this.tasks.has(definition.id)) throw new OpcError(ERR.TASK_INVALID, `任务重复注册：${definition.id}`, 400);
    this.tasks.set(definition.id, definition);
  }

  registeredIds(): string[] {
    return [...this.tasks.keys()].sort();
  }

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }

  private timezoneOf(value?: string): string {
    return value?.trim() || this.options.timezone || "Asia/Shanghai";
  }

  /** 把已注册任务的默认配置落库（不覆盖老板已改过的配置）。 */
  async seedDefaults(): Promise<number> {
    let created = 0;
    for (const task of this.tasks.values()) {
      const timezone = this.timezoneOf(task.defaults.timezone);
      const next = nextRun(task.defaults.cron, timezone, this.now());
      const inserted = await this.pool.query(
        `INSERT INTO stat.task_schedule (task_id, cron, timezone, enabled, config, next_run_at)
         VALUES ($1,$2,$3,$4,'{}'::jsonb,$5) ON CONFLICT (task_id) DO NOTHING`,
        [task.id, task.defaults.cron, timezone, task.defaults.enabled ?? true, next],
      );
      created += inserted.rowCount ?? 0;
    }
    return created;
  }

  async list(): Promise<TaskRow[]> {
    const result = await this.pool.query<{
      task_id: string;
      cron: string;
      timezone: string;
      enabled: boolean;
      config: Record<string, unknown>;
      last_run_at: Date | null;
      next_run_at: Date | null;
      last_status: string | null;
    }>(
      `SELECT s.task_id, s.cron, s.timezone, s.enabled, s.config, s.last_run_at, s.next_run_at,
              (SELECT r.status FROM stat.task_run r WHERE r.task_id = s.task_id ORDER BY r.id DESC LIMIT 1) AS last_status
       FROM stat.task_schedule s ORDER BY s.task_id`,
    );
    return result.rows.map((row) => ({
      taskId: row.task_id,
      name: this.tasks.get(row.task_id)?.name ?? row.task_id,
      cron: row.cron,
      timezone: row.timezone,
      enabled: row.enabled,
      config: row.config ?? {},
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      lastRunStatus: row.last_status,
    }));
  }

  async upsert(taskId: string, input: { cron: string; timezone?: string; enabled?: boolean; config?: Record<string, unknown> }): Promise<TaskRow> {
    const task = this.tasks.get(taskId);
    if (task === undefined) throw new OpcError(ERR.TASK_INVALID, `未注册的任务类型：${taskId}`, 400);
    parseCron(input.cron);
    const timezone = this.timezoneOf(input.timezone);
    const next = nextRun(input.cron, timezone, this.now());
    await this.pool.query(
      `INSERT INTO stat.task_schedule (task_id, cron, timezone, enabled, config, next_run_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT (task_id) DO UPDATE SET cron = EXCLUDED.cron, timezone = EXCLUDED.timezone,
         enabled = EXCLUDED.enabled, config = EXCLUDED.config, next_run_at = EXCLUDED.next_run_at`,
      [taskId, input.cron, timezone, input.enabled ?? true, JSON.stringify(input.config ?? {}), next],
    );
    const rows = await this.list();
    const row = rows.find((item) => item.taskId === taskId);
    if (row === undefined) throw new OpcError(ERR.TASK_INVALID, `任务保存后读取失败：${taskId}`, 500);
    return row;
  }

  private async notify(kind: string, level: "instant" | "digest" | "info", payload: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      "INSERT INTO stat.notification (kind, level, payload, status) VALUES ($1,$2,$3::jsonb,'pending')",
      [kind, level, JSON.stringify(payload)],
    );
  }

  async run(taskId: string, options: { scheduledAt?: Date; force?: boolean } = {}): Promise<RunResult> {
    const task = this.tasks.get(taskId);
    if (task === undefined) throw new OpcError(ERR.TASK_NOT_FOUND, `未注册的任务类型：${taskId}`, 404);
    const now = this.now();
    let scheduledAt = options.scheduledAt ?? new Date(Math.floor(now.getTime() / 60_000) * 60_000);

    let inserted = await this.tryInsertRun(taskId, scheduledAt, now);
    if (inserted === null && options.force === true) {
      // 强制重跑：计划时间后移 1ms 生成新的幂等键，历史记录保留
      for (let attempt = 1; attempt <= 3 && inserted === null; attempt += 1) {
        scheduledAt = new Date(scheduledAt.getTime() + 1);
        inserted = await this.tryInsertRun(taskId, scheduledAt, now);
      }
    }
    if (inserted === null) {
      const existing = await this.pool.query<{ id: number; status: string; result: Record<string, unknown> | null }>(
        "SELECT id, status, result FROM stat.task_run WHERE task_id = $1 AND scheduled_at = $2",
        [taskId, scheduledAt],
      );
      const row = existing.rows[0];
      if (row === undefined) throw new OpcError(ERR.TASK_INVALID, `任务运行记录缺失：${taskId}`, 500);
      return { runId: row.id, taskId, status: row.status, skipped: true, result: row.result };
    }

    const schedule = await this.pool.query<{ config: Record<string, unknown> }>(
      "SELECT config FROM stat.task_schedule WHERE task_id = $1",
      [taskId],
    );
    const config = schedule.rows[0]?.config ?? {};
    try {
      const result = await task.handler({
        pool: this.pool,
        audit: this.audit,
        now: scheduledAt,
        archiveDir: this.options.archiveDir,
        config,
        notify: (kind, level, payload) => this.notify(kind, level, payload),
      });
      await this.pool.query("UPDATE stat.task_run SET status = 'ok', result = $1::jsonb, ended_at = now() WHERE id = $2", [
        JSON.stringify(result),
        inserted.id,
      ]);
      await this.audit.record({
        actor: "opc_scheduler",
        action: "task.run",
        result: "ok",
        objectType: "task",
        objectId: taskId,
        payload: { runId: inserted.id, scheduledAt: scheduledAt.toISOString(), result },
      });
      return { runId: inserted.id, taskId, status: "ok", skipped: false, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.pool.query("UPDATE stat.task_run SET status = 'failed', error = $1, ended_at = now() WHERE id = $2", [
        message,
        inserted.id,
      ]);
      await this.audit.record({
        actor: "opc_scheduler",
        action: "task.run",
        result: "error",
        objectType: "task",
        objectId: taskId,
        payload: { runId: inserted.id, scheduledAt: scheduledAt.toISOString(), error: message },
      });
      await this.notify("task_failed", "instant", { taskId, runId: inserted.id, error: message });
      throw error;
    }
  }

  private async tryInsertRun(taskId: string, scheduledAt: Date, now: Date): Promise<{ id: number } | null> {
    const inserted = await this.pool.query<{ id: number }>(
      `INSERT INTO stat.task_run (task_id, scheduled_at, started_at, status, attempt)
       VALUES ($1,$2,$3,'running',1) ON CONFLICT (task_id, scheduled_at) DO NOTHING RETURNING id`,
      [taskId, scheduledAt, now],
    );
    return inserted.rows[0] ?? null;
  }

  /** 到点任务：next_run_at <= now 的任务各执行一次，并推进到下一次触发。 */
  async tick(now: Date = this.now()): Promise<RunResult[]> {
    const due = await this.pool.query<{ task_id: string; cron: string; timezone: string; next_run_at: Date }>(
      "SELECT task_id, cron, timezone, next_run_at FROM stat.task_schedule WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= $1 ORDER BY next_run_at",
      [now],
    );
    const results: RunResult[] = [];
    for (const row of due.rows) {
      if (!this.tasks.has(row.task_id)) continue;
      results.push(await this.run(row.task_id, { scheduledAt: new Date(row.next_run_at) }));
      await this.pool.query("UPDATE stat.task_schedule SET last_run_at = $1, next_run_at = $2 WHERE task_id = $3", [
        now,
        nextRun(row.cron, row.timezone, now),
        row.task_id,
      ]);
    }
    return results;
  }
}
