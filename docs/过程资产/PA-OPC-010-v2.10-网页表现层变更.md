# PA-OPC-010 v2.10 网页表现层变更记录

- 变更编号：CR-2026-11-06-01
- 日期：2026-11-06
- 发起人：老板（需求提出）
- 变更类型：需求增量 + 设计/代码/测试同步
- 上游：产品设计 v2.10、技术架构 v2.10
- 关联门禁：G1（需求）、G2（契约）、G3（实现）、G4（验证，待测试库）

## 1. 原始需求

1. 在 DSH 插件栏显示“OPC公司管理”插件；
2. 在最右侧栏显示网页，展现系统内容；
3. 通过中间栏会话与插件交互；
4. 插件可调用各项会话内容与记忆插件记忆，把用户通过 DSH 上传/输入的信息分门别类归置到管理软件各栏目；
5. 插件的日志、日报、简报、统计分析汇总到右栏，形成公司日常管理数据大屏/驾驶舱；
6. 增加计划任务：检索新增 DSH 插件并推荐适用项；监控公司发展需要关注的关键词；
7. 对齐需求文档、设计文档、代码、测试，更新过程文档。

## 2. 需求编号

| 编号 | 需求 | 文档 | 代码 | 测试 |
| :--- | :--- | :--- | :--- | :--- |
| REQ-WEB-001 | 插件栏入口与右侧面板 | SRS §8.4.1；IRS §7；SDD §5.5 | `src/web/services.ts`、`src/api/http.ts` P17；`opc_web_manifest` | TC-WEB-005 |
| REQ-WEB-002 | 会话桥/记忆桥 | SRS §8.4.2；IRS §7 | `src/web/services.ts`（SessionGrantService/MemoryService）；P22–P27 | TC-WEB-002 |
| REQ-WEB-003 | 上传/输入归置 | SRS §8.4.3；IRS §7 | `src/web/classifier.ts`、`src/web/services.ts`（IngestService）；P19–P21 | TC-WEB-001 |
| REQ-WEB-004 | 驾驶舱聚合 | SRS §8.4.4；IRS §7 | `src/web/dashboard.ts`；P18；`dashboard_refresh` | TC-WEB-003 |
| REQ-WEB-005 | 插件/关键词雷达 | SRS §8.4.5；IRS §7 | `src/web/plugin-score.ts`、`src/web/services.ts`（RadarService）；P28；2 个任务 | TC-WEB-004 |
| REQ-WEB-006 | 权限、审计与隐私 | SRS §8.4.6；IRS §7.1 | 各服务统一 `audit.record`；敏感记忆脱敏 | TC-WEB-002/003 |

## 3. 关键设计决策（ADR）

| # | 决策 | 理由 | 代价/风险 |
| :--- | :--- | :--- | :--- |
| ADR-01 | 三栏结构：左插件栏 / 中会话 / 右面板 | 复用 DSH 现有交互，不另造聊天入口 | 依赖 DSH 右侧面板插槽能力 |
| ADR-02 | 适配层三档：原生插槽 → iframe → 降级独立页 | DSH Web 扩展点尚未最终确认 | iframe 需额外 CSP/postMessage 安全 |
| ADR-03 | 归置规则优先、模型补充 | 规则可解释、可测试；模型只处理长尾 | 长尾表达仍需收件箱兜底 |
| ADR-04 | 高风险域一律人工确认 | 财税/法务/客户/库存误写代价高 | 交互步骤增加 |
| ADR-05 | 会话/记忆按范围授权，默认最近 20 条 | 最小必要读取，避免静默全量扫描 | 跨会话摘要需额外授权 |
| ADR-06 | 驾驶舱读模型 + 统一 as_of | 避免面板直扫主表与口径漂移 | 秒级延迟，需陈旧提示 |
| ADR-07 | 计划任务用 PG 表 + `FOR UPDATE SKIP LOCKED` | 不引入 Redis/独立队列；与现有调度器一致 | 多实例并发需压测 |
| ADR-08 | 插件雷达只推荐不自动安装 | 权限/数据驻留风险需老板判断 | 推荐转化依赖人工 |

## 4. 影响分析

| 资产 | 变更 |
| :--- | :--- |
| 产品设计 | 新增第九章（WEB-01..10）；插件形态、事件、审计、降级、路线图同步 |
| 技术架构 | 新增第八章（适配层/API/数据模型/调度/安全/性能/测试） |
| SRS/IRS/SDD/DBDD | 新增 WEB 需求、P17–P28、Web 服务设计、8 张表 |
| spec | entities 37→45；api 16→28 operation；usecases 9→14（UC-010..014）；modules 新增 web |
| 代码 | 新增 `src/web/*`（5 文件）；`src/api/http.ts` 12 路由；`src/plugin/index.ts` 10 工具；`src/scheduler/tasks/index.ts` 3 任务；`src/platform/errors.ts` 新增 `ERR-WEB-001` |
| 迁移 | 新增 `migrations/0004_web_layer.sql` |
| 测试 | 新增 `test/unit/web.test.ts`（5）、`test/integration/web.test.ts`（5）；更新既有计数断言 |
| 过程 | 新增本 PA；更新 pa-index、docs/index、README |

## 5. 验证证据（本机）

| 命令 | 结果 |
| :--- | :--- |
| `npm run test:unit` | 21/21 pass |
| `npx tsc --noEmit` | exit 0 |
| `node scripts/gen-spec.mjs --check` | PASS（45 实体一致） |
| `npm test`（集成） | 失败（环境缺失）：8 个集成文件因缺少 `OPC_PG_DSN` 在启动阶段失败；单元 21 通过 |
| `npm run spec:check` | 未执行：本机无 `check-spec.mjs` 路径；已用脚本核对 28 operation ↔ 28 routes |

## 6. 待确认与残余风险

1. **DSH Web 插槽**：P1 必须确认宿主是否提供右侧面板插槽/会话事件；否则只能降级独立页。
2. **会话事件契约**：`SessionBridge` 的消息 ID、角色、授权粒度需与 DSH 实际契约对齐。
3. **记忆插件契约**：`hub.memory.*` 为封装约定，需核对 DSH 记忆插件实际 API。
4. **外部检索源**：插件市场/MCP 适配器未接入；当前用任务 config 注入候选验证流程。
5. **多角色**：v1 默认单老板；兼职/外包白名单需在真实角色模型落地后补测。
6. **集成验证**：`0004` 迁移与 5 个 Web 集成用例需在具备测试库的环境复跑并回写 STR。

## 7. 下一步

1. 在测试库应用 `0001..0004`，跑 `npm test` 与 `spec.test.ts`，把结果追加到 `OPC-STR-001` §9。
2. 与 DSH Web 宿主核对插槽/会话/记忆契约，落地 `WebHostAdapter`。
3. 接入插件市场/MCP 检索适配器，替换任务 config 注入。
4. 补前端 SPA（React/Vite/ECharts）与三栏 E2E。
