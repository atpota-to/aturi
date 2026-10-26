import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBacklinkMerge, type BacklinkPage } from '@/utils/atproto/backlinkMerge';
import type { BacklinkRecord } from '@/utils/atproto/constellation';

const B32 = '234567abcdefghijklmnopqrstuvwxyz';
const BASE = Date.UTC(2026, 0, 1);

/** A TID rkey for `minutes` after BASE. */
function tid(minutes: number): string {
  // Microseconds over ten clock-id bits, as BigInt calls: the project's
  // TypeScript target predates BigInt literals.
  let v = (BigInt(BASE + minutes * 60_000) * BigInt(1000)) << BigInt(10);
  let out = '';
  for (let i = 0; i < 13; i++) {
    out = B32[Number(v & BigInt(31))] + out;
    v >>= BigInt(5);
  }
  return out;
}

function rec(did: string, collection: string, rkey: string): BacklinkRecord {
  return { did, collection, rkey };
}

/** A fake source: its records newest first, served `limit` at a time. */
function fakeIndex(data: Record<string, BacklinkRecord[]>, failing: string[] = []) {
  const calls: string[] = [];
  const fetchPage = async (source: string, cursor: string | null, limit: number): Promise<BacklinkPage | null> => {
    calls.push(`${source}@${cursor ?? 0}`);
    if (failing.includes(source)) return null;
    const start = cursor ? Number(cursor) : 0;
    const records = (data[source] ?? []).slice(start, start + limit);
    const end = start + records.length;
    return { records, cursor: end < (data[source] ?? []).length ? String(end) : null };
  };
  return { fetchPage, calls };
}

test('takes the newest record across sources first', async () => {
  const { fetchPage } = fakeIndex({
    a: [rec('did:plc:a1', 'x.follow', tid(100)), rec('did:plc:a2', 'x.follow', tid(80)), rec('did:plc:a3', 'x.follow', tid(60))],
    b: [rec('did:plc:b1', 'y.follow', tid(90)), rec('did:plc:b2', 'y.follow', tid(70))],
  });
  const merge = createBacklinkMerge(['a', 'b'], fetchPage);
  const batch = await merge.next(10);
  assert.deepEqual(
    batch.items.map((i) => i.did),
    ['did:plc:a1', 'did:plc:b1', 'did:plc:a2', 'did:plc:b2', 'did:plc:a3'],
  );
  assert.equal(batch.items[1].source, 'b');
  assert.equal(batch.items[0].uri, `at://did:plc:a1/x.follow/${tid(100)}`);
  assert.equal(batch.done, true);
});

test('asks a source for its next page only when its buffer runs dry', async () => {
  const a = Array.from({ length: 5 }, (_, i) => rec(`did:plc:a${i}`, 'x.follow', tid(100 - i)));
  const b = [rec('did:plc:b0', 'y.follow', tid(1))];
  const { fetchPage, calls } = fakeIndex({ a, b });
  const merge = createBacklinkMerge(['a', 'b'], fetchPage, { pageSize: 2 });

  const first = await merge.next(2);
  assert.deepEqual(first.items.map((i) => i.did), ['did:plc:a0', 'did:plc:a1']);
  assert.deepEqual(calls, ['a@0', 'b@0']);
  assert.equal(first.done, false);

  const second = await merge.next(10);
  assert.deepEqual(
    second.items.map((i) => i.did),
    ['did:plc:a2', 'did:plc:a3', 'did:plc:a4', 'did:plc:b0'],
  );
  assert.deepEqual(calls, ['a@0', 'b@0', 'a@2', 'a@4']);
  assert.equal(second.done, true);
});

test('folds repeat links to one record into a count', async () => {
  const pack = rec('did:plc:p', 'x.starterpack', tid(50));
  const { fetchPage } = fakeIndex({
    a: [pack, pack, pack, rec('did:plc:q', 'x.starterpack', tid(40))],
    b: [pack],
  });
  const merge = createBacklinkMerge(['a', 'b'], fetchPage);
  const batch = await merge.next(10);
  assert.deepEqual(batch.items.map((i) => [i.did, i.links]), [
    ['did:plc:p', 4],
    ['did:plc:q', 1],
  ]);
});

test('a failing source is reported and the rest still merge', async () => {
  const { fetchPage } = fakeIndex({ a: [rec('did:plc:a', 'x.follow', tid(5))] }, ['b']);
  const merge = createBacklinkMerge(['a', 'b'], fetchPage);
  const batch = await merge.next(10);
  assert.deepEqual(batch.items.map((i) => i.did), ['did:plc:a']);
  assert.deepEqual(batch.failed, ['b']);
  assert.equal(batch.done, true);
});

test('a non-TID rkey keeps its place in its own source', async () => {
  const { fetchPage } = fakeIndex({
    a: [rec('did:plc:a1', 'x.card', tid(100)), rec('did:plc:a2', 'x.card', 'self'), rec('did:plc:a3', 'x.card', tid(20))],
    b: [rec('did:plc:b1', 'y.card', tid(60))],
  });
  const merge = createBacklinkMerge(['a', 'b'], fetchPage);
  const batch = await merge.next(10);
  assert.deepEqual(
    batch.items.map((i) => i.did),
    ['did:plc:a1', 'did:plc:a2', 'did:plc:b1', 'did:plc:a3'],
  );
});

test('an undated head rides with the next dated record of its source', async () => {
  const { fetchPage } = fakeIndex({
    a: [rec('did:plc:a1', 'x.profile', 'self'), rec('did:plc:a2', 'x.card', tid(40))],
    b: [rec('did:plc:b1', 'y.card', tid(60)), rec('did:plc:b2', 'y.card', tid(30))],
  });
  const merge = createBacklinkMerge(['a', 'b'], fetchPage);
  const batch = await merge.next(10);
  assert.deepEqual(
    batch.items.map((i) => i.did),
    ['did:plc:b1', 'did:plc:a1', 'did:plc:a2', 'did:plc:b2'],
  );
});

test('a source with no dates sorts after the dated ones', async () => {
  const { fetchPage } = fakeIndex({
    a: [rec('did:plc:a1', 'x.profile', 'self')],
    b: [rec('did:plc:b1', 'y.card', tid(60)), rec('did:plc:b2', 'y.card', tid(1))],
  });
  const merge = createBacklinkMerge(['a', 'b'], fetchPage);
  const batch = await merge.next(10);
  assert.deepEqual(batch.items.map((i) => i.did), ['did:plc:b1', 'did:plc:b2', 'did:plc:a1']);
});

test('an empty source set is done at once', async () => {
  const merge = createBacklinkMerge([], async () => null);
  assert.deepEqual(await merge.next(5), { items: [], done: true, failed: [] });
});
