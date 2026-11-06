#!/usr/bin/env node
/**
 * Generate the confidential OAuth client's signing key.
 *
 * ES256 (ECDSA P-256), not RS256. `@atproto/oauth-client-node` requires it,
 * and an ES256 JWK is ~250 bytes against ~1.6kB for RSA-2048 — which matters
 * against Vercel's 64kB total environment-variable budget.
 *
 * Prints to stdout and never writes a file. This repository is force-pushed to
 * the Tangled mirror on every push, so a key written into the working tree is
 * one `git add .` away from being published. Copy the line into the Vercel
 * dashboard directly.
 *
 *   node scripts/generate-oauth-key.mjs
 *   node scripts/generate-oauth-key.mjs --kid my-own-label
 *
 * The `kid` is required rather than defaulted, and each key must have a unique
 * one. The reference implementation this is adapted from defaults `kid` by
 * slot position (`key1`, `key2`, …), so rotating by swapping slot *values*
 * silently reuses one `kid` for two different keys and the authorization
 * server picks whichever it cached.
 */

import { generateKeyPairSync, randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const kidFlag = args.indexOf('--kid');
const kid =
  kidFlag >= 0 && args[kidFlag + 1]
    ? args[kidFlag + 1]
    : `aturi-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`;

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = privateKey.export({ format: 'jwk' });

// `use` is deliberately absent: @atproto/jwk rejects a key that carries it
// alongside `alg`. `kid` and `alg` are what the keyset loader requires.
const out = { ...jwk, alg: 'ES256', kid };

process.stdout.write(`${JSON.stringify(out)}\n`);
process.stderr.write(
  [
    '',
    `Generated an ES256 signing key with kid "${kid}".`,
    '',
    'Set it as ATURI_OAUTH_JWK_ACTIVE in the Vercel project, scoped to',
    'Production only (the dashboard default is Production + Preview +',
    'Development, which would place this private key in every PR preview).',
    '',
    'To rotate: set the new key as ATURI_OAUTH_JWK_ACTIVE, move the old one to',
    'ATURI_OAUTH_JWK_RETIRED, deploy, wait past the authorization server\'s',
    'JWKS cache (~10 minutes), then clear ATURI_OAUTH_JWK_RETIRED.',
    '',
  ].join('\n'),
);
