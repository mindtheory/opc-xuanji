/**
 * Workflow Registry：流程版本注册 + 六项准入守卫 + 风险等级硬规则。
 *
 * 失败语义：守卫失败 → 拒绝注册（不静默降级）→ 写审计 → 抛 ERR-WF-001（422，details.failures 逐项）；
 * 同版本重复注册 → ERR-WF-002（409），版本不可变，升级必须递增 version。
 */
import type { Pool } from "../db/pool.ts";
import { OpcError, ERR } from "./../platform/errors.ts";
import type { AuditService } from "../audit/audit.ts";
import { knownViewIds } from "../platform/views.ts";
import { evaluateGuard, codeHashOf, computeRisk, type EmployeeProfile, type WorkflowMeta } from "./guard.ts";

export interface RegisterInput {
  workflowId: string;
  version: string;
  ownerPlugin: string;
  meta: WorkflowMeta;
  code: string;
  testedCodeHash: string;
  monthlyFlow?: number;
}

export interface RegisterResult {
  workflowId: string;
  version: string;
  riskLevel: "high" | "medium" | "low";
  riskReasons: string[];
  status: string;
}

export interface RegistryRow {
  workflow_id: string;
  version: string;
  owner_plugin: string;
  scope: string;
  meta: WorkflowMeta;
  code_hash: string;
  risk_level: "high" | "medium" | "low";
  status: string;
}

export class WorkflowRegistry {
  private readonly pool: Pool;
  private readonly audit: AuditService;

  constructor(pool: Pool, audit: AuditService) {
    this.pool = pool;
    this.audit = audit;
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    const employee = await this.loadEmployee(input.ownerPlugin);
    const meta = input.meta;
    if (meta.id !== undefined && meta.id !== input.workflowId) {
      const failures = [{ item: "meta_schema", detail: `meta.id(${meta.id}) 与 workflowId(${input.workflowId}) 不一致` }];
      await this.audit.record({
        actor: "opc_registry",
        action: "workflow.register",
        result: "denied",
        objectType: "workflow",
        objectId: `${input.workflowId}@${input.version}`,
        payload: { failures },
      });
      throw new OpcError(ERR.WF_GUARD_FAILED, `meta.id(${meta.id}) 与 workflowId(${input.workflowId}) 不一致`, 422, {
        failures,
      });
    }
    const verdict = evaluateGuard({
      meta,
      code: input.code,
      testedCodeHash: input.testedCodeHash,
      employee,
      knownViews: knownViewIds(),
      monthlyFlow: input.monthlyFlow ?? 0,
    });
    if (!verdict.ok) {
      await this.audit.record({
        actor: "opc_registry",
        action: "workflow.register",
        result: "denied",
        objectType: "workflow",
        objectId: `${input.workflowId}@${input.version}`,
        payload: { failures: verdict.failures },
      });
      throw new OpcError(ERR.WF_GUARD_FAILED, `准入守卫失败：${verdict.failures.map((f) => f.item).join(",")}`, 422, {
        failures: verdict.failures,
      });
    }
    const inserted = await this.pool.query(
      `INSERT INTO ref.workflow_registry (workflow_id, version, owner_plugin, scope, meta, code_hash, risk_level, status)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'registered')
       ON CONFLICT (workflow_id, version) DO NOTHING RETURNING id`,
      [
        input.workflowId,
        input.version,
        input.ownerPlugin,
        meta.scope,
        JSON.stringify(meta),
        codeHashOf(input.code),
        verdict.riskLevel,
      ],
    );
    if (inserted.rowCount === 0) {
      throw new OpcError(ERR.WF_CONFLICT, `流程版本已注册且不可变：${input.workflowId}@${input.version}`, 409);
    }
    await this.audit.record({
      actor: "opc_registry",
      action: "workflow.register",
      result: "ok",
      objectType: "workflow",
      objectId: `${input.workflowId}@${input.version}`,
      payload: { riskLevel: verdict.riskLevel, riskReasons: verdict.riskReasons, codeHash: codeHashOf(input.code) },
    });
    return {
      workflowId: input.workflowId,
      version: input.version,
      riskLevel: verdict.riskLevel,
      riskReasons: verdict.riskReasons,
      status: "registered",
    };
  }

  async get(workflowId: string, version?: string): Promise<RegistryRow> {
    const result = version === undefined
      ? await this.pool.query<RegistryRow>(
          "SELECT workflow_id, version, owner_plugin, scope, meta, code_hash, risk_level, status FROM ref.workflow_registry WHERE workflow_id = $1 ORDER BY registered_at DESC, id DESC LIMIT 1",
          [workflowId],
        )
      : await this.pool.query<RegistryRow>(
          "SELECT workflow_id, version, owner_plugin, scope, meta, code_hash, risk_level, status FROM ref.workflow_registry WHERE workflow_id = $1 AND version = $2",
          [workflowId, version],
        );
    const row = result.rows[0];
    if (row === undefined) throw new OpcError(ERR.WF_NOT_FOUND, `流程未注册：${workflowId}${version ? `@${version}` : ""}`, 404);
    return row;
  }

  /** 只读：给运维/看板用的风险预览（不写库）。 */
  previewRisk(meta: WorkflowMeta, employee: EmployeeProfile, monthlyFlow?: number) {
    return computeRisk({ meta, employee, monthlyFlow });
  }

  private async loadEmployee(pluginId: string): Promise<EmployeeProfile> {
    const result = await this.pool.query<{
      plugin_id: string;
      scope: "single" | "cross";
      required_views: string[];
      tools: string[];
      write_targets: string[];
      enabled: boolean;
    }>("SELECT plugin_id, scope, required_views, tools, write_targets, enabled FROM ref.employee_plugin WHERE plugin_id = $1", [pluginId]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new OpcError(ERR.WF_GUARD_FAILED, `员工插件未注册：${pluginId}`, 422, {
        failures: [{ item: "isolation", detail: `员工插件 ${pluginId} 未在 ref.employee_plugin 注册` }],
      });
    }
    return {
      pluginId: row.plugin_id,
      scope: row.scope,
      requiredViews: row.required_views ?? [],
      tools: row.tools ?? [],
      writeTargets: row.write_targets ?? [],
      enabled: row.enabled,
    };
  }
}
