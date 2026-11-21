# PA-OPC-034 计划自动推进（定时任务 + 编码 agent + 完成判定）

- 变更编号：CR-2026-11-14-13
- 日期：2026-11-14
- 发起人：老板
- 变更类型：新增能力（项目监理·自动驾驶计划执行）
- 关联：`OPC-SRS-105` §3.40、`OPC-SRS-001` §12、`OPC-IRS-001` §7.6、`OPC-DBDD-001` §3.16/§5.2、`OPC-RTM-001` §1.3、`OPC-STD-001` §4.35、`OPC-STP-001` §22、`OPC-STR-001` §21、`OPC-SDD-001` §5.7、`spec/opc-xuanji/usecases.yaml`、`migrations/0016_plan_execution.sql`、`src/domains/project/autopilot.ts`、`src/agents/bridge.ts`、`src/agents/service.ts`、`src/scheduler/tasks/index.ts`、`src/plugin/index.ts`、`client.js`、`test/integration/autopilot.test.ts`、`test/integration/scheduler.test.ts`

## 1. 原始需求

老板要求：**自动驾驶要能够自动完成项目，根据项目计划，逐步完成欠缺的内容，推动项目的完成。**

原有自动驾驶只在建项目时跑一次「检出 → 扫描 → 计划 → 骨架 → 流水线 → 测试环境」，计划生成后没有后续推进；项目「做到哪一步、还缺什么、谁来补」仍需老板自己盯。

本次决策（老板 2026-11-14 选择）：

- **能力边界 C**：先做工程交付物自动补齐，并**派编码 agent** 直接改检出目录补齐实现；不引入新的 AI 代码生成通道。
- **触发方式**：**只做后台定时自动**，不提供手动「推进」按钮；需要立即推进时用既有任务面 `opc_task_run`/`POST /tasks/{id}/run` 强制跑一次。

## 2. 变更内容

- 新增定时任务 `project_plan_auto`（`*/15 * * * *`、`Asia/Shanghai`、默认启用）：每次 tick 只推进**一个项目的一个单元**，先回收等待中的计划运行，再按「最久未推进」挑选候选；已完成（无新计划/新检出）与「阻塞且裁决未处理」的项目跳过。
- `ProjectAutopilotService` 新增 `advancePlan(projectId)` 与 `autoAdvanceNext(now)`：复用 `stat.project_autopilot_run` 的执行记录与 `steps/result`，新增 `trigger=plan`；计划运行跨 tick 保留 `running`，悬挂清理阈值放宽到 6 小时（bootstrap 仍为 30 分钟）。
- 任务推导与完成判据（写入检出目录 `docs/autopilot/`，存在即完成、可断点续跑）：
  - `freeze` → `scope.md`：范围（工作分解/模块）+ 验收标准 + 假设/风险；
  - `design` → `architecture.md`：主语言/框架/构建脚本/模块/测试与 CI/部署口径；
  - `build` → `build.md`：派编码 agent 补齐实现与测试，成功后才写；
  - `verify` → `test-report.md`：只跑仓库既有 lint/build/test（300s/步、默认不装依赖），通过才写；
  - `release` → `release.md`：发布测试环境成功才写，同时生成 `production_release` 裁决。
