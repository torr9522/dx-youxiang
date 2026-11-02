#!/bin/sh
set -eu
test "$(id -u)" -eq 0
release_dir=${1:-}
test -n "$release_dir" && test -f "$release_dir/package-lock.json" || { echo "usage: update.sh <verified-release-directory>" >&2; exit 1; }
previous=/opt/private-mail-hub.previous
systemctl stop private-mail-hub
rm -f "$previous"
ln -s "$(readlink -f /opt/private-mail-hub)" "$previous"
cd "$release_dir"
npm ci --omit=dev
npm run build
ln -sfn "$release_dir" /opt/private-mail-hub
systemctl start private-mail-hub
curl -fsS http://127.0.0.1:3000/healthz >/dev/null || { ln -sfn "$(readlink -f "$previous")" /opt/private-mail-hub; systemctl restart private-mail-hub; exit 1; }
