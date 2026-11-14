/**
 * 微信推送集成测试（SRS-001 REQ-OPS-004）：
 * 裁决/简报入队 → 经 dsh-im 主动投递端点推送到微信；未绑定只排队、失败退避重试、同键去重。
 * 投递端点用本地 mock 服务，不依赖真实微信。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "../../src/db/pool.ts";
import { makePool, resetDb } from "../helpers.ts";
import { AuditService } from "../../src/audit/audit.ts";
import { ViewService } from "../../src/platform/views.ts";
import { TokenService } from "../../src/platform/token.ts";
import { ConflictService } from "../../src/platform/conflict.ts";
import { WorkflowRegistry } from "../../src/workflow/registry.ts";
import { WorkflowRunner } from "../../src/workflow/instances.ts";
import { Verifier } from "../../src/workflow/verifier.ts";
import { Scheduler } from "../../src/scheduler/engine.ts";
import { defaultTasks } from "../../src/scheduler/tasks/index.ts";
import { startApiServer, type ApiContext } from "../../src/api/http.ts";
import { DashboardService } from "../../src/web/dashboard.ts";
import { IngestService, MemoryService, RadarService, SessionGrantService } from "../../src/web/services.ts";
import { EmployeePackageService } from "../../src/employees/package.ts";
import { ProjectSoftwareService } from "../../src/domains/project/software.ts";
import { ProjectAutopilotService } from "../../src/domains/project/autopilot.ts";
import { IntelPipelineService } from "../../src/domains/intel/daily.ts";
import { AdminService } from "../../src/domains/admin/service.ts";
import { WechatPushService } from "../../src/notify/wechat.ts";

let pool: Pool;
let server: HttpServer;
let base = "";
let wechat: WechatPushService;
let delivery: HttpServer;
let requests: Array<{ path: string; body: any }> = [];
let deliveryStatus = 200;

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

function clearWechatEnv(): void {
  delete process.env.OPC_WECHAT_BOT_ID;
  delete process.env.OPC_WECHAT_TARGET_ID;
  delete process.env.OPC_WECHAT_ENABLED;
  delete process.env.OPC_WECHAT_DELIVERY_URL;
}

before(async () => {
  pool = makePool();
  wechat = new WechatPushService(pool, new AuditService(pool, { schemaVersion: "1" }));
  delivery = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let body: any = null;
      try { body = JSON.parse(raw); } catch { body = raw; }
      requests.push({ path: req.url ?? "", body });
      res.writeHead(deliveryStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(deliveryStatus === 200 ? { delivered: true } : { error: { code: "delivery-failed" } }));
    });
  });
  await new Promise<void>((resolve) => delivery.listen(0, "127.0.0.1", () => resolve()));
  process.env.OPC_WECHAT_DELIVERY_URL = `http://127.0.0.1:${(delivery.address() as AddressInfo).port}/api/dsh-im/delivery/messages`;

  const audit = new AuditService(pool, { schemaVersion: "1" });
  const archiveDir = await mkdtemp(join(tmpdir(), "opc-wechat-"));
  const scheduler = new Scheduler(pool, audit, { archiveDir });
  for (const task of defaultTasks()) scheduler.register(task);
  const software = new ProjectSoftwareService(pool, audit);
  const autopilot = new ProjectAutopilotService(pool, audit, wechat);
  const admin = new AdminService(pool, audit, software, new IntelPipelineService(pool), autopilot, wechat);
  const ctx: ApiContext = {
    pool,
    audit,
    views: new ViewService(pool, audit),
    tokens: new TokenService(pool, audit),
    conflicts: new ConflictService(pool, audit),
    registry: new WorkflowRegistry(pool, audit),
    runner: new WorkflowRunner(pool, audit),
    verifier: new Verifier(pool, audit),
    scheduler,
    web: {
      ingest: new IngestService(pool, audit),
      session: new SessionGrantService(pool, audit),
      memory: new MemoryService(pool, audit),
      radar: new RadarService(pool),
      dashboard: new DashboardService(pool),
    },
    employees: new EmployeePackageService(pool, audit, { hubVersion: "0.2.1" }),
    software,
    admin,
    archiveDir,
    version: "0.1.0",
  };
  server = await startApiServer(ctx, 0, "127.0.0.1");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await resetDb(pool);
  requests = [];
  deliveryStatus = 200;
  clearWechatEnv();
  process.env.OPC_WECHAT_DELIVERY_URL = `http://127.0.0.1:${(delivery.address() as AddressInfo).port}/api/dsh-im/delivery/messages`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => delivery.close(() => resolve()));
  await pool.end();
});

test("TC-WECHAT-001 未绑定微信时只排队、不丢消息、不报错", async () => {
  await wechat.enqueueDecision(1, { id: 1, topic: "license", question: "按商用还是开源？", risk_level: "high", options: [{ label: "商用", impact: "需法务口径" }] });
  const result = await wechat.deliverPending(10);
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
  assert.equal(requests.length, 0);
  const rows = await wechat.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  assert.match(String(rows[0].last_error), /OPC_WECHAT_BOT_ID|OPC_WECHAT_TARGET_ID/);
});

test("TC-WECHAT-002 配置后裁决与简报都能推到微信", async () => {
  process.env.OPC_WECHAT_BOT_ID = "bot-test";
  process.env.OPC_WECHAT_TARGET_ID = "target-test";
  await wechat.enqueueDecision(1, { id: 2, topic: "test_baseline", question: "先补测试基线？", risk_level: "medium", options: [] });
  await wechat.enqueueBrief("每日晨报", "今日待办 3 条", "brief:test:1");
  const result = await wechat.deliverPending(10);
  assert.equal(result.sent, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.botId, "bot-test");
  assert.equal(requests[0].body.targetId, "target-test");
  assert.match(String(requests[0].body.text), /待裁决/);
  assert.match(String(requests[1].body.text), /简报/);
  const rows = await wechat.list();
  assert.equal(rows.every((row: any) => row.status === "sent"), true);
});

test("TC-WECHAT-003 投递失败退避重试，不丢、不刷屏", async () => {
  process.env.OPC_WECHAT_BOT_ID = "bot-test";
  process.env.OPC_WECHAT_TARGET_ID = "target-test";
  deliveryStatus = 503;
  await wechat.enqueue({ kind: "text", title: "通知", body: "hello", dedupeKey: "text:1" });
  const first = await wechat.deliverPending(10);
  assert.equal(first.failed, 1);
  const immediate = (await wechat.deliverPending(10)) as { sent: number; failed: number };
  assert.equal(immediate.sent + immediate.failed, 0); // 退避未到期
  const rows = (await wechat.list()) as Array<{ attempts: number; status: string; next_attempt_at: string }>;
  assert.equal(rows[0].attempts, 1);
  assert.equal(rows[0].status, "pending");
  assert.equal(new Date(rows[0].next_attempt_at).getTime() > Date.now(), true);
});

test("TC-WECHAT-004 同文去重：同 dedupeKey 只入队一次", async () => {
  await wechat.enqueue({ kind: "decision", title: "【待裁决】x", body: "q", dedupeKey: "decision:1:license:9" });
  await wechat.enqueue({ kind: "decision", title: "【待裁决】x", body: "q", dedupeKey: "decision:1:license:9" });
  const rows = await wechat.list();
  assert.equal(rows.length, 1);
});

test("TC-WECHAT-005 裁决创建自动入队 + 状态接口可查", async () => {
  const project = await pool.query("INSERT INTO biz.project (name, project_type, stage) VALUES ('微信项目', 'software', 'planning') RETURNING id");
  const projectId = Number((project.rows[0] as { id: string }).id);
  const autopilot = new ProjectAutopilotService(pool, new AuditService(pool, { schemaVersion: "1" }), wechat);
  await autopilot.recordDecision(projectId, { topic: "repository", question: "请提供版本库地址", riskLevel: "high", options: [{ label: "补仓库", impact: "进自动驾驶" }] });
  const outbox = await wechat.list();
  assert.equal(outbox.some((row: any) => row.kind === "decision" && String(row.title).includes("repository")), true);

  const status = await call("GET", "/api/v1/admin/wechat/status");
  assert.equal(status.status, 200);
  assert.equal(status.json.data.botIdConfigured, false);
  assert.equal(status.json.data.pending >= 1, true);

  const listed = await call("GET", "/api/v1/admin/wechat/outbox");
  assert.equal(listed.status, 200);
  assert.equal(listed.json.data.items.length >= 1, true);
});
