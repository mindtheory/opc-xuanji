-- v2.16 项目自动驾驶：新建项目时填写版本库 → 自动检出 → 静态扫描 → 回填项目档案 →
-- 生成开发/测试/部署计划 → 仅需老板裁决的事项进入裁决队列等待结果。
-- 依据：SRS-105 REQ-PRJ-027..030、PA-OPC-025。
-- 原则：只做静态扫描，不执行仓库代码；凭据只存引用；生产部署仍需人工审批。

-- ============================== 版本库检出记录 ==============================
CREATE TABLE ref.project_checkout (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id     bigint NOT NULL,
  repository_id  bigint,
  url            text NOT NULL,
  branch         varchar(128),
  commit_sha     varchar(64),
  workspace_path text,
  file_count     integer,
  size_bytes     bigint,
  status         varchar(16) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','ok','failed')),
  error          text,
  checked_out_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_checkout_project_idx ON ref.project_checkout (project_id, status);

-- ============================== 静态扫描结果 ==============================
CREATE TABLE stat.project_scan (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      bigint NOT NULL,
  checkout_id     bigint,
  scanner_version varchar(16) NOT NULL DEFAULT 'autopilot-1',
  languages       jsonb,
  manifests       jsonb,
  structure       jsonb,
  tests           jsonb,
  ci              jsonb,
  findings        jsonb,
  status          varchar(16) NOT NULL DEFAULT 'ok'
                  CHECK (status IN ('ok','degraded','failed')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_scan_project_idx ON stat.project_scan (project_id, created_at DESC);

-- ============================== 自动生成的计划 ==============================
CREATE TABLE stat.project_plan (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   bigint NOT NULL,
  plan_kind    varchar(8) NOT NULL CHECK (plan_kind IN ('dev','test','deploy')),
  version      integer NOT NULL DEFAULT 1,
  title        varchar(128) NOT NULL,
  content      jsonb NOT NULL,
  status       varchar(16) NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','active','archived')),
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, plan_kind, version)
);

-- ============================== 裁决队列（仅需老板裁决的事项） ==============================
CREATE TABLE stat.project_decision (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL,
  topic       varchar(32) NOT NULL,
  question    text NOT NULL,
  options     jsonb,
  risk_level  varchar(8) NOT NULL DEFAULT 'low'
              CHECK (risk_level IN ('low','medium','high')),
  status      varchar(16) NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','decided','dismissed')),
  decision    text,
  decided_by  varchar(64),
  decided_at  timestamptz,
  payload     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_decision_status_idx ON stat.project_decision (project_id, status);
