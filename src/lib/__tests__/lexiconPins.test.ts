import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLexiconPins, toggleLexiconPin } from '@/lib/lexiconPins';

test('reads a stored list and nothing else', () => {
  assert.deepEqual(parseLexiconPins('["app.bsky.feed.post","sh.tangled.*"]'), ['app.bsky.feed.post', 'sh.tangled.*']);
  assert.deepEqual(parseLexiconPins(null), []);
  assert.deepEqual(parseLexiconPins('not json'), []);
  assert.deepEqual(parseLexiconPins('{"app.bsky.feed.post":true}'), []);
});

test('drops what is not a pin and keeps each once, in order', () => {
  assert.deepEqual(parseLexiconPins('["a.b.c", 7, "", "  ", null, "a.b.c", "x.y.z"]'), ['a.b.c', 'x.y.z']);
});

test('caps a list that has grown past any hand-made one', () => {
  const many = JSON.stringify(Array.from({ length: 250 }, (_, i) => `a.b.n${i}`));
  assert.equal(parseLexiconPins(many).length, 200);
});

test('toggling adds at the end and takes out what was there', () => {
  const once = toggleLexiconPin(['a.b.c'], 'x.y.*');
  assert.deepEqual(once, ['a.b.c', 'x.y.*']);
  assert.deepEqual(toggleLexiconPin(once, 'a.b.c'), ['x.y.*']);
});
