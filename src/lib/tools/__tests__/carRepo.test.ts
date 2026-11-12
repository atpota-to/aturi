import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCar } from '@/lib/tools/car';
import { CidLink } from '@/lib/tools/cbor';
import {
  RepoError,
  createRepoReader,
  exportRecord,
  openArchive,
  readRecord,
  readRepo,
  type OpenProgress,
} from '@/lib/tools/carRepo';
import { archiveChecks, type ArchiveCheck, type HashProgress } from '@/lib/tools/carChecks';
import { buildJsonExport } from '@/lib/tools/carExport';
import { appOfCollection, formatBytes } from '@/lib/tools/carFormat';
import { DID, block, carFile, cidFor, commit, encode, node, sampleRepo } from './carFixtures';

const summary = (bytes: Uint8Array) => {
  const repo = readRepo(readCar(bytes));
  return Object.fromEntries(repo.collections.map((c) => [c.nsid, c.rkeys]));
};

test('the commit is read from the first root', () => {
  const { bytes, head, top } = sampleRepo();
  const { commit: read } = readRepo(readCar(bytes));
  assert.deepEqual(read, {
    cid: head.cid.toString(),
    did: DID,
    version: 3,
    rev: '3n22yg6lg2k2f',
    data: top.cid.toString(),
    prev: null,
    signatureBytes: 64,
  });
});

test('the tree is walked left to right, with keys rebuilt from their prefixes', () => {
  const { bytes, records } = sampleRepo();
  const repo = readRepo(readCar(bytes));
  assert.deepEqual(
    repo.collections.map((c) => [c.nsid, c.rkeys]),
    [
      ['app.bsky.feed.like', ['3aaa', '3bbb']],
      ['app.bsky.feed.post', ['3aaa', '3bbb', '3ccc']],
    ],
  );
  assert.deepEqual(repo.collections[1].cids, [
    records.post1.cid.toString(),
    records.post2.cid.toString(),
    records.post3.cid.toString(),
  ]);
  assert.equal(repo.recordCount, 5);
  assert.equal(repo.nodeCount, 3);
  assert.deepEqual(
    [repo.missingNodes.length, repo.missingRecords, repo.unreachedBlocks, repo.outOfOrder, repo.malformedKeys],
    [0, 0, 0, 0, 0],
  );
});

test('a record is decoded on demand, as JSON', () => {
  const { bytes, records } = sampleRepo();
  const repo = readRepo(readCar(bytes));
  assert.deepEqual(readRecord(repo, records.post2.cid.toString()), {
    $type: 'app.bsky.feed.post',
    text: 'two',
    createdAt: '2026-01-04T00:00:00.000Z',
  });
  assert.equal(readRecord(repo, cidFor(encode('absent')).toString()), null);
  assert.deepEqual(exportRecord(repo, repo.collections[1], 1), {
    uri: `at://${DID}/app.bsky.feed.post/3bbb`,
    cid: records.post2.cid.toString(),
    value: { $type: 'app.bsky.feed.post', text: 'two', createdAt: '2026-01-04T00:00:00.000Z' },
  });
});

test('an empty repository is one node with no entries', () => {
  const top = node(null, []);
  const head = commit(DID, top.cid);
  const repo = readRepo(readCar(carFile([head.cid], [head, top])));
  assert.equal(repo.recordCount, 0);
  assert.deepEqual(repo.collections, []);
  assert.equal(repo.nodeCount, 1);
});

test('a subtree that is not in the file is reported, and the rest still listed', () => {
  const { head, top, left, right, records } = sampleRepo();
  // Everything but the right-hand node.
  const bytes = carFile([head.cid], [head, top, left, ...Object.values(records)]);
  const repo = readRepo(readCar(bytes));
  assert.deepEqual(repo.missingNodes, [right.cid.toString()]);
  assert.equal(repo.recordCount, 3);
  // The two records only that node listed are in the file, but nothing reaches them.
  assert.equal(repo.unreachedBlocks, 2);
});

test('a listed record whose block is absent is counted, and still listed', () => {
  const { head, top, left, right, records } = sampleRepo();
  const bytes = carFile([head.cid], [head, top, left, right, records.like1, records.like2, records.post1, records.post2]);
  const repo = readRepo(readCar(bytes));
  assert.equal(repo.recordCount, 5);
  assert.equal(repo.missingRecords, 1);
  assert.equal(readRecord(repo, records.post3.cid.toString()), null);
  assert.equal(exportRecord(repo, repo.collections[1], 2), null);
});

test('blocks nothing links to are counted', () => {
  const { head, blocks } = sampleRepo();
  const stray = block({ unrelated: true });
  const repo = readRepo(readCar(carFile([head.cid], [...blocks, stray])));
  assert.equal(repo.unreachedBlocks, 1);
});

