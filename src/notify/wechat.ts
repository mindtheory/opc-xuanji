/**
 * 微信推送（SRS-001 REQ-OPS-004）：把「待老板裁决」和「简报」推到微信。
 *
 * 通道：复用已安装的 dsh-im（BotHarness）主动投递端点
 *   POST {deliveryUrl} {"botId","targetId","text"}
 * 默认 http://127.0.0.1:3081/api/dsh-im/delivery/messages。
 *
 * 配置（缺失时只排队、不丢消息）：
 *   OPC_WECHAT_BOT_ID / OPC_WECHAT_TARGET_ID / OPC_WECHAT_DELIVERY_URL / OPC_WECHAT_ENABLED=1
 *
 * 边界：消息先入 stat.wechat_push 队列，按退避重试（5 次，2s→300s）；正文脱敏；
 * 未绑定不报错、不阻塞裁决与晨报，只标 pending 等绑定后补发。
 */
import type { Pool } from "../db/pool.ts";
import type { AuditService } from "../audit/audit.ts";

type Row = Record<string, unknown>;

const SECRET_LIKE = /(token|password|passwd|secret|api[_-]?key|authorization)\s*[:=]\s*\S+/gi;
const MAX_ATTEMPTS = 5;
const DEFAULT_URL = "http://127.0.0.1:3081/api/dsh-im/delivery/messages";

function scrub(text: string): string {
  return text.replace(SECRET_LIKE, "$1=***").slice(0, 4000);
}

