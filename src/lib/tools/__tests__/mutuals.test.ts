import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLY_WRITES_MAX,
  CREATE_POINTS,
  SNAPSHOT_MAX_AGE_MS,
  avatarThumb,
  bskyListUrl,
  chunk,
  countAtLeast,
  defaultListDescription,
  highestCount,
  histogram,
  histogramBins,
  listDescriptionProblem,
  listItemWrites,
  listNameProblem,
  listRecord,
  mutualStrategy,
  orbitLayout,
  parseAccountInput,
  parseThreshold,
  rankCandidates,
  rankListBlocks,
  readBlockSubject,
  readListBlockSubject,
  readSnapshot,
  savePoints,
  scopeAllowsCreate,
  selectedByDefault,
  slimTally,
  suggestThreshold,
  summary,
  tallyBlock,
  type Candidate,
  type ScanSnapshot,
  type Tally,
} from '@/lib/tools/mutuals';

const did = (n: number) => `did:plc:${String(n).padStart(24, 'a')}`;

/** A tally from blocked account to its blockers, built the way a scan builds it. */
function tallyOf(blocks: Record<number, number[]>): Tally {
  const tally: Tally = new Map();
  const seen = new Map<number, Set<string>>();
  for (const [mutual, subjects] of Object.entries(blocks)) {
    const m = Number(mutual);
    if (!seen.has(m)) seen.set(m, new Set());
    for (const s of subjects) tallyBlock(tally, seen.get(m)!, m, did(s));
  }
  return tally;
}

test('reads accounts and refuses everything else', () => {
  assert.deepEqual(parseAccountInput('alice.example.com'), { ok: true, actor: 'alice.example.com' });
  assert.deepEqual(parseAccountInput(did(1)), { ok: true, actor: did(1) });
  assert.deepEqual(parseAccountInput('https://bsky.app/profile/alice.example.com'), {
    ok: true,
    actor: 'alice.example.com',
  });
  const post = parseAccountInput('https://bsky.app/profile/alice.example.com/post/3n22yg6lg2k2f');
  assert.equal(post.ok, false);
  assert.match(!post.ok ? post.reason : '', /Mutuals belong to accounts/);
  assert.equal(parseAccountInput('  ').ok, false);
});

test('a threshold is a whole number from one', () => {
  assert.equal(parseThreshold('3'), 3);
  assert.equal(parseThreshold('0'), null);
  assert.equal(parseThreshold('-2'), null);
  assert.equal(parseThreshold('2.5'), null);
  assert.equal(parseThreshold(''), null);
});

test('mutuals are found the cheaper way', () => {
  // 600 followers is 6 pages; 800 follows is 27 relationship checks.
  assert.equal(mutualStrategy(800, 600), 'followers');
  // 200,000 followers would be 2,000 pages.
  assert.equal(mutualStrategy(500, 200_000), 'relationships');
  // Past what can be paged through, followers are never complete.
  assert.equal(mutualStrategy(100_000, 30_000), 'relationships');
  assert.equal(mutualStrategy(0, 0), 'followers');
});

