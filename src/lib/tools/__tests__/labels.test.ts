import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLUESKY_MODERATION_DID,
  GLOBAL_LABELS,
  LABELERS_PER_REQUEST,
  MAX_ADDED_LABELERS,
  batchLabelers,
  cleanLabelerDids,
  describeLabel,
  groupLabels,
  isExpired,
  labelEffect,
  labelScope,
  labelersHeader,
  mergeLabels,
  parseLabelersParam,
  parseSubjectInput,
  pickLocale,
  readDefinitions,
  readLabels,
  scanPercent,
  subjectFor,
  targetKey,
  type Label,
  type LabelDefinition,
} from '@/lib/tools/labels';

const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const LABELER = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER = 'did:plc:cccccccccccccccccccccccc';

// --- what was asked about ---------------------------------------------------

test('parseSubjectInput reads handles, DIDs and at:// URIs as accounts', () => {
  assert.deepEqual(parseSubjectInput(' @Alice.Example.com '), {
    ok: true,
    target: { kind: 'account', actor: 'alice.example.com' },
  });
  assert.deepEqual(parseSubjectInput(DID), { ok: true, target: { kind: 'account', actor: DID } });
  assert.deepEqual(parseSubjectInput(`at://${DID}`), { ok: true, target: { kind: 'account', actor: DID } });
  // A profile record is the account, as far as labels go.
  assert.deepEqual(parseSubjectInput(`at://${DID}/app.bsky.actor.profile/self`), {
    ok: true,
    target: { kind: 'account', actor: DID },
  });
});

test('parseSubjectInput reads posts from at:// URIs and client links', () => {
  assert.deepEqual(parseSubjectInput(`at://${DID}/app.bsky.feed.post/3kabc`), {
    ok: true,
    target: { kind: 'post', actor: DID, rkey: '3kabc' },
  });
  assert.deepEqual(parseSubjectInput('https://bsky.app/profile/alice.example.com/post/3kabc'), {
    ok: true,
    target: { kind: 'post', actor: 'alice.example.com', rkey: '3kabc' },
  });
  assert.deepEqual(parseSubjectInput('https://bsky.app/profile/alice.example.com'), {
    ok: true,
    target: { kind: 'account', actor: 'alice.example.com' },
  });
});

test('parseSubjectInput refuses what cannot carry a label an app shows', () => {
  assert.equal(parseSubjectInput('').ok, false);
  assert.equal(parseSubjectInput('not a handle').ok, false);
  assert.equal(parseSubjectInput(`at://${DID}/app.bsky.graph.follow/3kabc`).ok, false);
  assert.equal(parseSubjectInput('https://example.com/some/page').ok, false);
});

test('a target becomes a subject once its account is resolved', () => {
  assert.deepEqual(subjectFor({ kind: 'account', actor: 'alice.example.com' }, DID), { kind: 'account', did: DID });
  assert.deepEqual(subjectFor({ kind: 'post', actor: 'alice.example.com', rkey: '3kabc' }, DID), {
    kind: 'post',
    did: DID,
    uri: `at://${DID}/app.bsky.feed.post/3kabc`,
  });
  assert.notEqual(
    targetKey({ kind: 'account', actor: 'alice.example.com' }),
    targetKey({ kind: 'post', actor: 'alice.example.com', rkey: '3kabc' }),
  );
});

// --- which labelers to ask --------------------------------------------------

test('parseLabelersParam keeps handles and DIDs, once each, up to the cap', () => {
  assert.deepEqual(parseLabelersParam(`labeler.example.com,${LABELER},labeler.example.com,nonsense!,`), [
    'labeler.example.com',
    LABELER,
  ]);
  assert.deepEqual(parseLabelersParam(''), []);
  const many = Array.from({ length: MAX_ADDED_LABELERS + 5 }, (_, i) => `l${i}.example.com`).join(',');
  assert.equal(parseLabelersParam(many).length, MAX_ADDED_LABELERS);
});

test('the header never carries an entry the AppView would choke on', () => {
  // One malformed entry makes the AppView ignore the whole header.
  assert.deepEqual(cleanLabelerDids([LABELER, 'not-a-did', LABELER, OTHER, '']), [LABELER, OTHER]);
  assert.equal(labelersHeader([LABELER, 'alice.example.com', OTHER]), `${LABELER}, ${OTHER}`);
});

