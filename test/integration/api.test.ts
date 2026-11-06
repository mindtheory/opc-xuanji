/**
 * HTTP /api/v1 契约集成测试：真实 PG + 真实 HTTP 服务（端口 0 随机）。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Pool } from "../../src/db/pool.ts";
import { makePool, resetDb, seedEmployee } from "../helpers.ts";
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

let pool: Pool;
let server: Server;
let base = "";
let ctx: ApiContext;
let archiveDir: string;

const CODE = "export const meta = {};\n";
const CODE_HASH = createHash("sha256").update(CODE, "utf8").digest("hex");

function meta() {
  return {
    id: "tax_monthly_prepare",
    version: "1.0.0",
    name: "月度税务申报准备",
    owner_plugin: "opc_finance",
    scope: "single",
    required_views: ["view_ar_ap"],
    key_nodes: ["collect_invoices", "reconcile", "tax_calc", "review_gate"],
    human_gates: ["review_gate"],
    deadline_impact: true,
    idempotent_nodes: ["write_ledger"],
    write_nodes: ["write_ledger"],
    tools: ["opc_ledger_write"],
    verifier_policy: { reconcile: { sampling: 3 } },
  };
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

before(async () => {
  pool = makePool();
  const audit = new AuditService(pool, { schemaVersion: "1" });
  archiveDir = await mkdtemp(join(tmpdir(), "opc-api-"));
  const scheduler = new Scheduler(pool, audit, { archiveDir });
  for (const task of defaultTasks()) scheduler.register(task);
  ctx = {
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
    employees: new EmployeePackageService(pool, audit, { hubVersion: "0.1.0" }),
    archiveDir,
    version: "0.1.0",
  };
  server = await startApiServer(ctx, 0);
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

beforeEach(async () => {
  await resetDb(pool);
  await ctx.scheduler.seedDefaults();
  await seedEmployee(pool, "opc_finance", { views: ["view_ar_ap"], tools: ["opc_ledger_write"], writeTargets: ["ledger"] });
});

test("health：返回 PG 与 pgvector 状态", async () => {
  const { status, json } = await call("GET", "/api/v1/health");
  assert.equal(status, 200);
  assert.equal(json.code, 0);
  assert.equal(json.data.pg, true);
  assert.equal(json.data.pgvector, true);
  assert.equal(json.data.scheduler.registered, 10);
});

test("views：授权查询 200，未授权 403 且带错误码", async () => {
  await pool.query("INSERT INTO biz.ar_ap (counterparty, amount, status) VALUES ('甲公司', 100.00, 'open')");
  const ok = await call("POST", "/api/v1/views/view_ar_ap/query", { pluginId: "opc_finance", filter: { status: "open" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.rowCount, 1);

  const denied = await call("POST", "/api/v1/views/view_contract_index/query", { pluginId: "opc_finance" });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.errorCode, "ERR-AUTHZ-001");
});

test("tokens：签发 201 → 消费 200 → 重复消费 409", async () => {
  const customer = await pool.query<{ id: string }>("INSERT INTO biz.customer (name) VALUES ('丙公司') RETURNING id");
  await pool.query("INSERT INTO biz.customer_sensitive (customer_id, field, value) VALUES ($1, 'family', '两孩')", [customer.rows[0].id]);
  const issued = await call("POST", "/api/v1/tokens", {
    taskId: "t1",
    pluginId: "opc_admin",
    viewId: "view_customer_base",
    fieldScope: ["family"],
    customerId: Number(customer.rows[0].id),
  });
  assert.equal(issued.status, 201);
  const consumed = await call("POST", `/api/v1/tokens/${issued.json.data.tokenId}/consume`, { taskId: "t1" });
  assert.equal(consumed.status, 200);
  assert.equal(consumed.json.data.fields.family, "两孩");
  const again = await call("POST", `/api/v1/tokens/${issued.json.data.tokenId}/consume`, { taskId: "t1" });
  assert.equal(again.status, 409);
  assert.equal(again.json.errorCode, "ERR-TOKEN-001");
});

test("conflicts：冻结 201 → 裁决 200", async () => {
  const ledger = await pool.query<{ id: string }>(
    "INSERT INTO biz.ledger (entry_date, amount, direction, category, entity) VALUES (current_date, 300, 'out', 'x', 'company') RETURNING id",
  );
  const opened = await call("POST", "/api/v1/conflicts", {
    conflictType: "cost",
    frozenUnitType: "ledger",
    frozenUnitId: Number(ledger.rows[0].id),
    parties: [{ plugin: "a" }, { plugin: "b" }],
  });
  assert.equal(opened.status, 201);
  assert.equal(opened.json.data.frozen, true);
  const resolved = await call("POST", `/api/v1/conflicts/${opened.json.data.conflictId}/resolve`, { choice: "A" });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.json.data.status, "resolved");
});

test("workflows：注册 201 / 守卫失败 422 / 实例与幂等节点 / Verifier", async () => {
  const registered = await call("POST", "/api/v1/workflows", {
    workflowId: "tax_monthly_prepare",
    version: "1.0.0",
    ownerPlugin: "opc_finance",
    meta: meta(),
    code: CODE,
    testedCodeHash: CODE_HASH,
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.json.data.riskLevel, "high");

  const guardFail = await call("POST", "/api/v1/workflows", {
    workflowId: "tax_monthly_prepare",
    version: "1.0.1",
    ownerPlugin: "opc_finance",
    meta: { ...meta(), risk_level: "low" },
    code: CODE,
    testedCodeHash: CODE_HASH,
  });
  assert.equal(guardFail.status, 422);
  assert.equal(guardFail.json.errorCode, "ERR-WF-001");

  const instance = await call("POST", "/api/v1/workflows/tax_monthly_prepare/instances", { version: "1.0.0", context: { period: "2026-10" } });
  assert.equal(instance.status, 201);
  const instanceId = instance.json.data.instanceId;

  const first = await call("POST", `/api/v1/instances/${instanceId}/nodes/write_ledger/complete`, { payload: { amount: 100 } });
  assert.equal(first.status, 200);
  assert.equal(first.json.data.idempotentHit, false);
  const second = await call("POST", `/api/v1/instances/${instanceId}/nodes/write_ledger/complete`, { payload: { amount: 100 } });
  assert.equal(second.json.data.idempotentHit, true);

  const verdict = await call("POST", `/api/v1/instances/${instanceId}/nodes/reconcile/verdict`, {
    samples: ["pass", "pass", "pass"],
    evidence: { invoice_total: 100, ledger_total: 100 },
    highImpact: true,
  });
  assert.equal(verdict.status, 200);
  assert.equal(verdict.json.data.finalVerdict, "pass");
});

test("audits：查询 200 与导出 201", async () => {
  await ctx.audit.record({ actor: "opc_hub", action: "dispatch", result: "ok" });
  const listed = await call("GET", "/api/v1/audits?limit=5");
  assert.equal(listed.status, 200);
  assert.equal(listed.json.data.total, 1);

  const exported = await call("POST", "/api/v1/audits/export", { outDir: join(archiveDir, "manual") });
  assert.equal(exported.status, 201);
  assert.equal(exported.json.data.rowCount, 1);
});

test("tasks：列表 7 项 / 配置 200 / 立即执行 200 / 晨报可查", async () => {
  const tasks = await call("GET", "/api/v1/tasks");
  assert.equal(tasks.status, 200);
  assert.equal(tasks.json.data.tasks.length, 10);

  const saved = await call("PUT", "/api/v1/tasks/daily_report", { cron: "45 8 * * 1-5", timezone: "Asia/Shanghai", enabled: true, config: {} });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.data.cron, "45 8 * * 1-5");

  const ran = await call("POST", "/api/v1/tasks/daily_report/run", {});
  assert.equal(ran.status, 200);
  assert.equal(ran.json.data.status, "ok");

  const report = await call("GET", "/api/v1/reports/daily");
  assert.equal(report.status, 200);
  assert.ok(report.json.data.content.taxAlerts !== undefined);
});

test("未知路由 404", async () => {
  const { status, json } = await call("GET", "/api/v1/nope");
  assert.equal(status, 404);
  assert.equal(json.code, 404);
});
