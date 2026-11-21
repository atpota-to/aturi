#!/bin/sh
# Copies the WXT Safari build (extension/.output/safari-mv3) into the Safari
# web extension bundle being built. Xcode runs this as the last build phase
# of AturiSafari-iOS and AturiSafari-macOS (ios/project.yml), so the files
# are in place before the bundle is signed.
#
# The folder's contents go flat into the bundle's resources folder, which is
# where Safari looks for manifest.json:
#
#   iOS:    AturiSafari.appex/manifest.json
#   macOS:  AturiSafari.appex/Contents/Resources/manifest.json
#
# On iOS that folder is the bundle root, next to the executable and
# Info.plist, so this never mirrors with deletion. It removes only files it
# copied on an earlier build that WXT no longer writes (chunk names change
# with their contents), using the list of copied files it keeps in
# DERIVED_FILE_DIR.
set -eu

fail() {
  # Xcode lists lines that start with "error: " as build errors.
  echo "error: $*" >&2
  exit 1
}

if [ -z "${TARGET_BUILD_DIR:-}" ] || [ -z "${UNLOCALIZED_RESOURCES_FOLDER_PATH:-}" ]; then
  fail "TARGET_BUILD_DIR and UNLOCALIZED_RESOURCES_FOLDER_PATH are not set. Xcode sets them; this script runs as a build phase."
fi

ios_dir="${SRCROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
src="$(cd "$ios_dir/.." && pwd)/extension/.output/safari-mv3"
dest="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"

[ -f "$src/manifest.json" ] ||
  fail "$src/manifest.json does not exist. The AturiSafariWeb target builds it with 'npm run build:safari' in extension/; check that target's log, or run that command yourself."

mkdir -p "$dest"

# What this build copies, as paths relative to the folder, sorted so comm
# can compare it with the previous build's list.
list=""
if [ -n "${DERIVED_FILE_DIR:-}" ]; then
  mkdir -p "$DERIVED_FILE_DIR"
  list="$DERIVED_FILE_DIR/safari-web-extension-files.txt"
fi
current="$(mktemp)"
trap 'rm -f "$current"' EXIT
(cd "$src" && find . -type f | LC_ALL=C sort) > "$current"

if [ -n "$list" ] && [ -f "$list" ]; then
  LC_ALL=C comm -23 "$list" "$current" | while IFS= read -r stale; do
    case "$stale" in
      ./*) ;;
      *) continue ;;
    esac
    case "$stale" in
      */../* | */..) continue ;;
    esac
    rm -f "$dest/${stale#./}"
  done
fi

# -X on macOS leaves extended attributes and resource forks behind, which
# codesign refuses to sign over. GNU cp (Linux, for testing this script) has
# no -X and copies none by default.
if [ "$(uname -s)" = "Darwin" ]; then
  cp -R -X "$src/." "$dest/"
else
  cp -R "$src/." "$dest/"
fi

[ -f "$dest/manifest.json" ] || fail "copied $src but $dest/manifest.json is missing."
if [ -n "$list" ]; then
  cp "$current" "$list"
fi
echo "Copied $(wc -l < "$current" | tr -d ' ') files from $src to $dest"
