/**
 * 公司基础信息集成测试（SRS-103 REQ-ADM-013，PA-OPC-035）：
 * 设置页单行档案 → 跨模块共用（项目交付物抬头、员工只读视图）；
 * 校验：名称必填、信用代码 18 位、邮箱/官网/邮编格式；写审计不落银行账号正文。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

let pool: Pool;
let audit: AuditService;
let views: ViewService;
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

/** 与迁移 0008 同口径的公司默认值（跨模块共用部分）。 */
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
        'ssh', 'canetwork', 'env:OPC_DEFAULT_SSH_PASSWORD', 'debian', '内网机房', true, 'active')
     ON CONFLICT (kind, name) DO NOTHING`,
  );
}

before(async () => {
  pool = makePool();
  audit = new AuditService(pool, { schemaVersion: "1" });
  const archiveDir = await mkdtemp(join(tmpdir(), "opc-company-"));
  const scheduler = new Scheduler(pool, audit, { archiveDir });
  for (const task of defaultTasks()) scheduler.register(task);
  const software = new ProjectSoftwareService(pool, audit);
  const intel = new IntelPipelineService(pool);
  const admin = new AdminService(pool, audit, software, intel);
  views = new ViewService(pool, audit);
  const ctx: ApiContext = {
    pool,
    audit,
    views,
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

test("TC-ADM-001 公司基础信息：读取默认口径→校验→保存→审计", async () => {
  const empty = await call("GET", "/api/v1/admin/company-profile");
  assert.equal(empty.status, 200);
  assert.equal(empty.json.data.profile, null);
  assert.equal(empty.json.data.defaults.defaultOs, "debian");
  assert.equal(empty.json.data.defaults.defaultRemoteMethod, "ssh");

  const missingName = await call("PUT", "/api/v1/admin/company-profile", { shortName: "只有简称" });
  assert.equal(missingName.status, 400);
  assert.equal(missingName.json.errorCode, "ERR-RES-001");

  const badCredit = await call("PUT", "/api/v1/admin/company-profile", { name: "测试公司", creditCode: "123" });
  assert.equal(badCredit.status, 400);
  assert.equal(badCredit.json.errorCode, "ERR-RES-001");

  const badEmail = await call("PUT", "/api/v1/admin/company-profile", { name: "测试公司", email: "not-an-email" });
  assert.equal(badEmail.status, 400);

  // 回归（设置页表单形状）：表单会把未填字段以空字符串整体提交（含 entityType:""），
  // 首建不能把 NOT NULL 的 entity_type 写成 null，应按缺省口径落「服务型」。
  const uiShapedBody: Record<string, string> = { updatedBy: "老板" };
  for (const key of [
    "name", "entityType", "shortName", "englishName", "creditCode", "legalPerson", "establishedDate", "registeredCapital",
    "companyType", "industry", "employeeCount", "website", "regAddress", "officeAddress", "postcode", "phone",
    "email", "contactName", "contactTitle", "taxNumber", "invoiceTitle", "taxpayerType", "bankName",
    "bankAccount", "invoiceNote", "businessScope",
  ]) uiShapedBody[key] = key === "name" ? "天元数智（测试）有限公司" : "";
  const uiShaped = await call("PUT", "/api/v1/admin/company-profile", uiShapedBody);
  assert.equal(uiShaped.status, 200);
  assert.equal(uiShaped.json.data.profile.entityType, "服务型");

  // 更新路径同样：空字符串的 entityType 不覆盖已落库的主体类型。
  const updateEmptyType = await call("PUT", "/api/v1/admin/company-profile", { name: "天元数智（测试）有限公司", entityType: "" });
  assert.equal(updateEmptyType.status, 200);
  assert.equal(updateEmptyType.json.data.profile.entityType, "服务型");

  const saved = await call("PUT", "/api/v1/admin/company-profile", {
    name: "天元数智（测试）有限公司",
    shortName: "天元数智",
    creditCode: "91310000MA1K3XYZ8Q",
    legalPerson: "老板",
    establishedDate: "2024-01-18",
    registeredCapital: "100 万元",
    companyType: "有限责任公司",
    industry: "软件和信息技术服务业",
    employeeCount: 1,
    website: "https://example.com",
    regAddress: "上海市浦东新区示例路 1 号",
    postcode: "200120",
    phone: "021-00000000",
    email: "boss@example.com",
    contactName: "老板",
    contactTitle: "CEO",
    taxNumber: "91310000MA1K3XYZ8Q",
    invoiceTitle: "天元数智（测试）有限公司",
    taxpayerType: "general",
    bankName: "示例银行营业部",
    bankAccount: "6222000000000000",
    invoiceNote: "开票前请联系财务",
    businessScope: "软件开发；信息技术咨询服务。",
  });
  assert.equal(saved.status, 200);
  const profile = saved.json.data.profile;
  assert.equal(profile.name, "天元数智（测试）有限公司");
  assert.equal(profile.shortName, "天元数智");
  assert.equal(profile.creditCode, "91310000MA1K3XYZ8Q");
  assert.equal(profile.taxpayerType, "general");
  assert.equal(profile.employeeCount, 1);

  const again = await call("GET", "/api/v1/admin/company-profile");
  assert.equal(again.json.data.profile.name, "天元数智（测试）有限公司");
  assert.equal(again.json.data.updatedAt !== null, true);

  const rows = await pool.query("SELECT payload FROM audit.audit_log WHERE action = 'company.profile.update' ORDER BY id DESC LIMIT 1");
  assert.equal(rows.rows.length, 1);
  const payload = rows.rows[0].payload as { fields?: string[] };
  assert.equal(payload.fields?.includes("bank_account"), true);
  assert.equal(JSON.stringify(payload).includes("6222000000000000"), false);
});

test("TC-ADM-002 公司信息跨模块共用：员工只读视图返回扩展字段", async () => {
  await call("PUT", "/api/v1/admin/company-profile", {
    name: "天元数智（测试）有限公司",
    shortName: "天元数智",
    creditCode: "91310000MA1K3XYZ8Q",
    industry: "软件和信息技术服务业",
    employeeCount: 1,
    website: "https://example.com",
  });
  await pool.query(
    "INSERT INTO ref.employee_plugin (plugin_id, display_name, scope, required_views, tools, write_targets, enabled) VALUES ('opc_project','项目监理','single','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true)",
  );
  await pool.query(
    "INSERT INTO ref.view_grant (view_id, plugin_id, granted_by, status) VALUES ('view_company_profile','opc_project','boss','active')",
  );
  const result = await views.query({ pluginId: "opc_project", viewId: "view_company_profile", limit: 5 });
  const row = result.rows[0] as Record<string, unknown>;
  assert.equal(row.name, "天元数智（测试）有限公司");
  assert.equal(row.short_name, "天元数智");
  assert.equal(row.credit_code, "91310000MA1K3XYZ8Q");
  assert.equal(row.industry, "软件和信息技术服务业");
  assert.equal(row.employee_count, 1);
  assert.equal("bank_account" in row, false);
});

test("TC-ADM-003 公司信息在项目交付物抬头共用", async () => {
  await call("PUT", "/api/v1/admin/company-profile", {
    name: "天元数智（测试）有限公司",
    creditCode: "91310000MA1K3XYZ8Q",
  });
  const workspace = await mkdtemp(join(tmpdir(), "opc-company-project-"));
  try {
    const project = await pool.query("INSERT INTO biz.project (name, stage) VALUES ('公司信息共享项目','planning') RETURNING id");
    const projectId = Number(project.rows[0].id);
    const content = {
      weeks: 2,
      phases: [{ key: "freeze", title: "需求与范围冻结", startDate: "2026-11-14", endDate: "2026-11-17", owner: "项目监理", status: "planned", deliverables: ["范围清单"] }],
      modules: [],
      workBreakdown: ["范围冻结"],
      assumptions: [],
      risks: [],
    };
    await pool.query(
      "INSERT INTO stat.project_plan (project_id, plan_kind, version, title, content, status) VALUES ($1,'dev',1,'开发计划',$2::jsonb,'draft')",
      [projectId, JSON.stringify(content)],
    );
    await pool.query(
      "INSERT INTO ref.project_checkout (project_id, url, workspace_path, status, checked_out_at) VALUES ($1,'file:///tmp/company-fixture',$2,'ok',now())",
      [projectId, workspace],
    );
    const autopilot = new ProjectAutopilotService(pool, audit);
    const result = await autopilot.advancePlan(projectId);
    assert.equal(result.task, "freeze");
    const scope = await readFile(join(workspace, "docs/autopilot/scope.md"), "utf8");
    assert.match(scope, /公司：天元数智（测试）有限公司（统一社会信用代码：91310000MA1K3XYZ8Q）/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
