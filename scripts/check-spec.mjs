#!/usr/bin/env node
/**
 * 轻量规格门禁：检查 spec/opc-xuanji 的 YAML 可解析、实体/接口/用例引用闭合。
 * 外部 CD-PTC 的 check-spec.mjs 仍可作为更严格的门禁；本脚本保证 GitHub CI 可独立运行。
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

const dir = process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1] : "spec/opc-xuanji";
const errors = [];
const warnings = [];
const docs = {};

async function load(name) {
  const raw = await readFile(join(dir, name), "utf8");
  try {
    docs[name] = parse(raw);
  } catch (error) {
    errors.push(`${name}: YAML 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const name of await readdir(dir)) {
  if (name.endsWith(".yaml") || name.endsWith(".yml")) await load(name);
}

const entities = docs["entities.yaml"]?.entities ?? [];
const api = docs["api.yaml"];
const usecases = docs["usecases.yaml"]?.usecases ?? [];
const modules = docs["modules.yaml"]?.modules ?? [];

if (entities.length === 0) errors.push("entities.yaml: 没有 entities");
const entityNames = new Set(entities.map((e) => e.name));
const tableNames = new Set();
for (const entity of entities) {
  if (!entity.name) errors.push("entities.yaml: 存在缺少 name 的实体");
  if (!entity.table) errors.push(`${entity.name}: 缺少 table`);
  if (tableNames.has(entity.table)) errors.push(`重复表名：${entity.table}`);
  tableNames.add(entity.table);
  for (const attr of entity.attributes ?? []) {
    if (!attr.name || !attr.type) errors.push(`${entity.name}: 属性缺少 name/type`);
  }
}

if (!api) errors.push("缺少 api.yaml");
else {
  const ids = new Set();
  let operations = 0;
  for (const [path, item] of Object.entries(api.paths ?? {})) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = item[method];
      if (!op) continue;
      operations += 1;
      if (!op.operationId) errors.push(`${method.toUpperCase()} ${path}: 缺少 operationId`);
      else if (ids.has(op.operationId)) errors.push(`重复 operationId：${op.operationId}`);
      else ids.add(op.operationId);
      if (!Array.isArray(op.tags) || op.tags.length === 0) warnings.push(`${op.operationId}: 缺少 tags`);
    }
  }
  if (operations === 0) errors.push("api.yaml: 没有 operation");
  const errorCodes = api.errorCodes ?? [];
  if (new Set(errorCodes).size !== errorCodes.length) errors.push("api.yaml: errorCodes 重复");
}

if (usecases.length === 0) errors.push("usecases.yaml: 没有 usecases");
for (const uc of usecases) {
  if (!/^UC-\d{3}$/.test(uc.id ?? "")) errors.push(`用例 id 非法：${uc.id}`);
  if (!/^REQ-[A-Z]+-\d{3}$/.test(uc.requirement ?? "")) errors.push(`${uc.id}: requirement 非法`);
  for (const name of uc.entities ?? []) if (!entityNames.has(name)) errors.push(`${uc.id}: 引用未知实体 ${name}`);
  for (const test of uc.tests ?? []) if (!/^TC-[A-Z]+-\d{3}$/.test(test)) errors.push(`${uc.id}: 测试 id 非法 ${test}`);
}

if (new Set(modules.map((m) => m.name)).size !== modules.length) errors.push("modules.yaml: 模块名重复");

if (warnings.length > 0) {
  console.log(`规格包 ${dir}: WARN ${warnings.length}`);
  for (const warning of warnings) console.log(`  - ${warning}`);
}
if (errors.length > 0) {
  console.error(`规格包 ${dir}: FAIL（${errors.length} 个错误）`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`规格包 ${dir}: PASS（${entities.length} 实体 / ${usecases.length} 用例 / ${modules.length} 模块）`);
