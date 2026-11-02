#!/bin/sh
set -eu

umask 077
backup_root=${BACKUP_ROOT:-/var/backups/private-mail-hub}
restic_env=${RESTIC_ENV:-/etc/private-mail-hub/restic.env}
lock_file=/run/private-mail-hub-backup.lock
stamp=$(date -u +%Y%m%dT%H%M%SZ)
install -d -o root -g stalwart -m 0710 "$backup_root"
staging=$(mktemp -d "${backup_root}/staging.${stamp}.XXXXXX")
exec 9>"$lock_file"
flock -n 9 || { echo "backup already running" >&2; exit 1; }

cleanup() {
  systemctl start stalwart private-mail-hub >/dev/null 2>&1 || true
  rm -rf -- "$staging"
}
trap cleanup EXIT INT TERM

test -r "$restic_env" || { echo "missing $restic_env" >&2; exit 1; }
. "$restic_env"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
systemctl stop private-mail-hub
systemctl stop stalwart
chown root:stalwart "$staging"
chmod 0710 "$staging"
install -d -o stalwart -g stalwart -m 0700 "$staging/stalwart-export"
mkdir -p "$staging/config"
runuser -u stalwart -- /usr/local/bin/stalwart --config /etc/stalwart/config.json --export "$staging/stalwart-export"
/usr/local/bin/node /opt/private-mail-hub/scripts/sqlite-backup.mjs /var/lib/private-mail-hub/app.db "$staging/app.db"
tar -C / -czf "$staging/config/system-config.tar.gz" \
  etc/stalwart etc/private-mail-hub etc/caddy etc/letsencrypt \
  etc/systemd/system/stalwart.service \
  etc/systemd/system/private-mail-hub.service \
  etc/systemd/system/caddy.service \
  etc/systemd/system/private-mail-hub-backup.service \
  etc/systemd/system/private-mail-hub-backup.timer \
  etc/systemd/system/private-mail-hub-monitor.service \
  etc/systemd/system/private-mail-hub-monitor.timer 2>/dev/null
if test -d /opt/private-mail-hub/.git; then
  test -z "$(git -C /opt/private-mail-hub status --porcelain)"
  git -C /opt/private-mail-hub bundle create "$staging/config/source.bundle" --all
fi
systemctl start stalwart
systemctl start private-mail-hub

restic snapshots >/dev/null 2>&1 || restic init
restic backup "$staging" --tag private-mail-hub --host "$(hostname -f)"
restic forget --tag private-mail-hub --group-by host,tags \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune
restic check --read-data-subset=5%
