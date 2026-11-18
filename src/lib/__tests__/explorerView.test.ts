import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExplorerPath, parsePeek, peekValue } from '@/lib/explorerView';

test('reads the three account routes', () => {
  assert.deepEqual(parseExplorerPath('/explore/alice.example'), {
    repo: 'alice.example',
    collection: null,
    rkey: null,
  });
  assert.deepEqual(parseExplorerPath('/explore/alice.example/app.bsky.feed.post'), {
    repo: 'alice.example',
    collection: 'app.bsky.feed.post',
    rkey: null,
  });
  assert.deepEqual(parseExplorerPath('/explore/alice.example/app.bsky.feed.post/3kabc'), {
    repo: 'alice.example',
    collection: 'app.bsky.feed.post',
    rkey: '3kabc',
  });
});

test('keeps a DID repo as the address spells it, and decodes an escaped record key', () => {
  assert.deepEqual(parseExplorerPath('/explore/did:plc:abc123/com.example.thing/a%20b'), {
    repo: 'did:plc:abc123',
    collection: 'com.example.thing',
    rkey: 'a b',
  });
  // A malformed escape is left as it is rather than thrown on.
  assert.equal(parseExplorerPath('/explore/alice.example/com.example.thing/%E0%A4%A')?.rkey, '%E0%A4%A');
});

test('is null for the rest of /explore and for anything outside it', () => {
  for (const path of [
    '/explore',
    '/explore/',
    '/explore/lexicons',
    '/explore/lexicons/app.bsky.feed.post',
    '/explore/pds/pds.example',
    '/explore/spaces',
    '/tools/stream',
    '/profile/alice.example',
    'explore/alice.example',
  ]) {
    assert.equal(parseExplorerPath(path), null, path);
  }
  assert.equal(parseExplorerPath(null), null);
  assert.equal(parseExplorerPath(undefined), null);
});

test('is null for a permissioned space, which has pages of its own', () => {
  assert.equal(parseExplorerPath('/explore/alice.example/space'), null);
  assert.equal(parseExplorerPath('/explore/alice.example/space/com.example.type'), null);
  assert.equal(
    parseExplorerPath('/explore/alice.example/space/com.example.type/key/did:plc:abc/app.bsky.feed.post'),
    null,
  );
});

test('a peek names a record in any repository', () => {
  assert.deepEqual(parsePeek('did:plc:abc/app.bsky.feed.like/3kabc'), {
    did: 'did:plc:abc',
    collection: 'app.bsky.feed.like',
    rkey: '3kabc',
  });
  assert.equal(peekValue('at://did:plc:abc/app.bsky.feed.like/3kabc'), 'did:plc:abc/app.bsky.feed.like/3kabc');
});

test('a peek is null unless it is a DID, a collection and a record key', () => {
  for (const value of [
    '',
    'did:plc:abc',
    'did:plc:abc/app.bsky.feed.like',
    'alice.example/app.bsky.feed.like/3kabc',
    'did:plc:abc/like/3kabc',
    'did:plc:abc/app.bsky.feed.like/3kabc/extra',
    'did:plc:abc/app.bsky.feed.like/',
  ]) {
    assert.equal(parsePeek(value), null, value);
  }
  assert.equal(parsePeek(null), null);
  assert.equal(peekValue('at://did:plc:abc/app.bsky.feed.like'), null);
});
