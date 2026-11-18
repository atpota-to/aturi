import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClientMetadata } from '@/lib/oauth/clientMetadata';
import {
  buildClientChecks,
  clientKind,
  clientVerdict,
  parseClientId,
  readLoopbackClient,
  redirectUriProblem,
  reverseDomain,
  type ClientMetadataProbe,
  narrowClientMetadata,
} from '@/lib/tools/oauth';

const CLIENT_ID = 'https://app.example.com/oauth-client-metadata.json';

/** A public web client that meets every rule. */
const PUBLIC_WEB = {
  client_id: CLIENT_ID,
  client_name: 'Example',
  client_uri: 'https://app.example.com',
  logo_uri: 'https://app.example.com/logo.png',
  tos_uri: 'https://app.example.com/terms',
  policy_uri: 'https://app.example.com/privacy',
  redirect_uris: ['https://app.example.com/oauth/callback'],
  scope: 'atproto repo:com.example.post blob:*/*',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
  application_type: 'web',
  dpop_bound_access_tokens: true,
};

function probe(document: unknown, overrides: Partial<ClientMetadataProbe> = {}): ClientMetadataProbe {
  return {
    clientId: CLIENT_ID,
    status: 'answered',
    httpStatus: 200,
    contentType: 'application/json',
    redirectedFrom: [],
    finalUrl: CLIENT_ID,
    document,
    ...overrides,
  };
}

const statusOf = (document: unknown, id: string, overrides?: Partial<ClientMetadataProbe>) =>
  buildClientChecks(probe(document, overrides), CLIENT_ID).find((check) => check.id === id)?.status;

test('parseClientId accepts https URLs and the localhost form, and says why not otherwise', () => {
  assert.deepEqual(parseClientId(` ${CLIENT_ID} `), { ok: true, kind: 'hosted', clientId: CLIENT_ID });
  // A bare host gains its scheme and nothing else changes.
  assert.deepEqual(parseClientId('app.example.com/client.json'), {
    ok: true,
    kind: 'hosted',
    clientId: 'https://app.example.com/client.json',
  });
  assert.deepEqual(parseClientId('http://localhost?scope=atproto'), {
    ok: true,
    kind: 'loopback',
    clientId: 'http://localhost?scope=atproto',
  });
  assert.equal(parseClientId('').ok, false);
  assert.equal(parseClientId('http://app.example.com/client.json').ok, false);
  assert.equal(parseClientId('https://app.example.com:8443/client.json').ok, false);
  // The URL parser hides a default port; it still counts as a port.
  assert.equal(parseClientId('https://app.example.com:443/client.json').ok, false);
  assert.equal(parseClientId('https://user:pass@app.example.com/client.json').ok, false);
  assert.equal(parseClientId('ftp://app.example.com/client.json').ok, false);
  assert.equal(parseClientId('https://app example.com').ok, false);
});

test('a document that meets every rule passes every check', () => {
  const checks = buildClientChecks(probe(PUBLIC_WEB), CLIENT_ID);
  assert.deepEqual(
    checks.filter((c) => c.status !== 'pass').map((c) => [c.id, c.status]),
    [],
  );
  assert.equal(clientVerdict(checks, 'hosted').tone, 'pass');
});

test('this site’s own confidential client document passes', () => {
  const origin = 'https://aturi.to';
  const document = buildClientMetadata(origin);
  const checks = buildClientChecks(
    { ...probe(document), clientId: document.client_id, finalUrl: document.client_id },
    document.client_id,
  );
  assert.deepEqual(
    checks.filter((c) => c.status === 'fail' || c.status === 'warn').map((c) => [c.id, c.summary]),
    [],
  );
  assert.deepEqual(clientKind(document), { application: 'web', confidential: true });
});

test('the response itself has rules: 200, no redirect, JSON, application/json', () => {
  assert.equal(statusOf(PUBLIC_WEB, 'served'), 'pass');
  assert.equal(statusOf(PUBLIC_WEB, 'served', { contentType: 'application/json; charset=utf-8' }), 'pass');
  assert.equal(statusOf(PUBLIC_WEB, 'served', { contentType: 'text/plain' }), 'fail');
  assert.equal(statusOf(PUBLIC_WEB, 'served', { httpStatus: 203 }), 'fail');
  assert.equal(
    statusOf(PUBLIC_WEB, 'served', { redirectedFrom: [CLIENT_ID], finalUrl: 'https://www.example.com/c.json' }),
    'fail',
  );
  assert.equal(statusOf(['not', 'an', 'object'], 'served'), 'fail');
  // With no document the rest cannot be judged.
  const noBody = buildClientChecks(probe(undefined, { httpStatus: 404, bodyProblem: 'The body is not valid JSON.' }), CLIENT_ID);
  assert.equal(noBody[0].status, 'fail');
  assert.ok(noBody.slice(1).every((c) => c.status === 'skip'));
  const unreachable = buildClientChecks({ clientId: CLIENT_ID, status: 'error', error: 'the hostname does not resolve' }, CLIENT_ID);
  assert.equal(unreachable[0].status, 'fail');
  assert.equal(clientVerdict(unreachable, 'hosted').tone, 'fail');
});

