import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLinkFacets,
  defuseHandles,
  graphemeLength,
  preparePosts,
  shortenLinks,
  splitIntoPosts,
  stripMarkdown,
} from '../format.ts';

const LIMIT = 300;
const encoder = new TextEncoder();

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
    assert.ok(graphemeLength(post) <= LIMIT, `${graphemeLength(post)} graphemes`);
  }
});

test('a split answer is numbered with the real total', () => {
  const long = 'Identity resolution walks the handle to a DID. '.repeat(20);
  const posts = splitIntoPosts(long, 3);
  assert.ok(posts.length > 1);
  posts.forEach((post, index) => {
    assert.match(post, new RegExp(`\\s${index + 1}/${posts.length}$`));
  });
});

test('an answer longer than the post budget is cut with an ellipsis', () => {
  const posts = splitIntoPosts('lexicon '.repeat(500), 2);
  assert.equal(posts.length, 2);
  assert.match(posts[1]!, /…\s2\/2$/);
});

test('grapheme clusters are never split down the middle', () => {
  const posts = splitIntoPosts('👨‍👩‍👧‍👦'.repeat(400), 2);
  for (const post of posts) {
    assert.ok(graphemeLength(post) <= LIMIT);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(post));
  }
});

test('markdown a model emits is rendered down to plain text', () => {
  assert.equal(stripMarkdown('**bold** and `code`'), 'bold and code');
  assert.equal(stripMarkdown('## Heading\ntext'), 'Heading\ntext');
  assert.equal(stripMarkdown('- one\n- two'), '• one\n• two');
});

test('a markdown link is unwrapped so the URL survives as text', () => {
  assert.equal(
    stripMarkdown('see [the record](https://aturi.to/at/x)'),
    'see the record https://aturi.to/at/x',
  );
});

test('handle-shaped text loses its sigil', () => {
  assert.equal(defuseHandles('ask @alice.bsky.social about it'), 'ask alice.bsky.social about it');
  assert.equal(defuseHandles('@a.co @b.co @c.co'), 'a.co b.co c.co');
});

test('an email-shaped string is not treated as a handle', () => {
  assert.equal(defuseHandles('mail me@example.com'), 'mail me@example.com');
});

test('long URLs are shortened for display but keep the full uri', () => {
  const { text, links } = shortenLinks(
    'see https://aturi.to/at/did:plc:abcdefghijklmnop/app.bsky.feed.post/3lxyz',
  );
  assert.equal(links.length, 1);
  assert.equal(links[0]!.uri, 'https://aturi.to/at/did:plc:abcdefghijklmnop/app.bsky.feed.post/3lxyz');
  assert.ok(links[0]!.display.length <= 32);
  assert.ok(text.includes(links[0]!.display));
  assert.ok(!text.includes('https://'));
});

test('a trailing sentence period stays out of the uri', () => {
  const { links } = shortenLinks('open https://aturi.to/mcp.');
  assert.equal(links[0]!.uri, 'https://aturi.to/mcp');
});

test('two different URLs never collapse onto one display string', () => {
  const { links } = shortenLinks(
    'https://aturi.to/a/very/long/path/that/exceeds/the/display/limit/one ' +
      'https://aturi.to/a/very/long/path/that/exceeds/the/display/limit/two',
  );
  assert.notEqual(links[0]!.display, links[1]!.display);
});

test('facet byte offsets are UTF-8, not UTF-16', () => {
  // Four emoji ahead of the link: 8 UTF-16 units, 16 UTF-8 bytes. A facet
  // measured in the wrong unit points into the middle of the emoji.
  const { text, links } = shortenLinks('🌍🌎🌏🌐 https://aturi.to/mcp');
  const [facet] = buildLinkFacets(text, links);
  assert.ok(facet);
  const bytes = encoder.encode(text);
  const sliced = new TextDecoder().decode(
    bytes.slice(facet.index.byteStart, facet.index.byteEnd),
  );
  assert.equal(sliced, links[0]!.display);
});

test('only link facets are ever produced', () => {
  const posts = preparePosts(
    'ask @alice.bsky.social and see https://aturi.to/mcp #atproto',
    1,
  );
  for (const post of posts) {
    for (const facet of post.facets) {
      for (const feature of facet.features) {
        assert.equal(feature.$type, 'app.bsky.richtext.facet#link');
      }
    }
  }
});

test('link facets are capped so a reply cannot become a link dump', () => {
  const many = Array.from(
    { length: 12 },
    (_, i) => `https://aturi.to/path-number-${i}`,
  ).join(' ');
  const [post] = preparePosts(many, 1);
  assert.ok(post);
  assert.ok(post.facets.length <= 4, `got ${post.facets.length}`);
});

test('a link broken across a post boundary gets no facet rather than a wrong one', () => {
  const filler = 'atproto '.repeat(36);
  const posts = preparePosts(`${filler}https://aturi.to/some/path/here`, 2);
  const bytes = (s: string) => encoder.encode(s);
  for (const post of posts) {
    for (const facet of post.facets) {
      assert.ok(facet.index.byteEnd <= bytes(post.text).length);
    }
  }
});

test('facets are ordered by byte offset, as the lexicon expects', () => {
  const [post] = preparePosts(
    'one https://aturi.to/alpha two https://aturi.to/beta three https://aturi.to/gamma',
    1,
  );
  assert.ok(post);
  const starts = post.facets.map((f) => f.index.byteStart);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

test('nested display strings never produce overlapping facets', () => {
  // 'turi.to/a' is a substring of 'aturi.to/ab' at offset 1. Matching on
  // substring alone would emit [0,11] and [1,10], which overlap.
  const facets = buildLinkFacets('aturi.to/ab', [
    { display: 'aturi.to/ab', uri: 'https://aturi.to/ab' },
    { display: 'turi.to/a', uri: 'https://turi.to/a' },
  ]);
  assert.equal(facets.length, 1);
  assert.equal(facets[0]!.features[0]!.uri, 'https://aturi.to/ab');
});

test('facet ranges never overlap, whatever the input', () => {
  const [post] = preparePosts(
    'https://aturi.to/a https://aturi.to/ab https://aturi.to/abc https://aturi.to/a',
    1,
  );
  assert.ok(post);
  let end = -1;
  for (const facet of post.facets) {
    assert.ok(facet.index.byteStart >= end, 'facets must not overlap');
    end = facet.index.byteEnd;
  }
});

test('a facet never points past the end of its post', () => {
  for (const post of preparePosts(
    `${'atproto '.repeat(80)}https://aturi.to/explore/lexicons`,
    3,
  )) {
    const length = encoder.encode(post.text).length;
    for (const facet of post.facets) {
      assert.ok(facet.index.byteEnd <= length);
      assert.ok(facet.index.byteStart < facet.index.byteEnd);
    }
  }
});
