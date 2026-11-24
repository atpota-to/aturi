import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backAndForth,
  breakdown,
  buildThread,
  dailyReach,
  exchangeTotals,
  kindReach,
  defaultFolds,
  didOfUri,
  flattenThread,
  flowLayout,
  GOLDEN_ANGLE,
  icicleLayout,
  orbitRadius,
  radialLayout,
  relationOf,
  stackAround,
  tally,
  tidToMs,
  treeLayout,
  type TreeNode,
  type GraphPerson,
  type ThreadPostInput,
} from '@/lib/socialGraph';

const person = (did: string, over: Partial<GraphPerson> = {}): GraphPerson => ({
  did,
  following: false,
  followedBy: false,
  inCommon: null,
  in: 0,
  out: 0,
  inKinds: {},
  outKinds: {},
  ...over,
});

test('relation reads follows both ways before follows in common', () => {
  assert.equal(relationOf(person('a', { following: true, followedBy: true })), 'mutual');
  assert.equal(relationOf(person('a', { following: true })), 'following');
  assert.equal(relationOf(person('a', { followedBy: true, inCommon: 40 })), 'follower');
  assert.equal(relationOf(person('a', { inCommon: 3 })), 'second');
  assert.equal(relationOf(person('a', { inCommon: 0 })), 'further');
  // Never counted is not the same as counted and found none, but both sit
  // on the rim.
  assert.equal(relationOf(person('a')), 'further');
});

test('tally counts both directions inside the window and skips the subject', () => {
  const t = tally(
    [
      { did: 'did:b', kind: 'like', at: 50 },
      { did: 'did:b', kind: 'reply', at: 60 },
      { did: 'did:me', kind: 'like', at: 60 },
      { did: 'did:c', kind: 'like', at: 5 },
    ],
    [
      { did: 'did:b', kind: 'like', at: 70 },
      { did: 'did:c', kind: 'quote', at: 80 },
      { did: 'did:c', kind: 'quote', at: Number.NaN },
    ],
    { t0: 10, t1: 100, exclude: 'did:me' },
  );
  assert.deepEqual(t.get('did:b'), { in: 2, out: 1, inKinds: { like: 1, reply: 1 }, outKinds: { like: 1 } });
  assert.deepEqual(t.get('did:c'), { in: 0, out: 1, inKinds: {}, outKinds: { quote: 1 } });
  assert.equal(t.has('did:me'), false);
});

test('breakdown sums to the total', () => {
  const b = breakdown([
    person('a', { following: true, followedBy: true }),
    person('b', { following: true }),
    person('c', { inCommon: 2 }),
    person('d'),
  ]);
  assert.deepEqual(b, { mutual: 1, following: 1, follower: 0, second: 1, further: 1, total: 4 });
});

test('exchange totals count each account once per side, and both inside each', () => {
  const t = exchangeTotals([
    person('a', { in: 3 }),
    person('b', { in: 1, out: 2 }),
    person('c', { out: 5 }),
    person('d', { following: true }),
  ]);
  assert.deepEqual(t, { in: 2, out: 2, both: 1, reach: 3 });
  assert.deepEqual(exchangeTotals([]), { in: 0, out: 0, both: 0, reach: 0 });
});

test('kind reach counts accounts, not acts', () => {
  const k = kindReach([
    person('a', { inKinds: { like: 9, reply: 1 }, outKinds: { like: 2 } }),
    person('b', { inKinds: { like: 1 }, outKinds: { quote: 1, mention: 0 } }),
  ]);
  assert.deepEqual(k.in, { like: 2, repost: 0, reply: 1, quote: 0, mention: 0 });
  assert.deepEqual(k.out, { like: 1, repost: 0, reply: 0, quote: 1, mention: 0 });
});

test('back and forth ranks by the smaller side, then the total', () => {
  const ranked = backAndForth([
    person('lopsided', { in: 40, out: 1 }),
    person('even', { in: 10, out: 10 }),
    person('close', { in: 12, out: 9 }),
    person('one-way', { in: 50 }),
    person('tie-b', { in: 2, out: 3 }),
    person('tie-a', { in: 3, out: 2 }),
  ]);
  assert.deepEqual(
    ranked.map((p) => p.did),
    ['even', 'close', 'tie-a', 'tie-b', 'lopsided'],
  );
  assert.equal(backAndForth(ranked, 2).length, 2);
});

