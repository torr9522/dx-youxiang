# Dx Youxiang v0.1.9

This stable release adds mailbox-address groups to the existing React, Express, SQLite and Stalwart/JMAP application. It keeps the three-column webmail, mail storage, account model, session system and v0.1.8 read-performance work unchanged.

## Mailbox groups

- Create and rename single-level groups, collapse or expand their mailbox rows, and persist ordinary-group order with drag, move-up and move-down controls.
- Keep one stable system-default group fixed first. Its initial name is `dx`; administrators may rename it, but cannot delete, demote or move it.
- Select a group for single mailbox creation, numeric ranges and custom-line batches. Existing duplicate addresses remain skipped and are never moved implicitly.
- Move an existing mailbox between groups without recreating its Stalwart account or changing its address, credentials, permissions, mail, folders or attachments.

## Safe deletion

- Delete a group while transactionally moving all members to a selected group.
- Delete a group while transactionally moving all members to the stable default group, including after that group is renamed.
- Delete a group and its mailboxes only after a fresh member snapshot and typed `DELETE <count>` confirmation. Each account uses the existing Stalwart-plus-SQLite deletion flow; processing stops at the first failure and reports deleted, failed and remaining accounts without hiding the group.

## Migration and rollback

- Startup adds one `mailbox_groups` table and the `mailboxes.group_id` foreign key, creates `dx` only when no stable default exists, and assigns all existing rows transactionally.
- Repeated startup is idempotent. Mailbox IDs, Stalwart account IDs, addresses, permissions, messages, MIME, flags, folders and attachments are not modified.
- The schema is additive and v0.1.8-compatible. A retained v0.1.8 application can ignore group metadata, while triggers assign its legacy mailbox inserts to the stable default group.
- Stalwart remains `1.0.1`; DNS, PTR, SPF, DKIM, DMARC, Caddy ownership, firewall policy and the global Node.js installation are unchanged.

## Performance and isolation

- Group metadata is a lightweight administrator-only SQLite request and does not block selected-Inbox initialization or join manual refresh.
- Group rename, reorder and mailbox movement do not refetch JMAP mail or invalidate unrelated message bodies.
- The v0.1.8 96-entry in-memory LRU, 10-second freshness, five-minute stale window, SWR, exact request deduplication and session/account isolation remain in place.
- Accounts actually deleted by a group operation have only their own browser-memory cache entries invalidated.

## Validation

- Automated coverage includes v0.1.8 backfill, migration idempotence, default protection, CRUD, sorting, group-aware single/batch creation, mailbox movement, authorization, all deletion modes, stale snapshots, upstream partial failure, SQLite rollback and cache invalidation.
- Real test-server backup/restore, destructive isolated-account checks, browser acceptance, release verification and production non-destructive acceptance are separate release gates and are never inferred from unit tests.
