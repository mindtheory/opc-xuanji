# Release Process

This project follows [Semantic Versioning](https://semver.org/) and publishes GitHub Releases from annotated tags.

## Versioning

- `MAJOR`: breaking API/spec/data changes.
- `MINOR`: backwards-compatible features (new employee, new API, new tools).
- `PATCH`: backwards-compatible fixes, docs, or internal changes.

Pre-release versions use `vX.Y.Z-rc.N` and are marked as pre-release on GitHub.

## Release checklist

1. **Freeze scope**: confirm issues/PRs are merged and no pending contract changes.
2. **Update version**:
   - `package.json` `version`.
   - `CHANGELOG.md` move `Unreleased` items into the new version.
   - Add `docs/releases/vX.Y.Z.md`.
3. **Run gates**:
   ```bash
   npm ci
   npm run typecheck
   npm run test:unit
   npm run spec:check
   npm run docs:check
   node scripts/gen-spec.mjs --check
   ```
   With a test database:
   ```bash
   npm run migrate:test
   npm run test:integration
   ```
4. **Commit**:
   ```bash
   git add .
   git commit -m "chore(release): vX.Y.Z"
   ```
5. **Tag**:
   ```bash
   git tag -a vX.Y.Z -m "OPC-玄机 vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```
6. **Create GitHub Release**:
   ```bash
   gh release create vX.Y.Z \
     --title "vX.Y.Z" \
     --notes-file docs/releases/vX.Y.Z.md
   ```
   Mark as pre-release when applicable.
7. **Verify**: check the release page, CI status, and that the tag points to the release commit.

## Gate evidence

Record release evidence in `docs/过程资产/` as a new `PA-OPC-*` entry, including command output, environment, and known limitations. Do not rewrite historical evidence; append a new record.

## Rollback

- Application: deploy the previous tag.
- Database: use additive migrations; do not rewrite history. If a migration is faulty, add a new corrective migration and document the recovery steps.
- Employee package: re-import the previous package version; imports default to disabled, so enable only after verification.
