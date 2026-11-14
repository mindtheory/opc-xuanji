-- v2.21 微信推送：裁决/简报经 BotHarness 主动投递端点推送到微信；失败退避重试，未绑定只排队不丢。
-- 依据：SRS-001 REQ-OPS-004、PA-OPC-030。
-- 依赖：dsh-im（BotHarness）已在 profile 中，且已绑定微信/企微机器人（botId + targetId 可用）。

CREATE TABLE stat.wechat_push (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind            varchar(16) NOT NULL CHECK (kind IN ('decision','brief','text')),
  title           varchar(200) NOT NULL,
  body            text NOT NULL,
  dedupe_key      varchar(200) NOT NULL UNIQUE,
  status          varchar(16) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','failed','skipped')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  provider        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX wechat_push_due_idx ON stat.wechat_push (status, next_attempt_at);
