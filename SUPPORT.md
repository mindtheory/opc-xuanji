# Support

## Documentation

- [README](README.md) — setup, architecture, commands, known limitations.
- [Docs index](docs/index.md) — SRS/IRS/SDD/DBDD/STP/STD/STR and process assets.
- [Employee requirements](docs/员工需求/index.md) — 11 per-employee requirement documents.
- [API contract](spec/opc-xuanji/api.yaml) — 34 HTTP operations.
- [Database design](docs/OPC-DBDD-001-数据库设计说明.md) — 54 entities and 5 migrations.
- [Release notes](docs/releases/) — version-specific changes.

## Getting help

- **Bug**: open a Bug Report issue with environment, reproduction, expected/actual, and logs.
- **Feature/requirement**: open a Feature Request issue with the employee line, workflow, and acceptance criteria.
- **Security**: follow [SECURITY.md](SECURITY.md); do not open a public issue.
- **Contract/spec change**: open an issue first; changes follow `spec → docs → code → tests`.

## Before asking

Run the standard checks and include the output:

```bash
npm run typecheck
npm run test:unit
npm run spec:check
npm run docs:check
```

For integration failures, include the migration version, `OPC_TEST_DSN` reachability (without credentials), and the failing test name.

## Scope of support

This repository is a proprietary project. Community support is best-effort through GitHub issues. Production deployment, DSH profile configuration, PostgreSQL operations, and legal/tax/accounting decisions remain the responsibility of the operator.
