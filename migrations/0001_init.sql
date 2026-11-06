-- OPC-玄机 · 一人公司中枢 —— 初始 schema（语义分层 biz/ref/audit/stat/vec）
-- 前置：目标库已由 DBA 安装 pgvector（CREATE EXTENSION vector），本项目迁移不提升权限。
-- 依据：spec/opc-xuanji/entities.yaml（本文件表名/列名必须与其一一对应，test/unit/spec-consistency 校验）。
-- 约定：所有主键 bigint / identity；时间列 timestamptz；金额 numeric(18,2)；JSON 载荷 jsonb。

CREATE SCHEMA IF NOT EXISTS biz;
CREATE SCHEMA IF NOT EXISTS ref;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS stat;
CREATE SCHEMA IF NOT EXISTS vec;

-- ============================== biz ==============================
CREATE TABLE biz.company_profile (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              varchar(128) NOT NULL,
  entity_type       varchar(32) NOT NULL,
  tax_types         jsonb,
  bank_accounts     jsonb,
  owner_preferences jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE biz.conflict_queue (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conflict_type     varchar(32) NOT NULL
                    CHECK (conflict_type IN ('cost','customer','stock_batch','contract_amount')),
  frozen_unit_type  varchar(32) NOT NULL,
  frozen_unit_id    bigint NOT NULL,
  parties           jsonb NOT NULL,
  diff_fields       jsonb,
  detected_at       timestamptz NOT NULL DEFAULT now(),
  status            varchar(16) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','resolved','cleared','later')),
  arbitration_id    bigint
);

CREATE TABLE biz.ledger (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date       date NOT NULL,
  amount           numeric(18,2) NOT NULL,
  direction        varchar(8) NOT NULL CHECK (direction IN ('in','out')),
  category         varchar(32) NOT NULL,
  entity           varchar(16) NOT NULL CHECK (entity IN ('company','personal')),
  invoice_id       varchar(64),
  project_id       bigint,
  note             text,
  conflict_frozen  boolean NOT NULL DEFAULT false
);
CREATE INDEX ledger_frozen_idx ON biz.ledger (conflict_frozen) WHERE conflict_frozen;

CREATE TABLE biz.tax_calendar (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_type       varchar(32) NOT NULL,
  period         varchar(16) NOT NULL,
  deadline       date NOT NULL,
  status         varchar(16) NOT NULL DEFAULT 'pending',
  source_version varchar(32),
  UNIQUE (tax_type, period)
);

CREATE TABLE biz.ar_ap (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  counterparty  varchar(128) NOT NULL,
  amount        numeric(18,2) NOT NULL,
  due           date,
  status        varchar(16) NOT NULL DEFAULT 'open',
  contract_id   bigint,
  project_id    bigint
);

CREATE TABLE biz.contract (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  counterparty     varchar(128) NOT NULL,
  amount           numeric(18,2),
  start_date       date,
  end_date         date,
  status           varchar(16) NOT NULL DEFAULT 'active',
  risk_flags       jsonb,
  conflict_frozen  boolean NOT NULL DEFAULT false
);
CREATE INDEX contract_end_idx ON biz.contract (end_date) WHERE status = 'active';

CREATE TABLE biz.event (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  start_at         timestamptz NOT NULL,
  participants     jsonb,
  related_customer bigint,
  related_project  bigint,
  source           varchar(16)
);

CREATE TABLE biz.action_item (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  meeting_id bigint,
  owner      varchar(64) NOT NULL,
  due        date,
  status     varchar(16) NOT NULL DEFAULT 'open'
);

CREATE TABLE biz.objective (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        varchar(128) NOT NULL,
  key_results jsonb,
  period      varchar(16)
);

CREATE TABLE biz.decision (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decided_on date NOT NULL,
  context    text,
  choices    jsonb,
  chosen     text,
  rationale  text
);

CREATE TABLE biz.project (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         varchar(128) NOT NULL,
  project_type varchar(32),
  stage        varchar(32) NOT NULL,
  progress     integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  blockers     jsonb,
  milestones   jsonb,
  cost_actual  numeric(18,2)
);

CREATE TABLE biz.customer (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              varchar(128) NOT NULL,
  decision_makers   jsonb,
  preferences       jsonb,
  payment_habit     varchar(32),
  price_floor       numeric(18,2),
  sensitivity_level varchar(16) NOT NULL DEFAULT 'normal'
);

-- 敏感字段私有存储：中枢与视图一律不 JOIN 本表，跨域只能走一次性令牌
CREATE TABLE biz.customer_sensitive (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES biz.customer(id) ON DELETE CASCADE,
  field       varchar(64) NOT NULL,
  value       text,
  level       varchar(16) NOT NULL DEFAULT 'sensitive',
  UNIQUE (customer_id, field)
);

CREATE TABLE biz.commitment (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES biz.customer(id) ON DELETE CASCADE,
  content     text NOT NULL,
  due         date,
  source      varchar(16) NOT NULL DEFAULT 'manual',
  status      varchar(16) NOT NULL DEFAULT 'open'
);

CREATE TABLE biz.quote (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES biz.customer(id) ON DELETE CASCADE,
  amount      numeric(18,2) NOT NULL,
  quoted_on   date,
  rationale   text,
  project_id  bigint
);

CREATE TABLE biz.sku (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         varchar(128) NOT NULL,
  aliases      jsonb,
  unit         varchar(16) NOT NULL,
  safety_stock numeric(18,2)
);

CREATE TABLE biz.stock_txn (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku_id          bigint NOT NULL REFERENCES biz.sku(id),
  qty             numeric(18,2) NOT NULL,
  unit_price      numeric(18,4),
  txn_type        varchar(8) NOT NULL CHECK (txn_type IN ('in','out','adjust')),
  invoice_status  varchar(16),
  project_id      bigint,
  supplier_id     bigint,
  reversal_of     bigint REFERENCES biz.stock_txn(id),
  confidence      numeric(3,2),
  conflict_frozen boolean NOT NULL DEFAULT false
);

CREATE TABLE biz.vehicle_log (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plate             varchar(16) NOT NULL,
  trip_date         date NOT NULL,
  km                numeric(10,2) NOT NULL,
  purpose           varchar(128),
  driver            varchar(64),
  subsidy           numeric(18,2),
  evidence_complete boolean NOT NULL DEFAULT false,
  conflict_frozen   boolean NOT NULL DEFAULT false
);

CREATE TABLE biz.subsidy_standard (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  region               varchar(32) NOT NULL,
  year                 integer NOT NULL,
  rule                 jsonb NOT NULL,
  official_source_type varchar(32) NOT NULL
                       CHECK (official_source_type IN ('tax','hr_finance','provincial_gov')),
  source_url           text,
  doc_no               varchar(64),
  published_at         date,
  collected_at         timestamptz,
  confirmed_by         varchar(64),
  version              integer NOT NULL DEFAULT 1,
  status               varchar(16) NOT NULL DEFAULT 'candidate'
                       CHECK (status IN ('candidate','effective','expired')),
  UNIQUE (region, year, version)
);

CREATE TABLE biz.lead (
  id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source varchar(64),
  name   varchar(128) NOT NULL,
  score  numeric(5,2),
  status varchar(16) NOT NULL DEFAULT 'new'
);

CREATE TABLE biz.dd_report (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target              varchar(128) NOT NULL,
  dimensions          jsonb,
  conclusion          text,
  data_sources        jsonb,
  coverage_disclaimer text
);

-- ============================== ref ==============================
CREATE TABLE ref.view_grant (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  view_id    varchar(64) NOT NULL,
  plugin_id  varchar(64) NOT NULL,
  granted_by varchar(64) NOT NULL DEFAULT 'system',
  granted_at timestamptz NOT NULL DEFAULT now(),
  status     varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  UNIQUE (view_id, plugin_id)
);

CREATE TABLE ref.token (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id    varchar(64) NOT NULL,
  plugin_id  varchar(64) NOT NULL,
  scope      jsonb NOT NULL,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used       boolean NOT NULL DEFAULT false
);
CREATE INDEX token_expiry_idx ON ref.token (expires_at) WHERE NOT used;

CREATE TABLE ref.employee_plugin (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plugin_id      varchar(64) NOT NULL UNIQUE,
  display_name   varchar(64) NOT NULL,
  scope          varchar(16) NOT NULL CHECK (scope IN ('single','cross')),
  required_views jsonb NOT NULL DEFAULT '[]'::jsonb,
  tools          jsonb NOT NULL DEFAULT '[]'::jsonb,
  write_targets  jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled        boolean NOT NULL DEFAULT true
);

CREATE TABLE ref.risk_rule (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id      varchar(32) NOT NULL UNIQUE,
  trigger      text NOT NULL,
  suggestion   text,
  source       varchar(128),
  confirmed_by varchar(64),
  version      varchar(16) NOT NULL DEFAULT '1'
);

CREATE TABLE ref.workflow_registry (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow_id   varchar(64) NOT NULL,
  version       varchar(16) NOT NULL,
  owner_plugin  varchar(64) NOT NULL,
  scope         varchar(16) NOT NULL CHECK (scope IN ('single','cross')),
  meta          jsonb NOT NULL,
  code_hash     varchar(64) NOT NULL,
  risk_level    varchar(8) NOT NULL CHECK (risk_level IN ('high','medium','low')),
  status        varchar(16) NOT NULL DEFAULT 'registered'
                CHECK (status IN ('registered','shadow','active','rolled_back','sleeping','rejected')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, version)
);

-- ============================== audit ==============================
-- 分区键前置：主键为 (id, created_at)，created_at 为未来分区键，不做事后改主键
CREATE TABLE audit.audit_log (
  id                   bigint GENERATED ALWAYS AS IDENTITY,
  created_at           timestamptz NOT NULL DEFAULT now(),
  workflow_instance_id bigint,
  actor                varchar(64) NOT NULL,
  action               varchar(64) NOT NULL,
  object_type          varchar(64),
  object_id            varchar(64),
  result               varchar(16) NOT NULL CHECK (result IN ('ok','denied','error')),
  payload              jsonb,
  schema_version       varchar(16) NOT NULL DEFAULT '1',
  test_mode            boolean NOT NULL DEFAULT false,
  prev_hash            varchar(64),
  hash                 varchar(64) NOT NULL,
  PRIMARY KEY (id, created_at)
);
CREATE INDEX audit_log_instance_idx ON audit.audit_log (workflow_instance_id, created_at);
CREATE INDEX audit_log_created_idx ON audit.audit_log (created_at);

CREATE TABLE audit.audit_chain_head (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  last_hash      varchar(64),
  last_export_id bigint,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.audit_export (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_path        text NOT NULL,
  sha256           varchar(64) NOT NULL,
  prev_export_hash varchar(64),
  row_count        integer NOT NULL,
  exported_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.workflow_instance (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance_uuid   uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  workflow_id     varchar(64) NOT NULL,
  version         varchar(16) NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','blocked','awaiting_decision','completed','failed','rolled_back')),
  deadline_impact boolean NOT NULL DEFAULT false,
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz
);

CREATE TABLE audit.workflow_node_run (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance_id     bigint NOT NULL REFERENCES audit.workflow_instance(id) ON DELETE CASCADE,
  node_id         varchar(64) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'done',
  payload_hash    varchar(64),
  output          jsonb,
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  UNIQUE (instance_id, node_id)
);

CREATE TABLE audit.verifier_verdict (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance_id   bigint REFERENCES audit.workflow_instance(id) ON DELETE CASCADE,
  node_id       varchar(64),
  verdict       varchar(16) NOT NULL CHECK (verdict IN ('pass','fail','escalated')),
  sampling      integer NOT NULL DEFAULT 1,
  confidence    numeric(3,2),
  evidence_hash varchar(64),
  escalated     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verdict_evidence_idx ON audit.verifier_verdict (evidence_hash);

-- ============================== stat ==============================
CREATE TABLE stat.task_schedule (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id     varchar(64) NOT NULL UNIQUE,
  cron        varchar(64) NOT NULL,
  timezone    varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
  enabled     boolean NOT NULL DEFAULT true,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz
);

CREATE TABLE stat.task_run (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id      varchar(64) NOT NULL,
  scheduled_at timestamptz NOT NULL,
  started_at   timestamptz,
  ended_at     timestamptz,
  status       varchar(16) NOT NULL CHECK (status IN ('running','ok','failed','skipped')),
  attempt      integer NOT NULL DEFAULT 1,
  error        text,
  result       jsonb,
  UNIQUE (task_id, scheduled_at)
);

CREATE TABLE stat.notification (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       varchar(32) NOT NULL,
  level      varchar(16) NOT NULL CHECK (level IN ('instant','digest','info')),
  payload    jsonb,
  status     varchar(16) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stat.daily_report (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_date date NOT NULL UNIQUE,
  content     jsonb NOT NULL,
  sent_at     timestamptz
);

-- ============================== vec ==============================
CREATE TABLE vec.embedding (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_type  varchar(32) NOT NULL,
  source_id    bigint NOT NULL,
  content_hash varchar(64) NOT NULL,
  embedding    vector(1024) NOT NULL,
  model_id     varchar(64) NOT NULL,
  dimension    integer NOT NULL DEFAULT 1024,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, model_id)
);
CREATE INDEX embedding_hnsw_idx ON vec.embedding USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
