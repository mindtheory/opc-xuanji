#!/usr/bin/env node
/**
 * 独立服务进程：HTTP /api/v1（完整动态路由）+ 调度 tick。
 * 用于 headless 常驻部署；DSH 插件内只挂静态路由与工具。
 *
 * 用法：node scripts/serve.ts [--port 3082] [--host 127.0.0.1] [--tick 60000]
 */
import { createHub } from "../src/plugin/index.ts";
import { startApiServer } from "../src/api/http.ts";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const port = Number(arg("port", "3082"));
const host = arg("host", "127.0.0.1");
const tickMs = Number(arg("tick", "60000"));

const hub = createHub();
const server = await startApiServer(hub.api, port, host);
console.log(`[opc] API 已启动：http://${host}:${server.address() && (server.address() as { port: number }).port}/api/v1/health`);

await hub.scheduler.seedDefaults();
const timer = setInterval(() => {
  hub.scheduler.tick().catch((error) => console.error("[opc] tick 失败:", error instanceof Error ? error.message : error));
}, tickMs);

async function shutdown(): Promise<void> {
  clearInterval(timer);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await hub.pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
