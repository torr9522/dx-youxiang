#!/bin/sh
set -eu

version=${1:-}
test "$(id -u)" -eq 0 || { echo "run as root" >&2; exit 1; }
test -n "$version" || { echo "usage: upgrade.sh <version>" >&2; exit 1; }
case "$version" in *[!0-9A-Za-z._-]*) echo "invalid version" >&2; exit 1;; esac

base=/opt/dx-youxiang
PATH="$base/runtime/node/bin:$PATH"
export PATH
release="$base/releases/$version"
test ! -e "$release" || { echo "release already exists: $release" >&2; exit 1; }
tmp=$(mktemp -d /tmp/dx-youxiang-upgrade.XXXXXX)
trap 'rm -rf -- "$tmp"' EXIT INT TERM

archive="dx-youxiang-v${version}.tar.gz"
release_base="https://github.com/torr9522/dx-youxiang/releases/download/v${version}"
if test -n "${DX_YOUXIANG_ARCHIVE_PATH:-}"; then
  case "$DX_YOUXIANG_ARCHIVE_PATH" in /*) ;; *) echo "DX_YOUXIANG_ARCHIVE_PATH must be absolute" >&2; exit 1;; esac
  test -f "$DX_YOUXIANG_ARCHIVE_PATH" -a -r "$DX_YOUXIANG_ARCHIVE_PATH" || { echo "local release archive is not readable" >&2; exit 1; }
  test -n "${DX_YOUXIANG_ARCHIVE_SHA256:-}" || { echo "DX_YOUXIANG_ARCHIVE_SHA256 is required" >&2; exit 1; }
  case $DX_YOUXIANG_ARCHIVE_SHA256 in *[!0-9a-fA-F]*) echo "DX_YOUXIANG_ARCHIVE_SHA256 must be hexadecimal" >&2; exit 1;; esac
  test "${#DX_YOUXIANG_ARCHIVE_SHA256}" -eq 64 || { echo "DX_YOUXIANG_ARCHIVE_SHA256 must contain 64 hex characters" >&2; exit 1; }
  cp "$DX_YOUXIANG_ARCHIVE_PATH" "$tmp/$archive"
  expected=$(printf '%s' "$DX_YOUXIANG_ARCHIVE_SHA256" | tr '[:upper:]' '[:lower:]')
else
  curl --proto '=https' --tlsv1.2 -fsSL \
    "$release_base/$archive" -o "$tmp/$archive"
  curl --proto '=https' --tlsv1.2 -fsSL \
    "$release_base/SHA256SUMS" -o "$tmp/SHA256SUMS"
  expected=$(awk -v file="$archive" '$2 == file {print $1}' "$tmp/SHA256SUMS")
  checksum_count=$(awk -v file="$archive" '$2 == file {count++} END {print count + 0}' "$tmp/SHA256SUMS")
  if test -z "$expected" || test "$checksum_count" -ne 1; then echo "missing or duplicate checksum for $archive" >&2; exit 1; fi
fi
printf '%s  %s\n' "$expected" "$tmp/$archive" | sha256sum -c -
mkdir "$tmp/source"
tar -xzf "$tmp/$archive" --strip-components=1 -C "$tmp/source"
test "$("$base/runtime/node/bin/node" -p "require('$tmp/source/package.json').version")" = "${version%%-*}" || {
  echo "package version does not match release" >&2
  exit 1
}

config_dir=/etc/dx-youxiang
app_env=$config_dir/app.env
admin_credentials=$config_dir/stalwart-admin.json
test -r "$app_env" || { echo "application environment is missing" >&2; exit 1; }
test -r "$admin_credentials" || { echo "Stalwart administrator credentials are missing" >&2; exit 1; }
mail_domain=$(sed -n 's/^MAIL_DOMAIN=//p' "$app_env" | tail -1)
mail_host=$(sed -n 's/^MAIL_HOST=//p' "$app_env" | tail -1)
service_password=$(sed -n 's/^STALWART_PASSWORD=//p' "$app_env" | tail -1)
app_port=$(sed -n 's/^PORT=//p' "$app_env" | tail -1)
test -n "$mail_domain" -a -n "$mail_host" -a -n "$service_password" -a -n "$app_port" || {
  echo "application environment is incomplete" >&2
  exit 1
}

wait_http() {
  url=$1
  wait_attempt=0
  while ! curl -fsS --max-time 10 "$url" >/dev/null 2>&1; do
    wait_attempt=$((wait_attempt + 1))
    test "$wait_attempt" -lt 45 || return 1
    sleep 1
  done
}

configure_stalwart() {
  enable_sending=$1
  output_file=$2
  MODE=configure ENABLE_SENDING="$enable_sending" SERVICE_PASSWORD="$service_password" \
    OUTPUT_FILE="$output_file" ADMIN_CREDENTIAL_FILE="$admin_credentials" \
    MAIL_HOST="$mail_host" MAIL_DOMAIN="$mail_domain" \
    "$base/runtime/node/bin/node" "$release/scripts/bootstrap-stalwart.mjs"
  test "$(jq -r .servicePassword "$output_file")" = "$service_password" || {
    echo "Stalwart service credential changed unexpectedly" >&2
    return 1
  }
}

restore_receive_only() {
  configure_stalwart false "$tmp/stalwart-service.rollback.json" || return 1
  systemctl restart stalwart
  wait_http http://127.0.0.1:8080/.well-known/jmap
}

"$base/current/scripts/backup.sh"
mkdir -p "$base/releases"
mv "$tmp/source" "$release"
cd "$release"
"$base/runtime/node/bin/npm" ci
"$base/runtime/node/bin/npm" run build
"$base/runtime/node/bin/npm" prune --omit=dev
chown -R root:dx-youxiang "$release"
previous=$(readlink -f "$base/current")
firewall_unit=/etc/systemd/system/dx-youxiang-firewall.service
had_firewall_unit=false
if test -f "$firewall_unit"; then
  had_firewall_unit=true
  cp -a "$firewall_unit" "$tmp/firewall.service.previous"
fi

rollback_upgrade() {
  ln -sfn "$previous" "$base/current.next"
  mv -Tf "$base/current.next" "$base/current"
  if test "$had_firewall_unit" = true; then
    cp -a "$tmp/firewall.service.previous" "$firewall_unit"
  else
    rm -f "$firewall_unit"
  fi
  systemctl daemon-reload
  restore_receive_only
  systemctl restart dx-youxiang-firewall.service
  systemctl restart dx-youxiang
  wait_http "http://127.0.0.1:${app_port}/readyz"
}

if ! configure_stalwart true "$tmp/stalwart-service.json"; then
  restore_receive_only >/dev/null 2>&1 || true
  echo "upgrade failed while configuring Stalwart; receive-only policy was requested" >&2
  exit 1
fi
if ! systemctl restart stalwart || ! wait_http http://127.0.0.1:8080/.well-known/jmap; then
  restore_receive_only >/dev/null 2>&1 || true
  echo "upgrade failed while restarting Stalwart; receive-only policy was requested" >&2
  exit 1
fi

install -o root -g root -m 0644 "$release/deploy/systemd/dx-youxiang-firewall.service" "$firewall_unit"
ln -sfn "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
if ! systemctl daemon-reload \
  || ! systemctl restart dx-youxiang-firewall.service \
  || ! systemctl restart dx-youxiang \
  || ! wait_http "http://127.0.0.1:${app_port}/readyz"; then
  if ! rollback_upgrade; then
    echo "upgrade failed and the previous release did not recover readiness" >&2
    exit 1
  fi
  echo "upgrade failed readiness check and was rolled back" >&2
  exit 1
fi
install -o root -g root -m 0600 "$tmp/stalwart-service.json" "$config_dir/stalwart-service.json"
echo "Dx Youxiang upgraded to $version"
