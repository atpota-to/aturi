import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatProblem,
  graphemeLength,
  recordKeyProblem,
  referencedLexicons,
  validateRecord,
  type LexiconDocLike,
} from '@/lib/tools/validate';

/** A cut-down post lexicon with the parts worth exercising. */
const POST: LexiconDocLike = {
  id: 'com.example.post',
  defs: {
    main: {
      type: 'record',
      key: 'tid',
      record: {
        type: 'object',
        required: ['text', 'createdAt'],
        nullable: ['note'],
        properties: {
          text: { type: 'string', maxLength: 30, maxGraphemes: 10 },
          createdAt: { type: 'string', format: 'datetime' },
          langs: { type: 'array', maxLength: 2, items: { type: 'string', format: 'language' } },
          likes: { type: 'integer', minimum: 0, maximum: 100 },
          visibility: { type: 'string', knownValues: ['public', 'followers'] },
          kind: { type: 'string', enum: ['note', 'article'] },
          note: { type: 'string' },
          reply: { type: 'ref', ref: '#replyRef' },
          subject: { type: 'ref', ref: 'com.example.strongRef' },
          embed: { type: 'union', refs: ['com.example.embed.images', 'com.example.embed.external#view'] },
          strict: { type: 'union', closed: true, refs: ['#replyRef'] },
          avatar: { type: 'blob', accept: ['image/*'], maxSize: 1000 },
          hash: { type: 'cid-link' },
          sig: { type: 'bytes', maxLength: 4 },
        },
      },
    },
    replyRef: {
      type: 'object',
      required: ['parent'],
      properties: { parent: { type: 'string', format: 'at-uri' } },
    },
  },
};

const STRONG_REF: LexiconDocLike = {
  id: 'com.example.strongRef',
  defs: {
    main: {
      type: 'object',
      required: ['uri', 'cid'],
      properties: { uri: { type: 'string', format: 'at-uri' }, cid: { type: 'string', format: 'cid' } },
    },
  },
};

const IMAGES: LexiconDocLike = {
  id: 'com.example.embed.images',
  defs: { main: { type: 'object', required: ['images'], properties: { images: { type: 'array', items: { type: 'unknown' } } } } },
};

const docs = (...extra: LexiconDocLike[]) =>
  new Map<string, LexiconDocLike | null>([POST, ...extra].map((doc) => [String(doc.id), doc]));

const base = { $type: 'com.example.post', text: 'hello', createdAt: '2026-01-31T12:00:00.000Z' };
const CID = 'bafyreibu7nij5fidh2dx7ljpypstqetii3q7333it52w3l3uekrpbuj5rq';

const problems = (record: unknown, map = docs()) =>
  validateRecord(record, 'com.example.post', map).issues.map((issue) => `${issue.path}: ${issue.message}`);

test('a record that fits its schema has no issues', () => {
  const result = validateRecord(base, 'com.example.post', docs());
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.unresolved, []);
  assert.ok(result.checked > 0);
});

test('missing required fields and wrong types are named by path', () => {
  const found = problems({ $type: 'com.example.post', text: 5 });
  assert.ok(found.some((p) => p.startsWith('createdAt: is required')));
  assert.ok(found.some((p) => p.startsWith('text: must be a string, but is an integer')));
});

test('$type must be present and name the lexicon', () => {
  assert.ok(problems({ text: 'hi', createdAt: base.createdAt }).some((p) => p.startsWith('$type: is required')));
  assert.ok(problems({ ...base, $type: 'com.example.other' }).some((p) => p.startsWith('$type: is "com.example.other"')));
});

test('string limits count bytes and graphemes separately', () => {
  // Ten family emoji: ten graphemes, far more than 30 bytes.
  const family = '👨‍👩‍👧‍👦';
  assert.equal(graphemeLength(family), 1);
  const found = problems({ ...base, text: family.repeat(10) });
  assert.ok(found.some((p) => /text: is \d+ bytes long, over the limit of 30/.test(p)));
  assert.ok(!found.some((p) => /characters long/.test(p)));
  assert.ok(problems({ ...base, text: 'abcdefghijk' }).some((p) => p === 'text: is 11 characters long, over the limit of 10'));
});

