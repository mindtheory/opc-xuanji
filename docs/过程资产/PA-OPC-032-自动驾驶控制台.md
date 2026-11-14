# PA-OPC-032 自动驾驶控制台（状态/执行记录/路线图/描述抽取/归档）

- 变更编号：CR-2026-11-14-11
- 日期：2026-11-14
- 发起人：老板
- 变更类型：新增能力（项目监理·自动驾驶控制台）
- 关联：`OPC-SRS-105` §3.29/§3.37–§3.39、`OPC-SRS-001` §12、`OPC-IRS-001` §7.6/§9.1.2/§10.1、`OPC-DBDD-001` §2.3/§3.1.11/§3.16、`OPC-RTM-001` §1.3/§3/§6、`OPC-STD-001` §4.33/§5、`OPC-STP-001` §20、`OPC-STR-001` §19、`OPC-SDD-001` §5.7、`spec/opc-xuanji/*`、`migrations/0015_autopilot_console.sql`、`src/domains/project/autopilot.ts`、`src/domains/admin/service.ts`、`src/api/http.ts`、`client.js`、`test/integration/autopilot.test.ts`

## 1. 原始需求

自动驾驶页原来只能触发一次执行，看不到「现在做到哪一步、上次为什么失败、接下来怎么走」；项目描述要人工再抄一遍；三份计划是通用模板，老板无法据此判断是否合理。需要把状态、当前执行、执行记录、计划路线图与归档集中呈现，并让计划与描述来自检出内容而不是模板。

## 2. 变更内容

