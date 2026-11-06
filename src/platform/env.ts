/**
 * 极简 .env 加载器（零依赖）：只在进程内补齐未设置的变量，不覆盖已有环境。
 *
 * 目的：仓库里不出现任何数据库口令。真实连接串放本地 `.env`（已在 .gitignore），
 * 交付物只带 `.env.example` 占位。DSH 部署时由 profile 配置或系统环境注入。
 */
import { existsSync, readFileSync } from "node:fs";

export function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
