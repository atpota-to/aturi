import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAtTagsFromHtml, primaryRecordFromAtTags } from '@/utils/atproto/atTags';

/**
 * These scanners run over a page fetched from a caller-supplied URL, so their
 * cost is something an anonymous request chooses. Both tag patterns were once
 * quadratic; one was fixed and the other missed, because no test had ever fed
 * the scanner a tag it never closes.
 */

const ONE_MEGABYTE = 1024 * 1024;

test('an unclosed-tag page is scanned in linear time', () => {
  // 230 seconds before the bound, blocking the whole runtime.
  const hostile = '<meta '.repeat(Math.floor(ONE_MEGABYTE / 6));
  const started = Date.now();
  const result = parseAtTagsFromHtml(hostile);
  const elapsed = Date.now() - started;
  assert.deepEqual(result.canonical, []);
  assert.ok(elapsed < 5000, `scan took ${elapsed}ms; the tag body bound is gone`);
});

test('unclosed tags that also open an attribute stay linear', () => {
  const hostile = '<meta name="at:canonical" content="at://x '.repeat(25_000);
  const started = Date.now();
  parseAtTagsFromHtml(hostile);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5000, `scan took ${elapsed}ms`);
});

test('a real declaration is still read, quotes either way', () => {
  const page = `<html><head>${'<meta charset="utf-8">'.repeat(200)}<meta name="at:canonical" content="at://did:plc:abc/app.bsky.feed.post/xyz"></head>`;
  const result = parseAtTagsFromHtml(page);
  assert.deepEqual(result.canonical, ['at://did:plc:abc/app.bsky.feed.post/xyz']);
  assert.equal(primaryRecordFromAtTags(result), 'at://did:plc:abc/app.bsky.feed.post/xyz');

  const single = parseAtTagsFromHtml(`<meta name='at:canonical' content='at://did:plc:abc/app.bsky.feed.post/single'>`);
  assert.deepEqual(single.canonical, ['at://did:plc:abc/app.bsky.feed.post/single']);
});

test('a page declaring nothing is an empty result, not an error', () => {
  const result = parseAtTagsFromHtml('<html><head><title>hi</title></head><body>no tags</body></html>');
  assert.deepEqual(result.canonical, []);
  assert.equal(primaryRecordFromAtTags(result), null);
});
