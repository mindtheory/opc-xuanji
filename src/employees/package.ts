/**
 * 员工插件目录与员工包导入导出。
 *
 * 边界（SRS §9.7–9.9）：
 * - 员工包格式 `opc-employee-package` v1；默认只含 manifest/流程/配置，不含业务数据与凭据；
 * - 导入先校验 + dry-run，老板确认后安装为停用状态，启用需二次确认；
 * - 失败回滚，不留半安装插件/流程/授权；所有变更写审计。
 */
import { createHash } from "node:crypto";
import type { Pool } from "../db/pool.ts";
import type { Client } from "../db/pool.ts";
import { withTx } from "../db/pool.ts";
import type { AuditService } from "../audit/audit.ts";
import { OpcError, ERR } from "../platform/errors.ts";
import { canonicalJson } from "../platform/json.ts";
import { EMPLOYEE_MANIFESTS, manifestByPlugin, validateManifest, compareSemver, type EmployeeManifest } from "./catalog.ts";

export interface EmployeePackageFile {
  path: string;
  sha256: string;
  contentBase64: string;
}

export interface EmployeePackageEnvelope {
  format: "opc-employee-package";
  formatVersion: "1";
  manifest: EmployeeManifest;
  files: EmployeePackageFile[];
  checksum: string;
  signature?: string;
}

export interface EmployeeRow {
  pluginId: string;
  displayName: string;
  employeeCode: string;
  version: string;
  enabled: boolean;
  disabledReason: string | null;
  requiredViews: string[];
  tools: string[];
  writeTargets: string[];
  singleWorkflows: string[];
  dependencies: string[];
  manifest: EmployeeManifest;
  installedAt: Date | null;
  packageCode: string | null;
}

export interface ImportReport {
  packageCode: string;
  pluginId: string;
  version: string;
  existingVersion: string | null;
  dryRun: boolean;
  ready: boolean;
  errors: string[];
  warnings: string[];
  missingDependencies: string[];
  manifestErrors: string[];
  files: number;
  checksum: string;
}

const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;
const SAFE_EXT = /\.(ts|js|json|md|yml|yaml|txt)$/i;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function decodeSize(contentBase64: string): number {
  return Buffer.from(contentBase64, "base64").byteLength;
}

export function packageChecksum(manifest: EmployeeManifest, files: EmployeePackageFile[]): string {
  return sha256(canonicalJson({ manifest, files }));
}

export function validatePackageShape(input: unknown): EmployeePackageEnvelope {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new OpcError(ERR.EMP_INVALID, "员工包必须是对象", 400);
  const value = input as Partial<EmployeePackageEnvelope>;
  if (value.format !== "opc-employee-package") throw new OpcError(ERR.EMP_INVALID, "员工包 format 非法", 400);
  if (value.formatVersion !== "1") throw new OpcError(ERR.EMP_INVALID, "员工包 formatVersion 不支持", 400);
  if (value.manifest === undefined || typeof value.manifest !== "object") throw new OpcError(ERR.EMP_INVALID, "员工包缺少 manifest", 400);
  if (!Array.isArray(value.files)) throw new OpcError(ERR.EMP_INVALID, "员工包 files 必须是数组", 400);
  if (typeof value.checksum !== "string" || value.checksum.length !== 64) throw new OpcError(ERR.EMP_INVALID, "员工包 checksum 非法", 400);
  return value as EmployeePackageEnvelope;
}

export class EmployeePackageService {
  private readonly pool: Pool;
  private readonly audit: AuditService;
  private readonly hubVersion: string;
  private readonly clock: () => Date;

  constructor(pool: Pool, audit: AuditService, options: { hubVersion?: string; clock?: () => Date } = {}) {
    this.pool = pool;
    this.audit = audit;
    this.hubVersion = options.hubVersion ?? "0.2.1";
    this.clock = options.clock ?? (() => new Date());
  }

