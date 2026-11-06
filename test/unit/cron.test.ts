/**
 * cron 解析与下次触发计算的单元测试（先写测试后实现）。
 * 口径：5 字段 `分 时 日 月 周`，周 0/7 = 周日；时区按 IANA 名解析。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCron, nextRun, describeCron } from "../../src/scheduler/cron.ts";

test("parseCron 支持 */n、列表、区间与周日 0/7", () => {
  const c = parseCron("*/15 8-9 * * 1-5");
  assert.deepEqual([...c.minutes].sort((a, b) => a - b), [0, 15, 30, 45]);
  assert.deepEqual([...c.hours].sort((a, b) => a - b), [8, 9]);
  assert.equal(c.daysOfWeek.has(1), true);

  const sunday = parseCron("0 9 * * 0,7");
  assert.deepEqual([...sunday.daysOfWeek].sort((a, b) => a - b), [0]);
});

test("parseCron 拒绝非法表达式", () => {
  assert.throws(() => parseCron("* * * *"), /5 字段/);
  assert.throws(() => parseCron("60 * * * *"), /分/);
  assert.throws(() => parseCron("* * * * 8"), /周/);
});

test("nextRun 按 Asia/Shanghai 计算工作日晨报（08:30）", () => {
  // 2026-11-05 是周四，北京时间 06:00 → 当日 08:30
  const from = new Date("2026-11-04T22:00:00.000Z");
  const next = nextRun("30 8 * * 1-5", "Asia/Shanghai", from);
  assert.equal(next.toISOString(), "2026-11-05T00:30:00.000Z");
});

test("nextRun 跨周末跳到周一", () => {
  // 2026-11-06 周五 18:00 北京 → 下一次周一 08:30
  const from = new Date("2026-11-06T10:00:00.000Z");
  const next = nextRun("30 8 * * 1-5", "Asia/Shanghai", from);
  assert.equal(next.toISOString(), "2026-11-09T00:30:00.000Z");
});

test("nextRun 严格晚于 from（同一分钟不重复触发）", () => {
  const from = new Date("2026-11-05T00:30:00.000Z"); // 正好 08:30
  const next = nextRun("30 8 * * 1-5", "Asia/Shanghai", from);
  assert.equal(next.toISOString(), "2026-11-06T00:30:00.000Z");
});

test("nextRun 支持凌晨 02:00 审计导出", () => {
  const from = new Date("2026-11-05T12:00:00.000Z"); // 北京 20:00
  const next = nextRun("0 2 * * *", "Asia/Shanghai", from);
  assert.equal(next.toISOString(), "2026-11-05T18:00:00.000Z");
});

test("describeCron 输出人读描述", () => {
  assert.match(describeCron("30 8 * * 1-5"), /工作日 08:30/);
  assert.match(describeCron("0 2 * * *"), /每天 02:00/);
});
