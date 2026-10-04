import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerIdentityTools, resolveIdentitiesBatch } from '@/lib/mcp/tools/identity';
import type { GuardedIdentity } from '@/lib/mcp/identityResolve';
import type { PlcAuditEntry } from '@/utils/atproto/plc';
import {
  captureRegistrations,
  MAX_DESCRIPTION_LENGTH,
  resultBody,
} from '@/lib/mcp/__tests__/harness';

const { tools } = captureRegistrations(registerIdentityTools);

test('registers exactly the identity tools', () => {
  assert.deepEqual(
    [...tools.keys()].sort(),
    ['get_identity_history', 'resolve_identities', 'resolve_identity'],
  );
});

test('every tool carries a title, a bounded description, and read-only annotations', () => {
  for (const tool of tools.values()) {
    assert.ok(tool.config.title, `${tool.name} has no title`);
    assert.ok(tool.config.description, `${tool.name} has no description`);
    assert.ok(
      (tool.config.description ?? '').length <= MAX_DESCRIPTION_LENGTH,
      `${tool.name} description exceeds ${MAX_DESCRIPTION_LENGTH} chars`,
    );
    assert.equal(tool.config.annotations?.readOnlyHint, true);
    assert.equal(tool.config.annotations?.openWorldHint, true);
  }
});

test('input schemas reject the shapes agents actually get wrong', () => {
  for (const tool of [tools.get('resolve_identity')!, tools.get('get_identity_history')!]) {
    const schema = tool.config.inputSchema;
    assert.ok(schema, `${tool.name} has no input schema`);
    assert.equal(schema.safeParse({}).success, false, `${tool.name} accepted {}`);
    assert.equal(
      schema.safeParse({ identifier: '' }).success,
      false,
      `${tool.name} accepted an empty identifier`,
    );
    assert.equal(
      schema.safeParse({ identifier: 'a'.repeat(5000) }).success,
      false,
      `${tool.name} accepted an oversized identifier`,
    );
    assert.equal(
      schema.safeParse({ identifier: 'alice.bsky.social' }).success,
      true,
      `${tool.name} rejected a plain handle`,
    );
  }
});

const A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const WEB = 'did:web:example.com';

function identity(did: string): GuardedIdentity {
  return {
    did, handle: 'alice.example', pds: 'https://pds.example.com',
    alsoKnownAs: ['at://alice.example'], services: [],
  };
}

const audit = async (did: string): Promise<PlcAuditEntry[]> => [{
  did, createdAt: '2026-09-06T13:21:00Z', operation: {},
}];

test('batch schema bounds count and item length', async () => {
  const schema = tools.get('resolve_identities')!.config.inputSchema!;
  assert.equal(schema.safeParse({}).success, false);
  assert.equal(schema.safeParse({ identifiers: [] }).success, false);
  assert.equal(schema.safeParse({ identifiers: [A] }).success, true);
  assert.equal(schema.safeParse({ identifiers: Array(100).fill(A) }).success, true);
  assert.equal(schema.safeParse({ identifiers: Array(101).fill(A) }).success, false);
  assert.equal(schema.safeParse({ identifiers: ['x'.repeat(257)] }).success, false);
  await assert.rejects(() => resolveIdentitiesBatch(Array(101).fill(A)), /Pass 1 to 100/);
});

test('multiple DIDs resolve with PDS hosts and PLC creation time', async () => {
  const result = await resolveIdentitiesBatch([A, B], async (did) => identity(did), audit);
  assert.deepEqual(result, {
    requested: 2, resolved: 2, unresolved: 0,
    identities: [A, B].map((did) => ({
      input: did, did, handle: 'alice.example', pdsHost: 'pds.example.com',
      createdAt: '2026-09-06T13:21:00Z', status: 'resolved',
    })),
  });
});

test('duplicate inputs retain their positions but share one lookup', async () => {
  let resolves = 0;
  let histories = 0;
  const result = await resolveIdentitiesBatch([A, B, A], async (did) => {
    resolves++;
    return identity(did);
  }, async (did) => {
    histories++;
    return audit(did);
  });
  assert.equal(resolves, 2);
  assert.equal(histories, 2);
  assert.deepEqual(result.identities.map((item) => item.input), [A, B, A]);
  assert.equal(result.resolved, 3);
});

