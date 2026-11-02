# Testing And Acceptance

## Local Gates

Run `npm ci`, lint, both TypeScript checks, Vitest, production build, ShellCheck, shell syntax checks, production dependency audit, full dependency review, license audit, SBOM generation, Gitleaks history scan, and explicit real-domain/IP/mailbox/key/database/mail scans.

Tests must cover authentication/CSRF, positive numeric route IDs, mailbox account binding, Inbox-only list/search/pagination, detail/attachment ownership, read state, HTML sanitization, six-character mailbox passwords and shorter rejection.

## Clean Install Gate

Start with newly installed Debian 12 AMD64. Use only the one-line command for an immutable RC from GitHub. Do not manually install a missing dependency or patch the server. Verify systemd enablement, reboot recovery, Caddy, trusted HTTPS/STARTTLS/IMAPS, `/healthz`, `/readyz`, backup timer, log rotation, disk threshold and outbound SMTP rejection.

Create two real mailbox accounts with distinct account IDs. Verify empty, one-message and multiple-message Inbox states, search, pagination, detail, attachment, read flags, rapid A/B switching and cross-account rejection. Verify IMAP default denial, enable with `123456`, own-mail access, send denial, then new-login denial after disabling.

Use an authorized independent Gmail or Outlook account for at least one real inbound delivery. Never send the test from the mail server. Open-relay tests must use controlled addresses and must not emit mail to third parties.

## Recovery Gate

Create an encrypted backup, run a full Restic data check, restore into an isolated store, and compare account IDs, mailbox/folder/message/attachment counts and digests, bodies, read flags, permission state, external-login state and administrator access. A checksum-only restore is insufficient.

Any unavailable external test is `PENDING`, never `PASS`.
