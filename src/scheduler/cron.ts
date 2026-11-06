/**
 * 5 字段 cron（分 时 日 月 周）解析与“下一次触发”计算。
 *
 * 设计取舍：不引入 cron 依赖库；按“日期跳 + 小时/分钟取下一个”计算，避免逐分钟迭代；
 * 时区换算用 Intl 探测偏移（不依赖 TZ 环境变量），支持 Asia/Shanghai 等 IANA 时区。
 * 周：0 或 7 均表示周日；“日/周”同时受限时按 cron 惯例取“或”。
 */
import { OpcError, ERR } from "../platform/errors.ts";

export interface CronSpec {
  source: string;
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  dayRestricted: boolean;
  weekRestricted: boolean;
}

const FIELDS = [
  { name: "分", min: 0, max: 59 },
  { name: "时", min: 0, max: 23 },
  { name: "日", min: 1, max: 31 },
  { name: "月", min: 1, max: 12 },
  { name: "周", min: 0, max: 7 },
];

function expand(field: string, spec: { name: string; min: number; max: number }): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangeText, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step <= 0) {
      throw new OpcError(ERR.TASK_INVALID, `cron ${spec.name} 字段步长非法：${part}`, 400);
    }
    let from: number;
    let to: number;
    if (rangeText === "*" || rangeText === "") {
      from = spec.min;
      to = spec.max;
    } else if (rangeText.includes("-")) {
      const [a, b] = rangeText.split("-").map(Number);
      from = a;
      to = b;
    } else {
      from = Number(rangeText);
      to = from;
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < spec.min || to > spec.max || from > to) {
      throw new OpcError(ERR.TASK_INVALID, `cron ${spec.name} 字段超出范围（${spec.min}-${spec.max}）：${part}`, 400);
    }
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values;
}

export function parseCron(expression: string): CronSpec {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new OpcError(ERR.TASK_INVALID, `cron 必须是 5 字段（分 时 日 月 周），收到：${expression}`, 400);
  }
  const [minutes, hours, daysOfMonth, months, daysOfWeekRaw] = fields;
  const dow = expand(daysOfWeekRaw, FIELDS[4]);
  if (dow.has(7)) {
    dow.delete(7);
    dow.add(0);
  }
  return {
    source: expression.trim(),
    minutes: expand(minutes, FIELDS[0]),
    hours: expand(hours, FIELDS[1]),
    daysOfMonth: expand(daysOfMonth, FIELDS[2]),
    months: expand(months, FIELDS[3]),
    daysOfWeek: dow,
    dayRestricted: daysOfMonth !== "*",
    weekRestricted: daysOfWeekRaw !== "*",
  };
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const PART_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = PART_CACHE.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PART_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

/** 某 UTC 瞬时在指定时区的本地时间分量。 */
export function partsInZone(instant: Date, timeZone: string): Parts & { second: number } {
  const map: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === 24 ? 0 : map.hour,
    minute: map.minute,
    second: map.second,
  };
}

/** 时区本地时间 → UTC 瞬时（迭代两次抵消 DST 偏移）。 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = target;
  for (let i = 0; i < 2; i += 1) {
    const local = partsInZone(new Date(instant), timeZone);
    const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    instant += target - localAsUtc;
  }
  return new Date(instant);
}

const WEEKDAY_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function weekdayInZone(instant: Date, timeZone: string): number {
  let formatter = WEEKDAY_FORMATTER_CACHE.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
    WEEKDAY_FORMATTER_CACHE.set(timeZone, formatter);
  }
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[formatter.format(instant)] ?? 0;
}

function dayMatches(spec: CronSpec, year: number, month: number, day: number, timeZone: string): boolean {
  if (!spec.months.has(month)) return false;
  const noon = zonedTimeToUtc(year, month, day, 12, 0, timeZone);
  const dow = weekdayInZone(noon, timeZone);
  const domOk = spec.daysOfMonth.has(day);
  const dowOk = spec.daysOfWeek.has(dow);
  if (spec.dayRestricted && spec.weekRestricted) return domOk || dowOk;
  if (spec.dayRestricted) return domOk;
  if (spec.weekRestricted) return dowOk;
  return true;
}

/** 计算严格晚于 from 的下一次触发时刻。 */
export function nextRun(expression: string, timeZone: string, from: Date = new Date()): Date {
  const spec = parseCron(expression);
  const start = partsInZone(from, timeZone);
  const hours = [...spec.hours].sort((a, b) => a - b);
  const minutes = [...spec.minutes].sort((a, b) => a - b);
  for (let offset = 0; offset <= 400; offset += 1) {
    const base = zonedTimeToUtc(start.year, start.month, start.day, 12, 0, timeZone);
    const dayParts = partsInZone(new Date(base.getTime() + offset * 86_400_000), timeZone);
    if (!dayMatches(spec, dayParts.year, dayParts.month, dayParts.day, timeZone)) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        const candidate = zonedTimeToUtc(dayParts.year, dayParts.month, dayParts.day, hour, minute, timeZone);
        if (candidate.getTime() > from.getTime()) return candidate;
      }
    }
  }
  throw new OpcError(ERR.TASK_INVALID, `cron 在 400 天内无触发时刻：${spec.source}`, 400);
}

export function describeCron(expression: string): string {
  const spec = parseCron(expression);
  const fields = expression.trim().split(/\s+/);
  const pad = (value: number) => String(value).padStart(2, "0");
  const hour = [...spec.hours].sort((a, b) => a - b)[0];
  const minute = [...spec.minutes].sort((a, b) => a - b)[0];
  if (!spec.dayRestricted && (fields[4] === "1-5" || fields[4].toUpperCase() === "MON-FRI")) {
    return `工作日 ${pad(hour)}:${pad(minute)}`;
  }
  if (!spec.dayRestricted && !spec.weekRestricted && spec.hours.size === 1 && spec.minutes.size === 1) {
    return `每天 ${pad(hour)}:${pad(minute)}`;
  }
  return `cron ${spec.source}`;
}
