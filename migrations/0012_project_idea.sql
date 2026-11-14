-- v2.20 创意转项目：用户输入创意，AI 解析/完善为项目档案，自动建项目并进入自动驾驶。
-- 依据：SRS-105 REQ-PRJ-035、PA-OPC-029。
-- 原则：AI 只做解析与完善，不臆造事实；无 AI 时走规则兜底；无版本库时转裁决等待老板补仓库。

CREATE TABLE stat.project_idea (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL,
  idea        text NOT NULL,
  analysis    jsonb,
  source      varchar(8) NOT NULL DEFAULT 'rule' CHECK (source IN ('ai','rule')),
  model       varchar(64),
  status      varchar(24) NOT NULL DEFAULT 'created'
              CHECK (status IN ('created','autopilot','waiting-repository','failed')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_idea_project_idx ON stat.project_idea (project_id, created_at DESC);