test('formats are checked', () => {
  assert.ok(problems({ ...base, createdAt: '2026-01-31' }).some((p) => p.startsWith('createdAt: must be a datetime')));
  assert.ok(problems({ ...base, langs: ['en', 'not a tag'] }).some((p) => p.startsWith('langs[1]: must be a language tag')));
  assert.equal(formatProblem('datetime', '2026-01-31T12:00:00Z'), null);
  assert.equal(formatProblem('datetime', '2026-01-31T12:00:00+01:00'), null);
  assert.ok(formatProblem('datetime', '2026-01-31T12:00:00'));
  assert.ok(formatProblem('datetime', '2026-01-31T12:00:00-00:00'));
  assert.equal(formatProblem('at-uri', 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3n22yg6lg2k2f'), null);
  assert.equal(formatProblem('at-uri', 'at://bsky.app'), null);
  assert.ok(formatProblem('at-uri', 'https://bsky.app'));
  assert.equal(formatProblem('did', 'did:web:example.com'), null);
  assert.ok(formatProblem('did', 'example.com'));
  assert.equal(formatProblem('at-identifier', 'bsky.app'), null);
  assert.equal(formatProblem('nsid', 'app.bsky.feed.post'), null);
  assert.ok(formatProblem('nsid', 'bsky.app'));
  assert.equal(formatProblem('cid', CID), null);
  assert.equal(formatProblem('tid', '3n22yg6lg2k2f'), null);
  assert.ok(formatProblem('tid', 'self'));
  assert.equal(formatProblem('uri', 'https://example.com/a'), null);
  assert.ok(formatProblem('uri', 'not a uri'));
  // A format this does not know is not a failure.
  assert.equal(formatProblem('made-up', 'anything'), null);
});

test('integers, enums and known values', () => {
  assert.ok(problems({ ...base, likes: 101 }).some((p) => p === 'likes: is 101, over the maximum of 100'));
  assert.ok(problems({ ...base, likes: '3' }).some((p) => p.startsWith('likes: must be an integer')));
  assert.ok(problems({ ...base, kind: 'poem' }).some((p) => p.startsWith('kind: must be one of')));
  const result = validateRecord({ ...base, visibility: 'circle' }, 'com.example.post', docs());
  assert.deepEqual(result.issues.map((i) => i.severity), ['warning']);
});

test('decimal numbers are refused wherever they are', () => {
  assert.ok(problems({ ...base, extra: { ratio: 0.5 } }).some((p) => p.startsWith('extra.ratio: is 0.5')));
});

test('null is only allowed where the schema says so', () => {
  assert.deepEqual(problems({ ...base, note: null }), []);
  assert.ok(problems({ ...base, likes: null }).some((p) => p.startsWith('likes: is null')));
});

test('arrays are bounded and their items checked', () => {
  assert.ok(problems({ ...base, langs: ['en', 'fr', 'de'] }).some((p) => p === 'langs: has 3 items, over the limit of 2'));
  assert.ok(problems({ ...base, langs: 'en' }).some((p) => p.startsWith('langs: must be an array')));
});

test('a local ref is followed', () => {
  assert.ok(problems({ ...base, reply: {} }).some((p) => p.startsWith('reply.parent: is required')));
  assert.ok(problems({ ...base, reply: { parent: 'nope' } }).some((p) => p.startsWith('reply.parent: must be an at:// URI')));
});

test('a ref to another lexicon is checked when it was found, and listed when it was not', () => {
  const record = { ...base, subject: { uri: 'at://bsky.app', cid: 'nope' } };
  const without = validateRecord(record, 'com.example.post', docs());
  assert.deepEqual(without.issues, []);
  assert.deepEqual(without.unresolved, ['com.example.strongRef']);

  const withRef = validateRecord(record, 'com.example.post', docs(STRONG_REF));
  assert.deepEqual(withRef.unresolved, []);
  assert.ok(withRef.issues.some((i) => i.path === 'subject.cid'));

  // Looked for and not published: still unchecked, still said.
  const missing = docs();
  missing.set('com.example.strongRef', null);
  assert.deepEqual(validateRecord(record, 'com.example.post', missing).unresolved, ['com.example.strongRef']);
});

test('unions match on $type, and only closed ones refuse a stranger', () => {
  const map = docs(IMAGES);
  assert.ok(problems({ ...base, embed: { $type: 'com.example.embed.images' } }, map).some((p) => p.startsWith('embed.images: is required')));
  // #main is the same type.
  assert.ok(problems({ ...base, embed: { $type: 'com.example.embed.images#main' } }, map).some((p) => p.startsWith('embed.images: is required')));
  assert.deepEqual(problems({ ...base, embed: { $type: 'com.other.thing' } }, map), []);
  assert.ok(problems({ ...base, embed: {} }, map).some((p) => p.startsWith('embed.$type: is required')));
  assert.ok(problems({ ...base, strict: { $type: 'com.other.thing' } }, map).some((p) => p.startsWith('strict.$type: is "com.other.thing"')));
  assert.ok(problems({ ...base, strict: { $type: 'com.example.post#replyRef' } }, map).some((p) => p.startsWith('strict.parent: is required')));
});

test('blobs, CID links and bytes', () => {
  const blob = { $type: 'blob', ref: { $link: CID }, mimeType: 'image/png', size: 10 };
  assert.deepEqual(problems({ ...base, avatar: blob, hash: { $link: CID }, sig: { $bytes: 'AAEC' } }), []);
  assert.ok(problems({ ...base, avatar: { ...blob, mimeType: 'video/mp4' } }).some((p) => p.startsWith('avatar.mimeType: is video/mp4')));
  assert.ok(problems({ ...base, avatar: { ...blob, size: 5000 } }).some((p) => p.startsWith('avatar.size: is 5000 bytes')));
  assert.ok(problems({ ...base, hash: CID }).some((p) => p.startsWith('hash: must be a CID link')));
  assert.ok(problems({ ...base, sig: { $bytes: 'AAECAwQFBgc=' } }).some((p) => p.startsWith('sig: is 8 bytes')));
  const legacy = validateRecord({ ...base, avatar: { cid: CID, mimeType: 'image/png' } }, 'com.example.post', docs());
  assert.deepEqual(legacy.issues.map((i) => i.severity), ['warning']);
});

test('a lexicon that is not there, or is not a record type, is said plainly', () => {
  const none = validateRecord({ $type: 'com.example.gone' }, 'com.example.gone', new Map());
  assert.deepEqual(none.unresolved, ['com.example.gone']);
  const query = new Map<string, LexiconDocLike | null>([['com.example.q', { id: 'com.example.q', defs: { main: { type: 'query' } } }]]);
  assert.ok(validateRecord({ $type: 'com.example.q' }, 'com.example.q', query).issues.some((i) => /defines a query/.test(i.message)));
  assert.ok(validateRecord('text', 'com.example.post', docs()).issues.length === 1);
});

test('the record key is held to the key type', () => {
  assert.equal(recordKeyProblem('tid', '3n22yg6lg2k2f'), null);
  assert.ok(recordKeyProblem('tid', 'self'));
  assert.equal(recordKeyProblem('literal:self', 'self'), null);
  assert.ok(recordKeyProblem('literal:self', '3n22yg6lg2k2f'));
  assert.equal(recordKeyProblem('any', 'whatever'), null);
  const result = validateRecord(base, 'com.example.post', docs(), { rkey: 'self' });
  assert.ok(result.issues.some((i) => /TID record key/.test(i.message)));
});

test('referencedLexicons lists other documents once, and not this one', () => {
  assert.deepEqual(referencedLexicons(POST, 'com.example.post').sort(), [
    'com.example.embed.external',
    'com.example.embed.images',
    'com.example.strongRef',
  ]);
});

test('a schema that refers to itself does not loop', () => {
  const tree: LexiconDocLike = {
    id: 'com.example.tree',
    defs: {
      main: { type: 'record', record: { type: 'object', properties: { child: { type: 'ref', ref: '#node' } } } },
      node: { type: 'object', properties: { child: { type: 'ref', ref: '#node' } } },
    },
  };
  let nested: Record<string, unknown> = {};
  for (let i = 0; i < 100; i++) nested = { child: nested };
  const result = validateRecord({ $type: 'com.example.tree', ...nested }, 'com.example.tree', new Map([['com.example.tree', tree]]));
  assert.deepEqual(result.issues, []);
});
