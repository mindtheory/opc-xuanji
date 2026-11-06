/**
 * 规格-实现一致性：spec/opc-xuanji/*.yaml 与真实 DDL、HTTP 路由、错误码逐项对账。
 * 这是 G2（契约冻结）到 G3（实现）之间的防漂移测试，任何一侧改动不一致都必须失败。
 */
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { Pool } from "../../src/db/pool.ts";
import { makePool } from "../helpers.ts";
import { ERR } from "../../src/platform/errors.ts";
import { ROUTES } from "../../src/api/http.ts";
import { loadConfig } from "../../src/platform/config.ts";

const config = loadConfig();
let pool: Pool;
let entities: any;
let api: any;

before(async () => {
  pool = makePool();
  const dir = join(config.root, "spec", "opc-xuanji");
  entities = parse(await readFile(join(dir, "entities.yaml"), "utf8"));
  api = parse(await readFile(join(dir, "api.yaml"), "utf8"));
});

after(async () => {
  await pool.end();
});

test("每个 spec 实体都在数据库里存在，且属性列齐备", async () => {
  const rows = await pool.query<{ table_schema: string; table_name: string; column_name: string }>(
    "SELECT table_schema, table_name, column_name FROM information_schema.columns",
  );
  const columns = new Map<string, Set<string>>();
  for (const row of rows.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    if (!columns.has(key)) columns.set(key, new Set());
    columns.get(key)?.add(row.column_name);
  }
  assert.ok(entities.entities.length >= 35);
  for (const entity of entities.entities) {
    const set = columns.get(entity.table);
    assert.ok(set !== undefined, `数据库缺少表 ${entity.table}（实体 ${entity.name}）`);
    assert.ok(set.has("id"), `${entity.table} 缺少主键列 id`);
    for (const attr of entity.attributes) {
      assert.ok(set.has(attr.name), `${entity.table} 缺少列 ${attr.name}`);
    }
  }
});

test("api.yaml 的每个 operation 都有对应 HTTP 路由", () => {
  let count = 0;
  for (const [route, item] of Object.entries(api.paths as Record<string, Record<string, unknown>>)) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = item[method];
      if (op === undefined) continue;
      count += 1;
      const sample = route.replace(/\{[^}]+\}/g, "1");
      const matched = ROUTES.some((candidate) => candidate.method === method.toUpperCase() && candidate.pattern.test(sample));
      assert.ok(matched, `api.yaml 声明了 ${method.toUpperCase()} ${route}，但 ROUTES 未实现`);
    }
  }
  assert.equal(count, ROUTES.length, "api.yaml operation 数量与 ROUTES 数量不一致");
});

test("错误码集合与实现一致", () => {
  const declared = new Set(api.errorCodes as string[]);
  for (const code of Object.values(ERR)) {
    assert.ok(declared.has(code), `实现里的错误码 ${code} 未在 api.yaml 登记`);
  }
  assert.equal(declared.size, Object.values(ERR).length);
});

test("实体与用例的追溯不断链（REQ/UC/TC 引用存在）", async () => {
  const usecases = parse(await readFile(join(config.root, "spec", "opc-xuanji", "usecases.yaml"), "utf8"));
  const entityNames = new Set(entities.entities.map((entity: { name: string }) => entity.name));
  for (const uc of usecases.usecases) {
    assert.match(uc.requirement, /^REQ-[A-Z]+-\d{3}$/);
    for (const name of uc.entities) assert.ok(entityNames.has(name), `${uc.id} 引用未知实体 ${name}`);
    for (const testId of uc.tests) assert.match(testId, /^TC-[A-Z]+-\d{3}$/);
  }
});
