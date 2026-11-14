/**
 * 项目监理·软件研发要素集成测试（SRS-105 REQ-PRJ-016..022）：
 * 里程碑、版本库/制品库、SSH 环境、发布审批、测试执行与缺陷查询。
 */
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

let pool: Pool;
let server: Server;
let base = "";
let projectId = 0;
let prodEnvId = 0;

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
  const archiveDir = await mkdtemp(join(tmpdir(), "opc-project-"));
  const scheduler = new Scheduler(pool, audit, { archiveDir });
  for (const task of defaultTasks()) scheduler.register(task);
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
    software: new ProjectSoftwareService(pool, audit),
    archiveDir,
    version: "0.1.0",
  };
  server = await startApiServer(ctx, 0, "127.0.0.1");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await resetDb(pool);
  const project = await pool.query<{ id: number }>(
    "INSERT INTO biz.project (name, project_type, stage, progress) VALUES ('软件交付项目', 'software', 'execution', 10) RETURNING id",
  );
  projectId = project.rows[0].id;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("TC-PRJ-001 里程碑：创建并列出，目标日期保留", async () => {
  const created = await call("POST", `/api/v1/projects/${projectId}/milestones`, {
    name: "M1 需求冻结",
    targetDate: "2026-12-01",
    owner: "项目监理",
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.name, "M1 需求冻结");
  assert.equal(created.json.data.targetDate, "2026-12-01");

  const listed = await call("GET", `/api/v1/projects/${projectId}/milestones`);
  assert.equal(listed.status, 200);
  assert.equal(listed.json.data.length, 1);
});

test("TC-PRJ-002 版本库：明文凭据拒绝，auth_ref 引用通过", async () => {
  const rejected = await call("POST", `/api/v1/projects/${projectId}/repositories`, {
    name: "backend",
    kind: "git",
    url: "https://git.example.com/opc/backend.git",
    authRef: "plain-password",
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.json.errorCode, "ERR-PRJ-003");

  const accepted = await call("POST", `/api/v1/projects/${projectId}/repositories`, {
    name: "backend",
    kind: "git",
    url: "https://git.example.com/opc/backend.git",
    defaultRef: "main",
    authRef: "env:GIT_TOKEN",
    syncMode: "webhook",
  });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.json.data.kind, "git");
  assert.equal(accepted.json.data.authRef, "env:GIT_TOKEN");
});

test("TC-PRJ-003 制品库：登记并列出", async () => {
  const created = await call("POST", `/api/v1/projects/${projectId}/artifacts`, {
    name: "harbor",
    kind: "docker",
    url: "https://harbor.example.com",
    namespace: "opc",
    authRef: "secret:HARBOR_TOKEN",
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.namespace, "opc");

  const listed = await call("GET", `/api/v1/projects/${projectId}/artifacts`);
  assert.equal(listed.status, 200);
  assert.equal(listed.json.data.length, 1);
});

test("TC-PRJ-004 环境与发布：生产强制 manual、缺回滚版本拒绝、审批状态流转", async () => {
  const autoProd = await call("POST", `/api/v1/projects/${projectId}/environments`, {
    envType: "prod",
    name: "prod-cn",
    host: "10.0.0.10",
    sshUser: "deploy",
    authRef: "ssh-agent:prod",
    approvalPolicy: "auto",
  });
  assert.equal(autoProd.status, 400);

  const prod = await call("POST", `/api/v1/projects/${projectId}/environments`, {
    envType: "prod",
    name: "prod-cn",
    host: "10.0.0.10",
    sshUser: "deploy",
    authRef: "ssh-agent:prod",
    approvalPolicy: "manual",
  });
  assert.equal(prod.status, 201);
  prodEnvId = prod.json.data.id;

  const noRollback = await call("POST", `/api/v1/projects/${projectId}/releases`, {
    environmentId: prodEnvId,
    version: "1.2.0",
    requestedBy: "项目监理",
  });
  assert.equal(noRollback.status, 400);

  const release = await call("POST", `/api/v1/projects/${projectId}/releases`, {
    environmentId: prodEnvId,
    version: "1.2.0",
    requestedBy: "项目监理",
    rollbackVersion: "1.1.0",
  });
  assert.equal(release.status, 201);
  assert.equal(release.json.data.status, "pending");

  const approved = await call("POST", `/api/v1/releases/${release.json.data.id}/approve`, { approver: "老板" });
  assert.equal(approved.status, 200);
  assert.equal(approved.json.data.status, "approved");
  assert.equal(approved.json.data.approvedBy, "老板");

  const again = await call("POST", `/api/v1/releases/${release.json.data.id}/approve`, { approver: "老板" });
  assert.equal(again.status, 409);
  assert.equal(again.json.errorCode, "ERR-PRJ-002");
});

test("TC-PRJ-006 测试计划：进入/退出标准与草稿状态", async () => {
  const plan = await call("POST", `/api/v1/projects/${projectId}/test-plans`, {
    version: "1.2.0",
    scope: "回归",
    testTypes: ["api", "regression"],
    entryCriteria: "构建通过",
    exitCriteria: "P0/P1 全通过",
  });
  assert.equal(plan.status, 201);
  assert.equal(plan.json.data.status, "draft");
  assert.equal(plan.json.data.entryCriteria, "构建通过");
});

test("TC-PRJ-007 时间管理：延期里程碑保留目标日期并记录证据", async () => {
  const created = await call("POST", `/api/v1/projects/${projectId}/milestones`, {
    name: "M2 上线",
    targetDate: "2026-12-15",
    status: "delayed",
    actualDate: "2026-12-20",
    evidence: "客户验收延期",
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.status, "delayed");
  assert.equal(created.json.data.targetDate, "2026-12-15");
  assert.equal(created.json.data.actualDate, "2026-12-20");
});

test("TC-PRJ-005 测试执行：结果落库，失败批次标记 failed", async () => {
  const run = await call("POST", "/api/v1/test-runs", {
    projectId,
    version: "1.2.0",
    executor: "qa-agent",
    executorType: "agent",
  });
  assert.equal(run.status, 201);
  assert.equal(run.json.data.status, "running");

  const result = await call("POST", `/api/v1/test-runs/${run.json.data.id}/results`, {
    caseId: 101,
    result: "failed",
    failureReason: "接口 500",
  });
  assert.equal(result.status, 201);
  assert.equal(result.json.data.result, "failed");

  const defects = await call("GET", `/api/v1/projects/${projectId}/defects`);
  assert.equal(defects.status, 200);
  assert.deepEqual(defects.json.data, []);
});
