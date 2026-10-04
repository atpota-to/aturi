import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerResolveTools } from '@/lib/mcp/tools/resolve';
import {
  captureRegistrations,
  resultBody,
  MAX_DESCRIPTION_LENGTH,
} from '@/lib/mcp/__tests__/harness';

const { tools } = captureRegistrations(registerResolveTools);

test('registers exactly the resolve tools', () => {
  assert.deepEqual([...tools.keys()].sort(), ['list_waypoints', 'resolve_link']);
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

test('resolve_link with neither url nor atUri answers missing_parameter, offline', async () => {
  const result = await tools.get('resolve_link')!.handler({});
  assert.equal(result.isError, true);
  assert.equal(resultBody(result).code, 'missing_parameter');
});

test('resolve_link rejects a malformed atUri, offline', async () => {
  const result = await tools.get('resolve_link')!.handler({ atUri: 'not-an-at-uri' });
  assert.equal(result.isError, true);
  assert.equal(resultBody(result).code, 'invalid_parameter');
});

test('resolve_link resolves a DID-based post atUri without any network', async () => {
  // A DID-shaped repo segment skips handle resolution, and atUri input skips
  // page probing, so this exercises the full catalog path offline.
  const result = await tools.get('resolve_link')!.handler({
    atUri: 'at://did:plc:abc123/app.bsky.feed.post/3k7qwerty',
  });
  assert.notEqual(result.isError, true);
  const body = resultBody(result);
  assert.equal(body.resolved, true);
  const parsed = body.parsed as { type: string; did: string };
  assert.equal(parsed.type, 'post');
  assert.equal(parsed.did, 'did:plc:abc123');
  const waypoints = body.waypoints as Array<{ id: string; url: string }>;
  assert.ok(waypoints.length > 5, 'expected a substantial waypoint list for a post');
  assert.ok(waypoints.every(w => typeof w.url === 'string' && w.url.startsWith('http')));
});

test('list_waypoints runs offline, and type filtering narrows the catalog', async () => {
  const all = resultBody(await tools.get('list_waypoints')!.handler({}));
  const posts = resultBody(await tools.get('list_waypoints')!.handler({ type: 'post' }));
  const compose = resultBody(
    await tools.get('list_waypoints')!.handler({ capability: 'compose' }),
  );

  assert.ok((all.count as number) >= 25, 'catalog advertises 25+ clients');
  assert.ok((posts.count as number) > 0);
  assert.ok((posts.count as number) <= (all.count as number));
  const ids = new Set((all.waypoints as Array<{ id: string }>).map(w => w.id));
  assert.ok(ids.has('bluesky'), 'the bluesky waypoint exists');
  for (const w of compose.waypoints as Array<{ composeIntent: unknown }>) {
    assert.notEqual(w.composeIntent, null);
  }
});

test('list_waypoints schema rejects unknown filters', () => {
  const schema = tools.get('list_waypoints')!.config.inputSchema!;
  assert.equal(schema.safeParse({ type: 'video' }).success, false);
  assert.equal(schema.safeParse({ capability: 'teleport' }).success, false);
  assert.equal(schema.safeParse({ type: 'post', capability: 'compose' }).success, true);
});
