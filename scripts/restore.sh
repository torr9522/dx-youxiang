#!/bin/sh
set -eu

umask 077
restic_env=${RESTIC_ENV:-/etc/dx-youxiang/restic.env}
snapshot=${1:-latest}
target=${2:-}
test -n "$target" || { echo "usage: restore.sh <snapshot|latest> <empty-absolute-target-directory>" >&2; exit 1; }
case "$target" in /*) ;; *) echo "target must be absolute" >&2; exit 1;; esac
case "$target" in /|/root|/var|/etc) echo "unsafe target" >&2; exit 1;; esac
test ! -e "$target" || { test -d "$target" && test -z "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)"; } || { echo "target must be empty" >&2; exit 1; }
# shellcheck disable=SC1090
. "$restic_env"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
mkdir -p "$target"
restic restore "$snapshot" --target "$target"
find "$target" -type f ! -name SHA256SUMS -exec sha256sum {} + > "$target/SHA256SUMS"
echo "Restored into $target; live services were not modified."
