import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerFeedTools } from '@/lib/mcp/tools/feeds';
import { TOOL_GROUPS } from '@/lib/mcp/catalog';
import {
  captureRegistrations,
  resultBody,
  MAX_DESCRIPTION_LENGTH,
} from '@/lib/mcp/__tests__/harness';

const { tools } = captureRegistrations(registerFeedTools);

test('registers exactly the feed and list tools the catalog documents', () => {
  const documented = TOOL_GROUPS.find((g) => g.id === 'feeds')!.tools.map((t) => t.name);
  assert.deepEqual([...tools.keys()].sort(), [...documented].sort());
});

test('every tool carries a title, a bounded description, and read-only annotations', () => {
  for (const tool of tools.values()) {
    assert.ok(tool.config.title, `${tool.name} has no title`);
    assert.ok(
      (tool.config.description ?? '').length <= MAX_DESCRIPTION_LENGTH,
      `${tool.name} description exceeds the budget`,
    );
    assert.equal(tool.config.annotations?.readOnlyHint, true, tool.name);
  }
});

test('list_feeds bounds its source enum and page size', () => {
  const schema = tools.get('list_feeds')!.config.inputSchema!;
  assert.equal(schema.safeParse({}).success, false, 'source is required');
  assert.equal(schema.safeParse({ source: 'everything' }).success, false);
  assert.equal(schema.safeParse({ source: 'popular', limit: 51 }).success, false);
  assert.equal(schema.safeParse({ source: 'popular', query: 'science' }).success, true);
});

test('list_feeds asks for an actor when the source needs one, before any fetch', async () => {
  const result = await tools.get('list_feeds')!.handler({ source: 'actor' });
  assert.equal(result.isError, true);
  assert.equal(resultBody(result).code, 'missing_parameter');
});

test('the URI-taking tools reject non-at:// input offline', async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['get_feed', { feed: 'https://bsky.app/profile/x/feed/y' }],
    ['get_list', { list: 'https://bsky.app/profile/x/lists/y' }],
    ['get_list_feed', { list: 'not-a-uri' }],
    ['get_feed_info', { uris: ['https://bsky.app/profile/x/feed/y'] }],
  ];
  for (const [name, args] of cases) {
    const result = await tools.get(name)!.handler(args);
    assert.equal(result.isError, true, name);
    assert.equal(resultBody(result).code, 'invalid_parameter', name);
  }
});

test('batch tools cap how much can be asked for at once', () => {
  const info = tools.get('get_feed_info')!.config.inputSchema!;
  assert.equal(info.safeParse({ uris: [] }).success, false);
  assert.equal(
    info.safeParse({ uris: Array.from({ length: 26 }, () => 'at://did:plc:a/app.bsky.feed.generator/x') }).success,
    false,
  );
  const list = tools.get('get_list')!.config.inputSchema!;
  assert.equal(list.safeParse({ list: 'at://did:plc:a/app.bsky.graph.list/x', limit: 101 }).success, false);
});
