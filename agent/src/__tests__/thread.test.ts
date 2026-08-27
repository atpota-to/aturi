import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphemeLength, splitIntoPosts } from '../thread.ts';

const LIMIT = 300;

test('a short answer stays one unnumbered post', () => {
  const posts = splitIntoPosts('Backlinks come from Constellation.', 3);
  assert.equal(posts.length, 1);
  assert.equal(posts[0], 'Backlinks come from Constellation.');
});

test('empty and whitespace-only answers produce no posts', () => {
  assert.deepEqual(splitIntoPosts('', 3), []);
  assert.deepEqual(splitIntoPosts('   \n  ', 3), []);
});

test('every post in a split answer fits the grapheme limit', () => {
  const long = 'The Atmosphere is the network atproto describes. '.repeat(20);
  for (const post of splitIntoPosts(long, 3)) {
    assert.ok(
      graphemeLength(post) <= LIMIT,
      `post was ${graphemeLength(post)} graphemes`,
    );
  }
});

test('a split answer is numbered and the numbering counts the real total', () => {
  const long = 'Identity resolution walks the handle to a DID. '.repeat(20);
  const posts = splitIntoPosts(long, 3);
  assert.ok(posts.length > 1);
  posts.forEach((post, index) => {
    assert.match(post, new RegExp(`\\s${index + 1}/${posts.length}$`));
  });
});

test('an answer longer than the post budget is cut with an ellipsis', () => {
  const long = 'lexicon '.repeat(500);
  const posts = splitIntoPosts(long, 2);
  assert.equal(posts.length, 2);
  assert.match(posts[1]!, /…\s2\/2$/);
});

test('maxPosts of one truncates rather than splitting', () => {
  const long = 'record '.repeat(200);
  const posts = splitIntoPosts(long, 1);
  assert.equal(posts.length, 1);
  assert.ok(graphemeLength(posts[0]!) <= LIMIT);
});

test('grapheme clusters are never split down the middle', () => {
  // Each family emoji is one grapheme but several code points; a naive
  // slice on String.length would leave a broken surrogate pair behind.
  const emoji = '👨‍👩‍👧‍👦';
  const posts = splitIntoPosts(emoji.repeat(400), 2);
  for (const post of posts) {
    assert.ok(graphemeLength(post) <= LIMIT);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(post));
  }
});

test('splitting prefers a whitespace boundary over a mid-word cut', () => {
  const long = 'constellation '.repeat(60);
  const posts = splitIntoPosts(long, 3);
  assert.ok(posts.length > 1);
  // Strip the " n/m" suffix before checking where the text itself ended.
  const body = posts[0]!.replace(/\s\d+\/\d+$/, '');
  assert.ok(body.endsWith('constellation'), `ended with: ${body.slice(-20)}`);
});
