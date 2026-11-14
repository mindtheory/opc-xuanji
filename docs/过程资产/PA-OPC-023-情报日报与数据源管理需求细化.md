# PA-OPC-023 情报日报与数据源管理需求细化记录

- 变更编号：CR-2026-11-14-02
- 日期：2026-11-14
- 发起人：老板
- 变更类型：员工需求完善
- 关联：`OPC-SRS-106`、`OPC-SRS-001` §9、`OPC-DBDD-001`、`OPC-RTM-001`、`spec/opc-xuanji/entities.yaml`、`src/employees/catalog.ts`、`src/scheduler/tasks/index.ts`

## 1. 原始需求

完善情报日报模块：完善采集的数据源管理；定时任务自动执行采集、分析、汇总、简报、推送；按项目划分，不同项目使用不同关键词/标签。

## 2. 变更内容

- `OPC-SRS-106` 由 10 条需求扩展为 18 条，新增：
  - `REQ-INT-011` 项目化情报空间；
  - `REQ-INT-012` 采集数据源注册与健康管理；
  - `REQ-INT-013` 项目关键词与标签规则；
  - `REQ-INT-014` 定时采集与增量幂等；
  - `REQ-INT-015` 情报分析、去重与评分；
  - `REQ-INT-016` 汇总与情报日报生成；
  - `REQ-INT-017` 简报推送与送达追踪；
  - `REQ-INT-018` 流水线编排与运行监控。
- 扩展员工 manifest：`opc_intel` 工具族增加 `project_scope/keyword/tag/collect/analysis/pipeline/push` 七族；写目标增加 `intel_project_scope`、`source_binding`、`intel_tag`、`intel_collect_run`、`intel_pipeline_run`、`intel_push_log`；单员工流程增加 `intel_daily_pipeline`；版本升至 `0.2.0`。
- 新增 10 个实体与 `migrations/0007_intel_daily.sql`：`IntelProjectScope`、`Source`、`SourceBinding`、`WatchTopic`、`IntelTag`、`IntelItem`、`IntelBrief`、`IntelCollectRun`、`IntelPipelineRun`、`IntelPushLog`。
- 新增 5 个定时任务：`intel_source_collect`、`intel_analyze`、`intel_aggregate`、`intel_brief`、`intel_push`；本地实现采集入库、规则评分、汇总、日报版本化与站内降级推送。
- 计数同步：员工需求 137→145，主文档功能需求合计 176→184；实体 66→76；`OPC-SRS-001`、`OPC-SQAP-001`、`OPC-RTM-001`、`OPC-DBDD-001`、`docs/index.md`、`docs/员工需求/index.md` 已同步。

## 3. 关键边界

- 数据源凭据只存 `auth_ref` 引用，禁止明文入库、写日志或随员工包导出。
- 未配置采集适配器时把来源标 `blocked` 并输出“本次未采集”，绝不生成虚构条目。
- 关键词/标签、条目、简报、推送按 `project_id` 隔离；跨项目复用数据源必须显式 `source_binding`。
- 评分只做可解释的关键词/标签命中；事实、推断、传闻必须区分，缺证据标 `unknown`。
- 简报按 `(项目, 日期, 类型, 版本)` 版本化，已推送版本不覆盖；同日重跑生成新版本。
- 外部推送渠道不可用时降级站内并标“外部渠道未送达”，不静默失败。
- 夜间静默 22:00–08:00 适用于非紧急情报；高风险/负面舆情与截止日 12 小时内例外。

## 4. 落地进度

1. ✅ `spec/opc-xuanji/entities.yaml` 已由 `scripts/gen-spec.mjs` 生成 10 个新实体（总数 66→76）。
2. ✅ `migrations/0007_intel_daily.sql` 已建 10 张表（biz 7 + stat 3）；`test/helpers.ts` 清库清单已同步。
3. ✅ `src/employees/catalog.ts` 已扩展 `opc_intel` manifest 与允许写目标。
4. ✅ `src/domains/intel/daily.ts` 已实现本地流水线；`src/scheduler/tasks/index.ts` 已注册 5 个情报任务。
5. ✅ 情报管理 REST（`/api/v1/admin/intel/*`）与驾驶舱页签已落地（见第 6 节）。
6. ⏳ 待落地：真实 RSS/API/MCP 采集适配器、外部 IM/邮件推送通道、阶段超时/重试策略。
7. ⏳ 待落地：采集器凭据托管方案与各渠道授权；需老板确认后再接真实来源。

## 5. 验证

- 文档级：`OPC-SRS-106` 18 条 AC 完整；SRS/SQAP/RTM/DBDD/索引计数已同步（实体 66→76、员工需求 137→145）。
- 代码级：`npm run typecheck`；`npm run test:unit`（新增 `test/unit/intel.test.ts` 规则评分用例）；`test/integration/intel.test.ts` 覆盖采集幂等→分析→日报→推送。
- 规格级：`npm run spec:check`（76 实体 / 14 用例 / 21 模块）。
- 测试级：`npm run docs:check`；有测试库时执行 `npm run migrate:test && npm run test:integration`。

## 6. Web 管理面（本次增量）

- 新增 `/api/v1/admin/intel/*`：情报空间、数据源、来源绑定、关注主题、标签 CRUD；情报条目列表/状态、日报列表/详情、流水线/采集/推送运行记录、手动触发 analyze/aggregate/brief/push、情报 KPI 汇总。
- `client.js` 新增「情报管理」页签：项目选择、概览 KPI、情报空间、数据源与绑定、关注主题、标签、条目、日报、流水线 8 个视图；CRUD、条目归档/过滤、日报详情与手动触发均可视化完成。
- 驾驶舱新增情报指标：活跃/异常来源、区间新增情报、7 天日报、24h 流水线失败、情报空间数。
- 边界不变：未配置适配器仍标 blocked，不伪造条目；外部推送不可用降级站内并留痕。
- 验证：`test/integration/admin.test.ts` 覆盖情报空间/来源/绑定/主题/标签 CRUD、流水线触发、日报详情与驾驶舱指标。
