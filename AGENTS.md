# AGENTS.md

This is the entry point for Codex and new maintainers of Dx Youxiang.

## Read First

Read `README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_BOUNDARIES.md`, `docs/DEVELOPMENT_HISTORY.md`, and `docs/HANDOVER.md` before changing code. Deployment work also requires `docs/DEPLOYMENT.md`; migration work requires `docs/MIGRATION.md` and `docs/PRODUCTION_DEPLOYMENT.md`.

Project-level Codex skills are in `.agents/skills`. Load the narrow skill matching the task. These skills do not grant permission to mutate production, DNS, GitHub, or live mail.

## Non-Negotiable Invariants

- Mail sending uses Stalwart JMAP EmailSubmission or authenticated SMTP Submission only. Never add a custom MTA, anonymous relay, bulk sending, POP3, or a third-party relay default.
- Every mailbox is a real Stalwart User account. Never replace accounts with aliases, catch-all routing, or a shared Inbox.
- The browser uses only the numeric SQLite mailbox ID. Resolve its stored Stalwart `accountId` on the server for every message, body, flag, delete, and attachment operation.
- Ordinary accounts keep `emailReceive` enabled. `externalLogin` and `emailSend` are independent and disabled by default; effective sending requires both. The same 6-256 character Stalwart credential authenticates webmail, IMAP and SMTP.
- Mailbox-user sessions bind one numeric mailbox ID and immutable account ID. Derive From server-side and use the mailbox user's credential for JMAP submission.
- Do not claim existing IMAP sessions are immediately revoked. Stalwart 1.0.1 only has verified immediate rejection for new authentication.
- Never copy running RocksDB as a backup. Use Stalwart export and prove restore in an isolated store.
- Do not commit domains, IPs, mailboxes, mail, databases, credentials, certificates, backups, or logs from a real deployment.
- Native Debian/systemd only. Do not add Docker, Compose, Podman, or a global Node.js dependency.

## Change Gates

Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, shell syntax checks, ShellCheck, `npm audit --omit=dev`, the license audit, SBOM generation, and history/environment scans before release. Installer changes require a clean Debian 12 remote install from an immutable RC release; server hot fixes are not release evidence.

Stable `v0.1.0` requires clean-install acceptance, inbound external mail, isolation, backup/restore, and reboot tests. DNS cutover is always a separate explicit user authorization.
