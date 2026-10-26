#!/usr/bin/env bash
# Mirror the package in the current directory to GitHub Packages
# (npm.pkg.github.com), unless that exact version is already there. Run from a
# package directory by the release workflow, after the npm publish has landed.
#
# Why the name changes: GitHub Packages only accepts a scope that matches the
# repository owner, and it rejects dots inside a scope, so `@aturi.to/waypoints`
# cannot go up as-is. The mirror publishes as `@atpota-to/waypoints`. Only the
# package's own `name` is rewritten - the rewrite is reverted immediately after,
# so the working copy npm published from stays untouched.
#
# What is deliberately NOT rewritten: `@aturi.to/waypoints-react`'s dependency on
# `@aturi.to/waypoints`. Its built bundle re-exports that exact specifier
# (`export * from '@aturi.to/waypoints'`), so the dependency has to keep
# resolving to the npm package. That also means installing the react mirror
# pulls its core from npmjs, which needs no token.
#
# Auth is the workflow's GITHUB_TOKEN (`packages: write`) passed as
# NODE_AUTH_TOKEN. No --provenance: GitHub Packages does not accept provenance
# attestations, and asking for one fails the publish.
set -euo pipefail

registry=${PUBLISH_REGISTRY:-https://npm.pkg.github.com}

# npm scopes are lowercase; GitHub owner logins are not guaranteed to be.
owner=$(printf '%s' "${GITHUB_REPOSITORY_OWNER:?GITHUB_REPOSITORY_OWNER is not set}" | tr '[:upper:]' '[:lower:]')

name=$(node -p 'require("./package.json").name')
version=$(node -p 'require("./package.json").version')
mirror="@${owner}/${name##*/}"

# `npm view pkg@version` exits non-zero (E404) when the version isn't published,
# which is also the very first run, before the package exists at all.
if npm view "$mirror@$version" version --registry="$registry" >/dev/null 2>&1; then
  echo "$mirror@$version is already on GitHub Packages - skipping"
  summary="skipped (already published)"
else
  echo "Publishing $name@$version to GitHub Packages as $mirror"

  # Restore the manifest byte-for-byte however this exits: `npm pkg set`
  # reformats the file, and the next package's build resolves this one through
  # the workspace symlink by its real name.
  cp package.json package.json.orig
  trap 'mv -f package.json.orig package.json' EXIT

  npm pkg set name="$mirror"
  npm publish --registry="$registry"

  summary="published as \`$mirror\`"
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "- \`$name@$version\` - $summary" >> "$GITHUB_STEP_SUMMARY"
fi
