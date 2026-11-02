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
curl --proto '=https' --tlsv1.2 -fsSL \
  "$release_base/$archive" -o "$tmp/$archive"
curl --proto '=https' --tlsv1.2 -fsSL \
  "$release_base/SHA256SUMS" -o "$tmp/SHA256SUMS"
expected=$(awk -v file="$archive" '$2 == file {print $1}' "$tmp/SHA256SUMS")
checksum_count=$(awk -v file="$archive" '$2 == file {count++} END {print count + 0}' "$tmp/SHA256SUMS")
if test -z "$expected" || test "$checksum_count" -ne 1; then echo "missing or duplicate checksum for $archive" >&2; exit 1; fi
printf '%s  %s\n' "$expected" "$tmp/$archive" | sha256sum -c -
mkdir "$tmp/source"
tar -xzf "$tmp/$archive" --strip-components=1 -C "$tmp/source"
test "$("$base/runtime/node/bin/node" -p "require('$tmp/source/package.json').version")" = "${version%%-*}" || {
  echo "package version does not match release" >&2
  exit 1
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
ln -sfn "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
systemctl restart dx-youxiang
app_port=$(sed -n 's/^PORT=//p' /etc/dx-youxiang/app.env | tail -1)
if ! curl -fsS --max-time 10 "http://127.0.0.1:${app_port}/readyz" >/dev/null; then
  ln -sfn "$previous" "$base/current.next"
  mv -Tf "$base/current.next" "$base/current"
  systemctl restart dx-youxiang
  echo "upgrade failed readiness check and was rolled back" >&2
  exit 1
fi
echo "Dx Youxiang upgraded to $version"
