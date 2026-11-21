-- v2.26 公司基础信息（跨模块共用）：把公司档案补齐为可维护的主体信息，
-- 供设置页编辑，并被项目（交付物抬头）、财税（开票/税号/银行）、法务（合同主体）、行政（档案/联系方式）共用。
-- 依据：OPC-SRS-103 §3.13 REQ-ADM-013、PA-OPC-035。
-- 原则：不新增表；只扩展 biz.company_profile 列（表数仍 92），单行档案，写操作写审计。

ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS short_name varchar(64);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS english_name varchar(128);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS credit_code varchar(32);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS legal_person varchar(64);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS established_date date;
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS registered_capital varchar(64);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS company_type varchar(64);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS industry varchar(64);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS business_scope text;
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS employee_count integer;
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS website varchar(200);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS reg_address text;
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS office_address text;
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS postcode varchar(16);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS phone varchar(64);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS email varchar(128);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS contact_name varchar(64);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS contact_title varchar(64);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS tax_number varchar(64);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS invoice_title varchar(128);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS taxpayer_type varchar(32);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS bank_name varchar(128);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS bank_account varchar(64);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS invoice_note varchar(200);
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS extra jsonb;
ALTER TABLE biz.company_profile ADD COLUMN IF NOT EXISTS updated_by varchar(64);

COMMENT ON TABLE biz.company_profile IS '公司基础信息（单行档案）：设置页维护，项目/财税/法务/行政共用；敏感值（银行账号）不写审计正文';
COMMENT ON COLUMN biz.company_profile.credit_code IS '统一社会信用代码（18 位，可选但校验格式）';
COMMENT ON COLUMN biz.company_profile.taxpayer_type IS '纳税人类型：general 一般纳税人 / small 小规模纳税人 / other 其他';
COMMENT ON COLUMN biz.company_profile.updated_by IS '最后修改人（默认 boss）';
