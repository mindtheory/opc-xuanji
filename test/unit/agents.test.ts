/**
 * Super Agent 桥单元测试（OPC-SDD-003 §4）：用本地桩 HTTP 服务器验证请求形状、
 * 幂等 upsert、错误映射与降级；不依赖真实 dsh-super-agents 与数据库。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SuperAgentsBridge } from "../../src/agents/bridge.ts";
import { renderAgentRole } from "../../src/agents/service.ts";
import { manifestByPlugin } from "../../src/employees/catalog.ts";
import { OpcError } from "../../src/platform/errors.ts";

interface StubCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let server: Server;
let base = "";
let calls: StubCall[] = [];
let failMode = false;

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      calls.push({ method: req.method ?? "", path: req.url ?? "", body });
      if (failMode) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "stub down" }));
        return;
      }
      const url = req.url ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      if (url.startsWith("/api/dsh-super-agents/state")) {
        res.end(JSON.stringify({ ok: true, agents: [{ id: "a-1", name: "财税管家" }] }));
      } else if (url.startsWith("/api/dsh-super-agents/agent-save")) {
        res.end(JSON.stringify({ ok: true, agent: { id: "a-1", name: String(body?.name) } }));
      } else if (url.startsWith("/api/dsh-super-agents/run-detail")) {
        res.end(JSON.stringify({ run: { id: "r-42", agentId: "a-1", kind: "manual", status: "done", createdAt: "" }, artifact: "结论：本月缺票 3 张。\n正文", logTail: "" }));
      } else if (url.startsWith("/api/dsh-super-agents/run")) {
        res.end(JSON.stringify({ ok: true, runId: "r-42" }));
      } else if (url.startsWith("/api/dsh-super-agents/health")) {
        res.end(JSON.stringify({ ok: true, paused: false, problems: [], health: [], queue: 0, active: 1 }));
      } else if (url.startsWith("/api/dsh-super-agents/pause")) {
        res.end(JSON.stringify({ ok: true, paused: body?.paused === true }));
      } else {
        res.writeHead(404);
        res.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function bridge(): SuperAgentsBridge {
  calls = [];
  failMode = false;
  return new SuperAgentsBridge({ baseUrl: base });
}

test("health：返回健康板字段", async () => {
  const health = await bridge().health();
  assert.equal(health.ok, true);
  assert.equal(health.active, 1);
});

test("upsertAgent：已存在同名时带 id 走 update（幂等）", async () => {
  const agent = await bridge().upsertAgent({ name: "财税管家", systemRole: "x" });
  assert.equal(agent.name, "财税管家");
  const save = calls.find((c) => c.path.startsWith("/api/dsh-super-agents/agent-save"));
  assert.equal(save?.method, "POST");
  assert.equal(save?.body?.id, "a-1", "同名存在时必须带 id 更新而非新建");
});

test("dispatch 与 runDetail：请求形状与产物解析", async () => {
  const b = bridge();
  const { runId } = await b.dispatch("a-1", "干活");
  assert.equal(runId, "r-42");
  assert.equal(calls.find((c) => c.path.startsWith("/api/dsh-super-agents/run"))?.body?.prompt, "干活");
  const detail = await b.runDetail("r-42");
  assert.equal(detail.run.status, "done");
  assert.equal(detail.artifact.split("\n")[0], "结论：本月缺票 3 张。");
});

test("setPaused：POST /pause 透传", async () => {
  await bridge().setPaused(true);
  assert.equal(calls.find((c) => c.path.startsWith("/api/dsh-super-agents/pause"))?.body?.paused, true);
});

test("不可达：抛 ERR-AGENT-001；healthSafe 不抛错只报 reachable:false", async () => {
  const b = new SuperAgentsBridge({ baseUrl: "http://127.0.0.1:1", timeoutMs: 500 }); // 端口不通
  await assert.rejects(() => b.health(), (error: unknown) => error instanceof OpcError && error.errorCode === "ERR-AGENT-001");
  const safe = await b.healthSafe(500);
  assert.equal(safe.reachable, false);
});

test("非 2xx：映射为 ERR-AGENT-001", async () => {
  const b = bridge();
  failMode = true;
  await assert.rejects(() => b.listAgents(), (error: unknown) => error instanceof OpcError && error.errorCode === "ERR-AGENT-001");
});

test("renderAgentRole：包含身份、一句话结论口径与不写库边界", () => {
  const manifest = manifestByPlugin("opc_finance");
  assert.ok(manifest !== undefined);
  const role = renderAgentRole(manifest);
  assert.ok(role.includes("财税管家"));
  assert.ok(role.includes("一句话结论"));
  assert.ok(role.includes("不写任何数据库"));
});
