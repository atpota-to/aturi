import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLexiconChecks,
  conventionHandle,
  foundSchema,
  lexiconVerdict,
  normalizeNsidInput,
  nsidAuthority,
  nsidProblem,
  parentAuthorities,
  readLexiconRecords,
  readSchemaDocument,
  readTxtAnswer,
  schemaRecordUri,
  unquoteTxt,
  type LexiconEvidence,
  type RecordProbe,
  type TxtProbe,
} from '@/lib/tools/lexicon';

const NSID = 'com.example.blog.post';
const DID = 'did:plc:4v4y5r3lwsbtmsxhile2ljac';
const OTHER = 'did:plc:6msi3pj7krzih5qxqtryxlzw';
const PDS = 'https://pds.example.com';

const DOC = {
  $type: 'com.atproto.lexicon.schema',
  lexicon: 1,
  id: NSID,
  defs: {
    main: {
      type: 'record',
      key: 'tid',
      record: {
        type: 'object',
        required: ['text'],
        properties: { text: { type: 'string' }, createdAt: { type: 'string', format: 'datetime' } },
      },
    },
    reply: { type: 'object', properties: { parent: { type: 'string' } } },
  },
};

function dns(records: string[], status?: TxtProbe['status']): TxtProbe {
  return { name: '_lexicon.blog.example.com', status: status ?? (records.length ? 'found' : 'none'), records };
}

const found = (value: unknown = DOC): RecordProbe => ({
  status: 'found',
  pds: PDS,
  uri: schemaRecordUri(DID, NSID),
  cid: 'bafyreia',
  value,
});

const document = {
  alsoKnownAs: ['at://lexicons.example.com'],
  service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
};

const statuses = (evidence: LexiconEvidence) => buildLexiconChecks(evidence).map((c) => [c.id, c.status]);

test('normalizeNsidInput tidies what people paste', () => {
  assert.deepEqual(normalizeNsidInput(' app.bsky.feed.post '), { ok: true, nsid: 'app.bsky.feed.post' });
  assert.deepEqual(normalizeNsidInput('lex:app.bsky.feed.post#replyRef'), { ok: true, nsid: 'app.bsky.feed.post' });
  assert.deepEqual(
    normalizeNsidInput(`at://${DID}/com.atproto.lexicon.schema/app.bsky.feed.post`),
    { ok: true, nsid: 'app.bsky.feed.post' },
  );
  assert.deepEqual(
    normalizeNsidInput('https://aturi.to/explore/lexicons/app.bsky.feed.post?view=files'),
    { ok: true, nsid: 'app.bsky.feed.post' },
  );
  assert.equal(normalizeNsidInput('').ok, false);
  const namespace = normalizeNsidInput('app.bsky.*');
  assert.equal(namespace.ok, false);
  assert.match(namespace.ok ? '' : namespace.reason, /namespace/);
});

test('nsidProblem says what is wrong with an NSID', () => {
  assert.equal(nsidProblem('app.bsky.feed.post'), null);
  assert.equal(nsidProblem('com.example.fooBar'), null);
  assert.match(nsidProblem('bsky.app') ?? '', /three parts/);
  assert.match(nsidProblem('app.bsky.feed_post') ?? '', /letters, digits/);
  assert.match(nsidProblem('app.bsky.3d') ?? '', /name/);
  assert.match(nsidProblem('app..post') ?? '', /empty part/);
});

test('the authority is every part but the name, reversed', () => {
  assert.deepEqual(nsidAuthority('app.bsky.feed.post'), { domain: 'feed.bsky.app', name: 'post' });
  // The spec's own example.
  assert.deepEqual(nsidAuthority('edu.university.dept.lab.blogging.getBlogPost'), {
    domain: 'blogging.lab.dept.university.edu',
    name: 'getBlogPost',
  });
  assert.deepEqual(nsidAuthority('app.toy.record'), { domain: 'toy.app', name: 'record' });
});

test('parentAuthorities stops at two labels and never names a TLD', () => {
  assert.deepEqual(parentAuthorities('feed.bsky.app'), ['bsky.app']);
  assert.deepEqual(parentAuthorities('bsky.app'), []);
  assert.deepEqual(parentAuthorities('a.b.c.d.example.com'), ['b.c.d.example.com', 'c.d.example.com', 'd.example.com']);
});

test('conventionHandle is the first two parts, reversed', () => {
  assert.equal(conventionHandle('app.bsky.feed.post'), 'bsky.app');
  assert.equal(conventionHandle('net.anisota.harvest.minigame'), 'anisota.net');
});