  async list(): Promise<EmployeeRow[]> {
    const rows = await this.pool.query<{
      plugin_id: string;
      display_name: string;
      version: string;
      enabled: boolean;
      disabled_reason: string | null;
      required_views: string[];
      tools: string[];
      write_targets: string[];
      manifest: EmployeeManifest | null;
      installed_at: Date | null;
      package_code: string | null;
    }>("SELECT * FROM ref.employee_plugin ORDER BY plugin_id");
    return rows.rows.map((row) => {
      const manifest = row.manifest ?? manifestByPlugin(row.plugin_id) ?? this.emptyManifest(row.plugin_id, row.display_name);
      return {
        pluginId: row.plugin_id,
        displayName: row.display_name,
        employeeCode: manifest.employeeCode,
        version: row.version,
        enabled: row.enabled,
        disabledReason: row.disabled_reason,
        requiredViews: row.required_views ?? manifest.requiredViews,
        tools: row.tools ?? manifest.tools,
        writeTargets: row.write_targets ?? manifest.writeTargets,
        singleWorkflows: manifest.singleWorkflows,
        dependencies: manifest.dependencies,
        manifest,
        installedAt: row.installed_at,
        packageCode: row.package_code,
      };
    });
  }

  async get(pluginId: string): Promise<EmployeeRow> {
    const rows = await this.list();
    const row = rows.find((item) => item.pluginId === pluginId);
    if (row === undefined) throw new OpcError(ERR.EMP_INVALID, `员工插件不存在：${pluginId}`, 404);
    return row;
  }

  async installManifest(manifest: EmployeeManifest, options: { enabled?: boolean; packageCode?: string; source?: string; actor?: string } = {}): Promise<EmployeeRow> {
    const errors = this.validateManifest(manifest);
    if (errors.length > 0) throw new OpcError(ERR.EMP_INVALID, `manifest 校验失败：${errors.join("；")}`, 422, { errors });
    await this.assertDependencies(manifest);
    await this.pool.query(
      `INSERT INTO ref.employee_plugin
         (plugin_id, display_name, scope, required_views, tools, write_targets, enabled, version, manifest, installed_at, disabled_reason, package_code)
       VALUES ($1,$2,'single',$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8::jsonb,now(),$9,$10)
       ON CONFLICT (plugin_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         required_views = EXCLUDED.required_views,
         tools = EXCLUDED.tools,
         write_targets = EXCLUDED.write_targets,
         version = EXCLUDED.version,
         manifest = EXCLUDED.manifest,
         installed_at = now(),
         enabled = EXCLUDED.enabled,
         disabled_reason = EXCLUDED.disabled_reason,
         package_code = EXCLUDED.package_code`,
      [
        manifest.pluginId,
        manifest.displayName,
        JSON.stringify(manifest.requiredViews),
        JSON.stringify(manifest.tools),
        JSON.stringify(manifest.writeTargets),
        options.enabled === true,
        manifest.version,
        JSON.stringify(manifest),
        options.enabled === true ? null : "导入/安装后默认停用，需老板显式启用",
        options.packageCode ?? null,
      ],
    );
    await this.audit.record({
      actor: options.actor ?? "opc_hub",
      action: "employee.install",
      result: "ok",
      objectType: "employee_plugin",
      objectId: manifest.pluginId,
      payload: { version: manifest.version, enabled: options.enabled === true, packageCode: options.packageCode ?? null, source: options.source ?? "manifest" },
    });
    return this.get(manifest.pluginId);
  }

  async toggle(pluginId: string, enabled: boolean, reason?: string, actor = "boss"): Promise<EmployeeRow> {
    if (!enabled) {
      const missing = await this.dependents(pluginId);
      if (missing.length > 0) {
        throw new OpcError(ERR.EMP_INVALID, `以下插件依赖 ${pluginId}，请先停用：${missing.join(", ")}`, 409, { dependents: missing });
      }
    }
    const updated = await this.pool.query(
      `UPDATE ref.employee_plugin SET enabled = $1, disabled_reason = $2 WHERE plugin_id = $3`,
      [enabled, enabled ? null : (reason ?? "老板停用"), pluginId],
    );
    if (updated.rowCount === 0) throw new OpcError(ERR.EMP_INVALID, `员工插件不存在：${pluginId}`, 404);
    await this.audit.record({
      actor,
      action: "employee.toggle",
      result: "ok",
      objectType: "employee_plugin",
      objectId: pluginId,
      payload: { enabled, reason: reason ?? null },
    });
    return this.get(pluginId);
  }

