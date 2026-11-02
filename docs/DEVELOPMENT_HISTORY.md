# Development History

This record is derived from the preserved Git history. It does not invent work that is absent from commits.

## Original Candidate Baseline

- `44475ed` prepared the first `0.1.0` acceptance candidate with the Chinese administrator UI, Stalwart integration and native deployment assets.
- `d6b050f` made the ACME HTTP challenge reachable through Caddy.
- `3a71f8d` corrected shell-safe certificate deploy-hook behavior.
- `34fac23` added backup retention and stable checksum behavior.
- `ae3dd4a` added a Git source bundle to encrypted backups.

## Inbox Defect Series

- `e1c3286` preserved the SQLite mailbox ID when Stalwart Inbox statistics are merged into UI rows. Before this, the Stalwart internal Inbox ID replaced the numeric route ID and produced `NaN` in inbox requests.
- `072da9b` restricted message query/search/pagination to the account's Inbox. Earlier queries included Junk and made totals disagree.
- `08e2ed6` added pagination-state regression coverage, including mailbox changes and stale-request isolation.

## Dx Youxiang Preparation

- `dfb8b3f` renamed the application identity, changed the mailbox password policy to 6-256 characters without composition rules, pinned the development toolchain, removed known dependency advisories and regenerated the SBOM.
- `7993594` added the checksum/attestation-verified native release installer, fresh/Caddy-coexist deployment, private Node runtime, firewall ordering, lifecycle scripts, log rotation and release-asset builder.
- `6919075` added project Skills and the context-free handover knowledge base.
- `a8f89cf` added guarded legacy-data migration, service-credential rotation and Stalwart account reindexing.
- `8275a8c` made the public bootstrap command work on minimal Debian installations without `curl`, `wget` or CA certificates.

## Clean-install Candidate Failures

- `v0.1.0-rc.1` could not start on the newly reinstalled minimal Debian image because the public bootstrap command assumed `curl` already existed. `8275a8c` fixed the bootstrap command and produced `v0.1.0-rc.2`.
- `v0.1.0-rc.2` reached Stalwart setup but its installer wrote `/etc/stalwart/config.json` before the first service start. Stalwart 1.0.1 enters bootstrap mode only when this registry file is absent, so `x:Bootstrap/set` correctly returned `This operation is only allowed in bootstrap mode`. The next candidate removes the premature file creation, refuses to overwrite an existing registry, and adds a regression test for the documented startup order.
- `v0.1.0-rc.3` confirmed that Stalwart bootstrap completed, then failed because it ran `seed-domain.mjs` before the application had created the SQLite schema. The next candidate starts the application, waits for `/healthz` to confirm its canonical `AppDatabase` migration completed, and only then seeds the default domain. This avoids a duplicate schema implementation in the installer.
- `v0.1.0-rc.4` completed a clean installation and trusted certificate issuance. Its first protected legacy migration then failed before any data swap: the archive-path AWK expression had invalid syntax, and Stalwart could not traverse the root-only temporary directory containing its import configuration. The candidate instance was restarted and passed every health check. The next candidate uses a tested AWK policy file, a dedicated root/Stalwart import directory separate from extracted secrets, and automatic service/data rollback on migration failure.
- `v0.1.0-rc.5` completed a clean installation, but its protected migration exposed a second traversal boundary before any data swap: although the generated import configuration was readable, Stalwart was still asked to read the export directly from the root-private restored-backup directory. The next candidate copies the export into the dedicated Stalwart-only import area, imports that staged copy, and removes incomplete candidate stores on failure.
- `v0.1.0-rc.6` completed a clean installation and imported all 23 Stalwart subspaces from a restored export whose numeric owner mapped to another system account. The post-swap check then ran before the Node process had opened its listener, so the safety trap rolled the candidate instance back and restored all seven health checks. The next candidate waits for `/healthz` with a fixed timeout before applying the full readiness gate.
- `v0.1.0-rc.8` reached production ACME after automatically installing and starting every core component, but Let's Encrypt rejected the sixth certificate for the same exact identifier set during its seven-day window. This exposed two installer defects independent of the external limit: operational timers were enabled after the certificate command, and readiness accepted the self-signed bootstrap certificate based only on lifetime. The next candidate enables timers before ACME, adds bounded initial-issuance retry, and requires a non-self-issued hostname-matching certificate for readiness.
- `v0.1.0-rc.9` completed a remote clean installation through the trusted-certificate gate. It preserved all operational timers on ACME failure, rejected the bootstrap certificate from readiness, and passed administrator, mailbox isolation, IMAP switch, SMTP receive-only, backup/import and reboot tests. Debian 12's Certbot 2.1.0 masked the underlying exact-set limit with a known Python 3.11 `AttributeError`; its debug log still exposed the authoritative `retry after` response. The following candidate records that time and skips early ACME requests while retaining automatic recovery.

The rename does not intentionally alter APIs, the database schema, Stalwart account IDs, mailbox credentials, or existing mail. It changes the administrator cookie name, so browsers sign in again once.
