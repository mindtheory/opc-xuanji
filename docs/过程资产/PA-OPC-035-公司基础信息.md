# PA-OPC-035 公司基础信息（单行档案 + 跨模块共用）

- 变更编号：CR-2026-11-14-14
- 日期：2026-11-14
- 发起人：老板
- 变更类型：新增能力（行政总管·公司基础信息 / 平台设置）
- 关联：`OPC-SRS-103` §3.13、`OPC-SRS-001` §12、`OPC-IRS-001` §7.6（P105/P106）、`OPC-DBDD-001` §3.1.1/§5.2、`OPC-RTM-001`、`OPC-STD-001` §4.36、`OPC-STP-001` §23、`OPC-STR-001` §22、`OPC-SDD-001` §5.7、`spec/opc-xuanji/usecases.yaml`（UC-033）、`migrations/0017_company_profile.sql`、`src/domains/admin/service.ts`、`src/api/http.ts`、`src/platform/views.ts`、`src/domains/project/autopilot.ts`、`client.js`、`test/integration/company-profile.test.ts`

## 1. 原始需求

老板要求：**设置中增加公司的基础信息，收集公司全面的基础信息，包括项目等其他模块共用的信息。**

原 `biz.company_profile` 只有名称/主体类型/税种/银行账户/偏好 5 个业务列，没有任何读写 API 与页面；项目交付物、员工只读视图、财税/法务/行政都无法从同一处取公司主体信息。

## 2. 变更内容

- 迁移 `0017_company_profile.sql`：`biz.company_profile` 扩 26 列（不新增表，表数仍 92）——工商（`short_name`/`english_name`/`credit_code`/`legal_person`/`established_date`/`registered_capital`/`company_type`/`industry`/`business_scope`/`employee_count`/`website`）、地址联系（`reg_address`/`office_address`/`postcode`/`phone`/`email`/`contact_name`/`contact_title`）、开票银行（`tax_number`/`invoice_title`/`taxpayer_type`/`bank_name`/`bank_account`/`invoice_note`）、`extra`/`updated_by`；保留既有 `entity_type`/`tax_types`/`bank_accounts`/`owner_preferences`。
- `AdminService.companyProfile()`：读单行档案 + `sharedDefaults()`（项目/财税/法务/行政共用的默认口径）；`updateCompanyProfile(input)`：逐字段校验 → 单行 upsert → 审计 `company.profile.update`（只记字段名，不记银行账号/税号值）；首次保存自动建单行，`entity_type` 缺省「服务型」。
- 校验口径：`name` 必填 ≤128；`creditCode` 18 位数字/大写字母；`email`/`website`/`postcode` 格式；`entityType ∈ 服务型/贸易型/混合型`；`taxpayerType ∈ general/small/other`；`establishedDate` YYYY-MM-DD；`employeeCount` 0–1,000,000；JSON 字段接受对象或 JSON 字符串；非法 400 `ERR-RES-001`（复用，不新增错误码）；表单整体提交的空串 `entityType` 视为缺省「服务型」（首建落默认值、更新不覆盖原值），避免撞 `entity_type` NOT NULL。
- 新增 2 个 operation（契约 117→119）：`GET /admin/company-profile`（P105，返回 `{profile|null, defaults, updatedAt}`）、`PUT /admin/company-profile`（P106，单行 upsert，返回同 P105）。
- 跨模块共用：
  - 项目：`ProjectAutopilotService.companyDocLine()` 在范围/架构/测试报告/发布记录抬头写「公司：<全称>（统一社会信用代码：<代码>）」。
  - 员工：`view_company_profile` 扩列 `short_name/credit_code/industry/employee_count/website`，SQL 同步；银行账号与联系方式明细**不出视图**。
  - 设置页：新增「公司基础信息」卡（工商/地址联系/开票银行/经营范围 + 只读共用默认口径），保存走 P106，失败显示后端校验信息；必填项「公司全称」标签显示红色星号（`Field` 透传 `required`，取 `--oc-bad`），与后端 `name` 必填校验同口径，其余字段不标星。