  async exportPackage(pluginId: string, actor = "boss"): Promise<EmployeePackageEnvelope & { packageCode: string }> {
    const row = await this.get(pluginId);
    const files: EmployeePackageFile[] = [];
    const checksum = packageChecksum(row.manifest, files);
    const packageCode = `${pluginId}@${row.version}-${checksum.slice(0, 8)}`;
    const envelope: EmployeePackageEnvelope = {
      format: "opc-employee-package",
      formatVersion: "1",
      manifest: row.manifest,
      files,
      checksum,
    };
    await this.pool.query(
      `INSERT INTO ref.employee_package (package_code, plugin_id, version, manifest, checksum, size_bytes, status, created_by, source)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,'exported',$7,'export')
       ON CONFLICT (package_code) DO NOTHING`,
      [packageCode, pluginId, row.version, JSON.stringify(row.manifest), checksum, Buffer.byteLength(JSON.stringify(envelope)), actor],
    );
    await this.audit.record({
      actor,
      action: "employee.export",
      result: "ok",
      objectType: "employee_package",
      objectId: packageCode,
      payload: { pluginId, version: row.version, files: files.length, checksum },
    });
    return { ...envelope, packageCode };
  }

  async importPackage(input: unknown, options: { dryRun?: boolean; confirm?: boolean; actor?: string } = {}): Promise<ImportReport> {
    const actor = options.actor ?? "boss";
    const dryRun = options.dryRun !== false;
    const packageEnvelope = validatePackageShape(input);
    const manifest = packageEnvelope.manifest;
    const manifestErrors = this.validateManifest(manifest);
    const errors: string[] = [...manifestErrors];
    const warnings: string[] = [];
    let totalBytes = 0;
    for (const file of packageEnvelope.files) {
      if (typeof file.path !== "string" || !SAFE_PATH.test(file.path) || file.path.includes("..") || file.path.startsWith("/") || file.path.includes("\\")) {
        errors.push(`文件路径非法：${String(file.path)}`);
        continue;
      }
      if (!SAFE_EXT.test(file.path)) errors.push(`文件类型不允许：${file.path}`);
      if (/(^|\/)\.env|secret|credential/i.test(file.path)) errors.push(`禁止打包敏感文件：${file.path}`);
      if (typeof file.contentBase64 !== "string" || typeof file.sha256 !== "string") {
        errors.push(`文件结构非法：${file.path}`);
        continue;
      }
      const bytes = decodeSize(file.contentBase64);
      totalBytes += bytes;
      const actual = sha256(Buffer.from(file.contentBase64, "base64").toString("utf8"));
      if (actual !== file.sha256) errors.push(`文件校验和不一致：${file.path}`);
    }
    if (totalBytes > MAX_TOTAL_BYTES) errors.push(`员工包超过 ${MAX_TOTAL_BYTES} 字节`);
    const actualChecksum = packageChecksum(manifest, packageEnvelope.files);
    if (actualChecksum !== packageEnvelope.checksum) errors.push("包级 checksum 不一致");
    if (packageEnvelope.signature === undefined) warnings.push("未签名包：来源需人工确认");

    const existing = await this.pool.query<{ version: string }>("SELECT version FROM ref.employee_plugin WHERE plugin_id = $1", [manifest.pluginId]);
    const existingVersion = existing.rows[0]?.version ?? null;
    if (existingVersion !== null && compareSemver(manifest.version, existingVersion) < 0) {
      warnings.push(`导入版本 ${manifest.version} 低于已安装 ${existingVersion}`);
    }
    const missingDependencies = await this.missingDependencies(manifest);
    if (missingDependencies.length > 0) errors.push(`缺少依赖插件：${missingDependencies.join(", ")}`);

    const ready = errors.length === 0;
    const packageCode = `${manifest.pluginId}@${manifest.version}-${actualChecksum.slice(0, 8)}`;
    const report: ImportReport = {
      packageCode,
      pluginId: manifest.pluginId,
      version: manifest.version,
      existingVersion,
      dryRun,
      ready,
      errors,
      warnings,
      missingDependencies,
      manifestErrors,
      files: packageEnvelope.files.length,
      checksum: actualChecksum,
    };

    if (dryRun || !ready || options.confirm !== true) {
      await this.pool.query(
        `INSERT INTO ref.employee_import_job (package_code, dry_run, status, report, decided_by)
         VALUES ($1,$2,$3,$4::jsonb,$5)`,
        [packageCode, dryRun, ready ? "validated" : "rejected", JSON.stringify(report), dryRun ? null : actor],
      );
      await this.audit.record({
        actor,
        action: "employee.import.validate",
        result: ready ? "ok" : "error",
        objectType: "employee_import_job",
        objectId: packageCode,
        payload: { pluginId: manifest.pluginId, version: manifest.version, dryRun, errors, warnings },
      });
      return report;
    }

    await withTx(this.pool, async (client: Client) => {
      await client.query(
        `INSERT INTO ref.employee_package (package_code, plugin_id, version, manifest, checksum, signature, size_bytes, status, created_by, source)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,'imported',$8,'import')
         ON CONFLICT (package_code) DO NOTHING`,
        [packageCode, manifest.pluginId, manifest.version, JSON.stringify(manifest), actualChecksum, packageEnvelope.signature ?? null, totalBytes, actor],
      );
      await client.query(
        `INSERT INTO ref.employee_plugin
           (plugin_id, display_name, scope, required_views, tools, write_targets, enabled, version, manifest, installed_at, disabled_reason, package_code)
         VALUES ($1,$2,'single',$3::jsonb,$4::jsonb,$5::jsonb,false,$6,$7::jsonb,now(),$8,$9)
         ON CONFLICT (plugin_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           required_views = EXCLUDED.required_views,
           tools = EXCLUDED.tools,
           write_targets = EXCLUDED.write_targets,
           version = EXCLUDED.version,
           manifest = EXCLUDED.manifest,
           installed_at = now(),
           enabled = false,
           disabled_reason = EXCLUDED.disabled_reason,
           package_code = EXCLUDED.package_code`,
        [manifest.pluginId, manifest.displayName, JSON.stringify(manifest.requiredViews), JSON.stringify(manifest.tools), JSON.stringify(manifest.writeTargets), manifest.version, JSON.stringify(manifest), "导入后默认停用，需老板显式启用", packageCode],
      );
      await client.query(
        `INSERT INTO ref.employee_import_job (package_code, dry_run, status, report, decided_at, decided_by)
         VALUES ($1,false,'installed',$2::jsonb,now(),$3)`,
        [packageCode, JSON.stringify(report), actor],
      );
    });
    await this.audit.record({
      actor,
      action: "employee.import.install",
      result: "ok",
      objectType: "employee_package",
      objectId: packageCode,
      payload: { pluginId: manifest.pluginId, version: manifest.version, enabled: false, files: packageEnvelope.files.length },
    });
    return report;
  }

