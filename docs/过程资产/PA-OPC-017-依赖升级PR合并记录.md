# PA-OPC-017 依赖升级 PR 合并记录

- 日期：2026-11-06
- 范围：GitHub Actions 依赖升级（Dependabot）
- 结果：2 个依赖升级 PR 全部合并；CI 全绿；无 open PR

## 1. 合并记录

| PR | 标题 | 结果 | 合并提交 | CI |
| :--- | :--- | :--- | :--- | :--- |
| #1 | `chore(ci): bump actions/checkout from 4 to 7` | MERGED | `320873e` | 全绿（run `42153334851`） |
| #2 | `chore(ci): bump actions/setup-node from 4 to 7` | MERGED | `48b010f` | 全绿（run `42154336104`） |

## 2. 冲突处理

- #1 先合入 `main`，将 `.github/workflows/ci.yml` 与 `release.yml` 的 `actions/checkout` 升至 `v7`。
- #2 因同时修改 workflow 产生冲突；本地 `gh pr checkout 2` → `git merge origin/main` → 将两处冲突统一为 `actions/checkout@v7` + `actions/setup-node@v7` → 提交 `b822423` → 推送后 CI 全绿 → 合并。
- 合并后 `main` 提交：`48b010f`。

## 3. 验证

- PR #1 CI：Node 24.9/24/26 单元与门禁通过；PostgreSQL 17 + pgvector 集成通过。
- PR #2 CI：Node 24.9/24/26 单元与门禁通过；PostgreSQL 17 + pgvector 集成通过。
- 合并后 `.github/workflows/ci.yml` / `release.yml` 均引用 `actions/checkout@v7`、`actions/setup-node@v7`。
- `git status` 干净；无 open PR。

## 4. 后续

- 若后续 Actions 大版本升级引入 breaking change，先在本文件追加新记录，再更新 workflow。
- Dependabot 的 npm 分组更新仍按周检查；合并前必须等 CI 全绿。
