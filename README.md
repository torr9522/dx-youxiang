# Private Mail Hub

Private Mail Hub is a receive-only, single-administrator mailbox console for [Stalwart Mail Server](https://stalw.art/). It creates real Stalwart user accounts, keeps every inbox isolated, and lets the administrator selectively enable IMAP without exposing Stalwart administration credentials to the browser.

Version: `0.1.0`

## What it provides

- Real mailbox accounts, never aliases or a shared catch-all inbox
- Chinese administrator UI with mailbox, message, attachment and domain management
- Per-mailbox IMAP switch and independent password
- JMAP access scoped server-side to the selected mailbox account ID
- Sanitized HTML mail, blocked remote images and safe attachment downloads
- No compose, reply, forward, submission or outbound SMTP feature
- SQLite WAL application database and Stalwart RocksDB mail storage
- Systemd services, health checks, encrypted Restic backups and migration documentation

## Requirements

- A clean Debian 12 x86_64 server with at least 1 GB RAM and 20 GB disk
- Root access, a static IPv4 address and inbound TCP 25/80/443/993
- An A record for the mail host and an MX record for the mail domain
- No Cloudflare proxy on the mail host

Node.js 26 LTS, Stalwart 1.0.1 and Caddy 2.11.7 are pinned and SHA-256 verified by the installer.

## Installation

Place this repository at `/opt/private-mail-hub`, then run:

```sh
cd /opt/private-mail-hub
MAIL_DOMAIN=example.test MAIL_HOST=mail.example.test ./scripts/install.sh
```

The installer prints the application administrator password once. It initially creates a 14-day self-signed certificate so services can be configured before DNS is ready. Once public DNS resolves, obtain the trusted certificate:

```sh
set -a
. /etc/private-mail-hub/app.env
set +a
ACME_EMAIL=postmaster@example.test ./scripts/obtain-certificate.sh
```

See [Deployment](docs/DEPLOYMENT.md), [Operations](docs/OPERATIONS.md), and [Backup and restore](docs/BACKUP_RESTORE.md) before using the server for important mail.

## Development

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
```

Use `.env.example` with fictional local values. Never copy production environment files, messages, databases, certificates or backups into the repository.

## Security model

The browser authenticates only to Private Mail Hub. The backend maps its numeric mailbox route to a Stalwart account ID stored in SQLite, so a client cannot select an arbitrary JMAP `accountId`. Ordinary mailboxes use explicit permissions: `emailReceive` and IMAP operations are enabled, while `emailSend` is always disabled and `authenticate` is disabled until the administrator opens IMAP.

The Stalwart HTTP/JMAP listener binds to `127.0.0.1`. Public listeners are SMTP 25, HTTPS 443 and IMAPS 993. SMTP submission, POP3 and ManageSieve are not exposed.

## License

Private Mail Hub is MIT licensed. Stalwart is a separate upstream program distributed under `AGPL-3.0-only OR LicenseRef-SEL` and is downloaded directly from its official release; its binary and source are not incorporated into this repository. See [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
