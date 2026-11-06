-- 网页表现层（v2.10）：归置收件箱、会话授权、记忆桥、驾驶舱快照、雷达。
-- 依据：产品设计第九章、技术架构第八章；表名/列名与 spec/opc-xuanji/entities.yaml 一一对应。
-- 约束：面板不直连业务主表；高风险域写回只标记确认，具体写入仍由员工插件经中枢完成。

CREATE TABLE stat.web_ingest_item (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_type     varchar(16) NOT NULL
                  CHECK (source_type IN ('session_message','upload','voice','manual')),
  source_ref      varchar(128) NOT NULL,
  raw_text        text NOT NULL,
  content_hash    varchar(64) NOT NULL,
  extracted       jsonb NOT NULL DEFAULT '{}'::jsonb,
  domain          varchar(16) NOT NULL
                  CHECK (domain IN ('finance','legal','admin','strategy','project','intel','crm','inventory','vehicle','inbox')),
  confidence      numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status          varchar(16) NOT NULL DEFAULT 'inbox'
                  CHECK (status IN ('auto_draft','pending','confirmed','ignored','inbox')),
  requires_human  boolean NOT NULL DEFAULT true,
  idempotency_key varchar(128) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_by    varchar(64),
  confirmed_at    timestamptz,
  UNIQUE (idempotency_key),
  UNIQUE (source_ref, content_hash)
);
CREATE INDEX web_ingest_status_idx ON stat.web_ingest_item (status, created_at);

CREATE TABLE ref.web_session_grant (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id    varchar(128) NOT NULL,
  message_scope varchar(32) NOT NULL DEFAULT 'recent_20',
  purpose       varchar(128) NOT NULL,
  granted_by    varchar(64) NOT NULL DEFAULT 'boss',
  granted_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  status        varchar(16) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','revoked','expired'))
);
CREATE INDEX web_session_grant_idx ON ref.web_session_grant (session_id, status, expires_at);

CREATE TABLE stat.web_session_message (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id varchar(128) NOT NULL,
  message_id varchar(128) NOT NULL,
  role       varchar(16) NOT NULL CHECK (role IN ('boss','hub','agent','system')),
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, message_id)
);
CREATE INDEX web_session_message_idx ON stat.web_session_message (session_id, created_at DESC);

CREATE TABLE stat.web_memory_card (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope        varchar(32) NOT NULL
               CHECK (scope IN ('company_profile','experience','skill','customer','session_digest')),
  title        varchar(128) NOT NULL,
  content      text NOT NULL,
  source_refs  jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence   numeric(3,2) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  content_hash varchar(64) NOT NULL,
  sensitive    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, content_hash)
);

CREATE TABLE stat.web_memory_proposal (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  memory_type  varchar(32) NOT NULL
               CHECK (memory_type IN ('company_profile','experience','skill','customer','session_digest')),
  title        varchar(128) NOT NULL,
  content      text NOT NULL,
  source_refs  jsonb NOT NULL,
  confidence   numeric(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status       varchar(16) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','confirmed','rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE INDEX web_memory_proposal_idx ON stat.web_memory_proposal (status, created_at);

CREATE TABLE stat.dashboard_snapshot (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  range_key    varchar(16) NOT NULL CHECK (range_key IN ('today','7d','30d','90d')),
  as_of        timestamptz NOT NULL,
  stale        boolean NOT NULL DEFAULT false,
  payload      jsonb NOT NULL,
  warnings     jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dashboard_snapshot_idx ON stat.dashboard_snapshot (range_key, generated_at DESC);

CREATE TABLE stat.brief_item (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brief_date  date NOT NULL,
  brief_type  varchar(16) NOT NULL CHECK (brief_type IN ('daily','weekly','monthly','session')),
  title       varchar(128) NOT NULL,
  summary     text NOT NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority    varchar(8) NOT NULL DEFAULT 'normal' CHECK (priority IN ('high','normal','low')),
  status      varchar(16) NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','ignored')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brief_date, brief_type, title)
);
CREATE INDEX brief_item_date_idx ON stat.brief_item (brief_date, brief_type);

CREATE TABLE stat.radar_item (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  radar_type   varchar(16) NOT NULL CHECK (radar_type IN ('plugin','keyword')),
  title        varchar(256) NOT NULL,
  url          text NOT NULL,
  published_at date,
  score        numeric(5,2) NOT NULL DEFAULT 0,
  reason       text NOT NULL,
  risks        jsonb NOT NULL DEFAULT '[]'::jsonb,
  dedupe_key   varchar(256) NOT NULL,
  status       varchar(16) NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','ignored')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (radar_type, dedupe_key)
);
CREATE INDEX radar_status_idx ON stat.radar_item (status, published_at DESC);
