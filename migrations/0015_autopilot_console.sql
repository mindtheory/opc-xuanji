-- v2.23 自动驾驶控制台：项目描述回填、项目归档、自动驾驶执行记录（当前执行/历史）。
-- 依据：SRS-105 REQ-PRJ-037..039、PA-OPC-032。
-- 原则：描述只从只读检出内容抽取（README/构建清单），不执行仓库代码；
--       归档只改项目标记，不删任何检出/计划/执行记录；执行记录只追加，不覆盖历史。

-- ============================== 项目描述与归档 ==============================
ALTER TABLE biz.project ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE biz.project ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE biz.project ADD COLUMN IF NOT EXISTS archive_reason varchar(200);

COMMENT ON COLUMN biz.project.description IS '项目描述：优先由自动驾驶从版本库 README/构建清单抽取，人工编辑后不覆盖';
COMMENT ON COLUMN biz.project.archived_at IS '归档时间：非空表示已归档，自动驾驶默认列表隐藏';
COMMENT ON COLUMN biz.project.archive_reason IS '归档原因（可空，最长 200 字）';

-- ============================== 自动驾驶执行记录 ==============================
CREATE TABLE stat.project_autopilot_run (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   bigint NOT NULL,
  checkout_id  bigint,
  trigger      varchar(16) NOT NULL DEFAULT 'manual'
               CHECK (trigger IN ('manual','idea','api')),
  status       varchar(16) NOT NULL DEFAULT 'running'
               CHECK (status IN ('running','ok','failed')),
  stage        varchar(32) NOT NULL DEFAULT 'register',
  stage_label  varchar(64) NOT NULL DEFAULT '登记版本库',
  steps        jsonb NOT NULL DEFAULT '[]'::jsonb,
  result       jsonb,
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_autopilot_run_project_idx ON stat.project_autopilot_run (project_id, id DESC);
CREATE INDEX project_autopilot_run_running_idx ON stat.project_autopilot_run (project_id) WHERE status = 'running';

COMMENT ON TABLE stat.project_autopilot_run IS '项目自动驾驶执行记录：每次 bootstrap 一行，steps 记录各阶段进度（当前执行 = status=running 的行）';
COMMENT ON COLUMN stat.project_autopilot_run.steps IS '阶段进度数组：[{stage,label,status,startedAt,endedAt,durationMs,detail}]';
COMMENT ON COLUMN stat.project_autopilot_run.result IS '执行结果摘要（bootstrap 返回值，失败为 null）';
