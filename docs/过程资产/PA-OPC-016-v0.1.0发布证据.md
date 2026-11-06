# PA-OPC-016 v0.1.0 发布与 CI 证据

- 日期：2026-11-06
- 版本：`v0.1.0`
- 提交：`ed8eb1f`
- 标签：`v0.1.0`
- GitHub Release：https://github.com/mindtheory/opc-xuanji/releases/tag/v0.1.0
- CI run：https://github.com/mindtheory/opc-xuanji/actions/runs/42153267527

## 1. 发布内容

- DSH Bundle 插件基线、34 个 HTTP operation、31 个 `opc_*` 工具、10 个定时任务、54 个实体、5 条迁移。
- Web 表现层、11 个员工分册（130 条需求）、可插拔 manifest、员工包导入导出。
- 财税/项目监理需求扩展；WBS/外宣员工；全员工需求标准化。
- GitHub 发布治理：CHANGELOG、CONTRIBUTING、CODE_OF_CONDUCT、SECURITY、SUPPORT、LICENSE、Issue/PR 模板、CI/Release workflow、Dependabot、CODEOWNERS。

## 2. CI 结果

| 作业 | 结果 |
| :--- | :--- |
| Unit / typecheck / gates (Node 24.9) | success |
| Unit / typecheck / gates (Node 24) | success |
| Unit / typecheck / gates (Node 26) | success |
| Integration (PostgreSQL 17 + pgvector) | success，`npm test` 68/68 pass |

CI 使用 `pgvector/pgvector:pg17` service，创建 `opc` / `opc_test` 两个库并安装 `vector`、`pgcrypto`、`unaccent`，执行 `0001..0005` 迁移。

## 3. 发布门禁

- `npm run typecheck`：exit 0
- `npm run test:unit`：25/25
- `npm test`（CI）：68/68
- `node scripts/gen-spec.mjs --check`：PASS
- `npm run spec:check`：PASS（54 实体 / 14 用例 / 20 模块）
- `npm run docs:check`：PASS（20 文档）
- `gh release view v0.1.0`：已发布

## 4. 已知限制

- DSH Web 宿主插槽/会话事件/记忆插件契约仍需真实运行时联调。
- 多数员工域的物理表/工具/工作流实现属 Phase 2；当前为需求、manifest 与平台基线。
- 员工包包内流程文件当前为空，签名验签待接入。
- 发布后 Dependabot 会自动创建依赖更新 PR，合并前需走 CI 与评审。
