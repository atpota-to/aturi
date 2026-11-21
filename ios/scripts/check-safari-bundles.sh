#!/bin/sh
# CI guard for the Safari web extension bundles: every file WXT wrote to
# extension/.output/safari-mv3 must be inside both built AturiSafari.appex
# bundles, byte for byte, at the same path under the bundle's resources
# folder. It catches a copy phase that did not run, ran before the WXT build,
# or copied into the wrong folder. Run it after building the Aturi and
# AturiMac schemes into one derived data folder:
#
#   sh ios/scripts/check-safari-bundles.sh <derived data path> [configuration] [iOS SDK]
#
# The configuration defaults to Debug and the iOS SDK to iphonesimulator
# (use iphoneos for a device build). It checks the copies embedded in the
# apps, since those are what ships.
set -eu

usage() {
  echo "usage: sh ios/scripts/check-safari-bundles.sh <derived data path> [configuration] [iOS SDK]" >&2
  exit 2
}

if [ $# -lt 1 ] || [ $# -gt 3 ]; then
  usage
fi
derived="$1"
config="${2:-Debug}"
ios_sdk="${3:-iphonesimulator}"

repo="$(cd "$(dirname "$0")/../.." && pwd)"
out="$repo/extension/.output/safari-mv3"
products="$derived/Build/Products"

if [ ! -f "$out/manifest.json" ]; then
  echo "error: $out/manifest.json does not exist; nothing to compare against." >&2
  exit 1
fi

files="$(mktemp)"
trap 'rm -f "$files"' EXIT
(cd "$out" && find . -type f | LC_ALL=C sort) > "$files"
total="$(wc -l < "$files" | tr -d ' ')"

status=0

# $1: a name for the report, $2: the bundle's resources folder.
check() {
  name="$1"
  resources="$2"
  if [ ! -d "$resources" ]; then
    echo "error: $name: $resources does not exist. Was it built into $derived?" >&2
    status=1
    return
  fi
  bad=0
  while IFS= read -r file; do
    path="${file#./}"
    if [ ! -f "$resources/$path" ]; then
      echo "error: $name: $path is missing from $resources" >&2
      bad=$((bad + 1))
    elif ! cmp -s "$out/$path" "$resources/$path"; then
      echo "error: $name: $path differs from extension/.output/safari-mv3/$path" >&2
      bad=$((bad + 1))
    fi
  done < "$files"
  if [ "$bad" -eq 0 ]; then
    echo "ok: $name: all $total files match"
  else
    echo "error: $name: $bad of $total files are missing or differ" >&2
    status=1
  fi
}

check "iOS ($config-$ios_sdk)" \
  "$products/$config-$ios_sdk/Aturi.app/PlugIns/AturiSafari.appex"
check "macOS ($config)" \
  "$products/$config/Aturi.app/Contents/PlugIns/AturiSafari.appex/Contents/Resources"

exit "$status"
