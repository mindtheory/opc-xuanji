/**
 * Super Agent 应用服务（OPC-SDD-003 §5–§7）：员工部署（manifest → 角色卡）、
 * 认知任务派活与回流、健康聚合、全局暂停。全部经 SuperAgentsBridge，业务侧只加
 * 审计与员工语义；员工 agent 不直连数据库（产物即交付，入库走既有视图/令牌）。
 */
import { join } from "node:path";
import { OpcError, ERR } from "../platform/errors.ts";
import type { AuditService } from "../audit/audit.ts";
import { manifestByPlugin, type EmployeeManifest } from "../employees/catalog.ts";
import type { SuperAgentsBridge, BridgeAgentRow } from "./bridge.ts";

/** 角色卡人设模板（SDD-003 §5）：员工身份 + 汇报口径 + 边界。员工包可覆盖。 */
export function renderAgentRole(manifest: EmployeeManifest): string {
  return [
    `你是「${manifest.displayName}」（员工码 ${manifest.employeeCode}），OPC-玄机 一人公司中枢里的${manifest.displayName}。`,
    "你在无人值守的独立会话里干活：交付物只有一个 Markdown 文件，第一行必须是一句话结论；干不完也要写，第一行以「未完成：」开头并说明卡点。",
    "边界：你不写任何数据库、不直接问老板；需要老板拍板的事项写进产物「待裁决」小节，由中枢幕僚长转达。",
    "产出面向一人公司老板：短句、可执行、给结论不给过程清单。",
  ].join("\n");
}

export interface DeployResult {
  pluginId: string;
  agent: BridgeAgentRow;
  created: boolean;
}

export class SuperAgentService {
  private readonly bridge: SuperAgentsBridge;
  private readonly audit: AuditService;
  private readonly options: { archiveDir: string };

  constructor(bridge: SuperAgentsBridge, audit: AuditService, options: { archiveDir: string }) {
    this.bridge = bridge;
    this.audit = audit;
    this.options = options;
  }

  /** 员工部署：manifest 校验 → 角色卡 upsert（幂等）→ 审计。 */
  async deploy(pluginId: string): Promise<DeployResult> {
    const manifest = manifestByPlugin(pluginId);
    if (!manifest) throw new OpcError(ERR.EMP_INVALID, `未知员工插件：${pluginId}`, 400);
    const before = await this.bridge.listAgents();
    const existed = before.some((a) => a.name === manifest.displayName);
    const agent = await this.bridge.upsertAgent({
      name: manifest.displayName,
      systemRole: renderAgentRole(manifest),
      cwd: join(this.options.archiveDir, "agent-runs", manifest.pluginId),
      learn: true,
    });
    await this.audit.record({
      actor: "hub",
      action: "employee.deploy",
      result: "ok",
      objectType: "employee_agent",
      objectId: `${manifest.pluginId}:${agent.id}`,
      payload: { pluginId: manifest.pluginId, agentId: agent.id, created: !existed },
    });
    return { pluginId, agent, created: !existed };
  }

  /** 按员工派认知任务：先解析员工 → 角色卡，再派活。 */
  async dispatch(input: { pluginId?: string; agentId?: string; prompt: string }): Promise<{ runId: string; agentId: string }> {
    let agentId = input.agentId;
    if (!agentId && input.pluginId) {
      const manifest = manifestByPlugin(input.pluginId);
      if (!manifest) throw new OpcError(ERR.EMP_INVALID, `未知员工插件：${input.pluginId}`, 400);
      const agent = (await this.bridge.listAgents()).find((a) => a.name === manifest.displayName);
      if (!agent) throw new OpcError(ERR.AGENT_UNAVAILABLE, `员工「${manifest.displayName}」尚未部署为超级智能体，请先 opc_employee_deploy`, 502);
      agentId = agent.id;
    }
    if (!agentId) throw new OpcError(ERR.AGENT_UNAVAILABLE, "派活需要 pluginId 或 agentId 之一", 400);
    const { runId } = await this.bridge.dispatch(agentId, input.prompt);
    await this.audit.record({
      actor: "hub",
      action: "agent.dispatch",
      result: "ok",
      objectType: "agent_run",
      objectId: runId,
      payload: { agentId, pluginId: input.pluginId ?? null },
    });
    return { runId, agentId };
  }

  /** 回收产物：第一行作为一句话结论返回。 */
  async result(runId: string): Promise<{ status: string; head: string; artifact: string }> {
    const detail = await this.bridge.runDetail(runId);
    const head = detail.artifact.split("\n")[0] ?? "";
    return { status: detail.run.status, head, artifact: detail.artifact };
  }

  /** 认知调度登记说明：调度本体在基础设施层（cron + tz），中枢只做语义包装与审计。 */
  async noteSchedule(action: "set" | "delete", payload: Record<string, unknown>): Promise<void> {
    await this.audit.record({
      actor: "hub",
      action: `agent.schedule.${action}`,
      result: "ok",
      objectType: "agent_schedule",
      payload,
    });
  }

  /** 健康聚合（供 /api/v1/health 与工具面共用）；不可达不抛错。 */
  async healthSafe(): Promise<{ reachable: boolean; paused?: boolean; problems?: unknown[]; queue?: number; active?: number; error?: string }> {
    return this.bridge.healthSafe();
  }

  /** 全局暂停认知调度（确定性 SQL 任务不受影响）。 */
  async setPaused(paused: boolean): Promise<void> {
    await this.bridge.setPaused(paused);
    await this.audit.record({
      actor: "hub",
      action: paused ? "agent.pause" : "agent.resume",
      result: "ok",
      objectType: "agent_system",
      payload: { paused },
    });
  }
}
