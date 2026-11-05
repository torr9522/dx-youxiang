#!/bin/sh
set -eu

version=${1:-}
output=${2:-}
if test -z "$version" || test -z "$output"; then echo "usage: build-release.sh <version> <empty-output-directory>" >&2; exit 1; fi
case "$version" in *[!0-9A-Za-z._-]*) echo "invalid version" >&2; exit 1;; esac
test ! -e "$output" || { test -d "$output" && test -z "$(find "$output" -mindepth 1 -maxdepth 1 -print -quit)"; } || { echo "output directory must be empty" >&2; exit 1; }

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
ref="v$version"
test -z "$(git -C "$root" status --porcelain)" || { echo "working tree must be clean" >&2; exit 1; }
test "$(git -C "$root" rev-parse "$ref^{commit}")" = "$(git -C "$root" rev-parse HEAD)" || { echo "$ref must identify HEAD" >&2; exit 1; }

mkdir -p "$output"
archive="dx-youxiang-v${version}.tar.gz"
zip_archive="dx-youxiang-v${version}.zip"
git -C "$root" archive --format=tar --prefix="dx-youxiang-v${version}/" "$ref" | gzip -n > "$output/$archive"
git -C "$root" archive --format=zip --prefix="dx-youxiang-v${version}/" --output="$output/$zip_archive" "$ref"
cp "$root/install.sh" "$output/install.sh"
cp "$root/RELEASE_NOTES.md" "$output/RELEASE_NOTES.md"
cp "$root/sbom.cdx.json" "$output/sbom.cdx.json"
(
  cd "$output"
  sha256sum "$archive" "$zip_archive" install.sh RELEASE_NOTES.md sbom.cdx.json > SHA256SUMS
)
echo "Release assets created in $output"
