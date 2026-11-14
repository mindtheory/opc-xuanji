# PA-OPC-031 项目自动驾驶 SVN 版本库支持

- 变更编号：CR-2026-11-14-10
- 日期：2026-11-14
- 发起人：老板
- 变更类型：新增能力（项目监理·自动驾驶检出）
- 关联：`OPC-SRS-105` §3.27/§3.28/§3.36、`OPC-SRS-001` §12、`OPC-IRS-001` §7.6/§10.1、`OPC-DBDD-001` §3.11、`OPC-RTM-001`、`OPC-STD-001` §4.32/§5、`OPC-STP-001` §19、`OPC-STR-001` §18、`OPC-SDD-001` §5.7、`spec/opc-xuanji/*`、`migrations/0014_autopilot_svn.sql`、`src/domains/project/autopilot.ts`、`test/integration/autopilot.test.ts`

## 1. 原始需求

公司主用 SVN，项目管理「自动驾驶」原来只支持 git 浅克隆（`repository:{url,branch?,authRef?}`），需要增加 SVN 检出：按主干/分支路径与修订号检出工作副本，并保持扫描、骨架、发布与审计口径一致。

## 2. 变更内容

- `OPC-SRS-105` 新增 `REQ-PRJ-036`（SVN 版本库检出，4 条 AC），项目监理需求 35→36；同步修订 `REQ-PRJ-027` AC-1/AC-2（入参 `kind`/`revision`、检出事实）与 `REQ-PRJ-028` AC-3（扫描跳过 `.svn`/`.hg`）。
- 入参：`repository:{url, kind?:'git'|'svn', branch?, revision?, authRef?, name?}`；工具 `opc_project_bootstrap` 新增平铺参数 `repositoryKind`、`revision`；`kind` 显式优先，`svn://`、`svn+ssh://` 推断 svn，其余默认 git。
- SVN 语义：`branch`=主干/分支路径（相对 URI，如 `trunk`、`branches/release-1.0`；也接受绝对 URL）；`revision`=`HEAD`|数字|`r数字`，默认 `HEAD`。Git 仍 `branch`=分支、`commit_sha` 落库。
- 迁移 `migrations/0014_autopilot_svn.sql`：`ref.project_checkout` 新增 `vcs_kind varchar(8) NOT NULL DEFAULT 'git'` CHECK（git/svn）与 `revision varchar(32)`；表数不变（仍 91），该表列数 13→15。
- 检出实现：SVN 走本机 CLI（subversion ≥1.10），密码经 stdin，凭据仅接受 `env:` 引用，不落库不落日志；SVN 客户端缺失返回 502 `ERR-AUTO-002` 并登记裁决 `topic=svn_client`；SVN 地址允许空格与中文（公司路径 `产品设计/天元数智/OPC-玄机 · 一人公司中枢` 可直接填）。未填 `authRef` 时，若服务环境配置 `OPC_SVN_PASSWORD` 且目标主机在 `OPC_SVN_TRUSTED_HOSTS` 白名单内，自动按 `env:OPC_SVN_PASSWORD` 使用服务环境凭据（白名单外主机不送口令）。
- 扫描/档案：跳过目录新增 `.svn`/`.hg`；`software_profile` 增加 `vcs`（git/svn）与 `revision`（git 为 null）。
- 骨架/发布：SVN 骨架只落工作副本、`status=generated`、不建本地分支不提交、不产生 `scaffold_review` 裁决；测试环境发布版本号=`coalesce(commit_sha, revision)`。
- 响应：`bootstrap.repository` 增加 `kind`；`bootstrap.checkout` 增加 `vcs`、`revision`（git revision=null、svn commit=null）。
- 测试：新增 `TC-AUTO-010`（SVN 检出：修订号、扫描跳过 `.svn`、档案回填、发布版本号）与 `TC-AUTO-011`（svn 客户端缺失：502 + `svn_client` 裁决）；`autopilot.test.ts` 9→11，全量 127→129。
- 文档/规格同步：`OPC-SRS-001`、`OPC-SRS-105`、`OPC-IRS-001`、`OPC-DBDD-001`、`OPC-RTM-001`、`OPC-STD-001`、`OPC-STP-001`、`OPC-STR-001`、`OPC-SDD-001`、`spec/opc-xuanji/api.yaml`/`usecases.yaml`/`entities.yaml`、`scripts/gen-spec.mjs`、`docs/index.md`、`pa-index.md`、`CHANGELOG.md`、`README.md`。

