/**
 * 运行配置（唯一事实来源：环境变量 > 默认值）。
 *
 * 连接串只来自环境变量或仓库根 `.env`（.env 已在 .svnignore 内，仓库不保存口令）。
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "./env.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 缺少连接串时的统一提示：仓库内不保存口令，只给 .env.example。 */
function requireDsn(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`缺少 ${key}：请复制 .env.example 为 .env 并填入连接串，或由部署环境注入（仓库不保存口令）`);
  }
  return value;
}

export interface AppConfig {
  /** 业务库连接串 */
  dsn: string;
  /** 测试库连接串（集成测试专用，禁止指向业务库） */
  testDsn: string;
  /** 审计归档根目录 */
  archiveDir: string;
  /** 中枢默认时区（cron 解析用） */
  timezone: string;
  /** 审计 schema_version（归档可迁移性） */
  schemaVersion: string;
  /** 项目根目录 */
  root: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // 本地开发：允许用仓库根的 .env 提供连接串（不覆盖既有环境变量）
  loadDotEnv(join(ROOT, ".env"));
  const dsn = requireDsn(env, "OPC_PG_DSN");
  const testDsn = requireDsn(env, "OPC_TEST_DSN");
  if (env.NODE_ENV === "test" && dsn === testDsn) {
    throw new Error("测试环境必须使用独立测试库：OPC_PG_DSN 与 OPC_TEST_DSN 不能相同");
  }
  return {
    dsn,
    testDsn,
    archiveDir: env.OPC_ARCHIVE_DIR?.trim() || join(ROOT, "archive"),
    timezone: env.OPC_TIMEZONE?.trim() || "Asia/Shanghai",
    schemaVersion: env.OPC_SCHEMA_VERSION?.trim() || "1",
    root: ROOT,
  };
}
