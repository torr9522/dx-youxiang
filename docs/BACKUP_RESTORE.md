# Backup and restore

## Backup model

Stalwart's official guidance forbids file-by-file copies of a running RocksDB directory. `scripts/backup.sh` stops the web service and Stalwart, performs Stalwart's offline export (including blobs), creates a consistent SQLite backup, captures configuration and a Git source bundle, restarts services, and sends the staging tree to an encrypted Restic repository. The backup refuses to run with uncommitted source changes so the bundle and deployed source cannot silently diverge.

The default local Restic repository proves the workflow but is not a separate failure domain. Before important use, change `RESTIC_REPOSITORY` in `/etc/dx-youxiang/restic.env` to an off-host SFTP/S3/B2 repository and retain the password separately.

```sh
systemctl start dx-youxiang-backup.service
journalctl -u dx-youxiang-backup.service
restic snapshots --tag dx-youxiang
```

Retention is 7 daily, 4 weekly and 12 monthly snapshots. Each run executes an encrypted repository check.

## Isolated restore

Never restore over a running instance. Restore to an empty absolute directory:

```sh
/opt/dx-youxiang/current/scripts/restore.sh latest /var/lib/dx-youxiang-restore-test
```

Install the same Stalwart version in an isolated VM or namespace, use a new empty store path and non-public ports, import `stalwart-export`, restore `app.db`, then run Stalwart's `reindexAccounts` maintenance task. Verify account count, folder/message count, bodies, attachments, flags, permissions, IMAP state and administrator access before any live cutover.

## Live disaster recovery

1. Provision a replacement server with the same compatible Stalwart version.
2. Keep all public mail ports closed.
3. Restore system configuration and application SQLite.
4. Import the complete Stalwart export into an empty store and reindex.
5. Start services on isolated/internal ports and execute acceptance tests.
6. Open public ports, then change only the mail host A record.
7. Keep the MX target unchanged and monitor both old and new hosts during DNS TTL convergence.
