---
name: dx-debug-regression
description: Diagnose and fix Dx Youxiang application or installer defects from observable evidence, then add focused regression coverage before deployment.
---

# Dx Debug And Regression

Use for reproducible UI, API, JMAP, installer, or operational failures.

## Workflow

1. Reproduce with the smallest non-destructive case and capture browser console/network, application logs, API response, and upstream response while redacting secrets and message bodies.
2. Trace the failing value across browser state, route parsing, SQLite mapping, and Stalwart calls. Do not mask invalid data with defaults before identifying its producer.
3. Check `docs/HISTORICAL_BUGS.md`. Preserve the separation between numeric SQLite mailbox ID and Stalwart `accountId`, and keep all message queries scoped to the selected account's Inbox.
4. Consult upstream documentation/source/issues for protocol or installer behavior. Make the smallest source fix and add a regression test that fails on the root cause.
5. Run lint, typecheck, full tests, build, shell syntax/static tests, and the affected live workflow.

## Acceptance And Failure

Never hot-fix only a server, alter live mail to make a test pass, or relax isolation. Record root cause and user-visible impact in `CHANGELOG.md` or project history. If the failure depends on external state, mark that test pending rather than claiming success.
