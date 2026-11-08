# Changelog

All notable changes follow Keep a Changelog. The project uses Semantic Versioning.

## [Unreleased]

## [0.1.8] - 2026-11-08

### Fixed

- Decouple administrator domain metadata from Inbox initialization so a slow or failed `/api/domains` request cannot block mailbox, folder or message loading.
- Distinguish pending, failed and genuinely empty message lists so the first render no longer reports a false empty mailbox while JMAP data is still loading.

### Performance

- Load the administrator mailbox mapping without global statistics, initialize the selected Inbox and folder state immediately, and merge other mailbox statistics from an independent background request.
- Limit manual refresh to the selected mailbox's message list and folder state, reducing the measured path from three browser APIs and six JMAP HTTP requests to two browser APIs and three JMAP HTTP requests.
- Add immediate pending mailbox/folder feedback while preventing an old mailbox or folder list from being presented under the new selection.
- Add a bounded 96-entry, session-generation and role-scoped in-memory LRU for message lists, folder state and read message details, with 10-second freshness, five-minute maximum stale reuse, background revalidation and exact in-flight request deduplication.

### Security

- Keep cache keys bound to the session generation, role, numeric server-authorized mailbox ID, folder, search/read/order filters and pagination; clear all values on logout, 401 or session replacement.
- Invalidate mailbox reads after mail mutations and reject obsolete results through the existing request generations. No credentials, Stalwart account IDs or message data are persisted in browser storage.

### Validation

- Cover independent Inbox initialization, current-mailbox-only refresh, pending selection feedback, cross-mailbox stale-display prevention, ordinary-user behavior, cache capacity, isolation, request deduplication, invalidation and 401 cleanup.
- Preserve Stalwart 1.0.1, SQLite and all existing API/session/permission boundaries. This release has no database migration or mail-storage format change.

## [0.1.7] - 2026-11-05

### Added

- Add a role-detected Junk folder with unread counts, server-side search, read filters, pagination, refresh, direct routes and message detail.
- Add single-message and current-page batch actions for reporting spam, restoring false positives to Inbox and moving Junk mail to Trash.
- Preserve Junk context across direct URLs and browser history while reusing the existing safe HTML, CID image, remote-image consent, translation and attachment paths.

### Security

- Resolve Inbox, Junk and Trash only from JMAP mailbox roles and resolve every Stalwart account from the authenticated server-side mailbox row.
- Reject missing and cross-account Email IDs, cap and deduplicate batches, preserve unrelated mailbox memberships and keywords, and report partial JMAP failures without trusting browser-supplied account IDs.
- Use JMAP `Email/set` membership and `$junk`/`$notjunk` patches; no message copy, MIME rewrite, direct storage mutation or spam-threshold change is performed.

### Validation

- Cover role discovery, server-side Junk queries, keyword and membership patches, partial failures, account isolation, deep routes, unread counts and batch UI behavior in automated tests.
- Keep Stalwart pinned to 1.0.1 with no SQLite schema, DNS, PTR, Caddy ownership, global Node.js or firewall-policy change.

## [0.1.6] - 2026-11-05

### Fixed

- Show compose, reply, reply-all and forward actions to administrators when the selected mailbox has sending enabled, while hiding them for every send-disabled mailbox.
- Allow administrator drafts, attachments and JMAP submission through the protected service identity without requiring or exposing a mailbox password.

### Security

- Re-resolve the selected mailbox and enforce its current `emailSend` state for every upload, draft and submission request.
- Derive the Stalwart account and From identity on the server for both roles, reject cross-mailbox requests, and audit the real actor separately from the sending mailbox.

## [0.1.5] - 2026-11-04

### Added

- Add one login entry for the existing administrator and mailbox users authenticated against their Stalwart credentials.
- Add role-bound mailbox sessions, per-request external-login checks, account isolation, and encrypted ephemeral Stalwart credentials.
- Add independent per-mailbox send permission with receive enabled and login/send disabled by default.
- Add Inbox, Sent and Drafts views, compose, reply, reply-all, forward, attachments, server-side drafts and JMAP EmailSubmission.
- Add authenticated SMTP Submission on 587 STARTTLS and 465 implicit TLS while retaining SMTP 25 for server delivery.
- Generate DKIM keys through Stalwart bootstrap and restrict outbound SMTP 25 to the Stalwart service user.

### Security

- Enforce role-bound and account-bound sessions, CSRF protection, login and sending limits, sender matching, attachment ownership, and cross-account isolation.
- Keep external login and sending independently disabled for new mailboxes while leaving mail reception enabled.
- Reject anonymous relay, sender spoofing, and outbound SMTP from processes other than Stalwart.

### Validation

- Complete real Stalwart 1.0.1 JMAP, IMAP, SMTP Submission, direct-MX, attachment, draft, Sent, permission-matrix and isolation acceptance on the test installation.
- Confirm controlled direct delivery to Gmail with SPF, DKIM and DMARC passing. Gmail accepted the message but placed it in Spam; new-domain and new-IP reputation remain outside the software release gate.

## [0.1.4] - 2026-11-04

- Bound translation-provider concurrency, parallelize independent chunks, deduplicate concurrent requests for one message, and expose non-sensitive server timing metrics.
- Translate ordinary hyphenated English instead of protecting it as a machine identifier, reject incomplete node output with a bounded retry, and invalidate earlier translation caches by prompt version.
- Preserve written calendar dates through placeholder protection and invalidate translations created before this protection was added.
- Add React Router browser-history routes for inboxes, messages, mailbox management and settings, including authenticated deep-link restoration and a scoped SPA fallback.

