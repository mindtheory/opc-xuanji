/**
 * 审计链集成测试：统一写入口、prev_hash 链接、JSONL 导出 + SHA-256、链头持久化。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "../../src/db/pool.ts";
import { makePool, resetDb } from "../helpers.ts";
import { AuditService } from "../../src/audit/audit.ts";

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

test("连续写入形成 prev_hash 链，verifyChain 校验通过", async () => {
  const first = await audit.record({ actor: "opc_hub", action: "dispatch", result: "ok", payload: { task: "t1" } });
  const second = await audit.record({ actor: "opc_finance", action: "tool.call", result: "ok", objectType: "ledger" });
  const third = await audit.record({ actor: "boss", action: "conflict.resolve", result: "ok" });

  assert.ok(first.hash.length === 64);
  assert.equal(second.prevHash, first.hash);
  assert.equal(third.prevHash, second.hash);

  const chain = await audit.verifyChain();
  assert.equal(chain.ok, true);
  assert.equal(chain.checked, 3);
});

test("导出 JSONL：SHA-256 与文件一致，链头持久化，可续链", async () => {
  await audit.record({ actor: "opc_hub", action: "dispatch", result: "ok", payload: { n: 1 } });
  await audit.record({ actor: "opc_hub", action: "dispatch", result: "ok", payload: { n: 2 } });

  const outDir = await mkdtemp(join(tmpdir(), "opc-audit-"));
  const exported = await audit.export({ outDir });
  assert.equal(exported.rowCount, 2);
  const content = await readFile(exported.filePath, "utf8");
  const lines = content.trim().split("\n");
  assert.equal(lines.length, 2);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.schema_version, "1");
  assert.equal(parsed.action, "dispatch");
  assert.equal(createHash("sha256").update(content, "utf8").digest("hex"), exported.sha256);

  const head = await pool.query<{ last_hash: string; last_export_id: number | null }>(
    "SELECT last_hash, last_export_id FROM audit.audit_chain_head LIMIT 1",
  );
  assert.equal(head.rows.length, 1);
  assert.ok(head.rows[0].last_export_id !== null, "导出后链头必须记录 last_export_id");
  assert.equal(head.rows[0].last_hash?.length, 64);

  await audit.record({ actor: "opc_hub", action: "dispatch", result: "ok", payload: { n: 3 } });
  const second = await audit.export({ outDir });
  assert.equal(second.rowCount, 1);
  assert.equal(second.prevHash, exported.sha256);
});

test("审计查询按动作与实例过滤，默认按时间倒序", async () => {
  await audit.record({ actor: "opc_hub", action: "dispatch", result: "ok", workflowInstanceId: 7 });
  await audit.record({ actor: "opc_hub", action: "view.query", result: "ok" });
  await audit.record({ actor: "opc_hub", action: "dispatch", result: "denied", workflowInstanceId: 7 });

  const byAction = await audit.list({ action: "dispatch", limit: 10 });
  assert.equal(byAction.rows.length, 2);
  assert.equal(byAction.rows[0].result, "denied");

  const byInstance = await audit.list({ instanceId: 7, limit: 10 });
  assert.equal(byInstance.rows.length, 2);
});
