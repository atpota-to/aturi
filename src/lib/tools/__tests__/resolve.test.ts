import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_QUERY_LENGTH,
  classifyRow,
  countRows,
  listForQuery,
  parseIdentifierList,
  pdsHost,
  pendingRow,
  readIdentifier,
  rowStatus,
  rowsToCsv,
  rowsToJson,
  type IdentifierEntry,
} from '@/lib/tools/resolve';

const DID = 'did:plc:z72i7hdynmk6r22z27h6tvur';
const PDS = 'https://puffball.us-east.host.bsky.network';

const handle = (value: string): IdentifierEntry => ({ input: value, kind: 'handle', value });
const did = (value: string): IdentifierEntry => ({ input: value, kind: 'did', value });

test('readIdentifier reads every shape an account is written in', () => {
  assert.deepEqual(readIdentifier('Alice.Example.com'), { input: 'Alice.Example.com', kind: 'handle', value: 'alice.example.com' });
  assert.deepEqual(readIdentifier('@alice.example.com'), { input: '@alice.example.com', kind: 'handle', value: 'alice.example.com' });
  assert.deepEqual(readIdentifier(DID), { input: DID, kind: 'did', value: DID });
  assert.equal(readIdentifier(`at://${DID}/app.bsky.feed.post/3kabc`).value, DID);
  assert.equal(readIdentifier('at://alice.example.com').value, 'alice.example.com');
  assert.equal(readIdentifier('https://bsky.app/profile/alice.example.com/post/3kabc').value, 'alice.example.com');
  assert.equal(readIdentifier(`https://bsky.app/profile/${DID}`).value, DID);
  // A link that is not a profile names its own host.
  assert.equal(readIdentifier('https://alice.example.com/about').value, 'alice.example.com');
  assert.equal(readIdentifier('did:web:example.com').kind, 'did');
});

test('readIdentifier sheds the punctuation a list arrives in', () => {
  assert.equal(readIdentifier('"alice.example.com"').value, 'alice.example.com');
  assert.equal(readIdentifier('(alice.example.com).').value, 'alice.example.com');
  assert.equal(readIdentifier('<@alice.example.com>').value, 'alice.example.com');
});

test('readIdentifier keeps what it cannot read, with a reason', () => {
  const word = readIdentifier('alice');
  assert.equal(word.kind, 'invalid');
  assert.equal(word.value, 'alice');
  assert.ok(word.reason);
  assert.equal(readIdentifier('did:plc:short').kind, 'invalid');
  assert.equal(readIdentifier('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK').kind, 'invalid');
  assert.equal(readIdentifier('not_a_handle.com').kind, 'invalid');
});

test('parseIdentifierList splits on lines, commas and spaces, and keeps the order', () => {
  const { entries, duplicates, dropped } = parseIdentifierList(
    `bsky.app, atproto.com\n\n${DID};  @jay.bsky.team\tpfrazee.com`,
  );
  assert.deepEqual(
    entries.map((e) => e.value),
    ['bsky.app', 'atproto.com', DID, 'jay.bsky.team', 'pfrazee.com'],
  );
  assert.equal(duplicates, 0);
  assert.equal(dropped, 0);
});

test('parseIdentifierList drops repeats however they are spelled', () => {
  const { entries, duplicates } = parseIdentifierList('bsky.app\n@BSKY.app\nhttps://bsky.app/profile/bsky.app\natproto.com');
  assert.deepEqual(entries.map((e) => e.value), ['bsky.app', 'atproto.com']);
  // The first spelling is the one shown.
  assert.equal(entries[0].input, 'bsky.app');
  assert.equal(duplicates, 2);
});

test('parseIdentifierList stops at the cap and counts what it left out', () => {
  const text = Array.from({ length: 12 }, (_, i) => `user${i}.example.com`).join('\n');
  const { entries, dropped } = parseIdentifierList(text, 10);
  assert.equal(entries.length, 10);
  assert.equal(dropped, 2);
  assert.deepEqual(parseIdentifierList('   \n ,, ').entries, []);
});

