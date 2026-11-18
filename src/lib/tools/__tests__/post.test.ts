import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPostFindings,
  byteIndex,
  decodeBytes,
  describeEmbed,
  describePostgate,
  describeThreadgate,
  formatSpan,
  gateUri,
  looseTokens,
  measureText,
  parsePostInput,
  postVerdict,
  readFacets,
  readTimes,
  segmentText,
  sliceBytes,
  threadRoot,
  utf8Length,
  type PostEvidence,
} from '@/lib/tools/post';

const DID = 'did:plc:z72i7hdynmk6r22z27h6tvur';
const RKEY = '3mzebbdw64s27';
const URI = `at://${DID}/app.bsky.feed.post/${RKEY}`;

const encoder = new TextEncoder();
/** Byte offsets of `needle` in `text`, the way a correct client computes them. */
function bytesOf(text: string, needle: string): { byteStart: number; byteEnd: number } {
  const at = text.indexOf(needle);
  assert.ok(at >= 0, `"${needle}" is in the text`);
  const byteStart = encoder.encode(text.slice(0, at)).length;
  return { byteStart, byteEnd: byteStart + encoder.encode(needle).length };
}
/** The same, counted in UTF-16 code units: the classic bug. */
function utf16Of(text: string, needle: string): { byteStart: number; byteEnd: number } {
  const at = text.indexOf(needle);
  return { byteStart: at, byteEnd: at + needle.length };
}
const mention = (index: object) => ({ index, features: [{ $type: 'app.bsky.richtext.facet#mention', did: DID }] });
const link = (index: object, uri = 'https://example.com/a') => ({
  index,
  features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
});
const tag = (index: object, value = 'atproto') => ({
  index,
  features: [{ $type: 'app.bsky.richtext.facet#tag', tag: value }],
});

// --- input -------------------------------------------------------------------

test('parsePostInput reads links and at:// URIs', () => {
  assert.deepEqual(parsePostInput(`https://bsky.app/profile/atproto.com/post/${RKEY}`), {
    ok: true,
    authority: 'atproto.com',
    rkey: RKEY,
  });
  assert.deepEqual(parsePostInput(`bsky.app/profile/${DID}/post/${RKEY}`), { ok: true, authority: DID, rkey: RKEY });
  assert.deepEqual(parsePostInput(` ${URI} `), { ok: true, authority: DID, rkey: RKEY });
  assert.deepEqual(parsePostInput(`at://Atproto.com/app.bsky.feed.post/${RKEY}`), {
    ok: true,
    authority: 'atproto.com',
    rkey: RKEY,
  });
  // A Bluesky-shaped path on a host with no entry of its own.
  assert.deepEqual(parsePostInput(`https://client.example/profile/atproto.com/post/${RKEY}`), {
    ok: true,
    authority: 'atproto.com',
    rkey: RKEY,
  });
});

test('parsePostInput says why something is not a post', () => {
  const reason = (raw: string) => {
    const parsed = parsePostInput(raw);
    return parsed.ok ? '' : parsed.reason;
  };
  assert.match(reason(''), /Enter a post/);
  assert.match(reason(`at://${DID}/app.bsky.feed.like/${RKEY}`), /app\.bsky\.feed\.like/);
  assert.match(reason(`at://${DID}`), /three parts/);
  assert.match(reason('https://bsky.app/profile/bsky.app/feed/whats-hot'), /feed inspector/);
  assert.match(reason('https://example.com/'), /does not point at a post/);
});

// --- counting ----------------------------------------------------------------

test('measureText counts bytes, UTF-16 units and graphemes apart', () => {
  assert.deepEqual(measureText('hello'), { bytes: 5, utf16: 5, graphemes: 5 });
  // é is two bytes, one unit.
  assert.deepEqual(measureText('café'), { bytes: 5, utf16: 4, graphemes: 4 });
  // 👍 is four bytes and a surrogate pair.
  assert.deepEqual(measureText('👍'), { bytes: 4, utf16: 2, graphemes: 1 });
  // A family emoji: four people joined by three zero-width joiners.
  assert.deepEqual(measureText('👨‍👩‍👧‍👦'), { bytes: 25, utf16: 11, graphemes: 1 });
  // CJK is three bytes a character.
  assert.deepEqual(measureText('日本語'), { bytes: 9, utf16: 3, graphemes: 3 });
  assert.equal(utf8Length(''), 0);
});