test('daily reach counts distinct accounts per 24 hours and drops the rest', () => {
  const day = 86_400_000;
  const d = dailyReach(
    [
      { did: 'did:a', kind: 'like', at: 10 },
      { did: 'did:a', kind: 'reply', at: 20 },
      { did: 'did:b', kind: 'like', at: day + 5 },
      { did: 'did:me', kind: 'like', at: 30 },
      { did: 'did:c', kind: 'like', at: -1 },
      { did: 'did:c', kind: 'like', at: 3 * day },
    ],
    [{ did: 'did:a', kind: 'quote', at: 2 * day + 1 }],
    { t0: 0, days: 3, exclude: 'did:me' },
  );
  assert.deepEqual(d, { in: [1, 1, 0], out: [0, 0, 1] });
});

test('orbit puts closer relations nearer the centre', () => {
  const r = (over: Partial<GraphPerson>) => orbitRadius(person('x', over), 100);
  const mutual = r({ following: true, followedBy: true });
  const following = r({ following: true });
  const follower = r({ followedBy: true });
  const many = r({ inCommon: 90 });
  const few = r({ inCommon: 1 });
  const none = r({});
  assert.ok(mutual < following && following < follower && follower < many);
  assert.ok(many < few && few < none);
  assert.ok(none <= 1 && mutual > 0);
});

test('golden-angle steps never land two accounts in one place', () => {
  const angles = Array.from({ length: 400 }, (_, i) => (i * GOLDEN_ANGLE) % (Math.PI * 2)).sort((a, b) => a - b);
  const gaps = angles.slice(1).map((a, i) => a - angles[i]);
  // Evenly enough that the tightest gap is within a few times the average.
  assert.ok(Math.min(...gaps) > (Math.PI * 2) / 400 / 4);
});

const post = (uri: string, parent: string | null, createdAt: string, over: Partial<ThreadPostInput> = {}): ThreadPostInput => ({
  uri,
  parent,
  did: 'did:x',
  text: uri,
  createdAt,
  likes: 0,
  reposts: 0,
  replies: 0,
  quotes: 0,
  hasMedia: false,
  ...over,
});

// root ─ a ─ a1
//      │   └ a2 ─ a2x
//      └ b
//      orphan's parent is missing
const FLAT = [
  post('root', null, '2026-01-01T00:00:00Z'),
  post('b', 'root', '2026-01-01T00:05:00Z'),
  post('a', 'root', '2026-01-01T00:01:00Z'),
  post('a1', 'a', '2026-01-01T00:02:00Z'),
  post('a2', 'a', '2026-01-01T00:03:00Z'),
  post('a2x', 'a2', '2026-01-01T00:04:00Z'),
  post('orphan', 'gone', '2026-01-01T00:06:00Z'),
];

test('thread tree orders replies by time, counts sizes and drops orphans', () => {
  const root = buildThread(FLAT, 'root')!;
  assert.deepEqual(root.kids.map((k) => k.uri), ['a', 'b']);
  assert.equal(root.size, 6);
  assert.equal(root.kids[0].size, 4);
  assert.equal(flattenThread(root).find((p) => p.uri === 'a2x')?.depth, 3);
  assert.equal(flattenThread(root).some((p) => p.uri === 'orphan'), false);
  assert.equal(buildThread(FLAT, 'missing'), null);
});

test('radial tree keeps the root at the centre and parents between children', () => {
  const root = buildThread(FLAT, 'root')!;
  const { pos, maxDepth } = radialLayout(root, 300);
  assert.equal(maxDepth, 3);
  assert.equal(Math.hypot(pos.get('root')!.x, pos.get('root')!.y), 0);
  const a = pos.get('a')!.angle;
  assert.ok(a >= pos.get('a1')!.angle && a <= pos.get('a2')!.angle);
  assert.ok(Math.abs(Math.hypot(pos.get('a2x')!.x, pos.get('a2x')!.y) - 300) < 1e-9);
});

