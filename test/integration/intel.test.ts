/**
 * 情报日报流水线集成测试：项目空间 → 采集入库 → 规则分析 → 日报版本 → 站内推送。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "../../src/db/pool.ts";
import { makePool, resetDb, NOW } from "../helpers.ts";
import { IntelPipelineService } from "../../src/domains/intel/daily.ts";

let pool: Pool;
let service: IntelPipelineService;
let sourceId: number;

before(async () => {
  pool = makePool();
  service = new IntelPipelineService(pool);
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDb(pool);
  await pool.query(
    `INSERT INTO biz.intel_project_scope
       (project_id, name, timezone, brief_time, lookback_hours, max_items, push_channels)
     VALUES (1, '测试项目', 'Asia/Shanghai', '00:00', 24, 20, '["inapp"]'::jsonb)`,
  );
  const source = await pool.query<{ id: number }>(
    `INSERT INTO biz.source (name, source_type, url) VALUES ('测试来源', 'rss', 'https://example.com/feed') RETURNING id`,
  );
  sourceId = Number(source.rows[0].id);
  await pool.query("INSERT INTO biz.source_binding (source_id, project_id) VALUES ($1, 1)", [sourceId]);
  await pool.query(
    `INSERT INTO biz.watch_topic (project_id, keyword, match_type, tags, priority)
     VALUES (1, '低空经济', 'phrase', '["政策"]'::jsonb, 200)`,
  );
  await pool.query("INSERT INTO biz.intel_tag (project_id, name, category) VALUES (1, '政策', 'policy')");
});

test("情报流水线：采集幂等、规则分析、日报版本与站内推送", async () => {
  const raw = {
    projectId: 1,
    sourceId,
    externalId: "news-1",
    url: "https://example.com/news/1",
    title: "低空经济新政发布",
    summary: "某地发布低空经济扶持政策",
    publishedAt: NOW.toISOString(),
  };

  const first = await service.collectAll(NOW, [raw], { force: true });
  assert.equal(first.inserted, 1);
  const second = await service.collectAll(NOW, [raw], { force: true });
  assert.equal(second.inserted, 0);
  assert.equal(second.duplicates, 1);

  const analyzed = await service.analyze(NOW, { force: true });
  assert.equal(analyzed.analyzed, 1);
  const item = await pool.query<{ status: string; relevance_score: string; tags: string[] }>(
    "SELECT status, relevance_score, tags FROM biz.intel_item LIMIT 1",
  );
  assert.equal(item.rows[0].status, "analyzed");
  assert.ok(Number(item.rows[0].relevance_score) > 0);
  assert.ok(item.rows[0].tags.includes("政策"));

  const briefs = await service.buildBriefs(NOW, { force: true });
  assert.equal(briefs.length, 1);
  assert.equal(briefs[0].skipped, false);
  assert.equal(briefs[0].itemCount, 1);
  const brief = await pool.query<{ sections: { headline: unknown[] }; coverage: { sourceCount: number } }>(
    "SELECT sections, coverage FROM biz.intel_brief LIMIT 1",
  );
  assert.equal(brief.rows[0].sections.headline.length, 1);
  assert.equal(brief.rows[0].coverage.sourceCount, 1);

  const pushed = await service.push(NOW, { force: true });
  assert.equal(pushed.briefs, 1);
  assert.ok(pushed.sent >= 1);
  const log = await pool.query<{ status: string }>("SELECT status FROM stat.intel_push_log LIMIT 1");
  assert.equal(log.rows[0].status, "sent");
  const notification = await pool.query("SELECT count(*)::int AS n FROM stat.notification WHERE kind = 'intel_brief'");
  assert.equal(notification.rows[0].n, 1);
});
