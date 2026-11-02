---
name: dx-backup-restore
description: Create, verify, restore, and migrate encrypted Dx Youxiang backups using Stalwart export, SQLite backup, and Restic without copying live RocksDB.
---

# Dx Backup Restore

Use before destructive work, upgrades, server migration, or disaster-recovery testing.

## Inputs

Require a protected Restic repository/password, enough staging space, the deployed version, and an explicit empty restore target. For migration also require a second failure domain.

## Workflow

1. Read `docs/BACKUP_RESTORE.md` and record service state, account/message/attachment counts, and source HEAD.
2. Run `scripts/backup.sh`; it must stop the app and Stalwart, use Stalwart's supported export, use the SQLite backup API, then restore the prior service state.
3. Run `restic check --read-data` for a release or destructive-operation gate and create a SHA-256 manifest.
4. Restore to a new isolated directory. Clone and fsck the Git bundle or inspect the source archive, run SQLite integrity checks, import Stalwart into a new store, and compare account IDs, folders, messages, attachments, flags, permissions, login state, and readable bodies.
5. Keep at least two independently encrypted copies before reinstalling a source server.

## Safety And Acceptance

Never copy running RocksDB as a valid backup, restore over a live instance, log repository passwords, or call a local-only repository off-site. Pass only after content-level isolated restore. If any irreplaceable item differs, prohibit reinstall/cutover and report the mismatch.
