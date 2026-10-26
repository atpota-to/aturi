import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IOS_BUNDLE_ID,
  IOS_METADATA_SCOPE,
  IOS_OAUTH_REDIRECT_URI,
  buildAppleAppSiteAssociation,
  buildIosClientMetadata,
} from '@/lib/iosApp';
import { METADATA_SCOPE } from '@/lib/oauth/scopes';

test('the iOS scope string is pinned, so the Swift constant can be checked against it', () => {
  // `OAuthMetadata.swift` in the iOS package carries this exact string. If
  // this assertion changes, that file must change with it, or sign-in from
  // the app fails PAR validation with an unknown-scope error.
  assert.equal(
    IOS_METADATA_SCOPE,
    'atproto rpc:*?aud=did:web:api.bsky.app%23bsky_appview repo:*?action=create repo:*?action=update repo:*?action=delete blob:*/*',
  );
});

test('the iOS scope is a subset of the web scope, minus the space tokens', () => {
  const web = new Set(METADATA_SCOPE.split(' '));
  for (const token of IOS_METADATA_SCOPE.split(' ')) {
    assert.ok(web.has(token), `${token} is not advertised by the web client`);
    assert.ok(!token.startsWith('space:'), `${token} is a space scope`);
  }
});

test('native client metadata uses the reverse-domain scheme redirect', () => {
  const meta = buildIosClientMetadata('https://aturi.to');
  assert.equal(meta.client_id, 'https://aturi.to/oauth-client-metadata-ios.json');
  assert.equal(meta.application_type, 'native');
  assert.deepEqual(meta.redirect_uris, ['to.aturi:/oauth/callback']);
  assert.equal(IOS_OAUTH_REDIRECT_URI, 'to.aturi:/oauth/callback');
  assert.equal(meta.token_endpoint_auth_method, 'none');
  assert.equal(meta.dpop_bound_access_tokens, true);
  assert.equal(meta.scope, IOS_METADATA_SCOPE);
});

test('the association file is withheld until a Team ID is configured', () => {
  assert.equal(buildAppleAppSiteAssociation(undefined), null);
  assert.equal(buildAppleAppSiteAssociation(''), null);
  assert.equal(buildAppleAppSiteAssociation('not a team id'), null);
});

test('the association file names the app and only the link paths it handles', () => {
  const body = buildAppleAppSiteAssociation('ABCDE12345') as {
    applinks: { details: Array<{ appIDs: string[]; components: Array<Record<string, string>> }> };
  };
  assert.deepEqual(body.applinks.details[0].appIDs, [`ABCDE12345.${IOS_BUNDLE_ID}`]);
  const paths = body.applinks.details[0].components.map((c) => c['/']);
  assert.deepEqual(paths, ['/profile/*', '/explore/*', '/at/*', '/at:*']);
  // Claiming the root would pull /about, /docs and every other page into the
  // app; the bare-handle links stay in Safari by design.
  assert.ok(!paths.includes('/*'));
});
