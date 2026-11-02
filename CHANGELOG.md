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

### Fixed

- Preserve numeric application mailbox IDs when adding Stalwart inbox statistics
- Validate inbox pagination parameters and reset state when switching mailboxes
