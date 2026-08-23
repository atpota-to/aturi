import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_SCOPE_IDS,
  DEFAULT_SCOPE_IDS,
  GRANULAR_SCOPES,
  METADATA_SCOPE,
  buildScopeString,
  scopeIdsFromString,
  type ScopeId,
} from '@/lib/oauth/scopes';
import { buildClientMetadata } from '@/lib/oauth/clientMetadata';

/**
 * The backend sign-in path takes permission ids and rebuilds the scope string
 * with `buildScopeString`, while three call sites still hand it the string.
 * If the inversion ever stops reproducing its input, users silently get a
 * different set of permissions than the picker showed them.
 */
test('a scope string round-trips through its permission ids', () => {
  const cases: ScopeId[][] = [
    [],
    ['create'],
    ['create', 'update', 'delete', 'blob'],
    ['spacesSelf'],
    ['spacesAll', 'spacesWrite'],
    [...ALL_SCOPE_IDS],
    [...DEFAULT_SCOPE_IDS],
  ];
  for (const ids of cases) {
    const built = buildScopeString(new Set(ids));
    assert.equal(
      buildScopeString(scopeIdsFromString(built)),
      built,
      `round trip changed the scope string for [${ids.join(',')}]`,
    );
  }
});

test('the read/read_self collapse survives the round trip', () => {
  // buildScopeString drops spacesSelf when spacesAll is present, because
  // `read` implies `read_self`. Inverting can only recover the survivor — but
  // the string must still be identical, which is what the server compares.
  const both = buildScopeString(new Set<ScopeId>(['spacesSelf', 'spacesAll']));
  const ids = scopeIdsFromString(both);
  assert.ok(ids.has('spacesAll'));
  assert.ok(!ids.has('spacesSelf'));
  assert.equal(buildScopeString(ids), both);
});

test('unknown tokens are ignored rather than throwing', () => {
  const ids = scopeIdsFromString('atproto totally:made-up?x=1 repo:*?action=create');
  assert.deepEqual([...ids], ['create']);
});

/**
 * The authorization server checks each requested scope against the metadata
 * document with a plain string membership test, so anything the picker can
 * request must appear in what the metadata route serves. Both are generated
 * from the same constants; this asserts they have not drifted apart.
 */
test('every requestable scope is declared in the client metadata', () => {
  const declared = new Set(METADATA_SCOPE.split(/\s+/).filter(Boolean));
  for (const requested of buildScopeString(ALL_SCOPE_IDS).split(/\s+/).filter(Boolean)) {
    assert.ok(declared.has(requested), `${requested} is not declared in METADATA_SCOPE`);
  }
});

test('the confidential metadata serves exactly METADATA_SCOPE', () => {
  assert.equal(buildClientMetadata('https://aturi.to').scope, METADATA_SCOPE);
});

test('the confidential client is a confidential client', () => {
  const m = buildClientMetadata('https://aturi.to');
  assert.equal(m.token_endpoint_auth_method, 'private_key_jwt');
  // Mandatory with private_key_jwt, and the library rejects RS256.
  assert.equal(m.token_endpoint_auth_signing_alg, 'ES256');
  assert.equal(m.jwks_uri, 'https://aturi.to/oauth/jwks.json');
  assert.equal(m.dpop_bound_access_tokens, true);
});

test('the confidential redirect does not collide with the public client page', () => {
  // /oauth/callback is the existing public client's page. Registering it here
  // too would break that flow; /api/oauth/callback is this client's own.
  const m = buildClientMetadata('https://aturi.to');
  assert.deepEqual(m.redirect_uris, ['https://aturi.to/api/oauth/callback']);
  assert.equal(m.client_id, 'https://aturi.to/oauth/client-metadata.json');
});

test('the picker defaults exclude every permissioned-data scope', () => {
  // An unticked box must mean the request is byte-identical to what this app
  // sent before spaces existed.
  for (const s of GRANULAR_SCOPES) {
    if (s.defaultOn === false) assert.ok(!DEFAULT_SCOPE_IDS.has(s.id));
  }
});