test('avatar URLs are swapped for thumbnails, other URLs left alone', () => {
  assert.equal(
    avatarThumb('https://cdn.bsky.app/img/avatar/plain/did:plc:x/bafy@jpeg'),
    'https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:x/bafy@jpeg',
  );
  assert.equal(avatarThumb('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(avatarThumb(null), null);
});

test('only well-formed block and listblock records are read', () => {
  assert.equal(readBlockSubject({ subject: did(1), createdAt: '' }), did(1));
  assert.equal(readBlockSubject({ subject: 'alice.example.com' }), null);
  assert.equal(readBlockSubject({ subject: 3 }), null);
  assert.equal(readBlockSubject(null), null);
  const list = `at://${did(2)}/app.bsky.graph.list/3kabc`;
  assert.equal(readListBlockSubject({ subject: list }), list);
  assert.equal(readListBlockSubject({ subject: `at://${did(2)}/app.bsky.feed.post/3kabc` }), null);
});

test('one person blocking an account twice counts once', () => {
  const tally: Tally = new Map();
  const seen = new Set<string>();
  assert.equal(tallyBlock(tally, seen, 0, did(9)), true);
  assert.equal(tallyBlock(tally, seen, 0, did(9)), false);
  assert.equal(tallyBlock(tally, new Set(), 1, did(9)), true);
  assert.deepEqual(tally.get(did(9)), [0, 1]);
});

test('the distribution counts accounts by how many mutuals block them', () => {
  const tally = tallyOf({ 0: [1, 2, 3], 1: [1, 2], 2: [1], 3: [4] });
  // did(1): 3 blockers; did(2): 2; did(3), did(4): 1 each.
  const counts = histogram(tally);
  assert.deepEqual(counts, [0, 2, 1, 1]);
  assert.equal(countAtLeast(counts, 1), 4);
  assert.equal(countAtLeast(counts, 2), 2);
  assert.equal(countAtLeast(counts, 4), 0);
  assert.equal(highestCount(counts), 3);
  assert.equal(highestCount([0]), 0);
  assert.deepEqual(histogram(tally, new Set([did(1)])), [0, 2, 1]);
});

test('bins hold one count each until there are too many', () => {
  assert.deepEqual(histogramBins([0, 5, 0, 2]), [
    { from: 1, to: 1, count: 5 },
    { from: 2, to: 2, count: 0 },
    { from: 3, to: 3, count: 2 },
  ]);
  const wide = [0, ...Array.from({ length: 100 }, () => 1)];
  const bins = histogramBins(wide, 40);
  assert.ok(bins.length <= 40);
  assert.equal(bins[0].from, 1);
  assert.equal(bins.at(-1)!.to, 100);
  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 100);
  assert.deepEqual(histogramBins([0]), []);
});

test('the suggested threshold grows with the mutuals and never empties the list', () => {
  const many = [0, 500, 200, 100, 50, 25, 12, 6, 3, 2, 1, 1];
  assert.equal(suggestThreshold(40, many), 2);
  assert.equal(suggestThreshold(100, many), 5);
  assert.equal(suggestThreshold(1000, many), 10);
  // Nobody is blocked by more than two of them.
  assert.equal(suggestThreshold(300, [0, 40, 3]), 2);
  assert.equal(suggestThreshold(300, [0, 40]), 1);
  assert.equal(suggestThreshold(300, [0]), 1);
});

test('candidates are ranked by blockers, then by DID', () => {
  const tally = tallyOf({ 0: [1, 2, 3], 1: [3, 2], 2: [3] });
  const ranked = rankCandidates(tally, 2);
  assert.deepEqual(
    ranked.map((c) => [c.did, c.blockers.length]),
    [
      [did(3), 3],
      [did(2), 2],
    ],
  );
  assert.deepEqual(
    rankCandidates(tally, 1, new Set([did(3)])).map((c) => c.did),
    [did(2), did(1)],
  );
});

test('what a person already chose starts out unticked', () => {
  const none = { followed: false, mutual: false, blocked: false, missing: false };
  assert.equal(selectedByDefault(none), true);
  assert.equal(selectedByDefault({ ...none, blocked: true }), true);
  assert.equal(selectedByDefault({ ...none, followed: true }), false);
  assert.equal(selectedByDefault({ ...none, mutual: true }), false);
  assert.equal(selectedByDefault({ ...none, missing: true }), false);
});

test('the map places every account and every mutual blocking them', () => {
  const targets: Candidate[] = [
    { did: did(1), blockers: [0, 1, 2] },
    { did: did(2), blockers: [1, 2] },
    { did: did(3), blockers: [5] },
  ];
  const layout = orbitLayout(targets);
  assert.deepEqual(layout.targets.map((t) => t.did), [did(1), did(2), did(3)]);
  assert.deepEqual(
    layout.mutuals.map((m) => m.index).sort(),
    [0, 1, 2, 5],
  );
  for (const { angle } of [...layout.targets, ...layout.mutuals]) {
    assert.ok(angle >= 0 && angle < Math.PI * 2);
  }
  assert.equal(layout.mutuals.find((m) => m.index === 1)?.degree, 2);
  assert.equal(new Set(layout.targets.map((t) => t.angle.toFixed(6))).size, 3);
  // The same input, the same picture.
  assert.deepEqual(orbitLayout(targets), layout);
  assert.deepEqual(orbitLayout([]), { targets: [], mutuals: [] });
});

/** How far apart two angles are around the circle. */
function gap(a: number, b: number) {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(d, Math.PI * 2 - d);
}

test('mutuals blocking the same accounts face them', () => {
  // Two groups that share nothing, listed interleaved.
  const targets: Candidate[] = [
    { did: did(1), blockers: [0, 2] },
    { did: did(2), blockers: [1, 3] },
    { did: did(3), blockers: [0, 2] },
    { did: did(4), blockers: [1, 3] },
  ];
  const layout = orbitLayout(targets);
  const angle = (id: string) => layout.targets.find((t) => t.did === id)!.angle;
  const mutual = (i: number) => layout.mutuals.find((m) => m.index === i)!.angle;
  // Each group's accounts sit together, and its mutuals sit near them.
  assert.ok(gap(angle(did(1)), angle(did(3))) < gap(angle(did(1)), angle(did(2))));
  assert.ok(gap(mutual(0), mutual(2)) < gap(mutual(0), mutual(1)));
  assert.ok(gap(mutual(0), angle(did(1))) < gap(mutual(0), angle(did(2))));
});

test('block lists are ranked by subscribers', () => {
  const a = `at://${did(1)}/app.bsky.graph.list/a`;
  const b = `at://${did(1)}/app.bsky.graph.list/b`;
  const ranked = rankListBlocks(
    new Map([
      [a, [0]],
      [b, [0, 1, 2]],
    ]),
  );
  assert.deepEqual(ranked.map((l) => l.uri), [b, a]);
  assert.deepEqual(rankListBlocks(new Map([[a, [0]]]), 2), []);
});

test('list names and descriptions are held to the lexicon', () => {
  assert.equal(listNameProblem('Blocked by my mutuals'), null);
  assert.match(listNameProblem('   ') ?? '', /name/);
  assert.match(listNameProblem('x'.repeat(65)) ?? '', /too long/);
  // 64 bytes is the limit, not 64 characters: each of these is four.
  assert.match(listNameProblem('🙂'.repeat(17)) ?? '', /too long/);
  assert.equal(listNameProblem('🙂'.repeat(16)), null);
  assert.equal(listDescriptionProblem('a'.repeat(300)), null);
  assert.match(listDescriptionProblem('a'.repeat(301)) ?? '', /301/);
  assert.equal(listDescriptionProblem(defaultListDescription(3, 1234, new Date('2026-11-18T12:00:00Z'))), null);
});

test('the default description says what the list is', () => {
  const text = defaultListDescription(3, 1234, new Date('2026-11-18T12:00:00Z'));
  assert.match(text, /at least 3 of the 1,234 mutuals/);
  assert.match(text, /2026-11-18/);
  assert.match(defaultListDescription(1, 5, new Date('2026-11-18T12:00:00Z')), /at least one of the 5/);
});

test('the list and its members are written as moderation-list records', () => {
  const record = listRecord('  Mine ', ' ', '2026-11-18T00:00:00.000Z');
  assert.deepEqual(record, {
    $type: 'app.bsky.graph.list',
    purpose: 'app.bsky.graph.defs#modlist',
    name: 'Mine',
    createdAt: '2026-11-18T00:00:00.000Z',
  });
  assert.equal(listRecord('Mine', 'Why', '').description, 'Why');

  const list = `at://${did(1)}/app.bsky.graph.list/3kabc`;
  const writes = listItemWrites(list, [did(2), did(3)], '2026-11-18T00:00:00.000Z');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], {
    $type: 'com.atproto.repo.applyWrites#create',
    collection: 'app.bsky.graph.listitem',
    value: { $type: 'app.bsky.graph.listitem', subject: did(2), list, createdAt: '2026-11-18T00:00:00.000Z' },
  });
});

