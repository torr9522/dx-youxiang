# Upgrade and rollback

Read both Stalwart and Private Mail Hub release notes before upgrading. Never skip a Stalwart major-version migration instruction.

1. Run and verify a fresh off-host backup.
2. Build and test the candidate application in a new release directory.
3. Run `scripts/update.sh <verified-release-directory>`.
4. Verify health, readiness, login, one mailbox, JMAP, SMTP and IMAP.
5. Upgrade Stalwart separately using its official 1.x upgrade procedure and verified release digest.

The application updater retains a symlink to the previous release and automatically restores it if `/healthz` fails. Database schema changes must remain backward compatible for this rollback. Stalwart rollback is supported only when its upstream notes say the data format is compatible; otherwise restore the pre-upgrade backup.
