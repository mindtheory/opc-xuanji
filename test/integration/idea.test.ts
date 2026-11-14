/**
 * 创意转项目集成测试（SRS-105 REQ-PRJ-035）：
 * 文本/文档创意 → AI 解析 → 自动建项目 → 有仓库进自动驾驶，无仓库转裁决。
 * 文档格式：txt/md/docx/xlsx/pdf（docx/xlsx 用最小 OOXML 包夹具，pdf 用最小文本层 PDF 夹具）。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deflateRawSync } from "node:zlib";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
let server: HttpServer;
let base = "";
let ai: HttpServer;
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

async function makeFixtureRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "opc-idea-repo-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "idea-app", version: "1.0.0", scripts: { test: "node --test" } }, null, 2));
  await writeFile(join(dir, "src/index.js"), "console.log('idea app');\n");
  await exec("git", ["init", "-q", "-b", "main", dir]);
  await exec("git", ["-C", dir, "-c", "user.name=f", "-c", "user.email=f@e.c", "add", "-A"]);
  await exec("git", ["-C", dir, "-c", "user.name=f", "-c", "user.email=f@e.c", "commit", "-q", "-m", "init"]);
  return dir;
}

/** 最小 ZIP（store 模式），用于造 docx/xlsx 夹具。 */
function makeZip(files: Array<{ name: string; text: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = Buffer.from(file.text, "utf8");
    const name = Buffer.from(file.name, "utf8");
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, data);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((sum, buffer) => sum + buffer.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

/** 最小文本层 PDF（FlateDecode 流 + Tj 算子），用于验证 pdf 提取。 */
function makePdf(text: string): Buffer {
  const compressed = deflateRawSync(Buffer.from(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`, "latin1"));
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n4 0 obj\n<< /Length ", "latin1"),
    Buffer.from(String(compressed.length), "latin1"),
    Buffer.from(" /Filter /FlateDecode >>\nstream\n", "latin1"),
    compressed,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
  ]);
}

before(async () => {
  pool = makePool();
  workspaceRoot = await mkdtemp(join(tmpdir(), "opc-idea-ws-"));
  process.env.OPC_WORKSPACE_ROOT = workspaceRoot;
  fixtureRepo = await makeFixtureRepo();

  ai = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const analysis = {
        name: "AI 解析的智能巡检系统",
        projectType: "software",
        scope: "面向机房的智能巡检与告警闭环",
        goals: ["7x24 自动巡检", "异常秒级告警"],
        techStackHints: ["Node.js", "PostgreSQL"],
        risks: ["设备协议异构"],
        openQuestions: ["是否接入既有工单系统？"],
        suggestedRepository: "",
        weeks: 6,
        confidence: 0.82,
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) } }] }));
    });
  });
  await new Promise<void>((resolve) => ai.listen(0, "127.0.0.1", () => resolve()));
  process.env.OPC_AI_BASE_URL = `http://127.0.0.1:${(ai.address() as AddressInfo).port}`;
  process.env.OPC_AI_API_KEY = "test-key";
  process.env.OPC_AI_MODEL = "test-model";

  const audit = new AuditService(pool, { schemaVersion: "1" });
  const archiveDir = await mkdtemp(join(tmpdir(), "opc-idea-"));
  const scheduler = new Scheduler(pool, audit, { archiveDir });
  for (const task of defaultTasks()) scheduler.register(task);
  const software = new ProjectSoftwareService(pool, audit);
  const autopilot = new ProjectAutopilotService(pool, audit);
  const admin = new AdminService(pool, audit, software, new IntelPipelineService(pool), autopilot);
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
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => ai.close(() => resolve()));
  await pool.end();
});

test("TC-IDEA-001 文本创意经 AI 解析为项目档案", async () => {
  const analyzed = await call("POST", "/api/v1/admin/ideas/analyze", { idea: "做一个机房智能巡检系统，自动发现异常并告警。" });
  assert.equal(analyzed.status, 200);
  assert.equal(analyzed.json.data.analysis.source, "ai");
  assert.equal(analyzed.json.data.analysis.name, "AI 解析的智能巡检系统");
  assert.equal(analyzed.json.data.analysis.projectType, "software");
  assert.deepEqual(analyzed.json.data.analysis.goals, ["7x24 自动巡检", "异常秒级告警"]);
  assert.equal(analyzed.json.data.documents.length, 0);
});

test("TC-IDEA-002 多格式文档（txt/docx/xlsx/pdf）同时上传并解析", async () => {
  const docx = makeZip([{ name: "word/document.xml", text: "<w:document><w:body><w:p><w:r><w:t>机房巡检需求文档</w:t></w:r></w:p></w:body></w:document>" }]);
  const xlsx = makeZip([
    { name: "xl/sharedStrings.xml", text: "<sst><si><t>设备编号</t></si><si><t>巡检周期</t></si></sst>" },
    { name: "xl/worksheets/sheet1.xml", text: "<worksheet><sheetData><row><c t=\"s\"><v>0</v></c><c t=\"s\"><v>1</v></c></row><row><c><v>3</v></c></row></sheetData></worksheet>" },
  ]);
  const analyzed = await call("POST", "/api/v1/admin/ideas/analyze", {
    files: [
      { name: "需求.txt", contentBase64: Buffer.from("需要支持多机房巡检。", "utf8").toString("base64") },
      { name: "设计.docx", contentBase64: docx.toString("base64") },
      { name: "清单.xlsx", contentBase64: xlsx.toString("base64") },
      { name: "摘要.pdf", contentBase64: makePdf("PDF idea about inspection").toString("base64") },
    ],
  });
  assert.equal(analyzed.status, 200);
  const documents = analyzed.json.data.documents;
  assert.equal(documents.length, 4);
  assert.deepEqual(documents.map((item: any) => item.kind).sort(), ["docx", "pdf", "txt", "xlsx"]);
  assert.equal(documents.every((item: any) => item.chars > 0), true);
  assert.equal(analyzed.json.data.chars > 30, true);
  assert.equal(analyzed.json.data.analysis.source, "ai");
});

test("TC-IDEA-003 创意建项目并自动进入自动驾驶（带仓库）", async () => {
  const created = await call("POST", "/api/v1/admin/projects/from-idea", {
    idea: "做一个机房智能巡检系统",
    repositoryUrl: `file://${fixtureRepo}`,
    options: { scaffold: false, pipeline: false, deployTest: false },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.status, "autopilot");
  assert.equal(created.json.data.project.name, "AI 解析的智能巡检系统");
  assert.equal(created.json.data.autopilot.checkout.status, "ok");
  assert.equal(created.json.data.autopilot.plans.length, 3);

  const projectId = created.json.data.project.id;
  const ideas = await call("GET", `/api/v1/admin/projects/${projectId}/ideas`);
  assert.equal(ideas.status, 200);
  assert.equal(ideas.json.data.items.length, 1);
  assert.equal(ideas.json.data.items[0].status, "autopilot");
});

test("TC-IDEA-004 无仓库创意：建项目并转裁决等待补仓库", async () => {
  const created = await call("POST", "/api/v1/admin/projects/from-idea", { idea: "做一个智能巡检系统" });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.status, "waiting-repository");
  assert.equal(created.json.data.autopilot, null);
  const projectId = created.json.data.project.id;
  const decisions = await call("GET", `/api/v1/admin/projects/${projectId}/decisions?status=pending`);
  assert.equal(decisions.json.data.items.some((item: any) => item.topic === "repository"), true);
});

test("TC-IDEA-005 不支持的格式与空创意被拒", async () => {
  const badDoc = await call("POST", "/api/v1/admin/ideas/analyze", {
    files: [{ name: "病毒.exe", contentBase64: Buffer.from("x").toString("base64") }],
  });
  assert.equal(badDoc.status, 415);
  assert.equal(badDoc.json.errorCode, "ERR-IDEA-002");

  const empty = await call("POST", "/api/v1/admin/ideas/analyze", {});
  assert.equal(empty.status, 400);
  assert.equal(empty.json.errorCode, "ERR-IDEA-001");
});
