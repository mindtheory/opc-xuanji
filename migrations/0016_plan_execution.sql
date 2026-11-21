-- v2.25 自动驾驶·计划执行器：允许执行记录以 trigger='plan' 记录「按计划自动推进」的运行。
-- 依据：SRS-105 REQ-PRJ-040、PA-OPC-034。
-- 原则：不新增表；计划推进的逐任务进度复用 stat.project_autopilot_run.steps/result 留痕，
--       交付物写入检出目录 docs/autopilot/（存在即视为该任务完成，可断点续跑）。

ALTER TABLE stat.project_autopilot_run DROP CONSTRAINT IF EXISTS project_autopilot_run_trigger_check;
ALTER TABLE stat.project_autopilot_run
  ADD CONSTRAINT project_autopilot_run_trigger_check
  CHECK (trigger IN ('manual', 'idea', 'api', 'plan'));

COMMENT ON COLUMN stat.project_autopilot_run.trigger IS '触发来源：manual 手动、idea 创意建项目、api 工具调用、plan 计划自动推进';
