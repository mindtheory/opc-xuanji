#!/usr/bin/env node
/**
 * 迁移 CLI：
 *   node scripts/migrate.ts                 # 业务库（OPC_PG_DSN）
 *   node scripts/migrate.ts --test          # 测试库（OPC_TEST_DSN）
 *   node scripts/migrate.ts --dsn <dsn>     # 显式指定
 */
import { join } from "node:path";
import { loadConfig } from "../src/platform/config.ts";
import { createPool } from "../src/db/pool.ts";
import { migrate } from "../src/db/migrate.ts";

const args = process.argv.slice(2);
const config = loadConfig();
const test = args.includes("--test");
const dsnIndex = args.indexOf("--dsn");
const dsn = dsnIndex >= 0 ? args[dsnIndex + 1] : test ? config.testDsn : config.dsn;

const pool = createPool(dsn, { max: 2 });
try {
  const result = await migrate(pool, join(config.root, "migrations"), (line) => console.log(line));
  console.log(`迁移完成：应用 ${result.applied.length} 个，跳过 ${result.skipped.length} 个`);
  if (result.skipped.length > 0) console.log(`已应用：${result.skipped.join(", ")}`);
} catch (error) {
  console.error("迁移失败：", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