## 3. 关键边界

- **不混口径**：`vcs_kind` 标识协议；Git 记 `commit_sha`（`revision` 为 null），SVN 记 `revision`（`commit_sha` 为 null），二者不互相填充。
- **显式降级**：svn 客户端缺失时不伪造工作副本、档案与计划；返回 502 并登记 `svn_client` 裁决，老板补装或改用 Git 后重跑。
- **凭据最小化**：密码只经 stdin 传给 svn，凭据只接受 `env:` 引用；库、日志、响应均无明文。
- **不提交远端**：SVN 骨架只写工作副本，`status=generated`；不建本地分支、不 commit、不产生 `scaffold_review` 裁决。
- **发布可追溯**：测试环境发布版本号取 `coalesce(commit_sha, revision)`；生产发布仍需人工审批。

## 4. 落地状态

- 文档/规格（本 PA 责任域，已验证）：`OPC-SRS-105`/`OPC-SRS-001`/`OPC-IRS-001`/`OPC-DBDD-001`/`OPC-RTM-001`/`OPC-STD-001`/`OPC-STP-001`/`OPC-STR-001`/`OPC-SDD-001`、`spec/opc-xuanji/*`、`docs/index.md`、`pa-index.md`、`CHANGELOG.md`、`README.md` 已按 §2 同步；`entities.yaml` 与生成器一致，`spec:check`/`docs:check` 全绿。
- 迁移：`0014_autopilot_svn.sql` 由后端并行提交，业务库/测试库应用与列数（13→15）以集成阶段实测为准。
- 代码/测试：`src/domains/project/autopilot.ts` 双协议检出、`ref.project_checkout` 新列写入、`software_profile` 回填与响应字段由后端并行落地；`autopilot.test.ts` 的 TC-AUTO-010/011 执行结果以 `OPC-STR-001` §18 与 `npm test` 输出为准。

## 5. 验证

文档与规格侧（本次实际执行）：

```bash
node scripts/gen-spec.mjs && node scripts/gen-spec.mjs --check   # entities.yaml 与生成器一致（91 实体）
npm run spec:check     # PASS（91 实体 / 31 用例 / 21 模块）
npm run docs:check     # PASS（28 份文档）
```

集成侧（由后端/集成者在真实 PostgreSQL 上执行）：

```bash
npm run migrate && npm run migrate:test   # 0014 各 applied 1
npm test                                  # 129/129 pass（含 TC-AUTO-010/011）
```

TC 断言要点：SVN 夹具 `branch=trunk`、`revision=r1` → `checkout.vcs=svn`、`vcs_kind='svn'`、`software_profile.vcs=svn`、扫描跳过 `.svn`、发布版本号取 revision；隔离 PATH 无 `svn` → 502 `ERR-AUTO-002` + `svn_client` 裁决且无档案写入。

## 6. 回滚

- 代码：恢复 `src/domains/project/autopilot.ts` 到仅 Git 实现并重启；文档随代码回退到 v2.21 口径。
- 数据：`0014` 只给 `ref.project_checkout` 加两列（默认 `vcs_kind='git'`），回滚代码无需删列；`revision` 可空，历史 Git 检出不受影响。
- 配置：无需新增环境变量；已登记的 SVN 版本库可改回 Git 后重新检出。