test('byteIndex maps character starts and marks the insides of characters', () => {
  // a(1) é(2) 👍(4) b(1) = 8 bytes; UTF-16: a0 é1 👍2-3 b4.
  const map = byteIndex('aé👍b');
  assert.deepEqual(Array.from(map), [0, 1, -1, 2, -1, -1, -1, 4, 5]);
  assert.deepEqual(Array.from(byteIndex('')), [0]);
});

test('sliceBytes cuts on character boundaries only', () => {
  const text = 'aé👍b';
  assert.equal(sliceBytes(text, 0, 1), 'a');
  assert.equal(sliceBytes(text, 1, 3), 'é');
  assert.equal(sliceBytes(text, 3, 7), '👍');
  assert.equal(sliceBytes(text, 0, 8), text);
  assert.equal(sliceBytes(text, 3, 3), '', 'an empty range cuts nothing');
  // Inside é, inside the emoji, past the end, reversed.
  assert.equal(sliceBytes(text, 2, 3), null);
  assert.equal(sliceBytes(text, 3, 5), null);
  assert.equal(sliceBytes(text, 0, 9), null);
  assert.equal(sliceBytes(text, 3, 1), null);
  assert.equal(sliceBytes(text, -1, 2), null);
});

test('decodeBytes shows a split character as a replacement mark', () => {
  assert.equal(decodeBytes('aé👍b', 0, 2), 'a�');
  assert.equal(decodeBytes('abc', 1, 99), 'bc');
});

// --- facets ------------------------------------------------------------------

test('correct facets over plain and multi-byte text are read without problems', () => {
  const text = '🎉 Thanks @alice.example.com — read https://example.com/a #atproto';
  const readings = readFacets(text, [
    mention(bytesOf(text, '@alice.example.com')),
    link(bytesOf(text, 'https://example.com/a')),
    tag(bytesOf(text, '#atproto')),
  ]);
  assert.deepEqual(
    readings.map((r) => r.covered),
    ['@alice.example.com', 'https://example.com/a', '#atproto'],
  );
  assert.ok(readings.every((r) => r.problems.length === 0));
  assert.deepEqual(readings[0].features, [{ kind: 'mention', did: DID }]);
  // The UTF-16 range is where to cut the JavaScript string.
  const [from, to] = readings[1].utf16 as [number, number];
  assert.equal(text.slice(from, to), 'https://example.com/a');
});

test('offsets counted in UTF-16 units after an emoji are caught and named', () => {
  const text = '🎉🎉 hello @alice.example.com';
  const [reading] = readFacets(text, [mention(utf16Of(text, '@alice.example.com'))]);
  const units = reading.problems.find((p) => p.code === 'units');
  assert.ok(units, 'the unit mix-up is reported');
  assert.equal(units.level, 'error');
  assert.match(units.message, /UTF-16 code units/);
  assert.match(units.message, /@alice\.example\.com/);
});

test('UTF-16 offsets that split a character are a boundary error and a unit error', () => {
  // é is two bytes, so UTF-16 offsets after two of them land two bytes
  // early: this one starts inside the second é.
  const text = 'éé https://example.com/a';
  const [reading] = readFacets(text, [link(utf16Of(text, 'https://example.com/a'))]);
  assert.equal(reading.covered, null);
  assert.equal(reading.utf16, null);
  assert.deepEqual(reading.problems.map((p) => p.code), ['boundary', 'units']);
  // After one é the range is shifted a single byte, which still starts and
  // ends on characters...
  const one = 'é https://example.com/a';
  const [shifted] = readFacets(one, [link(utf16Of(one, 'https://example.com/a'))]);
  assert.equal(shifted.covered, ' https://example.com/', 'a valid range over the wrong text');
  assert.ok(shifted.problems.some((p) => p.code === 'units'), '...and is still caught, because it covers the wrong thing');

  const cjk = '日本語 @alice.example.com';
  const [bad] = readFacets(cjk, [mention(utf16Of(cjk, '@alice.example.com'))]);
  assert.ok(bad.problems.some((p) => p.code === 'boundary'));
  assert.ok(bad.problems.some((p) => p.code === 'units'));
});