test('keys out of order, and keys that are not collection/rkey, are counted', () => {
  const a = block({ n: 1 });
  const b = block({ n: 2 });
  const c = block({ n: 3 });
  const d = block({ n: 4 });
  const top = node(null, [
    { p: 0, k: 'com.example.b/2', v: a.cid },
    { p: 0, k: 'com.example.a/1', v: b.cid },
    { p: 0, k: 'no-slash-here', v: c.cid },
    { p: 0, k: 'too/many/parts', v: d.cid },
  ]);
  const head = commit(DID, top.cid);
  const repo = readRepo(readCar(carFile([head.cid], [head, top, a, b, c, d])));
  assert.equal(repo.outOfOrder, 1);
  assert.equal(repo.malformedKeys, 2);
  assert.deepEqual(summary(carFile([head.cid], [head, top, a, b, c, d])), {
    'com.example.b': ['2'],
    'com.example.a': ['1'],
  });
});

test('a prefix longer than the key before it is clamped rather than read past', () => {
  const a = block({ n: 1 });
  const top = node(null, [{ p: 50, k: 'com.example.a/1', v: a.cid }]);
  const head = commit(DID, top.cid);
  assert.deepEqual(summary(carFile([head.cid], [head, top, a])), { 'com.example.a': ['1'] });
});

test('a subtree linked from two places is walked once', () => {
  const a = block({ n: 1 });
  // A node cannot hold its own hash, so a true loop cannot be built by hand.
  // The guard that stops one is the same that refuses a second visit.
  const inner = node(null, [{ p: 0, k: 'com.example.a/1', v: a.cid }]);
  const top = node(inner.cid, [{ p: 0, k: 'com.example.a/2', v: a.cid, t: inner.cid }]);
  const head = commit(DID, top.cid);
  const repo = readRepo(readCar(carFile([head.cid], [head, top, inner, a])));
  assert.equal(repo.nodeCount, 2);
  assert.deepEqual(summary(carFile([head.cid], [head, top, inner, a])), { 'com.example.a': ['1', '2'] });
});

test('a CAR file that is not a repository is refused in words', () => {
  const stray = block({ hello: 'world' });
  assert.throws(() => readRepo(readCar(carFile([stray.cid], [stray]))), /not a repository commit/);
  assert.throws(() => readRepo(readCar(carFile([], [stray]))), /names no root/);
  assert.throws(() => readRepo(readCar(carFile([cidFor(encode('gone'))], [stray]))), RepoError);
});

test('a commit without a signature or with a previous commit is read as such', () => {
  const top = node(null, []);
  const previous = cidFor(encode('previous'));
  const head = block({ did: DID, version: 2, data: top.cid, rev: '3n22yg6lg2k2f', prev: new CidLink(previous.bytes) });
  const { commit: read } = readRepo(readCar(carFile([head.cid], [head, top])));
  assert.equal(read.signatureBytes, null);
  assert.equal(read.prev, previous.toString());
  assert.equal(read.version, 2);
});

test('walking in steps lists the same records as walking straight through', () => {
  const { bytes } = sampleRepo();
  const whole = readRepo(readCar(bytes));
  const reader = createRepoReader(readCar(bytes));
  const seen: number[] = [];
  while (!reader.step(1)) seen.push(reader.recordCount());
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  const stepped = reader.archive();
  assert.deepEqual(stepped.collections, whole.collections);
  assert.equal(stepped.unreachedBlocks, whole.unreachedBlocks);
});

test('openArchive reads the same repository without blocking, and can be stopped', async () => {
  const { bytes } = sampleRepo();
  const progress: OpenProgress[] = [];
  const archive = await openArchive(bytes, { onProgress: (p) => progress.push(p) });
  assert.deepEqual(archive.collections, readRepo(readCar(bytes)).collections);
  // A file this small is read in one slice of each phase.
  assert.deepEqual(progress, []);

  await assert.rejects(openArchive(new TextEncoder().encode('not a car')), /does not look like a CAR file/);
});

