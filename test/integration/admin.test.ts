import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
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

let pool: Pool;
let server: Server;
let base = "";
let projectId = 0;

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
  const archiveDir = await mkdtemp(join(tmpdir(), "opc-admin-"));
  const scheduler = new Scheduler(pool, audit, { archiveDir });
  for (const task of defaultTasks()) scheduler.register(task);
  const software = new ProjectSoftwareService(pool, audit);
  const intel = new IntelPipelineService(pool);
  const admin = new AdminService(pool, audit, software, intel);
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
  const project = await pool.query<{ id: number }>(
    "INSERT INTO biz.project (name, project_type, stage, progress) VALUES ('管理面项目', 'software', 'execution', 10) RETURNING id",
  );
  projectId = project.rows[0].id;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("管理面：项目列表、更新与汇总", async () => {
  const listed = await call("GET", "/api/v1/admin/projects");
  assert.equal(listed.status, 200);
  assert.equal(listed.json.data.items.length, 1);
  assert.equal(listed.json.data.items[0].name, "管理面项目");

  const updated = await call("PUT", `/api/v1/admin/projects/${projectId}`, { progress: 55, stage: "delivery" });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.progress, 55);
  assert.equal(updated.json.data.stage, "delivery");

  const summary = await call("GET", `/api/v1/admin/projects/${projectId}/summary`);
  assert.equal(summary.status, 200);
  assert.equal(typeof summary.json.data.testPassRate, "number");
  assert.equal(summary.json.data.milestonesTotal, 0);
});

test("管理面：里程碑 CRUD 与删除后 404", async () => {
  const created = await call("POST", `/api/v1/admin/projects/${projectId}/milestones`, {
    name: "M1 需求冻结",
    targetDate: "2026-12-01",
  });
  assert.equal(created.status, 201);
  const milestoneId = created.json.data.id;

  const listed = await call("GET", `/api/v1/admin/projects/${projectId}/milestones`);
  assert.equal(listed.status, 200);
  assert.equal(listed.json.data.items.length, 1);

  const updated = await call("PUT", `/api/v1/admin/projects/${projectId}/milestones/${milestoneId}`, {
    status: "achieved",
    actualDate: "2026-11-30",
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.status, "achieved");

  const deleted = await call("DELETE", `/api/v1/admin/projects/${projectId}/milestones/${milestoneId}`);
  assert.equal(deleted.status, 200);

  const missing = await call("DELETE", `/api/v1/admin/projects/${projectId}/milestones/${milestoneId}`);
  assert.equal(missing.status, 404);
});

test("管理面：情报空间、来源、绑定、主题、标签与汇总", async () => {
  const scope = await call("POST", "/api/v1/admin/intel/scopes", { projectId, name: "竞品情报", briefTime: "08:30" });
  assert.equal(scope.status, 201);
  assert.equal(scope.json.data.projectId, projectId);

  const source = await call("POST", "/api/v1/admin/intel/sources", { name: "行业 RSS", sourceType: "rss", url: "https://example.com/rss" });
  assert.equal(source.status, 201);
  const sourceId = source.json.data.id;

  const binding = await call("POST", "/api/v1/admin/intel/bindings", { projectId, sourceId, priority: 10 });
  assert.equal(binding.status, 201);

  const bindings = await call("GET", `/api/v1/admin/intel/bindings?projectId=${projectId}`);
  assert.equal(bindings.status, 200);
  assert.equal(bindings.json.data.items.length, 1);

  const topic = await call("POST", "/api/v1/admin/intel/topics", { projectId, keyword: "AI 芯片", priority: 200 });
  assert.equal(topic.status, 201);
  const topicId = topic.json.data.id;

  const tag = await call("POST", "/api/v1/admin/intel/tags", { projectId, name: "政策", category: "policy" });
  assert.equal(tag.status, 201);

  const summary = await call("GET", `/api/v1/admin/intel/summary?projectId=${projectId}`);
  assert.equal(summary.status, 200);
  assert.equal(summary.json.data.hasScope, true);
  assert.equal(summary.json.data.sourcesTotal, 1);
  assert.equal(summary.json.data.topics, 1);

  const updated = await call("PUT", `/api/v1/admin/intel/topics/${topicId}`, { projectId, priority: 300 });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.priority, 300);

  const deleted = await call("DELETE", `/api/v1/admin/intel/topics/${topicId}?projectId=${projectId}`);
  assert.equal(deleted.status, 200);

  const blocked = await call("DELETE", `/api/v1/admin/intel/sources/${sourceId}`);
  assert.equal(blocked.status, 409);
});

test("管理面：情报流水线触发、运行记录与日报", async () => {
  await call("POST", "/api/v1/admin/intel/scopes", { projectId, name: "竞品情报" });

  const analyze = await call("POST", "/api/v1/admin/intel/run/analyze", { projectId });
  assert.equal(analyze.status, 200);
  assert.equal(analyze.json.data.stage, "analyze");

  const brief = await call("POST", "/api/v1/admin/intel/run/brief", { projectId });
  assert.equal(brief.status, 200);

  const runs = await call("GET", `/api/v1/admin/intel/runs?projectId=${projectId}`);
  assert.equal(runs.status, 200);
  assert.ok(runs.json.data.pipeline.length >= 2);

  const briefs = await call("GET", `/api/v1/admin/intel/briefs?projectId=${projectId}`);
  assert.equal(briefs.status, 200);
  assert.ok(briefs.json.data.items.length >= 1);
  const briefId = briefs.json.data.items[0].id;

  const detail = await call("GET", `/api/v1/admin/intel/briefs/${briefId}`);
  assert.equal(detail.status, 200);
  assert.equal(typeof detail.json.data.coverage, "object");
});

test("驾驶舱：项目研发与情报指标进入快照", async () => {
  await pool.query(
    "INSERT INTO biz.project_milestone (project_id, name, target_date, status) VALUES ($1, '逾期节点', current_date - 1, 'planned')",
    [projectId],
  );
  await call("POST", "/api/v1/admin/intel/scopes", { projectId, name: "竞品情报" });
  const dashboard = await call("GET", "/api/v1/web/dashboard?range=30d");
  assert.equal(dashboard.status, 200);
  const ids = dashboard.json.data.metrics.map((item: { id: string }) => item.id);
  assert.ok(ids.includes("project_milestones_overdue"));
  assert.ok(ids.includes("project_test_pass_rate"));
  assert.ok(ids.includes("intel_scopes_active"));
  assert.ok(ids.includes("intel_sources_blocked"));
});
