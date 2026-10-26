import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '@/app/api/lexicons/new/route';
import { clearLexiconTrendsCache } from '@/lib/lexiconTrends';

const ZERO = { creates: 0, updates: 0, deletes: 0, dids_estimate: 0 };

beforeEach(() => clearLexiconTrendsCache());

/** Call the route against a fake UFOs with one new NSID; `statsStatus` breaks it. */
async function call(query: string, statsStatus = 200) {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/collections') {
      return json({
        collections: [
          { ...ZERO, nsid: 'com.example.launch.post', creates: 40, dids_estimate: 12 },
          { ...ZERO, nsid: 'app.bsky.feed.post', creates: 900, dids_estimate: 500 },
        ],
        cursor: null,
      });
    }
    if (url.pathname === '/collections/stats') {
      if (statsStatus !== 200) return json({}, statsStatus);
      return json({ 'com.example.launch.post': ZERO, 'app.bsky.feed.post': { ...ZERO, creates: 5 } });
    }
    return json({}, 404);
  }) as typeof fetch;
  try {
    const response = await GET(new Request(`https://example.test/api/lexicons/new${query}`));
    return { response, body: (await response.json()) as Record<string, unknown>, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('answers the new lexicons, cacheable at the edge', async () => {
  const { response, body } = await call('?window=7d');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /public, .*s-maxage=1800/);
  assert.equal(body.ok, true);
  assert.equal(body.window, '7d');
  assert.equal(body.minAccounts, 3);
  assert.equal(body.count, 1);
  assert.deepEqual(body.lexicons, [{ nsid: 'com.example.launch.post', creates: 40, didsEstimate: 12 }]);
});

test('defaults to seven days', async () => {
  const { body } = await call('');
  assert.equal(body.window, '7d');
});

test('refuses an unknown window without calling UFOs', async () => {
  const { response, body, calls } = await call('?window=90d');
  assert.equal(response.status, 400);
  assert.equal(body.code, 'invalid_parameter');
  assert.equal(calls.length, 0);
});

test('an upstream failure is a 502 that the CDN does not keep', async () => {
  const { response, body } = await call('?window=1d', 500);
  assert.equal(response.status, 502);
  assert.equal(body.code, 'upstream_error');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
