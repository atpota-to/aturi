import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRecord,
  checkRecordKey,
  isValidRecordKey,
  type RecordProblem,
} from '@/utils/atproto/lexiconValidate';

/**
 * A validator that reports valid records as broken is worse than no validator,
 * because the one real finding arrives in a pile of noise. So these cover both
 * directions: the constraints that must be caught, and the shapes that must be
 * left alone.
 */

function doc(main: Record<string, unknown>, extraDefs: Record<string, unknown> = {}) {
  return {
    lexicon: 1,
    id: 'com.example.thing',
    defs: { main: { type: 'record', ...main }, ...extraDefs },
  };
}

function messages(problems: RecordProblem[], field: string | null): string[] {
  return problems.filter((p) => p.field === field).map((p) => p.message);
}

const POST_LIKE = doc({
  key: 'tid',
  record: {
    type: 'object',
    required: ['text', 'createdAt'],
    properties: {
      text: { type: 'string', maxLength: 3000, maxGraphemes: 300 },
      createdAt: { type: 'string', format: 'datetime' },
      langs: { type: 'array', items: { type: 'string', format: 'language' }, maxLength: 3 },
      replyCount: { type: 'integer', minimum: 0 },
      pinned: { type: 'boolean' },
    },
  },
});

test('a valid record produces nothing', () => {
  const problems = checkRecord('com.example.thing', POST_LIKE, {
    $type: 'com.example.thing',
    text: 'good morning',
    createdAt: '2026-09-18T20:41:55.450Z',
    langs: ['en', 'pt-BR'],
    replyCount: 0,
    pinned: false,
  });
  assert.deepEqual(problems, []);
});

test('a missing required field is an error against that field', () => {
  const problems = checkRecord('com.example.thing', POST_LIKE, {
    createdAt: '2026-09-18T20:41:55.450Z',
  });
  assert.deepEqual(messages(problems, 'text'), ['Required, and not set.']);
  assert.equal(problems.every((p) => p.severity === 'error'), true);
});

test('an empty string counts as not set for a required field', () => {
  const problems = checkRecord('com.example.thing', POST_LIKE, {
    text: '',
    createdAt: '2026-09-18T20:41:55.450Z',
  });
  assert.deepEqual(messages(problems, 'text'), ['Required, and not set.']);
});

test('graphemes are counted the way the limit means them', () => {
  // Eleven code units, seven code points, four graphemes: a family emoji
  // (ZWJ-joined), a flag (regional indicator pair), and two letters.
  const text = '👨‍👩‍👧🇵🇹ab';
  const tight = doc({
    key: 'tid',
    record: { type: 'object', properties: { text: { type: 'string', maxGraphemes: 4 } } },
  });
  assert.deepEqual(checkRecord('com.example.thing', tight, { text }), []);

  const tighter = doc({
    key: 'tid',
    record: { type: 'object', properties: { text: { type: 'string', maxGraphemes: 3 } } },
  });
  assert.match(messages(checkRecord('com.example.thing', tighter, { text }), 'text')[0], /4 characters/);
});

test('byte limits are counted in bytes, not code units', () => {
  // Five characters, ten bytes in UTF-8.
  const schema = doc({
    key: 'tid',
    record: { type: 'object', properties: { s: { type: 'string', maxLength: 9 } } },
  });
  const problems = checkRecord('com.example.thing', schema, { s: 'ééééé' });
  assert.match(messages(problems, 's')[0], /10 bytes, over the 9-byte limit/);
});

test('a datetime without a timezone is caught, which Date.parse would not be', () => {
  const problems = checkRecord('com.example.thing', POST_LIKE, {
    text: 'hi',
    createdAt: '2026-09-18T20:41:55',
  });
  assert.match(messages(problems, 'createdAt')[0], /RFC 3339/);
});

test('formats the spec fixes are errors, loose ones are warnings', () => {
  const schema = doc({
    key: 'tid',
    record: {
      type: 'object',
      properties: {
        subject: { type: 'string', format: 'did' },
        lang: { type: 'string', format: 'language' },
      },
    },
  });
  const problems = checkRecord('com.example.thing', schema, {
    subject: 'alice.example.com',
    lang: '!!',
  });
  assert.equal(problems.find((p) => p.field === 'subject')?.severity, 'error');
  assert.equal(problems.find((p) => p.field === 'lang')?.severity, 'warning');
});

test('a valid DID, at-uri and nsid pass their formats', () => {
  const schema = doc({
    key: 'tid',
    record: {
      type: 'object',
      properties: {
        did: { type: 'string', format: 'did' },
        uri: { type: 'string', format: 'at-uri' },
        nsid: { type: 'string', format: 'nsid' },
        who: { type: 'string', format: 'at-identifier' },
      },
    },
  });
  assert.deepEqual(
    checkRecord('com.example.thing', schema, {
      did: 'did:plc:xb2urvqt5f4zzccjs46hysbf',
      uri: 'at://did:plc:xb2urvqt5f4zzccjs46hysbf/app.bsky.feed.post/3kabc',
      nsid: 'app.bsky.feed.post',
      who: 'alice.example.com',
    }),
    [],
  );
});

test('a type mismatch names both sides', () => {
  const problems = checkRecord('com.example.thing', POST_LIKE, {
    text: 'hi',
    createdAt: '2026-09-18T20:41:55.450Z',
    replyCount: 'three',
  });
  assert.match(messages(problems, 'replyCount')[0], /a string; the schema wants a whole number/);
});

test('a decimal where an integer belongs is caught', () => {
  const problems = checkRecord('com.example.thing', POST_LIKE, {
    text: 'hi',
    createdAt: '2026-09-18T20:41:55.450Z',
    replyCount: 1.5,
  });
  assert.match(messages(problems, 'replyCount')[0], /a decimal number/);
});

