import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearLexiconTrendsCache, findNewLexicons, windowStart } from '@/lib/lexiconTrends';
import { McpToolError } from '@/lib/mcp/errors';

const ZERO = { creates: 0, updates: 0, deletes: 0, dids_estimate: 0 };

beforeEach(() => clearLexiconTrendsCache());

/** A fake UFOs with one new NSID; `statsStatus` breaks the history check. */
function stubUfos(state: { statsStatus: number }) {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    // Long enough that concurrent callers overlap.
    await new Promise((r) => setTimeout(r, 5));
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/collections') {
      return json({ collections: [{ ...ZERO, nsid: 'com.example.launch.post', dids_estimate: 10 }], cursor: null });
    }
    if (url.pathname === '/collections/stats') {
      return state.statsStatus === 200 ? json({ 'com.example.launch.post': ZERO }) : json({}, state.statsStatus);
    }
    return json({}, 404);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

test('concurrent callers share one computation', async () => {
  const ufos = stubUfos({ statsStatus: 200 });
  try {
    const [a, b] = await Promise.all([findNewLexicons('7d', 3), findNewLexicons('7d', 3)]);
    assert.equal(a, b);
    assert.deepEqual(ufos.calls, ['/collections', '/collections/stats']);
  } finally {
    ufos.restore();
  }
});

test('a failure is not remembered', async () => {
  const state = { statsStatus: 500 };
  const ufos = stubUfos(state);
  try {
    await assert.rejects(findNewLexicons('7d', 3), (err) => err instanceof McpToolError && err.code === 'upstream_error');
    state.statsStatus = 200;
    const answer = await findNewLexicons('7d', 3);
    assert.deepEqual(answer.lexicons.map((l) => l.nsid), ['com.example.launch.post']);
  } finally {
    ufos.restore();
  }
});

test('windows start on a ten-minute boundary that every caller in the slot shares', () => {
  const at = Date.parse('2026-10-18T21:37:12.345Z');
  assert.equal(windowStart('7d', at), '2026-10-11T21:30:00.000Z');
  assert.equal(windowStart('7d', at + 2 * 60 * 1000), windowStart('7d', at));
  assert.equal(windowStart('1d', Date.parse('2026-10-18T21:40:00.000Z')), '2026-10-17T21:40:00.000Z');
});
