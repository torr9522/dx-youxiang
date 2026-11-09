# Upgrade and rollback

Read both Stalwart and Dx 邮箱 release notes before upgrading. Never skip a Stalwart major-version migration instruction.

1. Run and verify a fresh off-host backup.
2. Build and test the candidate application in a new release directory.
3. Run `/opt/dx-youxiang/current/scripts/upgrade.sh <version>`; it verifies the GitHub Release checksum before building.
4. Verify health, readiness, login, one mailbox, JMAP, SMTP and IMAP.
5. Upgrade Stalwart separately using its official 1.x upgrade procedure and verified release digest.

The application updater retains the previous release and automatically restores its symlink if `/readyz` fails. Database schema changes must remain backward compatible for this rollback. Stalwart rollback is supported only when its upstream notes say the data format is compatible; otherwise restore the pre-upgrade backup.

The `0.1.9` application upgrade adds the `mailbox_groups` table and a nullable foreign-key `mailboxes.group_id` column, creates one system-default group named `dx` when none exists, and transactionally backfills every existing mailbox. The stable default identity is `is_system_default=1`, not its mutable name. Triggers assign legacy inserts to that group and prevent deleting or demoting it. This additive schema is compatible with the `0.1.8` application: old code ignores the new table/column, and its mailbox inserts are assigned by the trigger. Rolling back only the application symlink therefore does not require restoring SQLite. Do not remove the new schema during rollback.

Before upgrading, compare mailbox IDs, addresses, Stalwart account IDs and permission values and take the standard SQLite/Stalwart/Restic backup. After startup, verify exactly one default group at sort position zero and that every mailbox has its `group_id`. Group migration does not touch Stalwart or mail storage. Destructive deletion modes must be tested only with isolated test accounts, never production mail.

The `0.1.8` application upgrade preserves the Phase 2 first-load state fix and optimizes existing React/API read paths. It adds only a browser-memory cache, request deduplication, independent administrator statistics and current-mailbox refresh. It has no SQLite migration, persistent cache, Stalwart configuration/data-format change, permission change, DNS change or new dependency. Rolling the application symlink back to `0.1.7` discards the in-memory cache naturally.

The `0.1.7` application upgrade adds Junk folder navigation and JMAP mail-management operations without a database migration or Stalwart configuration change. It preserves mailbox accounts, permissions, messages, MIME, attachments, DKIM, DNS and spam policy. The upgrade neither creates a classifier nor changes thresholds; it exposes the existing role=`junk` mailbox and uses standard account-bound `Email/set` operations.

The `0.1.6` application upgrade repairs administrator compose access without a database or Stalwart schema change. It preserves every mailbox address, account ID, credential, message, attachment and permission value. Administrators can send only from a selected mailbox whose current `emailSend` value is true; mailbox-user authentication and submission remain unchanged.

The `0.1.5` application upgrade adds backward-compatible mailbox send state, role-bound sessions and login-attempt storage. Existing mailbox rows receive `email_send=0`; mail reception and existing external-login state are unchanged. The formal upgrader reuses the existing Stalwart service credential, installs the Phase 1.8 Submission listeners and service permissions, and reapplies the project-owned Stalwart-only outbound SMTP policy. It does not enable sending for any mailbox.

Existing `0.1.4` domains without DKIM signatures are switched from manual to Stalwart's official automatic DKIM management so Stalwart generates private keys internally. Publish and verify only the generated public DNS records before enabling external sending. The upgrader never edits DNS.

The `0.1.4` application upgrade adds translation performance, completeness and browser-routing behavior without changing the SQLite schema or Stalwart data format. No database migration is required from `0.1.3`.

The `0.1.3` application migration adds translation settings and cache tables only. Existing domain, mailbox, session, audit and Stalwart data are unchanged. Fresh and upgraded installations start with protocol, Base URL, API key and model empty and translation disabled; administrators configure these values after upgrade.

The one-time rename from Private Mail Hub to Dx Youxiang changes the administrator cookie name. Existing browser sessions must sign in again after migration; administrator credentials, mailbox passwords, account IDs and mail data are unchanged.