## [0.1.3] - 2026-11-03

### Added

- Add an administrator-only translation settings page with empty provider defaults, encrypted API key storage, explicit connection testing and cache management
- Add independent OpenAI-compatible Responses and Chat Completions adapters with HTTPS-only SSRF controls, bounded requests and disabled response storage
- Detect message-body language and translate sanitized HTML text nodes in place while preserving layout, protected identifiers, images and the original/translation switch
- Cache complete translations by mailbox account, message body, provider, protocol, model, target language and prompt version without storing API keys in cache keys

### Changed

- Simplify the horizontal primary navigation to Inbox, Mailbox Management and Settings, with domain and audit pages retained as compatible Settings subpages
- Preserve common table-based email structure and allowlisted inline presentation styles without allowing external CSS, active content or application-wide style leakage
- Render authenticated CID raster images from the owning message and add per-message consent for privacy-safe remote image loading
- Proxy consented remote images through DNS-pinned public destinations with redirect, timeout, size, MIME and file-signature validation

## [0.1.2] - 2026-11-03

### Changed

- Keep mailbox addresses on one truncated mobile line while preserving full-value copy actions across inbox, management and dialog views
- Add real server-side Inbox read/unread filters that compose with JMAP search, totals and pagination
- Replace crowded mobile header icons with a labelled navigation menu and add iPhone safe-area, keyboard-safe modal and narrow bulk-row handling
- Refine mobile message hierarchy, complete timestamps, two-line subjects, attachment metadata and detail-to-list scroll restoration
- Open the selected mailbox message stage directly when entering from mobile mailbox management

## [0.1.1] - 2026-11-03

### Fixed

- Wait for bounded application readiness during in-place upgrades and verify that the previous release recovers before reporting a successful rollback

## [0.1.0] - 2026-11-03

### Added

- Explicit `ACME_MODE=staging|production` installation with a fixed Let's Encrypt directory, persisted renewal/retry configuration and no automatic CA-mode fallback
- Reproducible release SBOM generation and validation for React, ReactDOM and the pinned Stalwart, Node.js, Caddy and Cosign deployment components
- Unified light visual system with white surfaces, blue primary actions, blue selection states, shared controls, restrained borders and responsive dialogs across every administrator page
- API-backed batch mailbox creation with numeric ranges, editable per-line prefixes, a 100-account safety limit, duplicate/existing-address handling and per-item results
- Server-validated mailbox selection and batch deletion with one confirmation, per-account cleanup results and retryable failures
- Modern light mail workspace with a desktop three-column layout and mobile mailbox-to-message navigation
- Real API-backed mailbox creation, mailbox search, address copying, message search, read-state updates, verification-code copying and attachment access in the new workspace
- Responsive mailbox-management rows for external-login, password-reset and deletion workflows on narrow screens
- Browser-compatible clipboard fallback for test environments served over plain HTTP
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
- Minimal-Debian bootstrap command that installs TLS download prerequisites before fetching the tagged installer

### Fixed

- Distinguish Let's Encrypt staging certificates from production certificates in readiness instead of treating every non-self-signed certificate as production-ready
- Replace typed-address mailbox deletion confirmation with one explicit irreversible-action dialog while retaining server-side account resolution
- Preserve numeric application mailbox IDs when adding Stalwart inbox statistics
- Scope list/search/pagination to the selected account's Inbox folder
- Validate inbox pagination parameters and reset state when switching mailboxes
- Accept independent mailbox passwords from 6 to 256 characters without composition rules
- Enable outbound SMTP blocking before Stalwart's first start
- Make coexist-mode Caddy changes validation-first with rollback
- Preserve prior service state and optional Caddy units during backup
- Rename the administrator session cookie; existing candidate sessions sign in again once
- Rotate an existing Dx 邮箱 service identity and update imported certificate paths during migration
- Preserve Stalwart's first-run bootstrap mode by letting `x:Bootstrap/set` create `config.json`
- Refuse to overwrite an existing Stalwart registry configuration during installation
- Start the application schema migration before seeding the default domain on a fresh database
- Make protected legacy migration configuration readable only through a dedicated Stalwart import directory
- Stage protected Stalwart exports in that traversable directory so root-private restore sources remain readable during import
- Validate archive member paths with an executable regression-tested AWK policy
- Automatically restart or roll back installed services and remove incomplete candidate stores when legacy migration fails
- Wait for the migrated web process to become healthy before running the full post-migration readiness gate
- Configure Stalwart's supported authentication policy for 6-character mailbox passwords without composition rules
- Enable backup, monitoring and Certbot renewal before the first ACME request
- Retry only failed initial certificate issuance and hand successful certificates to Certbot renewal
- Reject self-signed bootstrap and hostname-mismatched certificates from `/readyz`
- Honor ACME `retry after` responses without submitting repeated certificate orders before the limit resets
- Default the public bootstrap installer to the stable `0.1.0` release instead of an obsolete candidate
- Keep public SMTP 25 blocked across reboots until trusted TLS, readiness, and the first encrypted backup all pass
- Use a dedicated `/etc/caddy/dx-youxiang.caddy` include for existing-Caddy deployments
