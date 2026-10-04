import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentifier } from '@/utils/atproto/identity';

/**
 * A repo that won't serve reads is the one case where the explorer has to say
 * something it wasn't told directly. These cover the two ways that goes wrong:
 * inventing a status for a PDS that never gave one, and paying for the lookup
 * on every healthy repo.
 */

const PDS = 'https://pds.example';

function didDoc(did: string, handle: string) {
  return {
    id: did,
    alsoKnownAs: [`at://${handle}`],
    service: [
      {
        id: '#atproto_pds',
        type: 'AtprotoPersonalDataServer',
        serviceEndpoint: PDS,
      },
    ],
  };
}

/**
 * Stub global fetch with a router keyed on the XRPC method, recording every
 * URL so a test can assert on the calls that were *not* made. Returns a
 * restore function for the test to call when it's done.
 */
function stubFetch(
  routes: Record<string, { status: number; body: unknown }>,
): { urls: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    const route = key ? routes[key] : { status: 404, body: { error: 'NotFound' } };
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { urls, restore: () => { globalThis.fetch = original; } };
}

test('a taken-down repo reports its status and keeps the DID document handle', async () => {
  const did = 'did:plc:takendownaccount00000001';
  const { urls, restore } = stubFetch({
    'plc.directory': { status: 200, body: didDoc(did, 'gone.example') },
    'com.atproto.repo.describeRepo': {
      status: 400,
      body: { error: 'RepoTakendown', message: `Repo has been takendown: ${did}` },
    },
    'com.atproto.sync.getRepoStatus': {
      status: 200,
      body: { did, active: false, status: 'takendown' },
    },
  });
  try {
    const identity = await resolveIdentifier(did);
    // describeRepo is the only source of the handle on the happy path, and it
    // just refused; the DID document has to cover for it.
    assert.equal(identity.handle, 'gone.example');
    assert.equal(identity.pds, PDS);
    assert.equal(identity.repoStatus?.status, 'takendown');
    assert.match(identity.repoStatus?.error ?? '', /RepoTakendown/);
  } finally {
    restore();
  }
  assert.ok(urls.some((u) => u.includes('com.atproto.sync.getRepoStatus')));
});

test('a PDS that never answers is not labelled with a status', async () => {
  const did = 'did:plc:unreachablepds000000001';
  const { restore } = stubFetch({
    'plc.directory': { status: 200, body: didDoc(did, 'quiet.example') },
    'com.atproto.repo.describeRepo': { status: 502, body: { error: 'BadGateway' } },
    'com.atproto.sync.getRepoStatus': { status: 502, body: { error: 'BadGateway' } },
  });
  try {
    const identity = await resolveIdentifier(did);
    // A host that's down says nothing about the account. Guessing "inactive"
    // here would put a takedown banner on an account that has none.
    assert.equal(identity.repoStatus, null);
    assert.equal(identity.handle, 'quiet.example');
  } finally {
    restore();
  }
});

test('an active repo costs no extra request', async () => {
  const did = 'did:plc:livehealthyaccount00001';
  const { urls, restore } = stubFetch({
    'plc.directory': { status: 200, body: didDoc(did, 'alive.example') },
    'com.atproto.repo.describeRepo': {
      status: 200,
      body: { did, handle: 'alive.example', collections: ['app.bsky.feed.post'] },
    },
  });
  try {
    const identity = await resolveIdentifier(did);
    assert.equal(identity.repoStatus, null);
    assert.equal(identity.handle, 'alive.example');
  } finally {
    restore();
  }
  // The status lookup hangs off the failure path only: every repo in the
  // network is the healthy case, and none of them should pay for it.
  assert.ok(!urls.some((u) => u.includes('com.atproto.sync.getRepoStatus')));
});
