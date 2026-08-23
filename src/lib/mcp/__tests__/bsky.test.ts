import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerBskyTools } from '@/lib/mcp/tools/bsky';
import {
  captureRegistrations,
  resultBody,
  MAX_DESCRIPTION_LENGTH,
} from '@/lib/mcp/__tests__/harness';

const { tools } = captureRegistrations(registerBskyTools);

test('registers exactly the Bluesky-layer tools', () => {
  assert.deepEqual(
    [...tools.keys()].sort(),
    [
      'get_author_feed',
      'get_followers',
      'get_follows',
      'get_post_engagement',
      'get_profile',
      'get_thread',
      'get_trends',
      'search_actors',
      'search_posts',
    ],
  );
});

test('every tool carries a title, a bounded description, and read-only annotations', () => {
  for (const tool of tools.values()) {
    assert.ok(tool.config.title, `${tool.name} has no title`);
    assert.ok(
      (tool.config.description ?? '').length <= MAX_DESCRIPTION_LENGTH,
      `${tool.name} description exceeds the budget`,
    );
    assert.equal(tool.config.annotations?.readOnlyHint, true, tool.name);
    assert.equal(tool.config.annotations?.openWorldHint, true, tool.name);
  }
});

test('get_profile bounds the identifier batch to 1-25', () => {
  const schema = tools.get('get_profile')!.config.inputSchema!;
  assert.equal(schema.safeParse({ identifiers: [] }).success, false);
  assert.equal(
    schema.safeParse({ identifiers: Array.from({ length: 26 }, (_, i) => `a${i}.test`) }).success,
    false,
  );
  assert.equal(schema.safeParse({ identifiers: ['alice.test'] }).success, true);
});

test('search schemas bound query length and page sizes', () => {
  const posts = tools.get('search_posts')!.config.inputSchema!;
  assert.equal(posts.safeParse({}).success, false);
  assert.equal(posts.safeParse({ query: 'x'.repeat(301) }).success, false);
  assert.equal(posts.safeParse({ query: 'atproto', limit: 51 }).success, false);
  assert.equal(posts.safeParse({ query: 'atproto', sort: 'newest' }).success, false);
  assert.equal(posts.safeParse({ query: 'atproto', sort: 'latest', limit: 50 }).success, true);

  const actors = tools.get('search_actors')!.config.inputSchema!;
  assert.equal(actors.safeParse({ query: 'x'.repeat(101) }).success, false);
  assert.equal(actors.safeParse({ query: 'dame', limit: 25 }).success, true);
});

test('the new feed and graph tools bound their inputs', () => {
  const feed = tools.get('get_author_feed')!.config.inputSchema!;
  assert.equal(feed.safeParse({}).success, false);
  assert.equal(feed.safeParse({ actor: 'dame.is', limit: 101 }).success, false);
  assert.equal(feed.safeParse({ actor: 'dame.is', filter: 'everything' }).success, false);
  assert.equal(feed.safeParse({ actor: 'dame.is', filter: 'posts_no_replies', limit: 100 }).success, true);

  const trends = tools.get('get_trends')!.config.inputSchema!;
  assert.equal(trends.safeParse({ limit: 26 }).success, false);
  assert.equal(trends.safeParse({}).success, true);

  for (const name of ['get_follows', 'get_followers']) {
    const schema = tools.get(name)!.config.inputSchema!;
    assert.equal(schema.safeParse({}).success, false, name);
    assert.equal(schema.safeParse({ actor: 'dame.is', limit: 101 }).success, false, name);
    assert.equal(schema.safeParse({ actor: 'dame.is' }).success, true, name);
  }

  const eng = tools.get('get_post_engagement')!.config.inputSchema!;
  assert.equal(eng.safeParse({ uri: 'at://x/y/z' }).success, false, 'kind required');
  assert.equal(eng.safeParse({ uri: 'at://x/y/z', kind: 'boosts' }).success, false);
  assert.equal(eng.safeParse({ uri: 'at://x/y/z', kind: 'likes' }).success, true);
});

test('get_profile diverts malformed identifiers to notFound without failing the batch', async () => {
  // All-malformed → no network call, and every input lands in notFound rather
  // than 400-ing the batch (the poisoning bug the reviewer caught).
  const result = await tools.get('get_profile')!.handler({ identifiers: ['alice', 'John Doe'] });
  assert.notEqual(result.isError, true);
  const body = resultBody(result);
  assert.deepEqual(body.profiles, []);
  assert.deepEqual((body.notFound as string[]).sort(), ['John Doe', 'alice'].sort());
});

test('get_post_engagement rejects a non-at:// uri offline', async () => {
  const result = await tools.get('get_post_engagement')!.handler({
    uri: 'https://bsky.app/profile/dame.is/post/abc',
    kind: 'likes',
  });
  assert.equal(result.isError, true);
  assert.equal(resultBody(result).code, 'invalid_parameter');
});

test('get_thread rejects addresses that are not Bluesky posts, offline', async () => {
  const handler = tools.get('get_thread')!.handler;

  const wrongCollection = await handler({ uri: 'at://did:plc:abc/com.whtwnd.blog.entry/xyz' });
  assert.equal(resultBody(wrongCollection).code, 'invalid_parameter');

  const bareHandle = await handler({ uri: 'alice.bsky.social' });
  assert.equal(resultBody(bareHandle).code, 'invalid_parameter');

  const unknownUrl = await handler({ uri: 'https://example.com/not-a-post' });
  assert.equal(resultBody(unknownUrl).code, 'invalid_parameter');
});
