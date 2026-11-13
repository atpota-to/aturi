/**
 * Loading the confidential client's signing keys. SERVER ONLY.
 *
 * Everything here fails closed, because each of the three failure modes below
 * is one the reference implementation has and each is silent:
 *
 *   - A JWK without an explicit `kid` is rejected. The reference defaults `kid`
 *     by slot position (`key1`, `key2`, …), so rotating by swapping slot values
 *     reuses one `kid` for two different keys and the authorization server
 *     serves whichever it cached.
 *   - A malformed key in the rotation slot is an error, not a warn-and-skip, so
 *     a half-applied rotation cannot look successful.
 *   - No key at all is an error. The reference falls back to
 *     `token_endpoint_auth_method: 'none'`, which silently republishes the same
 *     `client_id` as a PUBLIC client — a downgrade nobody would notice until
 *     session lifetimes quietly collapsed.
 *
 * ATURI_OAUTH_JWK_ACTIVE signs and is published. ATURI_OAUTH_JWK_RETIRED is
 * published but never signs, which is the whole rotation mechanism: publish
 * both, wait past the authorization server's JWKS cache (~10 minutes, in
 * memory and per-process, so different PDS instances expire at different
 * times), then drop the retired one.
 */

import { JoseKey } from '@atproto/oauth-client-node';
import type { Key } from '@atproto/oauth-client-node';
import { requireBffConfig } from './env';

async function loadKey(raw: string, slot: string): Promise<Key> {
  let jwk: Record<string, unknown>;
  try {
    jwk = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`${slot} is not valid JSON`);
  }
  const kid = jwk.kid;
  if (typeof kid !== 'string' || !kid) {
    throw new Error(
      `${slot} has no "kid". Every key needs an explicit unique kid — ` +
        'without one, rotation silently reuses an identifier for a new key.',
    );
  }
  if (jwk.alg !== 'ES256') {
    throw new Error(`${slot} must be an ES256 key (got alg=${String(jwk.alg)})`);
  }
  try {
    return await JoseKey.fromImportable(jwk as never, kid);
  } catch (err) {
    throw new Error(`${slot} could not be imported: ${(err as Error).message}`);
  }
}

let cached: { keys: Key[]; signature: string } | null = null;

/**
 * The active key first — the library signs with the first usable key in the
 * set and publishes all of them.
 */
export async function getKeyset(): Promise<Key[]> {
  const cfg = requireBffConfig();
  const signature = `${cfg.activeJwk}|${cfg.retiredJwk ?? ''}`;
  if (cached && cached.signature === signature) return cached.keys;

  const keys = [await loadKey(cfg.activeJwk, 'ATURI_OAUTH_JWK_ACTIVE')];
  if (cfg.retiredJwk) {
    keys.push(await loadKey(cfg.retiredJwk, 'ATURI_OAUTH_JWK_RETIRED'));
  }
  const kids = keys.map((k) => k.kid);
  if (new Set(kids).size !== kids.length) {
    throw new Error(
      `The active and retired keys share a kid (${kids.join(', ')}). ` +
        'Rotation requires distinct kids.',
    );
  }

  cached = { keys, signature };
  return keys;
}
