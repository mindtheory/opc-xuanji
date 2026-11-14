/**
 * 情报日报规则评分单测：只验证可解释的关键词/标签命中与排除词，不宣称事实判断。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreIntelItem, type WatchRule } from "../../src/domains/intel/daily.ts";

const rules: WatchRule[] = [
  {
    keyword: "低空经济",
    matchType: "phrase",
    synonyms: ["eVTOL"],
    excludeTerms: ["培训广告"],
    tags: ["政策"],
    priority: 200,
  },
  {
    keyword: "竞争对手A",
    matchType: "exact",
    synonyms: [],
    excludeTerms: [],
    tags: ["竞品"],
    priority: 100,
  },
];

test("情报评分：命中关键词与同义词，输出标签与分值", () => {
  const score = scoreIntelItem(rules, {
    title: "低空经济新政发布，eVTOL 试点扩容",
    summary: "某地发布低空经济扶持政策",
    tagNames: ["政策", "竞品"],
    riskLevel: "medium",
  });
  assert.deepEqual(score.matchedKeywords, ["低空经济"]);
  assert.ok(score.matchedTags.includes("政策"));
  assert.equal(score.excludedBy.length, 0);
  assert.ok(score.score > 0);
});

test("情报评分：排除词命中时置 filtered 分值为 0", () => {
  const score = scoreIntelItem(rules, {
    title: "低空经济培训广告",
    summary: "招生信息",
  });
  assert.deepEqual(score.excludedBy, ["培训广告"]);
  assert.equal(score.score, 0);
});

test("情报评分：未命中规则不伪造分值", () => {
  const score = scoreIntelItem(rules, { title: "普通天气预报" });
  assert.equal(score.score, 0);
  assert.equal(score.reason, "未命中关键词/标签");
});
