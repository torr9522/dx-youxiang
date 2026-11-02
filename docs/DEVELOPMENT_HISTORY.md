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
- The following documentation commit adds project Skills and the context-free handover knowledge base.

The rename does not intentionally alter APIs, the database schema, Stalwart account IDs, mailbox credentials, or existing mail. It changes the administrator cookie name, so browsers sign in again once.
