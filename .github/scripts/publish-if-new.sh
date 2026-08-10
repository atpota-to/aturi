#!/usr/bin/env bash
# Publish the package in the current directory, unless that exact version is
# already on the registry. Run from a package directory by the release workflow.
#
# The skip makes releases idempotent: re-running a failed workflow won't trip
# over "cannot publish over previously published version", and bumping only one
# of the two packages leaves the other alone instead of failing the run.
#
# Auth comes from the workflow's OIDC token (npm trusted publishing), so there
# is no token to pass here. --provenance is explicit: trusted publishing is
# documented to attach provenance on its own, but asking for it turns a silent
# omission into a loud failure. It stays out of publishConfig so that a manual
# `npm publish` from a laptop - where provenance can't be generated - still works.
set -euo pipefail

name=$(node -p 'require("./package.json").name')
version=$(node -p 'require("./package.json").version')

# `npm view pkg@version` exits non-zero (E404) when the version isn't published.
if npm view "$name@$version" version >/dev/null 2>&1; then
  echo "$name@$version is already published - skipping"
  summary="skipped (already published)"
else
  echo "Publishing $name@$version"
  npm publish --provenance --access public
  summary="published"
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "- \`$name@$version\` - $summary" >> "$GITHUB_STEP_SUMMARY"
fi
