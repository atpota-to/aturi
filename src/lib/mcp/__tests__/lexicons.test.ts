import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerLexiconTools } from '@/lib/mcp/tools/lexicons';
import {
  captureRegistrations,
  resultBody,
  MAX_DESCRIPTION_LENGTH,
} from '@/lib/mcp/__tests__/harness';

const { tools } = captureRegistrations(registerLexiconTools);

test('registers exactly the lexicon tools', () => {
  assert.deepEqual(
    [...tools.keys()].sort(),
    [
      'get_lexicon_activity',
      'get_lexicon_schema',
      'list_trending_lexicons',
      'sample_recent_records',
      'search_lexicons',
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

test('window and sort are closed enums; limits are bounded', () => {
  const trending = tools.get('list_trending_lexicons')!.config.inputSchema!;
  assert.equal(trending.safeParse({ window: '90d' }).success, false);
  assert.equal(trending.safeParse({ sort: 'most-hype' }).success, false);
  assert.equal(trending.safeParse({ limit: 51 }).success, false);
  assert.equal(trending.safeParse({ window: '7d', sort: 'dids-estimate', limit: 50 }).success, true);

  const sample = tools.get('sample_recent_records')!.config.inputSchema!;
  assert.equal(sample.safeParse({ nsid: 'app.bsky.feed.post', limit: 101 }).success, false);
  assert.equal(sample.safeParse({ nsid: 'app.bsky.feed.post', limit: 100 }).success, true);
});

test('NSID-taking tools reject non-NSIDs before touching the network', async () => {
  for (const name of ['get_lexicon_activity', 'sample_recent_records', 'get_lexicon_schema']) {
    const result = await tools.get(name)!.handler({ nsid: 'not an nsid' });
    assert.equal(result.isError, true, name);
    assert.equal(resultBody(result).code, 'invalid_parameter', name);
  }
});

test('search_lexicons requires at least two characters', () => {
  const schema = tools.get('search_lexicons')!.config.inputSchema!;
  assert.equal(schema.safeParse({ query: 'a' }).success, false);
  assert.equal(schema.safeParse({ query: 'blog' }).success, true);
});