test('array limits and item problems are both reported', () => {
  const tooMany = checkRecord('com.example.thing', POST_LIKE, {
    text: 'hi',
    createdAt: '2026-09-18T20:41:55.450Z',
    langs: ['en', 'fr', 'de', 'pt'],
  });
  assert.match(messages(tooMany, 'langs')[0], /4 items, over the limit of 3/);

  const badItem = checkRecord('com.example.thing', POST_LIKE, {
    text: 'hi',
    createdAt: '2026-09-18T20:41:55.450Z',
    langs: ['en', '!!'],
  });
  assert.match(messages(badItem, 'langs')[0], /Item 2:/);
});

test('enum is enforced and knownValues only warns', () => {
  const schema = doc({
    key: 'tid',
    record: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'closed'] },
        purpose: { type: 'string', knownValues: ['curate'] },
      },
    },
  });
  const problems = checkRecord('com.example.thing', schema, { status: 'maybe', purpose: 'other' });
  assert.equal(problems.find((p) => p.field === 'status')?.severity, 'error');
  assert.equal(problems.find((p) => p.field === 'purpose')?.severity, 'warning');
});

test('a malformed blob is caught, and a good one passes its accept list', () => {
  const schema = doc({
    key: 'tid',
    record: {
      type: 'object',
      properties: { avatar: { type: 'blob', accept: ['image/*'], maxSize: 1000 } },
    },
  });

  const malformed = checkRecord('com.example.thing', schema, { avatar: { ref: 'bafy' } });
  assert.match(messages(malformed, 'avatar')[0], /needs \$type "blob"/);

  const good = {
    $type: 'blob',
    ref: { $link: 'bafkreiabc' },
    mimeType: 'image/png',
    size: 900,
  };
  assert.deepEqual(checkRecord('com.example.thing', schema, { avatar: good }), []);

  const wrongType = checkRecord('com.example.thing', schema, {
    avatar: { ...good, mimeType: 'video/mp4' },
  });
  assert.match(messages(wrongType, 'avatar')[0], /accepts image\/\*/);

  const tooBig = checkRecord('com.example.thing', schema, { avatar: { ...good, size: 2000 } });
  assert.match(messages(tooBig, 'avatar')[0], /over this field's 1000-byte limit/);
});

test('a property the lexicon does not declare is a warning, not an error', () => {
  const problems = checkRecord('com.example.thing', POST_LIKE, {
    text: 'hi',
    createdAt: '2026-09-18T20:41:55.450Z',
    somethingElse: 1,
  });
  const found = problems.find((p) => p.field === 'somethingElse');
  assert.equal(found?.severity, 'warning');
});

test('$type disagreeing with the collection is a record-level error', () => {
  const problems = checkRecord('com.example.thing', POST_LIKE, {
    $type: 'com.example.other',
    text: 'hi',
    createdAt: '2026-09-18T20:41:55.450Z',
  });
  assert.match(messages(problems, null)[0], /have to agree/);
});

test('an unresolvable schema still checks what it can', () => {
  // No document at all: $type against the collection is the only thing left
  // to say, and it is still worth saying.
  assert.deepEqual(checkRecord('com.example.thing', null, { $type: 'com.example.thing' }), []);
  assert.equal(checkRecord('com.example.thing', null, { $type: 'other' }).length, 1);
  assert.equal(checkRecord('com.example.thing', null, 'not an object')[0].severity, 'error');
});

test('a query lexicon has no record schema to check against', () => {
  const query = { lexicon: 1, id: 'com.example.get', defs: { main: { type: 'query' } } };
  assert.deepEqual(checkRecord('com.example.get', query, { anything: true }), []);
});

test('record keys are checked against the lexicon key type', () => {
  const selfKeyed = doc({ key: 'literal:self', record: { type: 'object', properties: {} } });
  assert.equal(checkRecordKey(selfKeyed, 'self'), null);
  assert.match(checkRecordKey(selfKeyed, 'notself')?.message ?? '', /has to be “self”/);
  assert.equal(checkRecordKey(selfKeyed, '')?.severity, 'error');

  const tidKeyed = doc({ key: 'tid', record: { type: 'object', properties: {} } });
  // Empty is how you ask the host for a timestamp key, which is the point.
  assert.equal(checkRecordKey(tidKeyed, ''), null);
  assert.equal(checkRecordKey(tidKeyed, '3jzfcijpj2z2a'), null);
  assert.equal(checkRecordKey(tidKeyed, 'my-key')?.severity, 'warning');

  const nsidKeyed = doc({ key: 'nsid', record: { type: 'object', properties: {} } });
  assert.equal(checkRecordKey(nsidKeyed, 'com.example.thing'), null);
  assert.equal(checkRecordKey(nsidKeyed, 'nope')?.severity, 'error');

  const anyKeyed = doc({ key: 'any', record: { type: 'object', properties: {} } });
  assert.equal(checkRecordKey(anyKeyed, 'anything-goes'), null);
  assert.equal(checkRecordKey(anyKeyed, '')?.severity, 'warning');
  assert.equal(checkRecordKey(anyKeyed, 'has space')?.severity, 'error');
});

test('record key syntax', () => {
  assert.equal(isValidRecordKey('self'), true);
  assert.equal(isValidRecordKey('3jzfcijpj2z2a'), true);
  assert.equal(isValidRecordKey('com.example.thing'), true);
  assert.equal(isValidRecordKey('a~b:c-d_e'), true);
  assert.equal(isValidRecordKey(''), false);
  assert.equal(isValidRecordKey('.'), false);
  assert.equal(isValidRecordKey('..'), false);
  assert.equal(isValidRecordKey('has space'), false);
  assert.equal(isValidRecordKey('a'.repeat(513)), false);
});
