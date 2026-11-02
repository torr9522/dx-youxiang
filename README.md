# Dx 邮箱

Dx 邮箱 (`dx-youxiang`) is a receive-only, single-administrator mailbox console for [Stalwart Mail Server](https://stalw.art/). It creates real Stalwart users, keeps every Inbox isolated, and lets the administrator selectively enable IMAP without exposing Stalwart administration credentials to the browser.

Version: `0.1.0` candidate. No stable tag is published until the clean-install acceptance gate passes.

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

- Debian 12 AMD64, at least 768 MiB RAM and 5 GiB free disk; 1 GiB RAM and 20 GiB free are recommended
- Root access, a static IPv4 address and inbound TCP 25/80/443/993
- An A record for the mail host and an MX record for the mail domain
- No Cloudflare proxy on the mail host

Node.js 26 LTS, Stalwart 1.0.1 and Caddy 2.11.7 are pinned. The installer verifies their official checksums or Stalwart Sigstore attestation.

## Installation

An RC is installed from its immutable GitHub Release asset. A minimal Debian installation may contain neither `curl` nor `wget`, so the single command first installs the TLS bootstrap dependencies with Debian's package manager. Example for `v0.1.0-rc.5`:

```sh
apt-get update && apt-get install -y ca-certificates curl tar && DX_YOUXIANG_VERSION=0.1.0-rc.5 bash <(curl -fsSL https://raw.githubusercontent.com/torr9522/dx-youxiang/v0.1.0-rc.5/install.sh)
```

The installer asks only for the mail domain, mail hostname, and administrator password. It verifies public and authoritative A/MX answers, release checksums, pinned upstream binaries, Caddy configuration, TLS issuance, systemd services, firewall policy, initial encrypted backup, and readiness. It never edits DNS.

After stable acceptance, the default command becomes:

```sh
apt-get update && apt-get install -y ca-certificates curl tar && bash <(curl -fsSL https://raw.githubusercontent.com/torr9522/dx-youxiang/v0.1.0/install.sh)
```

See [Deployment](docs/DEPLOYMENT.md), [Architecture](docs/ARCHITECTURE.md), [Operations](docs/OPERATIONS.md), and [Backup and restore](docs/BACKUP_RESTORE.md) before using the server for important mail.

## Development

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
npm run audit:licenses
npm run sbom
```

Use `.env.example` with fictional local values. Never copy production environment files, messages, databases, certificates or backups into the repository.

## Security model

The browser authenticates only to Dx 邮箱. The backend maps its numeric mailbox route to a Stalwart account ID stored in SQLite, so a client cannot select an arbitrary JMAP `accountId`. Ordinary mailboxes use explicit permissions: `emailReceive` and IMAP operations are enabled, while `emailSend` is always disabled and `authenticate` is disabled until the administrator opens IMAP.

The Stalwart HTTP/JMAP listener and Node application bind to loopback. Public listeners are SMTP 25, HTTPS 443 and IMAPS 993. SMTP submission, POP3 and ManageSieve are not exposed. A project-owned nftables table rejects new outbound TCP connections to 25, 465 and 587.

## License

Dx 邮箱 is MIT licensed. Stalwart is a separate upstream program distributed under its upstream dual-license terms and is downloaded from its official release; its binary and source are not incorporated into this repository. See [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
