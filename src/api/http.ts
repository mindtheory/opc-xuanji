/**
 * HTTP /api/v1 契约层：把中枢能力暴露给 DSH Web（老板看板）与外部集成。
 *
 * 统一结果：成功 { code: 0, data }；失败 { code: <http 状态>, errorCode, message, details }。
 * 只做协议适配与参数校验，业务规则全部在 src/platform、src/workflow、src/scheduler。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { Pool } from "../db/pool.ts";
import { OpcError, asOpcError, ERR } from "../platform/errors.ts";
import type { AuditService } from "../audit/audit.ts";
import type { ViewService } from "../platform/views.ts";
import type { TokenService } from "../platform/token.ts";
import type { ConflictService } from "../platform/conflict.ts";
import type { WorkflowRegistry } from "../workflow/registry.ts";
import type { WorkflowRunner } from "../workflow/instances.ts";
import type { Verifier } from "../workflow/verifier.ts";
import type { Scheduler } from "../scheduler/engine.ts";
import type { WorkflowMeta } from "../workflow/guard.ts";
import type { DashboardService } from "../web/dashboard.ts";
import { parseRange } from "../web/dashboard.ts";
import type { IngestService, MemoryService, RadarService, SessionGrantService, IngestStatus, MemoryScope, RadarType } from "../web/services.ts";
import type { ExtractedFields } from "../web/classifier.ts";
import type { EmployeePackageService } from "../employees/package.ts";
import type { EmployeeManifest } from "../employees/catalog.ts";
import type { SuperAgentService } from "../agents/service.ts";

export interface WebServices {
  ingest: IngestService;
  session: SessionGrantService;
  memory: MemoryService;
  radar: RadarService;
  dashboard: DashboardService;
}

export interface ApiContext {
  pool: Pool;
  audit: AuditService;
  views: ViewService;
  tokens: TokenService;
  conflicts: ConflictService;
  registry: WorkflowRegistry;
  runner: WorkflowRunner;
  verifier: Verifier;
  scheduler: Scheduler;
  web: WebServices;
  employees: EmployeePackageService;
  agents?: SuperAgentService;
  archiveDir: string;
  version: string;
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler(ctx: ApiContext, params: Record<string, string>, body: Record<string, unknown>, query: URLSearchParams): Promise<{ status: number; data: unknown }>;
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > 1_048_576) throw new OpcError(ERR.SYS, "请求体超过 1MB", 413);
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new OpcError(ERR.SYS, "请求体必须是 JSON 对象", 400);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof OpcError) throw error;
    throw new OpcError(ERR.SYS, "请求体不是合法 JSON", 400);
  }
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") throw new OpcError(ERR.SYS, `字段 ${key} 必须是非空字符串`, 400);
  return value;
}

function requireAgents(ctx: ApiContext): SuperAgentService {
  if (ctx.agents === undefined) throw new OpcError(ERR.AGENT_UNAVAILABLE, "未装配 Super Agent 桥（确认 dsh-super-agents 已启用）", 503);
  return ctx.agents;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export const ROUTES: Route[] = [
  {
    method: "GET",
    pattern: /^\/api\/v1\/health$/,
    keys: [],
    async handler(ctx) {
      const pg = await ctx.pool.query("SELECT 1");
      const vector = await ctx.pool.query<{ extversion: string }>("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
      const tasks = await ctx.scheduler.list();
      const agents = ctx.agents === undefined ? { reachable: false, error: "未装配 Super Agent 桥" } : await ctx.agents.healthSafe();
      const degraded = agents.reachable === false || (agents.problems ?? []).some((p) => (p as { level?: string }).level === "error");
      return {
        status: 200,
        data: {
          status: "ok",
          degraded,
          version: ctx.version,
          pg: pg.rows.length === 1,
          pgvector: vector.rows.length === 1,
          pgvectorVersion: vector.rows[0]?.extversion ?? null,
          scheduler: { registered: tasks.length, enabled: tasks.filter((task) => task.enabled).length },
          agents,
        },
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/views\/([^/]+)\/query$/,
    keys: ["viewId"],
    async handler(ctx, params, body) {
      const result = await ctx.views.query({
        pluginId: requireString(body, "pluginId"),
        viewId: decodeURIComponent(params.viewId),
        filter: (body.filter as Record<string, unknown> | undefined) ?? {},
        limit: typeof body.limit === "number" ? body.limit : undefined,
      });
      return { status: 200, data: result };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/tokens$/,
    keys: [],
    async handler(ctx, _params, body) {
      const issued = await ctx.tokens.issue({
        taskId: requireString(body, "taskId"),
        pluginId: requireString(body, "pluginId"),
        viewId: requireString(body, "viewId"),
        fields: Array.isArray(body.fieldScope) ? (body.fieldScope as string[]) : [],
        customerId: typeof body.customerId === "number" ? body.customerId : undefined,
        ttlSeconds: typeof body.ttlSeconds === "number" ? body.ttlSeconds : undefined,
      });
      return { status: 201, data: { tokenId: issued.tokenId, expiresAt: issued.expiresAt.toISOString() } };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/tokens\/([^/]+)\/consume$/,
    keys: ["tokenId"],
    async handler(ctx, params, body) {
      const consumed = await ctx.tokens.consume(decodeURIComponent(params.tokenId), { taskId: requireString(body, "taskId") });
      return { status: 200, data: { tokenId: consumed.tokenId, fields: consumed.fields } };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/conflicts$/,
    keys: [],
    async handler(ctx, _params, body) {
      const opened = await ctx.conflicts.open({
        conflictType: requireString(body, "conflictType"),
        frozenUnitType: requireString(body, "frozenUnitType"),
        frozenUnitId: Number(body.frozenUnitId),
        parties: (body.parties as unknown[]) ?? [],
        diffFields: Array.isArray(body.diffFields) ? (body.diffFields as string[]) : [],
      });
      return { status: 201, data: opened };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/conflicts\/(\d+)\/resolve$/,
    keys: ["conflictId"],
    async handler(ctx, params, body) {
      const resolved = await ctx.conflicts.resolve(Number(params.conflictId), {
        choice: requireString(body, "choice"),
        manualValue: body.manualValue,
        note: optionalString(body.note),
      });
      return { status: 200, data: resolved };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/workflows$/,
    keys: [],
    async handler(ctx, _params, body) {
      const result = await ctx.registry.register({
        workflowId: requireString(body, "workflowId"),
        version: requireString(body, "version"),
        ownerPlugin: requireString(body, "ownerPlugin"),
        meta: (body.meta as unknown as WorkflowMeta) ?? ({} as WorkflowMeta),
        code: requireString(body, "code"),
        testedCodeHash: requireString(body, "testedCodeHash"),
        monthlyFlow: typeof body.monthlyFlow === "number" ? body.monthlyFlow : undefined,
      });
      return { status: 201, data: result };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/workflows\/([^/]+)\/instances$/,
    keys: ["workflowId"],
    async handler(ctx, params, body) {
      const instance = await ctx.runner.start({
        workflowId: decodeURIComponent(params.workflowId),
        version: optionalString(body.version),
        context: (body.context as Record<string, unknown>) ?? {},
      });
      return { status: 201, data: instance };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/instances\/(\d+)\/nodes\/([^/]+)\/complete$/,
    keys: ["instanceId", "nodeId"],
    async handler(ctx, params, body) {
      const result = await ctx.runner.completeNode({
        instanceId: Number(params.instanceId),
        nodeId: decodeURIComponent(params.nodeId),
        payload: (body.payload as Record<string, unknown>) ?? {},
      });
      return { status: 200, data: result };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/instances\/(\d+)\/nodes\/([^/]+)\/verdict$/,
    keys: ["instanceId", "nodeId"],
    async handler(ctx, params, body) {
      const samples = Array.isArray(body.samples) ? (body.samples as ("pass" | "fail")[]) : [];
      const verdict = await ctx.verifier.judge({
        instanceId: Number(params.instanceId),
        nodeId: decodeURIComponent(params.nodeId),
        samples,
        evidence: (body.evidence as Record<string, unknown>) ?? {},
        highImpact: body.highImpact === true,
        threshold: typeof body.threshold === "number" ? body.threshold : undefined,
      });
      return { status: 200, data: verdict };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/audits$/,
    keys: [],
    async handler(ctx, _params, _body, query) {
      const instance = query.get("instanceId");
      const result = await ctx.audit.list({
        instanceId: instance === null ? undefined : Number(instance),
        action: query.get("action") ?? undefined,
        limit: query.get("limit") === null ? undefined : Number(query.get("limit")),
      });
      return { status: 200, data: result };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/audits\/export$/,
    keys: [],
    async handler(ctx, _params, body) {
      const now = new Date();
      const outDir =
        optionalString(body.outDir) ??
        join(ctx.archiveDir, "audit", String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"));
      const result = await ctx.audit.export({ outDir, sinceId: typeof body.sinceId === "number" ? body.sinceId : undefined });
      return { status: 201, data: result };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/tasks$/,
    keys: [],
    async handler(ctx) {
      return { status: 200, data: { tasks: await ctx.scheduler.list() } };
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/v1\/tasks\/([^/]+)$/,
    keys: ["taskId"],
    async handler(ctx, params, body) {
      const task = await ctx.scheduler.upsert(decodeURIComponent(params.taskId), {
        cron: requireString(body, "cron"),
        timezone: optionalString(body.timezone),
        enabled: body.enabled === undefined ? true : body.enabled === true,
        config: (body.config as Record<string, unknown>) ?? {},
      });
      return { status: 200, data: task };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/tasks\/([^/]+)\/run$/,
    keys: ["taskId"],
    async handler(ctx, params, body) {
      const result = await ctx.scheduler.run(decodeURIComponent(params.taskId), {
        force: body.force === true,
        scheduledAt: optionalString(body.scheduledAt) === undefined ? undefined : new Date(String(body.scheduledAt)),
      });
      return { status: 200, data: result };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/reports\/daily$/,
    keys: [],
    async handler(ctx, _params, _body, query) {
      const date = query.get("date");
      const result =
        date === null
          ? await ctx.pool.query("SELECT report_date::text, content, sent_at FROM stat.daily_report ORDER BY report_date DESC LIMIT 1")
          : await ctx.pool.query("SELECT report_date::text, content, sent_at FROM stat.daily_report WHERE report_date = $1", [date]);
      const row = result.rows[0];
      if (row === undefined) throw new OpcError(ERR.SYS, "尚无晨报", 404);
      return { status: 200, data: row };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/web\/manifest$/,
    keys: [],
    async handler() {
      return {
        status: 200,
        data: {
          pluginId: "opc_web",
          title: "OPC公司管理",
          panel: "right",
          schemaVersion: "1",
          tabs: ["dashboard", "domains", "briefs", "tasks", "settings"],
          capabilities: ["ingest", "session_bridge", "memory_bridge", "dashboard", "radar"],
        },
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/web\/dashboard$/,
    keys: [],
    async handler(ctx, _params, _body, query) {
      return { status: 200, data: await ctx.web.dashboard.snapshot(parseRange(query.get("range") ?? undefined)) };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/web\/inbox$/,
    keys: [],
    async handler(ctx, _params, _body, query) {
      const status = query.get("status") as IngestStatus | null;
      const limit = query.get("limit") === null ? 50 : Number(query.get("limit"));
      const items = await ctx.web.ingest.list(status ?? undefined, Number.isFinite(limit) ? limit : 50);
      return { status: 200, data: { items, total: items.length } };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/web\/ingest$/,
    keys: [],
    async handler(ctx, _params, body) {
      const result = await ctx.web.ingest.ingest({
        sourceType: requireString(body, "sourceType") as "session_message" | "upload" | "voice" | "manual",
        sourceRef: requireString(body, "sourceRef"),
        text: requireString(body, "text"),
        idempotencyKey: optionalString(body.idempotencyKey),
      });
      return { status: result.duplicate ? 200 : 201, data: result };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/web\/ingest\/(\d+)\/confirm$/,
    keys: ["id"],
    async handler(ctx, params, body) {
      const item = await ctx.web.ingest.confirm(Number(params.id), {
        action: body.action === "ignore" ? "ignore" : "confirm",
        editedExtracted: body.editedExtracted as ExtractedFields | undefined,
        confirmedBy: optionalString(body.confirmedBy),
      });
      return { status: 200, data: item };
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/v1\/web\/sessions\/([^/]+)\/grant$/,
    keys: ["sessionId"],
    async handler(ctx, params, body) {
      const grant = await ctx.web.session.grant(decodeURIComponent(params.sessionId), {
        purpose: requireString(body, "purpose"),
        ttlSeconds: typeof body.ttlSeconds === "number" ? body.ttlSeconds : undefined,
        messageScope: optionalString(body.messageScope),
        grantedBy: optionalString(body.grantedBy),
      });
      return { status: 201, data: grant };
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/v1\/web\/sessions\/([^/]+)\/grant$/,
    keys: ["sessionId"],
    async handler(ctx, params) {
      return { status: 200, data: await ctx.web.session.revoke(decodeURIComponent(params.sessionId)) };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/web\/sessions\/([^/]+)\/context$/,
    keys: ["sessionId"],
    async handler(ctx, params) {
      return { status: 200, data: await ctx.web.session.context(decodeURIComponent(params.sessionId)) };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/web\/memory\/search$/,
    keys: [],
    async handler(ctx, _params, body) {
      const scopes = Array.isArray(body.scopes) ? (body.scopes as MemoryScope[]) : [];
      const cards = await ctx.web.memory.search({
        query: requireString(body, "query"),
        scopes,
        limit: typeof body.limit === "number" ? body.limit : undefined,
        purpose: requireString(body, "purpose"),
      });
      return { status: 200, data: { cards, total: cards.length } };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/web\/memory\/propose$/,
    keys: [],
    async handler(ctx, _params, body) {
      const proposal = await ctx.web.memory.propose({
        type: requireString(body, "type") as MemoryScope,
        title: requireString(body, "title"),
        content: requireString(body, "content"),
        sourceRefs: Array.isArray(body.sourceRefs) ? (body.sourceRefs as string[]) : [],
        confidence: typeof body.confidence === "number" ? body.confidence : 0.5,
      });
      return { status: 201, data: proposal };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/web\/memory\/proposals\/(\d+)\/confirm$/,
    keys: ["id"],
    async handler(ctx, params, body) {
      return {
        status: 200,
        data: await ctx.web.memory.confirm(Number(params.id), optionalString(body.confirmedBy) ?? "boss"),
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/web\/radar$/,
    keys: [],
    async handler(ctx, _params, _body, query) {
      const type = query.get("type") as RadarType | null;
      const items = await ctx.web.radar.list({
        type: type ?? undefined,
        status: query.get("status") ?? undefined,
        limit: query.get("limit") === null ? undefined : Number(query.get("limit")),
      });
      return { status: 200, data: { items, total: items.length } };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/employees$/,
    keys: [],
    async handler(ctx) {
      const items = await ctx.employees.list();
      return { status: 200, data: { items, total: items.length } };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/employees\/([^/]+)$/,
    keys: ["pluginId"],
    async handler(ctx, params) {
      return { status: 200, data: await ctx.employees.get(decodeURIComponent(params.pluginId)) };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/employees$/,
    keys: [],
    async handler(ctx, _params, body) {
      const manifest = body.manifest as EmployeeManifest | undefined;
      if (manifest === undefined) throw new OpcError(ERR.EMP_INVALID, "缺少 manifest", 400);
      const row = await ctx.employees.installManifest(manifest, {
        enabled: body.enabled === true,
        packageCode: typeof body.packageCode === "string" ? body.packageCode : undefined,
        source: "api",
        actor: optionalString(body.actor) ?? "boss",
      });
      return { status: 201, data: row };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/employees\/([^/]+)\/toggle$/,
    keys: ["pluginId"],
    async handler(ctx, params, body) {
      return {
        status: 200,
        data: await ctx.employees.toggle(
          decodeURIComponent(params.pluginId),
          body.enabled === true,
          optionalString(body.reason),
          optionalString(body.actor) ?? "boss",
        ),
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/employees\/([^/]+)\/export$/,
    keys: ["pluginId"],
    async handler(ctx, params, body) {
      return {
        status: 201,
        data: await ctx.employees.exportPackage(decodeURIComponent(params.pluginId), optionalString(body.actor) ?? "boss"),
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/employees\/import$/,
    keys: [],
    async handler(ctx, _params, body) {
      const report = await ctx.employees.importPackage(body.package, {
        dryRun: body.dryRun !== false,
        confirm: body.confirm === true,
        actor: optionalString(body.actor) ?? "boss",
      });
      return { status: report.ready ? 200 : 422, data: report };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/agents\/health$/,
    keys: [],
    async handler(ctx) {
      if (ctx.agents === undefined) return { status: 200, data: { reachable: false, error: "未装配 Super Agent 桥" } };
      return { status: 200, data: await ctx.agents.healthSafe() };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/agents\/deploy$/,
    keys: [],
    async handler(ctx, _params, body) {
      const service = requireAgents(ctx);
      return { status: 201, data: await service.deploy(requireString(body, "pluginId")) };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/agents\/dispatch$/,
    keys: [],
    async handler(ctx, _params, body) {
      const service = requireAgents(ctx);
      const result = await service.dispatch({
        pluginId: optionalString(body.pluginId),
        agentId: optionalString(body.agentId),
        prompt: requireString(body, "prompt"),
      });
      return { status: 201, data: result };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/agents\/pause$/,
    keys: [],
    async handler(ctx, _params, body) {
      const service = requireAgents(ctx);
      await service.setPaused(body.paused === true);
      return { status: 200, data: { paused: body.paused === true } };
    },
  },
];

export function createApiHandler(ctx: ApiContext): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        for (const route of ROUTES) {
          if (route.method !== req.method) continue;
          const match = route.pattern.exec(url.pathname);
          if (match === null) continue;
          const params: Record<string, string> = {};
          route.keys.forEach((key, index) => {
            params[key] = match[index + 1];
          });
          const body = await readBody(req);
          const result = await route.handler(ctx, params, body, url.searchParams);
          json(res, result.status, { code: 0, data: result.data });
          return;
        }
        json(res, 404, { code: 404, errorCode: ERR.SYS, message: `未知路由：${req.method} ${url.pathname}` });
      } catch (error) {
        const opc = asOpcError(error);
        json(res, opc.status, { code: opc.status, errorCode: opc.errorCode, message: opc.message, details: opc.details ?? null });
      }
    })();
  };
}

export function startApiServer(ctx: ApiContext, port = 0, host = "127.0.0.1"): Promise<Server> {
  const server = createServer(createApiHandler(ctx));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
