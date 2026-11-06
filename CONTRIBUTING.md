# Contributing to OPC-玄机

Thanks for considering a contribution. This repository is a DSH Bundle plugin and a specification-driven project; changes must keep **spec → docs → code → tests → process assets** consistent.

## Code of Conduct

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Prerequisites

- Node.js **≥ 24.9** (CI covers 24.9, latest 24, and 26).
- PostgreSQL 17 with the `vector`, `pgcrypto`, and `unaccent` extensions for integration tests.
- A local `.env` copied from `.env.example`; never commit real credentials.

```bash
npm install
cp .env.example .env   # fill OPC_PG_DSN and OPC_TEST_DSN
npm run migrate
npm run migrate:test
```

The test database **must be different** from the business database. `loadConfig` rejects identical DSNs when `NODE_ENV=test`.

## Contribution workflow

1. **Open an issue first** for non-trivial changes (bug, feature, contract change, or spec change).
2. **Update `spec/` first** when requirements/interfaces/entities change.
3. **Update docs** (`docs/OPC-*.md`, `docs/员工需求/`, `docs/index.md`).
4. **Update code** (`src/`) and tests (`test/`).
5. **Update process assets** (`docs/过程资产/`) for gate evidence or change records.
6. Run the checks below and include evidence in the PR.

## Branch and commit conventions

- Branches: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`.
- Commit messages: `[模块] 动词: 说明 (需求/缺陷ID)`
  - Example: `[finance] 新增: 报销凭证与三表审计需求 (REQ-FIN-003/007)`
- Keep commits focused; do not mix unrelated refactors.
- Do not commit `.env`, credentials, `node_modules`, archives, or generated logs.
- Generated `spec/opc-xuanji/entities.yaml` must be regenerated with `npm run gen:spec` after changing `scripts/gen-spec.mjs`.

## Required checks

```bash
npm run typecheck
npm run test:unit
npm run spec:check
npm run docs:check
```

With a reachable test database:

```bash
npm run migrate:test
npm run test:integration
# or the full suite
npm test
```

CI expectations:

- `typecheck` exits 0.
- Unit tests pass on the Node matrix.
- Integration tests pass on the PostgreSQL service job.
- `gen:spec --check`, `spec:check`, and `docs:check` pass.

## Change checklist

- [ ] Issue/requirement ID referenced.
- [ ] `spec/` updated before code (if contract changed).
- [ ] SRS/IRS/SDD/DBDD/STP/STD/STR updated when behavior changes.
- [ ] Employee requirement doc updated when the change belongs to an employee line.
- [ ] Tests added/updated; assertions were not weakened to make a test pass.
- [ ] Audit/security/privacy impact considered.
- [ ] `CHANGELOG.md` updated for user-visible changes.
- [ ] No secrets, real customer data, or credentials committed.
- [ ] Docs use the project format: frontmatter, `## 自检清单`, `## 与其他文档的关系`.

## Pull requests

Use the PR template. A PR is ready when:

- CI is green (or failures are explained and accepted by a maintainer).
- The author has described behavior, tests, and rollback/known limitations.
- A maintainer has reviewed the diff and confirmed doc/spec/code alignment.

## Security

Do **not** open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

This repository is proprietary; see [LICENSE](LICENSE). Contributions are accepted under the repository's proprietary terms unless a separate written agreement exists.
