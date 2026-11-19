import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildThread, type ThreadPostInput } from '@/lib/socialGraph';
import {
  blockBetween,
  blockLinks,
  blockWords,
  blockedWith,
  indexBlocks,
  parentsOf,
  participantsByPriority,
  pathTo,
  postMatches,
  readCut,
  sortReplies,
  type CutContext,
  type CutReply,
} from '@/lib/threadInsights';

const MOD = 'did:plc:ar7c4by46qjdydhdevvrndac';

const post = (uri: string, parent: string | null, did: string, over: Partial<ThreadPostInput> = {}): ThreadPostInput => ({
  uri,
  parent,
  did,
  text: '',
  createdAt: '2026-11-01T00:00:00Z',
  likes: 0,
  reposts: 0,
  replies: 0,
  quotes: 0,
  hasMedia: false,
  ...over,
});

test('blocks are indexed both ways and read either way round', () => {
  const index = indexBlocks([
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' },
    { from: 'c', to: 'a' },
    { from: 'd', to: 'd' },
  ]);
  assert.deepEqual(blockBetween(index, 'a', 'b'), { aBlocksB: true, bBlocksA: true });
  assert.deepEqual(blockBetween(index, 'a', 'c'), { aBlocksB: false, bBlocksA: true });
  assert.deepEqual(blockBetween(index, 'c', 'a'), { aBlocksB: true, bBlocksA: false });
  assert.equal(blockBetween(index, 'b', 'c'), null);
  assert.equal(blockBetween(null, 'a', 'b'), null);
  assert.deepEqual([...blockedWith(index, 'a')].sort(), ['b', 'c']);
  // A block of oneself is noise, and each pair is listed once.
  assert.equal(index.has('d'), false);
  assert.equal(blockLinks(index).length, 2);
});

test('a block reads in words with its direction', () => {
  assert.equal(blockWords({ aBlocksB: true, bBlocksA: false }, '@a', '@b'), '@a blocks @b');
  assert.equal(blockWords({ aBlocksB: false, bBlocksA: true }, '@a', '@b'), '@b blocks @a');
  assert.equal(blockWords({ aBlocksB: true, bBlocksA: true }, '@a', '@b'), '@a and @b block each other');
});

const cut = (over: Partial<CutReply> = {}): CutReply => ({
  uri: 'at://r/app.bsky.feed.post/1',
  did: 'r',
  parent: 'at://p/app.bsky.feed.post/1',
  text: 'hello',
  hasMedia: false,
  served: true,
  account: 'active',
  labels: [],
  ...over,
});

const ctx = (over: Partial<CutContext> = {}): CutContext => ({
  rootDid: 'op',
  parentDid: 'p',
  name: (d) => `@${d}`,
  blocks: indexBlocks([]),
  blocksDone: true,
  blocksRead: () => true,
  gateRestricted: false,
  ...over,
});

test('an account Bluesky has acted on explains a missing reply before anything else', () => {
  const blocks = indexBlocks([{ from: 'op', to: 'r' }]);
  assert.equal(readCut(cut({ account: 'suspended' }), ctx({ blocks })).cause, 'suspended');
  assert.equal(readCut(cut({ account: 'deactivated' }), ctx()).cause, 'deactivated');
  assert.equal(readCut(cut({ account: 'missing' }), ctx()).cause, 'missing');
  assert.equal(readCut(cut({ served: false }), ctx({ blocks })).cause, 'withheld');
  assert.match(readCut(cut({ served: false, text: null }), ctx()).reason, /couldn’t be read/);
});

test('a block with the parent’s or the thread’s author explains a reply served on its own', () => {
  const parent = readCut(cut(), ctx({ blocks: indexBlocks([{ from: 'p', to: 'r' }]) }));
  assert.equal(parent.cause, 'block');
  assert.equal(parent.label, 'Block with @p');
  assert.match(parent.reason, /^@p blocks @r, who wrote the post it replies to/);
  const root = readCut(cut(), ctx({ blocks: indexBlocks([{ from: 'r', to: 'op' }]) }));
  assert.equal(root.label, 'Block with @op');
  assert.match(root.reason, /^@r blocks @op, who started the thread/);
});

