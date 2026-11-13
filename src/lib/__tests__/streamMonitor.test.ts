import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_KINDS,
  DEFAULT_VIEW,
  PRESETS,
  collectionMatches,
  compileFilter,
  describePlcChange,
  itemFromJetstream,
  itemFromPlc,
  matchesExceptKind,
  matchesFilter,
  matchesText,
  parseAccountToken,
  parseCollectionToken,
  plcKind,
  viewFromSearch,
  viewToSearch,
  type MonitorView,
} from '@/lib/streamMonitor';
import type { JetstreamEvent } from '@/utils/atproto/jetstream';
import type { PlcStreamEntry } from '@/utils/atproto/plcStream';

const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';

// --- rows ------------------------------------------------------------------

test('a created post becomes a row with its text and a record link', () => {
  const evt: JetstreamEvent = {
    did: DID,
    time_us: 1_700_000_000_000_000,
    kind: 'commit',
    commit: {
      operation: 'create',
      collection: 'app.bsky.feed.post',
      rkey: '3kabc',
      record: { $type: 'app.bsky.feed.post', text: 'hello there' },
    },
  };
  const item = itemFromJetstream(evt, JSON.stringify(evt), 1);
  assert.equal(item.kind, 'create');
  assert.equal(item.source, 'jetstream');
  assert.equal(item.time, 1_700_000_000_000);
  assert.equal(item.preview, 'hello there');
  assert.equal(item.rkey, '3kabc');
  assert.equal(item.href, `/explore/${DID}/app.bsky.feed.post/3kabc`);
  assert.equal(item.collection, 'app.bsky.feed.post');
});

test('a delete links to the collection, since the record is gone', () => {
  const evt: JetstreamEvent = {
    did: DID,
    time_us: 1,
    kind: 'commit',
    commit: { operation: 'delete', collection: 'app.bsky.feed.like', rkey: '3kxyz' },
  };
  const item = itemFromJetstream(evt, '', 2);
  assert.equal(item.kind, 'delete');
  assert.equal(item.rkey, '3kxyz');
  assert.equal(item.preview, undefined);
  assert.equal(item.href, `/explore/${DID}/app.bsky.feed.like`);
});

test('identity and account events summarise what they carry', () => {
  const withHandle = itemFromJetstream(
    { did: DID, time_us: 1, kind: 'identity', identity: { did: DID, handle: 'alice.example.com', seq: 1, time: '' } },
    '',
    3,
  );
  assert.equal(withHandle.handle, 'alice.example.com');
  const bare = itemFromJetstream(
    { did: DID, time_us: 1, kind: 'identity', identity: { did: DID, seq: 1, time: '' } },
    '',
    4,
  );
  assert.equal(bare.handle, undefined);
  const account = itemFromJetstream(
    { did: DID, time_us: 1, kind: 'account', account: { did: DID, active: false, status: 'takendown', seq: 1, time: '' } },
    '',
    5,
  );
  assert.equal(account.kind, 'account');
  assert.equal(account.active, false);
  assert.equal(account.status, 'takendown');
  assert.equal(account.href, `/explore/${DID}`);
});

function plcEntry(operation: PlcStreamEntry['operation']): PlcStreamEntry {
  return { seq: 10, type: 'sequenced_op', did: DID, operation, cid: 'bafy', createdAt: '2026-01-02T03:04:05.000Z' };
}

test('PLC operations are sorted into new, update and tombstone', () => {
  assert.equal(plcKind({ type: 'plc_operation', prev: null }), 'plc-new');
  assert.equal(plcKind({ type: 'create', prev: null }), 'plc-new');
  assert.equal(plcKind({ type: 'plc_operation', prev: 'bafyprev' }), 'plc-update');
  assert.equal(plcKind({ type: 'plc_tombstone', prev: 'bafyprev' }), 'plc-tombstone');
});

test('a PLC row shows the claimed handle and PDS host', () => {
  const item = itemFromPlc(
    plcEntry({
      type: 'plc_operation',
      prev: null,
      alsoKnownAs: ['at://alice.example.com'],
      services: { atproto_pds: { type: 'AtprotoPersonalDataServer', endpoint: 'https://pds.example.com/' } },
    }),
    '',
    6,
  );
  assert.equal(item.kind, 'plc-new');
  assert.equal(item.handle, 'alice.example.com');
  assert.equal(item.pds, 'pds.example.com');
  assert.equal(item.time, Date.parse('2026-01-02T03:04:05.000Z'));
});

