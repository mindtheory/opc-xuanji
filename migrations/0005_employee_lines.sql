-- v2.11 员工线扩展：WBS、外宣、员工插件 manifest 与员工包导入导出。
-- 依据：产品设计 §4.10/§4.11/§2.5、SRS §9、技术架构 §8.11。
-- 原则：员工插件可独立安装/停用；员工包默认不含业务数据；所有状态变更可审计。

-- 员工插件 manifest 与生命周期字段（保留既有列，向后兼容）
ALTER TABLE ref.employee_plugin ADD COLUMN version varchar(16) NOT NULL DEFAULT '0.1.0';
ALTER TABLE ref.employee_plugin ADD COLUMN manifest jsonb;
ALTER TABLE ref.employee_plugin ADD COLUMN installed_at timestamptz;
ALTER TABLE ref.employee_plugin ADD COLUMN disabled_reason text;
ALTER TABLE ref.employee_plugin ADD COLUMN package_code varchar(64);

-- ============================== WBS ==============================
CREATE TABLE biz.wbs_node (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id          bigint NOT NULL,
  parent_id           bigint REFERENCES biz.wbs_node(id),
  node_code           varchar(32) NOT NULL,
  name                varchar(128) NOT NULL,
  deliverable         text,
  owner               varchar(64),
  estimate_hours      numeric(10,2),
  start_date          date,
  end_date            date,
  status              varchar(16) NOT NULL DEFAULT 'planned'
                      CHECK (status IN ('planned','in_progress','blocked','done','cancelled')),
  progress            integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  dependencies        jsonb,
  acceptance_criteria text,
  baseline_version    varchar(16),
  conflict_frozen     boolean NOT NULL DEFAULT false,
  UNIQUE (project_id, node_code)
);
CREATE INDEX wbs_node_project_idx ON biz.wbs_node (project_id, status);
CREATE INDEX wbs_node_parent_idx ON biz.wbs_node (parent_id);

CREATE TABLE biz.wbs_baseline (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL,
  version     varchar(16) NOT NULL,
  snapshot    jsonb NOT NULL,
  approved_by varchar(64),
  approved_at timestamptz,
  status      varchar(16) NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','approved','superseded')),
  UNIQUE (project_id, version)
);

CREATE TABLE biz.wbs_change (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wbs_id       bigint NOT NULL REFERENCES biz.wbs_node(id) ON DELETE CASCADE,
  change_type  varchar(16) NOT NULL CHECK (change_type IN ('scope','schedule','cost')),
  reason       text,
  impact       text,
  requested_by varchar(64),
  approved_by  varchar(64),
  status       varchar(16) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected')),
  decided_at   timestamptz
);

-- ============================== 外宣 ==============================
CREATE TABLE biz.publication_plan (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period      varchar(16) NOT NULL,
  theme       varchar(128) NOT NULL,
  channel_mix jsonb,
  owner       varchar(64),
  status      varchar(16) NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','active','closed'))
);

CREATE TABLE biz.channel_account (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel      varchar(32) NOT NULL,
  account_name varchar(128) NOT NULL,
  owner        varchar(64),
  status       varchar(16) NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','disabled')),
  last_sync_at timestamptz,
  UNIQUE (channel, account_name)
);

CREATE TABLE biz.publication (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id      bigint REFERENCES biz.publication_plan(id),
  channel      varchar(32) NOT NULL,
  title        varchar(256) NOT NULL,
  content      text NOT NULL,
  audience     varchar(128),
  status       varchar(16) NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','pending','approved','scheduled','published','rejected','withdrawn')),
  risk_level   varchar(8) NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('high','medium','low')),
  scheduled_at timestamptz,
  published_at timestamptz,
  external_url text,
  source_refs  jsonb
);
CREATE INDEX publication_status_idx ON biz.publication (status, scheduled_at);

CREATE TABLE biz.publication_approval (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  publication_id bigint NOT NULL REFERENCES biz.publication(id) ON DELETE CASCADE,
  reviewer       varchar(64) NOT NULL,
  decision       varchar(16) NOT NULL CHECK (decision IN ('approve','reject','revise')),
  comment        text,
  decided_at     timestamptz NOT NULL DEFAULT now()
);

-- ============================== 员工包 ==============================
CREATE TABLE ref.employee_package (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_code varchar(64) NOT NULL UNIQUE,
  plugin_id    varchar(64) NOT NULL,
  version      varchar(16) NOT NULL,
  manifest     jsonb NOT NULL,
  checksum     varchar(64) NOT NULL,
  signature    varchar(128),
  size_bytes   integer NOT NULL CHECK (size_bytes >= 0),
  status       varchar(16) NOT NULL DEFAULT 'validated'
               CHECK (status IN ('exported','validated','imported','rejected')),
  created_by   varchar(64),
  source       varchar(32),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_package_plugin_idx ON ref.employee_package (plugin_id, version);

CREATE TABLE ref.employee_import_job (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_code varchar(64) NOT NULL,
  dry_run      boolean NOT NULL DEFAULT true,
  status       varchar(16) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','validated','installed','rejected')),
  report       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   varchar(64)
);
CREATE INDEX employee_import_job_status_idx ON ref.employee_import_job (status, created_at);