test('labels and reply limits explain a reply, and every explanation found is kept', () => {
  const labelled = readCut(
    cut({ labels: [{ val: 'spam', src: MOD }, { val: '!no-unauthenticated', src: 'r' }] }),
    ctx({ gateRestricted: true }),
  );
  assert.equal(labelled.cause, 'labelled');
  assert.equal(labelled.label, 'Labelled “spam”');
  assert.match(labelled.reason, /^Bluesky’s moderators labelled @r/);
  assert.equal(labelled.also.length, 1);
  assert.match(labelled.also[0], /limits who can reply/);
  // The thread's author is never outside their own limits.
  assert.equal(readCut(cut({ did: 'op' }), ctx({ gateRestricted: true, parentDid: 'op' })).cause, 'unexplained');
});

test('with nothing to explain it, a reply waits for the blocks and then reads as unexplained', () => {
  assert.equal(readCut(cut(), ctx({ blocksDone: false })).cause, 'checking');
  // A block found before the rest have come back explains it at once.
  assert.equal(readCut(cut(), ctx({ blocksDone: false, blocks: indexBlocks([{ from: 'r', to: 'p' }]) })).cause, 'block');
  const done = readCut(cut(), ctx());
  assert.equal(done.cause, 'unexplained');
  assert.equal(done.tone, 'unknown');
  assert.match(done.also[0], /moderation list/);
  const partial = readCut(cut(), ctx({ blocksRead: (d) => d !== 'p' }));
  assert.match(partial.also[0], /Not everyone’s blocks were read/);
});

test('search finds text, names and handles, and @ matches handles from the start', () => {
  const p = { text: 'A café on the corner', handle: 'alice.bsky.social', displayName: 'Alice Royal' };
  assert.ok(postMatches(p, 'cafe'));
  assert.ok(postMatches(p, 'ROYAL'));
  assert.ok(postMatches(p, 'bsky.social'));
  assert.ok(postMatches(p, '@ali'));
  assert.ok(!postMatches(p, '@royal'));
  assert.ok(!postMatches(p, '@'));
  assert.ok(!postMatches(p, '   '));
});

test('replies sort four ways, ties broken by age', () => {
  const root = buildThread(
    [
      post('r', null, 'op'),
      post('a', 'r', 'x', { createdAt: '2026-11-01T01:00:00Z', likes: 5 }),
      post('b', 'r', 'x', { createdAt: '2026-11-01T02:00:00Z', likes: 9 }),
      post('c', 'r', 'x', { createdAt: '2026-11-01T03:00:00Z', likes: 5 }),
      post('b1', 'b', 'y', { createdAt: '2026-11-01T04:00:00Z' }),
    ],
    'r',
  )!;
  const order = (o: Parameters<typeof sortReplies>[1]) => sortReplies(root.kids, o).map((p) => p.uri);
  assert.deepEqual(order('discussed'), ['b', 'a', 'c']);
  assert.deepEqual(order('oldest'), ['a', 'b', 'c']);
  assert.deepEqual(order('newest'), ['c', 'b', 'a']);
  assert.deepEqual(order('liked'), ['b', 'a', 'c']);
});

test('a path runs from the first post down to each post asked for', () => {
  const root = buildThread(
    [post('r', null, 'op'), post('a', 'r', 'x'), post('a1', 'a', 'y'), post('a2', 'a1', 'z'), post('b', 'r', 'y')],
    'r',
  )!;
  const parents = parentsOf(root);
  assert.deepEqual([...pathTo(parents, ['a2'])].sort(), ['a', 'a1', 'a2', 'r']);
  assert.deepEqual([...pathTo(parents, ['a1', 'b'])].sort(), ['a', 'a1', 'b', 'r']);
  assert.deepEqual([...pathTo(parents, ['nowhere'])], ['nowhere']);
});

test('participants come thread author first, then the opened post, then named, then by posts', () => {
  const root = buildThread(
    [
      post('r', null, 'op'),
      post('a', 'r', 'x'),
      post('b', 'r', 'y'),
      post('c', 'b', 'y'),
      post('d', 'c', 'z'),
      post('e', 'r', 'w'),
    ],
    'r',
  )!;
  assert.deepEqual(participantsByPriority(root, { focus: 'd', first: ['w', 'ghost'] }), ['op', 'z', 'w', 'ghost', 'y', 'x']);
});
