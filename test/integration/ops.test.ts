/**
 * 运维闭环集成测试（SRS-001 REQ-OPS-001..003）：
 * 用量遥测 → 规则审视 → Issue 草稿 → GitHub 自动投递；运行错误去重登记。
 * GitHub 用本地 mock 服务替代，不依赖外网与真实凭据。
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
import { IntelPipelineService } from "../../src/domains/intel/daily.ts";
import { AdminService } from "../../src/domains/admin/service.ts";
import { IssueReporter, UsageService } from "../../src/ops/feedback.ts";

let pool: Pool;
let server: HttpServer;
let base = "";
let usage: UsageService;
let issues: IssueReporter;
let github: HttpServer;
let githubRequests: Array<{ path: string; body: any }> = [];

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
  usage = new UsageService(pool);
  issues = new IssueReporter(pool, new AuditService(pool, { schemaVersion: "1" }));

  github = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let body: any = null;
      try { body = JSON.parse(raw); } catch { body = raw; }
      githubRequests.push({ path: req.url ?? "", body });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ number: githubRequests.length, html_url: `http://mock/issues/${githubRequests.length}` }));
    });
  });
  await new Promise<void>((resolve) => github.listen(0, "127.0.0.1", () => resolve()));
  const githubBase = `http://127.0.0.1:${(github.address() as AddressInfo).port}`;
  process.env.OPC_GITHUB_API_BASE = githubBase;
  process.env.OPC_GITHUB_REPO = "owner/repo";
  process.env.OPC_GITHUB_TOKEN = "test-token";
  process.env.OPC_AI_DISABLED = "1";

  const audit = new AuditService(pool, { schemaVersion: "1" });
  const archiveDir = await mkdtemp(join(tmpdir(), "opc-ops-"));
  const scheduler = new Scheduler(pool, audit, { archiveDir });
  for (const task of defaultTasks()) scheduler.register(task);
  const software = new ProjectSoftwareService(pool, audit);
  const admin = new AdminService(pool, audit, software, new IntelPipelineService(pool));
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
    usage,
    issues,
    archiveDir,
    version: "0.1.0",
  };
  server = await startApiServer(ctx, 0, "127.0.0.1");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await resetDb(pool);
  githubRequests = [];
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => github.close(() => resolve()));
  await pool.end();
});

test("TC-OPS-001 接口调用自动记录用量并可聚合", async () => {
  await call("GET", "/api/v1/health");
  await call("GET", "/api/v1/tasks");
  const summary = await call("GET", "/api/v1/admin/usage/summary?days=7");
  assert.equal(summary.status, 200);
  assert.equal(summary.json.data.total >= 2, true);
  const actions = summary.json.data.byAction.map((item: any) => item.action);
  assert.equal(actions.some((action: string) => action.includes("/api/v1/health")), true);
  assert.equal(summary.json.data.errorRate >= 0, true);
});

test("TC-OPS-002 运行错误去重登记并自动开 GitHub Issue", async () => {
  await issues.recordRuntimeError({ method: "GET", route: "/api/v1/views/view_ar_ap/query", statusCode: 500, errorCode: "ERR-SYS-001", message: "connection reset" });
  await issues.recordRuntimeError({ method: "GET", route: "/api/v1/views/view_ar_ap/query", statusCode: 500, errorCode: "ERR-SYS-001", message: "connection reset" });
  const errors = await issues.listRuntimeErrors();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].occurrences, 2);

  const sync = await call("POST", "/api/v1/admin/issues/sync");
  assert.equal(sync.status, 200);
  assert.equal(sync.json.data.filed, 1);
  assert.equal(githubRequests.length, 1);
  assert.equal(githubRequests[0].path, "/repos/owner/repo/issues");
  assert.match(githubRequests[0].body.title, /^\[运行错误\] GET \/api\/v1\/views/);
  assert.match(githubRequests[0].body.body, /connection reset/);

  const again = await call("POST", "/api/v1/admin/issues/sync");
  assert.equal(again.json.data.filed, 0);
  assert.equal(githubRequests.length, 1);
});

test("TC-OPS-003 未配置 GitHub token 时不失败、草稿保留", async () => {
  delete process.env.OPC_GITHUB_TOKEN;
  try {
    await issues.recordRuntimeError({ method: "POST", route: "/api/v1/x", statusCode: 500, errorCode: "ERR-SYS-001", message: "boom" });
    const sync = await issues.sync();
    assert.equal(sync.filed, 0);
    assert.ok(((sync as { skipped?: number }).skipped ?? 0) >= 1);
    const listed = await issues.listIssues("skipped");
    assert.equal(listed.length >= 1, true);
    assert.match(String(listed[0].error), /OPC_GITHUB_TOKEN/);
  } finally {
    process.env.OPC_GITHUB_TOKEN = "test-token";
  }
});

test("TC-OPS-004 用量审视产出体验/需求草稿并投递", async () => {
  for (let i = 0; i < 6; i += 1) {
    await usage.record({ channel: "api", action: "POST /api/v1/views/view_ar_ap/query", statusCode: i < 3 ? 500 : 200, durationMs: i === 0 ? 3200 : 120, errorCode: i < 3 ? "ERR-SYS-001" : null });
  }
  for (let i = 0; i < 12; i += 1) {
    await usage.record({ channel: "ui", action: "ui.tab.cockpit", statusCode: 200, durationMs: 10 });
  }
  const insight = await call("POST", "/api/v1/admin/usage/insight");
  assert.equal(insight.status, 201);
  assert.equal(insight.json.data.items.length >= 2, true);
  const titles = insight.json.data.items.map((item: any) => item.title).join("\n");
  assert.match(titles, /\[体验\] 高频失败操作/);
  assert.match(titles, /\[需求\] 低频\/未使用页签/);

  const sync = await call("POST", "/api/v1/admin/issues/sync");
  assert.equal(sync.status, 200);
  assert.equal(sync.json.data.filed >= 1, true);
  assert.equal(githubRequests.some((request) => String(request.body.title).includes("[体验]")), true);
});

test("TC-OPS-005 Issue 列表可按状态过滤且含投递结果", async () => {
  await issues.recordRuntimeError({ method: "GET", route: "/api/v1/y", statusCode: 500, errorCode: "ERR-SYS-001", message: "kaboom" });
  await issues.sync();
  const filed = await call("GET", "/api/v1/admin/issues?status=filed");
  assert.equal(filed.status, 200);
  assert.equal(filed.json.data.items.length, 1);
  assert.equal(filed.json.data.items[0].github_number, 1);
  assert.match(filed.json.data.items[0].github_url, /\/issues\/1$/);
  const pending = await call("GET", "/api/v1/admin/issues?status=pending");
  assert.equal(pending.json.data.items.length, 0);
});
