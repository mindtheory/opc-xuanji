# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **信息完善度巡检（v2.30，老板口径：每天检查各项信息完善程度）**：新增默认系统任务 `completeness_check`（每日 09:10），全系统扫描信息完善度——公司基础信息（行业/法人/成立日期/信用代码/注册资本/经营范围/官网/地址/邮箱/规模/税种/银行账户）、公司战略（记忆）、项目档案（简介/技术栈）、情报来源。AI 能补的直接补：缺简介的项目由 AI 起草并自动回填（留审计）、无战略记忆时基于现有记忆+市场情报生成「公司战略草案」记忆提议（老板确认后落库）；补不了的生成提问卡（`stat.project_decision` project_id=0 公司哨兵，同字段待答不重复、每轮限量），老板在「设置 → 信息完善度巡检」回答后自动回填公司基础信息（date/integer 列类型安全规整），也可「稍后提供」；有提问时推微信提醒。新增 `CompletenessService`（`src/domains/admin/completeness.ts`）+ 4 个 `/admin/completeness/*` 端点（overview/settings/inspect/questions-answer）+ 设置页巡检卡（完善度得分/各域明细/待答问题一键回答）；设置存 `completeness.settings`（enabled/autoFill/maxQuestionsPerRun），快照存 `completeness.last_run`；测试新增 `completeness.test.ts` 5 用例 + 渲染冒烟（全量 162→168）。

- **公司情报中心·情况采集（v2.29，老板口径：情报与项目无关）**：情报升为公司对外开放系统——建「情况采集」，从互联网与官方数据源（中国政府网最新政策、国家统计局最新发布、市场监管总局新闻；工信部等可在页面自行添加）采集公开数据，汇总入公司记忆。新增 `CompanyIntelService`（`src/domains/intel/company.ts`）+ 采集适配器（`collectors.ts`：gov 政策 JSON 索引 / 统计局 / 市监 / 通用 RSS / 通用 JSON 列表 / 通用网页列表解析，零依赖、GBK 兜底、增量游标 `checkpoint.seen`）；`biz.intel_item.project_id` 改为可空（NULL=公司级情报，部分唯一索引按 idempotency_key 全局去重）；公司情报空间哨兵行 `project_id=0`；公司记忆新增 `market_intel` 口径（迁移 0019：scope CHECK 扩展 + 采集设置 `intel.collect.settings` + 预置 3 个官方源默认停用）。数据流：来源（启用后每 30 分钟自动采，单源失败留痕不影响其它源）→ 公司情报库 → 每日 08:40 按来源生成 `market_intel` 记忆提议（带来源引用，老板确认后落 `web_memory_card`，同来源同日不重复）。新增 7 个 `/admin/intel/company/*` 端点（settings GET/PUT、summary、items、proposals、collect、memory 手动触发）；管理面「情报管理」默认打开「公司情报」视图（KPI/采集设置/来源健康/待确认记忆一键确认/情报库列表），原项目情报五阶段流水线保留；新增定时任务 `intel_company_collect`（每 30 分钟）/`intel_company_memory`（每日 08:40）；测试新增 `intel-company.test.ts` 5 用例 + 渲染冒烟（全量 156→162）。

- **自动驾驶初始设置 + 裁决备选方案到位（v2.28）**：自动驾驶新增全局初始设置（存 `ref.shared_setting` 键 `autopilot.settings`，页面「自动驾驶设置」卡可改）：`parallelProjects` 并发任务数（一轮定时同时推进几个项目，1–8，默认 2）、`followSchedule` 是否按时间表推进（true=未到计划开工日期的阶段挂起等待、按计划日期完成；false=全速：上一步完成立即做下一步、最快完成，默认 false）、`stepsPerTick` 全速模式每项目每轮最多步数（1–5，默认 3）；仅约束后台自动推进（`project_plan_auto`），老板手动「执行」不受限；越界值收敛到边界。裁决备选方案到位：`/admin/projects/{id}/autopilot` 详情此前漏查 `options` 列导致前端看不到备选方案，现补齐；`DecisionsCard` 渲染每个备选方案（label+impact）并支持一键拍板（点击即提交该方案），保留「自定义裁决」入口。新增 `GET/PUT /admin/autopilot/settings`（错误码复用 ERR-AUTO-001）；spec api.yaml 同步 2 路径；测试新增 TC-AUTO-023/024/025 + 渲染冒烟（全量 151→156）。
- **虚拟销售模块（v2.27，老板拍板全自动化）**：闲鱼虚拟服务自动经营闭环——雷达发现 → AI 素材 → 老板确认上架 → 自动接单 → AI 自动生产交付物 → 老板确认发货 → 平台担保收款记账。新增 `sales` schema 5 表（迁移 0018：`sales.config/lead/product/order/run`）；`SalesService`（品类目录：文案代写/小说故事/策划方案/课程学习资料/软件与服务器部署；线索去重、拍板转商品、商品/订单状态机、AI 素材与交付物生成带规则兜底）；`GoofishRpa`（Playwright 持久化登录：扫码 QR 失效推微信、关键词搜索、发布预填、拉「我卖出的」、平台发货；选择器集中维护）；调度任务 `sales_radar`（每日 09:30）/`sales_orders`（每 30 分钟）/`sales_listing`（每 2 小时），默认停用待老板启用。风控护栏：总开关急停、每日动作上限超限自动急停、上架/发货必须老板确认卡点、不做任何资金操作（收款走平台担保仅记账）、全写审计。管理面新增「虚拟销售」页签（配置卡+急停、线索拍板、商品上架确认、订单生产/发货、运行记录）；HTTP 13 个 `/admin/sales/*` 端点、错误码 ERR-SALES-001/002；spec 同步（实体 92→97、UC-034、api.yaml）；新增 `sales.test.ts` 5 用例（全量 146→151）。注意：闲鱼无开放 API，RPA 违反平台规则存在封号风险——务必使用专用账号，先小流量试运行。

