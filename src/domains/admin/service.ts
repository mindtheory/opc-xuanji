import type { Pool } from "../../db/pool.ts";
import type { AuditService } from "../../audit/audit.ts";
import { OpcError, ERR, type ErrorCode } from "../../platform/errors.ts";
import type { ProjectSoftwareService } from "../project/software.ts";
import type { IntelPipelineService } from "../intel/daily.ts";

type Row = Record<string, unknown>;
type Domain = "project" | "intel" | "admin";
type FieldType = "string" | "int" | "number" | "bool" | "json" | "date" | "enum" | "authRef";

interface FieldDef {
  key: string;
  column: string;
  type: FieldType;
  required?: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  regex?: RegExp;
  message?: string;
}

interface ResourceDef {
  key: string;
  table: string;
  projectColumn: string | null;
  fields: FieldDef[];
  orderBy: string;
  object: string;
  label: string;
  domain: Domain;
}

const AUTH_REF = /^(env|secret|vault|ssh-agent):[A-Za-z0-9_./-]+$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function camelize(row: Row): Row {
  const output: Row = {};
  for (const [key, value] of Object.entries(row)) {
    output[key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = value;
  }
  return output;
}

function given(input: Row, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function optString(value: unknown, field: string, domain: Domain): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw invalid(domain, `${field} 必须是字符串`);
  const text = value.trim();
  return text === "" ? null : text;
}

function reqString(value: unknown, field: string, domain: Domain): string {
  const text = optString(value, field, domain);
  if (text === null) throw invalid(domain, `${field} 必须是非空字符串`);
  return text;
}

function asInt(value: unknown, field: string, domain: Domain, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw invalid(domain, `${field} 必须是 ${min}–${max} 的整数`);
  }
  return parsed;
}

function asNumber(value: unknown, field: string, domain: Domain, min = -Infinity, max = Infinity): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw invalid(domain, `${field} 必须是 ${min}–${max} 的数字`);
  }
  return parsed;
}

function asBool(value: unknown, field: string, domain: Domain): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw invalid(domain, `${field} 必须是布尔值`);
}

function asJson(value: unknown, field: string, domain: Domain): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") throw invalid(domain, `${field} 必须是 JSON`);
  const text = value.trim();
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    throw invalid(domain, `${field} 不是合法 JSON`);
  }
}

function codeOf(domain: Domain, project: keyof typeof ERR, intel: keyof typeof ERR, admin: keyof typeof ERR): ErrorCode {
  return ERR[domain === "project" ? project : domain === "admin" ? admin : intel];
}

function invalid(domain: Domain, message: string, status = 400): OpcError {
  return new OpcError(codeOf(domain, "PRJ_INVALID", "INT_INVALID", "RES_INVALID"), message, status);
}

function notFound(domain: Domain, message: string): OpcError {
  return new OpcError(codeOf(domain, "PRJ_INVALID", "INT_NOT_FOUND", "RES_NOT_FOUND"), message, 404);
}

function coerce(field: FieldDef, value: unknown, domain: Domain): unknown {
  if (value === undefined || value === null) {
    if (field.required) throw invalid(domain, `${field.key} 为必填项`);
    return null;
  }
  switch (field.type) {
    case "string": {
      const text = typeof value === "string" ? value.trim() : String(value).trim();
      if (text === "") {
        if (field.required) throw invalid(domain, `${field.key} 为必填项`);
        return null;
      }
      if (field.regex && !field.regex.test(text)) throw invalid(domain, field.message ?? `${field.key} 格式非法`);
      return text;
    }
    case "int":
      return asInt(value, field.key, domain, field.min, field.max);
    case "number":
      return asNumber(value, field.key, domain, field.min, field.max);
    case "bool":
      return asBool(value, field.key, domain);
    case "json":
      return asJson(value, field.key, domain);
    case "date": {
      const text = typeof value === "string" ? value.trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
        throw invalid(domain, `${field.key} 必须是 YYYY-MM-DD`);
      }
      return text;
    }
    case "enum": {
      const text = typeof value === "string" ? value.trim() : String(value);
      if (!(field.enum ?? []).includes(text)) throw invalid(domain, `${field.key} 取值非法：${text}`);
      return text;
    }
    case "authRef": {
      const text = typeof value === "string" ? value.trim() : "";
      if (text === "") return null;
      if (!AUTH_REF.test(text)) {
        throw new OpcError(codeOf(domain, "PRJ_AUTH_REF", "INT_INVALID", "RES_CRED"), "凭据只接受 env:/secret:/vault:/ssh-agent: 引用", 400);
      }
      return text;
    }
    default:
      return value;
  }
}

const PROJECT_FIELDS: FieldDef[] = [
  { key: "name", column: "name", type: "string", required: true },
  { key: "projectType", column: "project_type", type: "string" },
  { key: "stage", column: "stage", type: "string", required: true },
  { key: "progress", column: "progress", type: "int", min: 0, max: 100 },
  { key: "startDate", column: "start_date", type: "date" },
  { key: "targetEndDate", column: "target_end_date", type: "date" },
  { key: "actualStartDate", column: "actual_start_date", type: "date" },
  { key: "actualEndDate", column: "actual_end_date", type: "date" },
  { key: "timezone", column: "timezone", type: "string" },
  { key: "workCalendar", column: "work_calendar", type: "json" },
  { key: "techStack", column: "tech_stack", type: "json" },
  { key: "softwareProfile", column: "software_profile", type: "json" },
  { key: "costActual", column: "cost_actual", type: "number" },
  { key: "blockers", column: "blockers", type: "json" },
];

const PROJECT_DEF: ResourceDef = {
  key: "projects",
  table: "biz.project",
  projectColumn: null,
  fields: PROJECT_FIELDS,
  orderBy: "id DESC",
  object: "Project",
  label: "项目",
  domain: "project",
};