test('client_id must repeat the URL exactly', () => {
  assert.equal(statusOf({ ...PUBLIC_WEB, client_id: `${CLIENT_ID}/` }, 'client_id'), 'fail');
  assert.equal(statusOf({ ...PUBLIC_WEB, client_id: undefined }, 'client_id'), 'fail');
});

test('the required fields are required', () => {
  assert.equal(statusOf({ ...PUBLIC_WEB, grant_types: ['refresh_token'] }, 'grant_types'), 'fail');
  assert.equal(statusOf({ ...PUBLIC_WEB, grant_types: undefined }, 'grant_types'), 'fail');
  assert.equal(statusOf({ ...PUBLIC_WEB, grant_types: ['authorization_code', 'implicit'] }, 'grant_types'), 'warn');
  assert.equal(statusOf({ ...PUBLIC_WEB, grant_types: ['authorization_code'] }, 'grant_types'), 'pass');
  assert.equal(statusOf({ ...PUBLIC_WEB, response_types: ['token'] }, 'response_types'), 'fail');
  assert.equal(statusOf({ ...PUBLIC_WEB, dpop_bound_access_tokens: false }, 'dpop'), 'fail');
  assert.equal(statusOf({ ...PUBLIC_WEB, dpop_bound_access_tokens: undefined }, 'dpop'), 'fail');
  assert.equal(statusOf({ ...PUBLIC_WEB, redirect_uris: [] }, 'redirect_uris'), 'fail');
  assert.equal(statusOf({ ...PUBLIC_WEB, application_type: undefined }, 'application_type'), 'info');
  assert.equal(statusOf({ ...PUBLIC_WEB, application_type: 'mobile' }, 'application_type'), 'fail');
});

test('scope must be a string with atproto in it', () => {
  assert.equal(statusOf({ ...PUBLIC_WEB, scope: 'repo:com.example.post' }, 'scope'), 'fail');
  assert.equal(statusOf({ ...PUBLIC_WEB, scope: ['atproto'] }, 'scope'), 'fail');
  assert.equal(statusOf({ ...PUBLIC_WEB, scope: 'atproto' }, 'scope'), 'pass');
  // A scope that breaks the permission spec is a warning: the document is still usable.
  assert.equal(statusOf({ ...PUBLIC_WEB, scope: 'atproto repo:com.example.*' }, 'scope'), 'warn');
  // A resource the spec does not define yet is allowed through.
  assert.equal(statusOf({ ...PUBLIC_WEB, scope: 'atproto space:*?authority=*&action=read' }, 'scope'), 'pass');
});

test('redirect URIs follow the client type', () => {
  assert.equal(redirectUriProblem('https://app.example.com/cb', 'web', CLIENT_ID), null);
  assert.equal(redirectUriProblem('https://other.example.net:8443/cb', 'web', CLIENT_ID), null);
  assert.match(redirectUriProblem('https://app.example.com:443/cb', 'web', CLIENT_ID) ?? '', /default port/);
  assert.match(redirectUriProblem('http://app.example.com/cb', 'web', CLIENT_ID) ?? '', /plain http/);
  assert.match(redirectUriProblem('com.example.app:/cb', 'web', CLIENT_ID) ?? '', /https URL/);

  assert.equal(reverseDomain('app.example.com'), 'com.example.app');
  assert.equal(redirectUriProblem('com.example.app:/callback', 'native', CLIENT_ID), null);
  assert.equal(redirectUriProblem('https://app.example.com/callback', 'native', CLIENT_ID), null);
  assert.match(redirectUriProblem('https://other.example.com/callback', 'native', CLIENT_ID) ?? '', /origin/);
  assert.match(redirectUriProblem('com.other.app:/callback', 'native', CLIENT_ID) ?? '', /in reverse/);
  assert.match(redirectUriProblem('com.example.app://callback', 'native', CLIENT_ID) ?? '', /one slash/);
  assert.match(redirectUriProblem('com.example.app:callback', 'native', CLIENT_ID) ?? '', /one slash/);

  assert.equal(
    statusOf({ ...PUBLIC_WEB, application_type: 'native', redirect_uris: ['com.example.app:/callback'] }, 'redirect_uris'),
    'pass',
  );
  assert.equal(statusOf({ ...PUBLIC_WEB, redirect_uris: ['com.example.app:/callback'] }, 'redirect_uris'), 'fail');
});

