/**
 * 网页表现层集成测试（真实 PG + 真实 HTTP）：归置、会话授权、记忆桥、驾驶舱、雷达。
 * 只在 OPC_TEST_DSN 指向的测试库执行；缺失 DSN 时与其他集成测试一样无法运行。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../../src/platform/config.ts";
import { createHub, type Hub } from "../../src/plugin/index.ts";
import { startApiServer } from "../../src/api/http.ts";
import { resetDb } from "../helpers.ts";

let hub: Hub;
let server: Server;
let base = "";

const config = loadConfig();

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

before(async () => {
  hub = createHub({ dsn: config.testDsn });
  server = await startApiServer(hub.api, 0);
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await hub.pool.end();
});

beforeEach(async () => {
  await resetDb(hub.pool);
  await hub.scheduler.seedDefaults();
});

test("manifest 与驾驶舱：返回插件栏信息、as_of 与冻结脚注", async () => {
  const manifest = await call("GET", "/api/v1/web/manifest");
  assert.equal(manifest.status, 200);
  assert.equal(manifest.json.data.pluginId, "opc_web");
  assert.equal(manifest.json.data.title, "OPC公司管理");
  assert.deepEqual(manifest.json.data.tabs, ["dashboard", "domains", "briefs", "tasks", "settings"]);

  await hub.pool.query("INSERT INTO biz.ledger (entry_date, amount, direction, category, entity) VALUES (current_date, 1000, 'in', 'x', 'company')");
  await hub.pool.query("INSERT INTO biz.ledger (entry_date, amount, direction, category, entity, conflict_frozen) VALUES (current_date, 300, 'out', 'x', 'company', true)");
  await hub.pool.query(
    "INSERT INTO biz.conflict_queue (conflict_type, frozen_unit_type, frozen_unit_id, parties, status) VALUES ('cost','ledger',1,'[]'::jsonb,'open')",
  );

  const dashboard = await call("GET", "/api/v1/web/dashboard?range=30d");
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.json.data.metrics.length >= 10);
  assert.equal(dashboard.json.data.frozen.count, 1);
  assert.ok(dashboard.json.data.warnings.some((item: string) => item.includes("待裁决冲突")));
  assert.ok(typeof dashboard.json.data.asOf === "string");
});

test("归置：发票进入确认卡、幂等命中、收件箱可查、确认后落状态", async () => {
  const text = "收到供应商发票，价税合计 1200 元，客户：甲公司，发票号：INV20261105001";
  const first = await call("POST", "/api/v1/web/ingest", {
    sourceType: "session_message",
    sourceRef: "sess-1:msg-1",
    text,
    idempotencyKey: "ing-1",
  });
  assert.equal(first.status, 201);
  assert.equal(first.json.data.item.domain, "finance");
  assert.equal(first.json.data.item.decision.action, "confirm");
  assert.equal(first.json.data.item.status, "pending");
  assert.equal(first.json.data.item.extracted.amount, 1200);

  const again = await call("POST", "/api/v1/web/ingest", {
    sourceType: "session_message",
    sourceRef: "sess-1:msg-1",
    text,
    idempotencyKey: "ing-1",
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.data.duplicate, true);

  const inbox = await call("GET", "/api/v1/web/inbox?status=pending");
  assert.equal(inbox.status, 200);
  assert.equal(inbox.json.data.total, 1);

  const confirmed = await call("POST", `/api/v1/web/ingest/${first.json.data.item.id}/confirm`, {
    action: "confirm",
    editedExtracted: { ...first.json.data.item.extracted, amount: 1250 },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.json.data.status, "confirmed");
  assert.equal(confirmed.json.data.extracted.amount, 1250);

  const audits = await hub.audit.list({ action: "web.ingest.confirm", limit: 5 });
  assert.equal(audits.rows.length, 1);
});

test("会话桥：未授权拒绝，授权后可读最近消息，撤回后立即失效", async () => {
  await hub.pool.query(
    `INSERT INTO stat.web_session_message (session_id, message_id, role, content) VALUES
      ('sess-1','m1','boss','把上周的发票整理一下'),
      ('sess-1','m2','hub','好的，请上传发票')`,
  );

  const denied = await call("GET", "/api/v1/web/sessions/sess-1/context");
  assert.equal(denied.status, 403);
  assert.equal(denied.json.errorCode, "ERR-WEB-001");

  const granted = await call("PUT", "/api/v1/web/sessions/sess-1/grant", { purpose: "整理发票", ttlSeconds: 3600 });
  assert.equal(granted.status, 201);
  assert.equal(granted.json.data.sessionId, "sess-1");

  const context = await call("GET", "/api/v1/web/sessions/sess-1/context");
  assert.equal(context.status, 200);
  assert.equal(context.json.data.messages.length, 2);
  assert.equal(context.json.data.messages[0].messageId, "m1");

  const revoked = await call("DELETE", "/api/v1/web/sessions/sess-1/grant");
  assert.equal(revoked.status, 200);
  const afterRevoke = await call("GET", "/api/v1/web/sessions/sess-1/context");
  assert.equal(afterRevoke.status, 403);
});

test("记忆桥：提议不直接落库，确认后落库，敏感记忆只返回标记", async () => {
  const proposed = await call("POST", "/api/v1/web/memory/propose", {
    type: "experience",
    title: "发票归置经验",
    content: "发票先核对金额与发票号，再登记应付",
    sourceRefs: ["sess-1:m1"],
    confidence: 0.8,
  });
  assert.equal(proposed.status, 201);
  assert.equal(proposed.json.data.status, "pending");

  const beforeConfirm = await call("POST", "/api/v1/web/memory/search", {
    query: "发票",
    scopes: ["experience"],
    purpose: "验证未确认不返回",
  });
  assert.equal(beforeConfirm.status, 200);
  assert.equal(beforeConfirm.json.data.total, 0);

  const confirmed = await call("POST", `/api/v1/web/memory/proposals/${proposed.json.data.proposalId}/confirm`, {});
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.json.data.created, true);

  const afterConfirm = await call("POST", "/api/v1/web/memory/search", {
    query: "发票",
    scopes: ["experience"],
    purpose: "验证确认后可检索",
  });
  assert.equal(afterConfirm.json.data.total, 1);

  await hub.pool.query(
    `INSERT INTO stat.web_memory_card (scope, title, content, source_refs, confidence, content_hash, sensitive)
     VALUES ('customer','客户家庭信息','有两个孩子','[]'::jsonb,0.9,'sensitive-hash',true)`,
  );
  const sensitive = await call("POST", "/api/v1/web/memory/search", {
    query: "孩子",
    scopes: ["customer"],
    purpose: "验证敏感记忆脱敏",
  });
  assert.equal(sensitive.json.data.total, 1);
  assert.equal(sensitive.json.data.cards[0].content, "[敏感记忆，需一次性令牌查看]");
});

test("雷达：插件任务写入推荐条目且不自动安装，关键词任务写雷达", async () => {
  await hub.scheduler.upsert("plugin_radar_scan", {
    cron: "0 6 * * 1",
    timezone: "Asia/Shanghai",
    config: {
      companyProfile: { domains: ["finance", "crm"], requiredViews: ["view_ar_ap"], dataPolicy: "local_only" },
      pluginCandidates: [
        {
          id: "dsh-tax",
          name: "DSH 税务助手",
          url: "https://example.com/dsh-tax",
          sourceTrusted: true,
          lastUpdatedAt: "2026-10-01T00:00:00.000Z",
          license: "MIT",
          permissions: ["view.read"],
          requiredViews: ["view_ar_ap"],
          coverage: ["finance", "crm"],
          dataResidency: "local",
        },
        {
          id: "dsh-old",
          name: "停更插件",
          url: "https://example.com/old",
          sourceTrusted: true,
          lastUpdatedAt: "2023-01-01T00:00:00.000Z",
          license: "MIT",
          permissions: [],
          dataResidency: "local",
        },
      ],
    },
  });
  const pluginRun = await hub.scheduler.run("plugin_radar_scan", { scheduledAt: new Date("2026-11-06T06:00:00.000Z") });
  assert.equal(pluginRun.status, "ok");
  assert.equal((pluginRun.result as { recommended: number }).recommended, 1);

  const radar = await call("GET", "/api/v1/web/radar?type=plugin&status=new");
  assert.equal(radar.status, 200);
  assert.equal(radar.json.data.total, 1);
  assert.equal(radar.json.data.items[0].title, "DSH 税务助手");

  await hub.scheduler.upsert("keyword_radar_scan", {
    cron: "0 7 * * *",
    timezone: "Asia/Shanghai",
    config: {
      keywordItems: [
        { title: "增值税优惠新政", url: "https://example.com/policy", publishedAt: "2026-11-05", score: 0.9, reason: "命中税务关键词", dedupeKey: "policy-1" },
      ],
    },
  });
  const keywordRun = await hub.scheduler.run("keyword_radar_scan", { scheduledAt: new Date("2026-11-06T07:00:00.000Z") });
  assert.equal(keywordRun.status, "ok");
  assert.equal((keywordRun.result as { written: number }).written, 1);
});
