-- v2.22 项目自动驾驶支持 SVN（公司主用版本库）：
-- 检出记录区分 VCS 与修订号，git 仍用 commit_sha，svn 用 revision；表数不变（91 张）。

ALTER TABLE ref.project_checkout
  ADD COLUMN IF NOT EXISTS vcs_kind varchar(8) NOT NULL DEFAULT 'git'
    CHECK (vcs_kind IN ('git','svn'));
ALTER TABLE ref.project_checkout
  ADD COLUMN IF NOT EXISTS revision varchar(32);

COMMENT ON COLUMN ref.project_checkout.vcs_kind IS '版本库类型：git/svn';
COMMENT ON COLUMN ref.project_checkout.revision IS 'SVN 检出修订号（git 为 NULL）';
