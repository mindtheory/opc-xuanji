#!/usr/bin/env node
/**
 * 轻量文档门禁：frontmatter、自检清单、文末关系、doc_id 唯一性。
 * 外部 CD-PTC 的 check-docs.mjs 仍可作为更严格的门禁；本脚本保证 GitHub CI 可独立运行。
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const dir = process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1] : "docs";
const errors = [];
const warnings = [];
const ids = new Map();

async function walk(current) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "uml" || entry.name === "releases" || entry.name === "过程资产") continue;
      await walk(path);
    } else if (entry.name.endsWith(".md")) {
      await check(path);
    }
  }
}

async function check(path) {
  const text = await readFile(path, "utf8");
  const rel = relative(process.cwd(), path);
  if (!text.startsWith("---\n")) {
    errors.push(`${rel}: 缺少 frontmatter`);
    return;
  }
  const end = text.indexOf("\n---", 4);
  if (end < 0) {
    errors.push(`${rel}: frontmatter 未闭合`);
    return;
  }
  const front = text.slice(4, end);
  const id = /^doc_id:\s*(.+)$/m.exec(front)?.[1]?.trim();
  if (!id) errors.push(`${rel}: frontmatter 缺少 doc_id`);
  else if (ids.has(id)) errors.push(`${rel}: doc_id 重复（${id}，已用于 ${ids.get(id)}）`);
  else ids.set(id, rel);
  if (!/^##\s+(\d+\.\s+)?自检清单$/m.test(text)) errors.push(`${rel}: 缺少“自检清单”`);
  if (!/^##\s+(\d+\.\s+)?与其他文档的关系$/m.test(text)) errors.push(`${rel}: 缺少“与其他文档的关系”`);
  if (text.length < 200) warnings.push(`${rel}: 内容较短`);
}

await walk(dir);
if (warnings.length > 0) {
  console.log(`check-docs: WARN ${warnings.length}`);
  for (const warning of warnings) console.log(`  - ${warning}`);
}
if (errors.length > 0) {
  console.error(`check-docs: FAIL（${errors.length} 个错误）`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`check-docs: PASS（${ids.size} 份文档）`);
