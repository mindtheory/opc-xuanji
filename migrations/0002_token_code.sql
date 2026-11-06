-- 一次性令牌使用不可猜测的 token_code 对外暴露，内部主键仍为 bigint identity。
-- 安全考虑：令牌 ID 若直接用自增主键，可被枚举；对外只认 token_code（16 字节随机 hex）。
ALTER TABLE ref.token ADD COLUMN token_code varchar(64);
CREATE UNIQUE INDEX token_code_uidx ON ref.token (token_code) WHERE token_code IS NOT NULL;
