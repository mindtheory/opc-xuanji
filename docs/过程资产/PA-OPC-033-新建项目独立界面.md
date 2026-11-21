# PA-OPC-033 新建项目独立界面与自动驾驶操作区重排

- 变更编号：CR-2026-11-14-12
- 日期：2026-11-14
- 发起人：老板
- 变更类型：界面调整（管理面信息架构与布局）
- 关联：`OPC-SDD-001` §5.7、`OPC-STD-001` §4.34、`OPC-STP-001` §21、`OPC-STR-001` §20、`client.js`、`test/unit/client-render.test.ts`、`CHANGELOG.md`、`README.md`

## 1. 原始需求

自动驾驶页把「新建项目（版本库直建）」「从创意新建项目」「对已选项目执行」三张表单卡与项目详情混排在同一个长页面里：创建动作被压在页面最底部，执行表单与创建表单字段重复，待裁决、流水线、测试环境等动作散落在页面中部，老板要滚很久才能找到「动手的地方」。

要求：**把「新建项目」做成独立界面**；**当前自动驾驶页的操作区调整好布局**。

## 2. 变更内容

- 左栏「经营」组新增页签 **新建项目**（`newproject`，`plus` 图标），注册在「自动驾驶」之后；Console 路由增加 `NewProjectTab`，并新增 `focusProjectId` 状态承载「建好后跳转并选中新项目」。
- `NewProjectTab`（独立页）：
  - 页头分段控件切换创建方式：「版本库直建」/「创意 / 文档解析」，两种模式各自保留表单草稿。
  - 版本库直建：项目名、版本库类型（Git/SVN）、地址、分支（SVN 为主干/分支路径）、修订号（仅 SVN）、凭据引用（仅 `env:`）、健康检查 URL；勾选项「生成代码骨架 / 跑测试流水线 / 发测试环境」与「开始自动生产」按钮；SVN 与 Git 互切时清空 Git 习惯值 `main`/`master`，避免拼出 `.../main`。
  - 创意 / 文档解析：创意文本 + 多文档上传（txt/md/docx/xlsx/pdf 等，单文件 ≤10MB、总量 ≤20MB）+ 可选项目名与版本库；「仅解析预览」走 `/admin/ideas/analyze`，「AI 解析并创建」走 `/admin/projects/from-idea`；本次起把可选「项目名称」随创建请求提交（后端本已支持 `name` 覆盖 AI 命名）。
  - 右侧固定三块说明：创建后会发生什么（4 步流程）、填写提示（协议/分支/凭据/文档限制/无仓库降级）、建好之后（可重复执行、计划版本递增）。
  - 创建成功后在页头下方原地显示结果卡：项目名、状态、检出/骨架/流水线/发布摘要（创意模式另显示 AI 解析名/类型/置信度/工期/范围/目标/风险/待裁决问题），动作「去自动驾驶查看」「再建一个」。
- 自动驾驶页重排：
  - 页头新增主按钮「新建项目」，项目总览卡头部同样提供入口；无选中项目时的空态也提供「新建项目」按钮。
  - 写操作收敛为一张「执行操作」卡：版本库类型/地址/分支/修订号/凭据引用/健康检查 URL + 三个开关 + 「执行自动驾驶」「发布到测试环境」，并展示已登记版本库；原页面底部的「新建与执行」「新建项目并自动生产」「从创意新建项目」三块移出。
  - 详情改为 `ocSplit` 两栏：左栏项目信息、当前执行、计划路线图、执行记录；右栏待裁决、检出与扫描、测试流水线、测试环境发布（右栏 sticky，≤860px 单列）。
  - 待裁决从横排行内按钮改为右栏卡片内的「裁决 → 填写 → 确认/取消」，窄栏下不再挤压。
- 新增样式类（均以 `oc` 开头、使用 `var(--oc-*)` 令牌）：`ocFormGrid`、`ocCheckRow`、`ocActionRow`、`ocModeIntro`、`ocFileDrop`、`ocFileList`、`ocFlow`/`ocFlowItem`/`ocFlowNum`、`ocResultCard`，以及 ≤640px 单列回退；`plus` 图标。
- 无接口、表结构、错误码变化；创建与执行仍调用既有 `POST /admin/projects`、`POST /admin/projects/from-idea`、`POST /admin/ideas/analyze`、`POST /admin/projects/{id}/autopilot`、`POST /admin/projects/{id}/deploy-test`。

## 3. 关键边界

- **不新增后端能力**：本次只重排管理面前端（`client.js`），行为契约不变；不新增 operation、迁移或错误码。
- **不改变生产放行口径**：自动生产仍只生成 draft 计划与待裁决项，生产发布仍需人工审批。
- **凭据不落地**：凭据只填 `env:` 引用，前端不保存、不回显口令；SVN 口令仍由服务环境经 stdin 传入。
- **不伪造结果**：创建结果卡只展示响应里实际存在的检出/骨架/流水线/发布摘要；缺字段不补 0、不臆造成功。
- **窄屏可用**：`ocSplit` 在 ≤860px 收为单列；表单栅格在 ≤640px 单列，右栏说明移到表单之后。
- **不改历史数据**：页面切换与布局调整不写库；归档/恢复、执行、裁决仍按原逻辑写审计。

