# PA-OPC-029 创意转项目（文本/文档 → AI 解析 → 自动建项目 → 自动驾驶）记录

- 变更编号：CR-2026-11-14-08
- 日期：2026-11-14
- 发起人：老板
- 变更类型：新增能力（项目监理·创意转项目）
- 关联：`OPC-SRS-105`、`OPC-SRS-001`、`OPC-DBDD-001`、`OPC-IRS-001`、`OPC-RTM-001`、`OPC-STD-001`、`OPC-STP-001`、`OPC-STR-001`、`OPC-SDD-001`、`spec/opc-xuanji/*`、`migrations/0012_project_idea.sql`、`src/domains/project/idea.ts`、`src/platform/documents.ts`、`client.js`、`test/integration/idea.test.ts`

## 1. 原始需求

增加通过创意新建项目：用户输入创意，经过 AI 解析、完善，自动建立项目，并进入自动驾驶。创意可以是用户输入，或者上传文档，支持 txt、md、docx、excel、pdf 等常用格式，支持多个文档同时上传。

## 2. 变更内容

- `OPC-SRS-105` 新增 `REQ-PRJ-035`（创意转项目），需求总数 34→35。
- 新增迁移 `migrations/0012_project_idea.sql` 与实体 `ProjectIdea`（`stat.project_idea`），表 89→90、实体 89→90。
- 新增 `src/domains/project/idea.ts`（`IdeaService`）：
  - `analyze`：AI 解析创意为项目档案（名称、类型、范围、目标、技术栈提示、风险、待确认问题、工期、置信度）；AI 不可用或失败时**规则兜底**，保证永远可用；
  - `save/list/updateStatus`：原文与解析结果落库留痕。
- 新增 `src/platform/documents.ts`：文档抽取纯文本，**不新增第三方依赖**：
  - txt/md/csv/tsv/json/yml/yaml/log/htm：UTF-8 直读；
  - docx/xlsx：Node 内置 `zlib` 解析 OOXML（word/document.xml、xl/sharedStrings.xml、工作表）；
  - pdf：轻量文本层提取（FlateDecode + Tj/TJ），扫描件/嵌字体失败时返回 `ERR-IDEA-002`，不静默给空；
  - 限额：单文件 10MB、总量 20MB、一次 10 个文件。
- `AdminService` 新增 `analyzeIdea`（预览不建项目）、`createProjectFromIdea`（建项目 → 绑定默认基础资源 → 有仓库串自动驾驶 / 无仓库写 `repository` 裁决）、`listProjectIdeas`。
- 管理面 `client.js`「自动驾驶」页签新增「从创意新建项目」卡片：创意文本 + 多文件上传（base64）+ 可选仓库，支持「仅解析预览」与「AI 解析并创建」，展示解析出的名称/类型/置信度/工期/范围/目标/风险/待裁决问题。
- HTTP +3 operation（P95–P97，契约 107→110）、+2 错误码（`ERR-IDEA-001/002`，共 34 个）、+1 工具 `opc_project_from_idea`（39→40）。
- 计数同步：员工需求 157→158；用例 29→30；TC 50→55；测试 117→122。
- 文档同步：`OPC-SRS-105`（§3.35）、`OPC-SRS-001` §12、`OPC-DBDD-001`（§3.14）、`OPC-IRS-001`、`OPC-RTM-001`、`OPC-STD-001`（§4.30）、`OPC-STP-001`（§17）、`OPC-STR-001`（§16）、`OPC-SDD-001`、`docs/index.md`、`pa-index`、`CHANGELOG`、`README`。

## 3. 关键边界

- **AI 只解析、不臆造**：解析失败/未配置时走规则兜底并在结果里标 `source=rule`；缺信息写入 `openQuestions`，不编造事实。
- **文档安全**：只做文本抽取，不执行宏/脚本；原文不入库，仅存抽取文本（≤4000 字）与解析摘要；不做文件落盘（base64 内存处理）。
- **限额**：单文件 10MB、总量 20MB、一次 10 个；不支持格式 415，解析不出文本 422。
- **自动驾驶门槛**：没有版本库时不假装自动驾驶已启动，项目标 `waiting-repository` 并生成 high 风险 `repository` 裁决。
- **可重复**：同一项目再次执行自动驾驶仍按 v2.19 幂等规则（复用资源、计划版本递增）。

## 4. 落地进度

- 迁移：业务库 `opc` 与测试库 `opc_test` 均已应用 `0012_project_idea.sql`（applied 1 / skipped 11）。
- 契约：`npm run spec:check` PASS（90 实体 / 30 用例 / 21 模块；110 operation / 34 errorCodes）。
- 代码：`npm run typecheck` exit 0；`client.js` 语法检查通过。
- 测试：`idea.test.ts` 5/5 pass（docx/xlsx/pdf 本地夹具、AI 本地 mock）；全量 `npm test` 全绿（见 `OPC-STR-001` §16）。
- 文档：`npm run docs:check` PASS（28 份文档）。
- 部署：`dsh-web` 重启后生效；页面刷新可见「从创意新建项目」。

## 5. 回滚

- 代码：`git reset --hard <上一提交>` 后重启 `dsh-web`。
- 数据：`0012` 只新增 1 张表；回滚代码不读该表，无需删表（删表会丢创意留痕）。
- 配置：AI 与 GitHub 均为可选；不配置 AI 时走规则解析。

## 6. 关联

- 上游需求：`OPC-SRS-105` §3.35；`OPC-SRS-001` §12。
- 下游实现：`migrations/0012_project_idea.sql`、`src/domains/project/idea.ts`、`src/platform/documents.ts`、`src/domains/admin/service.ts`、`src/api/http.ts`、`client.js`、`test/integration/idea.test.ts`。
- 规格：`spec/opc-xuanji/entities.yaml`（90）、`api.yaml`（110）、`usecases.yaml`（30）。