function backoffMs(attempts: number): number {
  return Math.min(300_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

export interface WechatConfig {
  enabled: boolean;
  deliveryUrl: string;
  botId: string;
  targetId: string;
}

export class WechatPushService {
  private readonly pool: Pool;
  private readonly audit: AuditService;

  constructor(pool: Pool, audit: AuditService) {
    this.pool = pool;
    this.audit = audit;
  }

  config(): WechatConfig {
    const explicitlyEnabled = process.env.OPC_WECHAT_ENABLED === "1";
    const explicitlyDisabled = process.env.OPC_WECHAT_ENABLED === "0";
    return {
      enabled: !explicitlyDisabled && (explicitlyEnabled || process.env.OPC_WECHAT_BOT_ID !== undefined),
      deliveryUrl: (process.env.OPC_WECHAT_DELIVERY_URL ?? DEFAULT_URL).trim(),
      botId: (process.env.OPC_WECHAT_BOT_ID ?? "").trim(),
      targetId: (process.env.OPC_WECHAT_TARGET_ID ?? "").trim(),
    };
  }

  /** 入队（同 dedupeKey 只留一条，重复入队不刷屏）。 */
  async enqueue(input: { kind: "decision" | "brief" | "text"; title: string; body: string; dedupeKey: string }): Promise<Row | null> {
    const result = await this.pool.query(
      `INSERT INTO stat.wechat_push (kind, title, body, dedupe_key)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id, kind, title, status`,
      [input.kind, input.title.slice(0, 200), scrub(input.body), input.dedupeKey.slice(0, 200)],
    );
    return (result.rows[0] as Row | undefined) ?? null;
  }

  async enqueueDecision(projectId: number, decision: Row): Promise<void> {
    const topic = String(decision.topic ?? "decision");
    const id = String(decision.id ?? "");
    await this.enqueue({
      kind: "decision",
      title: `【待裁决】项目 ${projectId} · ${topic}`,
      body: [
        `问题：${String(decision.question ?? "")}`,
        `风险：${String(decision.risk_level ?? "medium")}`,
        Array.isArray(decision.options) && decision.options.length > 0
          ? `选项：${(decision.options as Array<{ label?: string; impact?: string }>).map((item, index) => `${index + 1}. ${item.label ?? ""}（${item.impact ?? ""}）`).join("；")}`
          : "",
        "",
        "在 DSH 里裁决；微信里也可直接说话，由老板确认。",
      ].filter((line) => line !== "").join("\n"),
      dedupeKey: `decision:${projectId}:${topic}:${id}`,
    });
  }

  async enqueueBrief(title: string, body: string, dedupeKey: string): Promise<void> {
    await this.enqueue({ kind: "brief", title: `【简报】${title}`, body, dedupeKey });
  }

  /** 投递到期消息（后台任务调用）。 */
  async deliverPending(limit = 20): Promise<Row> {
    const config = this.config();
    const due = await this.pool.query(
      `SELECT id, kind, title, body, attempts FROM stat.wechat_push
       WHERE status IN ('pending','failed') AND attempts < $2 AND next_attempt_at <= now()
       ORDER BY id LIMIT $1`,
      [Math.min(Math.max(limit, 1), 100), MAX_ATTEMPTS],
    );
    if (due.rows.length === 0) return { sent: 0, failed: 0, skipped: 0, note: "没有到期消息" };
    if (!config.enabled || config.botId === "" || config.targetId === "") {
      const missing = [config.botId === "" ? "OPC_WECHAT_BOT_ID" : null, config.targetId === "" ? "OPC_WECHAT_TARGET_ID" : null].filter(Boolean).join("、");
      for (const row of due.rows as Row[]) {
        await this.pool.query(
          "UPDATE stat.wechat_push SET status = 'pending', last_error = $2, next_attempt_at = now() + interval '10 minutes' WHERE id = $1",
          [row.id, `未配置微信投递目标：${missing}`],
        );
      }
      return { sent: 0, failed: 0, skipped: due.rows.length, note: `未配置微信投递目标：${missing}` };
    }
    let sent = 0;
    let failed = 0;
    for (const row of due.rows as Row[]) {
      const text = `${String(row.title)}\n\n${String(row.body)}`;
      try {
        const response = await fetch(config.deliveryUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ botId: config.botId, targetId: config.targetId, text }),
          signal: AbortSignal.timeout(20_000),
        });
        const payload = (await response.json().catch(() => null)) as Row | null;
        if (!response.ok) {
          const errorCode = String((payload?.error as Row | undefined)?.code ?? `http-${response.status}`);
          throw new Error(`微信投递失败：${errorCode}`);
        }
        await this.pool.query(
          "UPDATE stat.wechat_push SET status = 'sent', sent_at = now(), attempts = attempts + 1, provider = $2::jsonb, last_error = NULL WHERE id = $1",
          [row.id, JSON.stringify(payload ?? {})],
        );
        sent += 1;
      } catch (error) {
        const message = scrub(error instanceof Error ? error.message : String(error)).slice(0, 500);
        const attempts = Number(row.attempts ?? 0) + 1;
        const status = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
        await this.pool.query(
          `UPDATE stat.wechat_push SET status = $2, attempts = $3, last_error = $4, next_attempt_at = now() + ($5 || ' milliseconds')::interval WHERE id = $1`,
          [row.id, status, attempts, message, String(backoffMs(attempts))],
        );
        failed += 1;
      }
    }
    await this.audit.record({ actor: "boss", action: "wechat.push", result: failed > 0 ? "error" : "ok", objectType: "WechatPush", objectId: String(sent), payload: { sent, failed } });
    return { sent, failed, skipped: 0 };
  }

  async status(): Promise<Row> {
    const config = this.config();
    const stats = await this.pool.query<{ pending: number; failed: number; sent24h: number; last_error: string | null }>(
      `SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
              count(*) FILTER (WHERE status = 'failed')::int AS failed,
              count(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '24 hours')::int AS "sent24h",
              (SELECT last_error FROM stat.wechat_push WHERE last_error IS NOT NULL ORDER BY id DESC LIMIT 1) AS last_error
       FROM stat.wechat_push`,
    );
    return {
      enabled: config.enabled,
      deliveryUrl: config.deliveryUrl,
      botIdConfigured: config.botId !== "",
      targetIdConfigured: config.targetId !== "",
      ...stats.rows[0],
      hint: config.botId === "" || config.targetId === ""
        ? "先在 DSH 设置 → IM 机器人绑定微信 bot，再设置 OPC_WECHAT_BOT_ID / OPC_WECHAT_TARGET_ID 并重启"
        : "已配置，后台任务每分钟投递到期消息",
    };
  }

  async list(limit = 30): Promise<Row[]> {
    const capped = Math.min(Math.max(limit, 1), 200);
    const result = await this.pool.query(
      "SELECT id, kind, title, status, attempts, next_attempt_at, last_error, created_at, sent_at FROM stat.wechat_push ORDER BY id DESC LIMIT $1",
      [capped],
    );
    return result.rows;
  }

  async sendNow(text: string): Promise<Row> {
    await this.enqueue({ kind: "text", title: "【通知】", body: text, dedupeKey: `text:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` });
    return this.deliverPending(5);
  }
}
