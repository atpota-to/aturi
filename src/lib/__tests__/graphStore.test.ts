import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRAPH_CACHE_MS, forgetStoredGraph, isFresh, readStoredGraph, storeGraph } from '@/utils/atproto/graphStore';

test('a read is served for a day from when it started', () => {
  const now = Date.UTC(2026, 10, 25, 12);
  assert.equal(isFresh(now, now), true);
  assert.equal(isFresh(now - GRAPH_CACHE_MS + 1, now), true);
  assert.equal(isFresh(now - GRAPH_CACHE_MS, now), false);
  assert.equal(isFresh(now - 3 * GRAPH_CACHE_MS, now), false);
});

test('a read stamped in the future or with no time is not served', () => {
  const now = Date.UTC(2026, 10, 25, 12);
  assert.equal(isFresh(now + 60_000, now), false);
  assert.equal(isFresh(Number.NaN, now), false);
});

test('without IndexedDB the store does nothing and finds nothing', async () => {
  assert.equal(typeof indexedDB, 'undefined');
  await storeGraph('did:plc:x', 's', { a: 1 }, Date.now());
  assert.equal(await readStoredGraph('did:plc:x', 's'), null);
  await forgetStoredGraph('did:plc:x');
});
