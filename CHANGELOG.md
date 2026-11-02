# Changelog

All notable changes follow Keep a Changelog. The project uses Semantic Versioning.

## [0.1.0] - Unreleased

### Added

- Single-administrator Chinese management interface
- Real Stalwart mailbox provisioning and isolated JMAP access
- Receive-only SMTP/IMAP permission model
- Per-mailbox external login switch and independent password reset
- Safe HTML, verification-code extraction and attachment proxy
- SQLite WAL state, audit records, CSRF protection and login throttling
- Systemd, Caddy, Certbot, Restic, monitoring and migration tooling
- Native checksum-verified release installer with fresh/Caddy-coexist modes
- Repository-level Codex skills and full developer/operations knowledge base
- Guarded legacy-data migration with empty-store import, credential rotation and retained rollback material

### Fixed

- Preserve numeric application mailbox IDs when adding Stalwart inbox statistics
- Scope list/search/pagination to the selected account's Inbox folder
- Validate inbox pagination parameters and reset state when switching mailboxes
- Accept independent mailbox passwords from 6 to 256 characters without composition rules
- Enable outbound SMTP blocking before Stalwart's first start
- Make coexist-mode Caddy changes validation-first with rollback
- Preserve prior service state and optional Caddy units during backup
- Rename the administrator session cookie; existing candidate sessions sign in again once
- Rotate an existing Dx 邮箱 service identity and update imported certificate paths during migration