test('readTxtAnswer reads only TXT answers and tells an error from an empty name', () => {
  const name = '_lexicon.feed.bsky.app';
  assert.deepEqual(readTxtAnswer(name, { Status: 0, Answer: [{ type: 16, data: `did=${DID}` }] }), {
    name,
    status: 'found',
    records: [`did=${DID}`],
  });
  // A CNAME on the way to the TXT record is not a record.
  assert.deepEqual(
    readTxtAnswer(name, { Status: 0, Answer: [{ type: 5, data: 'elsewhere.example.' }, { type: 16, data: '"did=x"' }] }).records,
    ['did=x'],
  );
  assert.equal(readTxtAnswer(name, { Status: 3 }).status, 'none');
  assert.equal(readTxtAnswer(name, { Status: 0 }).status, 'none');
  assert.equal(readTxtAnswer(name, { Status: 2 }).status, 'error');
  assert.equal(readTxtAnswer(name, null).status, 'error');
});

test('unquoteTxt joins a record split into several strings', () => {
  assert.equal(unquoteTxt('"did=did:plc:abc"'), 'did=did:plc:abc');
  assert.equal(unquoteTxt('"did=did:plc:" "abc"'), 'did=did:plc:abc');
  assert.equal(unquoteTxt('did=did:plc:abc'), 'did=did:plc:abc');
});

test('readLexiconRecords accepts one did= record and explains the rest', () => {
  assert.equal(readLexiconRecords([`did=${DID}`]).did, DID);
  assert.equal(readLexiconRecords(['did=did:web:lex.example.com']).did, 'did:web:lex.example.com');
  assert.equal(readLexiconRecords([]).absent, true);
  assert.equal(readLexiconRecords([]).problem, null);
  assert.ok(readLexiconRecords(['v=spf1 -all']).problem);
  assert.match(readLexiconRecords([`did=${DID}`, `did=${OTHER}`]).problem ?? '', /More than one/);
  assert.match(readLexiconRecords([`did = ${DID}`]).problem ?? '', /exactly/);
  assert.match(readLexiconRecords(['did=lexicons.example.com']).problem ?? '', /not a valid/);
});

test('readSchemaDocument passes a well-formed document and summarises it', () => {
  const reading = readSchemaDocument(NSID, DOC);
  assert.deepEqual(reading.problems, []);
  assert.deepEqual(reading.notes, []);
  assert.equal(reading.summary, 'Defines a record keyed by tid with 2 fields, and 1 other definition.');
});

