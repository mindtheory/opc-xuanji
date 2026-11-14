/**
 * 项目自动驾驶集成测试（SRS-105 REQ-PRJ-027..030）：
 * 建项目时填写版本库 → 自动检出（本地仓库夹具）→ 静态扫描 → 回填档案 →
 * 生成开发/测试/部署计划 → 仅需老板裁决的事项进入裁决队列。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, chmod, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
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

const exec = promisify(execFile);
let pool: Pool;
let server: Server;
let base = "";
let fixtureRepo = "";
let workspaceRoot = "";

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

/** 造一个本地 git 仓库夹具：Node/Express + 测试目录 + Dockerfile，无 LICENSE / 无 CI。 */
async function makeFixtureRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "opc-fixture-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await mkdir(join(dir, "test"), { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "fixture-app", version: "1.0.0", dependencies: { express: "^4.19.0" }, scripts: { test: "node --test" } }, null, 2));
  await writeFile(join(dir, "src/index.js"), "const express = require('express');\nconst app = express();\napp.get('/health', (req, res) => res.json({ ok: true }));\nmodule.exports = app;\n");
  await writeFile(join(dir, "test/app.test.js"), "import assert from 'node:assert';\nassert.ok(true);\n");
  await writeFile(join(dir, "Dockerfile"), "FROM node:24-alpine\nWORKDIR /app\nCOPY . .\nCMD [\"node\", \"src/index.js\"]\n");
  await writeFile(join(dir, "README.md"), "# fixture-app\n\n自动检出夹具。\n");
  await exec("git", ["init", "-q", "-b", "main", dir]);
  await exec("git", ["-C", dir, "-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "add", "-A"]);
  await exec("git", ["-C", dir, "-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "commit", "-q", "-m", "init"]);
  return dir;
}

/** 只有 package.json 的「空」仓库：用于验证骨架生成。 */
async function makeBareRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "opc-bare-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "bare-app", version: "0.1.0", scripts: { test: "node --test" } }, null, 2));
  await writeFile(join(dir, "README.md"), "# bare-app\n\n空仓库夹具。\n");
  await exec("git", ["init", "-q", "-b", "main", dir]);
  await exec("git", ["-C", dir, "-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "add", "-A"]);
  await exec("git", ["-C", dir, "-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "commit", "-q", "-m", "init"]);
  return dir;
}

before(async () => {
  pool = makePool();
  workspaceRoot = await mkdtemp(join(tmpdir(), "opc-autopilot-ws-"));
  process.env.OPC_WORKSPACE_ROOT = workspaceRoot;
  fixtureRepo = await makeFixtureRepo();

  const audit = new AuditService(pool, { schemaVersion: "1" });
  const archiveDir = await mkdtemp(join(tmpdir(), "opc-autopilot-"));
  const scheduler = new Scheduler(pool, audit, { archiveDir });
  for (const task of defaultTasks()) scheduler.register(task);
  const software = new ProjectSoftwareService(pool, audit);
  const autopilot = new ProjectAutopilotService(pool, audit);
  const intel = new IntelPipelineService(pool);
  const admin = new AdminService(pool, audit, software, intel, autopilot);
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
  // 只播种公司默认测试服务器：部署计划应复用它，生产目标因无公网服务器进入裁决队列
  await pool.query(
    `INSERT INTO ref.shared_resource (kind, code, name, endpoint, access_method, default_account, credential_ref, os, is_default, status)
     VALUES ('test_server', 'test-debian52', '测试服务器 debian52', '192.168.1.52', 'ssh', 'canetwork', 'env:OPC_DEFAULT_SSH_PASSWORD', 'debian', true, 'active')`,
  );
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("TC-AUTO-001 新建项目填写版本库：自动检出并回填档案", async () => {
  const created = await call("POST", "/api/v1/admin/projects", {
    name: "自动化生产项目",
    stage: "planning",
    repository: { url: `file://${fixtureRepo}`, branch: "main" },
  });
  assert.equal(created.status, 201);
  const projectId = created.json.data.id;
  assert.equal(created.json.data.autopilot.checkout.status, "ok");
  assert.match(created.json.data.autopilot.checkout.commit, /^[0-9a-f]{40}$/);
  assert.equal(created.json.data.autopilot.checkout.files > 0, true);

  const summary = await call("GET", `/api/v1/admin/projects/${projectId}/autopilot`);
  assert.equal(summary.status, 200);
  assert.equal(summary.json.data.profile.tech_stack.primaryLanguage, "javascript");
  assert.equal(summary.json.data.profile.tech_stack.frameworks.includes("express"), true);
  assert.equal(summary.json.data.profile.software_profile.commit.length, 40);
  assert.equal(summary.json.data.scan.status, "ok");
  assert.equal(summary.json.data.pendingDecisions >= 2, true);
});

test("TC-AUTO-002 自动生成开发/测试/部署三份计划与测试基线", async () => {
  const created = await call("POST", "/api/v1/admin/projects", {
    name: "计划生成项目",
    stage: "planning",
    repository: { url: `file://${fixtureRepo}` },
  });
  const projectId = created.json.data.id;

  const plans = await call("GET", `/api/v1/admin/projects/${projectId}/plans`);
  assert.equal(plans.status, 200);
  const kinds = plans.json.data.items.map((item: any) => item.plan_kind).sort();
  assert.deepEqual(kinds, ["deploy", "dev", "test"]);

  const milestones = await pool.query("SELECT name FROM biz.project_milestone WHERE project_id = $1 ORDER BY id", [projectId]);
  assert.equal(milestones.rows.length, 5);

  const testPlans = await pool.query("SELECT id, status FROM biz.test_plan WHERE project_id = $1", [projectId]);
  assert.equal(testPlans.rows.length, 1);
  assert.equal(testPlans.rows[0].status, "draft");
  const cases = await pool.query("SELECT case_code FROM biz.test_case WHERE project_id = $1 ORDER BY case_code", [projectId]);
  assert.deepEqual(cases.rows.map((row: any) => row.case_code), ["TC-AUTO-001", "TC-AUTO-002", "TC-AUTO-003"]);

  const envs = await pool.query("SELECT env_type, host, ssh_user FROM ref.deploy_environment WHERE project_id = $1", [projectId]);
  assert.equal(envs.rows.length, 1);
  assert.equal(envs.rows[0].env_type, "test");
  assert.equal(envs.rows[0].ssh_user, "canetwork");
});

test("TC-AUTO-003 仅裁决项入队，老板裁决后关闭", async () => {
  const created = await call("POST", "/api/v1/admin/projects", {
    name: "裁决项目",
    stage: "planning",
    repository: { url: `file://${fixtureRepo}` },
  });
  const projectId = created.json.data.id;

  const pending = await call("GET", `/api/v1/admin/projects/${projectId}/decisions?status=pending`);
  assert.equal(pending.status, 200);
  const topics = pending.json.data.items.map((item: any) => item.topic).sort();
  // 无 LICENSE、无 CI、无公网服务器、未配置测试环境部署命令、生成了骨架分支 → 五条裁决
  assert.deepEqual(topics, ["ci", "deploy_executor", "deploy_target", "license", "scaffold_review"]);
  assert.equal(pending.json.data.items.every((item: any) => item.status === "pending"), true);

  const target = pending.json.data.items.find((item: any) => item.topic === "license");
  const decided = await call("POST", `/api/v1/admin/projects/${projectId}/decisions/${target.id}/decide`, { decision: "商用专有", decidedBy: "老板" });
  assert.equal(decided.status, 200);
  assert.equal(decided.json.data.status, "decided");

  const again = await call("POST", `/api/v1/admin/projects/${projectId}/decisions/${target.id}/decide`, { decision: "开源许可" });
  assert.equal(again.status, 404);
  assert.equal(again.json.errorCode, "ERR-AUTO-004");
});

test("TC-AUTO-004 非法地址与非仓库路径被拒且留失败检出记录", async () => {
  const badUrl = await call("POST", "/api/v1/admin/projects", {
    name: "非法地址项目",
    stage: "planning",
    repository: { url: "ftp://example.com/repo.git" },
  });
  assert.equal(badUrl.status, 400);
  assert.equal(badUrl.json.errorCode, "ERR-AUTO-001");

  const missing = await call("POST", "/api/v1/admin/projects", {
    name: "不存在仓库项目",
    stage: "planning",
    repository: { url: `file://${join(workspaceRoot, "nope")}` },
  });
  assert.equal(missing.status, 502);
  assert.equal(missing.json.errorCode, "ERR-AUTO-002");
  const failed = await pool.query("SELECT status, error FROM ref.project_checkout WHERE status = 'failed' ORDER BY id DESC LIMIT 1");
  assert.equal(failed.rows.length, 1);
  assert.match(failed.rows[0].error, /检出失败/);
});

test("TC-AUTO-005 自动生成代码骨架并提交本地分支", async () => {
  const bare = await makeBareRepo();
  const created = await call("POST", "/api/v1/admin/projects", {
    name: "骨架生成项目",
    stage: "planning",
    repository: { url: `file://${bare}` },
    autopilotOptions: { pipeline: false, deployTest: false },
  });
  assert.equal(created.status, 201);
  const scaffold = created.json.data.autopilot.scaffold;
  assert.equal(scaffold.status, "committed");
  assert.match(scaffold.branch, /^opc\/autopilot-/);
  const createdFiles = scaffold.files.created.sort();
  assert.deepEqual(createdFiles, [".gitignore", "Dockerfile", "src/index.js", "test/smoke.test.js"]);

  const rows = await pool.query("SELECT status, branch, files FROM stat.project_scaffold WHERE project_id = $1", [created.json.data.id]);
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].status, "committed");
  const branch = await pool.query("SELECT name FROM ref.code_repository WHERE project_id = $1", [created.json.data.id]);
  assert.equal(branch.rows.length, 1);
});

test("TC-AUTO-006 自动跑测试流水线并记录逐阶段结果", async () => {
  const created = await call("POST", "/api/v1/admin/projects", {
    name: "流水线项目",
    stage: "planning",
    repository: { url: `file://${fixtureRepo}` },
    autopilotOptions: { scaffold: false, deployTest: false },
  });
  assert.equal(created.status, 201);
  const pipeline = created.json.data.autopilot.pipeline;
  assert.equal(pipeline.status, "ok");
  assert.equal(pipeline.runs.length >= 1, true);
  assert.equal(pipeline.runs.every((run: any) => run.status === "ok"), true);
  assert.equal(pipeline.runs.some((run: any) => run.stage === "test"), true);

  const rows = await pool.query("SELECT stage, status, exit_code FROM stat.project_pipeline_run WHERE project_id = $1 ORDER BY id", [created.json.data.id]);
  assert.equal(rows.rows.some((row: any) => row.stage === "test" && row.status === "ok" && row.exit_code === 0), true);
});

test("TC-AUTO-007 自动发布测试环境：有命令则执行，无命令转裁决", async () => {
  process.env.OPC_TEST_DEPLOY_CMD = "node -e \"process.exit(0)\"";
  try {
    const created = await call("POST", "/api/v1/admin/projects", {
      name: "自动发布项目",
      stage: "planning",
      repository: { url: `file://${fixtureRepo}` },
      autopilotOptions: { scaffold: false, pipeline: false },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.data.autopilot.deploy.status, "ok");
    const releases = await pool.query("SELECT status, executed_at FROM biz.release_order WHERE project_id = $1", [created.json.data.id]);
    assert.equal(releases.rows.length, 1);
    assert.equal(releases.rows[0].status, "approved");
    assert.notEqual(releases.rows[0].executed_at, null);
  } finally {
    delete process.env.OPC_TEST_DEPLOY_CMD;
  }

  const manual = await call("POST", "/api/v1/admin/projects", {
    name: "未配置发布命令项目",
    stage: "planning",
    repository: { url: `file://${fixtureRepo}` },
    autopilotOptions: { scaffold: false, pipeline: false },
  });
  assert.equal(manual.status, 201);
  assert.equal(manual.json.data.autopilot.deploy.status, "pending");
  const decisions = await call("GET", `/api/v1/admin/projects/${manual.json.data.id}/decisions?status=pending`);
  assert.equal(decisions.json.data.items.some((item: any) => item.topic === "deploy_executor"), true);
});

test("TC-AUTO-008 已建项目也能接入自动驾驶", async () => {
  const created = await call("POST", "/api/v1/admin/projects", { name: "已建项目接入", stage: "execution" });
  assert.equal(created.status, 201);
  const projectId = created.json.data.id;
  assert.equal(created.json.data.autopilot, undefined);

  const ran = await call("POST", `/api/v1/admin/projects/${projectId}/autopilot`, {
    repository: { url: `file://${fixtureRepo}` },
    options: { scaffold: false, pipeline: false, deployTest: false },
  });
  assert.equal(ran.status, 201);
  assert.equal(ran.json.data.checkout.status, "ok");
  assert.equal(ran.json.data.scan.languages.javascript >= 1, true);

  const summary = await call("GET", `/api/v1/admin/projects/${projectId}/autopilot`);
  assert.equal(summary.status, 200);
  assert.equal(summary.json.data.profile.tech_stack.primaryLanguage, "javascript");
  assert.equal(summary.json.data.plans.length, 3);
  assert.equal(summary.json.data.checkout.status, "ok");
});

test("TC-AUTO-009 重复执行幂等：不重复建版本库/里程碑/测试计划/环境/裁决，计划版本递增", async () => {
  const created = await call("POST", "/api/v1/admin/projects", { name: "重复执行项目", stage: "planning" });
  const projectId = created.json.data.id;
  const body = { repository: { url: `file://${fixtureRepo}` }, options: { scaffold: false, pipeline: false, deployTest: false } };

  const first = await call("POST", `/api/v1/admin/projects/${projectId}/autopilot`, body);
  assert.equal(first.status, 201);
  assert.equal(first.json.data.repository.reused, false);
  const second = await call("POST", `/api/v1/admin/projects/${projectId}/autopilot`, body);
  assert.equal(second.status, 201);
  assert.equal(second.json.data.repository.reused, true);

  const repos = await pool.query("SELECT id FROM ref.code_repository WHERE project_id = $1", [projectId]);
  assert.equal(repos.rows.length, 1);
  const milestones = await pool.query("SELECT id FROM biz.project_milestone WHERE project_id = $1", [projectId]);
  assert.equal(milestones.rows.length, 5);
  const testPlans = await pool.query("SELECT id FROM biz.test_plan WHERE project_id = $1", [projectId]);
  assert.equal(testPlans.rows.length, 1);
  const cases = await pool.query("SELECT case_code FROM biz.test_case WHERE project_id = $1", [projectId]);
  assert.equal(cases.rows.length, 3);
  const envs = await pool.query("SELECT id FROM ref.deploy_environment WHERE project_id = $1 AND env_type = 'test'", [projectId]);
  assert.equal(envs.rows.length, 1);

  const plans = await pool.query("SELECT plan_kind, version FROM stat.project_plan WHERE project_id = $1 ORDER BY plan_kind, version", [projectId]);
  assert.deepEqual(plans.rows, [
    { plan_kind: "deploy", version: 1 },
    { plan_kind: "deploy", version: 2 },
    { plan_kind: "dev", version: 1 },
    { plan_kind: "dev", version: 2 },
    { plan_kind: "test", version: 1 },
    { plan_kind: "test", version: 2 },
  ]);

  const decisions = await pool.query<{ topic: string }>("SELECT topic FROM stat.project_decision WHERE project_id = $1", [projectId]);
  const topics = decisions.rows.map((row) => row.topic);
  assert.equal(new Set(topics).size, topics.length);
});

/** SVN 桩：模拟自动化用到的 svn --version / checkout / info，记录 argv/stdin 供凭据断言（真实环境需 subversion ≥1.10）。 */
async function makeSvnStub(fixture: string, revision: string, argsFile: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "opc-svn-stub-"));
  const file = join(dir, "svn");
  const script = [
    "#!/bin/sh",
    "# 测试桩：只实现本服务用到的 --version / checkout / info --show-item；记录 checkout 的 argv 与 stdin",
    'if [ "$1" = "--version" ]; then echo "1.14.24"; exit 0; fi',
    'if [ "$1" = "checkout" ]; then',
    `  echo "$@" > "${argsFile}"`,
    `  cat > "${argsFile}.stdin"`,
    "  for last; do :; done",
    `  cp -R "${fixture}/." "$last"`,
    '  mkdir -p "$last/.svn"',
    '  echo "12" > "$last/.svn/entries"',
    "  exit 0",
    "fi",
    'if [ "$1" = "info" ]; then',
    '  case "$*" in',
    `    *"--show-item revision"*) echo "${revision}"; exit 0;;`,
    '    *) echo "svn://stub/repository/trunk"; exit 0;;',
    "  esac",
    "fi",
    "exit 1",
  ].join("\n");
  await writeFile(file, `${script}\n`, { mode: 0o755 });
  await chmod(file, 0o755);
  return dir;
}

test("TC-AUTO-010 SVN 版本库检出：修订号落库、扫描跳过 .svn、档案与发布版本回填", async () => {
  const svnFixture = await mkdtemp(join(tmpdir(), "opc-svn-fixture-"));
  await mkdir(join(svnFixture, "src"), { recursive: true });
  await mkdir(join(svnFixture, "test"), { recursive: true });
  await writeFile(join(svnFixture, "package.json"), JSON.stringify({ name: "svn-app", version: "1.0.0", dependencies: { express: "^4.19.0" }, scripts: { test: "node --test" } }, null, 2));
  await writeFile(join(svnFixture, "src/index.js"), "const express = require('express');\nmodule.exports = express;\n");
  await writeFile(join(svnFixture, "test/app.test.js"), "import assert from 'node:assert';\nassert.ok(true);\n");
  await writeFile(join(svnFixture, "README.md"), "# svn-app\n\nSVN 检出夹具。\n");
  const argsDir = await mkdtemp(join(tmpdir(), "opc-svn-args-"));
  const argsFile = join(argsDir, "checkout.args");
  const stubDir = await makeSvnStub(svnFixture, "12345", argsFile);
  const originalPath = process.env.PATH;
  const originalSvnUser = process.env.OPC_SVN_USERNAME;
  const originalSvnPassword = process.env.OPC_SVN_PASSWORD;
  const originalSvnTrusted = process.env.OPC_SVN_TRUSTED_HOSTS;
  process.env.PATH = `${stubDir}:${originalPath ?? ""}`;
  process.env.OPC_SVN_USERNAME = "svnuser";
  process.env.OPC_SVN_PASSWORD = "svn-test-secret";
  process.env.OPC_SVN_TRUSTED_HOSTS = "svn.internal";
  try {
    const created = await call("POST", "/api/v1/admin/projects", {
      name: "SVN 检出项目",
      stage: "planning",
      repository: { url: "svn://svn.internal/company/repo", kind: "svn", branch: "trunk", revision: "12345" },
      autopilotOptions: { scaffold: false, pipeline: false, deployTest: true },
    });
    assert.equal(created.status, 201);
    const projectId = created.json.data.id;
    const autopilot = created.json.data.autopilot;
    assert.equal(autopilot.repository.kind, "svn");
    assert.equal(autopilot.checkout.vcs, "svn");
    assert.equal(autopilot.checkout.commit, null);
    assert.equal(autopilot.checkout.revision, "12345");
    assert.equal(autopilot.checkout.files > 0, true);

    const repo = await pool.query("SELECT kind, default_ref FROM ref.code_repository WHERE project_id = $1", [projectId]);
    assert.deepEqual(repo.rows[0], { kind: "svn", default_ref: "trunk" });
    const checkout = await pool.query("SELECT vcs_kind, branch, revision, commit_sha FROM ref.project_checkout WHERE project_id = $1 AND status = 'ok'", [projectId]);
    assert.deepEqual(checkout.rows[0], { vcs_kind: "svn", branch: "trunk", revision: "12345", commit_sha: null });

    const summary = await call("GET", `/api/v1/admin/projects/${projectId}/autopilot`);
    assert.equal(summary.status, 200);
    assert.equal(summary.json.data.checkout.vcs_kind, "svn");
    assert.equal(summary.json.data.checkout.revision, "12345");
    assert.equal(summary.json.data.checkout.commit_sha, null);
    assert.equal(summary.json.data.profile.software_profile.vcs, "svn");
    assert.equal(summary.json.data.profile.software_profile.revision, "12345");
    assert.equal(summary.json.data.profile.software_profile.commit, null);
    assert.equal(summary.json.data.profile.tech_stack.primaryLanguage, "javascript");

    // 扫描必须跳过 SVN 元数据目录
    const scanRow = await pool.query<{ structure: string[] }>("SELECT structure FROM stat.project_scan WHERE project_id = $1 ORDER BY id DESC LIMIT 1", [projectId]);
    assert.equal(scanRow.rows[0].structure.some((item) => item.includes(".svn")), false);

    // 发布版本号回退到 SVN 修订号（无部署命令 → 发布单已建、执行转裁决）
    const release = await pool.query("SELECT version, status FROM biz.release_order WHERE project_id = $1 ORDER BY id DESC LIMIT 1", [projectId]);
    assert.equal(release.rows[0].version, "12345");
    assert.equal(release.rows[0].status, "approved");
    assert.equal(autopilot.deploy.status, "pending");

    // 服务环境凭据：未填 authRef 时，仅对 OPC_SVN_TRUSTED_HOSTS 白名单主机自动使用 OPC_SVN_PASSWORD
    const svnArgs = await readFile(argsFile, "utf8");
    assert.match(svnArgs, /--username svnuser/);
    assert.match(svnArgs, /--password-from-stdin/);
    assert.match(svnArgs, /--revision 12345/);
    assert.equal((await readFile(`${argsFile}.stdin`, "utf8")).trim(), "svn-test-secret");

    // 白名单外主机（含任意 svn URL）不自动送出口令
    const untrusted = await call("POST", "/api/v1/admin/projects", {
      name: "SVN 非受信主机",
      stage: "planning",
      repository: { url: "svn://untrusted.example/company/repo", kind: "svn" },
      autopilotOptions: { scaffold: false, pipeline: false, deployTest: false },
    });
    assert.equal(untrusted.status, 201);
    const untrustedArgs = await readFile(argsFile, "utf8");
    assert.equal(untrustedArgs.includes("--username"), false);
    assert.equal(untrustedArgs.includes("--password-from-stdin"), false);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalSvnUser === undefined) delete process.env.OPC_SVN_USERNAME;
    else process.env.OPC_SVN_USERNAME = originalSvnUser;
    if (originalSvnPassword === undefined) delete process.env.OPC_SVN_PASSWORD;
    else process.env.OPC_SVN_PASSWORD = originalSvnPassword;
    if (originalSvnTrusted === undefined) delete process.env.OPC_SVN_TRUSTED_HOSTS;
    else process.env.OPC_SVN_TRUSTED_HOSTS = originalSvnTrusted;
    await rm(argsFile, { force: true });
    await rm(`${argsFile}.stdin`, { force: true });
  }
});

test("TC-AUTO-011 svn 客户端缺失：502 明确提示并登记 svn_client 裁决", async () => {
  const isolatedPath = await mkdtemp(join(tmpdir(), "opc-empty-path-"));
  const originalPath = process.env.PATH;
  process.env.PATH = isolatedPath;
  try {
    const created = await call("POST", "/api/v1/admin/projects", {
      name: "SVN 缺客户端项目",
      stage: "planning",
      repository: { url: "svn://svn.internal/company/repo", kind: "svn" },
      autopilotOptions: { scaffold: false, pipeline: false, deployTest: false },
    });
    assert.equal(created.status, 502);
    assert.equal(created.json.errorCode, "ERR-AUTO-002");
    assert.match(created.json.message, /svn/);
    assert.match(created.json.message, /subversion/);

    const project = await pool.query<{ id: string }>("SELECT id FROM biz.project WHERE name = $1 ORDER BY id DESC LIMIT 1", ["SVN 缺客户端项目"]);
    assert.equal(project.rows.length, 1);
    const projectId = project.rows[0].id;
    const failed = await pool.query("SELECT vcs_kind, status, error FROM ref.project_checkout WHERE project_id = $1 ORDER BY id DESC LIMIT 1", [projectId]);
    assert.equal(failed.rows[0].status, "failed");
    assert.equal(failed.rows[0].vcs_kind, "svn");
    assert.match(failed.rows[0].error, /svn/);

    const decisions = await pool.query("SELECT topic, risk_level, status FROM stat.project_decision WHERE project_id = $1 AND topic = 'svn_client'", [projectId]);
    assert.equal(decisions.rows.length, 1);
    assert.equal(decisions.rows[0].status, "pending");
    assert.equal(decisions.rows[0].risk_level, "high");
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});
