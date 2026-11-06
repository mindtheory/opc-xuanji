# Security Policy

## Supported versions

| Version | Supported |
| :--- | :--- |
| 0.1.x | Yes |
| < 0.1 | No |

Security fixes are applied to the latest release line. Pre-release or unreleased branches may change without notice.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report privately via GitHub Security Advisories:

1. Open the repository's **Security** tab.
2. Choose **Advisories → Report a vulnerability**.
3. Include: affected version/commit, reproduction steps, impact, and any suggested fix.

If GitHub private reporting is unavailable, contact the repository maintainer privately through GitHub (`@mindtheory`).

## What to include

- Affected component (HTTP API, DSH tool, employee package, migration, docs, CI, etc.).
- Version or commit SHA.
- Minimal reproduction (request, package, SQL, or configuration).
- Expected vs actual behavior.
- Whether sensitive data, credentials, audit integrity, or tenant isolation is affected.

## Response targets

| Severity | Initial response | Target fix |
| :--- | :--- | :--- |
| Critical (RCE, secret exposure, audit tampering) | ≤ 2 business days | ≤ 7 days |
| High (auth bypass, sensitive data exposure) | ≤ 3 business days | ≤ 14 days |
| Medium/Low | ≤ 7 business days | Next release |

These are targets, not guarantees. We will keep the reporter informed of progress.

## Scope

In scope:

- HTTP `/api/v1` contract and DSH tool boundary.
- Employee plugin manifest/install/enable/disable and employee package import/export.
- Audit write path, hash chain, export, and archive.
- View-level authorization, one-time tokens, conflict freezing, and sensitive customer storage.
- Web presentation session/memory bridge, upload ingestion, and dashboard aggregation.
- Migrations and seed/spec generation.

Out of scope:

- Vulnerabilities in third-party dependencies without a project-specific exploit path.
- Misconfiguration of a self-hosted PostgreSQL/DSH environment that the project does not control.
- Social engineering, physical access, or denial-of-service against a deployment without a project-specific defect.
- Reports that require committing real customer data or credentials.

## Security expectations for contributors

- Never commit `.env`, credentials, tokens, customer data, or production logs.
- Do not weaken audit, authorization, token, or tenant-isolation checks to make tests pass.
- Employee packages must not include business data, credentials, or customer sensitive fields by default.
- High-risk employee writes must remain behind human confirmation.
- Use parameterized SQL and the existing service boundaries; do not add direct database access from UI/employee plugins.

## Disclosure

We will coordinate disclosure with the reporter after a fix is available. Please do not publish details before coordination.