### Changed

- **GET 接口协商缓存（弱 ETag）**：`/api/v1` 全部 GET 成功响应带弱 ETag 与 `cache-control: no-cache`，`If-None-Match` 命中直接返回 304 空体；前端 fetch 默认协商缓存，自动驾驶页运行中 2.5s 轮询在数据未变时不再重复传输（autopilot 列表/详情两类接口占调用量约 42%）。无契约字段变化；`api.test.ts` 新增 ETag/304 回归用例（全量 145→146）。
- **新建项目独立页面 + 自动驾驶操作区重排（v2.24）**：管理面把「新建项目」从自动驾驶页底部拆出为独立页签「新建项目」（左栏「经营」组，`newproject`，`plus` 图标），页内用分段控件在「版本库直建 / 创意·文档解析」间切换：左侧表单按「版本库信息 → 选项 → 动作」分段，右侧固定「创建后会发生什么 / 填写提示 / 建好之后」；创建成功后原地显示结果卡（检出/骨架/流水线/发布摘要、AI 解析结果），可一键「去自动驾驶查看」并自动选中新项目（`focusProjectId`）。自动驾驶页相应重排：页头与项目总览各加「新建项目」入口；写操作集中为一张「执行操作」卡（版本库类型/地址/分支/修订号/凭据/健康检查 + 骨架/流水线/测试环境开关 + 执行/发布按钮），不再与创建表单混排；详情与动作分栏——左栏项目信息/当前执行/计划路线图/执行记录，右栏待裁决/检出与扫描/测试流水线/测试环境发布（右栏 sticky，≤860px 收为单列）。无接口、表结构与错误码变化；`client.js` 渲染冒烟新增「新建项目独立页」用例（3/3），全量 137/137。

### Fixed

- **新建 git 项目对 GitHub 私有仓库检出失败（502 ERR-AUTO-002）**：`git clone` 在无 TTY 环境下遇到私有仓库时报 `could not read Username for 'https://github.com': terminal prompts disabled`，新建项目接口整体 502。现在 Git 检出未显式传 `authRef` 且地址为 GitHub 时，自动回退使用服务自带的运维 token（`OPC_GITHUB_TOKEN`，经一次性 askpass 脚本注入，不落 argv/日志）；显式 `authRef` 优先级不变。
- **裁决项「测试环境发布未配置执行命令」无解决方案**：`deploy_executor` 裁决此前只给「人工接手/放宽限制重试」两个空泛选项，老板拍板后自动推进仍会再次阻塞。现在裁决选项给出可执行方案：①内置执行器（推荐，rsync 工作副本到测试服务器 `~/opc-deploy/project-<id>/v-<版本>/`，仓库含 `opc-deploy.sh` 时自动执行并注入 `OPC_DEPLOY_DIR/OPC_DEPLOY_VERSION`，远程走 SSH、口令经 askpass 引用）；②配置 `OPC_TEST_DEPLOY_CMD`；③人工发布。老板裁决「内置执行器」后下一轮自动推进即自动发布并继续计划；远程目标路径用相对路径（ssh 登录后 cwd 即主目录，`'~/x'` 不会被远端 shell 展开导致 rsync mkdir 失败 exit 11）；测试新增 TC-AUTO-020 回归（`autopilot.test.ts` 19→20）。
- **公司信息首次保存报 `entity_type` NOT NULL 违反**：设置页表单会把未填字段以空字符串整体提交（含 `entityType:""`），后端把空串当 `null` 写入 NOT NULL 的 `entity_type`，首建与保存返回 500。现在空串 `entityType` 视为缺省：首建落「服务型」、更新保持原值；设置页无档案时也给主体类型真实默认值；`company-profile.test.ts` TC-ADM-001 增表单形状回归断言（用例数不变，全量 144/144）。