test('members go in batches applyWrites accepts, and cost three points each', () => {
  const subjects = Array.from({ length: 450 }, (_, i) => did(i));
  const batches = chunk(subjects, APPLY_WRITES_MAX);
  assert.deepEqual(batches.map((b) => b.length), [200, 200, 50]);
  assert.deepEqual(batches.flat(), subjects);
  assert.equal(savePoints(450, false), 451 * CREATE_POINTS);
  assert.equal(savePoints(450, true), 452 * CREATE_POINTS);
});

test('a list URI becomes its Bluesky page', () => {
  assert.equal(
    bskyListUrl(`at://${did(1)}/app.bsky.graph.list/3kabc`),
    `https://bsky.app/profile/${did(1)}/lists/3kabc`,
  );
  assert.equal(bskyListUrl(`at://${did(1)}/app.bsky.feed.post/3kabc`), null);
});

test('the summary reads as a sentence', () => {
  assert.equal(summary(1204, 3, 312), '1,204 accounts are blocked by at least 3 of 312 mutuals');
  assert.equal(summary(1, 1, 1), '1 account is blocked by at least one of 1 mutual');
});

function snapshot(overrides: Partial<ScanSnapshot> = {}): ScanSnapshot {
  return {
    v: 1,
    actor: 'alice.example.com',
    did: did(0),
    savedAt: 1_000_000,
    account: { did: did(0), handle: 'alice.example.com', displayName: null, avatar: null },
    mutuals: [
      { did: did(1), handle: 'b.example.com', displayName: 'B', avatar: null },
      { did: did(2), handle: null, displayName: null, avatar: null },
    ],
    states: [
      { status: 'done', blocks: 2, listBlocks: 0 },
      { status: 'skipped', blocks: 0, reason: 'its PDS did not answer' },
    ],
    follows: [did(1), did(2)],
    ownBlocks: null,
    tally: [[did(5), [0, 1]]],
    counts: [0, 3, 1],
    listBlocks: [],
    blocksRead: 2,
    stopped: false,
    partialMutuals: false,
    ...overrides,
  };
}

