/**
 * 项目监理——软件研发要素服务（SRS-105 REQ-PRJ-016..022）。
 *
 * 边界：只做登记、查询与状态流转；不执行 Git/SVN 同步、不直连 SSH、不推送制品。
 * 凭据一律只存 auth_ref 引用，拒绝疑似明文口令；发布执行与回滚由 Phase 2 执行器接入。
 */
import type { Pool } from "../../db/pool.ts";
import type { AuditService } from "../../audit/audit.ts";
import { OpcError, ERR } from "../../platform/errors.ts";

type Row = Record<string, unknown>;

const REPO_KINDS = new Set(["git", "svn"]);
const SYNC_MODES = new Set(["manual", "schedule", "webhook"]);
const ARTIFACT_KINDS = new Set(["maven", "docker", "npm", "other"]);
const ENV_TYPES = new Set(["dev", "test", "staging", "prod"]);
const TEST_RESULTS = new Set(["passed", "failed", "blocked", "skipped"]);
const AUTH_REF = /^(env|secret|vault|ssh-agent):[A-Za-z0-9_./-]+$/;

function camelize(row: Row): Row {
  const output: Row = {};
  for (const [key, value] of Object.entries(row)) {
    output[key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = value;
  }
  return output;
}

function asInt(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new OpcError(ERR.PRJ_INVALID, `${field} 必须是正整数`, 400);
  return parsed;
}

function reqString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new OpcError(ERR.PRJ_INVALID, `${field} 必须是非空字符串`, 400);
  return value.trim();
}

function optString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new OpcError(ERR.PRJ_INVALID, `${field} 必须是字符串`, 400);
  return value.trim();
}

function enumValue(value: unknown, field: string, allowed: Set<string>): string {
  const text = reqString(value, field);
  if (!allowed.has(text)) throw new OpcError(ERR.PRJ_INVALID, `${field} 取值非法：${text}`, 400);
  return text;
}

function authRef(value: unknown): string | null {
  const text = optString(value, "authRef");
  if (text === null) return null;
  if (!AUTH_REF.test(text)) {
    throw new OpcError(ERR.PRJ_AUTH_REF, "authRef 必须是 env:/secret:/vault:/ssh-agent: 引用，禁止明文凭据", 400);
  }
  return text;
}

function isoDate(value: unknown, field: string): string {
  const text = reqString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new OpcError(ERR.PRJ_INVALID, `${field} 必须是 YYYY-MM-DD`, 400);
  }
  return text;
}

export class ProjectSoftwareService {
  private readonly pool: Pool;
  private readonly audit: AuditService;

  constructor(pool: Pool, audit: AuditService) {
    this.pool = pool;
    this.audit = audit;
  }

  private async assertProject(projectId: number): Promise<void> {
    const result = await this.pool.query("SELECT 1 FROM biz.project WHERE id = $1", [projectId]);
    if (result.rows.length === 0) throw new OpcError(ERR.PRJ_INVALID, `项目不存在：${projectId}`, 404);
  }

  private async record(action: string, objectType: string, objectId: number | string, payload: unknown, actor = "opc_project"): Promise<void> {
    await this.audit.record({ actor, action, result: "ok", objectType, objectId: String(objectId), payload });
  }

  async listMilestones(projectId: number): Promise<Row[]> {
    await this.assertProject(projectId);
    const result = await this.pool.query("SELECT * FROM biz.project_milestone WHERE project_id = $1 ORDER BY target_date, id", [projectId]);
    return result.rows.map(camelize);
  }