test('listForQuery keeps a short list in the link and refuses a long one', () => {
  const { entries } = parseIdentifierList('@bsky.app\nnot_a_handle\ndid:plc:z72i7hdynmk6r22z27h6tvur');
  assert.equal(listForQuery(entries), `bsky.app,not_a_handle,${DID}`);
  // And the link reads back to the same list.
  assert.deepEqual(parseIdentifierList(listForQuery(entries) as string).entries.map((e) => e.value), entries.map((e) => e.value));

  const long = parseIdentifierList(Array.from({ length: 200 }, (_, i) => `user${i}.example.com`).join('\n')).entries;
  assert.ok(long.map((e) => e.value).join(',').length > MAX_QUERY_LENGTH);
  assert.equal(listForQuery(long), null);
});

test('a handle that resolves and is claimed back is resolved, with nothing flagged', () => {
  const row = classifyRow(handle('bsky.app'), { did: DID, handle: 'bsky.app', pds: PDS });
  assert.equal(row.state, 'resolved');
  assert.deepEqual(row.flags, []);
  assert.deepEqual(rowStatus(row), { tone: 'pass', label: 'Resolved' });
});

test('what is off about a resolved row is flagged', () => {
  const invalid = classifyRow(did(DID), { did: DID, handle: 'handle.invalid', pds: PDS });
  assert.deepEqual(invalid.flags, ['handle-invalid']);
  // The placeholder is not a handle, so it is not shown as one.
  assert.equal(invalid.handle, null);
  assert.equal(rowStatus(invalid).label, 'Handle not verified');

  const bare = classifyRow(did(DID), { did: DID, handle: null, pds: PDS });
  assert.deepEqual(bare.flags, ['no-handle']);
  assert.equal(rowStatus(bare).tone, 'warn');

  const moved = classifyRow(handle('old.example.com'), { did: DID, handle: 'New.example.com', pds: PDS });
  assert.deepEqual(moved.flags, ['handle-differs']);
  assert.match(rowStatus(moved).note ?? '', /new\.example\.com/);

  const hostless = classifyRow(handle('bsky.app'), { did: DID, handle: 'bsky.app', pds: null });
  assert.deepEqual(hostless.flags, ['no-pds']);
});

test('a row that found nothing says which kind of nothing', () => {
  assert.equal(rowStatus(classifyRow(handle('nobody.example.com'), null)).label, 'Does not resolve');
  assert.equal(rowStatus(classifyRow(did(DID), null)).label, 'DID not found');
  const junk = pendingRow(readIdentifier('alice'));
  assert.equal(junk.state, 'invalid');
  assert.equal(rowStatus(junk).tone, 'fail');
  assert.equal(rowStatus(pendingRow(handle('bsky.app'))).label, 'Resolving');
});

test('countRows tallies a table in progress', () => {
  const rows = [
    classifyRow(handle('bsky.app'), { did: DID, handle: 'bsky.app', pds: PDS }),
    classifyRow(did(DID), { did: DID, handle: null, pds: PDS }),
    classifyRow(handle('nobody.example.com'), null),
    pendingRow(readIdentifier('alice')),
    pendingRow(handle('atproto.com')),
  ];
  assert.deepEqual(countRows(rows), { total: 5, settled: 4, resolved: 2, failed: 2, flagged: 1 });
});

test('pdsHost reads the host out of an endpoint', () => {
  assert.equal(pdsHost(PDS), 'puffball.us-east.host.bsky.network');
  assert.equal(pdsHost('https://pds.example.com:2583/'), 'pds.example.com:2583');
  assert.equal(pdsHost(null), null);
});

test('rowsToCsv quotes what needs it and keeps formulas as text', () => {
  const rows = [
    classifyRow({ input: '@bsky.app', kind: 'handle', value: 'bsky.app' }, { did: DID, handle: 'bsky.app', pds: PDS }),
    pendingRow({ input: '=cmd|"x",1', kind: 'invalid', value: '=cmd|"x",1', reason: 'no' }),
  ];
  assert.equal(
    rowsToCsv(rows),
    [
      'input,did,handle,pds,status',
      `'@bsky.app,${DID},bsky.app,${PDS},Resolved`,
      `"'=cmd|""x"",1",,,,Not an identifier`,
      '',
    ].join('\r\n'),
  );
});

test('rowsToJson gives the same columns', () => {
  const rows = [classifyRow(handle('bsky.app'), { did: DID, handle: 'bsky.app', pds: PDS })];
  assert.deepEqual(JSON.parse(rowsToJson(rows)), [
    { input: 'bsky.app', did: DID, handle: 'bsky.app', pds: PDS, status: 'Resolved' },
  ]);
});
