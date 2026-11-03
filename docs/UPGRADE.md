# Upgrade and rollback

Read both Stalwart and Dx 邮箱 release notes before upgrading. Never skip a Stalwart major-version migration instruction.

1. Run and verify a fresh off-host backup.
2. Build and test the candidate application in a new release directory.
3. Run `/opt/dx-youxiang/current/scripts/upgrade.sh <version>`; it verifies the GitHub Release checksum before building.
4. Verify health, readiness, login, one mailbox, JMAP, SMTP and IMAP.
5. Upgrade Stalwart separately using its official 1.x upgrade procedure and verified release digest.

The application updater retains the previous release and automatically restores its symlink if `/readyz` fails. Database schema changes must remain backward compatible for this rollback. Stalwart rollback is supported only when its upstream notes say the data format is compatible; otherwise restore the pre-upgrade backup.

The `0.1.3` application migration adds translation settings and cache tables only. Existing domain, mailbox, session, audit and Stalwart data are unchanged. Fresh and upgraded installations start with protocol, Base URL, API key and model empty and translation disabled; administrators configure these values after upgrade.

The one-time rename from Private Mail Hub to Dx Youxiang changes the administrator cookie name. Existing browser sessions must sign in again after migration; administrator credentials, mailbox passwords, account IDs and mail data are unchanged.
