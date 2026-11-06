/**
 * 员工插件 manifest 与员工包格式单测：锁定 11 个员工、视图/工具/写目标声明、可插拔与包校验。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPLOYEE_MANIFESTS, manifestByPlugin, validateManifest, type EmployeeManifest } from "../../src/employees/catalog.ts";
import { packageChecksum, validatePackageShape, type EmployeePackageEnvelope } from "../../src/employees/package.ts";

test("员工目录：11 个员工、插件 ID/员工代码唯一", () => {
  assert.equal(EMPLOYEE_MANIFESTS.length, 11);
  assert.equal(new Set(EMPLOYEE_MANIFESTS.map((item) => item.pluginId)).size, 11);
  assert.equal(new Set(EMPLOYEE_MANIFESTS.map((item) => item.employeeCode)).size, 11);
  assert.ok(manifestByPlugin("opc_wbs") !== undefined);
  assert.ok(manifestByPlugin("opc_publicity") !== undefined);
});

test("每个 manifest 均通过校验，且声明视图/工具/写目标/流程", () => {
  for (const manifest of EMPLOYEE_MANIFESTS) {
    const errors = validateManifest(manifest, "0.2.1");
    assert.deepEqual(errors, [], manifest.pluginId);
    assert.ok(manifest.requiredViews.length > 0, manifest.pluginId);
    assert.ok(manifest.tools.length > 0, manifest.pluginId);
    assert.ok(manifest.writeTargets.length > 0, manifest.pluginId);
  }
});

test("manifest 校验拒绝未知视图、未登记写目标与过高中枢版本", () => {
  const base: EmployeeManifest = {
    pluginId: "opc_bad",
    employeeCode: "BAD",
    displayName: "坏插件",
    version: "0.1.0",
    minHubVersion: "9.9.9",
    schemaVersion: "1",
    requiredViews: ["view_not_exists"],
    tools: ["invalid-tool"],
    writeTargets: ["not_a_table"],
    singleWorkflows: ["Bad-Name"],
    dependencies: [],
  };
  const errors = validateManifest(base, "0.2.1");
  assert.ok(errors.some((item) => item.includes("minHubVersion")));
  assert.ok(errors.some((item) => item.includes("未知视图")));
  assert.ok(errors.some((item) => item.includes("工具名非法")));
  assert.ok(errors.some((item) => item.includes("写目标未登记")));
});

test("员工包：checksum 覆盖 manifest + files，格式错误拒绝", () => {
  const manifest = manifestByPlugin("opc_wbs");
  assert.ok(manifest !== undefined);
  const envelope: EmployeePackageEnvelope = {
    format: "opc-employee-package",
    formatVersion: "1",
    manifest,
    files: [],
    checksum: packageChecksum(manifest, []),
  };
  assert.equal(validatePackageShape(envelope).manifest.pluginId, "opc_wbs");
  assert.throws(() => validatePackageShape({ format: "zip" }), /format/);
  assert.throws(() => validatePackageShape({ ...envelope, checksum: "short" }), /checksum/);
});
