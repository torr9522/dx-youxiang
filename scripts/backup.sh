#!/bin/sh
set -eu

umask 077
backup_root=${BACKUP_ROOT:-/var/backups/dx-youxiang}
restic_env=${RESTIC_ENV:-/etc/dx-youxiang/restic.env}
lock_file=/run/dx-youxiang-backup.lock
stamp=$(date -u +%Y%m%dT%H%M%SZ)
install -d -o root -g stalwart -m 0710 "$backup_root"
staging=$(mktemp -d "${backup_root}/staging.${stamp}.XXXXXX")
exec 9>"$lock_file"
flock -n 9 || { echo "backup already running" >&2; exit 1; }
stalwart_was_active=0
app_was_active=0

cleanup() {
  if test "$stalwart_was_active" = 1; then systemctl start stalwart >/dev/null 2>&1 || true; fi
  if test "$app_was_active" = 1; then systemctl start dx-youxiang >/dev/null 2>&1 || true; fi
  rm -rf -- "$staging"
}
trap cleanup EXIT INT TERM

test -r "$restic_env" || { echo "missing $restic_env" >&2; exit 1; }
# shellcheck disable=SC1090
. "$restic_env"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
systemctl is-active --quiet stalwart && stalwart_was_active=1
systemctl is-active --quiet dx-youxiang && app_was_active=1
test "$app_was_active" = 0 || systemctl stop dx-youxiang
test "$stalwart_was_active" = 0 || systemctl stop stalwart
chown root:stalwart "$staging"
chmod 0710 "$staging"
install -d -o stalwart -g stalwart -m 0700 "$staging/stalwart-export"
mkdir -p "$staging/config"
runuser -u stalwart -- /usr/local/bin/stalwart --config /etc/stalwart/config.json --export "$staging/stalwart-export"
/opt/dx-youxiang/runtime/node/bin/node /opt/dx-youxiang/current/scripts/sqlite-backup.mjs /var/lib/dx-youxiang/app.db "$staging/app.db"
set -- etc/stalwart etc/dx-youxiang etc/caddy etc/letsencrypt
for path in \
  etc/systemd/system/stalwart.service \
  etc/systemd/system/dx-youxiang.service \
  etc/systemd/system/caddy.service \
  etc/systemd/system/dx-youxiang-backup.service \
  etc/systemd/system/dx-youxiang-backup.timer \
  etc/systemd/system/dx-youxiang-monitor.service \
  etc/systemd/system/dx-youxiang-monitor.timer \
  etc/systemd/system/dx-youxiang-firewall.service
do
  test ! -e "/$path" || set -- "$@" "$path"
done
tar -C / -czf "$staging/config/system-config.tar.gz" "$@"
if test -d /opt/dx-youxiang/current/.git; then
  test -z "$(git -C /opt/dx-youxiang/current status --porcelain)"
  git -C /opt/dx-youxiang/current bundle create "$staging/config/source.bundle" --all
else
  tar -C /opt/dx-youxiang/current -czf "$staging/config/source.tar.gz" \
    --exclude=node_modules --exclude=dist .
fi
test "$stalwart_was_active" = 0 || systemctl start stalwart
test "$app_was_active" = 0 || systemctl start dx-youxiang

restic snapshots >/dev/null 2>&1 || restic init
restic backup "$staging" --tag dx-youxiang --host "$(hostname -f)"
restic forget --tag dx-youxiang --group-by host,tags \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune
restic check --read-data-subset=5%