test('batchLabelers splits into requests of the stated size', () => {
  const dids = Array.from({ length: 45 }, (_, i) => `did:plc:${String(i).padStart(24, 'a')}`);
  const batches = batchLabelers(dids);
  assert.deepEqual(batches.map((b) => b.length), [LABELERS_PER_REQUEST, LABELERS_PER_REQUEST, 5]);
  assert.deepEqual(batches.flat(), dids);
  assert.deepEqual(batchLabelers([]), []);
});

// --- reading labels ---------------------------------------------------------

test('readLabels keeps what reads as a label and drops the rest', () => {
  const labels = readLabels([
    { src: LABELER, uri: DID, val: 'spam', cts: '2025-01-01T00:00:00.000Z', ver: 1, sig: { $bytes: 'x' } },
    { src: LABELER, uri: DID },
    'nonsense',
    null,
    { src: LABELER, uri: DID, val: 'old', neg: true, exp: '2025-02-01T00:00:00.000Z' },
  ]);
  assert.equal(labels.length, 2);
  assert.deepEqual(labels[0], {
    src: LABELER,
    uri: DID,
    val: 'spam',
    cid: undefined,
    cts: '2025-01-01T00:00:00.000Z',
    exp: undefined,
    neg: undefined,
    ver: 1,
  });
  assert.equal(labels[1].neg, true);
  assert.deepEqual(readLabels(undefined), []);
});

test('mergeLabels keeps one statement per labeler, subject and value: the newest', () => {
  const older: Label = { src: LABELER, uri: DID, val: 'spam', cts: '2025-01-01T00:00:00.000Z' };
  const newer: Label = { ...older, cts: '2025-03-01T00:00:00.000Z', neg: true };
  const other: Label = { src: OTHER, uri: DID, val: 'spam' };
  assert.deepEqual(mergeLabels([older], [other, newer]), [newer, other]);
  assert.deepEqual(mergeLabels([newer], [older]), [newer]);
  assert.deepEqual(mergeLabels([], []), []);
});

test('isExpired and labelScope', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  assert.equal(isExpired({ src: LABELER, uri: DID, val: 'x', exp: '2025-12-31T00:00:00.000Z' }, now), true);
  assert.equal(isExpired({ src: LABELER, uri: DID, val: 'x', exp: '2026-12-31T00:00:00.000Z' }, now), false);
  assert.equal(isExpired({ src: LABELER, uri: DID, val: 'x' }, now), false);
  assert.equal(isExpired({ src: LABELER, uri: DID, val: 'x', exp: 'never' }, now), false);

  assert.equal(labelScope({ src: LABELER, uri: DID, val: 'x' }), 'account');
  assert.equal(labelScope({ src: DID, uri: `at://${DID}/app.bsky.actor.profile/self`, val: 'x' }), 'profile');
  assert.equal(labelScope({ src: LABELER, uri: `at://${DID}/app.bsky.feed.post/3kabc`, val: 'x' }), 'post');
  assert.equal(labelScope({ src: LABELER, uri: `at://${DID}/app.bsky.graph.list/3kabc`, val: 'x' }), 'record');
});

test('groupLabels puts self-labels first, then Bluesky, then the busiest labeler', () => {
  const labels: Label[] = [
    { src: OTHER, uri: DID, val: 'a', cts: '2025-01-01T00:00:00.000Z' },
    { src: LABELER, uri: DID, val: 'b', cts: '2025-01-01T00:00:00.000Z' },
    { src: LABELER, uri: DID, val: 'c', cts: '2025-06-01T00:00:00.000Z' },
    { src: BLUESKY_MODERATION_DID, uri: DID, val: 'spam' },
    { src: DID, uri: `at://${DID}/app.bsky.actor.profile/self`, val: '!no-unauthenticated' },
  ];
  const groups = groupLabels(labels, DID);
  assert.deepEqual(groups.map((g) => g.src), [DID, BLUESKY_MODERATION_DID, LABELER, OTHER]);
  assert.deepEqual(groups.map((g) => g.self), [true, false, false, false]);
  // Newest first inside a group.
  assert.deepEqual(groups[2].labels.map((l) => l.val), ['c', 'b']);
});

// --- what a label means -----------------------------------------------------

