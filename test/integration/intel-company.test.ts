/**
 * 公司情报中心集成测试（v2.29）：情报与项目无关——情况采集（公开来源→公司情报库）、
 * 采集设置、增量去重、失败留痕、汇总入公司记忆（market_intel 提议）、总览与 HTTP 契约。
 * 采集用本地假源（HTML 列表页 / gov 风格 JSON / 故障源），不依赖外网。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "../../src/db/pool.ts";
import { makePool, resetDb } from "../helpers.ts";
import { AuditService } from "../../src/audit/audit.ts";
import { CompanyIntelService } from "../../src/domains/intel/company.ts";

let pool: Pool;
let audit: AuditService;
let apiServer: Server;
let fakeServer: Server;
let base = "";
let fakeBase = "";

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

/** 本地假数据源：HTML 列表页、gov 风格 JSON 索引、故障页。 */
before(async () => {
  fakeServer = createServer((req, res) => {
    if (req.url === "/list/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<html><body><ul>
        <li><a href="./202611/t20261120_100001.html">2026年10月份规模以上工业增加值增长4.8%</a></li>
        <li><a href="./202611/t20261119_100000.html" title="全国固定资产投资基本情况">全国固定资产投资基本情况</a></li>
        <li><a href="/">首页</a></li>
        <li><a href="/about.js">脚本</a></li>
      </ul></body></html>`);
    } else if (req.url === "/policy/ZUIXINZHENGCE.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([
        { TITLE: "市场监管总局发布新的团体标准管理办法", URL: "https://www.gov.cn/zhengce/202611/content_9000001.htm", DOCRELPUBTIME: "2026-11-18" },
        { TITLE: "关于进一步促进民营经济发展的意见", URL: "https://www.gov.cn/zhengce/202611/content_9000002.htm", DOCRELPUBTIME: "2026-11-17" },
      ]));
    } else if (req.url === "/policy/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<html><body><script>url: "./ZUIXINZHENGCE.json"</script></body></html>');
    } else if (req.url === "/broken/") {
      res.writeHead(503); res.end("down");
    } else {
      res.writeHead(404); res.end("no");
    }
  });
  await new Promise<void>((resolve) => fakeServer.listen(0, "127.0.0.1", resolve));
  fakeBase = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`;

  pool = makePool();
  audit = new AuditService(pool, { schemaVersion: "1" });
  const archiveDir = await mkdtemp(join(tmpdir(), "opc-intel-company-"));
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
  await new Promise<void>((resolve) => apiServer.close(() => resolve()));
  await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
  await pool.end();
});

beforeEach(async () => {
  await resetDb(pool);
  await pool.query(
    `INSERT INTO biz.intel_project_scope (project_id, name, timezone, brief_time, lookback_hours, max_items, push_channels, status, config_version)
     VALUES (0, '公司情报中心', 'Asia/Shanghai', '08:30', 24, 50, '[{"channel":"inapp","target":"boss"}]'::jsonb, 'active', 'v1')`,
  );
});

function service(): CompanyIntelService {
  return new CompanyIntelService(pool, audit);
}

async function seedSource(name: string, url: string, kind: string): Promise<number> {
  const inserted = await pool.query(
    `INSERT INTO biz.source (name, source_type, url, credibility, copyright_status, collect_interval_minutes, rate_limit_per_hour, timeout_ms, enabled, status, checkpoint)
     VALUES ($1, 'web', $2, 0.9, 'public', 360, 12, 15000, true, 'active', jsonb_build_object('kind', $3::text)) RETURNING id`,
    [name, url, kind],
  );
  return Number(inserted.rows[0].id);
}

test("TC-ICO-001 采集设置：默认值、部分更新与校验", async () => {
  const def = await call("GET", "/api/v1/admin/intel/company/settings");
  assert.equal(def.json.code, 0);
  assert.equal(def.json.data.enabled, true);
  assert.equal(def.json.data.maxItemsPerSource, 20);
  assert.equal(def.json.data.memoryDailyCap, 10);
  const updated = await call("PUT", "/api/v1/admin/intel/company/settings", { maxItemsPerSource: 5, memoryDailyCap: 3 });
  assert.equal(updated.json.data.maxItemsPerSource, 5);
  assert.equal(updated.json.data.memoryDailyCap, 3);
  assert.equal(updated.json.data.enabled, true, "未提交字段保持原值");
  const clamped = await call("PUT", "/api/v1/admin/intel/company/settings", { maxItemsPerSource: 9999 });
  assert.equal(clamped.json.data.maxItemsPerSource, 100);
  const bad = await call("PUT", "/api/v1/admin/intel/company/settings", { maxItemsPerSource: "abc" });
  assert.equal(bad.json.code, 400);
  assert.equal(bad.json.errorCode, "ERR-INT-001");
});

test("TC-ICO-002 情况采集：公司级入库、增量去重、失败留痕", async () => {
  const listId = await seedSource("统计局·最新发布", `${fakeBase}/list/`, "stats_news");
  const govId = await seedSource("政府网·最新政策", `${fakeBase}/policy/`, "gov_policy");
  const brokenId = await seedSource("故障源", `${fakeBase}/broken/`, "web_list");
  const first = await service().collectAll(new Date(), { force: true });
  assert.equal(first.enabled, true);
  assert.equal(first.due, 3);
  assert.equal(first.inserted, 4, "列表页 2 条 + JSON 索引 2 条");
  assert.equal(first.failed, 1);
  const rows = await pool.query("SELECT project_id, source_id, title, url FROM biz.intel_item WHERE project_id IS NULL ORDER BY id");
  assert.equal(rows.rows.length, 4, "公司级条目 project_id 必须为 NULL");
  assert.ok(rows.rows.some((r) => String(r.title).includes("工业增加值")));
  assert.ok(rows.rows.some((r) => String(r.title).includes("团体标准")));
  const seen = await pool.query<{ checkpoint: { seen?: string[] } }>("SELECT checkpoint FROM biz.source WHERE id = $1", [listId]);
  assert.ok(Array.isArray(seen.rows[0].checkpoint?.seen) && (seen.rows[0].checkpoint?.seen as string[]).length === 2, "增量游标记录已见链接");
  const broken = await pool.query<{ consecutive_failures: number; last_error: string | null }>("SELECT consecutive_failures, last_error FROM biz.source WHERE id = $1", [brokenId]);
  assert.equal(broken.rows[0].consecutive_failures, 1);
  assert.match(String(broken.rows[0].last_error), /503/);
  // 再采一次：增量游标在采集器层过滤，无新条目
  const second = await service().collectAll(new Date(), { force: true });
  assert.equal(second.inserted, 0);
  assert.equal(second.collected, 0);
  void govId;
});

test("TC-ICO-003 急停开关：enabled=false 时采集空转", async () => {
  await seedSource("统计局·最新发布", `${fakeBase}/list/`, "stats_news");
  await service().updateSettings({ enabled: false });
  const result = await service().collectAll(new Date(), { force: true });
  assert.equal(result.enabled, false);
  assert.equal(result.due, 0);
  const count = await pool.query("SELECT count(*)::int AS n FROM biz.intel_item");
  assert.equal(count.rows[0].n, 0);
});

test("TC-ICO-004 汇总入公司记忆：market_intel 提议生成、条目转 briefed、重复跳过", async () => {
  await seedSource("统计局·最新发布", `${fakeBase}/list/`, "stats_news");
  await service().collectAll(new Date(), { force: true });
  const digest = await service().memoryDigest(new Date());
  assert.equal(digest.proposals, 1);
  assert.equal(digest.items, 2);
  const proposal = await pool.query<{ id: number; memory_type: string; title: string; content: string; source_refs: string[]; status: string }>(
    "SELECT * FROM stat.web_memory_proposal WHERE memory_type = 'market_intel'",
  );
  assert.equal(proposal.rows.length, 1);
  assert.match(proposal.rows[0].title, /市场情报摘要 · 统计局·最新发布/);
  assert.match(proposal.rows[0].content, /工业增加值/);
  assert.ok(proposal.rows[0].source_refs.length === 2, "记忆提议必须带来源引用");
  const briefed = await pool.query("SELECT count(*)::int AS n FROM biz.intel_item WHERE status = 'briefed'");
  assert.equal(briefed.rows[0].n, 2);
  // 同日重跑不重复出提议
  const again = await service().memoryDigest(new Date());
  assert.equal(again.proposals, 0);
  // 老板确认 → 落公司记忆卡（scope=market_intel）
  const { MemoryService } = await import("../../src/web/services.ts");
  const confirmed = await new MemoryService(pool, audit).confirm(Number(proposal.rows[0].id));
  assert.equal(confirmed.created, true);
  const card = await pool.query("SELECT scope FROM stat.web_memory_card WHERE scope = 'market_intel'");
  assert.equal(card.rows.length, 1);
});

test("TC-ICO-005 HTTP 契约：summary/items/collect/memory 与哨兵情报空间", async () => {
  await seedSource("统计局·最新发布", `${fakeBase}/list/`, "stats_news");
  const collected = await call("POST", "/api/v1/admin/intel/company/collect");
  assert.equal(collected.json.code, 0);
  assert.equal(collected.json.data.inserted, 2);
  const items = await call("GET", "/api/v1/admin/intel/company/items?limit=10");
  assert.equal(items.json.data.items.length, 2);
  assert.ok(items.json.data.items[0].source_name === "统计局·最新发布");
  const summary = await call("GET", "/api/v1/admin/intel/company/summary");
  assert.equal(summary.json.data.sourcesActive, 1);
  assert.equal(summary.json.data.itemsTotal, 2);
  const memory = await call("POST", "/api/v1/admin/intel/company/memory");
  assert.equal(memory.json.data.proposals, 1);
  // 公司情报空间哨兵行（project_id=0）存在且 active
  const scope = await pool.query("SELECT name, status FROM biz.intel_project_scope WHERE project_id = 0");
  assert.equal(scope.rows.length, 1);
  assert.equal(scope.rows[0].status, "active");
});
