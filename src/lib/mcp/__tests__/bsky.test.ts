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
    ['get_profile', 'get_thread', 'search_actors', 'search_posts'],
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

test('get_thread rejects addresses that are not Bluesky posts, offline', async () => {
  const handler = tools.get('get_thread')!.handler;

  const wrongCollection = await handler({ uri: 'at://did:plc:abc/com.whtwnd.blog.entry/xyz' });
  assert.equal(resultBody(wrongCollection).code, 'invalid_parameter');

  const bareHandle = await handler({ uri: 'alice.bsky.social' });
  assert.equal(resultBody(bareHandle).code, 'invalid_parameter');

  const unknownUrl = await handler({ uri: 'https://example.com/not-a-post' });
  assert.equal(resultBody(unknownUrl).code, 'invalid_parameter');
});