const PROJECT_RESOURCES: Record<string, ResourceDef> = {
  milestones: {
    key: "milestones",
    table: "biz.project_milestone",
    projectColumn: "project_id",
    orderBy: "target_date, id",
    object: "ProjectMilestone",
    label: "里程碑",
    domain: "project",
    fields: [
      { key: "name", column: "name", type: "string", required: true },
      { key: "stage", column: "stage", type: "string" },
      { key: "targetDate", column: "target_date", type: "date", required: true },
      { key: "actualDate", column: "actual_date", type: "date" },
      { key: "status", column: "status", type: "enum", enum: ["planned", "in_progress", "achieved", "delayed", "cancelled"] },
      { key: "owner", column: "owner", type: "string" },
      { key: "dependencies", column: "dependencies", type: "json" },
      { key: "evidence", column: "evidence", type: "string" },
    ],
  },
  repositories: {
    key: "repositories",
    table: "ref.code_repository",
    projectColumn: "project_id",
    orderBy: "id",
    object: "CodeRepository",
    label: "版本库",
    domain: "project",
    fields: [
      { key: "name", column: "name", type: "string", required: true },
      { key: "kind", column: "kind", type: "enum", enum: ["git", "svn"], required: true },
      { key: "url", column: "url", type: "string", required: true },
      { key: "defaultRef", column: "default_ref", type: "string" },
      { key: "authRef", column: "auth_ref", type: "authRef" },
      { key: "syncMode", column: "sync_mode", type: "enum", enum: ["manual", "schedule", "webhook"] },
      { key: "syncStatus", column: "sync_status", type: "enum", enum: ["pending", "synced", "failed", "disabled"] },
    ],
  },
  artifacts: {
    key: "artifacts",
    table: "ref.artifact_repository",
    projectColumn: "project_id",
    orderBy: "id",
    object: "ArtifactRepository",
    label: "制品库",
    domain: "project",
    fields: [
      { key: "name", column: "name", type: "string", required: true },
      { key: "kind", column: "kind", type: "enum", enum: ["maven", "docker", "npm", "other"], required: true },
      { key: "url", column: "url", type: "string", required: true },
      { key: "namespace", column: "namespace", type: "string" },
      { key: "authRef", column: "auth_ref", type: "authRef" },
      { key: "retentionPolicy", column: "retention_policy", type: "json" },
      { key: "status", column: "status", type: "enum", enum: ["active", "disabled"] },
    ],
  },
  environments: {
    key: "environments",
    table: "ref.deploy_environment",
    projectColumn: "project_id",
    orderBy: "env_type, id",
    object: "DeployEnvironment",
    label: "部署环境",
    domain: "project",
    fields: [
      { key: "envType", column: "env_type", type: "enum", enum: ["dev", "test", "staging", "prod"], required: true },
      { key: "name", column: "name", type: "string", required: true },
      { key: "host", column: "host", type: "string", required: true },
      { key: "port", column: "port", type: "int", min: 1, max: 65535 },
      { key: "sshUser", column: "ssh_user", type: "string", required: true },
      { key: "authRef", column: "auth_ref", type: "authRef" },
      { key: "jumpHostRef", column: "jump_host_ref", type: "string" },
      { key: "isolationLevel", column: "isolation_level", type: "enum", enum: ["shared", "dedicated"] },
      { key: "approvalPolicy", column: "approval_policy", type: "enum", enum: ["auto", "manual"] },
      { key: "status", column: "status", type: "enum", enum: ["active", "disabled"] },
    ],
  },
  "test-plans": {
    key: "test-plans",
    table: "biz.test_plan",
    projectColumn: "project_id",
    orderBy: "id DESC",
    object: "TestPlan",
    label: "测试计划",
    domain: "project",
    fields: [
      { key: "version", column: "version", type: "string", required: true },
      { key: "scope", column: "scope", type: "string" },
      { key: "testTypes", column: "test_types", type: "json" },
      { key: "entryCriteria", column: "entry_criteria", type: "string" },
      { key: "exitCriteria", column: "exit_criteria", type: "string" },
      { key: "environmentId", column: "environment_id", type: "int" },
      { key: "owner", column: "owner", type: "string" },
      { key: "startDate", column: "start_date", type: "date" },
      { key: "endDate", column: "end_date", type: "date" },
      { key: "status", column: "status", type: "enum", enum: ["draft", "active", "closed", "cancelled"] },
    ],
  },
  "test-cases": {
    key: "test-cases",
    table: "biz.test_case",
    projectColumn: "project_id",
    orderBy: "id DESC",
    object: "TestCase",
    label: "测试用例",
    domain: "project",
    fields: [
      { key: "caseCode", column: "case_code", type: "string", required: true },
      { key: "title", column: "title", type: "string", required: true },
      { key: "preconditions", column: "preconditions", type: "string" },
      { key: "steps", column: "steps", type: "json" },
      { key: "expected", column: "expected", type: "string" },
      { key: "priority", column: "priority", type: "enum", enum: ["P0", "P1", "P2", "P3"] },
      { key: "kind", column: "kind", type: "enum", enum: ["manual", "auto"] },
      { key: "requirementRef", column: "requirement_ref", type: "string" },
      { key: "version", column: "version", type: "string" },
      { key: "status", column: "status", type: "enum", enum: ["draft", "approved", "deprecated"] },
    ],
  },
  "test-suites": {
    key: "test-suites",
    table: "biz.test_suite",
    projectColumn: "project_id",
    orderBy: "id DESC",
    object: "TestSuite",
    label: "测试套件",
    domain: "project",
    fields: [
      { key: "name", column: "name", type: "string", required: true },
      { key: "caseIds", column: "case_ids", type: "json" },
      { key: "environmentId", column: "environment_id", type: "int" },
      { key: "status", column: "status", type: "enum", enum: ["active", "disabled"] },
    ],
  },
  defects: {
    key: "defects",
    table: "biz.defect",
    projectColumn: "project_id",
    orderBy: "severity, id DESC",
    object: "Defect",
    label: "缺陷",
    domain: "project",
    fields: [
      { key: "severity", column: "severity", type: "enum", enum: ["S1", "S2", "S3", "S4"], required: true },
      { key: "title", column: "title", type: "string", required: true },
      { key: "reproSteps", column: "repro_steps", type: "string" },
      { key: "affectedVersion", column: "affected_version", type: "string" },
      { key: "testCaseId", column: "test_case_id", type: "int" },
      { key: "requirementRef", column: "requirement_ref", type: "string" },
      { key: "owner", column: "owner", type: "string" },
      { key: "status", column: "status", type: "enum", enum: ["open", "in_progress", "resolved", "closed", "reopened"] },
      { key: "regressionResult", column: "regression_result", type: "string" },
    ],
  },
  "work-logs": {
    key: "work-logs",
    table: "biz.work_log",
    projectColumn: "project_id",
    orderBy: "work_date DESC, id DESC",
    object: "WorkLog",
    label: "工时",
    domain: "project",
    fields: [
      { key: "worker", column: "worker", type: "string", required: true },
      { key: "workDate", column: "work_date", type: "date", required: true },
      { key: "hours", column: "hours", type: "number", required: true, min: 0.01, max: 24 },
      { key: "source", column: "source", type: "enum", enum: ["manual", "import", "agent"] },
      { key: "note", column: "note", type: "string" },
      { key: "taskId", column: "task_id", type: "int" },
    ],
  },
};