test('offsets counted in graphemes are named as such', () => {
  // The family emoji is 11 UTF-16 units and 1 grapheme, so the two wrong
  // units give different answers and only graphemes lines up.
  const text = '👨‍👩‍👧‍👦 #atproto';
  const clusters = Array.from(new Intl.Segmenter().segment(text), (s) => s.segment);
  const start = clusters.indexOf('#');
  const [reading] = readFacets(text, [tag({ byteStart: start, byteEnd: start + '#atproto'.length })]);
  const units = reading.problems.find((p) => p.code === 'units');
  assert.ok(units);
  assert.match(units.message, /graphemes/);
});

test('plain ASCII text never raises a unit error', () => {
  const text = 'hello @alice.example.com';
  // Wrong, but not because of the unit: every unit agrees on ASCII.
  const [reading] = readFacets(text, [mention({ byteStart: 0, byteEnd: 5 })]);
  assert.equal(reading.covered, 'hello');
  assert.ok(!reading.problems.some((p) => p.code === 'units'));
});

test('a link over arbitrary words is not second-guessed', () => {
  const text = '🎉 read the announcement here';
  const [reading] = readFacets(text, [link(bytesOf(text, 'announcement'))]);
  assert.equal(reading.covered, 'announcement');
  assert.deepEqual(reading.problems, []);
});

test('ranges that are empty, reversed, out of the text or malformed are errors', () => {
  const text = 'hello world';
  const codes = (facet: unknown) => readFacets(text, [facet])[0].problems.map((p) => p.code);
  assert.deepEqual(codes(link({ byteStart: 3, byteEnd: 3 })), ['empty']);
  assert.deepEqual(codes(link({ byteStart: 5, byteEnd: 2 })), ['empty']);
  assert.deepEqual(codes(link({ byteStart: 6, byteEnd: 40 })), ['range']);
  assert.deepEqual(codes(link({ byteStart: 0, byteEnd: 11 })), [], 'the end of the text is a valid end');
  assert.deepEqual(codes(link({ byteStart: '0', byteEnd: 5 })), ['shape']);
  assert.deepEqual(codes(link({ byteStart: -1, byteEnd: 5 })), ['shape']);
  assert.deepEqual(codes(link({ byteStart: 0.5, byteEnd: 5 })), ['shape']);
  assert.deepEqual(codes({ features: [] }), ['shape']);
  assert.deepEqual(codes(null), ['shape']);
  assert.deepEqual(readFacets(text, undefined), []);
  assert.deepEqual(readFacets(text, 'nope'), []);
});

test('overlapping facets are flagged on the later one', () => {
  const text = 'see example.com/a now';
  const readings = readFacets(text, [
    link({ byteStart: 4, byteEnd: 17 }),
    link({ byteStart: 10, byteEnd: 21 }),
    link({ byteStart: 18, byteEnd: 21 }),
  ]);
  assert.deepEqual(readings[0].problems, []);
  assert.deepEqual(readings[1].problems.map((p) => p.code), ['overlap']);
  assert.match(readings[1].problems[0].message, /facet 1/);
  // The third starts after the first ends, and the second was never drawn.
  assert.deepEqual(readings[2].problems, []);
});

test('features are checked for what they must carry', () => {
  const text = 'a @b.example c d';
  const at = bytesOf(text, '@b.example');
  const messages = (facet: unknown) => readFacets(text, [facet])[0].problems.map((p) => p.message).join(' ');
  assert.match(messages({ index: at, features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'b.example' }] }), /by DID/);
  assert.match(messages(link(at, 'example.com/a')), /complete URL/);
  assert.match(messages(tag(at, '')), /empty/);
  assert.match(messages(tag(at, 'x'.repeat(65))), /longer than 64/);
  assert.match(messages({ index: at, features: [] }), /no features/);
  // A feature type this tool does not know is kept, not judged.
  const [unknown] = readFacets(text, [{ index: at, features: [{ $type: 'com.example.facet#spoiler' }] }]);
  assert.deepEqual(unknown.features, [{ kind: 'unknown', type: 'com.example.facet#spoiler' }]);
  assert.deepEqual(unknown.problems, []);
});

