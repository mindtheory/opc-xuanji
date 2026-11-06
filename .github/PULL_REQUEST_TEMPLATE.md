## Summary

<!-- What changed and why? Link the issue/requirement. -->

- Related issue/requirement:
- Employee line (if applicable):

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Requirement/spec change
- [ ] Documentation
- [ ] Refactor
- [ ] Security
- [ ] CI/release

## Changes

<!-- Bullet points. Include API/tool/entity/migration changes. -->

## Verification

- [ ] `npm run typecheck`
- [ ] `npm run test:unit`
- [ ] `npm run spec:check`
- [ ] `npm run docs:check`
- [ ] `node scripts/gen-spec.mjs --check`
- [ ] Integration tests (with `OPC_TEST_DSN`)

Evidence/commands:

```bash
# paste output
```

## Documentation alignment

- [ ] `spec/` updated before code (if contract changed)
- [ ] SRS/IRS/SDD/DBDD/STP/STD/STR updated
- [ ] Employee requirement doc updated
- [ ] `docs/过程资产/` change/gate record added
- [ ] `CHANGELOG.md` updated for user-visible changes

## Security and privacy

- [ ] No secrets, credentials, `.env`, or real customer data committed
- [ ] Audit/authorization/token behavior not weakened
- [ ] High-risk writes still require human confirmation
- [ ] Employee package excludes business data/credentials by default

## Rollback / known limitations

<!-- How to revert? What remains unverified? -->
