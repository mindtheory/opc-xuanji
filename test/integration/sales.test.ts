/**
 * 虚拟销售集成测试（v2.27）：配置与风控护栏 → 雷达线索去重与拍板转商品 → 上架确认 →
 * 订单幂等入库 → 自动生产交付物（AI 关闭走规则兜底）→ 确认发货 → 收款记账；HTTP 契约冒烟。
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
import { SalesService } from "../../src/domains/sales/service.ts";

let pool: Pool;
let audit: AuditService;
let server: Server;
let base = "";
let deliverableRoot = "";

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

before(async () => {
  process.env.OPC_AI_DISABLED = "1"; // 测试走规则兜底路径，不依赖外部模型
  deliverableRoot = await mkdtemp(join(tmpdir(), "opc-sales-"));
  pool = makePool();
  audit = new AuditService(pool, { schemaVersion: "1" });
  const archiveDir = await mkdtemp(join(tmpdir(), "opc-sales-audit-"));
  const ctx = {
    pool,
    audit,
    views: { async list() { return []; } },
    tokens: {}, conflicts: {}, registry: {}, runner: {}, verifier: {}, scheduler: {},
    web: {}, employees: {}, software: {},
    archiveDir,
    version: "0.1.0",
  } as never;
  const { startApiServer } = await import("../../src/api/http.ts");
  server = await startApiServer(ctx, 0, "127.0.0.1");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await rm(deliverableRoot, { recursive: true, force: true });
});

function sales(): SalesService {
  return new SalesService(pool, audit, { deliverableRoot });
}

beforeEach(async () => {
  await resetDb(pool);
});

test("TC-SALES-001 配置：默认急停；更新校验价格区间与品类；风控额度超限自动急停", async () => {
  const service = sales();
  const initial = await service.getConfig();
  assert.equal(initial.enabled, false, "默认必须急停");
  assert.ok(Array.isArray(initial.categories) && initial.categories.length >= 1);

  await assert.rejects(() => service.updateConfig({ priceFloor: 100, priceCap: 50 }), /价格区间/);
  await assert.rejects(() => service.updateConfig({ categories: ["不存在的品类"] }), /品类/);

  const updated = await service.updateConfig({ enabled: true, dailyActionCap: 2 });
  assert.equal(updated.enabled, true);
  assert.equal(await service.takeAction(), true);
  assert.equal(await service.takeAction(), true);
  assert.equal(await service.takeAction(), false, "超过每日动作上限必须拒绝");
  const after = await service.getConfig();
  assert.equal(after.enabled, false, "超限必须自动急停");
  assert.match(String(after.pauseReason), /动作上限/);
});

test("TC-SALES-002 线索：去重入库 → 拍板转商品（素材兜底）→ 淘汰；重复拍板拒绝", async () => {
  const service = sales();
  await service.updateConfig({ enabled: true });
  const runId = await service.startRun("radar");
  const added = await service.ingestLeads([
    { category: "copywriting", title: "短视频带货文案代写", demandNote: "样本 6 个在售", aiScore: 0.8 },
    { category: "copywriting", title: "短视频带货文案代写", demandNote: "重复", aiScore: 0.7 },
    { category: "unknown_cat", title: "非法品类应忽略", aiScore: 0.9 },
  ], runId);
  assert.equal(added, 1, "按标题去重且忽略非法品类");
  await service.finishRun(runId, "ok", { newLeads: added });

  const leads = await service.listLeads("new");
  assert.equal(leads.length, 1);
  const product = await service.decideLead(Number(leads[0].id), "promote", 39, "老板");
  assert.equal(product.status, "ready");
  assert.equal(Number(product.price), 39);
  assert.equal((product.materials as Record<string, unknown>).source, "rule", "AI 关闭走规则兜底");
  assert.ok(String((product.materials as Record<string, unknown>).detail).includes("服务范围"));

  await assert.rejects(() => service.decideLead(Number(leads[0].id), "promote", null, "老板"), /已处理/);
  const runRows = await service.listRuns();
  assert.equal(runRows[0].kind, "radar");
  assert.equal((runRows[0].summary as Record<string, unknown>).newLeads, 1);
});

test("TC-SALES-003 商品：确认上架 → 人工发布回写 listed；暂停", async () => {
  const service = sales();
  const runId = await service.startRun("radar");
  await service.ingestLeads([{ category: "fiction", title: "短篇小说定制", aiScore: 0.7 }], runId);
  const leads = await service.listLeads("new");
  const product = await service.decideLead(Number(leads[0].id), "promote", null, "老板");
  const productId = Number(product.id);
  await assert.rejects(() => service.markListedManual(productId, "老板"), /ready|不可/, "未确认不能直接标已上架");
  const listing = await service.confirmListing(productId, "老板");
  assert.equal(listing.status, "listing");
  const listed = await service.markListedManual(productId, "老板");
  assert.equal(listed.status, "listed");
  assert.notEqual(listed.listedAt, null);
  const paused = await service.pauseProduct(productId, "价格太低", "老板");
  assert.equal(paused.status, "paused");
});

test("TC-SALES-004 订单：幂等入库 → 自动生产交付物落盘 → 确认发货 → 收款记账", async () => {
  const service = sales();
  const runId = await service.startRun("radar");
  await service.ingestLeads([{ category: "copywriting", title: "朋友圈文案代写", aiScore: 0.6 }], runId);
  const leads = await service.listLeads("new");
  const product = await service.decideLead(Number(leads[0].id), "promote", 19, "老板");

  const order = await service.ingestOrder({ productId: Number(product.id), platformOrderId: "GF20261121001", buyerNick: "买家甲", title: "朋友圈文案 10 条", demandText: "要卖水果的，幽默风", amount: 19 });
  assert.equal(order.status, "new");
  const dup = await service.ingestOrder({ platformOrderId: "GF20261121001", title: "重复单" });
  assert.equal(dup.id, order.id, "平台订单号幂等");

  await assert.rejects(() => service.confirmShip(Number(order.id), "老板"), /未生成/, "无交付物不能发货");
  const generated = await service.generateDeliverable(Number(order.id));
  assert.equal(generated.status, "generated");
  const file = String(generated.deliverablePath);
  const content = await readFile(file, "utf8");
  assert.ok(content.includes("朋友圈文案代写") || content.includes("文案"), "交付物含品类内容");
  assert.ok(content.includes("修改说明"));

  const shipped = await service.confirmShip(Number(order.id), "老板");
  assert.equal(shipped.status, "shipping");
  const settled = await service.markSettled(Number(order.id), true);
  assert.equal(settled.status, "settled");
  const orders = await service.listOrders("settled");
  assert.equal(orders.length, 1);
  assert.equal(Number(orders[0].amount), 19);
});

test("TC-SALES-005 HTTP 契约：config 读写、线索拍板、商品确认、订单列表、运行记录", async () => {
  const config = await call("GET", "/api/v1/admin/sales/config");
  assert.equal(config.status, 200);
  assert.equal(config.json.data.enabled, false);

  const updated = await call("PUT", "/api/v1/admin/sales/config", { enabled: true, dailyActionCap: 50 });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.enabled, true);

  const bad = await call("PUT", "/api/v1/admin/sales/config", { priceFloor: -1 });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.errorCode, "ERR-SALES-001");

  const service = sales();
  const runId = await service.startRun("radar");
  await service.ingestLeads([{ category: "planning", title: "线下快闪活动策划", aiScore: 0.75 }], runId);
  const leads = await service.listLeads("new");
  const decided = await call("POST", `/api/v1/admin/sales/leads/${leads[0].id}/decide`, { action: "promote", price: 199, decidedBy: "老板" });
  assert.equal(decided.status, 200);
  assert.equal(decided.json.data.status, "ready");
  const productId = Number(decided.json.data.id);

  const confirmed = await call("POST", `/api/v1/admin/sales/products/${productId}/confirm-listing`, { decidedBy: "老板" });
  assert.equal(confirmed.json.data.status, "listing");

  const products = await call("GET", "/api/v1/admin/sales/products?status=listing");
  assert.equal(products.json.data.length, 1);

  const orders = await call("GET", "/api/v1/admin/sales/orders");
  assert.equal(orders.status, 200);
  const runs = await call("GET", "/api/v1/admin/sales/runs");
  assert.equal(runs.json.data[0].kind, "radar");
});
