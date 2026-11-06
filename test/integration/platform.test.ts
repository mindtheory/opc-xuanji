/**
 * 平台能力集成测试（真实 PostgreSQL localhost / opc_test）：视图授权、一次性令牌、冲突冻结。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "../../src/db/pool.ts";
import { makePool, resetDb, seedEmployee } from "../helpers.ts";
import { AuditService } from "../../src/audit/audit.ts";
import { ViewService } from "../../src/platform/views.ts";
import { TokenService } from "../../src/platform/token.ts";
import { ConflictService } from "../../src/platform/conflict.ts";
import { OpcError } from "../../src/platform/errors.ts";

let pool: Pool;
let audit: AuditService;

before(() => {
  pool = makePool();
  audit = new AuditService(pool, { schemaVersion: "1" });
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDb(pool);
});

test("视图授权：已授权视图返回聚合行，未授权视图拒绝并写审计", async () => {
  await seedEmployee(pool, "opc_finance", { views: ["view_ar_ap"] });
  await pool.query(
    `INSERT INTO biz.ar_ap (counterparty, amount, due, status) VALUES
      ('甲公司', 1200.00, '2026-11-20', 'open'),
      ('甲公司', 800.00, '2026-12-01', 'open'),
      ('乙公司', 500.00, '2026-11-10', 'closed')`,
  );

  const views = new ViewService(pool, audit);
  const result = await views.query({ pluginId: "opc_finance", viewId: "view_ar_ap", filter: { status: "open" }, limit: 50 });
  assert.equal(result.viewId, "view_ar_ap");
  assert.equal(result.rows.length, 1);
  assert.equal(Number(result.rows[0].amount_total), 2000);

  await assert.rejects(
    () => views.query({ pluginId: "opc_finance", viewId: "view_contract_index" }),
    (error: unknown) => error instanceof OpcError && error.errorCode === "ERR-AUTHZ-001",
  );

  const audits = await audit.list({ action: "view.query", limit: 10 });
  assert.equal(audits.rows.length, 2);
  assert.ok(audits.rows.some((row) => row.result === "denied"));
});

test("一次性令牌：单次消费、范围外字段拒绝、过期拒绝", async () => {
  const customer = await pool.query<{ id: string }>(
    "INSERT INTO biz.customer (name, sensitivity_level) VALUES ('丙公司', 'sensitive') RETURNING id",
  );
  const customerId = customer.rows[0].id;
  await pool.query(
    `INSERT INTO biz.customer_sensitive (customer_id, field, value, level) VALUES
      ($1, 'family', '有两名学龄子女', 'sensitive'),
      ($1, 'health', '无重大疾病', 'sensitive')`,
    [customerId],
  );

  const tokens = new TokenService(pool, audit);
  const issued = await tokens.issue({
    taskId: "task-1",
    pluginId: "opc_admin",
    viewId: "view_customer_base",
    fields: ["family"],
    customerId: Number(customerId),
    ttlSeconds: 60,
  });
  assert.ok(issued.tokenId.length >= 16);
  assert.ok(issued.expiresAt.getTime() > Date.now());

  const consumed = await tokens.consume(issued.tokenId, { taskId: "task-1" });
  assert.deepEqual(consumed.fields, { family: "有两名学龄子女" });

  await assert.rejects(
    () => tokens.consume(issued.tokenId, { taskId: "task-1" }),
    (error: unknown) => error instanceof OpcError && error.errorCode === "ERR-TOKEN-001",
  );

  const expired = await tokens.issue({
    taskId: "task-2",
    pluginId: "opc_admin",
    viewId: "view_customer_base",
    fields: ["health"],
    customerId: Number(customerId),
    ttlSeconds: 60,
  });
  await pool.query("UPDATE ref.token SET expires_at = now() - interval '1 minute' WHERE token_code = $1", [expired.tokenId]);
  await assert.rejects(
    () => tokens.consume(expired.tokenId, { taskId: "task-2" }),
    (error: unknown) => error instanceof OpcError && error.errorCode === "ERR-TOKEN-001",
  );

  const audits = await audit.list({ action: "token.consume", limit: 10 });
  assert.equal(audits.rows.length, 3, "一次成功 + 重复消费拒绝 + 过期拒绝");
  assert.equal(audits.rows.filter((row) => row.result === "ok").length, 1);
  const payload = JSON.stringify(audits.rows);
  assert.equal(payload.includes("学龄子女"), false, "审计不得落敏感字段值");
});

test("冲突冻结：冻结单元不入有效汇总，但总额含冻结并可裁决解除", async () => {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO biz.ledger (entry_date, amount, direction, category, entity, note)
     VALUES ('2026-11-01', 3000.00, 'out', 'supplier', 'company', '甲供方货款') RETURNING id`,
  );
  const ledgerId = Number(inserted.rows[0].id);

  const conflicts = new ConflictService(pool, audit);
  const opened = await conflicts.open({
    conflictType: "cost",
    frozenUnitType: "ledger",
    frozenUnitId: ledgerId,
    parties: [{ plugin: "opc_finance", view: "归项目A" }, { plugin: "opc_project", view: "归项目B" }],
    diffFields: ["project_id"],
    note: "同一笔货款两方各归一个项目",
  });
  assert.equal(opened.frozen, true);

  const summary = await conflicts.summaryIncludingFrozen("ledger");
  assert.equal(Number(summary.total_including_frozen), 3000);
  assert.equal(summary.frozen_items.length, 1);
  assert.equal(Number(summary.effective_total), 0);

  const resolved = await conflicts.resolve(opened.conflictId, { choice: "A", note: "归属项目A" });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.frozen, false);

  const after = await conflicts.summaryIncludingFrozen("ledger");
  assert.equal(Number(after.effective_total), 3000);
  assert.equal(after.frozen_items.length, 0);
});
