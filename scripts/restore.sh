#!/bin/sh
set -eu

umask 077
restic_env=${RESTIC_ENV:-/etc/private-mail-hub/restic.env}
snapshot=${1:-latest}
target=${2:-}
test -n "$target" || { echo "usage: restore.sh <snapshot|latest> <empty-absolute-target-directory>" >&2; exit 1; }
case "$target" in /*) ;; *) echo "target must be absolute" >&2; exit 1;; esac
test "$target" != / && test "$target" != /root && test "$target" != /var && test "$target" != /etc || { echo "unsafe target" >&2; exit 1; }
test ! -e "$target" || { test -d "$target" && test -z "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)"; } || { echo "target must be empty" >&2; exit 1; }
. "$restic_env"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
mkdir -p "$target"
restic restore "$snapshot" --target "$target"
find "$target" -type f -exec sha256sum {} + > "$target/SHA256SUMS"
echo "Restored into $target; live services were not modified."