- 编码 agent：`SuperAgentsBridge` 增 `cancelRun`；`SuperAgentService` 增 `ensureCodingAgent`/`dispatchCoding`/`codingResult`/`cancelCoding`，按项目在检出目录 upsert「OPC 项目开发·<projectId>」角色卡（`cwd=工作副本`、`learn=false`），人设见 `CODING_AGENT_ROLE`（只改工作目录、不 push/不 commit、不引依赖、不碰凭据、不写库）。派活后 runId 写入 `steps[].data.agentRunId`，下一 tick 用 `codingResult` 回收（`OPC_AUTOPILOT_AGENT_TIMEOUT_MS` 默认 900000ms，超时 `cancelCoding` 并转裁决）。
- 阻塞与裁决（计划推进的阻塞按「新事件」处理：`allowRepeat`，每次新起一条 pending，不复用历史上已裁决的同 topic）：`coding_agent`（agent 不可用/失败/超时）、`pipeline_failed`（流水线仍失败）、`pipeline_env`（缺少数据库连接串/环境变量，直接转裁决、不派修复 agent）、`deploy_executor`（未配置 `OPC_TEST_DEPLOY_CMD`）、`deploy_failed`、`production_release`（生产发布待批）。生产发布永不自动执行。
- 完成判定：五类交付物齐备 → `completed=true`（`summary.planExecution.completed`），5 个里程碑置 `achieved`、`biz.project.progress=100`、计划 `status=active`；Git 工作副本 `git add -A && commit` 到本地分支（不推远端），SVN 只留工作副本不提交。
- `summary` 增 `planExecution{id,status,startedAt,endedAt,completed,blocked,blockTopic,nextTask,percent,tasks[{key,title,status,detail}]}`；`client.js` 自动驾驶页右栏新增「计划自动推进」卡（进度条 + 五任务状态 + 阻塞提示 + 「无手动按钮」说明），并给执行记录/当前执行的触发来源加中文映射（`plan=计划自动推进`）。
- 迁移 `0016_plan_execution.sql`：仅 `DROP/ADD CONSTRAINT` 把 `stat.project_autopilot_run.trigger` CHECK 扩为 `manual|idea|api|plan` 并加注释；**不新增表/列、不改 entities、不新增 HTTP operation**（契约仍 117）。

## 3. 关键边界

- **不自动生产发布**：测试环境成功后只生成 `production_release` 裁决，生产发布仍需老板明确批准。
- **不伪造完成**：任务以交付物存在为判据；流水线失败、部署未配置、agent 未完成都不写成功文档，转为阻塞 + 裁决。
- **编码 agent 不越界**：角色卡 cwd 固定为检出目录，prompt 明确不 push/不 commit/不引依赖/不读凭据/不写数据库；超时主动 cancel，避免后台继续改工作副本。
- **单项目串行**：复用既有 `running` 并发保护（同项目已有运行中执行时 409 `ERR-AUTO-001`）；后台任务每次只挑一个项目，避免多个项目同时跑构建。
- **不推进归档项目**：`archived_at` 非空的项目直接跳过。
- **跨 tick 续跑**：计划运行在 tick 之间保持 `running`，`steps[].data` 存 agent runId；进程重启后 6 小时内可继续回收，超时按中断处理。
- **无新增 HTTP/工具**：本次只新增定时任务与 summary 字段；立即执行走既有任务运行入口（`opc_task_run`）。

## 4. 落地状态

- 迁移：`0016_plan_execution.sql` 已在业务库与测试库各 applied 1（表数仍 92、无新列）。
- 代码：`src/domains/project/autopilot.ts`（`advancePlan`/`autoAdvanceNext`/任务与文档生成/agent 回收/完成与阻塞）、`src/agents/bridge.ts`（`cancelRun`）、`src/agents/service.ts`（编码 agent 四方法与角色）、`src/scheduler/tasks/index.ts`（`project_plan_auto`）、`src/plugin/index.ts`（autopilot 注入 agents）、`client.js`（`PlanAutoCard` 与 `TRIGGER_LABEL`）。
- 测试：`test/integration/autopilot.test.ts` 新增 TC-AUTO-017..019（假编码 agent 注入，不启动真实 DSH agent）；`test/integration/scheduler.test.ts` 新增任务集与「无候选项目」用例；`test/integration/api.test.ts`/`plugin.test.ts` 任务计数 18→19；`test/unit/client-render.test.ts` 新增 `PlanAutoCard` 三态渲染（不增用例数）。
- 文档/规格：`OPC-SRS-105` §3.40（REQ-PRJ-040，5 条 AC）、`OPC-SRS-001` 需求表、`OPC-IRS-001` §7.6（summary 字段与 trigger）、`OPC-DBDD-001` §3.16/§5.2、`OPC-RTM-001`、`OPC-STD-001` §4.35、`OPC-STP-001` §22、`OPC-STR-001` §21、`OPC-SDD-001` §5.7、`spec/opc-xuanji/usecases.yaml`（UC-032）、`README.md`、`CHANGELOG.md`、`docs/index.md`、`pa-index.md`。

