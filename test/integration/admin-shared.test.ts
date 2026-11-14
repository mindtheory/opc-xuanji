/**
 * 基础资源配置集成测试（SRS-105 REQ-PRJ-023..026）：
 * 公司基础资源目录（六类）、公司默认口径（debian + ssh + 默认账号）、
 * 新建项目默认选型、凭据只存引用、资源绑定后不可删。
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
import { IntelPipelineService } from "../../src/domains/intel/daily.ts";
import { AdminService } from "../../src/domains/admin/service.ts";

let pool: Pool;
let server: Server;
let base = "";

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

/** 测试库每例清库后重放「公司默认口径 + 三件默认资源」种子（与迁移 0008 同口径）。 */
async function seedCompanyDefaults(): Promise<void> {
  await pool.query(
    `INSERT INTO ref.shared_setting (key, value) VALUES
       ('company.default_os', '"debian"'::jsonb),
       ('company.default_remote_method', '"ssh"'::jsonb),
       ('company.default_account', '"canetwork"'::jsonb),
       ('company.default_credential_ref', '"env:OPC_DEFAULT_SSH_PASSWORD"'::jsonb),
       ('company.default_ssh_port', '22'::jsonb)
     ON CONFLICT (key) DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO ref.shared_resource
       (kind, code, name, endpoint, access_method, default_account, credential_ref, os, location, is_default, status)
     VALUES
       ('code_repo', 'git-primary', 'GitHub 主仓库', 'https://github.com/mindtheory/opc-xuanji.git',
        'https', NULL, 'ssh-agent:git', NULL, 'GitHub', true, 'active'),
       ('test_server', 'test-debian52', '测试服务器 debian52', '192.168.1.52',
        'ssh', 'canetwork', 'env:OPC_DEFAULT_SSH_PASSWORD', 'debian', '内网机房', true, 'active'),
       ('domain', 'domain-main', '主域名', 'canetwork.myqnapcloud.com',
        'https', NULL, NULL, NULL, '公网', true, 'active')
     ON CONFLICT (kind, name) DO NOTHING`,
  );
}