test('readSchemaDocument names each thing wrong with a document', () => {
  assert.match(readSchemaDocument(NSID, 'nope').problems[0], /not a JSON object/);
  assert.match(readSchemaDocument(NSID, { ...DOC, lexicon: '1' }).problems[0], /must be the number 1/);
  assert.match(readSchemaDocument(NSID, { ...DOC, id: 'com.example.blog.other' }).problems[0], /must match/);
  assert.match(readSchemaDocument(NSID, { ...DOC, defs: undefined }).problems[0], /defs field is missing/);
  assert.match(readSchemaDocument(NSID, { ...DOC, defs: {} }).problems[0], /empty/);
  assert.match(readSchemaDocument(NSID, { ...DOC, defs: { '#main': DOC.defs.main } }).problems[0], /must not include a #/);
  // A missing $type is worth a word, not a failure.
  const untyped = readSchemaDocument(NSID, { ...DOC, $type: undefined });
  assert.deepEqual(untyped.problems, []);
  assert.equal(untyped.notes.length, 1);
});

test('a document with no main definition is still a lexicon', () => {
  const reading = readSchemaDocument('com.example.blog.defs', {
    $type: 'com.atproto.lexicon.schema',
    lexicon: 1,
    id: 'com.example.blog.defs',
    defs: { a: { type: 'object', properties: {} }, b: { type: 'token' } },
  });
  assert.deepEqual(reading.problems, []);
  assert.match(reading.summary ?? '', /no main definition/);
});

test('a published lexicon passes every step', () => {
  const evidence: LexiconEvidence = { nsid: NSID, dns: dns([`did=${DID}`]), document, record: found() };
  assert.deepEqual(statuses(evidence), [
    ['nsid', 'pass'],
    ['dns', 'pass'],
    ['authority', 'pass'],
    ['record', 'pass'],
    ['schema', 'pass'],
  ]);
  assert.equal(lexiconVerdict(evidence, buildLexiconChecks(evidence)).tone, 'pass');
  assert.equal(foundSchema(evidence)?.via, 'dns');
});

test('no DNS record fails, skips the rest, and reports the convention as a note', () => {
  const evidence: LexiconEvidence = {
    nsid: NSID,
    dns: dns([]),
    parents: [],
    convention: { handle: 'example.com', did: null, record: null },
  };
  assert.deepEqual(statuses(evidence), [
    ['nsid', 'pass'],
    ['dns', 'fail'],
    ['authority', 'skip'],
    ['record', 'skip'],
    ['schema', 'skip'],
    ['convention', 'info'],
  ]);
  const verdict = lexiconVerdict(evidence, buildLexiconChecks(evidence));
  assert.equal(verdict.tone, 'fail');
  assert.match(verdict.text, /_lexicon\.blog\.example\.com/);
});

test('a record one level too high is named, and its DID goes into the fix', () => {
  const evidence: LexiconEvidence = {
    nsid: NSID,
    dns: dns([]),
    parents: [{ name: '_lexicon.example.com', did: DID }],
    convention: { handle: 'example.com', did: DID, record: { status: 'missing', pds: PDS } },
  };
  const check = buildLexiconChecks(evidence).find((c) => c.id === 'dns');
  assert.match(check?.summary ?? '', /_lexicon\.example\.com/);
  assert.match(check?.fix?.[0] ?? '', new RegExp(`_lexicon\\.blog\\.example\\.com.*did=${DID}`));
});

test('the fix only names a DID there is a reason to trust', () => {
  const fixFor = (evidence: LexiconEvidence) => buildLexiconChecks(evidence).find((c) => c.id === 'dns')?.fix?.[0] ?? '';
  // The handle resolves, but its repository has no such schema: no DID offered.
  assert.match(
    fixFor({
      nsid: NSID,
      dns: dns([]),
      parents: [],
      convention: { handle: 'example.com', did: OTHER, record: { status: 'missing', pds: PDS } },
    }),
    /did=<the DID/,
  );
  // Its repository does hold the schema: that DID is the one to point at.
  assert.match(
    fixFor({
      nsid: NSID,
      dns: dns([]),
      parents: [],
      convention: {
        handle: 'example.com',
        did: OTHER,
        record: { status: 'found', pds: PDS, uri: schemaRecordUri(OTHER, NSID), value: DOC },
      },
    }),
    new RegExp(`did=${OTHER}`),
  );
});

test('a schema found only by the handle convention is a warning, not a pass', () => {
  const evidence: LexiconEvidence = {
    nsid: NSID,
    dns: dns([]),
    parents: [],
    convention: { handle: 'example.com', did: DID, record: found() },
  };
  const checks = buildLexiconChecks(evidence);
  assert.equal(checks.find((c) => c.id === 'convention')?.status, 'info');
  assert.equal(lexiconVerdict(evidence, checks).tone, 'warn');
  assert.equal(foundSchema(evidence)?.via, 'convention');
});

test('a DID with no schema record fails at the record', () => {
  const evidence: LexiconEvidence = {
    nsid: NSID,
    dns: dns([`did=${DID}`]),
    document,
    record: { status: 'missing', pds: PDS },
  };
  assert.deepEqual(statuses(evidence).slice(3), [
    ['record', 'fail'],
    ['schema', 'skip'],
  ]);
  const verdict = lexiconVerdict(evidence, buildLexiconChecks(evidence));
  assert.equal(verdict.tone, 'fail');
  assert.match(verdict.title, /no schema/);
});

test('a DID that does not resolve, or has no PDS, fails at the repository', () => {
  const unresolved: LexiconEvidence = { nsid: NSID, dns: dns([`did=${DID}`]), document: null };
  assert.equal(buildLexiconChecks(unresolved).find((c) => c.id === 'authority')?.status, 'fail');
  const hostless: LexiconEvidence = { nsid: NSID, dns: dns([`did=${DID}`]), document: { service: [] } };
  const check = buildLexiconChecks(hostless).find((c) => c.id === 'authority');
  assert.equal(check?.status, 'fail');
  assert.match(check?.summary ?? '', /names no PDS/);
});

test('a malformed document fails the last step and the verdict says so', () => {
  const evidence: LexiconEvidence = {
    nsid: NSID,
    dns: dns([`did=${DID}`]),
    document,
    record: found({ ...DOC, id: 'com.example.blog.wrong', lexicon: 2 }),
  };
  const checks = buildLexiconChecks(evidence);
  const schema = checks.find((c) => c.id === 'schema');
  assert.equal(schema?.status, 'fail');
  assert.equal(schema?.detail?.length, 2);
  assert.match(lexiconVerdict(evidence, checks).title, /not valid/);
});

test('steps not yet observed are pending, and so is the verdict', () => {
  const waiting: LexiconEvidence = { nsid: NSID };
  assert.deepEqual(statuses(waiting), [
    ['nsid', 'pass'],
    ['dns', 'pending'],
    ['authority', 'pending'],
    ['record', 'pending'],
    ['schema', 'pending'],
  ]);
  const partial: LexiconEvidence = { nsid: NSID, dns: dns([`did=${DID}`]), document };
  assert.deepEqual(statuses(partial).slice(2), [
    ['authority', 'pass'],
    ['record', 'pending'],
    ['schema', 'pending'],
  ]);
  assert.equal(lexiconVerdict(partial, buildLexiconChecks(partial)).tone, 'pending');
});

test('a failed DNS lookup is a failure of the lookup, not of the lexicon', () => {
  const evidence: LexiconEvidence = {
    nsid: NSID,
    dns: { name: '_lexicon.blog.example.com', status: 'error', records: [], error: 'the resolver did not answer' },
    parents: [],
    convention: { handle: 'example.com', did: null, record: null },
  };
  const check = buildLexiconChecks(evidence).find((c) => c.id === 'dns');
  assert.equal(check?.status, 'fail');
  assert.match(check?.summary ?? '', /lookup failed/);
  assert.equal(check?.fix, undefined);
});
