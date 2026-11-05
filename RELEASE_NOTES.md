# Dx Youxiang v0.1.7

This stable release adds complete Junk mailbox management on top of Stalwart 1.0.1 and JMAP without changing the spam engine, scoring policy or existing mailbox permissions.

## Junk mailbox management

- Discover Inbox, Junk and Trash by their standard JMAP roles rather than localized folder names.
- List Junk directly through server-side `Email/query`, with search, read filters, pagination, refresh, unread counts and direct browser routes.
- Report one or a current-page batch of Inbox messages as spam by moving membership to Junk and applying the standard `$junk` keyword.
- Restore false positives to Inbox with `$notjunk`, and move deleted Junk messages to Trash instead of permanently destroying them.
- Keep message IDs, original MIME, attachments, read state and unrelated mailbox memberships intact.

## Security and compatibility

- Every action derives the immutable Stalwart account ID from the authenticated server-side mailbox row. Browser-supplied account IDs cannot select another account.
- Missing and foreign Email IDs are rejected per item; batches are deduplicated, bounded to 50 and return exact partial-failure results.
- Existing safe HTML, CID image, remote-image consent, translation, attachment and send-permission paths are reused unchanged.
- No SQLite migration or Stalwart data-format change is required. Stalwart remains pinned to 1.0.1.
- The release does not change DNS, PTR, spam thresholds, Caddy ownership, global Node.js, SMTP firewall rules or any mailbox permission value.

## Validation

- Automated coverage includes JMAP mailbox-role discovery, server-side Junk query, membership/keyword patches, partial failures, account isolation, deep routes, browser back, unread refresh and current-page batch actions.
- TypeScript, ESLint, the production build and the full Vitest suite pass locally before preview deployment.
- Real Stalwart, browser, backup/restore and deployment results are recorded in the final release acceptance rather than inferred from mocks.

## Known limitations

- Automatic classification depends on the deployed Stalwart spam filter and its existing delivery-time policy. This application displays the server's Junk mailbox; it does not score mail.
- The release adds no full Trash management page. Junk deletion safely moves mail to the server Trash role.
- Queue acceptance still means submitted or queued, not final recipient delivery.
- Existing authenticated IMAP or SMTP connections may remain active until disconnect or timeout because Stalwart 1.0.1 has no verified per-account connection-termination API.
