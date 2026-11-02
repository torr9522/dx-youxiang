#!/bin/sh
set -eu

umask 077
source_dir=${1:-}
confirm=${MIGRATION_CONFIRM:-}
app_base=${APP_BASE:-/opt/dx-youxiang}
config_dir=${CONFIG_DIR:-/etc/dx-youxiang}
data_dir=${DATA_DIR:-/var/lib/dx-youxiang}
stalwart_data=${STALWART_DATA:-/var/lib/stalwart}
stalwart_config=${STALWART_CONFIG:-/etc/stalwart/config.json}
node_bin=${NODE_BIN:-$app_base/runtime/node/bin/node}

usage() {
  echo "usage: MIGRATION_CONFIRM=restore-into-dx-youxiang migrate-legacy.sh <restored-backup-staging-directory>" >&2
  exit 1
}

test "$(id -u)" -eq 0 || { echo "run as root" >&2; exit 1; }
test "$confirm" = restore-into-dx-youxiang || usage
test -d "$source_dir" || usage
case "$source_dir" in /*) ;; *) echo "source directory must be absolute" >&2; exit 1;; esac
test -d "$source_dir/stalwart-export" || { echo "missing Stalwart export" >&2; exit 1; }
test -s "$source_dir/app.db" || { echo "missing application database" >&2; exit 1; }
test -s "$source_dir/config/system-config.tar.gz" || { echo "missing protected configuration archive" >&2; exit 1; }
test -x "$node_bin" || { echo "missing private Node.js runtime" >&2; exit 1; }
test -x /usr/local/bin/stalwart || { echo "missing Stalwart binary" >&2; exit 1; }
test -s "$stalwart_config" || { echo "missing Stalwart configuration" >&2; exit 1; }

test "$(sqlite3 "$source_dir/app.db" 'PRAGMA integrity_check;')" = ok || {
  echo "source SQLite integrity check failed" >&2
  exit 1
}
for table in domains mailboxes sessions login_attempts audit_log; do
  test "$(sqlite3 "$source_dir/app.db" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$table';")" = 1 || {
    echo "source SQLite table is missing: $table" >&2
    exit 1
  }
done
find "$source_dir/stalwart-export" -type f -name 'subspace_*' -size +0c -print -quit | grep -q . || {
  echo "Stalwart export is empty" >&2
  exit 1
}

archive=$source_dir/config/system-config.tar.gz
if ! tar -tzf "$archive" | awk -f "$app_base/current/scripts/validate-tar-paths.awk"; then
  echo "unsafe path in configuration archive" >&2
  exit 1
fi

legacy_prefix=
for candidate in etc/private-mail-hub etc/dx-youxiang; do
  if tar -tzf "$archive" | grep -Fqx "$candidate/app.env" \
    && tar -tzf "$archive" | grep -Fqx "$candidate/stalwart-admin.json"; then
    legacy_prefix=$candidate
    break
  fi
done
test -n "$legacy_prefix" || { echo "protected application credentials were not found" >&2; exit 1; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d /var/tmp/dx-youxiang-migration.XXXXXX)
rollback=/var/backups/dx-youxiang/pre-migration.$stamp
new_store=/var/lib/stalwart.import.$stamp
new_db=$data_dir/app.db.import.$stamp
services_stopped=0
swap_started=0
cleanup() {
  status=$?
  if test "$status" -ne 0 && test "$services_stopped" -eq 1; then
    systemctl stop dx-youxiang >/dev/null 2>&1 || true
    systemctl stop stalwart >/dev/null 2>&1 || true
    if test "$swap_started" -eq 1; then
      if test -d "$rollback/stalwart-data"; then
        test ! -e "$stalwart_data" || mv "$stalwart_data" "$rollback/failed-stalwart-data"
        mv "$rollback/stalwart-data" "$stalwart_data"
      fi
      if test -f "$rollback/installed-app.db"; then
        test ! -e "$data_dir/app.db" || mv "$data_dir/app.db" "$rollback/failed-app.db"
        mv "$rollback/installed-app.db" "$data_dir/app.db"
      fi
      if test -d "$rollback/config"; then cp -a "$rollback/config/." "$config_dir/"; fi
    fi
    systemctl start stalwart >/dev/null 2>&1 || true
    systemctl start dx-youxiang >/dev/null 2>&1 || true
  fi
  rm -rf -- "$work"
  trap - EXIT INT TERM
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$work/protected" "$work/import"
chown root:stalwart "$work"
chmod 0710 "$work"
chown root:stalwart "$work/import"
chmod 0750 "$work/import"
tar -xzf "$archive" -C "$work/protected" \
  "$legacy_prefix/app.env" "$legacy_prefix/stalwart-admin.json"
legacy_env=$work/protected/$legacy_prefix/app.env
legacy_admin=$work/protected/$legacy_prefix/stalwart-admin.json
jq -e '.username | type == "string" and length > 0' "$legacy_admin" >/dev/null
jq -e '.secret | type == "string" and length > 0' "$legacy_admin" >/dev/null

admin_hash=$(sed -n \
  -e "s/^ADMIN_PASSWORD_HASH='\(.*\)'$/\1/p" \
  -e 's/^ADMIN_PASSWORD_HASH="\(.*\)"$/\1/p' \
  -e '/^ADMIN_PASSWORD_HASH=[^'"'"'"]/s/^ADMIN_PASSWORD_HASH=//p' \
  "$legacy_env" | head -n 1)
admin_user=$(sed -n 's/^ADMIN_USERNAME=//p' "$legacy_env" | head -n 1)
case "$admin_hash" in \$argon2id\$*) ;; *) echo "legacy administrator hash is invalid" >&2; exit 1;; esac
test -n "$admin_user" || { echo "legacy administrator name is missing" >&2; exit 1; }

mail_domain=$(sed -n 's/^MAIL_DOMAIN=//p' "$config_dir/app.env" | head -n 1)
mail_host=$(sed -n 's/^MAIL_HOST=//p' "$config_dir/app.env" | head -n 1)
app_port=$(sed -n 's/^PORT=//p' "$config_dir/app.env" | head -n 1)
if test -z "$mail_domain" || test -z "$mail_host" || test -z "$app_port"; then
  echo "installed application configuration is incomplete" >&2
  exit 1
fi
quoted_domain=$(printf '%s' "$mail_domain" | sed "s/'/''/g")
test "$(sqlite3 "$source_dir/app.db" "SELECT count(*) FROM domains WHERE lower(name)=lower('$quoted_domain');")" -ge 1 || {
  echo "backup domain does not match the installed domain" >&2
  exit 1
}

echo "Creating a pre-migration encrypted backup..."
systemctl start dx-youxiang-backup.service
mkdir -p "$rollback"
chmod 0700 "$rollback"
cp -a "$config_dir" "$rollback/config"
cp -a "$data_dir/app.db" "$rollback/app.db"

systemctl stop dx-youxiang
systemctl stop stalwart
services_stopped=1
mkdir -p "$new_store"
chown stalwart:stalwart "$new_store"
chmod 0750 "$new_store"
import_config=$work/import/config.json
jq --arg path "$new_store/" '.path = $path' "$stalwart_config" > "$import_config"
chown stalwart:stalwart "$import_config"
chmod 0600 "$import_config"
runuser -u stalwart -- /usr/local/bin/stalwart --config "$import_config" --import "$source_dir/stalwart-export"

cp "$source_dir/app.db" "$new_db"
chown dx-youxiang:dx-youxiang "$new_db"
chmod 0600 "$new_db"
test "$(sqlite3 "$new_db" 'PRAGMA integrity_check;')" = ok

swap_started=1
mv "$stalwart_data" "$rollback/stalwart-data"
mv "$new_store" "$stalwart_data"
mv "$data_dir/app.db" "$rollback/installed-app.db"
mv "$new_db" "$data_dir/app.db"
chown -R stalwart:stalwart "$stalwart_data"
chown dx-youxiang:dx-youxiang "$data_dir/app.db"

install -o root -g root -m 0600 "$legacy_admin" "$config_dir/stalwart-admin.json"
systemctl start stalwart
attempt=1
while test "$attempt" -le 45; do
  curl -fsS --max-time 2 http://127.0.0.1:8080/.well-known/jmap >/dev/null 2>&1 && break
  sleep 1
  attempt=$((attempt + 1))
done
test "$attempt" -le 45 || { echo "imported Stalwart store did not start; rollback is in $rollback" >&2; exit 1; }

MODE=reindex OUTPUT_FILE="$rollback/reindex-task.json" \
  ADMIN_CREDENTIAL_FILE="$config_dir/stalwart-admin.json" \
  "$node_bin" "$app_base/current/scripts/bootstrap-stalwart.mjs"
MODE=configure OUTPUT_FILE="$config_dir/stalwart-service.json.new" \
  ADMIN_CREDENTIAL_FILE="$config_dir/stalwart-admin.json" MAIL_HOST="$mail_host" MAIL_DOMAIN="$mail_domain" \
  "$node_bin" "$app_base/current/scripts/bootstrap-stalwart.mjs"
install -o root -g root -m 0600 "$config_dir/stalwart-service.json.new" "$config_dir/stalwart-service.json"
rm -f "$config_dir/stalwart-service.json.new"

service_username=$(jq -r .serviceUsername "$config_dir/stalwart-service.json")
service_password=$(jq -r .servicePassword "$config_dir/stalwart-service.json")
session_secret=$(openssl rand -base64 48 | tr -d '\n')
cat > "$config_dir/app.env.new" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=$app_port
PUBLIC_ORIGIN=https://$mail_host
MAIL_DOMAIN=$mail_domain
MAIL_HOST=$mail_host
DATABASE_PATH=$data_dir/app.db
ADMIN_USERNAME=$admin_user
ADMIN_PASSWORD_HASH='$admin_hash'
SESSION_SECRET='$session_secret'
STALWART_BASE_URL=http://127.0.0.1:8080
STALWART_USERNAME=$service_username
STALWART_PASSWORD=$service_password
TLS_CERT_PATH=$config_dir/tls/fullchain.pem
MAIL_STORAGE_PATH=$stalwart_data
TRUST_PROXY=loopback
EOF
chown root:dx-youxiang "$config_dir/app.env.new"
chmod 0640 "$config_dir/app.env.new"
mv "$config_dir/app.env.new" "$config_dir/app.env"

systemctl restart stalwart
systemctl start dx-youxiang
"$app_base/current/scripts/health-check.sh"
services_stopped=0

sqlite_mailboxes=$(sqlite3 "$data_dir/app.db" 'SELECT count(*) FROM mailboxes;')
sqlite_domains=$(sqlite3 "$data_dir/app.db" 'SELECT count(*) FROM domains;')
echo "Migration completed. SQLite domains=$sqlite_domains mailboxes=$sqlite_mailboxes"
echo "Rollback material was retained at $rollback"
echo "Run content-level mailbox, folder, message, attachment, flag and permission checks before deleting it."
