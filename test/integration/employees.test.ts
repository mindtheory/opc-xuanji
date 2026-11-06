/**
 * 员工插件目录与员工包集成测试（真实 PG）：安装、停用依赖保护、导出、dry-run、导入默认停用。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/platform/config.ts";
import { createHub, type Hub } from "../../src/plugin/index.ts";
import { resetDb } from "../helpers.ts";
import { manifestByPlugin } from "../../src/employees/catalog.ts";
import { packageChecksum, type EmployeePackageEnvelope } from "../../src/employees/package.ts";
import { createHash } from "node:crypto";

let hub: Hub;
const config = loadConfig();

before(() => {
  hub = createHub({ dsn: config.testDsn });
});

after(async () => {
  await hub.pool.end();
});

beforeEach(async () => {
  await resetDb(hub.pool);
});

test("安装 → 列表 → 停用；有依赖时拒绝直接停用", async () => {
  const project = manifestByPlugin("opc_project");
  const wbs = manifestByPlugin("opc_wbs");
  assert.ok(project !== undefined && wbs !== undefined);
  await hub.employees.installManifest(project, { enabled: true });
  await hub.employees.installManifest(wbs, { enabled: true });

  const list = await hub.employees.list();
  assert.equal(list.length, 2);
  assert.ok(list.some((item) => item.pluginId === "opc_wbs" && item.enabled));

  await assert.rejects(
    () => hub.employees.toggle("opc_project", false, "测试依赖保护"),
    /依赖/,
  );
  const disabled = await hub.employees.toggle("opc_wbs", false, "测试停用");
  assert.equal(disabled.enabled, false);
  assert.ok(disabled.disabledReason?.includes("测试停用"));
});

test("导出 → dry-run → 确认导入；导入后默认停用", async () => {
  const project = manifestByPlugin("opc_project");
  assert.ok(project !== undefined);
  await hub.employees.installManifest(project, { enabled: true });

  const exported = await hub.employees.exportPackage("opc_project");
  assert.equal(exported.format, "opc-employee-package");
  assert.equal(exported.checksum, packageChecksum(exported.manifest, exported.files));
  assert.ok(exported.packageCode.includes("opc_project"));

  const dry = await hub.employees.importPackage(exported, { dryRun: true });
  assert.equal(dry.ready, true);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.errors.length, 0);

  const installed = await hub.employees.importPackage(exported, { dryRun: false, confirm: true });
  assert.equal(installed.ready, true);
  const row = await hub.employees.get("opc_project");
  assert.equal(row.enabled, false);
  assert.ok(row.disabledReason?.includes("默认停用"));
});

test("导入校验：路径穿越/校验和不一致被拒绝，不产生安装", async () => {
  const project = manifestByPlugin("opc_project");
  assert.ok(project !== undefined);
  const fileContent = "export const x = 1;\n";
  const fileSha = createHash("sha256").update(fileContent, "utf8").digest("hex");
  const files = [{ path: "../evil.ts", sha256: fileSha, contentBase64: Buffer.from(fileContent).toString("base64") }];
  const envelope: EmployeePackageEnvelope = {
    format: "opc-employee-package",
    formatVersion: "1",
    manifest: project,
    files,
    checksum: packageChecksum(project, files),
  };
  const report = await hub.employees.importPackage(envelope, { dryRun: true });
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((item) => item.includes("路径非法")));
  await assert.rejects(() => hub.employees.get("opc_project"), /不存在/);

  const badChecksum = { ...envelope, files: [], checksum: "0".repeat(64) };
  const bad = await hub.employees.importPackage(badChecksum, { dryRun: true });
  assert.equal(bad.ready, false);
  assert.ok(bad.errors.some((item) => item.includes("checksum")));
});