  private validateManifest(manifest: EmployeeManifest): string[] {
    const errors = validateManifest(manifest, this.hubVersion);
    const duplicate = EMPLOYEE_MANIFESTS.filter((item) => item.pluginId === manifest.pluginId && item.version === manifest.version).length;
    if (duplicate === 0) return errors;
    return errors;
  }

  private async assertDependencies(manifest: EmployeeManifest): Promise<void> {
    const missing = await this.missingDependencies(manifest);
    if (missing.length > 0) throw new OpcError(ERR.EMP_INVALID, `缺少依赖插件：${missing.join(", ")}`, 422, { missing });
  }

  private async missingDependencies(manifest: EmployeeManifest): Promise<string[]> {
    if (manifest.dependencies.length === 0) return [];
    const rows = await this.pool.query<{ plugin_id: string }>(
      "SELECT plugin_id FROM ref.employee_plugin WHERE enabled = true AND plugin_id = ANY($1::text[])",
      [manifest.dependencies],
    );
    const present = new Set(rows.rows.map((row) => row.plugin_id));
    return manifest.dependencies.filter((dependency) => !present.has(dependency));
  }

  private async dependents(pluginId: string): Promise<string[]> {
    const rows = await this.pool.query<{ plugin_id: string; manifest: EmployeeManifest | null }>(
      "SELECT plugin_id, manifest FROM ref.employee_plugin",
    );
    return rows.rows
      .filter((row) => row.plugin_id !== pluginId && (row.manifest?.dependencies ?? []).includes(pluginId))
      .map((row) => row.plugin_id);
  }

  private emptyManifest(pluginId: string, displayName: string): EmployeeManifest {
    return {
      pluginId,
      employeeCode: "UNK",
      displayName,
      version: "0.1.0",
      minHubVersion: "0.2.1",
      schemaVersion: "1",
      requiredViews: [],
      tools: [],
      writeTargets: [],
      singleWorkflows: [],
      dependencies: [],
    };
  }
}
