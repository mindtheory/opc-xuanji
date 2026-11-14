-- v2.12 软件研发项目管理：项目起点/时间管理、Git-SVN 版本库、Maven-Docker 制品库、
-- SSH 部署环境与发布单、测试计划/用例/执行/结果/缺陷。
-- 依据：SRS-105 REQ-PRJ-016..022、PA-OPC-022。
-- 原则：凭据只存 auth_ref 引用；版本库只同步元数据；生产发布走发布单与人工审批。

-- ============================== 项目起点与时间管理 ==============================
ALTER TABLE biz.project ADD COLUMN start_date date;
ALTER TABLE biz.project ADD COLUMN target_end_date date;
ALTER TABLE biz.project ADD COLUMN actual_start_date date;
ALTER TABLE biz.project ADD COLUMN actual_end_date date;
ALTER TABLE biz.project ADD COLUMN timezone varchar(64);
ALTER TABLE biz.project ADD COLUMN work_calendar jsonb;
ALTER TABLE biz.project ADD COLUMN tech_stack jsonb;
ALTER TABLE biz.project ADD COLUMN software_profile jsonb;

CREATE TABLE biz.project_milestone (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   bigint NOT NULL,
  name         varchar(128) NOT NULL,
  stage        varchar(32),
  target_date  date NOT NULL,
  actual_date  date,
  status       varchar(16) NOT NULL DEFAULT 'planned'
               CHECK (status IN ('planned','in_progress','achieved','delayed','cancelled')),
  owner        varchar(64),
  dependencies jsonb,
  evidence     text
);
CREATE INDEX project_milestone_project_idx ON biz.project_milestone (project_id, target_date);

CREATE TABLE biz.work_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL,
  task_id    bigint,
  worker     varchar(64) NOT NULL,
  work_date  date NOT NULL,
  hours      numeric(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  source     varchar(16) NOT NULL DEFAULT 'manual'
             CHECK (source IN ('manual','import','agent')),
  note       text
);
CREATE INDEX work_log_project_idx ON biz.work_log (project_id, work_date);

-- ============================== 版本库与制品库 ==============================
CREATE TABLE ref.code_repository (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id     bigint NOT NULL,
  name           varchar(128) NOT NULL,
  kind           varchar(8) NOT NULL CHECK (kind IN ('git','svn')),
  url            text NOT NULL,
  default_ref    varchar(128),
  auth_ref       varchar(128),
  sync_mode      varchar(16) NOT NULL DEFAULT 'manual'
                 CHECK (sync_mode IN ('manual','schedule','webhook')),
  sync_status    varchar(16) NOT NULL DEFAULT 'pending'
                 CHECK (sync_status IN ('pending','synced','failed','disabled')),
  last_synced_at timestamptz,
  UNIQUE (project_id, name)
);
CREATE INDEX code_repository_project_idx ON ref.code_repository (project_id, sync_status);

CREATE TABLE ref.artifact_repository (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id       bigint NOT NULL,
  name             varchar(128) NOT NULL,
  kind             varchar(16) NOT NULL CHECK (kind IN ('maven','docker','npm','other')),
  url              text NOT NULL,
  namespace        varchar(128),
  auth_ref         varchar(128),
  retention_policy jsonb,
  status           varchar(16) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','disabled')),
  UNIQUE (project_id, name)
);

-- ============================== SSH 部署环境与发布单 ==============================
CREATE TABLE ref.deploy_environment (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      bigint NOT NULL,
  env_type        varchar(16) NOT NULL CHECK (env_type IN ('dev','test','staging','prod')),
  name            varchar(128) NOT NULL,
  host            varchar(255) NOT NULL,
  port            integer NOT NULL DEFAULT 22 CHECK (port BETWEEN 1 AND 65535),
  ssh_user        varchar(64) NOT NULL,
  auth_ref        varchar(128),
  jump_host_ref   varchar(128),
  isolation_level varchar(16) NOT NULL DEFAULT 'shared'
                  CHECK (isolation_level IN ('shared','dedicated')),
  approval_policy varchar(16) NOT NULL DEFAULT 'manual'
                  CHECK (approval_policy IN ('auto','manual')),
  status          varchar(16) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','disabled')),
  UNIQUE (project_id, name)
);

