-- v2.13 情报日报与数据源管理：项目情报空间、采集数据源、来源绑定、关键词/标签、
-- 情报条目、采集/流水线运行、日报与推送记录。
-- 依据：SRS-106 REQ-INT-011..018、PA-OPC-023。
-- 原则：凭据只存 auth_ref 引用；采集失败标 blocked/failed 不伪造条目；
-- 简报版本化不覆盖已推送版本；推送失败降级站内并留痕。

-- ============================== 项目情报空间 ==============================
CREATE TABLE biz.intel_project_scope (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id        bigint NOT NULL,
  name              varchar(128) NOT NULL,
  timezone          varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
  brief_time        varchar(5) NOT NULL DEFAULT '08:00'
                    CHECK (brief_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  lookback_hours    integer NOT NULL DEFAULT 24 CHECK (lookback_hours BETWEEN 1 AND 720),
  max_items         integer NOT NULL DEFAULT 20 CHECK (max_items BETWEEN 1 AND 200),
  push_channels     jsonb,
  recipients        jsonb,
  quiet_hours       jsonb,
  template          varchar(64),
  status            varchar(16) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','disabled')),
  config_version    varchar(16) NOT NULL DEFAULT '1',
  last_brief_at     timestamptz,
  UNIQUE (project_id)
);

-- ============================== 采集数据源与项目绑定 ==============================
CREATE TABLE biz.source (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                     varchar(128) NOT NULL,
  source_type              varchar(16) NOT NULL
                           CHECK (source_type IN ('rss','api','web','search','mcp','manual')),
  url                      text,
  auth_ref                 varchar(128),
  credibility              numeric(3,2) NOT NULL DEFAULT 0.50
                           CHECK (credibility >= 0 AND credibility <= 1),
  copyright_status         varchar(16) NOT NULL DEFAULT 'unknown'
                           CHECK (copyright_status IN ('licensed','public','unknown','restricted')),
  license_note             text,
  collect_interval_minutes integer NOT NULL DEFAULT 60
                           CHECK (collect_interval_minutes BETWEEN 5 AND 10080),
  rate_limit_per_hour      integer NOT NULL DEFAULT 60 CHECK (rate_limit_per_hour BETWEEN 1 AND 10000),
  timeout_ms               integer NOT NULL DEFAULT 15000 CHECK (timeout_ms BETWEEN 1000 AND 300000),
  enabled                  boolean NOT NULL DEFAULT true,
  status                   varchar(16) NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','disabled','blocked')),
  last_success_at          timestamptz,
  last_failure_at          timestamptz,
  consecutive_failures     integer NOT NULL DEFAULT 0,
  last_error               text,
  checkpoint               jsonb,
  created_by               varchar(64)
);
CREATE INDEX source_status_idx ON biz.source (status, enabled);
CREATE INDEX source_due_idx ON biz.source (last_success_at) WHERE enabled;

CREATE TABLE biz.source_binding (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id  bigint NOT NULL,
  project_id bigint NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  priority   integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
  tags       jsonb,
  UNIQUE (source_id, project_id)
);
CREATE INDEX source_binding_project_idx ON biz.source_binding (project_id, enabled);

-- ============================== 关键词与标签 ==============================
CREATE TABLE biz.watch_topic (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id    bigint NOT NULL,
  keyword       varchar(128) NOT NULL,
  match_type    varchar(16) NOT NULL DEFAULT 'phrase'
                CHECK (match_type IN ('exact','phrase','regex','boolean')),
  synonyms      jsonb,
  exclude_terms jsonb,
  tags          jsonb,
  priority      integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
  enabled       boolean NOT NULL DEFAULT true,
  version       integer NOT NULL DEFAULT 1,
  created_by    varchar(64),
  UNIQUE (project_id, keyword)
);
CREATE INDEX watch_topic_project_idx ON biz.watch_topic (project_id, enabled);

CREATE TABLE biz.intel_tag (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL,
  name        varchar(64) NOT NULL,
  category    varchar(32),
  parent_id   bigint,
  color       varchar(16),
  description text,
  status      varchar(16) NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','disabled')),
  UNIQUE (project_id, name)
);

-- ============================== 情报条目 ==============================
CREATE TABLE biz.intel_item (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      bigint NOT NULL,
  source_id       bigint,
  external_id     varchar(256),
  url             text,
  title           varchar(512) NOT NULL,
  summary         text,
  content_hash    varchar(64),
  language        varchar(16),
  author          varchar(128),
  published_at    timestamptz,
  collected_at    timestamptz NOT NULL DEFAULT now(),
  entities        jsonb,
  tags            jsonb,
  relevance_score numeric(5,2),
  sentiment       varchar(16)
                  CHECK (sentiment IS NULL OR sentiment IN ('positive','neutral','negative','unknown')),
  info_type       varchar(16)
                  CHECK (info_type IS NULL OR info_type IN ('fact','inference','rumor','unknown')),
  risk_level      varchar(16)
                  CHECK (risk_level IS NULL OR risk_level IN ('low','medium','high','critical','unknown')),
  confidence      numeric(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  dedupe_group    varchar(64),
  status          varchar(16) NOT NULL DEFAULT 'collected'
                  CHECK (status IN ('collected','analyzed','filtered','briefed','archived','failed')),
  analysis        jsonb,
  idempotency_key varchar(256) NOT NULL,
  UNIQUE (project_id, idempotency_key)
);
CREATE INDEX intel_item_project_status_idx ON biz.intel_item (project_id, status, relevance_score DESC);
CREATE INDEX intel_item_published_idx ON biz.intel_item (published_at DESC NULLS LAST);
CREATE INDEX intel_item_dedupe_idx ON biz.intel_item (project_id, content_hash) WHERE content_hash IS NOT NULL;

-- ============================== 日报 ==============================
CREATE TABLE biz.intel_brief (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id    bigint NOT NULL,
  brief_date    date NOT NULL,
  brief_type    varchar(16) NOT NULL DEFAULT 'daily'
                CHECK (brief_type IN ('daily','weekly')),
  title         varchar(256) NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','ready','pushed','failed')),
  coverage      jsonb,
  sections      jsonb,
  item_ids      jsonb,
  source_count  integer NOT NULL DEFAULT 0,
  item_count    integer NOT NULL DEFAULT 0,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  pushed_at     timestamptz,
  version       integer NOT NULL DEFAULT 1,
  UNIQUE (project_id, brief_date, brief_type, version)
);
CREATE INDEX intel_brief_project_date_idx ON biz.intel_brief (project_id, brief_date DESC, version DESC);

-- ============================== 采集/流水线/推送运行 ==============================
CREATE TABLE stat.intel_collect_run (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id         bigint,
  project_id        bigint,
  idempotency_key   varchar(160) NOT NULL UNIQUE,
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  status            varchar(16) NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','ok','partial','failed','blocked','skipped')),
  fetched           integer NOT NULL DEFAULT 0,
  inserted          integer NOT NULL DEFAULT 0,
  duplicates        integer NOT NULL DEFAULT 0,
  http_status       integer,
  latency_ms        integer,
  error             text,
  checkpoint_before jsonb,
  checkpoint_after  jsonb
);
CREATE INDEX intel_collect_run_source_idx ON stat.intel_collect_run (source_id, started_at DESC);
CREATE INDEX intel_collect_run_project_idx ON stat.intel_collect_run (project_id, started_at DESC);

CREATE TABLE stat.intel_pipeline_run (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      bigint NOT NULL,
  pipeline_date   date NOT NULL,
  stage           varchar(16) NOT NULL
                  CHECK (stage IN ('collect','analyze','aggregate','brief','push')),
  status          varchar(16) NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','ok','partial','failed','skipped')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  counters        jsonb,
  error           text,
  idempotency_key varchar(160) NOT NULL UNIQUE
);
CREATE INDEX intel_pipeline_project_idx ON stat.intel_pipeline_run (project_id, pipeline_date DESC, stage);

CREATE TABLE stat.intel_push_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brief_id   bigint NOT NULL,
  project_id bigint NOT NULL,
  channel    varchar(16) NOT NULL,
  target     varchar(256) NOT NULL,
  status     varchar(16) NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','sent','failed','acked')),
  attempts   integer NOT NULL DEFAULT 0,
  sent_at    timestamptz,
  acked_at   timestamptz,
  error      text,
  UNIQUE (brief_id, channel, target)
);
CREATE INDEX intel_push_log_project_idx ON stat.intel_push_log (project_id, status, sent_at DESC);
