-- v2.17 自动驾驶·自动化生产：代码骨架生成、测试流水线执行、测试环境发布。
-- 依据：SRS-105 REQ-PRJ-031..033、PA-OPC-026。
-- 原则：只在检出工作区行事（不推送远端）；不安装依赖除非显式开启；
--       执行有超时与最小环境；发布测试环境失败/无执行配置 → 转裁决，不伪造成功。

CREATE TABLE stat.project_scaffold (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL,
  checkout_id bigint,
  branch      varchar(128),
  files       jsonb,
  status      varchar(16) NOT NULL DEFAULT 'generated'
              CHECK (status IN ('generated','committed','skipped','failed')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_scaffold_project_idx ON stat.project_scaffold (project_id, created_at DESC);

CREATE TABLE stat.project_pipeline_run (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL,
  checkout_id bigint,
  stage       varchar(16) NOT NULL
              CHECK (stage IN ('install','build','test','lint','other')),
  command     text NOT NULL,
  exit_code   integer,
  status      varchar(16) NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','running','ok','failed','skipped')),
  log_tail    text,
  duration_ms integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_pipeline_project_idx ON stat.project_pipeline_run (project_id, created_at DESC);

CREATE TABLE stat.project_deploy_run (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id     bigint NOT NULL,
  release_id     bigint,
  environment_id bigint,
  command        text,
  health_url     text,
  exit_code      integer,
  status         varchar(16) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','ok','failed','skipped')),
  log_tail       text,
  started_at     timestamptz,
  ended_at       timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_deploy_project_idx ON stat.project_deploy_run (project_id, created_at DESC);
