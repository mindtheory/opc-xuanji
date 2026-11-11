/**
 * OPC-玄机 · 一人公司中枢 —— DSH cordis 插件入口。
 *
 * 形态（对照 DSH 实际契约，参照 dsh-novel-writer 的 apply/inject 写法）：
 *   - inject ["tools"]：向宿主注册 opc_* 工具（中枢唯一入口，员工不直连数据库）；
 *   - 可选注入 webServer：把 /api/v1 静态路径挂到 DSH Web（动态路径由独立服务进程提供）；
 *   - 可选 ctx.setInterval：每分钟推进一次调度器 tick（headless 常驻时使用）。
 *
 * 设计边界：插件只做装配与协议适配；业务规则在 src/platform、src/workflow、src/scheduler，
 * 这样同一套服务既能在 DSH 里跑，也能被独立 API 进程/测试直接复用。
 */
import { loadConfig } from "../platform/config.ts";
import { createPool, type Pool } from "../db/pool.ts";
import { AuditService } from "../audit/audit.ts";
import { ViewService, knownViewIds } from "../platform/views.ts";
import { TokenService } from "../platform/token.ts";
import { ConflictService } from "../platform/conflict.ts";
import { WorkflowRegistry } from "../workflow/registry.ts";
import type { WorkflowMeta } from "../workflow/guard.ts";
import { WorkflowRunner } from "../workflow/instances.ts";
import { Verifier } from "../workflow/verifier.ts";
import { Scheduler } from "../scheduler/engine.ts";
import { defaultTasks } from "../scheduler/tasks/index.ts";
import { createApiHandler, type ApiContext } from "../api/http.ts";
import { asOpcError } from "../platform/errors.ts";
import { DashboardService } from "../web/dashboard.ts";
import { IngestService, MemoryService, RadarService, SessionGrantService, type IngestStatus, type MemoryScope, type RadarType } from "../web/services.ts";
import type { ExtractedFields } from "../web/classifier.ts";
import { EmployeePackageService } from "../employees/package.ts";
import type { EmployeeManifest } from "../employees/catalog.ts";
import { SuperAgentsBridge } from "../agents/bridge.ts";
import { SuperAgentService } from "../agents/service.ts";
import { HindsightBridge } from "../memory/hindsight.ts";
import { HindsightSyncService } from "../memory/sync.ts";

export const name = "opc-xuanji";
export const inject = ["tools"];

export interface HubConfig {
  dsn?: string;
  archiveDir?: string;
  timezone?: string;
  version?: string;
  tickMs?: number;
  enableScheduler?: boolean;
  superAgentsUrl?: string;
  hindsightUrl?: string;
  hindsightBank?: string;
}

export interface Hub {
  pool: Pool;
  audit: AuditService;
  views: ViewService;
  tokens: TokenService;
  conflicts: ConflictService;
  registry: WorkflowRegistry;
  runner: WorkflowRunner;
  verifier: Verifier;
  scheduler: Scheduler;
  web: {
    ingest: IngestService;
    session: SessionGrantService;
    memory: MemoryService;
    radar: RadarService;
    dashboard: DashboardService;
  };
  employees: EmployeePackageService;
  agents: SuperAgentService;
  memorySync: HindsightSyncService;
  api: ApiContext;
  config: ReturnType<typeof loadConfig>;
  tools: ToolDefinition[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output?: { schema: Record<string, unknown>; render(args: unknown, value: unknown): unknown };
  execute(args: Record<string, unknown>, exec?: unknown): Promise<unknown>;
}

const OBJECT = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

function jsonText(value: unknown): { type: string; text: string } {
  return { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) };
}

