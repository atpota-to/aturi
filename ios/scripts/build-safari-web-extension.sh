#!/bin/sh
# Builds the Safari version of the web extension (extension/, WXT) into
# extension/.output/safari-mv3. Xcode runs this from the AturiSafariWeb
# aggregate target (ios/project.yml) before either Safari extension target
# copies that folder into its bundle with copy-safari-web-extension.sh.
#
# Xcode.app runs build phases with launchd's PATH, which has no node, so
# this looks for it in order: NODE_BINARY from the environment; NODE_BINARY
# from ios/.xcode.env.local (gitignored, read as shell, for example
# `export NODE_BINARY="$HOME/.nvm/versions/node/v22.22.0/bin/node"`); the
# PATH Xcode passed in (xcodebuild in a terminal or CI passes the shell's);
# then Homebrew and the volta, mise and asdf shims.
#
# ATURI_SKIP_WEB_BUILD=1 reuses the folder as it is, for example after
# running `npm run build:safari` yourself. Pass it to xcodebuild as a build
# setting (`xcodebuild ... ATURI_SKIP_WEB_BUILD=1`), or export it from
# ios/.xcode.env.local for builds in Xcode.app. The build still fails if
# there is no manifest.json to copy.
set -eu

fail() {
  # Xcode lists lines that start with "error: " as build errors.
  echo "error: $*" >&2
  exit 1
}

ios_dir="${SRCROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
repo="$(cd "$ios_dir/.." && pwd)"
ext="$repo/extension"
out="$ext/.output/safari-mv3"

env_node="${NODE_BINARY:-}"
if [ -f "$ios_dir/.xcode.env.local" ]; then
  # shellcheck disable=SC1091 # per-developer file, not in the repo
  . "$ios_dir/.xcode.env.local"
fi
if [ -n "$env_node" ]; then
  NODE_BINARY="$env_node"
fi

if [ "${ATURI_SKIP_WEB_BUILD:-0}" = "1" ]; then
  [ -f "$out/manifest.json" ] ||
    fail "ATURI_SKIP_WEB_BUILD=1 but $out/manifest.json does not exist. Run 'npm run build:safari' in extension/ first, or build without ATURI_SKIP_WEB_BUILD."
  echo "ATURI_SKIP_WEB_BUILD=1: using the existing $out"
  exit 0
fi

if [ -n "${NODE_BINARY:-}" ]; then
  [ -x "$NODE_BINARY" ] || fail "NODE_BINARY is set to $NODE_BINARY, which is not an executable."
  PATH="$(dirname "$NODE_BINARY"):$PATH"
fi
home="${HOME:-}"
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$home/.volta/bin:$home/.local/share/mise/shims:$home/.asdf/shims"
export PATH

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  fail "node and npm were not found. Xcode does not see your shell's PATH: set NODE_BINARY in ios/.xcode.env.local (export NODE_BINARY=/path/to/node) or install Node with Homebrew."
fi
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' ||
  fail "$(command -v node) is Node $(node --version); the extension needs Node 22 or newer (.nvmrc pins the version CI uses)."

# The extension imports ../src/utils through the @aturi/* alias, and those
# files import root packages, so both installs are needed.
for dir in "$repo/node_modules" "$ext/node_modules"; do
  [ -d "$dir" ] ||
    fail "$dir is missing. Run 'npm ci' at the repo root and again in extension/, then build again."
done

echo "Building the Safari web extension with $(command -v node) ($(node --version))"
cd "$ext"
npm run build:safari
[ -f "$out/manifest.json" ] ||
  fail "'npm run build:safari' finished but $out/manifest.json does not exist."
