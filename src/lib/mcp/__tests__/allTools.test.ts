import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAtmosphereServer } from '@/lib/mcp/registry';
import { API_ERROR_CODES } from '@/lib/openapi';
import { CATALOG_TOOL_NAMES } from '@/lib/mcp/catalog';
import { captureRegistrations, resultBody } from '@/lib/mcp/__tests__/harness';

/**
 * Every tool executed once, against a stubbed network.
 *
 * The rest of the suite proves the surface: names, schemas, annotations, and
 * the offline validation paths. This proves the handlers actually run — that
 * each one survives a plausible upstream response, returns a parseable result,
 * and fails in the documented shape rather than throwing. Without it a tool
 * can be registered, schema-checked, documented, and still be broken the first
 * time an agent calls it.
 *
 * The stub answers every request with valid but empty JSON, which is the
 * shape most likely to break naive result handling.
 */

const { tools } = captureRegistrations(registerAtmosphereServer);

/** Minimal arguments that satisfy each tool's schema. */
const ARGS: Record<string, Record<string, unknown>> = {
  resolve_link: { atUri: 'at://did:plc:abc/app.bsky.feed.post/3k7' },
  list_waypoints: {},
  resolve_identity: { identifier: 'did:plc:abc' },
  get_identity_history: { identifier: 'did:plc:abc' },
  describe_repo: { identifier: 'did:plc:abc' },
  list_records: { identifier: 'did:plc:abc', collection: 'app.bsky.feed.post' },
  get_record: { uri: 'at://did:plc:abc/app.bsky.feed.post/3k7' },
  describe_pds: { host: 'pds.example.com' },
  get_backlinks: { target: 'did:plc:abc', mode: 'counts' },
  get_profile: { identifiers: ['alice.example'] },
  get_author_feed: { actor: 'alice.example' },
  get_thread: { uri: 'at://did:plc:abc/app.bsky.feed.post/3k7' },
  get_posts: { uris: ['at://did:plc:abc/app.bsky.feed.post/3k7'] },
  get_post_engagement: { uri: 'at://did:plc:abc/app.bsky.feed.post/3k7', kind: 'likes' },
  get_follows: { actor: 'alice.example' },
  get_followers: { actor: 'alice.example' },
  get_suggested_follows: { actor: 'alice.example' },
  get_trends: {},
  search_actors: { query: 'atproto' },
  search_posts: { query: 'atproto' },
  get_starter_packs: { actor: 'alice.example' },
  get_labeler_services: { dids: ['did:plc:labeler'] },
  list_feeds: { source: 'popular' },
  get_feed_info: { uris: ['at://did:plc:abc/app.bsky.feed.generator/gen'] },
  get_feed: { feed: 'at://did:plc:abc/app.bsky.feed.generator/gen' },
  list_lists: { actor: 'alice.example' },
  get_list: { list: 'at://did:plc:abc/app.bsky.graph.list/lst' },
  get_list_feed: { list: 'at://did:plc:abc/app.bsky.graph.list/lst' },
  list_trending_lexicons: {},
  get_lexicon_activity: { nsid: 'app.bsky.feed.post' },
  search_lexicons: { query: 'blog' },
  sample_recent_records: { nsid: 'app.bsky.feed.post' },
  get_lexicon_schema: { nsid: 'app.bsky.feed.post' },
  sample_jetstream: { collections: ['app.bsky.feed.post'], duration_seconds: 1, max_events: 1 },
};

test('the argument table covers every registered tool', () => {
  // Otherwise a newly added tool silently skips this whole file.
  assert.deepEqual(Object.keys(ARGS).sort(), [...CATALOG_TOOL_NAMES].sort());
});

/** A WebSocket that connects, stays silent, and closes when told. */
class SilentSocket {
  onmessage: ((e: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close() {}
}

for (const name of Object.keys(ARGS)) {
  test(`${name} runs and returns a well-formed result`, async () => {
    const originalFetch = globalThis.fetch;
    const originalWs = (globalThis as { WebSocket?: unknown }).WebSocket;
    globalThis.fetch = (async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    (globalThis as { WebSocket?: unknown }).WebSocket = SilentSocket;

    try {
      const result = await tools.get(name)!.handler(ARGS[name]);
      assert.ok(Array.isArray(result.content), `${name} returned no content array`);
      assert.equal(typeof result.content[0]?.text, 'string', `${name} returned no text block`);

      const body = resultBody(result);
      if (result.isError) {
        // A failure must be the documented shape, never a bare stack trace.
        assert.equal(body.ok, false, `${name} error body missing ok:false`);
        assert.ok(
          API_ERROR_CODES.includes(body.code as (typeof API_ERROR_CODES)[number]),
          `${name} returned an undocumented error code: ${String(body.code)}`,
        );
        assert.equal(typeof body.error, 'string', `${name} error body has no message`);
      } else {
        assert.equal(body.ok, true, `${name} success body missing ok:true`);
      }
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as { WebSocket?: unknown }).WebSocket = originalWs;
    }
  });
}