- 测试：`company-profile.test.ts` 3 例（读取/校验/保存/审计不落账号、员工视图共用、项目交付物抬头共用；TC-ADM-001 含设置页表单形状空串 `entityType` 回归断言）；`client-render.test.ts` 增 `CompanyProfileCard` 两态渲染与必填星号断言；全量 141→144。

## 3. 关键边界

- **不新增表/不新增错误码**：扩列 + 复用 `ERR-RES-001`；表数仍 92。
- **敏感值不扩散**：银行账号/税号只存库；审计只记字段名；员工视图不出口银行账号与联系方式明细；API 读接口只对管理面开放。
- **单行档案**：`ORDER BY id LIMIT 1` 读写；首次 PUT 自动建行，不做多档案/多主体（一人公司口径）。
- **不伪造**：读取失败返回错误不返回空公司；校验失败不落库；共用默认口径只读，修改走基础资源登记。
- **主体类型沿用既有语义**：`entity_type` 仍为服务型/贸易型/混合型，不引入新的「公司/个人」二分。

## 4. 落地状态

- 迁移：`0017` 已应用业务库与测试库（各 applied 1，表数仍 92）。
- 代码：`src/domains/admin/service.ts`（字段表 + 单行 upsert）、`src/api/http.ts`（P105/P106 路由）、`src/platform/views.ts`（视图扩列）、`src/domains/project/autopilot.ts`（交付物抬头）、`client.js`（设置卡 + `CompanyProfileCard`）、`scripts/gen-spec.mjs`/`spec/opc-xuanji/entities.yaml`（CompanyProfile 扩列后重生成）。
- 文档：SRS-103（REQ-ADM-013）、SRS-001（UC/需求计数）、IRS（P105/P106）、DBDD（3.1.1/5.2）、RTM、STD（4.36）、STP（23）、STR（22）、SDD（5.7）、usecases（UC-033）、README、CHANGELOG、docs/index、pa-index。

## 5. 验证

```bash
npm run migrate && npm run migrate:test   # 0017 各 applied 1
npm run typecheck                         # exit 0
node --test --test-concurrency=1 test/integration/company-profile.test.ts   # 3/3 pass
npm test                                  # 144/144 pass（单元 45 + 集成 99）
npm run spec:check                        # PASS（92 实体 / 33 用例 / 21 模块，119 operation）
npm run docs:check                        # PASS（28 份，不含过程资产）
```

TC 断言：TC-ADM-001 空档案 GET→校验 400→保存→回读→审计 `fields` 含 `bank_account` 且 payload 不含账号值；TC-ADM-002 授权员工 `view_company_profile` 返回扩展字段、无 `bank_account`；TC-ADM-003 项目 `advancePlan` 生成的 `scope.md` 含公司抬头。

未覆盖：真实浏览器视觉验收；财税/法务员工对视图的实际消费（视图授权与读取已在 TC-ADM-002 验证）。

## 6. 回滚

- 代码：回退 `src/domains/admin/service.ts`、`src/api/http.ts`、`src/platform/views.ts`、`src/domains/project/autopilot.ts`、`client.js` 到 v2.25；P105/P106 路由同步下线，契约回到 117。
- 数据：`0017` 只加可空列，回滚代码无需删列；档案行可保留。
- 配置：无新增环境变量。

## 自检清单

- [x] 需求与老板原话一致（设置页公司基础信息、全面字段、跨模块共用）
- [x] 不新增表与错误码；迁移只加列
- [x] 敏感值不进审计正文、不进员工视图
- [x] 单行档案 upsert 幂等；校验失败不落库
- [x] 项目交付物 / 员工视图 / 设置页共用同一份档案
- [x] 测试计数可复算（141→144 = +3）
- [x] 文档同步清单与本 PA 关联字段一致

## 与其他文档的关系

- 上游：`OPC-SRS-103` §3.13（REQ-ADM-013）、`OPC-SRS-001` §12、`OPC-IRS-001` §7.6、`OPC-SDD-001` §5.7。
- 下游：`OPC-STD-001` §4.36、`OPC-STP-001` §23、`OPC-STR-001` §22。
- 同级：`PA-OPC-024`（基础资源配置，默认口径来源）、`PA-OPC-034`（计划自动推进，交付物抬头使用公司信息）。
- 索引：`docs/index.md` §3 与 `docs/过程资产/pa-index.md` 已登记。
