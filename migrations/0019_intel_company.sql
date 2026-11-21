-- v2.29 公司情报中心（老板 2026-11-21 指令：情报与项目无关，是公司对外开放系统；建情况采集项目，
-- 从互联网与官方数据源（市监总局/统计局/工信部政策等）采集数据，汇总入公司记忆）。
-- 原则：情报条目去项目化（project_id 可空，NULL=公司级）；公司监视范围复用 biz.intel_project_scope（project_id=0 哨兵行）；
-- 记忆新增 market_intel 口径；预置官方数据源（默认停用，老板启用）。

-- 1) 情报条目去项目化：project_id 可空（NULL=公司级情报）
ALTER TABLE biz.intel_item ALTER COLUMN project_id DROP NOT NULL;
-- 公司级条目（project_id IS NULL）按 idempotency_key 全局去重（NULL 不参与组合唯一键）
CREATE UNIQUE INDEX IF NOT EXISTS intel_item_company_idem_key ON biz.intel_item (idempotency_key) WHERE project_id IS NULL;

-- 2) 公司监视范围哨兵行：project_id=0（biz.project 无 0 号项目，天然不冲突）
INSERT INTO biz.intel_project_scope (project_id, name, timezone, brief_time, lookback_hours, max_items, push_channels, status, config_version)
VALUES (0, '公司情报中心', 'Asia/Shanghai', '08:30', 24, 50, '[{"channel":"inapp","target":"boss"}]'::jsonb, 'active', 'v1')
ON CONFLICT (project_id) DO NOTHING;

-- 3) 公司记忆新增 market_intel 口径（市场情报摘要）
ALTER TABLE stat.web_memory_card DROP CONSTRAINT IF EXISTS web_memory_card_scope_check;
ALTER TABLE stat.web_memory_card ADD CONSTRAINT web_memory_card_scope_check
  CHECK (scope IN ('company_profile', 'experience', 'skill', 'customer', 'session_digest', 'market_intel'));
ALTER TABLE stat.web_memory_proposal DROP CONSTRAINT IF EXISTS web_memory_proposal_memory_type_check;
ALTER TABLE stat.web_memory_proposal ADD CONSTRAINT web_memory_proposal_memory_type_check
  CHECK (memory_type IN ('company_profile', 'experience', 'skill', 'customer', 'session_digest', 'market_intel'));

-- 4) 采集设置（并发/入记忆阈值等，键 intel.collect.settings）
INSERT INTO ref.shared_setting (key, value)
VALUES ('intel.collect.settings', '{"enabled":true,"maxItemsPerSource":20,"memoryDailyCap":10,"memoryMinScore":60}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 5) 预置官方数据源（幂等；默认 enabled=false，老板在页面启用；采集器按 kind 解析）
INSERT INTO biz.source (name, source_type, url, credibility, copyright_status, collect_interval_minutes, rate_limit_per_hour, timeout_ms, enabled, status, checkpoint)
SELECT v.name, 'web', v.url, 0.95, 'public', 360, 12, 20000, false, 'active', jsonb_build_object('kind', v.kind)
FROM (VALUES
  ('中国政府网·最新政策', 'https://www.gov.cn/zhengce/zuixin/', 'gov_policy'),
  ('国家统计局·最新发布', 'https://www.stats.gov.cn/sj/zxfb/', 'stats_news'),
  ('市场监管总局·新闻发布', 'https://www.samr.gov.cn/xw/', 'samr_news')
) AS v(name, url, kind)
WHERE NOT EXISTS (SELECT 1 FROM biz.source s WHERE s.url = v.url);
