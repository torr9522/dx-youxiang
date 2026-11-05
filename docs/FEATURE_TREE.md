# Feature And Skill Tree

## Product Functions

```text
Dx Youxiang
|-- Unified authentication
|   |-- administrator and enabled mailbox users, no registration
|   |-- Argon2id password, secure cookie, CSRF, rate limit
|   `-- audit log
|-- Domains
|   |-- default-domain suffix completion
|   `-- multiple hosted domains with MX verification
|-- Mailboxes
|   |-- real independent Stalwart User account
|   |-- note, status, account mapping
|   |-- receive enabled; external login and send independently controlled
|   `-- one Stalwart password for web, IMAP and SMTP authentication
|-- Inbox
|   |-- account- and Inbox-scoped list/search/pagination
|   |-- plain and sanitized layout-preserving HTML body
|   |-- authenticated CID images and consent-based remote image proxy
|   |-- verification-code extraction
|   |-- attachment ownership check and download
|   `-- read/unread and delete
|-- Webmail sending
|   |-- server-side Drafts and Sent
|   |-- compose, reply, reply-all, forward and attachments
|   |-- user-authenticated JMAP EmailSubmission
|   `-- administrator compose for a selected send-enabled mailbox
|-- Mail clients
|   |-- IMAPS 993
|   |-- Submission 587 STARTTLS and 465 TLS
|   `-- direct MX delivery over SMTP 25
`-- Operations
    |-- systemd health/readiness and restart
    |-- Caddy/Certbot shared TLS
    |-- encrypted Restic backup and isolated restore
    |-- disk/log monitoring
    `-- release upgrade and rollback
```

POP3, Exchange, public registration, multiple administrators, containers, client auto-configuration, bulk sending, and immediate termination of existing IMAP sessions remain outside scope.

## Future Backlog

- Mail-client autoconfiguration and additional provider-specific deliverability acceptance remain future work.

## Codex Project Skills

The operational skill tree is under `.agents/skills`: project initialization, system audit, installation/deployment, mail operations, backup/restore, DNS/TLS diagnostics, security audit, debugging/regression, Git release, and production migration. `AGENTS.md` defines shared invariants; each skill adds only task-specific workflow and gates.