test('the JSON export holds every record in listRecords shape', async () => {
  const { bytes, records } = sampleRepo();
  const repo = readRepo(readCar(bytes));
  const { blob, written, skipped } = await buildJsonExport(repo, repo.collections);
  assert.deepEqual([written, skipped], [5, 0]);
  const parsed = JSON.parse(await blob.text());
  assert.equal(parsed.repo, DID);
  assert.equal(parsed.rev, '3n22yg6lg2k2f');
  assert.deepEqual(parsed.collections, ['app.bsky.feed.like', 'app.bsky.feed.post']);
  assert.equal(parsed.records.length, 5);
  assert.deepEqual(parsed.records[2], {
    uri: `at://${DID}/app.bsky.feed.post/3aaa`,
    cid: records.post1.cid.toString(),
    value: { $type: 'app.bsky.feed.post', text: 'one', createdAt: '2026-01-03T00:00:00.000Z' },
  });

  // One collection, and a repository with nothing in it, are still valid JSON.
  const one = await buildJsonExport(repo, [repo.collections[0]]);
  assert.equal(JSON.parse(await one.blob.text()).records.length, 2);
  const none = await buildJsonExport(repo, []);
  assert.deepEqual(JSON.parse(await none.blob.text()).records, []);
});

test('a record missing from the file is left out of the export and counted', async () => {
  const { head, top, left, right, records } = sampleRepo();
  const bytes = carFile([head.cid], [head, top, left, right, records.like1, records.like2, records.post1, records.post2]);
  const repo = readRepo(readCar(bytes));
  const { blob, written, skipped } = await buildJsonExport(repo, repo.collections);
  assert.deepEqual([written, skipped], [4, 1]);
  assert.equal(JSON.parse(await blob.text()).records.length, 4);
});

test('byte counts and app names read the way a person would say them', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(432_348), '422 KB');
  assert.equal(formatBytes(84_124_320), '80.2 MB');
  assert.equal(formatBytes(150 * 1024 * 1024), '150 MB');
  assert.equal(appOfCollection('app.bsky.feed.post'), 'app.bsky');
});

const statuses = (checks: ArchiveCheck[]) => Object.fromEntries(checks.map((c) => [c.id, c.status]));

test('a whole, well-formed archive passes its structural checks', () => {
  const repo = readRepo(readCar(sampleRepo().bytes));
  const checks = archiveChecks(repo, { state: 'idle' });
  assert.deepEqual(statuses(checks), {
    tree: 'pass',
    records: 'pass',
    keys: 'pass',
    // Not run until asked for, and never able to be run.
    hashes: 'info',
    signature: 'info',
  });
  assert.match(checks.find((c) => c.id === 'tree')?.summary ?? '', /All 3 nodes/);
  assert.match(checks.find((c) => c.id === 'records')?.summary ?? '', /All 5 listed records are/);
});

test('a missing subtree fails, a missing record warns, and stray blocks are a note', () => {
  const { head, top, left, right, records, blocks } = sampleRepo();
  const noRight = readRepo(readCar(carFile([head.cid], [head, top, left, ...Object.values(records)])));
  const first = archiveChecks(noRight, { state: 'idle' });
  assert.equal(statuses(first).tree, 'fail');
  assert.deepEqual(first.find((c) => c.id === 'tree')?.detail, [right.cid.toString()]);
  assert.equal(statuses(first).extra, 'info');

  const noRecord = readRepo(
    readCar(carFile([head.cid], [head, top, left, right, records.like1, records.like2, records.post1, records.post2])),
  );
  assert.equal(statuses(archiveChecks(noRecord, { state: 'idle' })).records, 'warn');

  const repeated = readRepo(readCar(carFile([head.cid], [...blocks, blocks[2]])));
  assert.match(archiveChecks(repeated, { state: 'idle' }).find((c) => c.id === 'extra')?.summary ?? '', /1 block appears more than once/);
});

test('the hash check reports where it has got to and how it came out', () => {
  const repo = readRepo(readCar(sampleRepo().bytes));
  const hashes = (progress: HashProgress) => archiveChecks(repo, progress).find((c) => c.id === 'hashes');
  assert.equal(hashes({ state: 'running', done: 4, total: 9 })?.status, 'pending');
  assert.equal(hashes({ state: 'done', result: { checked: 9, skipped: 0, mismatched: [] } })?.status, 'pass');
  const failed = hashes({ state: 'done', result: { checked: 9, skipped: 1, mismatched: ['bafy1', 'bafy2'] } });
  assert.equal(failed?.status, 'fail');
  assert.deepEqual(failed?.detail, ['bafy1', 'bafy2']);
  assert.match(failed?.summary ?? '', /2 blocks do not hash/);
  assert.match(failed?.summary ?? '', /1 block uses another hash/);
});

test('an unsigned or old-version commit is flagged', () => {
  const top = node(null, []);
  const head = block({ did: DID, version: 2, data: top.cid, rev: '3n22yg6lg2k2f', prev: null });
  const checks = archiveChecks(readRepo(readCar(carFile([head.cid], [head, top]))), { state: 'idle' });
  assert.equal(statuses(checks).signature, 'warn');
  assert.equal(statuses(checks).version, 'warn');
});
