# Testing And Acceptance

## Local Gates

Run `npm ci`, lint, both TypeScript checks, Vitest, production build, ShellCheck, shell syntax checks, production dependency audit, full dependency review, license audit, SBOM generation, Gitleaks history scan, and explicit real-domain/IP/mailbox/key/database/mail scans.

The CycloneDX gate must verify that `react`, `react-dom`, Stalwart, the private Node.js runtime, Caddy and Cosign are present with the versions and digests pinned by the installer. Do not replace a previously complete SBOM with an npm-only graph.

Tests must cover administrator/mailbox authentication, role-bound sessions, CSRF, positive numeric route IDs, mailbox account binding, folder list/search/pagination, detail/attachment/translation ownership, send permission, user-authenticated JMAP submission, administrator service-identity submission, sender spoof rejection, open relay, HTML sanitization, six-character mailbox passwords and shorter rejection. The compose matrix must cover both roles with sending enabled and disabled, administrator mailbox switching, permission changes during an existing session, and direct API attempts with forged mailbox, account and From identities.

Phase 1.7 routing regression includes top navigation, mailbox and message URL changes, browser back/forward, direct message URLs, authenticated deep-link restoration, rejection of external return URLs, legacy settings routes, invalid mailbox/message states, list scroll restoration, JSON API 404 responses and the scoped SPA fallback. Translation regression includes concurrency limits, in-flight deduplication, cache timings, prompt-version invalidation, mixed-language and ordinary hyphenated words, protected identifiers, complete node mapping and bounded retries for incomplete output.

## Clean Install Gate

Start with newly installed Debian 12 AMD64. Use an immutable build and the formal installer; do not patch the server. Verify systemd enablement, reboot recovery, Caddy, trusted HTTPS, SMTP 25 STARTTLS, 587 STARTTLS, 465 TLS, IMAPS, `/healthz`, `/readyz`, backup timer, log rotation, disk threshold and Stalwart-only outbound SMTP.

Create two real mailbox accounts with distinct account IDs. Verify unified login, all four external-login/send states, Inbox/Sent/Drafts, compose/reply/forward/attachment, JMAP and SMTP submission, sender matching, queue status, IMAP, rapid A/B switching and direct cross-account API rejection. Existing IMAP connections may persist after disabling; new authentication must fail.

Use an authorized independent Gmail or Outlook account for at least one real inbound delivery. Verify outbound delivery only to an explicitly authorized recipient, record the queue state and remote SMTP response, and inspect the received message's authentication headers. Open-relay tests must use controlled addresses and must not emit mail to third parties.

## Recovery Gate

Create an encrypted backup, run a full Restic data check, restore into an isolated store, and compare account IDs, mailbox/folder/message/attachment counts and digests, bodies, read flags, permission state, external-login state and administrator access. A checksum-only restore is insufficient.

Any unavailable external test is `PENDING`, never `PASS`.