const definitions: LabelDefinition[] = readDefinitions([
  {
    identifier: 'spam',
    severity: 'inform',
    blurs: 'content',
    defaultSetting: 'hide',
    adultOnly: false,
    locales: [
      { lang: 'en', name: 'Spam', description: 'Unwanted, repeated actions.' },
      { lang: 'pt-BR', name: 'Spam (pt)', description: 'Em português.' },
    ],
  },
  { identifier: 'porn', severity: 'alert', blurs: 'media', locales: [{ lang: 'en', name: 'Their porn', description: 'Their wording.' }] },
  { identifier: '!hide', severity: 'none', blurs: 'none', locales: [{ lang: 'en', name: 'Hijacked', description: 'Not allowed.' }] },
  { severity: 'alert' },
  'nonsense',
]);

test('readDefinitions keeps the definitions that name a value', () => {
  assert.deepEqual(definitions.map((d) => d.identifier), ['spam', 'porn', '!hide']);
  assert.deepEqual(readDefinitions(undefined), []);
});

test('pickLocale prefers the reader, then English, then whatever is there', () => {
  const { locales } = definitions[0];
  assert.equal(pickLocale(locales, ['pt-BR'])?.name, 'Spam (pt)');
  // A language matches across regions.
  assert.equal(pickLocale(locales, ['pt-PT'])?.name, 'Spam (pt)');
  assert.equal(pickLocale(locales, ['ja', 'en-GB'])?.name, 'Spam');
  assert.equal(pickLocale(locales, ['ja'])?.name, 'Spam');
  assert.equal(pickLocale([{ lang: 'ja', name: 'スパム', description: '' }], ['fr'])?.name, 'スパム');
  assert.equal(pickLocale([], ['en']), null);
});

test('describeLabel uses the labeler’s wording, the protocol’s, or the bare value', () => {
  const own = describeLabel('spam', definitions, ['en']);
  assert.equal(own.name, 'Spam');
  assert.equal(own.source, 'labeler');
  assert.equal(own.blurs, 'content');
  assert.equal(own.defaultSetting, 'hide');

  // A labeler may redefine a global value for itself…
  assert.equal(describeLabel('porn', definitions, ['en']).name, 'Their porn');
  // …but not one that starts with `!`.
  const reserved = describeLabel('!hide', definitions, ['en']);
  assert.equal(reserved.source, 'protocol');
  assert.equal(reserved.name, GLOBAL_LABELS['!hide'].name);

  assert.equal(describeLabel('porn', [], ['en']).source, 'protocol');
  const unknown = describeLabel('made-up', definitions, ['en']);
  assert.deepEqual([unknown.name, unknown.description, unknown.source], ['made-up', null, 'none']);
});

test('the global values are the eight the lexicon and the labels guide list', () => {
  assert.deepEqual(Object.keys(GLOBAL_LABELS).sort(), [
    '!hide',
    '!no-unauthenticated',
    '!warn',
    'bot',
    'graphic-media',
    'nudity',
    'porn',
    'sexual',
  ]);
});

test('labelEffect covers the nine behaviours', () => {
  assert.equal(labelEffect('content', 'alert'), 'Hides the content behind a warning');
  assert.equal(labelEffect('content', 'inform'), 'Hides the content behind a notice');
  assert.equal(labelEffect('content', 'none'), 'Hides the content');
  assert.equal(labelEffect('media', 'alert'), 'Hides images behind a warning');
  assert.equal(labelEffect('media', 'inform'), 'Hides images behind a notice');
  assert.equal(labelEffect('media', 'none'), 'Hides images');
  assert.equal(labelEffect('none', 'alert'), 'Shows a warning badge');
  assert.equal(labelEffect('none', 'inform'), 'Shows an informational badge');
  assert.equal(labelEffect('none', 'none'), 'No visual effect');
  assert.equal(labelEffect(null, null), null);
});

test('scanPercent counts failed batches as done, and never passes 100', () => {
  assert.equal(scanPercent({ total: 0, checked: 0, failed: 0 }), 0);
  assert.equal(scanPercent({ total: 600, checked: 140, failed: 10 }), 25);
  assert.equal(scanPercent({ total: 600, checked: 600, failed: 0 }), 100);
  assert.equal(scanPercent({ total: 10, checked: 10, failed: 5 }), 100);
});
