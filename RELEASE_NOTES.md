# Dx Youxiang v0.1.8

This stable release preserves the verified first-load state fix and improves the responsiveness of the existing React, Express, SQLite and Stalwart/JMAP architecture. It does not replace a framework or change mail storage.

## Webmail performance

- Load the lightweight mailbox mapping before all-mailbox statistics, so the selected administrator Inbox and folders initialize without that global JMAP barrier.
- Keep domain metadata independent from Inbox initialization and retain distinct loading, ready, error and genuinely empty states.
- Refresh only the selected mailbox's current message page and folder state. The observed request shape changes from three browser APIs and six JMAP HTTP requests to two browser APIs and three JMAP HTTP requests.
- Highlight requested folders and mailboxes immediately. Without a matching verified cache the old list is removed before the target label changes; with a matching cache it renders while revalidation continues.
- Reuse verified lists, folder state and read message details from a 96-entry in-memory LRU with exact request deduplication, 10-second freshness and a five-minute maximum stale window.

## Isolation and consistency

- Cache scope includes a regenerated session generation, authenticated role, numeric application mailbox ID, folder, filters and pagination or message ID. Stalwart account IDs remain server-only.
- Logout, 401 and session replacement clear all cached mail. Mail mutations invalidate the affected mailbox, and old in-flight reads cannot repopulate invalidated entries.
- Cache values never enter localStorage, sessionStorage, URLs, SQLite or a shared server cache. API authorization and mailbox-to-account resolution are unchanged.
- The first-load fix from `a834562589bd83a60c05faafaf4892a9a1d88d57` is included.

## Compatibility and rollback

- No SQLite migration, persistent cache table or Stalwart data-format/configuration change is required.
- Stalwart remains `1.0.1`; the installer runtime, Caddy integration, DNS, PTR, SPF, DKIM, DMARC, firewall and mailbox permission model are unchanged.
- Application rollback uses the retained previous release symlink. Browser-memory cache state disappears naturally on reload or rollback.

## Validation

- Automated coverage includes first-load states, administrator-statistics independence, ordinary-user initialization, current-mailbox refresh, pending feedback, stale-display prevention, cache isolation/capacity/deduplication/invalidation and 401 cleanup.
- Real test-server performance, backup/restore, browser, mail-integrity and production-upgrade results are accepted separately and are never inferred from unit tests.
