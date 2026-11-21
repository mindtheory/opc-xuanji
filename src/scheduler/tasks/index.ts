/**
 * 首批定时自动化任务（配置驱动，老板可在任务表里增删改 cron/时区/参数）。
 *
 * 与产品设计「六、主动智能事件总表」对应：
 *   daily_report（工作日 08:30 聚合）、tax_reminder（申报 ≤7 天）、contract_expiry（到期 ≤30 天）、
 *   invoice_backlog（缺票积压，周五汇总）、conflict_escalation（冲突超期，按小时）、
 *   audit_export（每日 02:00 增量导出）、monthly_archive（每月 1 日归档）。
 */
import { join } from "node:path";
import { OpcError, ERR } from "../../platform/errors.ts";
import type { TaskDefinition } from "../engine.ts";
import { DashboardService } from "../../web/dashboard.ts";
import { RadarService } from "../../web/services.ts";
import { IntelPipelineService, type RawIntelItem } from "../../domains/intel/daily.ts";
import { CompanyIntelService } from "../../domains/intel/company.ts";
import type { PluginCandidate } from "../../web/plugin-score.ts";
import { IssueReporter, UsageService } from "../../ops/feedback.ts";
import { WechatPushService } from "../../notify/wechat.ts";
import { ProjectAutopilotService } from "../../domains/project/autopilot.ts";
import { SuperAgentsBridge } from "../../agents/bridge.ts";
import { SuperAgentService } from "../../agents/service.ts";
import { SalesService } from "../../domains/sales/service.ts";
import { GoofishRpa, runSalesRadar, runSalesOrderListen, runSalesListing } from "../../domains/sales/rpa.ts";
import { CompletenessService } from "../../domains/admin/completeness.ts";

function monthPath(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return join(String(year), month);
}

