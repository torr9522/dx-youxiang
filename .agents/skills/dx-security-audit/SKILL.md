---
name: dx-security-audit
description: Audit Dx Youxiang application, host, dependencies, licenses, repository history, and mail authentication/submission boundaries before public release or deployment.
---

# Dx Security Audit

Use for release gates, incident review, or deployment hardening.

## Workflow

1. Read `SECURITY.md`, `docs/ARCHITECTURE.md`, and the release checklist.
2. Run lint, typecheck, tests, build, production and full dependency audits, license audit, SBOM generation, and Gitleaks across all history.
3. Separately scan tracked files and Git objects for real domains, IPs, mailbox addresses, database/mail/backup artifacts, tokens, private-key markers, and deployment secrets; Gitleaks alone is insufficient.
4. Test authentication throttling, secure cookies, CSRF, sanitized HTML, SQL parameterization, IDOR/account binding, attachment ownership, route-number validation, and absence of registration/send endpoints.
5. Verify loopback-only app/JMAP, closed 995, TLS-only 465/587 authentication, no open relay, the per-mailbox permission matrix, sender matching, and Stalwart-only outbound TCP 25.

## Acceptance And Failure

Never paste secret values into reports, use `audit fix --force`, weaken controls to pass a test, or publish with unresolved credentials/history leaks. Classify findings by exploitability and runtime reachability. A release passes only when required audits and environment-identifier scans are clean or an explicit, documented non-runtime exception is justified.