- **自动驾驶页白屏（v2.23 回归）**：`client.js` 新增展示兜底函数 `textOf`。此前自动驾驶页签的 `ProjectInfoCard`/`RoadmapCard` 等组件引用了未定义的 `textOf`，进入页签即抛 `ReferenceError`，导致整块主面板白屏；已用假 React 渲染器复现（`textOf is not defined`）并在修复后逐一渲染项目总览/详情/当前执行/路线图/执行记录与已加载/已归档两种页面状态验证通过。

- **SVN 项目误用 Git 默认分支 `main` 导致检出失败**：管理面「版本库类型」从 Git 切到 SVN 时，表单保留 Git 默认分支 `main`，SVN 检出地址被拼成 `<仓库>/main`，报 `svn: E170000: URL ... doesn't exist`。现在切到 SVN 时清空 `main`/`master`（留空=仓库根目录，只有 trunk/branches/x 才需要填），已登记仓库预填时同样忽略这两个 Git 习惯值；`client.js` 渲染冒烟 2/2，全量 136/136 通过。
### Added

- **公司基础信息（v2.26）**：设置页新增「公司基础信息」卡，维护公司唯一主体档案：工商（全称/主体类型/简称/英文名/统一社会信用代码/法人/成立日期/注册资本/公司类型/行业/员工规模/官网）、地址联系（注册/办公地址/邮编/电话/邮箱/联系人/职务）、开票银行（税号/抬头/纳税人类型/开户行/账号/备注）、经营范围；`biz.company_profile` 扩 26 列（迁移 `0017`，表数仍 92、无新表），单行 upsert，逐字段校验（名称必填、信用代码 18 位、邮箱/官网/邮编格式、主体类型 服务型/贸易型/混合型），参数非法 400 `ERR-RES-001`（复用、无新错误码），审计 `company.profile.update` 只记字段名、不记银行账号/税号值。新增 `GET/PUT /admin/company-profile`（P105/P106，契约 117→119），返回档案 + 公司默认口径（defaultOs/defaultRemoteMethod/defaultAccount/defaultSshPort/默认资源）；跨模块共用：项目自动驾驶交付物（范围/架构/测试报告/发布记录）抬头带公司名与信用代码，`view_company_profile` 扩展 `short_name/credit_code/industry/employee_count/website` 供员工只读（不出口银行账号与联系方式明细）；`client.js` 设置页新增公司信息表单（工商/地址联系/开票银行/经营范围/共用默认值只读）与 `CompanyProfileCard` 渲染冒烟（必填项「公司全称」标签带红色星号，口径同后端 `name` 必填校验）；测试新增 `company-profile.test.ts` 3 例（全量 141→144）；文档同步 SRS-103/SRS-001、IRS、DBDD、RTM、STD、STP、STR、SDD、spec/usecases、README、docs/index + `PA-OPC-035`。

- **计划自动推进（v2.25）**：新增定时任务 `project_plan_auto`（默认 `*/15 * * * *`、Asia/Shanghai、启用），每次 tick 只推进一个项目的一个单元：按开发计划（`freeze`/`design`/`build`/`verify`/`release`）在检出目录补齐 `docs/autopilot/{scope,architecture,build,test-report,release}.md`，交付物存在即完成、可断点续跑。`build` 与流水线失败修复经 dsh-super-agents 在检出目录 upsert「OPC 项目开发·<projectId>」角色卡（cwd=工作副本）并派活，runId 存入 `stat.project_autopilot_run.steps[].data` 跨 tick 回收（超时 `OPC_AUTOPILOT_AGENT_TIMEOUT_MS` 默认 15 分钟，超时取消）；`verify` 只跑仓库既有 lint/build/test（300s/步、默认不装依赖），`release` 发布测试环境后写发布记录并生成 `production_release` 裁决，生产发布永不自动执行。交付物齐备即完成：`planExecution.completed=true`、5 个里程碑 `achieved`、`biz.project.progress=100`，Git 提交本地分支（不推远端）、SVN 只留工作副本；编码 agent/流水线/部署/生产发布阻塞分别转 `coding_agent`/`pipeline_failed`/`deploy_executor`/`deploy_failed`/`production_release` 裁决；流水线失败保留 stderr 摘要，命中环境缺口（缺少 `OPC_TEST_DSN`/数据库认证失败）转 `pipeline_env` 裁决、不再派修复 agent；计划推进的阻塞按新事件处理（`allowRepeat`），每次新起 pending 裁决，不复用历史已裁决同 topic。迁移 `0016_plan_execution.sql` 仅把 `stat.project_autopilot_run.trigger` 扩为 `manual|idea|api|plan`（表数仍 92、不新增表/列/operation）。`summary` 增 `planExecution{id,status,startedAt,endedAt,completed,blocked,blockTopic,nextTask,percent,tasks}`；`client.js` 自动驾驶页右栏新增「计划自动推进」卡（进度条 + 五任务状态 + 阻塞提示，无手动按钮）；`SuperAgentsBridge` 增 `cancelRun`，`SuperAgentService` 增编码 agent 四方法；测试新增 TC-AUTO-017..019 与调度任务用例（全量 137→141，`autopilot.test.ts` 16→19）；文档同步 SRS-105/001、IRS、DBDD、RTM、STD、STP、STR、SDD、spec/usecases、README、docs/index + `PA-OPC-034`。

