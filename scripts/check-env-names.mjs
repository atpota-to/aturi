#!/usr/bin/env node
/**
 * Fail the build if a secret-looking environment variable is read through a
 * NEXT_PUBLIC_ name.
 *
 * Next inlines every NEXT_PUBLIC_* value into the client bundle. A single
 * typo — NEXT_PUBLIC_ATURI_OAUTH_JWK_ACTIVE instead of the bare name — ships
 * the confidential client's private signing key to every visitor, silently and
 * with no error anywhere. One regex is cheap insurance against that.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const FORBIDDEN = /NEXT_PUBLIC_[A-Z0-9_]*(JWK|SERVICE_KEY|SECRET|ENC_KEY|PRIVATE)/;
const ROOTS = ['src', 'scripts'];
const EXTS = /\.(ts|tsx|mjs|js|jsx)$/;

// This file necessarily spells the pattern out, in the docstring above and in
// the regex below.
const SELF = resolve(fileURLToPath(import.meta.url));

const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!EXTS.test(entry)) continue;
    if (resolve(full) === SELF) continue;
    const lines = readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const hit = line.match(FORBIDDEN);
      if (hit) offenders.push(`${full}:${i + 1}  ${hit[0]}`);
    });
  }
}

for (const root of ROOTS) walk(root);

if (offenders.length > 0) {
  console.error('Secret-shaped NEXT_PUBLIC_ environment names found:\n');
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    '\nNEXT_PUBLIC_ values are inlined into the client bundle. Drop the prefix.',
  );
  process.exit(1);
}