test('segmentText cuts the text around the facets that can be drawn', () => {
  const text = '👍 hi @alice.example.com and #atproto!';
  const readings = readFacets(text, [
    tag(bytesOf(text, '#atproto')),
    mention(bytesOf(text, '@alice.example.com')),
    // Broken: runs past the end. Left out of the markup.
    link({ byteStart: 5, byteEnd: 999 }),
  ]);
  const segments = segmentText(text, readings);
  assert.deepEqual(segments, [
    { text: '👍 hi ', facet: null },
    { text: '@alice.example.com', facet: 1 },
    { text: ' and ', facet: null },
    { text: '#atproto', facet: 0 },
    { text: '!', facet: null },
  ]);
  assert.equal(segments.map((s) => s.text).join(''), text, 'nothing is lost or repeated');
  assert.deepEqual(segmentText('', []), [{ text: '', facet: null }]);
  assert.deepEqual(segmentText('plain', []), [{ text: 'plain', facet: null }]);
});

test('looseTokens finds links, mentions and tags with no facet over them', () => {
  const text = 'Read https://example.com/a, thanks @alice.example.com! #atproto #1 @ me';
  assert.deepEqual(looseTokens(text, []), [
    { kind: 'link', text: 'https://example.com/a' },
    { kind: 'mention', text: '@alice.example.com' },
    { kind: 'tag', text: '#atproto' },
  ]);
  const covered = readFacets(text, [
    link(bytesOf(text, 'https://example.com/a')),
    mention(bytesOf(text, '@alice.example.com')),
    tag(bytesOf(text, '#atproto')),
  ]);
  assert.deepEqual(looseTokens(text, covered), []);
  assert.deepEqual(looseTokens('nothing to see', []), []);
});

// --- timestamps --------------------------------------------------------------

test('readTimes compares createdAt with the record key and the index time', () => {
  // 3mzebbdw64s27 was written at 2026-11-02T21:27:04Z.
  const agree = readTimes({ createdAt: '2026-11-02T21:27:03.719Z', rkey: RKEY, indexedAt: '2026-11-02T21:27:05.906Z' });
  assert.deepEqual(agree.notes, []);
  assert.equal(agree.keyTime?.toISOString().slice(0, 16), '2026-11-02T21:27');

  const backdated = readTimes({ createdAt: '2019-01-01T00:00:00.000Z', rkey: RKEY });
  assert.equal(backdated.notes.length, 1);
  assert.equal(backdated.notes[0].level, 'warn');
  assert.match(backdated.notes[0].message, /8 years earlier.*backdated/);

  const ahead = readTimes({ createdAt: '2026-11-03T21:27:04.000Z', rkey: RKEY });
  assert.match(ahead.notes[0].message, /1 day later/);

  const late = readTimes({ createdAt: '2026-11-02T21:27:03.719Z', rkey: RKEY, indexedAt: '2026-11-05T21:27:04.000Z' });
  assert.deepEqual(late.notes.map((n) => n.level), ['info']);
  assert.match(late.notes[0].message, /3 days after/);

  assert.match(readTimes({ createdAt: 'yesterday', rkey: RKEY }).notes[0].message, /not a date/);
  assert.match(readTimes({ createdAt: undefined, rkey: RKEY }).notes[0].message, /no createdAt/);
  assert.match(readTimes({ createdAt: '2026-11-02T21:27:03.719Z', rkey: 'self' }).notes[0].message, /not a TID/);
});

test('formatSpan picks the largest unit that fits', () => {
  assert.equal(formatSpan(1500), '2 seconds');
  assert.equal(formatSpan(-90_000), '2 minutes');
  assert.equal(formatSpan(3_600_000), '1 hour');
  assert.equal(formatSpan(3 * 86_400_000), '3 days');
  assert.equal(formatSpan(400 * 86_400_000), '1 year');
});

// --- gates and embeds --------------------------------------------------------

