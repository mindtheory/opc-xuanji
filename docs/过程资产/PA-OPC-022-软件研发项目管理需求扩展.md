# PA-OPC-022 软件研发项目管理需求扩展记录

- 变更编号：CR-2026-11-14-01
- 日期：2026-11-14
- 发起人：老板
- 变更类型：员工需求完善
- 关联：`OPC-SRS-105`、`OPC-SRS-001` §9、产品设计 §4.5、`src/employees/catalog.ts`

## 1. 原始需求

按软件开发项目细化项目管理：管理 SVN/Git 等版本库；管理 Maven/Docker 制品仓库；管理项目版本库地址；通过 SSH 管理开发/测试/生产等部署环境；统一管理项目测试并设置专门测试 Agent；完善项目起点、关键节点/里程碑与时间管理。

## 2. 变更内容

- `OPC-SRS-105` 由 15 条需求扩展为 22 条，新增：
  - `REQ-PRJ-016` 软件研发项目档案与项目起点；
  - `REQ-PRJ-017` 版本库管理（Git/SVN）；
  - `REQ-PRJ-018` 制品仓库管理（Maven/Docker）；
  - `REQ-PRJ-019` 部署环境与 SSH 发布；
  - `REQ-PRJ-020` 测试统一管理；
  - `REQ-PRJ-021` 专门测试 Agent 协同；
  - `REQ-PRJ-022` 时间管理、日历与关键节点。
- 扩展员工 manifest：`opc_project` 工具族增加 `repo/artifact/env/release/test` 五族；写目标增加 `work_log`、`code_repository`、`artifact_repository`、`deploy_environment`、`release_order`、`test_plan`、`test_case`、`test_suite`、`test_run`、`test_result`、`defect`；单员工流程增加 `project_release_flow`、`project_test_review`；版本升至 `0.2.0`。
- 测试 Agent 为项目监理下的独立角色卡（经 `dsh-super-agents` 部署），不新增顶层员工分册，员工线仍为 11 份。
- 计数同步：员工需求 130→137，主文档功能需求合计 169→176；`OPC-SRS-001`、`OPC-SQAP-001`、`OPC-RTM-001`、`docs/index.md`、`docs/员工需求/index.md` 已同步。
- `docs/OPC-STD-001` 的 manifest 数量仍为 11，不受影响。

## 3. 关键边界

- 凭据只存 `auth_ref` 引用，禁止明文入库、写日志或随员工包导出。
- SSH 必须校验主机指纹，命令按环境白名单/模板限制；生产发布与回滚必须 human gate，不可逆动作无自动默认。
- 版本库只同步元数据，不在中枢保存代码副本；制品以 digest 为不可变标识，不自动删除。
- 测试 Agent 默认只在 `dev`/`test` 执行；未执行/阻塞不得计为通过；不替老板做发布/验收终审。
- 版本库、制品库、SSH 环境、测试环境不可用时标注“未获取/未执行”，不伪造证据。

## 4. 落地进度

1. ✅ `spec/opc-xuanji/entities.yaml` 已由 `scripts/gen-spec.mjs` 生成 12 个新实体（总数 54→66），并扩展 `Project` 8 列。
2. ✅ `migrations/0006_project_software.sql` 已建 12 张表（biz 9 + ref 3）并扩展 `biz.project`；`test/helpers.ts` 清库清单已同步。
3. ✅ `docs/OPC-DBDD-001` 已补 3.8 节与迁移链，计数 54→66 已同步。
4. ✅ `spec/opc-xuanji/usecases.yaml` 新增 UC-015..021；`api.yaml` 新增 P35–P49、`project` tag 与 `ERR-PRJ-001..003`（operation 34→62，错误码 14→19）。
5. ✅ `src/domains/project/software.ts` 实现登记、查询、发布审批与测试结果写入；`src/api/http.ts` 注册 15 条路由；`ProjectSoftwareService` 注入 `ApiContext`。
6. ✅ `test/integration/project-software.test.ts` 覆盖 TC-PRJ-001..007（需测试库执行）。
7. ⏳ 待落地：测试 Agent 角色卡、Git/SVN 同步执行器、SSH 部署/回滚执行器、制品推送；真实凭据托管方案需老板确认。

## 5. 验证

- 文档级：`OPC-SRS-105` 22 条 AC 完整；SRS/SQAP/RTM/DBDD/索引计数已同步（本增量实体 54→66；同期情报增量后 spec 总数 76）。
- 代码级：`opc_project` manifest 校验通过；`npm run typecheck` 0 错误；`npm run test:unit` 39/39；`npm run spec:check` PASS（76 实体 / 21 用例 / 21 模块；其中 v2.13 情报增量 10 实体见 PA-OPC-023）；`npm run docs:check` PASS。
- 数据库级：`migrations/0001–0006` 顺序可应用；`spec.test.ts` 的实体-列对账与 `project-software.test.ts` 需在测试库复跑。
- 业务实现测试：登记/查询/发布审批/测试结果已落 API；执行器类能力待 Phase 2。