- **自动驾驶控制台（v2.23）**：`OPC-SRS-105` 新增 REQ-PRJ-037（自动驾驶控制台：项目状态/当前执行/执行记录/计划路线图/归档）、REQ-PRJ-038（项目描述从版本库抽取，人工优先）、REQ-PRJ-039（基于项目内容的计划生成），项目监理需求 36→39；新增迁移 `0015_autopilot_console.sql`：`biz.project` 增 `description text`/`archived_at timestamptz`/`archive_reason varchar(200)`（16→19 列），新增 `stat.project_autopilot_run`（13 列，`trigger` CHECK manual/idea/api、`status` CHECK running/ok/failed、`steps` jsonb）与 `project_autopilot_run_project_idx(project_id,id DESC)`、`project_autopilot_run_running_idx(project_id) WHERE status='running'`（表数 91→92、实体 91→92）；每次 `bootstrap` 追加一行执行记录、10 阶段 `steps` 留痕（成功 `status=ok,stage=done`，失败保留失败阶段与 `error`，未执行记 `skipped`），同项目已有 running 时返回 409 `ERR-AUTO-001`；summary 增 `status`/`statusLabel`（6 态，优先级 archived > running > failed > waiting_decision > ready > not_started：失败比待裁决更紧急，故 failed 先于 waiting_decision）、`description`/`descriptionSource`、`currentRun`、`runs`（≤10 最新在前）、`roadmap`（阶段优先、里程碑兜底）与带 `content` 的三份计划；描述只读检出目录按 README 首段抽取（去徽章/图片/代码块/链接，≤200 字），无描述回退 `package.json`/`pom.xml`/`pyproject.toml`/`Cargo.toml`/`setup.py`，且只填空描述、人工编辑不覆盖；dev/test/deploy 计划 `content` 按模块/测试/CI/Docker/构建脚本生成，缺内容降级写 `assumptions`/`risks`，三份计划仍 draft；新增 3 个 operation（P102 listAutopilotProjects、P103 archiveProject、P104 unarchiveProject，契约 114→117），归档/恢复只改标记不删检出/计划/执行记录/裁决并写审计 `project.autopilot.archive`/`project.autopilot.unarchive`，`PUT /admin/projects/{id}` 接受 `description`，无新增错误码；管理面「自动驾驶」页签展示状态、当前执行、执行记录、计划路线图与项目描述，支持归档/恢复与 `archived=active|archived|all` 过滤；测试新增 TC-AUTO-012..016（`autopilot.test.ts` 11→16）与 `client-render.test.ts` 渲染冒烟 2 例（防自动驾驶页白屏回归），全量 129→136，本轮实测 136/136；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/spec/index + `PA-OPC-032`。
- **SVN 版本库支持（v2.22）**：`OPC-SRS-105` 新增 REQ-PRJ-036（SVN 版本库检出，公司主用版本库）；自动驾驶 `repository` 入参增加 `kind?:'git'|'svn'`、`revision?`，工具 `opc_project_bootstrap` 增加平铺参数 `repositoryKind`/`revision`，`kind` 显式优先、`svn://`/`svn+ssh://` 推断 svn、其余默认 git；新增迁移 `0014_autopilot_svn.sql`，`ref.project_checkout` 增 `vcs_kind varchar(8) NOT NULL DEFAULT 'git'`（CHECK git/svn）与 `revision varchar(32)`（表数仍 91，该表列数 13→15）；SVN 检出走 CLI（subversion ≥1.10），`branch` 为主干/分支路径、`revision`=HEAD|数字|r数字，密码经 stdin、凭据仅 `env:` 引用，未填 `authRef` 时只对 `OPC_SVN_TRUSTED_HOSTS` 白名单主机自动使用服务环境 `OPC_SVN_PASSWORD`（白名单外主机不送口令），SVN URL 允许空格与中文；svn 客户端缺失返回 502 `ERR-AUTO-002` 并登记 `topic=svn_client` 裁决；扫描跳过 `.svn`/`.hg`，`software_profile` 增加 `vcs`/`revision`；SVN 骨架只落工作副本（`status=generated`、不建分支不提交、无 `scaffold_review` 裁决），测试环境发布版本号=`coalesce(commit_sha, revision)`，响应增加 `repository.kind` 与 `checkout.vcs`/`revision`；测试新增 TC-AUTO-010/011（`autopilot.test.ts` 9→11，全量 127→129）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-031`。
- **微信推送（v2.21）**：检查 `dsh-channel-wechat`（未安装、且设计上不支持主动推送）后，改用已安装的 dsh-im（BotHarness）主动投递端点；新增 `stat.wechat_push`（表 90→91）与 `src/notify/wechat.ts`：裁决与每日简报自动入队并推微信，失败 2s→300s 退避 5 次，未绑定只排队不丢；裁决创建与晨报生成自动挂钩；新增任务 `wechat_push`（每分钟）、工具 `opc_wechat_status/push`（40→42）、4 个 operation（P98–P101，110→114）与错误码 `ERR-WECHAT-001`（35 个）；老板绑定微信后可直接在微信里对话使用全部 `opc_*` 工具；测试新增 `wechat.test.ts` 5 例（全量 127/127）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-030`。
- **创意转项目（v2.20）**：`OPC-SRS-105` 新增 REQ-PRJ-035；新增 `stat.project_idea`（实体 89→90）与 `src/domains/project/idea.ts`、`src/platform/documents.ts`；支持创意文本或文档上传（txt/md/csv/json/yml/docx/xlsx/pdf，多文件，单文件≤10MB/总量≤20MB），docx/xlsx 用内置 zlib 解析 OOXML、PDF 走文本层提取，不新增依赖；AI 解析出项目名/类型/范围/目标/风险/待确认问题/工期（AI 不可用降级规则），自动建项目并绑定默认资源；有仓库进自动驾驶，无仓库转 `repository` 裁决；新增 3 个 operation（P95–P97，契约 107→110）、2 个错误码 `ERR-IDEA-001/002`（34 个）与工具 `opc_project_from_idea`（39→40）；管理面「自动驾驶」页签新增「从创意新建项目」卡片（多文件上传、解析预览）；测试新增 `idea.test.ts` 5 例（全量 122/122）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-029`。
- **已建项目接入自动驾驶（v2.19）**：`OPC-SRS-105` 新增 REQ-PRJ-034；`POST /admin/projects/{projectId}/autopilot` 对已有项目可用，重复执行复用同 URL 版本库与测试环境、里程碑/测试用例/裁决去重、计划按 `(project_id, plan_kind)` 版本递增（修复二次执行撞 UNIQUE）；管理面「自动驾驶」页签新增「对已选项目执行」区块并自动预填已登记仓库；测试新增 TC-AUTO-008/009（autopilot.test.ts 9/9，全量 117/117）；文档同步 SRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-028`。
- **运维反馈闭环（v2.18）**：`OPC-SRS-001` §8.5 新增 REQ-OPS-001..003（运行错误自动开 Issue、用量遥测与使用习惯审视、反馈投递治理）；新增 `migrations/0011_ops_feedback.sql`（3 张表，实体 86→89）与 `src/ops/feedback.ts`；HTTP 入口自动记录动作/状态/耗时（不记请求体），5xx 按指纹去重后自动开 GitHub Issue（单轮5/单日20、正文脱敏、未配置 token 只攒草稿）；规则审视 + 可选 AI（OpenAI 兼容，只发聚合统计）产出 [体验]/[需求]/[流程] Issue 草稿；新增定时任务 `issue_autofile`/`usage_insight` 与工具 `opc_ops_usage_summary`/`opc_ops_issues_sync`（37→39）；新增 4 个管理面 operation（P91–P94，契约 103→107）与错误码 ERR-OPS-001/002（32 个）；测试新增 `ops.test.ts` 5 例（GitHub 本地 mock、AI 规则路径）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-027`。
- **自动化生产（v2.17）**：`OPC-SRS-105` 新增 REQ-PRJ-031..033（自动生成代码骨架、自动跑测试流水线、自动发布测试环境）；新增 `migrations/0010_autopilot_production.sql`（3 张表，实体 83→86）；`ProjectAutopilotService` 增加 `generateScaffold`（只补缺失文件、提交本地分支不推远端）、`runPipeline`（lint/build/test，300s 超时、最小环境、默认不装依赖）、`deployTestEnvironment`（建测试环境发布单、执行 `OPC_TEST_DEPLOY_CMD` 并健康检查、无命令转裁决）；新增 operation `deployProjectTest`（P90，契约 102→103）与错误码 `ERR-AUTO-005`（30 个）；新增 `scaffold_review`/`pipeline_failed`/`deploy_executor`/`deploy_failed` 裁决项；管理面新增「自动驾驶」页签（12→13）：填版本库一键自动生产、查看检出/扫描/计划/流水线/发布、就地裁决；克隆默认目录改为 `~/.opc-workspaces`（可用 `OPC_WORKSPACE_ROOT` 覆盖），避免 `/tmp` 小分区被撑满；测试新增 TC-AUTO-005..007（autopilot.test.ts 7/7）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-026`。
- **项目自动驾驶（v2.16）**：`OPC-SRS-105` 新增 REQ-PRJ-027..030（建项目自动检出、静态扫描与档案回填、自动生成开发/测试/部署计划、裁决队列与人工放行）；新增 `src/domains/project/autopilot.ts` 与 `migrations/0009_project_autopilot.sql`（4 张表，实体 79→83）；建项目支持 `repository:{url,branch?,authRef?}`，浅克隆后只读扫描并回填 `tech_stack/software_profile`，自动生成 5 个里程碑、测试计划草案 + 3 条基线用例、部署计划（复用公司默认测试服务器）；新增 5 个 HTTP operation（P85–P89，契约 97→102）、4 个错误码 `ERR-AUTO-001..004` 与工具 `opc_project_bootstrap`（36→37）；仅「无 LICENSE / 无测试 / 无 CI / 无生产服务器 / 技术栈歧义」等需老板拍板事项进入 `stat.project_decision` 等待裁决，未裁决不放行生产；新增集成测试 `test/integration/autopilot.test.ts`（TC-AUTO-001..004，本地 git 夹具）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-025`。
- **公司基础资源配置（v2.15）**：`OPC-SRS-105` 新增 REQ-PRJ-023..026（公司基础资源目录六类、远程管理方式与公司默认口径、新建项目默认选型、项目绑定与追溯）；新增 `migrations/0008_shared_resources.sql`（3 张表：`ref.shared_resource`/`ref.shared_setting`/`ref.project_shared_resource`，实体 76→79）；`AdminService` 新增 8 个共享资源方法与 8 个 HTTP operation（P77–P84，契约 89→97）、4 个错误码 `ERR-RES-001..004`；新建项目默认按 `is_default + active` 选型绑定，`resourceIds` 可显式覆盖；公司默认 Debian + SSH、默认账号 `canetwork`，口令只以 `env:OPC_DEFAULT_SSH_PASSWORD` 引用登记；新增集成测试 `test/integration/admin-shared.test.ts`（TC-RES-001..005）；文档同步 SRS/DBDD/IRS/RTM/STD/STP/STR/SDD/index + `PA-OPC-024`。
- **项目管理与情报管理 Web 面**：新增 `/api/v1/admin/*` 管理面 27 个 operation 与「项目管理」「情报管理」两个页签；项目侧覆盖里程碑/版本库/制品库/环境/发布/测试计划/用例/套件/批次/缺陷/工时 CRUD 与发布审批；情报侧覆盖情报空间/数据源/绑定/主题/标签 CRUD、条目状态处理、日报详情与五阶段流水线手动触发；驾驶舱新增项目研发与情报指标。
- `client.js` 新增可复用管理组件（项目选择、KPI、分割视图、通用 CRUD 表单、状态徽标、详情面板）与 27 条管理面路由的前端接线。

- **软件研发项目管理**：`OPC-SRS-105` 新增 REQ-PRJ-016..022（项目起点与软件研发档案、Git/SVN 版本库、Maven/Docker 制品库、开发/测试/生产 SSH 部署环境、发布单与人工审批、测试计划/用例/批次/结果与缺陷、测试 Agent 协同、里程碑与时间管理）；新增 `src/domains/project/software.ts` 与 15 个 HTTP operation（`/api/v1/projects/*`、`/api/v1/releases/*`、`/api/v1/test-runs*`）；新增 12 张表（`0006_project_software.sql`，实体 54→66）；凭据仅接受 `env:/secret:/vault:/ssh-agent:` 引用，生产强制人工审批；`opc_project` manifest 升至 `0.2.0` 并扩展工具/写目标/流程。
- `docs/过程资产/PA-OPC-022-软件研发项目管理需求扩展.md`: change record, boundaries, landing status, and verification.

- **情报日报与数据源管理（v2.13）**：`OPC-SRS-106` 新增 REQ-INT-011..018（项目情报空间、数据源健康、项目关键词/标签、定时采集、分析与去重评分、日报汇总、推送送达、五阶段流水线）；新增 `src/domains/intel/daily.ts` 本地规则流水线与 5 个定时任务（`intel_source_collect/analyze/aggregate/brief/push`）；新增 10 张表（`0007_intel_daily.sql`，实体 66→76）；`opc_intel` manifest 升至 `0.2.0` 并扩展工具/写目标/`intel_daily_pipeline`。
- `docs/过程资产/PA-OPC-023-情报日报与数据源管理需求细化.md`: change record, boundaries, landing status, and verification.

- **Hindsight 记忆导入与同步**：`src/memory/hindsight.ts`（Hindsight API 桥：health/stats/list/import，超时与 `ERR-HINDSIGHT-001` 归一）+ `src/memory/sync.ts`（导入、推送 OPC 记忆卡→Hindsight、拉取 Hindsight→OPC 记忆提案、双向同步，全部写审计）；OPC 记忆卡以 `document_id=opc-memory-<id>` 幂等写入，敏感卡永不推送，拉取方向生成 pending 提案并自动去重。HTTP 契约 +4 operation（`/api/v1/memory/hindsight*`，共 47）；面板新增「记忆同步」页签（状态条、JSON/文本导入、推送/拉取/双向、远端记忆列表）。配置 `hindsightUrl`/`hindsightBank`（env `OPC_HINDSIGHT_URL`/`OPC_HINDSIGHT_BANK`；内网实测服务 `http://192.168.1.12:8888`，bank 与 dsh-hindsight-memory 插件一致 `coding-agent::workspace`）。
- `docs/过程资产/PA-OPC-021-Hindsight记忆导入与同步.md`: change record with ADRs and verification.

- **OPC驾驶舱升级为全功能 Web 控制台**（11 个模块页签：驾驶舱/员工/业务域/流程/任务/审计/冲突/收件箱/记忆/雷达/设置）：员工矩阵可见 11 个员工并支持安装、启用停用、部署角色卡、派活、员工包导出导入；流程可见注册版本/实例并支持注册、启动实例、完成节点、Verifier 评判；任务可立即执行与启停；审计可过滤与导出；冲突可裁决；收件箱可确认归置；记忆可检索与提案；设置页含智能体健康与全局暂停。
- 服务端契约 +5 operation：`listWorkflows`、`listWorkflowInstances`、`getWorkflowInstance`、`agentRuns`、`listConflicts`；`GET /api/v1/employees` 响应增加 `catalog`（11 个员工 manifest）。
- `apply` 增注册 `/api/v1` **前缀路由**（DSH webServer 最长前缀匹配），动态路径在浏览器端可达。

- **Web 界面「OPC驾驶舱」**：浏览器半 `client.js` 通过 DSH Client 插件机制注册左栏入口（`sidebar.panellist`，order 27）与主面板（`main`），展示健康条（PG/pgvector/调度/员工智能体）、范围快照指标（今日/7天/30天/90天 + 冻结脚注 + as-of）、待归置、定时任务与雷达；数据只读、30 秒自动刷新。`package.json` 增 `exports./client` 与 `dsh.client`；manifest 标题统一为「OPC驾驶舱」、`panel=left`（取代 PA-OPC-010 的「OPC公司管理/右栏」口径，历史记录保留）。
- `docs/过程资产/PA-OPC-019-Web驾驶舱界面.md`: change record for the cockpit panel (ADR, verification, rollback).

- **Super Agent application layer (OPC-SDD-003)**: opc-xuanji now builds on [dsh-super-agents](https://github.com/mindtheory/dsh-super-agents) as the application layer — `src/agents/bridge.ts` (loopback HTTP bridge with timeout/degradation/idempotent upsert) and `src/agents/service.ts` (deploy employees as persona cards, dispatch cognitive tasks and collect artifacts, health aggregation, global pause); 5 new tools (`opc_agent_deploy/dispatch/result/health/pause`, 36 total) and 4 new HTTP operations (`/api/v1/agents/*`, 38 total); `/api/v1/health` and `opc_health` gain an `agents` section plus `degraded` flag; new error code `ERR-AGENT-001`; soft dependency — without dsh-super-agents the agent tools degrade gracefully and everything else keeps working.
- `docs/OPC-SDD-003-SuperAgent应用层设计.md`: application-layer positioning, concept mapping (employee→persona card, cognitive task→Run), bridge contract, dual-track scheduling, health/pause/degradation, acceptance scenarios, and rejected alternatives.
- `AGENTS.md`: main-session agent operating charter (five proactives, reporting rhythm, decision-card rules, boundary and compliance).
- `OPC-SDD-002`: main-session agent persona, work loop, discovery, planning, execution, reporting, decision cards, metrics, and AC-AGT-01..10.
- `OPC-SDP-001`: software development plan with roles, WBS, G0–G6 gates, milestones, resources, and change control.
- `OPC-SCMP-001`: configuration management plan with configuration items, baselines, change control, backup, and audit.
- `OPC-SQAP-001`: software quality assurance plan with quality goals, reviews, metrics, and nonconformance handling.
- `OPC-RMP-001`: risk management plan with 18 registered risks, scoring, mitigations, and fallbacks.
- `OPC-RTM-001`: requirements traceability matrix from REQ/UC/TC to code and tests.
- `OPC-SVD-001`: v0.1.0 software version description, installation, compatibility, evidence, and known limitations.
- `PA-OPC-018`: change record for the main-session agent and management documentation additions.

### Fixed

- 项目监理（SRS-105）集成测试修复：`date` 列按 `YYYY-MM-DD` 字符串返回（此前经 `Date` 序列化为 ISO 时间戳）；`jsonb` 列参数显式 `JSON.stringify`（此前进 PG 数组字面量导致 `22P02`）；`test_run` 状态更新改用 `$2::varchar`（此前 PG 无法推导参数类型，`42P08`）。
- 集成断言同步默认定时任务数 10→15（新增 5 个 `intel_*` 任务）。

### Changed

- Bumped GitHub Actions dependencies: `actions/checkout@v7`, `actions/setup-node@v7`.
- `docs/index.md`: registered the new design, management, traceability, and version documents; added SDP/RMP to the document type list.

### Planned

- Real DSH Web host adapter (native slot / sandbox iframe / postMessage bridge) end-to-end verification.
- Domain implementations for the 11 employee lines (finance, legal, admin, strategy, project, intel, crm, vehicle, inventory, WBS, publicity).
- Gantt chart UI, critical-path/EVM calculations, and OKR roll-up for project supervision.
- Employee package signing/verification and real package file export.

## [0.1.0] - 2026-11-06

### Added

- DSH Bundle plugin scaffold (`opc-xuanji`) with `cordis.patch.yml` and 31 registered `opc_*` tools.
- HTTP `/api/v1` contract with 34 operations: platform, workflow, audit, scheduler, web presentation, and employee catalog/package.
- PostgreSQL 17 / pgvector schema with 54 entities and 5 additive migrations (`0001`–`0005`).
- 10 scheduled automation tasks: daily report, tax/contract reminders, invoice backlog, conflict escalation, audit export, monthly archive, dashboard refresh, plugin radar, keyword radar.
- Web presentation layer: sidebar entry, right-side dashboard, session/memory bridge, upload ingestion, inbox/confirmation, radar, and dashboard snapshot.
- Employee requirement set split into 11 standalone documents (`docs/员工需求/OPC-SRS-101..111`) covering 130 requirements.
- Pluggable employee manifests with views, tools, write targets, single-employee workflows, dependencies, install/enable/disable, and dependency protection.
- Employee package import/export (`opc-employee-package` v1) with checksum, dry-run, default-disabled install, rollback, and audit.
- Finance employee expanded to CFO/accounting/tax/business-reporting scope: reimbursement vouchers, chart of accounts, vouchers, three statements, statement audit, internal control, tax filing, business reporting, R&D super deduction, tax planning, analysis, archive.
- Project supervision expanded to full lifecycle: stage gates, charter, scope/WBS link, milestones, task dependencies/resources, Gantt/baseline/critical path, EVM, OKR linkage, risk/change, acceptance, closure, templates/RACI.
- WBS and publicity employees added, with detailed requirements and manifests.
- Project governance docs: SRS/IRS/SDD/DBDD/STP/STD/STR, UML, process assets (`PA-OPC-*`), and documentation/spec gates.
- GitHub release scaffolding: CI, release workflow, issue/PR templates, security policy, contributing guide, code of conduct, and release notes.

### Changed

- Employee requirements moved out of the main SRS into per-employee documents; the main SRS now keeps cross-cutting plugin/package requirements and an index.
- Design docs and specs aligned to v2.12 scope (web layer, employee packaging, 11 employee lines).
- `spec:check` and `docs:check` now run local lightweight gates suitable for GitHub CI; stricter CD-PTC gates remain optional.

### Fixed

- Employee package import rejects path traversal, checksum mismatch, unsafe file types, missing dependencies, and incompatible hub versions.
- Disabling an employee plugin is blocked when another installed plugin depends on it.
- Dashboard and reports keep `as_of`, stale flags, and frozen-conflict footnotes instead of silently filling zeros.

### Security

- No business data or credentials in employee packages by default; package import is dry-run first and installs disabled.
- Employee plugins declare `write_targets`; high-risk writes remain behind human confirmation.
- Sensitive customer fields stay in private storage; cross-domain access uses one-time tokens.
- Audit is append-only through the central `opc_hub.audit.record()` path.

### Known Limitations

- Integration tests run in CI against PostgreSQL 17 + pgvector; a local run still requires `OPC_TEST_DSN` and a reachable test database.
- DSH Web host slot/session-event/memory-plugin contracts still need end-to-end verification against the real DSH runtime.
- Domain tables/tools/workflows for most employee lines are requirements/manifest placeholders; Phase 2 implements them.
- Employee package files are manifest-only today; workflow/config file export and signature verification are planned.
- `spec:check`/`docs:check` are lightweight local gates; the external CD-PTC gates are stricter and remain optional.

[Unreleased]: https://github.com/mindtheory/opc-xuanji/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mindtheory/opc-xuanji/releases/tag/v0.1.0