  async createMilestone(projectId: number, input: Row): Promise<Row> {
    await this.assertProject(projectId);
    const name = reqString(input.name, "name");
    const targetDate = isoDate(input.targetDate, "targetDate");
    const status = input.status === undefined ? "planned" : enumValue(input.status, "status", new Set(["planned", "in_progress", "achieved", "delayed", "cancelled"]));
    const result = await this.pool.query(
      `INSERT INTO biz.project_milestone (project_id, name, stage, target_date, actual_date, status, owner, dependencies, evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [projectId, name, optString(input.stage, "stage"), targetDate, input.actualDate === undefined ? null : isoDate(input.actualDate, "actualDate"), status, optString(input.owner, "owner"), input.dependencies ?? null, optString(input.evidence, "evidence")],
    );
    const row = camelize(result.rows[0]);
    await this.record("project.milestone.create", "ProjectMilestone", row.id as number, { projectId, name, targetDate });
    return row;
  }

  async listRepositories(projectId: number): Promise<Row[]> {
    await this.assertProject(projectId);
    const result = await this.pool.query("SELECT * FROM ref.code_repository WHERE project_id = $1 ORDER BY id", [projectId]);
    return result.rows.map(camelize);
  }

  async createRepository(projectId: number, input: Row): Promise<Row> {
    await this.assertProject(projectId);
    const name = reqString(input.name, "name");
    const kind = enumValue(input.kind, "kind", REPO_KINDS);
    const url = reqString(input.url, "url");
    const syncMode = input.syncMode === undefined ? "manual" : enumValue(input.syncMode, "syncMode", SYNC_MODES);
    const result = await this.pool.query(
      `INSERT INTO ref.code_repository (project_id, name, kind, url, default_ref, auth_ref, sync_mode, sync_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
      [projectId, name, kind, url, optString(input.defaultRef, "defaultRef"), authRef(input.authRef), syncMode],
    );
    const row = camelize(result.rows[0]);
    await this.record("project.repository.register", "CodeRepository", row.id as number, { projectId, name, kind, syncMode });
    return row;
  }

  async listArtifacts(projectId: number): Promise<Row[]> {
    await this.assertProject(projectId);
    const result = await this.pool.query("SELECT * FROM ref.artifact_repository WHERE project_id = $1 ORDER BY id", [projectId]);
    return result.rows.map(camelize);
  }

  async createArtifact(projectId: number, input: Row): Promise<Row> {
    await this.assertProject(projectId);
    const name = reqString(input.name, "name");
    const kind = enumValue(input.kind, "kind", ARTIFACT_KINDS);
    const url = reqString(input.url, "url");
    const result = await this.pool.query(
      `INSERT INTO ref.artifact_repository (project_id, name, kind, url, namespace, auth_ref, retention_policy, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active') RETURNING *`,
      [projectId, name, kind, url, optString(input.namespace, "namespace"), authRef(input.authRef), input.retentionPolicy ?? null],
    );
    const row = camelize(result.rows[0]);
    await this.record("project.artifact.register", "ArtifactRepository", row.id as number, { projectId, name, kind });
    return row;
  }

  async listEnvironments(projectId: number): Promise<Row[]> {
    await this.assertProject(projectId);
    const result = await this.pool.query("SELECT * FROM ref.deploy_environment WHERE project_id = $1 ORDER BY env_type, id", [projectId]);
    return result.rows.map(camelize);
  }

  async createEnvironment(projectId: number, input: Row): Promise<Row> {
    await this.assertProject(projectId);
    const envType = enumValue(input.envType, "envType", ENV_TYPES);
    const approvalPolicy = input.approvalPolicy === undefined ? (envType === "prod" ? "manual" : "auto") : enumValue(input.approvalPolicy, "approvalPolicy", new Set(["auto", "manual"]));
    if (envType === "prod" && approvalPolicy !== "manual") {
      throw new OpcError(ERR.PRJ_INVALID, "生产环境必须使用 manual 审批策略", 400);
    }
    const port = input.port === undefined ? 22 : asInt(input.port, "port");
    if (port > 65535) throw new OpcError(ERR.PRJ_INVALID, "port 必须在 1–65535", 400);
    const result = await this.pool.query(
      `INSERT INTO ref.deploy_environment (project_id, env_type, name, host, port, ssh_user, auth_ref, jump_host_ref, isolation_level, approval_policy, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active') RETURNING *`,
      [projectId, envType, reqString(input.name, "name"), reqString(input.host, "host"), port, reqString(input.sshUser, "sshUser"), authRef(input.authRef), optString(input.jumpHostRef, "jumpHostRef"), input.isolationLevel === undefined ? "shared" : enumValue(input.isolationLevel, "isolationLevel", new Set(["shared", "dedicated"])), approvalPolicy],
    );
    const row = camelize(result.rows[0]);
    await this.record("project.environment.register", "DeployEnvironment", row.id as number, { projectId, envType, name: row.name, approvalPolicy });
    return row;
  }

  async listReleases(projectId: number): Promise<Row[]> {
    await this.assertProject(projectId);
    const result = await this.pool.query("SELECT * FROM biz.release_order WHERE project_id = $1 ORDER BY id DESC", [projectId]);
    return result.rows.map(camelize);
  }

  async createRelease(projectId: number, input: Row): Promise<Row> {
    await this.assertProject(projectId);
    const environmentId = asInt(input.environmentId, "environmentId");
    const env = await this.pool.query<{ env_type: string; approval_policy: string }>(
      "SELECT env_type, approval_policy FROM ref.deploy_environment WHERE id = $1 AND project_id = $2",
      [environmentId, projectId],
    );
    if (env.rows.length === 0) throw new OpcError(ERR.PRJ_INVALID, `环境不存在或不属于项目：${environmentId}`, 404);
    const environment = env.rows[0];
    const rollbackVersion = optString(input.rollbackVersion, "rollbackVersion");
    if (environment.env_type === "prod" && rollbackVersion === null) {
      throw new OpcError(ERR.PRJ_INVALID, "生产发布必须填写 rollbackVersion", 400);
    }
    const auto = environment.approval_policy === "auto";
    const result = await this.pool.query(
      `INSERT INTO biz.release_order (project_id, environment_id, version, artifact_refs, repo_refs, change_note, rollback_version, requested_by, approved_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [projectId, environmentId, reqString(input.version, "version"), input.artifactRefs ?? null, input.repoRefs ?? null, optString(input.changeNote, "changeNote"), rollbackVersion, reqString(input.requestedBy, "requestedBy"), auto ? "policy:auto" : null, auto ? "approved" : "pending"],
    );
    const row = camelize(result.rows[0]);
    await this.record("project.release.create", "ReleaseOrder", row.id as number, { projectId, environmentId, version: row.version, status: row.status });
    return row;
  }

  async approveRelease(releaseId: number, input: Row): Promise<Row> {
    const approver = reqString(input.approver, "approver");
    const existing = await this.pool.query<{ status: string }>("SELECT status FROM biz.release_order WHERE id = $1", [releaseId]);
    if (existing.rows.length === 0) throw new OpcError(ERR.PRJ_INVALID, `发布单不存在：${releaseId}`, 404);
    if (existing.rows[0].status !== "pending") {
      throw new OpcError(ERR.PRJ_RELEASE_STATE, `发布单当前状态不可审批：${existing.rows[0].status}`, 409);
    }
    const result = await this.pool.query(
      "UPDATE biz.release_order SET status = 'approved', approved_by = $2 WHERE id = $1 RETURNING *",
      [releaseId, approver],
    );
    const row = camelize(result.rows[0]);
    await this.record("project.release.approve", "ReleaseOrder", releaseId, { approver }, approver);
    return row;
  }

  async createTestPlan(projectId: number, input: Row): Promise<Row> {
    await this.assertProject(projectId);
    const result = await this.pool.query(
      `INSERT INTO biz.test_plan (project_id, version, scope, test_types, entry_criteria, exit_criteria, environment_id, owner, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft') RETURNING *`,
      [projectId, reqString(input.version, "version"), optString(input.scope, "scope"), input.testTypes ?? null, optString(input.entryCriteria, "entryCriteria"), optString(input.exitCriteria, "exitCriteria"), input.environmentId === undefined ? null : asInt(input.environmentId, "environmentId"), optString(input.owner, "owner"), input.startDate === undefined ? null : isoDate(input.startDate, "startDate"), input.endDate === undefined ? null : isoDate(input.endDate, "endDate")],
    );
    const row = camelize(result.rows[0]);
    await this.record("project.test.plan.create", "TestPlan", row.id as number, { projectId, version: row.version });
    return row;
  }

  async createTestRun(projectId: number, input: Row): Promise<Row> {
    await this.assertProject(projectId);
    const executorType = input.executorType === undefined ? "human" : enumValue(input.executorType, "executorType", new Set(["human", "agent", "ci"]));
    const result = await this.pool.query(
      `INSERT INTO biz.test_run (project_id, plan_id, suite_id, environment_id, version, executor, executor_type, started_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now(),'running') RETURNING *`,
      [projectId, input.planId === undefined ? null : asInt(input.planId, "planId"), input.suiteId === undefined ? null : asInt(input.suiteId, "suiteId"), input.environmentId === undefined ? null : asInt(input.environmentId, "environmentId"), reqString(input.version, "version"), reqString(input.executor, "executor"), executorType],
    );
    const row = camelize(result.rows[0]);
    await this.record("project.test.run.create", "TestRun", row.id as number, { projectId, version: row.version, executorType });
    return row;
  }

  async recordResult(runId: number, input: Row): Promise<Row> {
    const caseId = asInt(input.caseId, "caseId");
    const result = enumValue(input.result, "result", TEST_RESULTS);
    const run = await this.pool.query<{ project_id: number; status: string }>("SELECT project_id, status FROM biz.test_run WHERE id = $1", [runId]);
    if (run.rows.length === 0) throw new OpcError(ERR.PRJ_INVALID, `测试批次不存在：${runId}`, 404);
    const inserted = await this.pool.query(
      `INSERT INTO biz.test_result (run_id, case_id, result, evidence, failure_reason, executed_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (run_id, case_id) DO UPDATE SET result = EXCLUDED.result, evidence = EXCLUDED.evidence, failure_reason = EXCLUDED.failure_reason, executed_at = now()
       RETURNING *`,
      [runId, caseId, result, optString(input.evidence, "evidence"), optString(input.failureReason, "failureReason")],
    );
    const failed = result === "failed" || result === "blocked";
    await this.pool.query(
      `UPDATE biz.test_run SET status = $2, ended_at = CASE WHEN $2 IN ('passed','failed','blocked') THEN now() ELSE ended_at END WHERE id = $1`,
      [runId, failed ? "failed" : "passed"],
    );
    const row = camelize(inserted.rows[0]);
    await this.record("project.test.result.record", "TestResult", row.id as number, { runId, caseId, result });
    return row;
  }

  async listDefects(projectId: number): Promise<Row[]> {
    await this.assertProject(projectId);
    const result = await this.pool.query("SELECT * FROM biz.defect WHERE project_id = $1 ORDER BY severity, id DESC", [projectId]);
    return result.rows.map(camelize);
  }
}
