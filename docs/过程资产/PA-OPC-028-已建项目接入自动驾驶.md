# PA-OPC-028 已建项目接入自动驾驶与重复执行幂等记录

- 变更编号：CR-2026-11-14-07
- 日期：2026-11-14
- 发起人：老板
- 变更类型：能力增强（项目监理·自动驾驶）
- 关联：`OPC-SRS-105`、`OPC-SRS-001`、`OPC-SDD-001`、`OPC-STD-001`、`OPC-STP-001`、`OPC-STR-001`、`OPC-RTM-001`、`spec/opc-xuanji/usecases.yaml`、`src/domains/project/autopilot.ts`、`client.js`、`test/integration/autopilot.test.ts`

## 1. 原始需求

已建的项目也要能自动生产，可以很方便地加到自动驾驶中。

## 2. 变更内容

- `OPC-SRS-105` 由 33 条需求扩展为 34 条，新增 `REQ-PRJ-034` 已建项目接入自动驾驶与重复执行幂等。
- 后端（`src/domains/project/autopilot.ts`）改为可重复执行：
  - 版本库：同项目同 URL 复用已登记行（不再重复插入），返回 `repository.reused`；
  - 里程碑：仅首次生成（已有里程碑则跳过，计划文档标注 `milestonesReused`）；
  - 测试计划与基线用例：复用已有测试计划，用例按 `case_code` 去重；
  - 测试环境：复用已有 `env_type='test'` 环境；
  - 计划：`stat.project_plan` 按 `(project_id, plan_kind)` 版本递增（原固定 version=1 会在二次执行时撞 UNIQUE 约束）；
  - 裁决：同项目同 `topic` 只登记一次，已裁决事项不再追问。
- 管理面 `client.js`「自动驾驶」页签新增「对已选项目执行自动驾驶」区块：选中已建项目自动预填已登记版本库/档案仓库地址，复用同一组开关（骨架/流水线/测试环境），执行后刷新摘要。
- 新增用例 `UC-029`、测试 `TC-AUTO-008`（已建项目接入）、`TC-AUTO-009`（重复执行幂等）。
- 计数同步：员工需求 156→157；用例 28→29；TC 48→50；测试 115→117。
- 文档同步：`OPC-SRS-105`（§3.34）、`OPC-SRS-001` §12、`OPC-RTM-001`、`OPC-STD-001`（§4.29）、`OPC-STP-001`（§16）、`OPC-STR-001`（§15）、`OPC-SDD-001`、`docs/index.md`、`pa-index`、`CHANGELOG`、`README`。

## 3. 关键边界

- 重复执行只追加计划版本，不覆盖历史计划；磁盘上的骨架分支与流水线运行记录按次保留。
- 版本库复用基于「同项目 + 同 URL」，不会误合并不同仓库。
- 已裁决事项不再重复追问；如需重开，需在裁决队列里人工重新登记。
- 生产发布仍只走人工审批，不因重复执行放行。

## 4. 落地进度

- 迁移：本次无新迁移（复用 0009/0010 表结构）。
- 契约：`npm run spec:check` PASS（89 实体 / 29 用例 / 21 模块）。
- 测试：`autopilot.test.ts` 9/9 pass；全量 `npm test` 全绿（见 `OPC-STR-001` §15）。
- 文档：`npm run docs:check` PASS（28 份文档）。
- 部署：`dsh-web` 重启后生效；页面刷新即可在「自动驾驶」页签对已建项目执行。

## 5. 回滚

- 代码：`git reset --hard <上一提交>` 后重启 `dsh-web`。
- 数据：无 schema 变更；重复执行产生的计划版本、流水线运行记录按需清理。

## 6. 关联

- 上游需求：`OPC-SRS-105` §3.34；`OPC-SRS-001` §12。
- 下游实现：`src/domains/project/autopilot.ts`、`client.js`、`test/integration/autopilot.test.ts`。