test('icicle widths share the parent by replies under each child', () => {
  const root = buildThread(FLAT, 'root')!;
  const cells = icicleLayout(root, 500, 40);
  const w = (uri: string) => cells.find((c) => c.post.uri === uri)!.w;
  assert.equal(w('root'), 500);
  assert.equal(w('a'), 400);
  assert.equal(w('b'), 100);
  assert.equal(w('a1') + w('a2'), 400);
  assert.equal(cells.find((c) => c.post.uri === 'a2x')!.y, 120);
});

test('flow tree folds, pages replies and centres parents', () => {
  const root = buildThread(FLAT, 'root')!;
  const open = flowLayout(root, { folded: new Set(), expanded: new Set(), perNode: 6, colWidth: 100, rowHeight: 10 });
  assert.equal(open.cards.length, 6);
  assert.equal(open.rows, 3);
  // Most-discussed first: a (4) above b (1).
  const y = (uri: string) => open.cards.find((c) => c.post.uri === uri)!.y;
  assert.ok(y('a') < y('b'));
  assert.equal(y('root'), (y('a') + y('b')) / 2);

  const folded = flowLayout(root, { folded: new Set(['a']), expanded: new Set(), colWidth: 100, rowHeight: 10 });
  assert.equal(folded.cards.find((c) => c.post.uri === 'a')!.folded, 3);
  assert.equal(folded.cards.length, 3);

  const paged = flowLayout(root, { folded: new Set(), expanded: new Set(), perNode: 1, colWidth: 100, rowHeight: 10 });
  assert.deepEqual(
    paged.stubs.map((s) => [s.parent.uri, s.hidden]),
    [['a', 1], ['root', 1]],
  );
});

test('big threads start folded past the second level', () => {
  const root = buildThread(FLAT, 'root')!;
  assert.equal(defaultFolds(root).size, 0);
  assert.deepEqual([...defaultFolds(root, { minSize: 2, depth: 1 })], ['a', 'a2']);
});

test('TID record keys read back as their time', () => {
  const S32 = '234567abcdefghijklmnopqrstuvwxyz';
  const ms = Date.UTC(2026, 10, 18, 12, 0, 0);
  let n = (BigInt(ms) * BigInt(1000)) << BigInt(10);
  let key = '';
  for (let i = 0; i < 13; i++) {
    key = S32[Number(n % BigInt(32))] + key;
    n /= BigInt(32);
  }
  assert.equal(tidToMs(key), ms);
  assert.equal(tidToMs('self'), null);
  assert.equal(tidToMs('zzzzzzzzzzzzz'), null);
});

test('small helpers', () => {
  assert.equal(didOfUri('at://did:plc:abc/app.bsky.feed.post/3k'), 'did:plc:abc');
  assert.equal(didOfUri('https://example.com'), null);
  assert.deepEqual(stackAround(100, 3, 60, 50), [15, 75, 135]);
});

test('tree layout keeps cards apart and parents level with their children', () => {
  const leaf = (key: string, h = 40): TreeNode => ({ key, w: 100, h, children: [] });
  const root: TreeNode = {
    key: 'root',
    w: 200,
    h: 120,
    children: [
      { key: 'a', w: 150, h: 40, children: [leaf('a1'), leaf('a2'), leaf('a3')] },
      leaf('b', 20),
    ],
  };
  const { nodes, width, height } = treeLayout(root, { colGap: 50, rowGap: 10 });
  const at = (k: string) => nodes.find((n) => n.key === k)!;
  // Columns by depth, each as wide as its widest card.
  assert.deepEqual([at('root').x, at('a').x, at('a1').x], [0, 250, 450]);
  assert.equal(width, 550);
  // Leaves never overlap, in order.
  for (const [u, v] of [['a1', 'a2'], ['a2', 'a3']]) assert.ok(at(u).y + at(u).h + 10 <= at(v).y);
  // A parent is centred on its children.
  const mid = (k: string) => at(k).y + at(k).h / 2;
  assert.equal(mid('a'), (mid('a1') + mid('a3')) / 2);
  // A parent taller than its children pushes them down rather than poking out above.
  assert.ok(at('root').y >= 0);
  assert.ok(height >= at('root').y + at('root').h);
  assert.equal(at('a2').parent, 'a');
});