- `OPC-SRS-105` 新增 `REQ-PRJ-037`（自动驾驶控制台，5 条 AC）、`REQ-PRJ-038`（项目描述从版本库抽取，人工优先，5 条 AC）、`REQ-PRJ-039`（基于项目内容的计划生成，5 条 AC），项目监理需求 36→39；同步修订 `REQ-PRJ-029` AC（计划内容改为基于检出内容，新增 AC-5）与 §4 数据对象表（`project` 增 `description`/`archived_at`/`archive_reason`，新增 `project_autopilot_run`）。
- 迁移 `migrations/0015_autopilot_console.sql`：`biz.project` 新增 `description text`、`archived_at timestamptz`、`archive_reason varchar(200)`（16→19 列）；新增 `stat.project_autopilot_run`（13 列含主键 `id`，`trigger` CHECK manual/idea/api、`status` CHECK running/ok/failed、`steps` jsonb、`result` jsonb、`error text`）与两个索引 `project_autopilot_run_project_idx(project_id,id DESC)`、`project_autopilot_run_running_idx(project_id) WHERE status='running'`；表数 91→92、实体 91→92。
- 执行记录：每次 `bootstrap` 先追加一行（`trigger=manual|idea|api`），阶段固定 10 步 `register/checkout/scan/profile/scaffold/pipeline/plans/deploy/decisions/done`；`steps` 每项 `{stage,label,status(pending|running|ok|failed|skipped),startedAt,endedAt,durationMs,detail}`；成功 `status=ok,stage=done`，失败 `status=failed` 保留失败阶段与 `error`，未执行阶段记 `skipped`；`deploy` 因无测试环境/条件缺失不再中断整次执行，记 `skipped` 并转裁决。同项目已有 `running` 行时返回 **409 `ERR-AUTO-001`**（提示「已有自动驾驶正在执行」）。
- 状态派生：6 态 `not_started`/`running`/`waiting_decision`/`failed`/`ready`/`archived`，优先级 `archived > running > 最近一次失败(failed) > waiting_decision > ready(planCount>0) > not_started`；列表与 summary 共用同一函数，`currentRun` 仅在 `status=running` 时非空。
- summary 扩展（`GET /api/v1/admin/projects/{projectId}/autopilot`）：新增 `status`/`statusLabel`、`description`/`descriptionSource`、`archivedAt`/`archiveReason`、`project{id,name,stage,projectType,description,archivedAt,archiveReason}`、`currentRun`、`runs`（≤10，最新在前）、`roadmap{weeks,startDate,endDate,milestones,phases,plans[{planKind,version,title,status,generatedAt,content}]}`、`milestones`；`plans[]` 带 `content`，路线图阶段优先、里程碑兜底。
- 新增接口（契约 114→117，编号 P102–P104）：`GET /admin/autopilot/projects?archived=active|archived|all`（默认 `active`，返回 `items` 与 `counts{total,active,archived,running,waitingDecision,ready,failed,notStarted}`）；`POST /admin/projects/{id}/archive`（body `{reason?}`，≤200 字）；`POST /admin/projects/{id}/unarchive`。归档/恢复只改标记，不删检出/计划/执行记录/裁决，分别写审计 `project.autopilot.archive` / `project.autopilot.unarchive`。`PUT /admin/projects/{id}` 的 `PROJECT_FIELDS` 增 `description`。
- 描述抽取：只读检出目录，按 `README.md/README/readme.md/README.markdown/README.txt/readme.txt` 取首个标题与首段正文（去徽章/图片/代码块/链接/HTML，≤200 字，`readmeExcerpt` ≤600 字）；README 无描述时回退 `package.json.description`、`pom.xml <description>`、`pyproject.toml`/`Cargo.toml`/`setup.py` 的 description；仅当 `biz.project.description` 为空时写入（`COALESCE(NULLIF(description,''), $new)`），人工编辑不被覆盖；`software_profile` 写 `description`/`descriptionSource`/`readmeTitle`/`readmeExcerpt`/`modules[{name,files,loc}]`/`scripts`/`docs`/`docker`/`license`/`envExample`。
- 内容化计划：dev `content` = weeks/description/phases（5 阶段，含 startDate/endDate/owner/status/deliverables）/milestones/workBreakdown（按顶层模块）/modules/scripts/docs/assumptions/risks/generatedFrom；test `content` = planId/cases（TC-AUTO-001..003 基线）/caseDetails（含 focus）/suggestedCases（TC-MOD-001..，按模块）/testTypes/testFiles/ci/focusAreas/entryCriteria/exitCriteria/docs/risks；deploy `content` = environmentId/environmentSource/runtime{docker,ci,scripts}/targets/steps/rollback/artifacts/secrets/assumptions/description（有 Dockerfile 时首步构建镜像、`targets.strategy=docker`，否则 ssh）。
- 测试：新增 `TC-AUTO-012`（描述抽取与人工优先）、`TC-AUTO-013`（执行记录/状态/currentRun 空）、`TC-AUTO-014`（路线图与内容化计划）、`TC-AUTO-015`（归档/恢复与列表过滤）、`TC-AUTO-016`（并发 409）；`autopilot.test.ts` 11→16，全量 129→134。
- 文档/规格同步：`OPC-SRS-001`、`OPC-SRS-105`、`OPC-IRS-001`、`OPC-DBDD-001`、`OPC-RTM-001`、`OPC-STD-001`、`OPC-STP-001`、`OPC-STR-001`、`OPC-SDD-001`、`spec/opc-xuanji/api.yaml`/`usecases.yaml`/`entities.yaml`、`scripts/gen-spec.mjs`、`docs/index.md`、`pa-index.md`、`CHANGELOG.md`、`README.md`。

## 3. 关键边界

- **归档不是删除**：`archive` 只写 `archived_at`/`archive_reason`，不删检出、计划、执行记录与裁决；默认列表隐藏归档，`archived=all` 仍可查；误归档用 `unarchive` 恢复，数据不重建。
- **不伪造运行中**：`currentRun` 只在 `status=running` 时非空；无执行时返回 `null`，不用「计划就绪」冒充「正在执行」。
- **不并跑**：同项目已有 `running` 行时再次执行返回 409，不产生第二条 running、不覆盖历史；失败执行保留失败阶段与 `error` 摘要，便于定位。
- **描述人工优先**：机器只填空描述；人工编辑过的描述永不被后续检出覆盖，抽取结果仍写 `software_profile` 留证据。
- **只读检出、不执行仓库代码**：描述与内容化计划全部来自只读扫描；无 Docker/无测试/无 CI 时按缺省口径降级并写入 `assumptions`/`risks`，不虚构模块、用例或部署步骤。
- **三份计划仍 draft**：生产目标仍 `waiting-for-decision`，自动生成不等于自动上线；生产发布仍需人工审批。
- **无新增错误码**：并发/参数复用 `ERR-AUTO-001`，检出 `ERR-AUTO-002`，凭据 `ERR-AUTO-003`，裁决 `ERR-AUTO-004`。

