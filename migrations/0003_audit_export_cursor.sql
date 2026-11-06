-- 审计增量导出的游标：记录本次导出覆盖到的最后一条 audit_log.id，
-- 下次导出默认从该 id 之后续导（避免重复导出与重复计费）。
ALTER TABLE audit.audit_export ADD COLUMN last_audit_id bigint;