export function defaultTasks(): TaskDefinition[] {
  return [
    {
      id: "wechat_push",
      name: "微信推送（每分钟投递到期裁决/简报）",
      defaults: { cron: "*/1 * * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const wechat = new WechatPushService(ctx.pool, ctx.audit);
        return wechat.deliverPending(20);
      },
    },
    {
      id: "project_plan_auto",
      name: "项目计划自动推进（每 15 分钟，按自动驾驶设置并发推进）",
      defaults: { cron: "*/15 * * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const bridge = new SuperAgentsBridge({ baseUrl: process.env.OPC_SUPER_AGENTS_URL?.trim() || undefined });
        const agents = new SuperAgentService(bridge, ctx.audit, { archiveDir: ctx.archiveDir });
        const autopilot = new ProjectAutopilotService(ctx.pool, ctx.audit, undefined, agents);
        const result = await autopilot.autoAdvanceNext(ctx.now);
        if (result.completed === true) await ctx.notify("project_plan_completed", "digest", { projectId: result.projectId, runId: result.runId });
        if (result.blocked === true) await ctx.notify("project_plan_blocked", "digest", { projectId: result.projectId, topic: result.blockTopic });
        return { ...result };
      },
    },
    {
      id: "sales_radar",
      name: "虚拟销售雷达（每天 09:30 检索闲鱼虚拟服务需求）",
      defaults: { cron: "30 9 * * *", timezone: "Asia/Shanghai", enabled: false },
      async handler(ctx) {
        const sales = new SalesService(ctx.pool, ctx.audit);
        const rpa = new GoofishRpa(sales);
        const notify = async (text: string) => ctx.notify("sales_alert", "instant", { text });
        return runSalesRadar(sales, rpa, notify);
      },
    },
    {
      id: "sales_orders",
      name: "虚拟销售订单值守（每 30 分钟拉单并自动生产交付物）",
      defaults: { cron: "*/30 * * * *", timezone: "Asia/Shanghai", enabled: false },
      async handler(ctx) {
        const sales = new SalesService(ctx.pool, ctx.audit);
        const rpa = new GoofishRpa(sales);
        const notify = async (text: string) => ctx.notify("sales_alert", "instant", { text });
        return runSalesOrderListen(sales, rpa, notify);
      },
    },
    {
      id: "sales_listing",
      name: "虚拟销售上架值守（每 2 小时执行老板已确认的上架单）",
      defaults: { cron: "0 */2 * * *", timezone: "Asia/Shanghai", enabled: false },
      async handler(ctx) {
        const sales = new SalesService(ctx.pool, ctx.audit);
        const rpa = new GoofishRpa(sales);
        const notify = async (text: string) => ctx.notify("sales_alert", "instant", { text });
        return runSalesListing(sales, rpa, notify);
      },
    },
    {
      id: "issue_autofile",
      name: "运行错误自动开 Issue（每 30 分钟）",
      defaults: { cron: "*/30 * * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const issues = new IssueReporter(ctx.pool, ctx.audit);
        return issues.sync();
      },
    },
    {
      id: "usage_insight",
      name: "AI 审视使用习惯（每周一 09:00）",
      defaults: { cron: "0 9 * * 1", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const usage = new UsageService(ctx.pool);
        const issues = new IssueReporter(ctx.pool, ctx.audit);
        const drafts = await usage.insightDrafts(7);
        const sync = await issues.sync();
        return { drafts: drafts.length, ...sync };
      },
    },
    {
      id: "daily_report",
      name: "每日晨报（工作日 08:30）",
      defaults: { cron: "30 8 * * 1-5", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const tax = await ctx.pool.query<{ tax_type: string; period: string; deadline: string }>(
          `SELECT tax_type, period, deadline::text FROM biz.tax_calendar
           WHERE status = 'pending' AND deadline BETWEEN current_date AND current_date + 7 ORDER BY deadline`,
        );
        const contracts = await ctx.pool.query<{ counterparty: string; amount: string | null; end_date: string }>(
          `SELECT counterparty, amount::text, end_date::text FROM biz.contract
           WHERE status = 'active' AND end_date BETWEEN current_date AND current_date + 30 ORDER BY end_date`,
        );
        const conflicts = await ctx.pool.query(
          `SELECT id, conflict_type, frozen_unit_type, frozen_unit_id, detected_at
           FROM biz.conflict_queue WHERE status IN ('open','later') ORDER BY detected_at LIMIT 50`,
        );
        const escalations = await ctx.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit.verifier_verdict WHERE escalated AND created_at > now() - interval '7 days'`,
        );
        const content = {
          generatedAt: ctx.now.toISOString(),
          taxAlerts: tax.rows,
          contractAlerts: contracts.rows,
          conflicts: conflicts.rows,
          escalatedVerdicts: escalations.rows[0]?.n ?? 0,
        };
        await ctx.pool.query(
          `INSERT INTO stat.daily_report (report_date, content, sent_at) VALUES (current_date, $1::jsonb, now())
           ON CONFLICT (report_date) DO UPDATE SET content = EXCLUDED.content, sent_at = now()`,
          [JSON.stringify(content)],
        );
        await ctx.notify("daily_report", "digest", {
          taxAlerts: tax.rows.length,
          contractAlerts: contracts.rows.length,
          conflicts: conflicts.rows.length,
        });
        // 简报同步推微信（未绑定只入队，不阻塞晨报）
        const wechat = new WechatPushService(ctx.pool, ctx.audit);
        const briefLines = [
          `今日待办：税务预警 ${tax.rows.length} 条、合同到期 ${contracts.rows.length} 条、待裁决冲突 ${conflicts.rows.length} 条`,
          ...tax.rows.slice(0, 5).map((row) => `· 税务：${String((row as Record<string, unknown>).tax_type ?? "")} ${String((row as Record<string, unknown>).period ?? "")} 截止 ${String((row as Record<string, unknown>).deadline ?? "")}`),
          ...contracts.rows.slice(0, 5).map((row) => `· 合同：${String((row as Record<string, unknown>).counterparty ?? "")} 到期 ${String((row as Record<string, unknown>).end_date ?? "")}`),
        ];
        await wechat.enqueueBrief("每日晨报", briefLines.join("\n"), `brief:daily_report:${ctx.now.toISOString().slice(0, 10)}`).catch(() => undefined);
        return { reportDate: ctx.now.toISOString().slice(0, 10), taxAlerts: tax.rows.length, contractAlerts: contracts.rows.length, conflicts: conflicts.rows.length };
      },
    },
    {
      id: "completeness_check",
      name: "信息完善度巡检（每日 09:10，AI 补全 + 向老板提问）",
      defaults: { cron: "10 9 * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const result = await new CompletenessService(ctx.pool, ctx.audit).inspect(ctx.now);
        if (result.questions !== undefined && Number(result.questions) > 0) {
          await ctx.notify("completeness_questions", "digest", { score: result.score, questions: result.questions, autoFilled: result.autoFilled });
          const wechat = new WechatPushService(ctx.pool, ctx.audit);
          await wechat.enqueueBrief("信息完善度巡检", `完善度 ${result.score}%：AI 已自动补全 ${result.autoFilled} 项，还有 ${result.questions} 个问题等老板在「设置 → 信息完善度巡检」回答。`, `brief:completeness:${ctx.now.toISOString().slice(0, 10)}`).catch(() => undefined);
        }
        return result;
      },
    },
    {
      id: "tax_reminder",
      name: "税务申报预警（≤7 天）",
      defaults: { cron: "0 9 * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const rows = await ctx.pool.query<{ id: string; tax_type: string; deadline: string }>(
          `SELECT id, tax_type, deadline::text FROM biz.tax_calendar
           WHERE status = 'pending' AND deadline BETWEEN current_date AND current_date + 7 ORDER BY deadline`,
        );
        if (rows.rows.length > 0) {
          await ctx.notify("tax_reminder", "digest", { items: rows.rows });
        }
        return { reminders: rows.rows.length };
      },
    },
    {
      id: "contract_expiry",
      name: "合同到期提醒（≤30 天）",
      defaults: { cron: "0 9 * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const rows = await ctx.pool.query<{ id: string; counterparty: string; end_date: string }>(
          `SELECT id, counterparty, end_date::text FROM biz.contract
           WHERE status = 'active' AND end_date BETWEEN current_date AND current_date + 30 ORDER BY end_date`,
        );
        if (rows.rows.length > 0) await ctx.notify("contract_expiry", "digest", { items: rows.rows });
        return { expiring: rows.rows.length };
      },
    },
    {
      id: "invoice_backlog",
      name: "缺票入库积压（周五汇总）",
      defaults: { cron: "0 10 * * 5", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const threshold = Number(ctx.config.invoiceBacklogThreshold ?? 0);
        const row = await ctx.pool.query<{ n: number; amount: string }>(
          `SELECT count(*)::int AS n, coalesce(sum(qty * unit_price), 0)::text AS amount
           FROM biz.stock_txn WHERE txn_type = 'in' AND (invoice_status IS NULL OR invoice_status <> 'received')`,
        );
        const amount = Number(row.rows[0]?.amount ?? 0);
        const count = row.rows[0]?.n ?? 0;
        if (amount > threshold) await ctx.notify("invoice_backlog", "digest", { count, amount, threshold });
        return { count, amount, threshold };
      },
    },
    {
      id: "conflict_escalation",
      name: "冲突超期提醒（>7 天每日、>30 天月报）",
      defaults: { cron: "0 * * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const rows = await ctx.pool.query<{ id: string; days: string; level: string }>(
          `SELECT id, date_part('day', now() - detected_at)::int::text AS days,
                  CASE WHEN detected_at < now() - interval '30 days' THEN 'monthly' ELSE 'daily' END AS level
           FROM biz.conflict_queue WHERE status IN ('open','later') AND detected_at < now() - interval '7 days'`,
        );
        if (rows.rows.length > 0) {
          await ctx.notify("conflict_escalation", "digest", { items: rows.rows });
        }
        return { overdue: rows.rows.length };
      },
    },
    {
      id: "audit_export",
      name: "审计增量导出（每日 02:00）",
      defaults: { cron: "0 2 * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const outDir = join(ctx.archiveDir, "audit", monthPath(ctx.now));
        try {
          const exported = await ctx.audit.export({ outDir });
          return { ...exported, rowCount: exported.rowCount };
        } catch (error) {
          if (error instanceof OpcError && error.errorCode === ERR.AUDIT_FAILED && error.message.includes("没有可导出")) {
            return { skipped: true, reason: "无新增审计记录" };
          }
          throw error;
        }
      },
    },
    {
      id: "monthly_archive",
      name: "月度归档（每月 1 日 03:00）",
      defaults: { cron: "0 3 1 * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const outDir = join(ctx.archiveDir, "audit", monthPath(ctx.now));
        const exported = await ctx.audit.export({ outDir });
        await ctx.notify("monthly_archive", "info", { filePath: exported.filePath, rowCount: exported.rowCount });
        return { ...exported };
      },
    },
    {
      id: "dashboard_refresh",
      name: "驾驶舱刷新（每 15 分钟 + 事件触发）",
      defaults: { cron: "*/15 * * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const range = ctx.config.range === "today" || ctx.config.range === "7d" || ctx.config.range === "90d" ? ctx.config.range : "30d";
        const snapshot = await new DashboardService(ctx.pool).snapshot(range);
        if (snapshot.warnings.length > 0) {
          await ctx.notify("dashboard_warning", "digest", { asOf: snapshot.asOf, warnings: snapshot.warnings });
        }
        return { snapshotId: snapshot.snapshotId, asOf: snapshot.asOf, metrics: snapshot.metrics.length, warnings: snapshot.warnings };
      },
    },
    {
      id: "plugin_radar_scan",
      name: "DSH 插件雷达（每周一 06:00，只推荐不安装）",
      defaults: { cron: "0 6 * * 1", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const candidates = Array.isArray(ctx.config.pluginCandidates) ? (ctx.config.pluginCandidates as PluginCandidate[]) : [];
        if (candidates.length === 0) {
          return { scanned: 0, recommended: 0, note: "未配置检索源，本次未检索" };
        }
        const profile = (ctx.config.companyProfile as { domains?: string[]; requiredViews?: string[]; dataPolicy?: "local_only" | "allow_remote" }) ?? {};
        const result = await new RadarService(ctx.pool).recommendPlugins(candidates, profile, ctx.now);
        await ctx.notify("plugin_radar", "digest", { ...result, candidateCount: candidates.length });
        return { scanned: candidates.length, ...result };
      },
    },
    {
      id: "keyword_radar_scan",
      name: "公司发展关键词雷达（每日 07:00）",
      defaults: { cron: "0 7 * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const items = Array.isArray(ctx.config.keywordItems) ? (ctx.config.keywordItems as Array<Record<string, unknown>>) : [];
        if (items.length === 0) {
          return { scanned: 0, written: 0, note: "未配置检索源，本次未检索" };
        }
        const written = await new RadarService(ctx.pool).upsert(
          items.map((item) => ({
            type: "keyword" as const,
            title: String(item.title ?? ""),
            url: String(item.url ?? ""),
            publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : undefined,
            score: typeof item.score === "number" ? item.score : 0,
            reason: String(item.reason ?? "关键词命中"),
            risks: Array.isArray(item.risks) ? (item.risks as string[]) : [],
            dedupeKey: String(item.dedupeKey ?? item.url ?? item.title ?? ""),
          })),
        );
        await ctx.notify("keyword_radar", "digest", { written, scanned: items.length });
        return { scanned: items.length, written };
      },
    },
    {
      id: "intel_company_collect",
      name: "公司情况采集（每 30 分钟，公开来源→公司情报库）",
      defaults: { cron: "*/30 * * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const result = await new CompanyIntelService(ctx.pool, ctx.audit).collectAll(ctx.now);
        if (result.failed > 0) await ctx.notify("intel_company_collect_failed", "digest", { due: result.due, failed: result.failed, errors: result.sources.filter((s) => s.error !== undefined).map((s) => `${s.name}：${s.error}`) });
        return { enabled: result.enabled, due: result.due, collected: result.collected, inserted: result.inserted, duplicates: result.duplicates, failed: result.failed };
      },
    },
    {
      id: "intel_company_memory",
      name: "公司情报入记忆（每日 08:40，近 24h 摘要→记忆提议）",
      defaults: { cron: "40 8 * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const result = await new CompanyIntelService(ctx.pool, ctx.audit).memoryDigest(ctx.now);
        if (result.proposals > 0) await ctx.notify("intel_company_memory", "digest", { proposals: result.proposals, titles: result.titles });
        return { proposals: result.proposals, skipped: result.skipped, items: result.items };
      },
    },
    {
      id: "intel_source_collect",
      name: "情报采集（每 30 分钟，按来源间隔与限流）",
      defaults: { cron: "*/30 * * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const raw = Array.isArray(ctx.config.intelItems) ? (ctx.config.intelItems as Array<Record<string, unknown>>) : [];
        const result = await new IntelPipelineService(ctx.pool).collectAll(ctx.now, raw.map(toRawIntelItem));
        if (result.blocked > 0) await ctx.notify("intel_source_blocked", "digest", { ...result });
        return { ...result };
      },
    },
    {
      id: "intel_analyze",
      name: "情报分析（每小时，关键词/标签评分与去重）",
      defaults: { cron: "10 * * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const result = await new IntelPipelineService(ctx.pool).analyze(ctx.now);
        return { ...result };
      },
    },
    {
      id: "intel_aggregate",
      name: "情报汇总（每日按项目，产出覆盖度）",
      defaults: { cron: "20 6 * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const result = await new IntelPipelineService(ctx.pool).aggregate(ctx.now);
        return { ...result };
      },
    },
    {
      id: "intel_brief",
      name: "情报日报生成（每 10 分钟检查项目到点时间）",
      defaults: { cron: "*/10 * * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const briefs = await new IntelPipelineService(ctx.pool).buildBriefs(ctx.now);
        const created = briefs.filter((brief) => !brief.skipped).length;
        if (created > 0) await ctx.notify("intel_brief", "digest", { created, briefs });
        return { projects: briefs.length, created, briefs };
      },
    },
    {
      id: "intel_push",
      name: "情报日报推送（外部渠道不可用时降级站内）",
      defaults: { cron: "*/10 * * * *", timezone: "Asia/Shanghai", enabled: true },
      async handler(ctx) {
        const result = await new IntelPipelineService(ctx.pool).push(ctx.now);
        if (result.pending > 0) await ctx.notify("intel_push_pending", "digest", result);
        return { ...result };
      },
    },
  ];
}

function toRawIntelItem(item: Record<string, unknown>): RawIntelItem {
  return {
    projectId: toOptionalNumber(item.projectId),
    sourceId: toOptionalNumber(item.sourceId),
    externalId: typeof item.externalId === "string" ? item.externalId : undefined,
    url: typeof item.url === "string" ? item.url : undefined,
    title: String(item.title ?? ""),
    summary: typeof item.summary === "string" ? item.summary : undefined,
    publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : undefined,
    author: typeof item.author === "string" ? item.author : undefined,
    language: typeof item.language === "string" ? item.language : undefined,
    tags: Array.isArray(item.tags) ? (item.tags as string[]) : undefined,
    sentiment: typeof item.sentiment === "string" ? item.sentiment : undefined,
    infoType: typeof item.infoType === "string" ? item.infoType : undefined,
    riskLevel: typeof item.riskLevel === "string" ? item.riskLevel : undefined,
    confidence: typeof item.confidence === "number" ? item.confidence : undefined,
  };
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}