const INTEL_RESOURCES: Record<string, ResourceDef> = {
  scopes: {
    key: "scopes",
    table: "biz.intel_project_scope",
    projectColumn: "project_id",
    orderBy: "project_id",
    object: "IntelProjectScope",
    label: "情报空间",
    domain: "intel",
    fields: [
      { key: "name", column: "name", type: "string", required: true },
      { key: "timezone", column: "timezone", type: "string" },
      { key: "briefTime", column: "brief_time", type: "string", regex: TIME, message: "briefTime 必须是 HH:MM" },
      { key: "lookbackHours", column: "lookback_hours", type: "int", min: 1, max: 720 },
      { key: "maxItems", column: "max_items", type: "int", min: 1, max: 200 },
      { key: "pushChannels", column: "push_channels", type: "json" },
      { key: "recipients", column: "recipients", type: "json" },
      { key: "quietHours", column: "quiet_hours", type: "json" },
      { key: "template", column: "template", type: "string" },
      { key: "status", column: "status", type: "enum", enum: ["active", "disabled"] },
      { key: "configVersion", column: "config_version", type: "string" },
    ],
  },
  sources: {
    key: "sources",
    table: "biz.source",
    projectColumn: null,
    orderBy: "id",
    object: "Source",
    label: "数据源",
    domain: "intel",
    fields: [
      { key: "name", column: "name", type: "string", required: true },
      { key: "sourceType", column: "source_type", type: "enum", enum: ["rss", "api", "web", "search", "mcp", "manual"], required: true },
      { key: "url", column: "url", type: "string" },
      { key: "authRef", column: "auth_ref", type: "authRef" },
      { key: "credibility", column: "credibility", type: "number", min: 0, max: 1 },
      { key: "copyrightStatus", column: "copyright_status", type: "enum", enum: ["licensed", "public", "unknown", "restricted"] },
      { key: "licenseNote", column: "license_note", type: "string" },
      { key: "collectIntervalMinutes", column: "collect_interval_minutes", type: "int", min: 5, max: 10080 },
      { key: "rateLimitPerHour", column: "rate_limit_per_hour", type: "int", min: 1, max: 10000 },
      { key: "timeoutMs", column: "timeout_ms", type: "int", min: 1000, max: 300000 },
      { key: "enabled", column: "enabled", type: "bool" },
      { key: "status", column: "status", type: "enum", enum: ["active", "disabled", "blocked"] },
    ],
  },
  bindings: {
    key: "bindings",
    table: "biz.source_binding",
    projectColumn: "project_id",
    orderBy: "priority, id",
    object: "SourceBinding",
    label: "来源绑定",
    domain: "intel",
    fields: [
      { key: "sourceId", column: "source_id", type: "int", required: true },
      { key: "enabled", column: "enabled", type: "bool" },
      { key: "priority", column: "priority", type: "int", min: 1, max: 1000 },
      { key: "tags", column: "tags", type: "json" },
    ],
  },
  topics: {
    key: "topics",
    table: "biz.watch_topic",
    projectColumn: "project_id",
    orderBy: "priority DESC, id",
    object: "WatchTopic",
    label: "关注主题",
    domain: "intel",
    fields: [
      { key: "keyword", column: "keyword", type: "string", required: true },
      { key: "matchType", column: "match_type", type: "enum", enum: ["exact", "phrase", "regex", "boolean"] },
      { key: "synonyms", column: "synonyms", type: "json" },
      { key: "excludeTerms", column: "exclude_terms", type: "json" },
      { key: "tags", column: "tags", type: "json" },
      { key: "priority", column: "priority", type: "int", min: 1, max: 1000 },
      { key: "enabled", column: "enabled", type: "bool" },
      { key: "version", column: "version", type: "int" },
    ],
  },
  tags: {
    key: "tags",
    table: "biz.intel_tag",
    projectColumn: "project_id",
    orderBy: "id",
    object: "IntelTag",
    label: "标签",
    domain: "intel",
    fields: [
      { key: "name", column: "name", type: "string", required: true },
      { key: "category", column: "category", type: "string" },
      { key: "parentId", column: "parent_id", type: "int" },
      { key: "color", column: "color", type: "string" },
      { key: "description", column: "description", type: "string" },
      { key: "status", column: "status", type: "enum", enum: ["active", "disabled"] },
    ],
  },
};

/** 公司级基础资源（跨项目共享，不属于单项目）。 */
const SHARED_KINDS = ["code_repo", "artifact_repo", "test_server", "nas", "public_server", "domain"] as const;
const SHARED_ACCESS = ["ssh", "rdp", "sunlogin", "https", "console", "smb", "nfs", "api"] as const;
/** 服务器类资源：缺省按公司口径落 debian + ssh。 */
const SERVER_KINDS = new Set(["test_server", "public_server"]);

