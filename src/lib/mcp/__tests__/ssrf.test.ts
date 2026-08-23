import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerIdentityTools } from '@/lib/mcp/tools/identity';
import { registerRepoTools } from '@/lib/mcp/tools/repo';
import { captureRegistrations, resultBody } from '@/lib/mcp/__tests__/harness';

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