test('a kept scan comes back for the same input while it is fresh', () => {
  const raw = JSON.stringify(snapshot());
  assert.deepEqual(readSnapshot(raw, 'Alice.Example.com', 1_000_000 + 1000), snapshot());
  assert.equal(readSnapshot(raw, 'bob.example.com', 1_000_000), null);
  assert.equal(readSnapshot(raw, 'alice.example.com', 1_000_000 + SNAPSHOT_MAX_AGE_MS + 1), null);
  assert.equal(readSnapshot(null, 'alice.example.com', 1_000_000), null);
  assert.equal(readSnapshot('{not json', 'alice.example.com', 1_000_000), null);
});

test('a kept scan with the wrong shape is ignored', () => {
  const now = 1_000_000;
  const bad = (overrides: Record<string, unknown>) =>
    readSnapshot(JSON.stringify({ ...snapshot(), ...overrides }), 'alice.example.com', now);
  assert.equal(bad({ v: 2 }), null);
  assert.equal(bad({ states: [] }), null);
  assert.equal(bad({ states: [{ status: 'nope' }, { status: 'done' }] }), null);
  // A blocker index past the mutuals would draw nothing, or the wrong person.
  assert.equal(bad({ tally: [[did(5), [0, 7]]] }), null);
  assert.equal(bad({ counts: [0, -1] }), null);
  assert.equal(bad({ mutuals: [{ did: 3 }, { did: did(2) }] }), null);
});

test('only accounts with two or more blockers are kept by name', () => {
  const tally = tallyOf({ 0: [1, 2], 1: [1] });
  assert.deepEqual(slimTally(tally), [[did(1), [0, 1]]]);
});

test('a scope allows the list only when it allows creating each record', () => {
  const both = ['app.bsky.graph.list', 'app.bsky.graph.listitem'];
  assert.equal(scopeAllowsCreate('atproto repo:*?action=create repo:*?action=delete', both), true);
  assert.equal(scopeAllowsCreate('atproto transition:generic', both), true);
  assert.equal(scopeAllowsCreate('atproto repo:*', both), true);
  assert.equal(scopeAllowsCreate('atproto repo:*?action=delete', both), false);
  assert.equal(scopeAllowsCreate('atproto repo:app.bsky.graph.list?action=create', both), false);
  assert.equal(
    scopeAllowsCreate('atproto repo?collection=app.bsky.graph.list&collection=app.bsky.graph.listitem&action=create', both),
    true,
  );
  assert.equal(scopeAllowsCreate('atproto', both), false);
  assert.equal(scopeAllowsCreate(null, both), null);
});