/** 基础资源目录（公司级，无 projectColumn）。 */
const SHARED_DEF: ResourceDef = {
  key: "shared-resources",
  table: "ref.shared_resource",
  projectColumn: null,
  orderBy: "kind, is_default DESC, id",
  object: "SharedResource",
  label: "基础资源",
  domain: "admin",
  fields: [
    { key: "kind", column: "kind", type: "enum", enum: [...SHARED_KINDS], required: true },
    { key: "name", column: "name", type: "string", required: true },
    { key: "code", column: "code", type: "string" },
    { key: "endpoint", column: "endpoint", type: "string" },
    { key: "accessMethod", column: "access_method", type: "enum", enum: [...SHARED_ACCESS] },
    { key: "defaultAccount", column: "default_account", type: "string" },
    { key: "credentialRef", column: "credential_ref", type: "authRef" },
    { key: "os", column: "os", type: "string" },
    { key: "location", column: "location", type: "string" },
    { key: "capacity", column: "capacity", type: "string" },
    { key: "specs", column: "specs", type: "json" },
    { key: "tags", column: "tags", type: "json" },
    { key: "isDefault", column: "is_default", type: "bool" },
    { key: "status", column: "status", type: "enum", enum: ["active", "disabled"] },
    { key: "notes", column: "notes", type: "string" },
  ],
};

export class AdminService {
  private readonly pool: Pool;
  private readonly audit: AuditService;
  private readonly software: ProjectSoftwareService;
  private readonly intel: IntelPipelineService;

  constructor(pool: Pool, audit: AuditService, software: ProjectSoftwareService, intel: IntelPipelineService) {
    this.pool = pool;
    this.audit = audit;
    this.software = software;
    this.intel = intel;
  }

  private async record(action: string, object: string, objectId: number | string, payload: unknown): Promise<void> {
    await this.audit.record({ actor: "boss", action, result: "ok", objectType: object, objectId: String(objectId), payload });
  }

  private async assertProject(projectId: number): Promise<void> {
    const result = await this.pool.query("SELECT 1 FROM biz.project WHERE id = $1", [projectId]);
    if (result.rows.length === 0) throw notFound("project", `项目不存在：${projectId}`);
  }

  private requireProject(projectId: number | null | undefined, domain: Domain): number {
    if (projectId === undefined || projectId === null) throw invalid(domain, "projectId 必须提供");
    return asInt(projectId, "projectId", domain);
  }

  private async insert(def: ResourceDef, projectId: number | null, input: Row): Promise<Row> {
    const columns: string[] = [];
    const params: unknown[] = [];
    if (def.projectColumn !== null) {
      if (projectId === null) throw invalid(def.domain, "projectId 必须提供");
      columns.push(def.projectColumn);
      params.push(projectId);
    }
    for (const field of def.fields) {
      if (!given(input, field.key)) continue;
      const value = coerce(field, input[field.key], def.domain);
      columns.push(field.column);
      params.push(value);
    }
    if (columns.length === 0) throw invalid(def.domain, "没有可写入字段");
    const placeholders = params.map((_value, index) => `$${index + 1}`).join(",");
    const result = await this.pool.query(
      `INSERT INTO ${def.table} (${columns.join(",")}) VALUES (${placeholders}) RETURNING *`,
      params,
    );
    const row = camelize(result.rows[0] as Row);
    await this.record(`${def.key}.create`, def.object, row.id as number, {
      projectId,
      fields: def.fields.filter((field) => given(input, field.key)).map((field) => field.column),
    });
    return row;
  }

