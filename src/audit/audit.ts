/**
 * 审计统一写入口：追加式哈希链 + JSONL 导出 + 链头持久化。
 *
 * 约束（产品设计 8.4 / 架构 5.3/6）：
 * - 员工插件不得直写审计库，一律经本服务；
 * - 每条记录带 prev_hash，形成链；写链时用事务级 advisory lock 串行化，避免并发分叉；
 * - 导出文件 SHA-256 与 audit_export.prev_export_hash 构成归档链；链头在 audit_chain_head。
 * - 恢复时先校验链头与最后一条记录，不一致必须拒绝续链（verifyChain 返回 brokenAt）。
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "../db/pool.ts";
import { withTx } from "../db/pool.ts";
import { OpcError, ERR } from "../platform/errors.ts";

export interface AuditEntry {
  actor: string;
  action: string;
  result: "ok" | "denied" | "error";
  objectType?: string;
  objectId?: string;
  payload?: unknown;
  workflowInstanceId?: number | null;
  testMode?: boolean;
}

export interface AuditRow {
  id: number;
  created_at: Date;
  workflow_instance_id: number | null;
  actor: string;
  action: string;
  object_type: string | null;
  object_id: string | null;
  result: "ok" | "denied" | "error";
  payload: unknown;
  schema_version: string;
  test_mode: boolean;
  prev_hash: string | null;
  hash: string;
}

export interface AuditListQuery {
  instanceId?: number;
  action?: string;
  limit?: number;
}

export interface AuditExport {
  filePath: string;
  sha256: string;
  rowCount: number;
  prevHash: string | null;
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function hashOf(parts: { prevHash: string | null; actor: string; action: string; result: string; schemaVersion: string; createdAt: Date; payload: unknown; workflowInstanceId: number | null; testMode: boolean }): string {
  const material = [
    parts.prevHash ?? "",
    parts.actor,
    parts.action,
    parts.result,
    parts.schemaVersion,
    String(parts.workflowInstanceId ?? ""),
    parts.testMode ? "1" : "0",
    canonical(parts.payload ?? null),
    parts.createdAt.toISOString(),
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export class AuditService {
  private readonly pool: Pool;
  private readonly schemaVersion: string;
  private readonly clock: () => Date;

  constructor(pool: Pool, options: { schemaVersion: string; clock?: () => Date }) {
    this.pool = pool;
    this.schemaVersion = options.schemaVersion;
    this.clock = options.clock ?? (() => new Date());
  }

  async record(entry: AuditEntry): Promise<{ id: number; hash: string; prevHash: string | null }> {
    const createdAt = this.clock();
    if (Number.isNaN(createdAt.getTime())) throw new OpcError(ERR.AUDIT_FAILED, "审计时钟非法", 500);
    return withTx(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('opc.audit.chain'))");
      const last = await client.query<{ hash: string }>(
        "SELECT hash FROM audit.audit_log ORDER BY created_at DESC, id DESC LIMIT 1",
      );
      const prevHash = last.rows[0]?.hash ?? null;
      const hash = hashOf({
        prevHash,
        actor: entry.actor,
        action: entry.action,
        result: entry.result,
        schemaVersion: this.schemaVersion,
        createdAt,
        payload: entry.payload ?? null,
        workflowInstanceId: entry.workflowInstanceId ?? null,
        testMode: entry.testMode ?? false,
      });
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO audit.audit_log
           (created_at, workflow_instance_id, actor, action, object_type, object_id, result, payload, schema_version, test_mode, prev_hash, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12) RETURNING id`,
        [
          createdAt,
          entry.workflowInstanceId ?? null,
          entry.actor,
          entry.action,
          entry.objectType ?? null,
          entry.objectId ?? null,
          entry.result,
          JSON.stringify(entry.payload ?? null),
          this.schemaVersion,
          entry.testMode ?? false,
          prevHash,
          hash,
        ],
      );
      const updated = await client.query("UPDATE audit.audit_chain_head SET last_hash = $1, updated_at = now()", [hash]);
      if (updated.rowCount === 0) {
        await client.query("INSERT INTO audit.audit_chain_head (last_hash) VALUES ($1)", [hash]);
      }
      return { id: inserted.rows[0].id, hash, prevHash };
    });
  }

  async list(query: AuditListQuery = {}): Promise<{ rows: AuditRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.instanceId !== undefined) {
      params.push(query.instanceId);
      where.push(`workflow_instance_id = $${params.length}`);
    }
    if (query.action !== undefined) {
      params.push(query.action);
      where.push(`action = $${params.length}`);
    }
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    params.push(limit);
    const sql = `SELECT *, count(*) OVER() AS total FROM audit.audit_log
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;
    const result = await this.pool.query<AuditRow & { total: string }>(sql, params);
    const total = result.rows.length > 0 ? Number(result.rows[0].total) : 0;
    const rows = result.rows.map((row) => {
      const copy = { ...row } as AuditRow & { total?: string };
      delete copy.total;
      return copy;
    });
    return { rows, total };
  }

  /** 增量导出 JSONL；返回全文 SHA-256 与上一条导出哈希（归档链）。 */
  async export(options: { outDir: string; sinceId?: number } = { outDir: "" }): Promise<AuditExport> {
    const outDir = options.outDir;
    if (!outDir) throw new OpcError(ERR.AUDIT_FAILED, "导出目录不能为空", 400);
    const cursor = await this.pool.query<{ last_audit_id: string | null }>(
      "SELECT last_audit_id FROM audit.audit_export ORDER BY id DESC LIMIT 1",
    );
    const sinceId = options.sinceId ?? Number(cursor.rows[0]?.last_audit_id ?? 0);
    const rows = await this.pool.query<AuditRow>(
      `SELECT * FROM audit.audit_log WHERE id > $1 ORDER BY created_at ASC, id ASC`,
      [sinceId],
    );
    if (rows.rows.length === 0) {
      throw new OpcError(ERR.AUDIT_FAILED, "没有可导出的审计记录", 409);
    }
    const lines = rows.rows.map((row) =>
      JSON.stringify({
        id: row.id,
        created_at: new Date(row.created_at).toISOString(),
        workflow_instance_id: row.workflow_instance_id,
        actor: row.actor,
        action: row.action,
        object_type: row.object_type,
        object_id: row.object_id,
        result: row.result,
        payload: row.payload,
        schema_version: row.schema_version,
        test_mode: row.test_mode,
        hash: row.hash,
      }),
    );
    const content = `${lines.join("\n")}\n`;
    const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
    await mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "Z");
    const filePath = join(outDir, `audit-${stamp}.jsonl`);
    await writeFile(filePath, content, "utf8");

    return withTx(this.pool, async (client) => {
      const previous = await client.query<{ sha256: string }>(
        "SELECT sha256 FROM audit.audit_export ORDER BY id DESC LIMIT 1",
      );
      const prevHash = previous.rows[0]?.sha256 ?? null;
      const maxAuditId = rows.rows[rows.rows.length - 1].id;
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO audit.audit_export (file_path, sha256, prev_export_hash, row_count, last_audit_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [filePath, sha256, prevHash, rows.rows.length, maxAuditId],
      );
      const updated = await client.query("UPDATE audit.audit_chain_head SET last_export_id = $1, updated_at = now()", [
        inserted.rows[0].id,
      ]);
      if (updated.rowCount === 0) {
        await client.query("INSERT INTO audit.audit_chain_head (last_export_id) VALUES ($1)", [inserted.rows[0].id]);
      }
      return { filePath, sha256, rowCount: rows.rows.length, prevHash };
    });
  }

  /** 全链重算：逐条校验 prev_hash 链接与记录哈希，并核对链头。 */
  async verifyChain(): Promise<{ ok: boolean; checked: number; brokenAt?: number }> {
    const rows = await this.pool.query<AuditRow>("SELECT * FROM audit.audit_log ORDER BY created_at ASC, id ASC");
    let prevHash: string | null = null;
    let checked = 0;
    for (const row of rows.rows) {
      const expected = hashOf({
        prevHash,
        actor: row.actor,
        action: row.action,
        result: row.result,
        schemaVersion: row.schema_version,
        createdAt: new Date(row.created_at),
        payload: row.payload,
        workflowInstanceId: row.workflow_instance_id,
        testMode: row.test_mode,
      });
      if (row.prev_hash !== prevHash || row.hash !== expected) {
        return { ok: false, checked, brokenAt: row.id };
      }
      prevHash = row.hash;
      checked += 1;
    }
    const head = await this.pool.query<{ last_hash: string | null }>("SELECT last_hash FROM audit.audit_chain_head LIMIT 1");
    const headHash = head.rows[0]?.last_hash ?? null;
    if (rows.rows.length > 0 && headHash !== prevHash) {
      return { ok: false, checked, brokenAt: rows.rows[rows.rows.length - 1].id };
    }
    return { ok: true, checked };
  }
}
