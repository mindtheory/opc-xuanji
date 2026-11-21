-- v2.27 虚拟销售（自动雷达 + 半自动交付 + RPA 值守）：AI 自动发现闲鱼虚拟服务需求（文案/小说/策划/课程资料/软件部署），
-- 自动生成上架素材与交付物，老板确认卡点后上架/发货；收款走平台担保交易，系统只记账。
-- 依据：老板 2026-11-21 指令「自动检索→自动接单→自动交付→自动收款，每天循环」。
-- 原则：新增表全部落 sales schema 前缀表名（沿用 92 表基线之外新增 5 表：92→97）；写操作全部写审计；风控参数入库可调。

CREATE SCHEMA IF NOT EXISTS sales;

-- 单行配置：开关、关键词、品类、风控阈值（急停 enabled=false 时所有任务空转）
CREATE TABLE IF NOT EXISTS sales.config (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  categories jsonb NOT NULL DEFAULT '["copywriting","fiction","planning","courseware","software"]'::jsonb,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_floor numeric(10,2) NOT NULL DEFAULT 5,
  price_cap numeric(10,2) NOT NULL DEFAULT 2000,
  daily_action_cap integer NOT NULL DEFAULT 40,
  actions_today integer NOT NULL DEFAULT 0,
  action_day date NOT NULL DEFAULT current_date,
  pause_reason varchar(200),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 雷达发现的需求线索：每天循环的产物，老板确认后转商品
CREATE TABLE IF NOT EXISTS sales.lead (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category varchar(32) NOT NULL,
  title varchar(200) NOT NULL,
  demand_note text,
  source varchar(32) NOT NULL DEFAULT 'keyword',
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_score numeric(4,3),
  status varchar(16) NOT NULL DEFAULT 'new',
  product_id bigint,
  decided_by varchar(64),
  decided_at timestamptz,
  run_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_lead_status_idx ON sales.lead (status, created_at DESC);

-- 商品（虚拟服务上架单）：素材由 AI 生成，老板确认后才允许 RPA 上架
CREATE TABLE IF NOT EXISTS sales.product (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id bigint,
  category varchar(32) NOT NULL,
  title varchar(200) NOT NULL,
  price numeric(10,2) NOT NULL,
  materials jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_spec text,
  status varchar(24) NOT NULL DEFAULT 'draft',
  platform_item_id varchar(64),
  listed_at timestamptz,
  paused_reason varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_product_status_idx ON sales.product (status, id DESC);

-- 订单：RPA 拉取平台订单 → 自动生产交付物 → 老板确认发货 → 平台收款后记账
CREATE TABLE IF NOT EXISTS sales.order (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint,
  platform_order_id varchar(64),
  buyer_nick varchar(128),
  title varchar(200),
  demand_text text,
  amount numeric(10,2),
  status varchar(24) NOT NULL DEFAULT 'new',
  deliverable_path varchar(400),
  deliverable_note text,
  error text,
  shipped_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_order_status_idx ON sales.order (status, id DESC);

-- 每次自动任务运行留痕（radar/list/listen/deliver），供页签展示与排障
CREATE TABLE IF NOT EXISTS sales.run (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind varchar(16) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'running',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS sales_run_kind_idx ON sales.run (kind, id DESC);