test('legacy create operations still yield a handle and host', () => {
  const item = itemFromPlc(
    plcEntry({ type: 'create', prev: null, handle: 'bob.example.com', service: 'https://pds.example.com' }),
    '',
    7,
  );
  assert.equal(item.handle, 'bob.example.com');
  assert.equal(item.pds, 'pds.example.com');
});

test('text matching is case-insensitive and empty matches everything', () => {
  assert.ok(matchesText('{"text":"Hello World"}', 'hello'));
  assert.ok(!matchesText('{"text":"Hello World"}', 'goodbye'));
  assert.ok(matchesText('anything', ''));
});

// --- typed filters ---------------------------------------------------------

test('accounts are read from DIDs, handles, @handles and at:// URIs', () => {
  assert.deepEqual(parseAccountToken(DID), { kind: 'did', did: DID });
  assert.deepEqual(parseAccountToken('@Alice.Example.com'), { kind: 'handle', handle: 'alice.example.com' });
  assert.deepEqual(parseAccountToken(`at://${DID}/app.bsky.feed.post/3k`), { kind: 'did', did: DID });
  assert.deepEqual(parseAccountToken('at://alice.example.com'), { kind: 'handle', handle: 'alice.example.com' });
  assert.equal(parseAccountToken('not a handle'), null);
  assert.equal(parseAccountToken('localhost'), null);
  assert.equal(parseAccountToken('did:plc:'), null);
});

test('collections accept NSIDs and namespace wildcards only', () => {
  assert.equal(parseCollectionToken('app.bsky.feed.post'), 'app.bsky.feed.post');
  assert.equal(parseCollectionToken(' app.bsky.graph.* '), 'app.bsky.graph.*');
  assert.equal(parseCollectionToken('app.bsky.*'), 'app.bsky.*');
  assert.equal(parseCollectionToken('app.*'), null);
  assert.equal(parseCollectionToken('app.bsky.graph.fo*'), null);
  assert.equal(parseCollectionToken('app.bsky'), null);
  assert.equal(parseCollectionToken('*'), null);
});

// --- query string ----------------------------------------------------------

function roundTrip(view: MonitorView): MonitorView {
  return viewFromSearch(new URLSearchParams(viewToSearch(view)));
}

test('the default view writes an empty query string', () => {
  assert.equal(viewToSearch(DEFAULT_VIEW), '');
  assert.deepEqual(viewFromSearch(new URLSearchParams('')), DEFAULT_VIEW);
});

test('a filtered view survives the query string', () => {
  const view: MonitorView = {
    source: 'both',
    kinds: ['create', 'plc-new'],
    accounts: ['alice.example.com', DID],
    collections: ['app.bsky.feed.post', 'app.bsky.graph.*'],
    text: 'hello',
  };
  assert.deepEqual(roundTrip(view), view);
});

test('a hidden source keeps all its kinds when read back', () => {
  const view: MonitorView = { ...DEFAULT_VIEW, source: 'jetstream', kinds: ['create', 'plc-new'] };
  const search = viewToSearch(view);
  assert.equal(search, 'source=jetstream&type=create');
  const back = viewFromSearch(new URLSearchParams(search));
  assert.deepEqual(back.kinds, ['create', 'plc-new', 'plc-update', 'plc-tombstone']);
});

test('every visible kind switched off is recorded, not lost', () => {
  const view: MonitorView = { ...DEFAULT_VIEW, kinds: [] };
  assert.equal(viewToSearch(view), 'type=none');
  assert.deepEqual(roundTrip(view).kinds, []);
});

test('a PLC-only view leaves collections out of the link', () => {
  const view: MonitorView = { ...DEFAULT_VIEW, source: 'plc', collections: ['app.bsky.feed.post'] };
  assert.equal(viewToSearch(view), 'source=plc');
});

test('junk in the query string is dropped', () => {
  const view = viewFromSearch(
    new URLSearchParams('source=nope&type=bogus&type=create&account=%20&account=not%20valid&collection=app'),
  );
  assert.equal(view.source, 'both');
  assert.deepEqual(view.kinds, ['create']);
  assert.deepEqual(view.accounts, []);
  assert.deepEqual(view.collections, []);
  assert.equal(ALL_KINDS.length, 8);
});