## 4. 落地状态

- 代码（Lead 落地）：`client.js` 新增 `NewProjectTab`、`CreateFlow`、`IdeaAnalysis`、`CreateResultCard`、`OpsCard`、`CheckoutCard`、`PipelineCard`、`DeployCard`、`DecisionsCard`；`AutopilotTab` 改为「总览 → 执行操作 → 详情分栏」；`Console` 增加 `newproject` 路由与 `focusProjectId`。
- 测试：`test/unit/client-render.test.ts` 新增 TC-RENDER-003（新建项目页默认/创意+解析/已创建三态渲染），导出锚点增 `NewProjectTab`；原 TC-RENDER-001/002 的 useState 快照按新 hook 顺序更新。
- 文档：`OPC-SDD-001` §5.7 增 v2.24 界面结构说明并修订 v2.19/v2.20 的 UI 口径；`OPC-STD-001` §4.34、`OPC-STP-001` §21、`OPC-STR-001` §20 登记本次渲染冒烟与回归结果；`README.md` 页签表更新为 16 个并修正模块/测试计数；`CHANGELOG.md` Unreleased 增 `Changed` 条目；`docs/index.md` 登记本 PA；`pa-index.md` 增行。

## 5. 验证

本次实际执行（仓库根目录）：

```bash
node --check client.js                                  # exit 0
node --test test/unit/client-render.test.ts             # 3/3 pass
npm test                                                # 137/137 pass（单元 45 + 集成 92，2026-11-14 实测）
npm run typecheck                                       # exit 0
npm run spec:check                                      # PASS（92 实体 / 31 用例 / 21 模块）
npm run docs:check                                      # PASS（28 份，不含 docs/过程资产/）
```

渲染树核验（无浏览器，假 React 递归构造元素树）：自动驾驶页出现 `新建项目 / 项目状态总览 / 执行操作 / 执行自动驾驶 / 发布到测试环境 / 检出与扫描 / 待裁决 / 计划路线图 / 执行记录 / 已登记版本库` 与 `ocSplit/ocSplitMain/ocSplitSide/ocFormGrid/ocCheckRow/ocActionRow`；新建项目页出现 `版本库直建 / 创意 / 文档解析 / 版本库直建并自动生产 / 开始自动生产 / 创建后会发生什么 / 填写提示 / 建好之后 / 去自动驾驶查看` 与 `ocSplit/ocFormGrid/ocCheckRow/ocActionRow/ocModeIntro/ocFlow/ocFlowItem/ocFlowNum`；创意模式另验证 `需求.md / 仅解析预览 / AI 解析并创建 / 修订号 / 已创建 / 再建一个`。

未覆盖：真实浏览器视觉验收（本机无 Chromium/前端依赖，沿用「渲染冒烟 + 人工浏览器验收」口径）。

## 6. 回滚

- 代码：`git checkout -- client.js test/unit/client-render.test.ts` 回退到 v2.23 界面（创建卡回到自动驾驶页底部、执行表单回到页底）。无数据迁移，无需清库。
- 文档：按本 PA 的关联清单回退 `OPC-SDD-001`/`OPC-STD-001`/`OPC-STP-001`/`OPC-STR-001`/`README.md`/`CHANGELOG.md`/`docs/index.md`/`pa-index.md` 并在 `pa-index.md` 删除 PA-OPC-033 行（或另起修正 PA，不覆盖历史）。
- 配置：无新增环境变量。

## 自检清单

- [x] 需求与边界已对齐老板原话（新建项目独立界面、当前页操作布局调整）
- [x] 无后端契约/迁移/错误码变化，回滚无需数据操作
- [x] 变更前后测试计数可复算（136→137 = +1 渲染冒烟）
- [x] 渲染冒烟覆盖新页面三种状态与自动驾驶页两条路径
- [x] 文档同步清单与本 PA 关联字段一致
- [x] 未覆盖项（浏览器视觉验收）已显式登记，未假装通过
- [x] 敏感信息（口令）未出现在前端、文档与测试中

## 与其他文档的关系

- 上游：`OPC-SDD-001` §5.7（管理面 BFF 与界面结构）、`OPC-SRS-105` REQ-PRJ-034/035/037（创建、创意转项目、自动驾驶控制台的行为口径）。
- 下游：`OPC-STD-001` §4.34（TC-RENDER-001..003）、`OPC-STP-001` §21（本轮增量测试项）、`OPC-STR-001` §20（执行证据）。
- 同级：`PA-OPC-032`（自动驾驶控制台，本次在其基础上重排布局）、`PA-OPC-029`（创意转项目，本次把其 UI 入口搬到独立页签）。
- 索引：`docs/index.md` §3 与 `docs/过程资产/pa-index.md` 已登记本记录。
