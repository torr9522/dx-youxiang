# Feature And Skill Tree

## Product Functions

```text
Dx Youxiang
|-- Administrator authentication
|   |-- one administrator, no registration
|   |-- Argon2id password, secure cookie, CSRF, rate limit
|   `-- audit log
|-- Domains
|   |-- default-domain suffix completion
|   `-- multiple hosted domains with MX verification
|-- Mailboxes
|   |-- real independent Stalwart User account
|   |-- note, status, account mapping
|   |-- receive enabled / send disabled
|   `-- optional IMAP authentication with independent password
|-- Inbox
|   |-- account- and Inbox-scoped list/search/pagination
|   |-- plain and sanitized layout-preserving HTML body
|   |-- authenticated CID images and consent-based remote image proxy
|   |-- verification-code extraction
|   |-- attachment ownership check and download
|   `-- read/unread and delete
`-- Operations
    |-- systemd health/readiness and restart
    |-- Caddy/Certbot shared TLS
    |-- encrypted Restic backup and isolated restore
    |-- disk/log monitoring
    `-- release upgrade and rollback
```

Junk browsing, sending, reply, forward, POP3, Exchange, public registration, multiple administrators, containers, client auto-configuration, and immediate termination of existing IMAP sessions are outside `0.1.0`.

## Future Backlog

- In-place translation of the displayed email body (not implemented in Phase 1.5)

## Codex Project Skills

The operational skill tree is under `.agents/skills`: project initialization, system audit, installation/deployment, mail operations, backup/restore, DNS/TLS diagnostics, security audit, debugging/regression, Git release, and production migration. `AGENTS.md` defines shared invariants; each skill adds only task-specific workflow and gates.
