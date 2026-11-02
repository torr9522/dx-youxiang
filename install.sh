#!/bin/sh
set -eu

DX_YOUXIANG_VERSION=${DX_YOUXIANG_VERSION:-0.1.0}
export DX_YOUXIANG_VERSION
test "$(id -u)" -eq 0 || { echo "run as root" >&2; exit 1; }
test ! -e /opt/dx-youxiang || { echo "/opt/dx-youxiang already exists; use the upgrade script" >&2; exit 1; }

if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl tar
fi

tmp=$(mktemp -d /tmp/dx-youxiang-bootstrap.XXXXXX)
trap 'rm -rf -- "$tmp"' EXIT INT TERM
archive="dx-youxiang-v${DX_YOUXIANG_VERSION}.tar.gz"
release_base="https://github.com/torr9522/dx-youxiang/releases/download/v${DX_YOUXIANG_VERSION}"
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
test -x "$tmp/source/scripts/install.sh"

install -d -m 0755 /opt/dx-youxiang/releases /opt/dx-youxiang/runtime
mv "$tmp/source" "/opt/dx-youxiang/releases/$DX_YOUXIANG_VERSION"
ln -s "/opt/dx-youxiang/releases/$DX_YOUXIANG_VERSION" /opt/dx-youxiang/current
exec /opt/dx-youxiang/current/scripts/install.sh "$@"
