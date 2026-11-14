-- v2.15 基础资源配置：公司公共基础资源目录（版本库/制品库/测试服务器/NAS/公网服务器/域名）、
-- 公司默认口径（系统/远程管理方式/默认账号/凭据引用）、项目与基础资源的绑定。
-- 依据：SRS-105 REQ-PRJ-023..026、PA-OPC-024。
-- 原则：凭据只存引用（env:/secret:/vault:/ssh-agent:），口令不入库不入仓；
--       资源是公司级共享资产，项目只绑定不复制；新建项目时默认绑定 is_default 资源。

-- ============================== 公司基础资源目录 ==============================
CREATE TABLE ref.shared_resource (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind            varchar(24) NOT NULL
                  CHECK (kind IN ('code_repo','artifact_repo','test_server','nas','public_server','domain')),
  code            varchar(64) UNIQUE,
  name            varchar(128) NOT NULL,
  endpoint        text,
  access_method   varchar(24) NOT NULL DEFAULT 'ssh'
                  CHECK (access_method IN ('ssh','rdp','sunlogin','https','console','smb','nfs','api')),
  default_account varchar(64),
  credential_ref  varchar(128)
                  CHECK (credential_ref IS NULL OR credential_ref ~ '^(env|secret|vault|ssh-agent):[A-Za-z0-9_./-]+$'),
  os              varchar(64),
  location        varchar(128),
  capacity        varchar(128),
  specs           jsonb,
  tags            jsonb,
  is_default      boolean NOT NULL DEFAULT false,
  status          varchar(16) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','disabled')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, name)
);
CREATE INDEX shared_resource_kind_idx ON ref.shared_resource (kind, status);
CREATE INDEX shared_resource_default_idx ON ref.shared_resource (is_default, status);

-- ============================== 公司默认口径 ==============================
-- 键值对形式（value 为 jsonb），承载「公司默认系统 / 远程管理方式 / 默认账号 / 凭据引用」。
CREATE TABLE ref.shared_setting (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key        varchar(64) NOT NULL UNIQUE,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================== 项目 ↔ 基础资源绑定 ==============================
-- 项目只绑定共享资源，不复制地址与凭据；applied_by_default 标明是否由「新建项目默认选型」带来。
CREATE TABLE ref.project_shared_resource (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id         bigint NOT NULL,
  resource_id        bigint NOT NULL REFERENCES ref.shared_resource(id) ON DELETE RESTRICT,
  role               varchar(16) NOT NULL DEFAULT 'primary'
                     CHECK (role IN ('primary','backup','readonly')),
  applied_by_default boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, resource_id)
);
CREATE INDEX project_shared_resource_project_idx ON ref.project_shared_resource (project_id);

-- ============================== 公司默认口径种子 ==============================
INSERT INTO ref.shared_setting (key, value) VALUES
  ('company.default_os',             '"debian"'::jsonb),
  ('company.default_remote_method',  '"ssh"'::jsonb),
  ('company.default_account',        '"canetwork"'::jsonb),
  ('company.default_credential_ref', '"env:OPC_DEFAULT_SSH_PASSWORD"'::jsonb),
  ('company.default_ssh_port',       '22'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================== 已确认的基础资源（默认选型） ==============================
-- 只预置已确认的地址；制品库/NAS/公网服务器 支持登记，但不预置虚构地址。
INSERT INTO ref.shared_resource
  (kind, code, name, endpoint, access_method, default_account, credential_ref, os, location, specs, tags, is_default, status, notes)
VALUES
  ('code_repo', 'git-primary', 'GitHub 主仓库', 'https://github.com/mindtheory/opc-xuanji.git',
   'https', NULL, 'ssh-agent:git', NULL, 'GitHub',
   '{"default_branch":"main"}'::jsonb, '["git","github"]'::jsonb, true, 'active',
   '公司主代码仓库（OPC-玄机本体）'),
  ('test_server', 'test-debian52', '测试服务器 debian52', '192.168.1.52',
   'ssh', 'canetwork', 'env:OPC_DEFAULT_SSH_PASSWORD', 'debian', '内网机房',
   '{"cpu":"x86_64","role":"test"}'::jsonb, '["test","debian","ssh"]'::jsonb, true, 'active',
   '公司默认测试机：Debian + SSH，账号 canetwork（口令由环境注入，不落库）'),
  ('domain', 'domain-main', '主域名', 'canetwork.myqnapcloud.com',
   'https', NULL, NULL, NULL, '公网',
   '{"dns":"qnapcloud"}'::jsonb, '["domain","public"]'::jsonb, true, 'active',
   '公司主域名（DSH Web 对外入口之一）')
ON CONFLICT (kind, name) DO NOTHING;