test('a post with nothing to preview has no preview, not a second timestamp', () => {
  const item = itemFromJetstream(
    {
      did: DID,
      time_us: 1,
      kind: 'commit',
      commit: {
        operation: 'create',
        collection: 'app.bsky.feed.post',
        rkey: '3kimg',
        record: { $type: 'app.bsky.feed.post', text: '', createdAt: '2026-01-02T03:04:05.000Z' },
      },
    },
    '',
    8,
  );
  assert.equal(item.preview, undefined);
  assert.equal(item.rkey, '3kimg');
});

// --- matching --------------------------------------------------------------

test('collection filters match exact NSIDs and namespaces', () => {
  assert.ok(collectionMatches('app.bsky.graph.follow', ['app.bsky.graph.*']));
  assert.ok(collectionMatches('app.bsky.feed.post', ['app.bsky.feed.post']));
  assert.ok(!collectionMatches('app.bsky.feed.postgate', ['app.bsky.feed.post']));
  assert.ok(!collectionMatches('app.bsky.graphs.thing', ['app.bsky.graph.*']));
});

test('filters narrow by source, account, collection and text; kinds are separate', () => {
  const other = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
  const f = compileFilter(
    { ...DEFAULT_VIEW, kinds: ['create'], collections: ['app.bsky.feed.*'], text: 'Hello' },
    new Set([DID]),
  );
  const post = { source: 'jetstream' as const, kind: 'create' as const, did: DID, collection: 'app.bsky.feed.post', raw: '{"text":"hello"}' };
  assert.ok(matchesFilter(f, post));
  assert.ok(!matchesFilter(f, { ...post, did: other }));
  assert.ok(!matchesFilter(f, { ...post, collection: 'app.bsky.graph.follow' }));
  assert.ok(!matchesFilter(f, { ...post, raw: '{"text":"bye"}' }));
  // An update passes everything but its kind, so it is counted, not listed.
  assert.ok(matchesExceptKind(f, { ...post, kind: 'update' }));
  assert.ok(!matchesFilter(f, { ...post, kind: 'update' }));
  // Identity events carry no collection and pass the collection filter.
  assert.ok(matchesExceptKind(f, { source: 'jetstream', kind: 'identity', did: DID, raw: 'hello' }));
  // A PLC-only view drops Jetstream events.
  assert.ok(!matchesExceptKind(compileFilter({ ...DEFAULT_VIEW, source: 'plc' }, null), post));
  // Accounts asked for but none resolved: nothing passes.
  assert.ok(!matchesExceptKind(compileFilter(DEFAULT_VIEW, new Set()), post));
});

// --- PLC changes and presets -------------------------------------------------

test('a PLC update names what moved', () => {
  const prev = {
    type: 'plc_operation',
    prev: null,
    alsoKnownAs: ['at://alice.example.com'],
    services: { atproto_pds: { type: 'AtprotoPersonalDataServer', endpoint: 'https://old.example.com' } },
    rotationKeys: ['did:key:a'],
    verificationMethods: { atproto: 'did:key:s1' },
  };
  const next = {
    ...prev,
    prev: 'bafyprev',
    alsoKnownAs: ['at://alice.example.net'],
    services: { atproto_pds: { type: 'AtprotoPersonalDataServer', endpoint: 'https://new.example.com' } },
  };
  assert.deepEqual(describePlcChange(prev, next), [
    { label: 'Handle', from: 'alice.example.com', to: 'alice.example.net' },
    { label: 'PDS', from: 'old.example.com', to: 'new.example.com' },
  ]);
  const rotated = { ...next, rotationKeys: ['did:key:b'], verificationMethods: { atproto: 'did:key:s2' } };
  assert.deepEqual(
    describePlcChange(next, rotated).map((c) => c.label),
    ['Signing key', 'Rotation keys'],
  );
  // A genesis operation has nothing before it: everything it sets is new.
  assert.deepEqual(
    describePlcChange(null, prev).map((c) => [c.label, c.from, c.to]),
    [
      ['Handle', null, 'alice.example.com'],
      ['PDS', null, 'old.example.com'],
      ['Signing key', null, 'did:key:s1'],
    ],
  );
});

test('every preset survives the query string and is distinct', () => {
  const seen = new Set<string>();
  for (const preset of PRESETS) {
    const search = viewToSearch(preset.view);
    assert.ok(search, `${preset.id} is not the default view`);
    assert.equal(viewToSearch(viewFromSearch(new URLSearchParams(search))), search, preset.id);
    assert.ok(!seen.has(search), `${preset.id} duplicates another preset`);
    seen.add(search);
  }
});
