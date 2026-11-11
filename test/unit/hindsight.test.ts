/**
 * Hindsight 记忆桥单元测试：本地桩服务器验证 API 请求形状、错误映射与张量转换；
 * 不依赖真实 Hindsight 服务与数据库。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { HindsightBridge, cardToItem, itemToProposal } from "../../src/memory/hindsight.ts";
import { OpcError } from "../../src/platform/errors.ts";

interface StubCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let server: Server;
let base = "";
let calls: StubCall[] = [];
let failMode = false;

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      calls.push({ method: req.method ?? "", path: req.url ?? "", body });
      if (failMode) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "stub down" }));
        return;
      }
      const url = String(req.url ?? "");
      res.writeHead(200, { "content-type": "application/json" });
      if (url.startsWith("/health")) {
        res.end(JSON.stringify({ status: "ok" }));
      } else if (url.includes("/stats")) {
        res.end(JSON.stringify({ bank_id: "dsh", total_nodes: 3, total_links: 9, total_documents: 2, last_memory_write_at: "2026-10-10T12:00:00Z", pending_operations: 0 }));
      } else if (url.includes("/memories/list")) {
        res.end(JSON.stringify({ items: [{ id: "m-1", text: "客户甲偏好周五对账", context: "crm", tags: ["scope:customer"], state: "valid", fact_type: "world", date: null }], total: 1, limit: 50, offset: 0 }));
      } else if (url.includes("/memories")) {
        res.end(JSON.stringify({ accepted: Array.isArray((body as { items?: unknown[] })?.items) ? (body as { items: unknown[] }).items.length : 0 }));
      } else {
        res.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function bridge(): HindsightBridge {
  calls = [];
  failMode = false;
  return new HindsightBridge({ baseUrl: base, bankId: "dsh" });
}

test("healthSafe 与 stats：可达时返回统计", async () => {
  const b = bridge();
  assert.deepEqual(await b.healthSafe(), { reachable: true });
  const stats = await b.stats();
  assert.equal(stats.totalNodes, 3);
  assert.equal(stats.totalDocuments, 2);
  assert.equal(calls[1].path, "/v1/default/banks/dsh/stats");
});

test("listMemories：请求分页参数并映射字段", async () => {
  const page = await bridge().listMemories(10, 5);
  assert.equal(page.items[0].text, "客户甲偏好周五对账");
  assert.equal(page.items[0].tags[0], "scope:customer");
  assert.match(calls[0].path, /memories\/list\?limit=10&offset=5/);
});

test("importItems：POST /memories，body 形状与 async 开关", async () => {
  const b = bridge();
  await b.importItems([{ content: "甲" }, { content: "乙", tags: ["t"] }]);
  const call = calls.find((c) => c.method === "POST");
  assert.equal(call?.path, "/v1/default/banks/dsh/memories");
  assert.equal((call?.body as { async: boolean }).async, false);
  assert.equal(((call?.body as { items: unknown[] }).items).length, 2);
  await b.importItems([{ content: "丙" }], { async: true });
  assert.equal((calls.filter((c) => c.method === "POST").pop()?.body as { async: boolean }).async, true);
});

test("不可达：healthSafe 报 reachable:false；stats 抛 ERR-HINDSIGHT-001", async () => {
  const b = new HindsightBridge({ baseUrl: "http://127.0.0.1:1", timeoutMs: 500 });
  assert.equal((await b.healthSafe(500)).reachable, false);
  await assert.rejects(
    () => b.stats(),
    (error: unknown) => error instanceof OpcError && error.errorCode === "ERR-HINDSIGHT-001",
  );
});

test("非 2xx：映射为 ERR-HINDSIGHT-001 且带服务端 detail", async () => {
  failMode = true; // 注意：bridge() 会复位 failMode，这里不要用该辅助函数
  const b = new HindsightBridge({ baseUrl: base, bankId: "dsh" });
  await assert.rejects(
    () => b.listMemories(),
    (error: unknown) => error instanceof OpcError && error.errorCode === "ERR-HINDSIGHT-001" && error.message.includes("stub down"),
  );
});

test("cardToItem：敏感卡不推送；document_id 幂等且 tags 带 source:opc", () => {
  const card = {
    id: 7,
    scope: "experience",
    title: "标题",
    content: "正文",
    sourceRefs: ["s1"],
    confidence: 0.8,
    sensitive: false,
    createdAt: "2026-11-11T00:00:00.000Z",
  };
  const item = cardToItem(card);
  assert.ok(item !== null);
  assert.equal(item.document_id, "opc-memory-7");
  assert.deepEqual(item?.tags, ["source:opc", "scope:experience"]);
  assert.ok(item?.content.includes("正文"));
  assert.equal(cardToItem({ ...card, sensitive: true }), null);
});

test("itemToProposal：首行作标题、来源引用 hindsight:<id>、scope 映射", () => {
  const proposal = itemToProposal({ id: "m-9", text: "客户乙要求月结后 3 天付款\n细节", context: null, tags: ["scope:customer"], state: "valid", factType: null, date: null });
  assert.equal(proposal?.type, "customer");
  assert.equal(proposal?.title, "客户乙要求月结后 3 天付款");
  assert.deepEqual(proposal?.sourceRefs, ["hindsight:m-9"]);
  assert.equal(itemToProposal({ id: "m-10", text: "   ", context: null, tags: [], state: "valid", factType: null, date: null }), null);
});
