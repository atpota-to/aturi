/**
 * Generate an ES256 private key (JWK) for the confidential OAuth client.
 *
 * Run once locally:
 *
 *   node scripts/generate-oauth-key.mjs
 *
 * Copy the single-line JSON it prints into the OAUTH_PRIVATE_KEY_1 environment
 * variable (Vercel project settings + your local .env.local). The public half
 * is derived automatically and published at /api/oauth/jwks.json — never put
 * the private key in a NEXT_PUBLIC_* var or commit it.
 *
 * To rotate, generate a second key with kid "key2" and set OAUTH_PRIVATE_KEY_2
 * alongside the first; both stay in the published JWKS.
 */

import { generateKeyPair, exportJWK } from 'jose';

const kid = process.argv[2] || 'key1';

const { privateKey } = await generateKeyPair('ES256', { extractable: true });
const jwk = await exportJWK(privateKey);
jwk.use = 'sig';
jwk.alg = 'ES256';
jwk.kid = kid;

console.log('\nOAUTH_PRIVATE_KEY_1 (kid=%s) — paste as a single line:\n', kid);
console.log(JSON.stringify(jwk));
console.log();