before(async () => {
  pool = makePool();
  const audit = new AuditService(pool, { schemaVersion: "1" });
  const archiveDir = await mkdtemp(join(tmpdir(), "opc-shared-"));
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
  await seedCompanyDefaults();
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("TC-RES-001 公司默认口径：debian + ssh + 默认账号 + 凭据引用", async () => {
  const res = await call("GET", "/api/v1/admin/shared-resources/defaults");
  assert.equal(res.status, 200);
  assert.equal(res.json.data.defaultOs, "debian");
  assert.equal(res.json.data.defaultRemoteMethod, "ssh");
  assert.equal(res.json.data.defaultAccount, "canetwork");
  assert.equal(res.json.data.defaultCredentialRef, "env:OPC_DEFAULT_SSH_PASSWORD");
  assert.equal(res.json.data.defaultSshPort, 22);
  assert.deepEqual(res.json.data.kinds, ["code_repo", "artifact_repo", "test_server", "nas", "public_server", "domain"]);
  assert.deepEqual(res.json.data.accessMethods, ["ssh", "rdp", "sunlogin", "https", "console", "smb", "nfs", "api"]);

  const kinds = res.json.data.resources.map((item: any) => item.kind).sort();
  assert.deepEqual(kinds, ["code_repo", "domain", "test_server"]);
  const server0 = res.json.data.resources.find((item: any) => item.kind === "test_server");
  assert.equal(server0.accessMethod, "ssh");
  assert.equal(server0.defaultAccount, "canetwork");
  assert.equal(server0.os, "debian");
});

test("TC-RES-002 新建项目默认从公司资源选型并留痕", async () => {
  const created = await call("POST", "/api/v1/admin/projects", { name: "默认选型项目", stage: "planning" });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.sharedResourcesBound, 3);

  const projectId = created.json.data.id;
  const bound = await call("GET", `/api/v1/admin/projects/${projectId}/shared-resources`);
  assert.equal(bound.status, 200);
  assert.equal(bound.json.data.items.length, 3);
  for (const item of bound.json.data.items) assert.equal(item.appliedByDefault, true);
  const kinds = bound.json.data.items.map((item: any) => item.kind);
  assert.deepEqual(kinds, ["code_repo", "domain", "test_server"]);
});

test("TC-RES-003 显式选型覆盖默认，bindDefaults=false 不绑定", async () => {
  const nas = await call("POST", "/api/v1/admin/shared-resources", {
    kind: "nas",
    name: "NAS 主存储",
    endpoint: "/volume1/opc",
    accessMethod: "smb",
    defaultAccount: "opc",
    credentialRef: "env:OPC_NAS_SECRET",
    capacity: "8TB",
    isDefault: false,
  });
  assert.equal(nas.status, 201);
  const nasId = nas.json.data.id;

  const explicit = await call("POST", "/api/v1/admin/projects", { name: "显式选型项目", stage: "planning", resourceIds: [nasId] });
  assert.equal(explicit.status, 201);
  assert.equal(explicit.json.data.sharedResourcesBound, 1);
  const bound = await call("GET", `/api/v1/admin/projects/${explicit.json.data.id}/shared-resources`);
  assert.equal(bound.json.data.items.length, 1);
  assert.equal(bound.json.data.items[0].kind, "nas");
  assert.equal(bound.json.data.items[0].appliedByDefault, false);

  const none = await call("POST", "/api/v1/admin/projects", { name: "不绑定项目", stage: "planning", bindDefaults: false });
  assert.equal(none.status, 201);
  const empty = await call("GET", `/api/v1/admin/projects/${none.json.data.id}/shared-resources`);
  assert.equal(empty.json.data.items.length, 0);
});

test("TC-RES-004 凭据只接受引用：明文口令拒绝，类型非法拒绝", async () => {
  const plain = await call("POST", "/api/v1/admin/shared-resources", {
    kind: "test_server",
    name: "明文密码机",
    endpoint: "10.0.0.9",
    accessMethod: "ssh",
    credentialRef: "15522213352",
  });
  assert.equal(plain.status, 400);
  assert.equal(plain.json.errorCode, "ERR-RES-002");

  const badKind = await call("POST", "/api/v1/admin/shared-resources", { kind: "printer", name: "打印机" });
  assert.equal(badKind.status, 400);
  assert.equal(badKind.json.errorCode, "ERR-RES-001");

  const ok = await call("POST", "/api/v1/admin/shared-resources", {
    kind: "public_server",
    name: "公网服务器 A",
    endpoint: "203.0.113.10",
    accessMethod: "ssh",
    defaultAccount: "canetwork",
    credentialRef: "env:OPC_DEFAULT_SSH_PASSWORD",
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.os, "debian");
  assert.equal(ok.json.data.accessMethod, "ssh");
  assert.equal(ok.json.data.credentialRef, "env:OPC_DEFAULT_SSH_PASSWORD");
});

test("TC-RES-005 资源 CRUD：更新、绑定后不可删、解绑后可删", async () => {
  const created = await call("POST", "/api/v1/admin/shared-resources", {
    kind: "artifact_repo",
    name: "Maven 私服",
    endpoint: "https://nexus.example.com/repository/maven",
    accessMethod: "https",
    credentialRef: "env:OPC_NEXUS_TOKEN",
    isDefault: false,
  });
  assert.equal(created.status, 201);
  const id = created.json.data.id;
  assert.equal(created.json.data.accessMethod, "https");

  const updated = await call("PUT", `/api/v1/admin/shared-resources/${id}`, { status: "disabled", notes: "维护中" });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.status, "disabled");
  assert.equal(updated.json.data.notes, "维护中");

  await call("PUT", `/api/v1/admin/shared-resources/${id}`, { status: "active" });
  const project = await call("POST", "/api/v1/admin/projects", { name: "绑定资源项目", stage: "planning", resourceIds: [id] });
  assert.equal(project.status, 201);

  const blocked = await call("DELETE", `/api/v1/admin/shared-resources/${id}`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.errorCode, "ERR-RES-004");

  const unbound = await call("DELETE", `/api/v1/admin/projects/${project.json.data.id}/shared-resources/${id}`);
  assert.equal(unbound.status, 200);
  const again = await call("DELETE", `/api/v1/admin/projects/${project.json.data.id}/shared-resources/${id}`);
  assert.equal(again.status, 404);

  const deleted = await call("DELETE", `/api/v1/admin/shared-resources/${id}`);
  assert.equal(deleted.status, 200);
  const missing = await call("DELETE", `/api/v1/admin/shared-resources/${id}`);
  assert.equal(missing.status, 404);
});