## 5. 验证

本次实际执行（仓库根目录）：

```bash
npm run migrate && npm run migrate:test   # 0016 各 applied 1（表数仍 92）
npm run typecheck                         # exit 0
npm test                                  # 141/141 pass（单元 45 + 集成 96，2026-11-14 实测）
npm run spec:check                        # PASS（92 实体 / 32 用例 / 21 模块，117 operation）
npm run docs:check                        # PASS（28 份，不含 docs/过程资产/）
```

TC 断言要点：TC-AUTO-017 生成 `scope.md`/`architecture.md`、`planExecution.percent=40`、计划转 `active`；TC-AUTO-018 假 agent 先 `running` 后 `done`，`build` 完成→流水线 `npm test` 通过→发布被 `deploy_executor` 阻塞→配置命令后 `completed=true`、进度 100、5 里程碑 `achieved`、生成 `production_release` 裁决；TC-AUTO-019 `autoAdvanceNext` 选项目并续跑，无编码 agent 时 `blocked=true`，阻塞后不再重复推进。

未覆盖（已在 `OPC-STP-001` §22 登记）：真实 DSH 编码 agent 的派活、cwd 写入与沙箱授权；真实部署命令与健康检查；浏览器视觉验收。

## 6. 回滚

- 代码：回退 `src/domains/project/autopilot.ts`、`src/agents/{bridge,service}.ts`、`src/scheduler/tasks/index.ts`、`src/plugin/index.ts`、`client.js` 到 v2.24；定时任务定义随之移除，`stat.task_schedule` 中的 `project_plan_auto` 行可手工删除（不影响历史 `task_run`）。
- 数据：`0016` 只改 CHECK 约束，回滚代码无需删列删表；`stat.project_autopilot_run` 中 `trigger=plan` 的历史记录保留，旧代码读取不受影响；已生成的 `docs/autopilot/*.md` 在检出目录可人工删除。
- 配置：无新增必填环境变量；`OPC_AUTOPILOT_AGENT_TIMEOUT_MS` 可选，未设置用默认 15 分钟。

## 自检清单

- [x] 需求与老板决策一致（能力 C + 仅后台定时自动，无手动按钮）
- [x] 无新增 HTTP operation / 工具 / 表；迁移只改 CHECK 约束
- [x] 编码 agent 边界（不 push、不 commit、不碰凭据、超时取消）写入人设与 prompt
- [x] 生产发布永不自动执行，只生成 `production_release` 裁决
- [x] 完成判定以交付物存在为判据，失败/阻塞不写成功文档
- [x] 测试计数可复算（137→141：+3 自动驾驶 +1 调度任务）
- [x] 未覆盖项（真实 agent/部署/浏览器）已显式登记，未假装通过
- [x] 文档同步清单与本 PA 关联字段一致

## 与其他文档的关系

- 上游：`OPC-SRS-105` §3.40（REQ-PRJ-040）、`OPC-SRS-001` §12、`OPC-IRS-001` §7.6、`OPC-SDD-001` §5.7。
- 下游：`OPC-STD-001` §4.35（TC-AUTO-017..019）、`OPC-STP-001` §22（本轮增量测试项）、`OPC-STR-001` §21（执行证据）。
- 同级：`PA-OPC-032`（自动驾驶控制台，提供运行记录/状态/计划）、`PA-OPC-026`（自动化生产：骨架/流水线/测试环境）、`PA-OPC-033`（新建项目独立界面与自动驾驶操作区）。
- 索引：`docs/index.md` §3 与 `docs/过程资产/pa-index.md` 已登记本记录。
