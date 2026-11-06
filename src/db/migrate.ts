/**
 * 迁移执行器：按文件名顺序应用 migrations/*.sql，单文件单事务，已应用版本记录在
 * public._opc_migrations。迁移文件不可修改（checksum 校验），只能追加新文件——
 * 这是审计归档 schema_version 可迁移性的基础。
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "./pool.ts";

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

const LEDGER = `
CREATE TABLE IF NOT EXISTS public._opc_migrations (
  version    text PRIMARY KEY,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

function checksumOf(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export async function migrate(pool: Pool, dir: string, log: (line: string) => void = () => {}): Promise<MigrationResult> {
  await pool.query(LEDGER);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const existing = new Map<string, string>();
  const rows = await pool.query<{ version: string; checksum: string }>(
    "SELECT version, checksum FROM public._opc_migrations",
  );
  for (const row of rows.rows) existing.set(row.version, row.checksum);

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const sql = await readFile(join(dir, file), "utf8");
    const checksum = checksumOf(sql);
    const known = existing.get(file);
    if (known !== undefined) {
      if (known !== checksum) {
        throw new Error(`迁移文件被修改：${file}（已应用 checksum=${known.slice(0, 12)}，当前=${checksum.slice(0, 12)}）`);
      }
      skipped.push(file);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO public._opc_migrations (version, checksum) VALUES ($1, $2)", [file, checksum]);
      await client.query("COMMIT");
      applied.push(file);
      log(`applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return { applied, skipped };
}
