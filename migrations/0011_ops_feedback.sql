-- v2.18 运维闭环：运行错误自动转 GitHub Issue、用量遥测与 AI 习惯审视产出需求/体验 Issue。
-- 依据：SRS-001 REQ-OPS-001..003、PA-OPC-027。
-- 原则：只记录动作与状态，不记录业务内容/敏感值；Issue 去重 + 限额；GitHub 未配置时只攒草稿不失败。

CREATE TABLE stat.usage_event (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel     varchar(16) NOT NULL DEFAULT 'api' CHECK (channel IN ('api','ui','task','tool')),
  action      varchar(160) NOT NULL,
  status_code integer,
  duration_ms integer,
  error_code  varchar(32),
  session_ref varchar(64),
  meta        jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_event_time_idx ON stat.usage_event (occurred_at DESC);
CREATE INDEX usage_event_action_idx ON stat.usage_event (action, occurred_at DESC);

CREATE TABLE stat.runtime_error (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint    varchar(64) NOT NULL UNIQUE,
  method         varchar(8),
  route          varchar(200),
  status_code    integer,
  error_code     varchar(32),
  message        text,
  occurrences    integer NOT NULL DEFAULT 1,
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_seen      timestamptz NOT NULL DEFAULT now(),
  filed_issue_id bigint
);
CREATE INDEX runtime_error_seen_idx ON stat.runtime_error (last_seen DESC);

CREATE TABLE stat.issue_filing (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint   varchar(64) NOT NULL UNIQUE,
  source        varchar(16) NOT NULL CHECK (source IN ('runtime_error','usage_insight')),
  title         varchar(256) NOT NULL,
  body          text NOT NULL,
  severity      varchar(8) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  status        varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','filed','failed','skipped','deduped')),
  github_number integer,
  github_url    text,
  error         text,
  attempts      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  filed_at      timestamptz
);
CREATE INDEX issue_filing_status_idx ON stat.issue_filing (status, created_at DESC);