export function createHub(options: HubConfig = {}): Hub {
  const config = loadConfig();
  // bundle 自带的 cordis.patch.yml 会把 dsn/archiveDir 注入为空串；注释口径是
  // "留空则使用环境变量"，所以用 ||（空串也回退），不能用 ??（只挡 null/undefined）。
  const pool = createPool(options.dsn?.trim() || config.dsn, { max: 6 });
  const archiveDir = options.archiveDir?.trim() || config.archiveDir;
  const audit = new AuditService(pool, { schemaVersion: config.schemaVersion });
  const views = new ViewService(pool, audit);
  const tokens = new TokenService(pool, audit);
  const conflicts = new ConflictService(pool, audit);
  const registry = new WorkflowRegistry(pool, audit);
  const runner = new WorkflowRunner(pool, audit, registry);
  const verifier = new Verifier(pool, audit);
  const scheduler = new Scheduler(pool, audit, { archiveDir, timezone: options.timezone?.trim() || config.timezone });
  for (const task of defaultTasks()) scheduler.register(task);

  const web = {
    ingest: new IngestService(pool, audit),
    session: new SessionGrantService(pool, audit),
    memory: new MemoryService(pool, audit),
    radar: new RadarService(pool),
    dashboard: new DashboardService(pool),
  };
  const employees = new EmployeePackageService(pool, audit, { hubVersion: options.version ?? "0.2.1" });
  const bridge = new SuperAgentsBridge({ baseUrl: options.superAgentsUrl ?? (process.env.OPC_SUPER_AGENTS_URL?.trim() || undefined) });
  const agents = new SuperAgentService(bridge, audit, { archiveDir });
  const hindsight = new HindsightBridge({
    baseUrl: options.hindsightUrl ?? (process.env.OPC_HINDSIGHT_URL?.trim() || undefined),
    bankId: options.hindsightBank ?? (process.env.OPC_HINDSIGHT_BANK?.trim() || undefined),
  });
  const memorySync = new HindsightSyncService(hindsight, pool, audit);

  const api: ApiContext = {
    pool,
    audit,
    views,
    tokens,
    conflicts,
    registry,
    runner,
    verifier,
    scheduler,
    web,
    employees,
    agents,
    memorySync,
    archiveDir,
    version: options.version ?? "0.1.0",
  };

  // 工具边界统一错误口径：DSH 只看到一条可读错误，前缀带 OPC 错误码，便于模型与审计对账
  // output 契约（DSH ≥0.2.1）：execute 已返回 {type:"text",text} 块，render 直接透传
  const TEXT_OUTPUT = {
    schema: { type: "object" },
    render(_args: unknown, value: unknown): unknown {
      if (typeof value === "string") return { type: "text", text: value };
      return value;
    },
  };
  const tool = (def: ToolDefinition): ToolDefinition => ({
    ...def,
    output: TEXT_OUTPUT,
    async execute(args: Record<string, unknown>, exec?: unknown): Promise<unknown> {
      try {
        return await def.execute(args, exec);
      } catch (error) {
        const opc = asOpcError(error);
        throw new Error(`${opc.errorCode}: ${opc.message}`);
      }
    },
  });
  const tools: ToolDefinition[] = [
    tool({
      name: "opc_health",
      description: "中枢体检：PG/pgvector 可用性与调度任务数。",
      parameters: OBJECT({}),
      async execute() {
        const vector = await pool.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
        const tasks = await scheduler.list();
        return jsonText({
          status: "ok",
          pg: true,
          pgvector: vector.rows.length === 1,
          pgvectorVersion: vector.rows[0]?.extversion ?? null,
          views: knownViewIds(),
          registeredTasks: tasks.map((task) => task.taskId),
          agents: await agents.healthSafe(),
        });
      },
    }),
    tool({
      name: "opc_view_query",
      description: "以视图级授权查询共享数据（只读，自动写审计）。未授权视图返回 ERR-AUTHZ-001。",
      parameters: OBJECT(
        {
          pluginId: { type: "string", description: "员工插件 id，如 opc_finance" },
          viewId: { type: "string", description: "视图 id，如 view_ar_ap" },
          filter: { type: "object", description: "视图支持的过滤字段" },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        ["pluginId", "viewId"],
      ),
      async execute(args) {
        return jsonText(await views.query({
          pluginId: String(args.pluginId),
          viewId: String(args.viewId),
          filter: (args.filter as Record<string, unknown>) ?? {},
          limit: typeof args.limit === "number" ? args.limit : undefined,
        }));
      },
    }),
    tool({
      name: "opc_token_issue",
      description: "签发一次性令牌（单任务、单字段范围、有效期 ≤300 秒），跨域读敏感字段唯一通道。",
      parameters: OBJECT(
        {
          taskId: { type: "string" },
          pluginId: { type: "string" },
          viewId: { type: "string" },
          fieldScope: { type: "array", items: { type: "string" } },
          customerId: { type: "integer" },
          ttlSeconds: { type: "integer", minimum: 1, maximum: 300 },
        },
        ["taskId", "pluginId", "viewId", "fieldScope"],
      ),
      async execute(args) {
        const issued = await tokens.issue({
          taskId: String(args.taskId),
          pluginId: String(args.pluginId),
          viewId: String(args.viewId),
          fields: (args.fieldScope as string[]) ?? [],
          customerId: typeof args.customerId === "number" ? args.customerId : undefined,
          ttlSeconds: typeof args.ttlSeconds === "number" ? args.ttlSeconds : undefined,
        });
        return jsonText({ tokenId: issued.tokenId, expiresAt: issued.expiresAt.toISOString() });
      },
    }),
    tool({
      name: "opc_token_consume",
      description: "消费一次性令牌（使用一次即失效；重复/过期/任务不匹配返回 ERR-TOKEN-001）。",
      parameters: OBJECT({ tokenId: { type: "string" }, taskId: { type: "string" } }, ["tokenId", "taskId"]),
      async execute(args) {
        return jsonText(await tokens.consume(String(args.tokenId), { taskId: String(args.taskId) }));
      },
    }),
    tool({
      name: "opc_conflict_open",
      description: "登记冲突并冻结业务事件（成本归属/客户归属/库存批次/合同金额口径）。",
      parameters: OBJECT(
        {
          conflictType: { type: "string", enum: ["cost", "customer", "stock_batch", "contract_amount"] },
          frozenUnitType: { type: "string", enum: ["ledger", "contract", "stock_txn", "vehicle_log"] },
          frozenUnitId: { type: "integer" },
          parties: { type: "array", items: { type: "object" } },
          diffFields: { type: "array", items: { type: "string" } },
        },
        ["conflictType", "frozenUnitType", "frozenUnitId", "parties"],
      ),
      async execute(args) {
        return jsonText(await conflicts.open({
          conflictType: String(args.conflictType),
          frozenUnitType: String(args.frozenUnitType),
          frozenUnitId: Number(args.frozenUnitId),
          parties: (args.parties as unknown[]) ?? [],
          diffFields: (args.diffFields as string[]) ?? [],
        }));
      },
    }),
    tool({
      name: "opc_conflict_resolve",
      description: "裁决冲突（A/B/manual/later），清除冻结标记并写裁决记录。",
      parameters: OBJECT(
        { conflictId: { type: "integer" }, choice: { type: "string", enum: ["A", "B", "manual", "later"] }, note: { type: "string" } },
        ["conflictId", "choice"],
      ),
      async execute(args) {
        return jsonText(await conflicts.resolve(Number(args.conflictId), {
          choice: String(args.choice),
          note: typeof args.note === "string" ? args.note : undefined,
        }));
      },
    }),
    tool({
      name: "opc_workflow_register",
      description: "注册流程版本（六项准入守卫 + 风险硬规则）；守卫失败返回逐项失败原因，不静默降级。",
      parameters: OBJECT(
        {
          workflowId: { type: "string" },
          version: { type: "string" },
          ownerPlugin: { type: "string" },
          meta: { type: "object" },
          code: { type: "string" },
          testedCodeHash: { type: "string" },
          monthlyFlow: { type: "number" },
        },
        ["workflowId", "version", "ownerPlugin", "meta", "code", "testedCodeHash"],
      ),
      async execute(args) {
        return jsonText(await registry.register({
          workflowId: String(args.workflowId),
          version: String(args.version),
          ownerPlugin: String(args.ownerPlugin),
          meta: (args.meta as unknown as WorkflowMeta) ?? ({} as WorkflowMeta),
          code: String(args.code),
          testedCodeHash: String(args.testedCodeHash),
          monthlyFlow: typeof args.monthlyFlow === "number" ? args.monthlyFlow : undefined,
        }));
      },
    }),
    tool({
      name: "opc_workflow_start",
      description: "以已注册版本启动流程实例。",
      parameters: OBJECT({ workflowId: { type: "string" }, version: { type: "string" }, context: { type: "object" } }, ["workflowId"]),
      async execute(args) {
        return jsonText(await runner.start({
          workflowId: String(args.workflowId),
          version: typeof args.version === "string" ? args.version : undefined,
          context: (args.context as Record<string, unknown>) ?? {},
        }));
      },
    }),
    tool({
      name: "opc_workflow_complete_node",
      description: "完成写节点（幂等键 instance_id + node_id；同键异入参返回 ERR-WF-004）。",
      parameters: OBJECT(
        { instanceId: { type: "integer" }, nodeId: { type: "string" }, payload: { type: "object" } },
        ["instanceId", "nodeId", "payload"],
      ),
      async execute(args) {
        return jsonText(await runner.completeNode({
          instanceId: Number(args.instanceId),
          nodeId: String(args.nodeId),
          payload: (args.payload as Record<string, unknown>) ?? {},
        }));
      },
    }),
    tool({
      name: "opc_workflow_judge",
      description: "Verifier 评判：多数票 + 置信度 + evidence 去重；高影响节点分裂票升级人工。",
      parameters: OBJECT(
        {
          instanceId: { type: "integer" },
          nodeId: { type: "string" },
          samples: { type: "array", items: { type: "string", enum: ["pass", "fail"] } },
          evidence: { type: "object" },
          highImpact: { type: "boolean" },
        },
        ["nodeId", "samples", "evidence"],
      ),
      async execute(args) {
        return jsonText(await verifier.judge({
          instanceId: typeof args.instanceId === "number" ? args.instanceId : undefined,
          nodeId: String(args.nodeId),
          samples: (args.samples as ("pass" | "fail")[]) ?? [],
          evidence: (args.evidence as Record<string, unknown>) ?? {},
          highImpact: args.highImpact === true,
        }));
      },
    }),
    tool({
      name: "opc_audit_list",
      description: "审计查询（按实例/动作过滤，默认时间倒序）。",
      parameters: OBJECT({ instanceId: { type: "integer" }, action: { type: "string" }, limit: { type: "integer" } }),
      async execute(args) {
        return jsonText(await audit.list({
          instanceId: typeof args.instanceId === "number" ? args.instanceId : undefined,
          action: typeof args.action === "string" ? args.action : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        }));
      },
    }),
    tool({
      name: "opc_audit_export",
      description: "增量导出审计（JSONL + SHA-256 + 链头），返回文件路径与行数。",
      parameters: OBJECT({ outDir: { type: "string" }, sinceId: { type: "integer" } }),
      async execute(args) {
        return jsonText(await audit.export({
          outDir: typeof args.outDir === "string" ? args.outDir : archiveDir,
          sinceId: typeof args.sinceId === "number" ? args.sinceId : undefined,
        }));
      },
    }),
    tool({
      name: "opc_task_list",
      description: "列出定时自动化任务（cron/时区/启用状态/下次触发/最近状态）。",
      parameters: OBJECT({}),
      async execute() {
        return jsonText({ tasks: await scheduler.list(), registered: scheduler.registeredIds() });
      },
    }),
    tool({
      name: "opc_task_upsert",
      description: "新增/修改定时任务（cron + 时区 + 参数）；cron 非法或任务类型未注册则拒绝。",
      parameters: OBJECT(
        { taskId: { type: "string" }, cron: { type: "string" }, timezone: { type: "string" }, enabled: { type: "boolean" }, config: { type: "object" } },
        ["taskId", "cron"],
      ),
      async execute(args) {
        return jsonText(await scheduler.upsert(String(args.taskId), {
          cron: String(args.cron),
          timezone: typeof args.timezone === "string" ? args.timezone : undefined,
          enabled: args.enabled === undefined ? true : args.enabled === true,
          config: (args.config as Record<string, unknown>) ?? {},
        }));
      },
    }),
    tool({
      name: "opc_task_run",
      description: "立即执行一次任务（幂等键 = task_id + scheduled_at；force 可强制重跑）。",
      parameters: OBJECT({ taskId: { type: "string" }, force: { type: "boolean" }, scheduledAt: { type: "string" } }, ["taskId"]),
      async execute(args) {
        return jsonText(await scheduler.run(String(args.taskId), {
          force: args.force === true,
          scheduledAt: typeof args.scheduledAt === "string" ? new Date(args.scheduledAt) : undefined,
        }));
      },
    }),
    tool({
      name: "opc_daily_report",
      description: "读取最近一期晨报（税务预警/合同到期/待裁决冲突/升级人工统计）。",
      parameters: OBJECT({ date: { type: "string" } }),
      async execute(args) {
        const result = typeof args.date === "string"
          ? await pool.query("SELECT report_date::text, content, sent_at FROM stat.daily_report WHERE report_date = $1", [args.date])
          : await pool.query("SELECT report_date::text, content, sent_at FROM stat.daily_report ORDER BY report_date DESC LIMIT 1");
        return jsonText(result.rows[0] ?? { message: "尚无晨报" });
      },
    }),
    tool({
      name: "opc_web_manifest",
      description: "返回网页表现层插件清单（左栏入口、右栏页签、能力开关）。",
      parameters: OBJECT({}),
      async execute() {
        return jsonText({
          pluginId: "opc_web",
          title: "OPC驾驶舱",
          panel: "left",
          schemaVersion: "1",
          tabs: ["dashboard", "domains", "briefs", "tasks", "settings"],
          capabilities: ["ingest", "session_bridge", "memory_bridge", "dashboard", "radar"],
        });
      },
    }),
    tool({
      name: "opc_web_ingest",
      description: "把会话/上传输入归置到九域（高风险域只生成确认卡，不自动写库）。",
      parameters: OBJECT(
        {
          sourceType: { type: "string", enum: ["session_message", "upload", "voice", "manual"] },
          sourceRef: { type: "string" },
          text: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        ["sourceType", "sourceRef", "text"],
      ),
      async execute(args) {
        return jsonText(await web.ingest.ingest({
          sourceType: String(args.sourceType) as "session_message" | "upload" | "voice" | "manual",
          sourceRef: String(args.sourceRef),
          text: String(args.text),
          idempotencyKey: typeof args.idempotencyKey === "string" ? args.idempotencyKey : undefined,
        }));
      },
    }),
    tool({
      name: "opc_web_inbox",
      description: "读取待归置收件箱（可按 status 过滤）。",
      parameters: OBJECT({ status: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200 } }),
      async execute(args) {
        return jsonText({
          items: await web.ingest.list(
            typeof args.status === "string" ? (args.status as IngestStatus) : undefined,
            typeof args.limit === "number" ? args.limit : undefined,
          ),
        });
      },
    }),
    tool({
      name: "opc_web_confirm",
      description: "确认/忽略归置项（高风险写入必须经此步）。",
      parameters: OBJECT(
        { id: { type: "integer" }, action: { type: "string", enum: ["confirm", "ignore"] }, editedExtracted: { type: "object" } },
        ["id"],
      ),
      async execute(args) {
        return jsonText(await web.ingest.confirm(Number(args.id), {
          action: args.action === "ignore" ? "ignore" : "confirm",
          editedExtracted: args.editedExtracted as ExtractedFields | undefined,
        }));
      },
    }),
    tool({
      name: "opc_web_dashboard",
      description: "生成驾驶舱快照（统一 as_of、冻结脚注、陈旧与数据不足提示）。",
      parameters: OBJECT({ range: { type: "string", enum: ["today", "7d", "30d", "90d"] } }),
      async execute(args) {
        const range = args.range === "today" || args.range === "7d" || args.range === "90d" ? args.range : "30d";
        return jsonText(await web.dashboard.snapshot(range));
      },
    }),
    tool({
      name: "opc_web_session_grant",
      description: "授予插件读取指定会话范围（用途 + 有效期 ≤24h），写审计。",
      parameters: OBJECT(
        { sessionId: { type: "string" }, purpose: { type: "string" }, ttlSeconds: { type: "integer", minimum: 60, maximum: 86400 }, messageScope: { type: "string" } },
        ["sessionId", "purpose"],
      ),
      async execute(args) {
        return jsonText(await web.session.grant(String(args.sessionId), {
          purpose: String(args.purpose),
          ttlSeconds: typeof args.ttlSeconds === "number" ? args.ttlSeconds : undefined,
          messageScope: typeof args.messageScope === "string" ? args.messageScope : undefined,
        }));
      },
    }),
    tool({
      name: "opc_web_session_context",
      description: "读取已授权会话的最近 20 条（未授权直接拒绝，不返回空）。",
      parameters: OBJECT({ sessionId: { type: "string" } }, ["sessionId"]),
      async execute(args) {
        return jsonText(await web.session.context(String(args.sessionId)));
      },
    }),
    tool({
      name: "opc_web_memory_search",
      description: "按 scope 检索记忆卡片（敏感记忆只返回标记，不返回原值）。",
      parameters: OBJECT(
        {
          query: { type: "string" },
          scopes: { type: "array", items: { type: "string" } },
          purpose: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        ["query", "scopes", "purpose"],
      ),
      async execute(args) {
        return jsonText(await web.memory.search({
          query: String(args.query),
          scopes: (args.scopes as MemoryScope[]) ?? [],
          purpose: String(args.purpose),
          limit: typeof args.limit === "number" ? args.limit : undefined,
        }));
      },
    }),
    tool({
      name: "opc_web_memory_propose",
      description: "提出记忆写入建议（必须带来源引用；老板确认后才落库）。",
      parameters: OBJECT(
        {
          type: { type: "string", enum: ["company_profile", "experience", "skill", "customer", "session_digest"] },
          title: { type: "string" },
          content: { type: "string" },
          sourceRefs: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        ["type", "title", "content", "sourceRefs"],
      ),
      async execute(args) {
        return jsonText(await web.memory.propose({
          type: String(args.type) as MemoryScope,
          title: String(args.title),
          content: String(args.content),
          sourceRefs: (args.sourceRefs as string[]) ?? [],
          confidence: typeof args.confidence === "number" ? args.confidence : 0.5,
        }));
      },
    }),
    tool({
      name: "opc_web_radar",
      description: "读取插件/关键词雷达条目（只推荐不自动安装）。",
      parameters: OBJECT({ type: { type: "string", enum: ["plugin", "keyword"] }, status: { type: "string" }, limit: { type: "integer" } }),
      async execute(args) {
        return jsonText({
          items: await web.radar.list({
            type: args.type === "plugin" || args.type === "keyword" ? (args.type as RadarType) : undefined,
            status: typeof args.status === "string" ? args.status : undefined,
            limit: typeof args.limit === "number" ? args.limit : undefined,
          }),
        });
      },
    }),
    tool({
      name: "opc_employee_list",
      description: "列出员工插件（manifest/版本/启用状态/视图/工具/写目标）。",
      parameters: OBJECT({}),
      async execute() {
        return jsonText({ items: await employees.list() });
      },
    }),
    tool({
      name: "opc_employee_install",
      description: "按 manifest 安装员工插件（默认停用，启用需二次确认）。",
      parameters: OBJECT({ manifest: { type: "object" }, enabled: { type: "boolean" } }, ["manifest"]),
      async execute(args) {
        return jsonText(await employees.installManifest(args.manifest as EmployeeManifest, {
          enabled: args.enabled === true,
          source: "dshtool",
        }));
      },
    }),
    tool({
      name: "opc_employee_toggle",
      description: "启用/停用员工插件；停用后不再派工，历史数据保留。",
      parameters: OBJECT({ pluginId: { type: "string" }, enabled: { type: "boolean" }, reason: { type: "string" } }, ["pluginId", "enabled"]),
      async execute(args) {
        return jsonText(await employees.toggle(String(args.pluginId), args.enabled === true, typeof args.reason === "string" ? args.reason : undefined));
      },
    }),
    tool({
      name: "opc_employee_export",
      description: "导出员工插件包（默认不含业务数据/凭据，含 checksum）。",
      parameters: OBJECT({ pluginId: { type: "string" } }, ["pluginId"]),
      async execute(args) {
        return jsonText(await employees.exportPackage(String(args.pluginId)));
      },
    }),
    tool({
      name: "opc_employee_import",
      description: "导入员工包：先校验/dry-run，confirm=true 才安装（默认停用）。",
      parameters: OBJECT({ package: { type: "object" }, dryRun: { type: "boolean" }, confirm: { type: "boolean" } }, ["package"]),
      async execute(args) {
        return jsonText(await employees.importPackage(args.package, {
          dryRun: args.dryRun !== false,
          confirm: args.confirm === true,
        }));
      },
    }),
    tool({
      name: "opc_agent_deploy",
      description: "把员工部署为超级智能体角色卡（dsh-super-agents）：幂等，重复部署更新同一张卡。",
      parameters: OBJECT({ pluginId: { type: "string" } }, ["pluginId"]),
      async execute(args) {
        return jsonText(await agents.deploy(String(args.pluginId)));
      },
    }),
    tool({
      name: "opc_agent_dispatch",
      description: "给员工超级智能体派认知任务（读文档/写分析类）：按 pluginId 或 agentId 二选一，返回 runId。",
      parameters: OBJECT({ pluginId: { type: "string" }, agentId: { type: "string" }, prompt: { type: "string" } }, ["prompt"]),
      async execute(args) {
        return jsonText(await agents.dispatch({
          pluginId: typeof args.pluginId === "string" ? args.pluginId : undefined,
          agentId: typeof args.agentId === "string" ? args.agentId : undefined,
          prompt: String(args.prompt),
        }));
      },
    }),
    tool({
      name: "opc_agent_result",
      description: "回收一次派活的产物：状态 + 第一行一句话结论 + 产物全文。",
      parameters: OBJECT({ runId: { type: "string" } }, ["runId"]),
      async execute(args) {
        return jsonText(await agents.result(String(args.runId)));
      },
    }),
    tool({
      name: "opc_agent_health",
      description: "超级智能体基础设施健康：可达性、暂停、问题条目、队列水位。不可达时其余功能不受影响。",
      parameters: OBJECT({}),
      async execute() {
        return jsonText(await agents.healthSafe());
      },
    }),
    tool({
      name: "opc_agent_pause",
      description: "全局暂停/恢复认知调度（确定性 SQL 任务不受影响）。",
      parameters: OBJECT({ paused: { type: "boolean" } }, ["paused"]),
      async execute(args) {
        await agents.setPaused(args.paused === true);
        return jsonText({ paused: args.paused === true });
      },
    }),
  ];

  return {
    pool,
    audit,
    views,
    tokens,
    conflicts,
    registry,
    runner,
    verifier,
    scheduler,
    web,
    employees,
    agents,
    memorySync,
    api,
    config,
    tools,
  };
}

/** cordis 插件入口：注册工具、静态 HTTP 路由与调度 tick。 */
export function apply(ctx: { tools: { register(def: unknown): unknown }; inject?: Function; setInterval?: Function; webServer?: { register(route: unknown): unknown }; on?: Function; effect?: Function }, config: HubConfig = {}): void {
  const hub = createHub(config);
  for (const def of hub.tools) {
    ctx.tools.register({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
      ...(def.output !== undefined ? { output: def.output } : {}),
      execute: def.execute,
    });
  }

  // API 挂到 DSH Web：优先精确路径（健康/列表等），再注册 /api/v1 前缀路由，
  // 让带路径参数的动态端点（员工启停/流程实例/实例节点/令牌消费等）在浏览器端也可达。
  // 独立进程（scripts/serve.ts）仍可承载完整 API，两条通路共用同一个 createApiHandler。
  const handler = createApiHandler(hub.api);
  const staticPaths = [
    "/api/v1/health",
    "/api/v1/tokens",
    "/api/v1/conflicts",
    "/api/v1/workflows",
    "/api/v1/audits",
    "/api/v1/audits/export",
    "/api/v1/tasks",
    "/api/v1/reports/daily",
    "/api/v1/web/manifest",
    "/api/v1/web/dashboard",
    "/api/v1/web/inbox",
    "/api/v1/web/ingest",
    "/api/v1/web/memory/search",
    "/api/v1/web/memory/propose",
    "/api/v1/web/radar",
    "/api/v1/employees",
    "/api/v1/employees/import",
    "/api/v1/agents/health",
    "/api/v1/agents/runs",
    "/api/v1/agents/deploy",
    "/api/v1/agents/dispatch",
    "/api/v1/agents/pause",
  ];
  if (typeof ctx.inject === "function") {
    ctx.inject(["webServer"], (wctx: { webServer?: { register(route: unknown): unknown } }) => {
      if (wctx?.webServer?.register === undefined) return;
      for (const path of staticPaths) {
        try {
          wctx.webServer.register({ kind: "exact", path, handler });
        } catch (error) {
          console.warn(`[opc-xuanji] 路由注册失败 ${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      // 最长前缀匹配兜住所有动态路径（/api/v1/employees/{id}、/api/v1/workflows/{id}/instances 等）
      try {
        wctx.webServer.register({ kind: "prefix", path: "/api/v1", handler });
      } catch (error) {
        console.warn(`[opc-xuanji] 前缀路由注册失败 /api/v1: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  // 调度 tick：用 Node 全局 setInterval（cordis ctx 的 timer 属性需要 inject 声明，
  // 与 dsh-super-agents 同一模式：全局定时器 + unref，dispose 时清理）
  if (config.enableScheduler !== false) {
    hub.scheduler.seedDefaults().catch((error) => {
      console.warn("[opc-xuanji] 默认任务播种失败:", error instanceof Error ? error.message : String(error));
    });
    const timer = setInterval(() => {
      hub.scheduler.tick().catch((error) => {
        console.warn("[opc-xuanji] 调度 tick 失败:", error instanceof Error ? error.message : String(error));
      });
    }, config.tickMs ?? 60_000);
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      (timer as { unref(): void }).unref();
    }
    try {
      if (typeof ctx.on === "function") {
        (ctx.on as (event: string, fn: () => void) => void)("dispose", () => {
          clearInterval(timer);
          void hub.pool.end();
        });
      }
    } catch {
      // ctx.on 不可用时忽略：进程退出即释放
    }
  }
}