test('describeThreadgate puts the rules in words', () => {
  const rule = (name: string, extra = {}) => ({ $type: `app.bsky.feed.threadgate#${name}`, ...extra });
  assert.match(describeThreadgate({}).summary, /Anyone can reply/);
  assert.match(describeThreadgate({ allow: [] }).summary, /Nobody can reply/);
  const gate = describeThreadgate({
    allow: [rule('mentionRule'), rule('followingRule'), rule('followerRule')],
    hiddenReplies: ['at://a/b/c', 'at://d/e/f'],
  });
  assert.equal(
    gate.summary,
    'Replies are limited to accounts mentioned in the post, accounts the author follows and accounts that follow the author. The author has hidden 2 replies.',
  );
  const listed = describeThreadgate({ allow: [rule('listRule', { list: 'at://did:plc:x/app.bsky.graph.list/1' })] });
  assert.match(listed.summary, /accounts on a list/);
  assert.deepEqual(listed.detail, ['list at://did:plc:x/app.bsky.graph.list/1']);
});

test('describePostgate says whether quoting is off', () => {
  assert.match(describePostgate({}).summary, /Anyone can quote/);
  const gate = describePostgate({
    embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
    detachedEmbeddingUris: ['at://did:plc:x/app.bsky.feed.post/1'],
  });
  assert.match(gate.summary, /turned off.*detached it from 1 quote/);
  assert.deepEqual(gate.detail, ['detached from at://did:plc:x/app.bsky.feed.post/1']);
});

test('describeEmbed names what a post carries', () => {
  assert.equal(describeEmbed(undefined), null);
  assert.equal(
    describeEmbed({ $type: 'app.bsky.embed.images', images: [{ alt: 'A cat' }, { alt: '' }, {}] })?.summary,
    '3 images, 1 of them with alt text.',
  );
  assert.equal(describeEmbed({ $type: 'app.bsky.embed.images', images: [{ alt: 'A cat' }] })?.summary, '1 image, with alt text.');
  assert.equal(describeEmbed({ $type: 'app.bsky.embed.video' })?.summary, 'A video, without alt text.');
  const card = describeEmbed({ $type: 'app.bsky.embed.external', external: { uri: 'https://example.com', title: 'Example' } });
  assert.equal(card?.summary, 'A link card titled “Example”.');
  assert.deepEqual(card?.detail, ['https://example.com']);
  const quote = describeEmbed({ $type: 'app.bsky.embed.record', record: { uri: `at://${DID}/app.bsky.graph.list/1` } });
  assert.equal(quote?.summary, 'Quotes a list.');
  const both = describeEmbed({
    $type: 'app.bsky.embed.recordWithMedia',
    record: { $type: 'app.bsky.embed.record', record: { uri: URI } },
    media: { $type: 'app.bsky.embed.images', images: [{ alt: 'x' }] },
  });
  assert.match(both?.summary ?? '', /^Quotes a post, with media: 1 image/);
  assert.deepEqual(both?.detail, [URI]);
  assert.match(describeEmbed({ $type: 'app.bsky.embed.gallery' })?.summary ?? '', /does not read \(app\.bsky\.embed\.gallery\)/);
});

test('gate records sit at the post’s own key, and reply rules on the thread’s first post', () => {
  assert.equal(gateUri(URI, 'app.bsky.feed.postgate'), `at://${DID}/app.bsky.feed.postgate/${RKEY}`);
  assert.equal(threadRoot({ uri: URI, record: {} }), URI);
  const root = 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3aaaaaaaaaa2a';
  assert.equal(threadRoot({ uri: URI, record: { reply: { root: { uri: root }, parent: { uri: root } } } }), root);
});

// --- findings ----------------------------------------------------------------

function evidence(record: Record<string, unknown>, extra: Partial<PostEvidence> = {}): PostEvidence {
  return {
    uri: URI,
    rkey: RKEY,
    record: { $type: 'app.bsky.feed.post', createdAt: '2026-11-02T21:27:03.719Z', ...record },
    view: { indexedAt: '2026-11-02T21:27:05.906Z', labels: [] },
    threadgate: { status: 'none' },
    postgate: { status: 'none' },
    ...extra,
  };
}
const status = (e: PostEvidence, id: string) => buildPostFindings(e).find((f) => f.id === id)?.status;

test('a clean post passes', () => {
  const text = '🎉 hello @alice.example.com';
  const clean = evidence({ text, facets: [mention(bytesOf(text, '@alice.example.com'))], langs: ['en'] });
  const findings = buildPostFindings(clean);
  assert.deepEqual(
    findings.map((f) => [f.id, f.status]),
    [
      ['length', 'pass'],
      ['facets', 'pass'],
      ['times', 'pass'],
      ['reply', 'info'],
      ['threadgate', 'info'],
      ['postgate', 'info'],
      ['embed', 'info'],
      ['langs', 'info'],
      ['labels', 'info'],
    ],
  );
  assert.equal(postVerdict(findings).tone, 'pass');
});