## 4. 落地状态

- 文档/规格（本 PA 责任域，已验证）：`OPC-SRS-105`/`OPC-SRS-001`/`OPC-IRS-001`/`OPC-DBDD-001`/`OPC-RTM-001`/`OPC-STD-001`/`OPC-STP-001`/`OPC-STR-001`/`OPC-SDD-001`、`spec/opc-xuanji/*`、`docs/index.md`、`pa-index.md`、`CHANGELOG.md`、`README.md` 已按 §2 同步；`entities.yaml` 与生成器一致，`spec:check`/`docs:check` 全绿。
- 迁移：`0015_autopilot_console.sql` 已应用测试库（表数 91→92、`biz.project` 16→19 列、`stat.project_autopilot_run` 13 列含主键 `id`），应用结果以集成阶段实测为准。
- 代码/测试：`src/domains/project/autopilot.ts`（执行记录/状态派生/描述抽取/内容化计划/归档）、`src/domains/admin/service.ts`（`listAutopilotProjects`/`archiveProject`/`unarchiveProject`、`PROJECT_FIELDS` 增 `description`）、`src/api/http.ts`（3 条新路由，`ROUTES` 117）、`client.js`（自动驾驶页签状态/当前执行/路线图/执行记录/归档）由 Lead 落地；`autopilot.test.ts` 的 TC-AUTO-012..016 执行结果以 `OPC-STR-001` §19 与 `npm test` 输出为准。

## 5. 验证

文档与规格侧（本次实际执行）：

```bash
node scripts/gen-spec.mjs && node scripts/gen-spec.mjs --check   # entities.yaml 与生成器一致（92 实体）
npm run spec:check     # PASS（92 实体 / 31 用例 / 21 模块，117 operation）
npm run docs:check     # PASS（28 份；门禁统计不含 `docs/过程资产/`）
node --test test/integration/spec.test.ts   # 4/4 pass（api.yaml operation 117 == ROUTES 117）
```

集成侧（由 Lead 在真实 PostgreSQL 上复跑）：

```bash
npm run migrate && npm run migrate:test   # 0015 各 applied 1
node --test test/integration/autopilot.test.ts   # 16/16 pass（已实测）
npm test                                  # 全量 134/134 pass（2026-11-14 实测）
```

TC 断言要点：README 夹具 → `description` 取首段、`descriptionSource='README.md'`、人工描述不被覆盖；一次执行 → `runs.length=1`、10 步完整、`currentRun=null`、`status=waiting_decision`；路线图 → 5 阶段/3 计划/5 里程碑且三份 `content` 命中检出模块与 Dockerfile；归档 → active 列表隐藏、archived/all 可见、执行记录与计划不删；预置 running 行 → 409 `ERR-AUTO-001`。

## 6. 回滚

- 代码：恢复 `src/domains/project/autopilot.ts`、`src/domains/admin/service.ts`、`src/api/http.ts`、`client.js` 到 v2.22 实现并重启；文档随代码回退到 v2.22 口径（114 operation / 91 实体）。
- 数据：`0015` 只新增 3 个可空列与 1 张新表（含默认值），回滚代码无需删列删表；`stat.project_autopilot_run` 保留的历史执行记录不影响旧代码读取；归档项目可用 `unarchive` 或直接清空 `archived_at` 恢复。
- 配置：无需新增环境变量；描述抽取与内容化计划不引入新凭据。