test('invalid identifiers fail per item without fetching', async () => {
  const result = await resolveIdentitiesBatch(['bad input', 'did:other:abc', A], async (did) => identity(did), audit);
  assert.equal(result.resolved, 1);
  assert.equal(result.unresolved, 2);
  assert.deepEqual(result.identities.slice(0, 2).map((item) => item.status), ['unresolved', 'unresolved']);
});

test('mixed upstream failures preserve coverage and input order', async () => {
  const result = await resolveIdentitiesBatch([A, B], async (did) => {
    if (did === B) throw new Error('HTTP 503 Service Unavailable');
    return identity(did);
  }, audit);
  assert.equal(result.requested, 2);
  assert.equal(result.resolved, 1);
  assert.equal(result.unresolved, 1);
  assert.deepEqual(result.identities[1], {
    input: B, status: 'unresolved', error: 'An upstream identity service failed or timed out',
  });
});

test('did:web has no invented creation time; failed PLC history is marked', async () => {
  const result = await resolveIdentitiesBatch([WEB, A], async (did) => identity(did), async () => {
    throw new Error('HTTP 503 Service Unavailable');
  });
  assert.deepEqual(result.identities[0], {
    input: WEB, did: WEB, handle: 'alice.example', pdsHost: 'pds.example.com',
    createdAt: null, status: 'resolved',
  });
  assert.deepEqual(result.identities[1], {
    input: A, did: A, handle: 'alice.example', pdsHost: 'pds.example.com',
    createdAt: null, status: 'resolved', historyError: 'PLC audit log unavailable',
  });
});

test('rate limits stop new lookups without hiding skipped inputs', async () => {
  let calls = 0;
  const ids = Array.from({ length: 9 }, (_, i) => `did:plc:${String(i).repeat(24)}`);
  const result = await resolveIdentitiesBatch(ids, async () => {
    calls++;
    throw new Error('HTTP 429 Too Many Requests');
  }, audit);
  assert.equal(calls, 4);
  assert.equal(result.requested, 9);
  assert.equal(result.resolved, 0);
  assert.equal(result.unresolved, 9);
  assert.ok(result.identities.every((item) => item.status === 'unresolved' && /rate limited/.test(item.error)));
});

test('batch never runs more than four identity lookups at once', async () => {
  let active = 0;
  let peak = 0;
  const release: Array<() => void> = [];
  const ids = Array.from({ length: 8 }, (_, i) => `did:plc:${String(i).repeat(24)}`);
  const batch = resolveIdentitiesBatch(ids, async (did) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((done) => release.push(done));
    active--;
    return identity(did);
  }, audit);
  assert.equal(peak, 4);
  for (let i = 0; i < 8; i += 4) {
    release.splice(0).forEach((done) => done());
    await new Promise<void>((done) => setImmediate(done));
  }
  assert.equal((await batch).resolved, 8);
  assert.equal(peak, 4);
});

test('audit log rate limits retain resolved identity but stop later lookups', async () => {
  let calls = 0;
  const ids = Array.from({ length: 9 }, (_, i) => `did:plc:${String(i).repeat(24)}`);
  const result = await resolveIdentitiesBatch(ids, async (did) => {
    calls++;
    return identity(did);
  }, async () => { throw new Error('HTTP 429 Too Many Requests'); });
  assert.equal(calls, 4);
  assert.equal(result.resolved, 4);
  assert.equal(result.unresolved, 5);
  assert.equal(result.identities[0].status, 'resolved');
  assert.equal(result.identities[0].status === 'resolved' && result.identities[0].historyError,
    'PLC audit log rate limited this batch; retry later');
});

test('batch deadline returns coverage for unfinished identities', async () => {
  const result = await resolveIdentitiesBatch([A, B], async (did) => {
    if (did === B) return new Promise<GuardedIdentity>(() => {});
    return identity(did);
  }, audit, 20);
  assert.equal(result.requested, 2);
  assert.equal(result.resolved, 1);
  assert.equal(result.unresolved, 1);
  assert.deepEqual(result.identities[1], {
    input: B, status: 'unresolved', error: 'Batch time limit reached; retry this identifier',
  });
});

test('batch handler reports invalid DID without a network call', async () => {
  const result = await tools.get('resolve_identities')!.handler({ identifiers: ['did:other:abc'] });
  assert.equal(result.isError, undefined);
  assert.equal(resultBody(result).unresolved, 1);
});