test('a facet counted in the wrong unit fails the post', () => {
  const text = '🎉 hello @alice.example.com';
  const broken = evidence({ text, facets: [mention(utf16Of(text, '@alice.example.com'))] });
  assert.equal(status(broken, 'facets'), 'fail');
  const verdict = postVerdict(buildPostFindings(broken));
  assert.equal(verdict.tone, 'fail');
  assert.match(verdict.text, /1 of 1 facet does not fit/);
});

test('a link in the text with no facet is a warning', () => {
  const loose = evidence({ text: 'read https://example.com/a' });
  const finding = buildPostFindings(loose).find((f) => f.id === 'facets');
  assert.equal(finding?.status, 'warn');
  assert.match(finding?.summary ?? '', /reads as a link but has no facet/);
  assert.equal(status(evidence({ text: 'nothing to mark' }), 'facets'), 'info');
});

test('text over the limits fails, and empty text needs an embed', () => {
  assert.equal(status(evidence({ text: 'a'.repeat(301) }), 'length'), 'fail');
  // 300 graphemes, but 1200 bytes: inside both limits.
  assert.equal(status(evidence({ text: '👍'.repeat(300) }), 'length'), 'pass');
  // 251 family emoji: 251 graphemes, 6275 bytes.
  assert.equal(status(evidence({ text: '👨‍👩‍👧‍👦'.repeat(251) }), 'length'), 'fail');
  assert.equal(status(evidence({ text: '' }), 'length'), 'warn');
  assert.equal(status(evidence({ text: '', embed: { $type: 'app.bsky.embed.video' } }), 'length'), 'pass');
  assert.equal(status(evidence({}), 'length'), 'fail');
});

test('gates, replies and labels are reported in words', () => {
  const root = 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3aaaaaaaaaa2a';
  const reply = evidence(
    {
      text: 'hi',
      reply: { root: { uri: root }, parent: { uri: root } },
      labels: { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'porn' }] },
    },
    {
      threadgate: { status: 'found', uri: 'at://x/app.bsky.feed.threadgate/1', value: { allow: [] } },
      postgate: { status: 'error' },
      view: { labels: [{ val: 'porn', src: DID }, { val: 'spam', src: 'did:plc:labeler' }, { val: 'old', src: 'did:plc:labeler', neg: true }] },
    },
  );
  const by = (id: string) => buildPostFindings(reply).find((f) => f.id === id);
  assert.match(by('reply')?.summary ?? '', /first post of its thread/);
  assert.match(by('threadgate')?.summary ?? '', /^Set on the thread’s first post: Nobody can reply/);
  assert.match(by('postgate')?.summary ?? '', /could not be looked up/);
  // The self-label is not repeated, and a negated label is not shown.
  assert.match(by('labels')?.summary ?? '', /labelled it porn\. .*1 label from labelers: spam\./);
  assert.equal(status(evidence({ text: 'hi', reply: { root: { uri: root } } }), 'reply'), 'fail');
});

test('findings still on their way hold the verdict back', () => {
  const waiting = evidence({ text: 'hi' }, { view: undefined, threadgate: undefined, postgate: undefined });
  const findings = buildPostFindings(waiting);
  assert.equal(status(waiting, 'labels'), 'pending');
  assert.equal(status(waiting, 'threadgate'), 'pending');
  assert.equal(postVerdict(findings).tone, 'pending');
  // A failure is said at once, whatever else is pending.
  const failing = evidence({ text: 'a'.repeat(400) }, { view: undefined });
  assert.equal(postVerdict(buildPostFindings(failing)).tone, 'fail');
});

test('a backdated post is a warning', () => {
  const old = evidence({ text: 'hi', createdAt: '2020-05-01T00:00:00.000Z' });
  assert.equal(status(old, 'times'), 'warn');
  assert.equal(postVerdict(buildPostFindings(old)).tone, 'warn');
  assert.equal(status(evidence({ text: 'hi', createdAt: 'soon' }), 'times'), 'fail');
});
