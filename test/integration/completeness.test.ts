/**
 * 信息完善度巡检集成测试（v2.30）：设置、完善度明细、提问卡生成与去重、限量、
 * 老板回答回填公司基础信息、HTTP 契约。测试环境禁用 AI 通道（确定性）。
 */
process.env.OPC_AI_DISABLED = "1";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "../../src/db/pool.ts";
import { makePool, resetDb } from "../helpers.ts";
import { AuditService } from "../../src/audit/audit.ts";
import { CompletenessService } from "../../src/domains/admin/completeness.ts";

let pool: Pool;
let audit: AuditService;
let apiServer: import("node:http").Server;
let base = "";

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

function service(): CompletenessService {
  return new CompletenessService(pool, audit);
}

before(async () => {
  pool = makePool();
  audit = new AuditService(pool, { schemaVersion: "1" });
  const archiveDir = await mkdtemp(join(tmpdir(), "opc-completeness-"));
  const ctx = {
    pool, audit,
    views: {}, tokens: {}, conflicts: {}, registry: {}, runner: {}, verifier: {}, scheduler: {},
    web: {}, employees: {}, software: {},
    archiveDir, version: "0.1.0",
  } as never;
  const { startApiServer } = await import("../../src/api/http.ts");
  apiServer = await startApiServer(ctx, 0, "127.0.0.1");
  base = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;
});

after(async () => {
  apiServer.close();
  await pool.end();
});

beforeEach(async () => {
  await resetDb(pool);
});

test("TC-CMP-001 巡检设置：默认值、部分更新、非法参数 400", async () => {
  const defaults = await service().getSettings();
  assert.deepEqual(defaults, { enabled: true, autoFill: true, maxQuestionsPerRun: 5 });
  const updated = await service().updateSettings({ autoFill: false, maxQuestionsPerRun: 99 });
  assert.deepEqual(updated, { enabled: true, autoFill: false, maxQuestionsPerRun: 20 }, "越界收敛到边界");
  await assert.rejects(() => service().updateSettings({ enabled: "yes" as never }), (err: any) => err.errorCode === "ERR-WEB-001" && err.status === 400);
});

test("TC-CMP-002 完善度明细：缺项识别与得分", async () => {
  await pool.query("INSERT INTO biz.company_profile (name, entity_type, industry) VALUES ('测试公司', '服务型', '软件开发')");
  const result = await service().checklist();
  assert.ok(result.score > 0 && result.score < 100, `得分应在 (0,100)：${result.score}`);
  const baseDomain = result.domains.find((d) => d.domain === "公司基础信息");
  assert.ok(baseDomain !== undefined);
  const industry = baseDomain.items.find((x) => x.key === "industry");
  assert.ok(industry !== undefined);
  assert.equal(industry.filled, true);
  const legal = baseDomain.items.find((x) => x.key === "legalPerson");
  assert.ok(legal !== undefined);
  assert.equal(legal.filled, false);
});

test("TC-CMP-003 巡检：生成提问卡（公司哨兵）、去重、限量", async () => {
  await pool.query("INSERT INTO biz.company_profile (name, entity_type) VALUES ('测试公司', '服务型')");
  await service().updateSettings({ maxQuestionsPerRun: 3 });
  const first = await service().inspect(new Date());
  assert.equal(first.questions, 3, "每轮最多 3 问");
  assert.equal(first.autoFilled, 0, "AI 通道禁用时不自动补全");
  const rows = await pool.query(
    `SELECT payload FROM stat.project_decision WHERE project_id = 0 AND status = 'pending' AND payload->>'kind' = 'completeness'`,
  );
  assert.equal(rows.rows.length, 3);
  // 再巡检：同 fieldKey 已有 pending 卡不重复，改问下一批缺口
  const second = await service().inspect(new Date());
  assert.equal(second.questions, 3);
  const rows2 = await pool.query(
    `SELECT payload FROM stat.project_decision WHERE project_id = 0 AND status = 'pending' AND payload->>'kind' = 'completeness'`,
  );
  assert.equal(rows2.rows.length, 6);
  const snapshot = await pool.query<{ value: Record<string, unknown> }>("SELECT value FROM ref.shared_setting WHERE key = 'completeness.last_run'");
  assert.ok(snapshot.rows.length === 1 && Number(snapshot.rows[0].value.score) >= 0);
});

test("TC-CMP-004 老板回答：回填公司基础信息并关闭提问", async () => {
  await pool.query("INSERT INTO biz.company_profile (name, entity_type) VALUES ('测试公司', '服务型')");
  await service().inspect(new Date());
  const q = await pool.query<{ id: number; payload: { fieldKey: string } }>(
    `SELECT id, payload FROM stat.project_decision WHERE project_id = 0 AND status = 'pending' AND payload->>'fieldKey' = 'industry' LIMIT 1`,
  );
  assert.equal(q.rows.length, 1, "行业应有提问卡");
  const result = await service().answer(Number(q.rows[0].id), { answer: "软件开发与信息技术服务" });
  assert.equal(result.appliedTo, "industry");
  const profile = await pool.query<{ industry: string }>("SELECT industry FROM biz.company_profile ORDER BY id LIMIT 1");
  assert.equal(profile.rows[0].industry, "软件开发与信息技术服务");
  const decided = await pool.query<{ status: string; decision: string }>("SELECT status, decision FROM stat.project_decision WHERE id = $1", [q.rows[0].id]);
  assert.equal(decided.rows[0].status, "decided");
  // 空回答且非稍后 → 400
  await assert.rejects(() => service().answer(999999, { answer: "" }), (err: any) => err.errorCode === "ERR-WEB-001");
});

test("TC-CMP-005 HTTP 契约：overview/settings/inspect/answer", async () => {
  await pool.query("INSERT INTO biz.company_profile (name, entity_type) VALUES ('测试公司', '服务型')");
  const overview = await call("GET", "/api/v1/admin/completeness/overview");
  assert.equal(overview.status, 200);
  assert.equal(overview.json.data.settings.enabled, true);
  assert.ok(Array.isArray(overview.json.data.domains));
  const settings = await call("PUT", "/api/v1/admin/completeness/settings", { maxQuestionsPerRun: 2 });
  assert.equal(settings.json.data.maxQuestionsPerRun, 2);
  const inspect = await call("POST", "/api/v1/admin/completeness/inspect");
  assert.equal(inspect.json.data.questions, 2);
  const badAnswer = await call("POST", "/api/v1/admin/completeness/questions/999999/answer", {});
  assert.equal(badAnswer.status, 400);
  const q = await pool.query<{ id: number }>(
    `SELECT id FROM stat.project_decision WHERE project_id = 0 AND status = 'pending' AND payload->>'fieldKey' = 'website' LIMIT 1`,
  );
  if (q.rows.length > 0) {
    const answer = await call("POST", `/api/v1/admin/completeness/questions/${q.rows[0].id}/answer`, { later: true });
    assert.equal(answer.json.data.later, true);
  }
});
