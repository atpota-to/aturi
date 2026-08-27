import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent, toMention } from '../jetstream.ts';

const BOT = 'did:plc:bot';
const OTHER = 'did:plc:stranger';

/** A v2 frame, as captured from jetstream.us-east: envelope plus `seq`. */
function v2(record: unknown, did = OTHER, rkey = '3mu3boyhulk2v'): string {
  return JSON.stringify({
    $type: 'message',
    payload: {
      $type: 'network.bsky.jetstream.subscribeEvents#commit',
      cid: 'bafyreif3mbuev2j3cwgpdxkfesjdlrwmr2u4drpkedyvewipffs5hcmcly',
      collection: 'app.bsky.feed.post',
      did,
      operation: 'create',
      record,
      rev: '3mu3boy5z2r2x',
      rkey,
      seq: 25174868752,
      time: '2026-08-27T16:34:46.203833Z',
    },
  });
}

/** A v1 frame, as captured from jetstream2.us-east: flat, keyed on time_us. */
function v1(record: unknown, did = OTHER, rkey = '3mu3bndd3rs2m'): string {
  return JSON.stringify({
    did,
    time_us: 1787848432589267,
    kind: 'commit',
    commit: {
      rev: '3mu3bnfnra22d',
      operation: 'create',
      collection: 'app.bsky.feed.post',
      rkey,
      cid: 'bafyreicz4pmjll3vyrzfv47yd4alracnsj7hbomregb7drrefss6cxoala',
      record,
    },
  });
}

const mentionPost = {
  $type: 'app.bsky.feed.post',
  text: 'hey who links to this?',
  createdAt: '2026-08-27T16:34:46.000Z',
  facets: [
    {
      index: { byteStart: 0, byteEnd: 4 },
      features: [{ $type: 'app.bsky.richtext.facet#mention', did: BOT }],
    },
  ],
};

test('a v2 frame parses, and its cursor is the sequence number', () => {
  const commit = parseEvent(v2(mentionPost));
  assert.ok(commit);
  assert.equal(commit.did, OTHER);
  assert.equal(commit.collection, 'app.bsky.feed.post');
  assert.equal(commit.cursor, '25174868752');
});

test('a v1 frame parses, and its cursor is the microsecond clock', () => {
  const commit = parseEvent(v1(mentionPost));
  assert.ok(commit);
  assert.equal(commit.did, OTHER);
  assert.equal(commit.cursor, '1787848432589267');
});

test('malformed and non-post frames are dropped', () => {
  assert.equal(parseEvent('not json'), null);
  assert.equal(parseEvent('null'), null);
  assert.equal(
    parseEvent(JSON.stringify({ did: OTHER, kind: 'identity' })),
    null,
  );
});

test('deletes are not answerable events', () => {
  const frame = JSON.parse(v2(mentionPost));
  frame.payload.operation = 'delete';
  assert.equal(parseEvent(JSON.stringify(frame)), null);
});

test('a post in another collection is ignored', () => {
  const frame = JSON.parse(v2(mentionPost));
  frame.payload.collection = 'app.bsky.feed.like';
  assert.equal(parseEvent(JSON.stringify(frame)), null);
});

test('a mention facet naming the bot becomes a mention', () => {
  const mention = toMention(parseEvent(v2(mentionPost))!, BOT);
  assert.ok(mention);
  assert.equal(mention.authorDid, OTHER);
  assert.equal(mention.text, 'hey who links to this?');
  assert.equal(mention.uri, `at://${OTHER}/app.bsky.feed.post/3mu3boyhulk2v`);
  // A top-level post is its own thread root.
  assert.equal(mention.root.uri, mention.uri);
});

test('a mention facet naming someone else is not ours', () => {
  const other = structuredClone(mentionPost);
  other.facets[0]!.features[0]!.did = 'did:plc:someone-else';
  assert.equal(toMention(parseEvent(v2(other))!, BOT), null);
});

test('a reply to one of the bot\'s posts counts, with no mention facet', () => {
  const reply = {
    $type: 'app.bsky.feed.post',
    text: 'and what about the other one?',
    createdAt: '2026-08-27T16:34:46.000Z',
    reply: {
      root: { uri: `at://${OTHER}/app.bsky.feed.post/root1`, cid: 'bafyroot' },
      parent: { uri: `at://${BOT}/app.bsky.feed.post/botpost`, cid: 'bafybot' },
    },
  };
  const mention = toMention(parseEvent(v1(reply))!, BOT);
  assert.ok(mention);
  // The reply hangs off the original root, not off the bot's own post.
  assert.equal(mention.root.uri, `at://${OTHER}/app.bsky.feed.post/root1`);
});

test('a reply to somebody else in a thread the bot is in is ignored', () => {
  const reply = {
    $type: 'app.bsky.feed.post',
    text: 'talking to you, not the bot',
    createdAt: '2026-08-27T16:34:46.000Z',
    reply: {
      root: { uri: `at://${OTHER}/app.bsky.feed.post/root1`, cid: 'bafyroot' },
      parent: { uri: `at://did:plc:third/app.bsky.feed.post/p`, cid: 'bafyp' },
    },
  };
  assert.equal(toMention(parseEvent(v1(reply))!, BOT), null);
});

test('the bot never answers itself', () => {
  // Its own replies carry the asker's mention facet forward in the thread.
  const commit = parseEvent(v2(mentionPost, BOT));
  assert.equal(toMention(commit!, BOT), null);
});

test('a mention with no text is not answerable', () => {
  const empty = { ...mentionPost, text: '   ' };
  assert.equal(toMention(parseEvent(v2(empty))!, BOT), null);
});

test('a DID that merely prefixes the bot\'s does not match', () => {
  const reply = {
    $type: 'app.bsky.feed.post',
    text: 'hi',
    createdAt: '2026-08-27T16:34:46.000Z',
    reply: {
      root: { uri: `at://${BOT}extra/app.bsky.feed.post/x`, cid: 'c' },
      parent: { uri: `at://${BOT}extra/app.bsky.feed.post/x`, cid: 'c' },
    },
  };
  assert.equal(toMention(parseEvent(v1(reply))!, BOT), null);
});