test('client authentication: public, confidential, and neither', () => {
  assert.equal(statusOf({ ...PUBLIC_WEB, token_endpoint_auth_method: undefined }, 'auth'), 'pass');
  assert.equal(statusOf({ ...PUBLIC_WEB, token_endpoint_auth_method: 'client_secret_basic' }, 'auth'), 'fail');
  assert.equal(statusOf({ ...PUBLIC_WEB, token_endpoint_auth_signing_alg: 'none' }, 'auth'), 'fail');

  const confidential = {
    ...PUBLIC_WEB,
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
  };
  assert.equal(statusOf(confidential, 'auth'), 'fail'); // no key published
  assert.equal(statusOf({ ...confidential, jwks_uri: 'https://app.example.com/jwks.json' }, 'auth'), 'pass');
  assert.equal(statusOf({ ...confidential, jwks_uri: 'http://app.example.com/jwks.json' }, 'auth'), 'fail');
  assert.equal(statusOf({ ...confidential, jwks: { keys: [{ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }] } }, 'auth'), 'pass');
  assert.equal(statusOf({ ...confidential, jwks: { keys: [] } }, 'auth'), 'fail');
  assert.equal(
    statusOf({ ...confidential, jwks: { keys: [{ kty: 'EC' }] }, jwks_uri: 'https://app.example.com/jwks.json' }, 'auth'),
    'fail',
  );
  // A private key in a public document is the one mistake worth shouting about.
  assert.equal(statusOf({ ...confidential, jwks: { keys: [{ kty: 'EC', d: 'secret' }] } }, 'auth'), 'fail');
  assert.equal(
    statusOf({ ...confidential, token_endpoint_auth_signing_alg: undefined, jwks_uri: 'https://app.example.com/jwks.json' }, 'auth'),
    'warn',
  );
  assert.equal(
    statusOf({ ...confidential, token_endpoint_auth_signing_alg: 'RS256', jwks_uri: 'https://app.example.com/jwks.json' }, 'auth'),
    'warn',
  );
});

test('the display fields have origin and scheme rules', () => {
  assert.equal(statusOf({ ...PUBLIC_WEB, client_uri: 'https://www.example.org' }, 'display'), 'fail');
  assert.equal(statusOf({ ...PUBLIC_WEB, logo_uri: 'http://app.example.com/logo.png' }, 'display'), 'fail');
  assert.equal(statusOf({ ...PUBLIC_WEB, tos_uri: undefined }, 'display'), 'info');
});

test('a lookup still on its way is pending, and one that failed says so', () => {
  const waiting = buildClientChecks(undefined, CLIENT_ID);
  assert.ok(waiting.every((c) => c.status === 'pending'));
  assert.equal(clientVerdict(waiting, 'hosted').tone, 'pending');
  const failed = buildClientChecks(null, CLIENT_ID);
  assert.equal(failed[0].status, 'fail');
});

test('the localhost form derives its metadata from the URL', () => {
  const bare = readLoopbackClient('http://localhost');
  assert.deepEqual(bare.document.redirect_uris, ['http://127.0.0.1/', 'http://[::1]/']);
  assert.equal(bare.document.scope, 'atproto');
  assert.equal(bare.document.application_type, 'native');
  assert.equal(bare.document.token_endpoint_auth_method, 'none');
  assert.equal(clientVerdict(bare.checks, 'loopback').tone, 'pass');

  const configured = readLoopbackClient(
    'http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A8080%2Fcallback&scope=atproto%20transition%3Ageneric',
  );
  assert.deepEqual(configured.document.redirect_uris, ['http://127.0.0.1:8080/callback']);
  assert.equal(configured.document.scope, 'atproto transition:generic');
  assert.equal(clientVerdict(configured.checks, 'loopback').tone, 'pass');
});

test('the localhost form has rules of its own', () => {
  const find = (clientId: string, id: string) => readLoopbackClient(clientId).checks.find((c) => c.id === id)?.status;
  assert.equal(find('http://localhost:3000', 'form'), 'fail');
  assert.equal(find('http://localhost/app', 'form'), 'fail');
  // The redirect goes to the loopback address, not the name.
  assert.equal(find('http://localhost?redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcb', 'redirect_uris'), 'fail');
  assert.equal(find('http://localhost?redirect_uri=http%3A%2F%2F%5B%3A%3A1%5D%3A3000%2Fcb', 'redirect_uris'), 'pass');
  assert.equal(find('http://localhost?scope=transition%3Ageneric', 'scope'), 'fail');
  assert.equal(find('http://localhost?scope=atproto&scope=atproto', 'scope'), 'fail');
  assert.equal(find('http://localhost?client_name=Dev', 'params'), 'warn');
});

test('narrowClientMetadata keeps the defined fields and only names the rest', () => {
  const { document, otherFields } = narrowClientMetadata({
    client_id: 'https://app.example.com/client-metadata.json',
    scope: 'atproto',
    dpop_bound_access_tokens: true,
    internal_notes: 'not for the page',
    users: [{ email: 'someone@example.com' }],
  });
  assert.deepEqual(Object.keys(document), ['client_id', 'scope', 'dpop_bound_access_tokens']);
  assert.deepEqual(otherFields, ['internal_notes', 'users']);
  assert.ok(!JSON.stringify(document).includes('someone@example.com'));
  // An API response that is not client metadata comes back empty.
  assert.deepEqual(narrowClientMetadata({ data: [1, 2, 3], next: 'x' }).document, {});
});
