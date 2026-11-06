/**
 * 网页表现层纯函数单测：分类/抽取/归置决策、插件雷达评分、驾驶舱陈旧判定。
 * 这些规则决定“什么自动归置、什么必须人工确认”，必须先用单测锁定。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyText, decideIngest, extractFields } from "../../src/web/classifier.ts";
import { evaluatePluginCandidate } from "../../src/web/plugin-score.ts";
import { isSnapshotStale, parseRange } from "../../src/web/dashboard.ts";

test("分类：发票文本归财税，且高风险域即使高置信也走确认", () => {
  const classification = classifyText("收到供应商发票，价税合计 1200 元，请报销并登记应付");
  assert.equal(classification.domain, "finance");
  assert.ok(classification.confidence > 0.6);
  assert.deepEqual(classification.matchedRules.includes("发票"), true);
  const decision = decideIngest(classification);
  assert.equal(decision.action, "confirm");
  assert.equal(decision.requiresHuman, true);
  assert.equal(decision.writeTarget, "ledger");
});

test("分类：普通会议纪要归行政，低置信进入收件箱", () => {
  const admin = classifyText("会议纪要：明天下午三点开项目周会，讨论排期");
  assert.equal(admin.domain, "admin");
  const empty = classifyText("嗯，这个再说吧");
  assert.equal(empty.domain, "inbox");
  assert.equal(decideIngest(empty).action, "inbox");
});

test("抽取：金额/日期/发票号/合同号/相对方", () => {
  const fields = extractFields("客户：甲公司 发票号：INV20261105001 合同编号：HT-2026-009 金额：12,300.50 元 日期：2026年11月5日");
  assert.equal(fields.amount, 12300.5);
  assert.equal(fields.date, "2026-11-05");
  assert.equal(fields.invoiceNo, "INV20261105001");
  assert.equal(fields.contractNo, "HT-2026-009");
  assert.equal(fields.counterparty, "甲公司");
});

test("插件雷达：可信/近期/本地优先通过，停更/越权/远程敏感数据拒绝", () => {
  const profile = { domains: ["finance", "crm"], requiredViews: ["view_ar_ap"], dataPolicy: "local_only" as const };
  const candidate = {
    id: "dsh-tax",
    name: "DSH 税务助手",
    url: "https://example.com/dsh-tax",
    sourceTrusted: true,
    lastUpdatedAt: "2026-10-01T00:00:00.000Z",
    license: "MIT",
    permissions: ["view.read"],
    requiredViews: ["view_ar_ap"],
    coverage: ["finance", "crm"],
    dataResidency: "local" as const,
  };
  const now = new Date("2026-11-06T00:00:00.000Z");
  const good = evaluatePluginCandidate(candidate, profile, now);
  assert.equal(good.eligible, true);
  assert.ok(good.score > 0.5);

  const stale = evaluatePluginCandidate({ ...candidate, id: "old", lastUpdatedAt: "2024-01-01T00:00:00.000Z" }, profile, now);
  assert.equal(stale.eligible, false);

  const remote = evaluatePluginCandidate({ ...candidate, id: "remote", dataResidency: "remote" }, profile, now);
  assert.equal(remote.eligible, false);

  const excessive = evaluatePluginCandidate({ ...candidate, id: "admin", permissions: ["db.write.any"] }, profile, now);
  assert.equal(excessive.eligible, false);
});

test("驾驶舱：range 白名单与陈旧判定", () => {
  assert.equal(parseRange("7d"), "7d");
  assert.equal(parseRange("bad"), "30d");
  const asOf = new Date("2026-11-06T00:00:00.000Z");
  assert.equal(isSnapshotStale(asOf, new Date("2026-11-06T00:10:00.000Z"), 15), false);
  assert.equal(isSnapshotStale(asOf, new Date("2026-11-06T00:20:00.000Z"), 15), true);
});
