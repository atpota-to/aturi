import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerIdentityTools } from '@/lib/mcp/tools/identity';
import { registerRepoTools } from '@/lib/mcp/tools/repo';
import { captureRegistrations, resultBody } from '@/lib/mcp/__tests__/harness';
import { lookup } from 'node:dns/promises';
import { isPrivateAddress } from '@/lib/mcp/guard';

/**
 * SSRF regression: MCP tools resolve identity through resolveGuardedIdentity,
 * which must reject a did:web naming a private/loopback host BEFORE it fetches
 * that host's DID document. A did:web:127.0.0.1 target reaches the guard on a
 * pure string check, so these cases never touch the network.
 */

const identityTools = captureRegistrations(registerIdentityTools).tools;
const repoTools = captureRegistrations(registerRepoTools).tools;

const BLOCKED_DID_WEB = [
  'did:web:127.0.0.1',
  'did:web:localhost',
  'did:web:169.254.169.254',
  'did:web:10.0.0.1',
  'did:web:pds.internal',
  'did:web:foo.localhost',
];

test('resolve_identity rejects did:web on a private host without fetching', async () => {
  for (const did of BLOCKED_DID_WEB) {
    const result = await identityTools.get('resolve_identity')!.handler({ identifier: did });
    assert.equal(result.isError, true, did);
    assert.equal(resultBody(result).code, 'invalid_parameter', did);
  }
});

test('repo tools reject did:web on a private host without fetching', async () => {
  for (const name of ['describe_repo', 'list_records', 'get_record']) {
    const args =
      name === 'list_records'
        ? { identifier: 'did:web:169.254.169.254', collection: 'app.bsky.feed.post' }
        : name === 'get_record'
          ? { identifier: 'did:web:169.254.169.254', collection: 'app.bsky.feed.post', rkey: 'x' }
          : { identifier: 'did:web:169.254.169.254' };
    const result = await repoTools.get(name)!.handler(args);
    assert.equal(result.isError, true, name);
    assert.equal(resultBody(result).code, 'invalid_parameter', name);
  }
});

test('a port-encoded did:web loopback host is still blocked', async () => {
  const result = await identityTools
    .get('resolve_identity')!
    .handler({ identifier: 'did:web:127.0.0.1%3A3000' });
  assert.equal(result.isError, true);
  assert.equal(resultBody(result).code, 'invalid_parameter');
});

test('a did:web whose userinfo hides an internal host is blocked', async () => {
  // The guard must read the host the fetcher would really dial, not a
  // differently-derived one: everything after did:web: becomes the URL
  // authority, so userinfo can move the real host past a naive check.
  for (const did of [
    'did:web:example.com:@127.0.0.1',
    'did:web:example.com:@169.254.169.254',
    'did:web:user:pass@localhost',
  ]) {
    const result = await identityTools.get('resolve_identity')!.handler({ identifier: did });
    assert.equal(result.isError, true, did);
    assert.equal(resultBody(result).code, 'invalid_parameter', did);
  }
});

test('the address classifier rejects every private range, keeps public ones', () => {
  const priv = [
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '0.0.0.0', '100.64.0.1', '198.18.0.1', '224.0.0.1',
    '255.255.255.255', '192.0.2.1', '203.0.113.1',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::169.254.169.254',
    'fe80::1%eth0', '2001:db8::1',
  ];
  for (const ip of priv) {
    assert.equal(isPrivateAddress(ip), true, `${ip} should be treated as private`);
  }

  const pub = ['1.1.1.1', '8.8.8.8', '104.16.0.1', '172.15.0.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'];
  for (const ip of pub) {
    assert.equal(isPrivateAddress(ip), false, `${ip} should be allowed`);
  }

  // Unparseable input fails closed rather than open.
  assert.equal(isPrivateAddress(''), true);
  assert.equal(isPrivateAddress('not-an-ip'), true);
});

test('a public hostname pointing at loopback is rejected after resolution', async () => {
  // localtest.me is a permanently-registered public name that resolves to
  // loopback, so it clears the string check and only the DNS check stops it.
  // Skipped where the sandbox has no resolver rather than failing spuriously.
  let resolves = true;
  try {
    await lookup('localtest.me');
  } catch {
    resolves = false;
  }
  if (!resolves) return;

  const result = await repoTools.get('describe_pds')!.handler({ host: 'localtest.me' });
  assert.equal(result.isError, true);
  assert.equal(resultBody(result).code, 'invalid_parameter');
  assert.match(String(resultBody(result).error), /resolves to a private or internal address/);
});