  private async updateRow(def: ResourceDef, projectId: number | null, id: number, input: Row): Promise<Row> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const field of def.fields) {
      if (!given(input, field.key)) continue;
      params.push(coerce(field, input[field.key], def.domain));
      sets.push(`${field.column} = $${params.length}`);
    }
    if (sets.length === 0) throw invalid(def.domain, "没有可更新字段");
    params.push(id);
    let sql = `UPDATE ${def.table} SET ${sets.join(",")} WHERE id = $${params.length}`;
    if (def.projectColumn !== null) {
      if (projectId === null) throw invalid(def.domain, "projectId 必须提供");
      params.push(projectId);
      sql += ` AND ${def.projectColumn} = $${params.length}`;
    }
    sql += " RETURNING *";
    const result = await this.pool.query(sql, params);
    const row = result.rows[0] as Row | undefined;
    if (row === undefined) throw notFound(def.domain, `${def.label}不存在：${id}`);
    const shaped = camelize(row);
    await this.record(`${def.key}.update`, def.object, id, {
      projectId,
      fields: def.fields.filter((field) => given(input, field.key)).map((field) => field.column),
    });
    return shaped;
  }

  private async guardDelete(def: ResourceDef, projectId: number | null, id: number): Promise<void> {
    const checks: Record<string, { sql: string; params: unknown[]; message: string }> = {
      environments: {
        sql: "SELECT 1 FROM biz.release_order WHERE environment_id = $1 LIMIT 1",
        params: [id],
        message: "该环境已被发布单引用，不能删除",
      },
      "test-plans": {
        sql: "SELECT 1 FROM biz.test_run WHERE plan_id = $1 LIMIT 1",
        params: [id],
        message: "该测试计划已有执行批次，不能删除",
      },
      "test-cases": {
        sql: "SELECT 1 FROM biz.test_result WHERE case_id = $1 LIMIT 1",
        params: [id],
        message: "该用例已有执行结果，不能删除",
      },
      "test-suites": {
        sql: "SELECT 1 FROM biz.test_run WHERE suite_id = $1 LIMIT 1",
        params: [id],
        message: "该套件已有执行批次，不能删除",
      },
      sources: {
        sql: "SELECT 1 FROM biz.source_binding WHERE source_id = $1 LIMIT 1",
        params: [id],
        message: "该来源仍绑定项目，请先解除绑定",
      },
      scopes: {
        sql: "SELECT 1 FROM biz.intel_item WHERE project_id = $1 LIMIT 1",
        params: [projectId],
        message: "该项目已有情报条目，不能删除情报空间",
      },
    };
    const check = checks[def.key];
    if (check === undefined) return;
    const result = await this.pool.query(check.sql, check.params);
    if (result.rows.length > 0) throw invalid(def.domain, check.message, 409);
  }

  private async removeRow(def: ResourceDef, projectId: number | null, id: number): Promise<{ id: number }> {
    await this.guardDelete(def, projectId, id);
    const params: unknown[] = [id];
    let sql = `DELETE FROM ${def.table} WHERE id = $1`;
    if (def.projectColumn !== null) {
      if (projectId === null) throw invalid(def.domain, "projectId 必须提供");
      params.push(projectId);
      sql += ` AND ${def.projectColumn} = $2`;
    }
    sql += " RETURNING id";
    const result = await this.pool.query(sql, params);
    const row = result.rows[0] as { id: number } | undefined;
    if (row === undefined) throw notFound(def.domain, `${def.label}不存在：${id}`);
    await this.record(`${def.key}.delete`, def.object, id, { projectId });
    return { id: row.id };
  }

  private async select(def: ResourceDef, projectId: number | null): Promise<Row[]> {
    const params: unknown[] = [];
    let sql = `SELECT * FROM ${def.table}`;
    if (def.projectColumn !== null) {
      if (projectId === null) throw invalid(def.domain, "projectId 必须提供");
      params.push(projectId);
      sql += ` WHERE ${def.projectColumn} = $1`;
    }
    sql += ` ORDER BY ${def.orderBy} LIMIT 500`;
    const result = await this.pool.query(sql, params);
    return result.rows.map((row) => camelize(row as Row));
  }

  // ---------------- 公司基础资源（跨项目共享） ----------------

  /** 公司默认口径 + 各类型默认资源，前端「新建项目」据此预选。 */
  async sharedDefaults(): Promise<Row> {
    const [settings, resources] = await Promise.all([
      this.pool.query<{ key: string; value: unknown }>("SELECT key, value FROM ref.shared_setting ORDER BY key"),
      this.pool.query("SELECT * FROM ref.shared_resource WHERE is_default AND status = 'active' ORDER BY kind, id"),
    ]);
    const map: Record<string, unknown> = {};
    for (const row of settings.rows) map[row.key] = row.value;
    const asText = (key: string, fallback: string | null): string | null =>
      typeof map[key] === "string" ? (map[key] as string) : fallback;
    return {
      kinds: [...SHARED_KINDS],
      accessMethods: [...SHARED_ACCESS],
      defaultOs: asText("company.default_os", "debian"),
      defaultRemoteMethod: asText("company.default_remote_method", "ssh"),
      defaultAccount: asText("company.default_account", null),
      defaultCredentialRef: asText("company.default_credential_ref", null),
      defaultSshPort: typeof map["company.default_ssh_port"] === "number" ? map["company.default_ssh_port"] : 22,
      settings: map,
      resources: resources.rows.map((row) => camelize(row as Row)),
    };
  }

  async listSharedResources(kind: string | null = null, status: string | null = null): Promise<Row[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (kind !== null && kind !== "") {
      params.push(kind);
      where.push(`kind = $${params.length}`);
    }
    if (status !== null && status !== "") {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    let sql = "SELECT * FROM ref.shared_resource";
    if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
    sql += " ORDER BY kind, is_default DESC, id";
    const result = await this.pool.query(sql, params);
    return result.rows.map((row) => camelize(row as Row));
  }

  async createSharedResource(input: Row): Promise<Row> {
    const kind = reqString(input.kind, "kind", "admin");
    if (!(SHARED_KINDS as readonly string[]).includes(kind)) {
      throw invalid("admin", `kind 取值非法：${kind}（可选 ${SHARED_KINDS.join("/")}）`);
    }
    const payload: Row = { ...input };
    if (payload.accessMethod === undefined) {
      payload.accessMethod = kind === "code_repo" || kind === "artifact_repo" || kind === "domain" ? "https" : "ssh";
    }
    if (payload.os === undefined && SERVER_KINDS.has(kind)) payload.os = "debian";
    return this.insert(SHARED_DEF, null, payload);
  }

  async updateSharedResource(id: number, input: Row): Promise<Row> {
    return this.updateRow(SHARED_DEF, null, id, input);
  }

  async removeSharedResource(id: number): Promise<{ id: number }> {
    const bound = await this.pool.query("SELECT 1 FROM ref.project_shared_resource WHERE resource_id = $1 LIMIT 1", [id]);
    if (bound.rows.length > 0) throw new OpcError(ERR.RES_IN_USE, "该基础资源已被项目绑定，请先解除绑定", 409);
    return this.removeRow(SHARED_DEF, null, id);
  }

  async listProjectSharedResources(projectId: number): Promise<Row[]> {
    await this.assertProject(projectId);
    const result = await this.pool.query(
      `SELECT p.project_id, p.resource_id, p.role, p.applied_by_default,
              r.kind, r.code, r.name, r.endpoint, r.access_method, r.default_account,
              r.credential_ref, r.os, r.status, r.is_default
       FROM ref.project_shared_resource p JOIN ref.shared_resource r ON r.id = p.resource_id
       WHERE p.project_id = $1 ORDER BY r.kind, r.id`,
      [projectId],
    );
    return result.rows.map((row) => camelize(row as Row));
  }

  /** resourceIds 为 null 时按公司默认（is_default 且 active）选型。 */
  async bindProjectSharedResources(projectId: number, resourceIds: number[] | null, byDefault: boolean): Promise<number> {
    await this.assertProject(projectId);
    let ids = resourceIds;
    if (ids === null) {
      const result = await this.pool.query<{ id: string | number }>(
        "SELECT id FROM ref.shared_resource WHERE is_default AND status = 'active' ORDER BY id",
      );
      ids = result.rows.map((row) => Number(row.id));
    }
    for (const id of ids) {
      const exists = await this.pool.query<{ kind: string }>(
        "SELECT kind FROM ref.shared_resource WHERE id = $1 AND status = 'active'",
        [id],
      );
      if (exists.rows.length === 0) throw invalid("admin", `基础资源不存在或已停用：${id}`);
      await this.pool.query(
        `INSERT INTO ref.project_shared_resource (project_id, resource_id, role, applied_by_default)
         VALUES ($1, $2, 'primary', $3)
         ON CONFLICT (project_id, resource_id) DO UPDATE SET applied_by_default = EXCLUDED.applied_by_default`,
        [projectId, id, byDefault],
      );
    }
    if (ids.length > 0) await this.record("project.shared-resources.bind", "Project", projectId, { resourceIds: ids, byDefault });
    return ids.length;
  }

  async unbindProjectSharedResource(projectId: number, resourceId: number): Promise<{ id: number }> {
    await this.assertProject(projectId);
    const result = await this.pool.query(
      "DELETE FROM ref.project_shared_resource WHERE project_id = $1 AND resource_id = $2 RETURNING resource_id",
      [projectId, resourceId],
    );
    const row = result.rows[0] as { resource_id: string | number } | undefined;
    if (row === undefined) throw notFound("admin", `项目未绑定该基础资源：${resourceId}`);
    await this.record("project.shared-resources.unbind", "Project", projectId, { resourceId });
    return { id: Number(row.resource_id) };
  }

  async listProjects(): Promise<Row[]> {
    const result = await this.pool.query(
      `SELECT id, name, project_type, stage, progress, start_date, target_end_date, actual_start_date,
              actual_end_date, timezone, work_calendar, tech_stack, software_profile, cost_actual, blockers
       FROM biz.project ORDER BY id DESC LIMIT 500`,
    );
    return result.rows.map((row) => camelize(row as Row));
  }

  /**
   * 新建项目：默认从公司基础资源里「选型」——自动绑定 is_default 且 active 的资源；
   * 显式传 resourceIds 时按传入集合绑定；bindDefaults=false 时不自动绑定。
   */
  async createProject(input: Row): Promise<Row> {
    const row = await this.insert(PROJECT_DEF, null, input);
    const projectId = asInt(row.id, "projectId", "admin");
    const explicit = Array.isArray(input.resourceIds)
      ? (input.resourceIds as unknown[]).map((value) => asInt(value, "resourceIds", "admin"))
      : null;
    if (input.bindDefaults !== false) {
      row.sharedResourcesBound = await this.bindProjectSharedResources(projectId, explicit, explicit === null);
    }
    return row;
  }

  async updateProject(id: number, input: Row): Promise<Row> {
    return this.updateRow(PROJECT_DEF, null, id, input);
  }

  async projectSummary(projectId: number): Promise<Row> {
    await this.assertProject(projectId);
    const [milestones, repositories, environments, releases, tests, defects, work, results] = await Promise.all([
      this.pool.query<{ total: number; overdue: number }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE target_date < current_date AND status NOT IN ('achieved','cancelled'))::int AS overdue
         FROM biz.project_milestone WHERE project_id = $1`,
        [projectId],
      ),
      this.pool.query<{ total: number; failed: number }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE sync_status = 'failed')::int AS failed
         FROM ref.code_repository WHERE project_id = $1`,
        [projectId],
      ),
      this.pool.query<{ total: number; prod: number }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE env_type = 'prod')::int AS prod
         FROM ref.deploy_environment WHERE project_id = $1`,
        [projectId],
      ),
      this.pool.query<{ total: number; pending: number }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'pending')::int AS pending
         FROM biz.release_order WHERE project_id = $1`,
        [projectId],
      ),
      this.pool.query<{ runs: number; failed: number }>(
        `SELECT count(*)::int AS runs, count(*) FILTER (WHERE status IN ('failed','blocked'))::int AS failed
         FROM biz.test_run WHERE project_id = $1`,
        [projectId],
      ),
      this.pool.query<{ total: number; open: number }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('open','in_progress','reopened'))::int AS open
         FROM biz.defect WHERE project_id = $1`,
        [projectId],
      ),
      this.pool.query<{ hours: string }>(
        `SELECT coalesce(sum(hours), 0)::text AS hours FROM biz.work_log WHERE project_id = $1`,
        [projectId],
      ),
      this.pool.query<{ total: number; passed: number }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE r.result = 'passed')::int AS passed
         FROM biz.test_result r JOIN biz.test_run tr ON tr.id = r.run_id WHERE tr.project_id = $1`,
        [projectId],
      ),
    ]);
    const milestoneRow = milestones.rows[0] ?? { total: 0, overdue: 0 };
    const repoRow = repositories.rows[0] ?? { total: 0, failed: 0 };
    const envRow = environments.rows[0] ?? { total: 0, prod: 0 };
    const releaseRow = releases.rows[0] ?? { total: 0, pending: 0 };
    const testRow = tests.rows[0] ?? { runs: 0, failed: 0 };
    const defectRow = defects.rows[0] ?? { total: 0, open: 0 };
    const resultRow = results.rows[0] ?? { total: 0, passed: 0 };
    return {
      milestonesTotal: milestoneRow.total,
      milestonesOverdue: milestoneRow.overdue,
      repositoriesTotal: repoRow.total,
      repositoriesFailed: repoRow.failed,
      environmentsTotal: envRow.total,
      environmentsProd: envRow.prod,
      releasesTotal: releaseRow.total,
      releasesPending: releaseRow.pending,
      testRuns: testRow.runs,
      testRunsFailed: testRow.failed,
      testResults: resultRow.total,
      testPassRate: resultRow.total === 0 ? 0 : Math.round((resultRow.passed / resultRow.total) * 1000) / 10,
      defectsTotal: defectRow.total,
      defectsOpen: defectRow.open,
      workHours: Number(work.rows[0]?.hours ?? 0),
    };
  }

  projectResources(): string[] {
    return Object.keys(PROJECT_RESOURCES);
  }

  intelResources(): string[] {
    return Object.keys(INTEL_RESOURCES);
  }

  async listProjectResource(resource: string, projectId: number): Promise<Row[]> {
    const def = PROJECT_RESOURCES[resource];
    if (def === undefined) throw invalid("project", `未知项目管理资源：${resource}`, 404);
    await this.assertProject(projectId);
    return this.select(def, projectId);
  }

  async createProjectResource(resource: string, projectId: number, input: Row): Promise<Row> {
    const def = PROJECT_RESOURCES[resource];
    if (def === undefined) throw invalid("project", `未知项目管理资源：${resource}`, 404);
    await this.assertProject(projectId);
    return this.insert(def, projectId, input);
  }

  async updateProjectResource(resource: string, projectId: number, id: number, input: Row): Promise<Row> {
    const def = PROJECT_RESOURCES[resource];
    if (def === undefined) throw invalid("project", `未知项目管理资源：${resource}`, 404);
    await this.assertProject(projectId);
    return this.updateRow(def, projectId, id, input);
  }

  async removeProjectResource(resource: string, projectId: number, id: number): Promise<{ id: number }> {
    const def = PROJECT_RESOURCES[resource];
    if (def === undefined) throw invalid("project", `未知项目管理资源：${resource}`, 404);
    await this.assertProject(projectId);
    return this.removeRow(def, projectId, id);
  }

  async listReleases(projectId: number): Promise<Row[]> {
    await this.assertProject(projectId);
    return this.software.listReleases(projectId);
  }

  async createRelease(projectId: number, input: Row): Promise<Row> {
    return this.software.createRelease(projectId, input);
  }

  async approveRelease(id: number, input: Row): Promise<Row> {
    return this.software.approveRelease(id, input);
  }

  async rejectRelease(id: number, input: Row): Promise<Row> {
    const approver = reqString(input.approver, "approver", "project");
    const result = await this.pool.query(
      "UPDATE biz.release_order SET status = 'rejected', approved_by = $2 WHERE id = $1 AND status = 'pending' RETURNING *",
      [id, approver],
    );
    const row = result.rows[0] as Row | undefined;
    if (row === undefined) throw new OpcError(ERR.PRJ_RELEASE_STATE, "发布单不存在或当前状态不可驳回", 409);
    await this.record("releases.reject", "ReleaseOrder", id, { approver });
    return camelize(row);
  }

  async deleteRelease(id: number): Promise<{ id: number }> {
    const result = await this.pool.query("DELETE FROM biz.release_order WHERE id = $1 AND status = 'pending' RETURNING id", [id]);
    const row = result.rows[0] as { id: number } | undefined;
    if (row === undefined) throw new OpcError(ERR.PRJ_RELEASE_STATE, "仅待审批发布单可删除", 409);
    await this.record("releases.delete", "ReleaseOrder", id, {});
    return { id: row.id };
  }

  async listTestRuns(projectId: number): Promise<Row[]> {
    await this.assertProject(projectId);
    const result = await this.pool.query("SELECT * FROM biz.test_run WHERE project_id = $1 ORDER BY id DESC LIMIT 200", [projectId]);
    return result.rows.map((row) => camelize(row as Row));
  }

  async createTestRun(projectId: number, input: Row): Promise<Row> {
    return this.software.createTestRun(projectId, input);
  }

  async recordTestResult(runId: number, input: Row): Promise<Row> {
    return this.software.recordResult(runId, input);
  }

  async listIntelResource(resource: string, projectId: number | null): Promise<Row[]> {
    const def = INTEL_RESOURCES[resource];
    if (def === undefined) throw invalid("intel", `未知情报管理资源：${resource}`, 404);
    if (def.projectColumn !== null) {
      const scoped = this.requireProject(projectId, "intel");
      await this.assertProject(scoped);
      return this.select(def, scoped);
    }
    return this.select(def, null);
  }

  async createIntelResource(resource: string, projectId: number | null, input: Row): Promise<Row> {
    const def = INTEL_RESOURCES[resource];
    if (def === undefined) throw invalid("intel", `未知情报管理资源：${resource}`, 404);
    if (def.projectColumn !== null) {
      const scoped = this.requireProject(projectId, "intel");
      await this.assertProject(scoped);
      return this.insert(def, scoped, input);
    }
    return this.insert(def, null, input);
  }

  async updateIntelResource(resource: string, projectId: number | null, id: number, input: Row): Promise<Row> {
    const def = INTEL_RESOURCES[resource];
    if (def === undefined) throw invalid("intel", `未知情报管理资源：${resource}`, 404);
    if (def.projectColumn !== null) {
      const scoped = this.requireProject(projectId, "intel");
      await this.assertProject(scoped);
      return this.updateRow(def, scoped, id, input);
    }
    return this.updateRow(def, null, id, input);
  }

  async removeIntelResource(resource: string, projectId: number | null, id: number): Promise<{ id: number }> {
    const def = INTEL_RESOURCES[resource];
    if (def === undefined) throw invalid("intel", `未知情报管理资源：${resource}`, 404);
    if (def.projectColumn !== null) {
      const scoped = this.requireProject(projectId, "intel");
      await this.assertProject(scoped);
      return this.removeRow(def, scoped, id);
    }
    return this.removeRow(def, null, id);
  }

  async listIntelItems(projectId: number, status: string | null, limit = 100): Promise<Row[]> {
    await this.assertProject(projectId);
    const result = await this.pool.query(
      `SELECT i.id, i.project_id, i.source_id, s.name AS source_name, i.title, i.summary, i.url,
              i.relevance_score, i.sentiment, i.info_type, i.risk_level, i.status, i.tags,
              i.published_at, i.collected_at
       FROM biz.intel_item i LEFT JOIN biz.source s ON s.id = i.source_id
       WHERE i.project_id = $1 AND ($2::text IS NULL OR i.status = $2)
       ORDER BY i.relevance_score DESC NULLS LAST, i.collected_at DESC
       LIMIT $3`,
      [projectId, status, Math.min(Math.max(limit, 1), 500)],
    );
    return result.rows.map((row) => camelize(row as Row));
  }

  async updateIntelItem(id: number, input: Row): Promise<Row> {
    const status = reqString(input.status, "status", "intel");
    if (!["collected", "analyzed", "filtered", "briefed", "archived"].includes(status)) {
      throw invalid("intel", `情报条目状态非法：${status}`);
    }
    const result = await this.pool.query("UPDATE biz.intel_item SET status = $2 WHERE id = $1 RETURNING *", [id, status]);
    const row = result.rows[0] as Row | undefined;
    if (row === undefined) throw notFound("intel", `情报条目不存在：${id}`);
    await this.record("items.update", "IntelItem", id, { status });
    return camelize(row);
  }

  async listIntelBriefs(projectId: number): Promise<Row[]> {
    await this.assertProject(projectId);
    const result = await this.pool.query(
      `SELECT id, project_id, brief_date, brief_type, title, status, source_count, item_count,
              generated_at, pushed_at, version
       FROM biz.intel_brief WHERE project_id = $1
       ORDER BY brief_date DESC, version DESC LIMIT 100`,
      [projectId],
    );
    return result.rows.map((row) => camelize(row as Row));
  }

  async getIntelBrief(id: number): Promise<Row> {
    const result = await this.pool.query("SELECT * FROM biz.intel_brief WHERE id = $1", [id]);
    const row = result.rows[0] as Row | undefined;
    if (row === undefined) throw notFound("intel", `情报日报不存在：${id}`);
    return camelize(row);
  }

  async listIntelRuns(projectId: number): Promise<{ pipeline: Row[]; collect: Row[]; push: Row[] }> {
    await this.assertProject(projectId);
    const [pipeline, collect, push] = await Promise.all([
      this.pool.query("SELECT * FROM stat.intel_pipeline_run WHERE project_id = $1 ORDER BY id DESC LIMIT 100", [projectId]),
      this.pool.query("SELECT * FROM stat.intel_collect_run WHERE project_id = $1 ORDER BY id DESC LIMIT 100", [projectId]),
      this.pool.query("SELECT * FROM stat.intel_push_log WHERE project_id = $1 ORDER BY id DESC LIMIT 100", [projectId]),
    ]);
    return {
      pipeline: pipeline.rows.map((row) => camelize(row as Row)),
      collect: collect.rows.map((row) => camelize(row as Row)),
      push: push.rows.map((row) => camelize(row as Row)),
    };
  }

  async triggerIntel(stage: string, projectId: number): Promise<Row> {
    await this.assertProject(projectId);
    const now = new Date();
    if (stage === "analyze") return { stage, result: await this.intel.analyze(now, { force: true, projectId }) };
    if (stage === "aggregate") return { stage, result: await this.intel.aggregate(now, { force: true, projectId }) };
    if (stage === "brief") return { stage, result: await this.intel.buildBriefs(now, { force: true, projectId }) };
    if (stage === "push") return { stage, result: await this.intel.push(now, { force: true, projectId }) };
    throw invalid("intel", `未知流水线阶段：${stage}`);
  }

  async intelSummary(projectId: number): Promise<Row> {
    await this.assertProject(projectId);
    const [scope, sources, items, briefs, failures, topics, tags] = await Promise.all([
      this.pool.query("SELECT * FROM biz.intel_project_scope WHERE project_id = $1", [projectId]),
      this.pool.query<{ total: number; active: number; blocked: number }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE s.status = 'active')::int AS active,
                count(*) FILTER (WHERE s.status = 'blocked')::int AS blocked
         FROM biz.source s JOIN biz.source_binding b ON b.source_id = s.id
         WHERE b.project_id = $1`,
        [projectId],
      ),
      this.pool.query<{ total: number; collected: number; analyzed: number; filtered: number; briefed: number }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'collected')::int AS collected,
                count(*) FILTER (WHERE status = 'analyzed')::int AS analyzed,
                count(*) FILTER (WHERE status = 'filtered')::int AS filtered,
                count(*) FILTER (WHERE status = 'briefed')::int AS briefed
         FROM biz.intel_item WHERE project_id = $1`,
        [projectId],
      ),
      this.pool.query<{ total: number; last7d: number; latest: Date | null }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE brief_date >= current_date - 7)::int AS last7d,
                max(generated_at) AS latest
         FROM biz.intel_brief WHERE project_id = $1`,
        [projectId],
      ),
      this.pool.query<{ failures: number }>(
        `SELECT count(*)::int AS failures FROM stat.intel_pipeline_run
         WHERE project_id = $1 AND status = 'failed' AND started_at > now() - interval '24 hours'`,
        [projectId],
      ),
      this.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM biz.watch_topic WHERE project_id = $1 AND enabled", [projectId]),
      this.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM biz.intel_tag WHERE project_id = $1 AND status = 'active'", [projectId]),
    ]);
    const scopeRow = scope.rows[0] as Row | undefined;
    const sourceRow = sources.rows[0] ?? { total: 0, active: 0, blocked: 0 };
    const itemRow = items.rows[0] ?? { total: 0, collected: 0, analyzed: 0, filtered: 0, briefed: 0 };
    const briefRow = briefs.rows[0] ?? { total: 0, last7d: 0, latest: null };
    return {
      hasScope: scopeRow !== undefined,
      scope: scopeRow === undefined ? null : camelize(scopeRow),
      sourcesTotal: sourceRow.total,
      sourcesActive: sourceRow.active,
      sourcesBlocked: sourceRow.blocked,
      itemsTotal: itemRow.total,
      itemsCollected: itemRow.collected,
      itemsAnalyzed: itemRow.analyzed,
      itemsFiltered: itemRow.filtered,
      itemsBriefed: itemRow.briefed,
      briefsTotal: briefRow.total,
      briefsLast7d: briefRow.last7d,
      latestBriefAt: briefRow.latest,
      pipelineFailures24h: failures.rows[0]?.failures ?? 0,
      topics: topics.rows[0]?.n ?? 0,
      tags: tags.rows[0]?.n ?? 0,
    };
  }
}