CREATE TABLE biz.release_order (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id       bigint NOT NULL,
  environment_id   bigint NOT NULL,
  version          varchar(64) NOT NULL,
  artifact_refs    jsonb,
  repo_refs        jsonb,
  change_note      text,
  rollback_version varchar(64),
  requested_by     varchar(64) NOT NULL,
  approved_by      varchar(64),
  status           varchar(16) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','executing','succeeded','failed','rolled_back')),
  executed_at      timestamptz,
  health_check     jsonb
);
CREATE INDEX release_order_project_idx ON biz.release_order (project_id, status);
CREATE INDEX release_order_env_idx ON biz.release_order (environment_id, status);

-- ============================== 测试管理 ==============================
CREATE TABLE biz.test_plan (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id     bigint NOT NULL,
  version        varchar(64) NOT NULL,
  scope          text,
  test_types     jsonb,
  entry_criteria text,
  exit_criteria  text,
  environment_id bigint,
  owner          varchar(64),
  start_date     date,
  end_date       date,
  status         varchar(16) NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','active','closed','cancelled')),
  UNIQUE (project_id, version)
);

CREATE TABLE biz.test_case (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      bigint NOT NULL,
  plan_id         bigint,
  case_code       varchar(64) NOT NULL,
  title           varchar(256) NOT NULL,
  preconditions   text,
  steps           jsonb,
  expected        text,
  priority        varchar(8) NOT NULL DEFAULT 'P2'
                  CHECK (priority IN ('P0','P1','P2','P3')),
  kind            varchar(8) NOT NULL DEFAULT 'manual'
                  CHECK (kind IN ('manual','auto')),
  requirement_ref varchar(64),
  version         varchar(16) NOT NULL DEFAULT '1',
  status          varchar(16) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','approved','deprecated')),
  UNIQUE (project_id, case_code)
);

CREATE TABLE biz.test_suite (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id     bigint NOT NULL,
  name           varchar(128) NOT NULL,
  case_ids       jsonb,
  environment_id bigint,
  status         varchar(16) NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','disabled')),
  UNIQUE (project_id, name)
);

CREATE TABLE biz.test_run (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id     bigint NOT NULL,
  plan_id        bigint,
  suite_id       bigint,
  environment_id bigint,
  version        varchar(64) NOT NULL,
  executor       varchar(64) NOT NULL,
  executor_type  varchar(16) NOT NULL DEFAULT 'human'
                 CHECK (executor_type IN ('human','agent','ci')),
  started_at     timestamptz,
  ended_at       timestamptz,
  status         varchar(16) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','running','passed','failed','blocked','cancelled'))
);
CREATE INDEX test_run_project_idx ON biz.test_run (project_id, status);

CREATE TABLE biz.test_result (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id         bigint NOT NULL,
  case_id        bigint NOT NULL,
  result         varchar(16) NOT NULL
                 CHECK (result IN ('passed','failed','blocked','skipped')),
  evidence       text,
  failure_reason text,
  executed_at    timestamptz,
  UNIQUE (run_id, case_id)
);

CREATE TABLE biz.defect (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id        bigint NOT NULL,
  severity          varchar(8) NOT NULL
                    CHECK (severity IN ('S1','S2','S3','S4')),
  title             varchar(256) NOT NULL,
  repro_steps       text,
  affected_version  varchar(64),
  test_case_id      bigint,
  requirement_ref   varchar(64),
  owner             varchar(64),
  status            varchar(16) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','resolved','closed','reopened')),
  regression_result varchar(16)
);
CREATE INDEX defect_project_idx ON biz.defect (project_id, status, severity);
