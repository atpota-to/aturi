import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerGraphTools } from '@/lib/mcp/tools/graph';
import {
  captureRegistrations,
  resultBody,
  MAX_DESCRIPTION_LENGTH,
} from '@/lib/mcp/__tests__/harness';

const { tools } = captureRegistrations(registerGraphTools);
const backlinks = tools.get('get_backlinks');

test('registers exactly the graph tools', () => {
  assert.deepEqual([...tools.keys()], ['get_backlinks']);
});

test('carries a title, a bounded description, and read-only annotations', () => {
  assert.ok(backlinks?.config.title);
  assert.ok((backlinks?.config.description ?? '').length <= MAX_DESCRIPTION_LENGTH);
  assert.equal(backlinks?.config.annotations?.readOnlyHint, true);
  assert.equal(backlinks?.config.annotations?.openWorldHint, true);
});

test('schema requires target and a known mode', () => {
  const schema = backlinks?.config.inputSchema;
  assert.ok(schema);
  assert.equal(schema.safeParse({}).success, false);
  assert.equal(schema.safeParse({ target: 'did:plc:abc' }).success, false);
  assert.equal(
    schema.safeParse({ target: 'did:plc:abc', mode: 'everything' }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ target: 'did:plc:abc', mode: 'counts' }).success,
    true,
  );
  assert.equal(
    schema.safeParse({ target: 'did:plc:abc', mode: 'records', limit: 500 }).success,
    false,
  );
});

test('records mode without a source answers missing_parameter, offline', async () => {
  // A DID-shaped target short-circuits identity resolution, so this path
  // never touches the network.
  const result = await backlinks!.handler({ target: 'did:plc:abc', mode: 'records' });
  assert.equal(result.isError, true);
  const body = resultBody(result);
  assert.equal(body.code, 'missing_parameter');
  assert.ok(String(body.hint).includes('counts'));
});

test('a malformed at:// target answers invalid_parameter, offline', async () => {
  const result = await backlinks!.handler({ target: 'at://', mode: 'counts' });
  assert.equal(result.isError, true);
  assert.equal(resultBody(result).code, 'invalid_parameter');
});

test('a root-level source path keeps its dot when rebuilt', async () => {
  // Constellation reports root-level links with the path ".", and answers
  // "collection:" (the stripped form) with nothing rather than an error, so
  // stripping here would silently hide every root-path source.
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ total: 0, records: [], cursor: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    await backlinks!.handler({
      target: 'did:plc:abc',
      mode: 'records',
      source_collection: 'sh.tangled.graph.vouch',
      source_path: '.',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const backlinkCall = calls.find((c) => c.includes('getBacklinks'));
  assert.ok(backlinkCall, 'expected a getBacklinks request');
  assert.match(
    decodeURIComponent(backlinkCall!),
    /source=sh\.tangled\.graph\.vouch:\./,
    `root path lost its dot: ${backlinkCall}`,
  );
});

test('a non-root source path is sent without its leading dot', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ total: 0, records: [], cursor: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    await backlinks!.handler({
      target: 'did:plc:abc',
      mode: 'records',
      source_collection: 'app.bsky.graph.follow',
      source_path: '.subject',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const backlinkCall = calls.find((c) => c.includes('getBacklinks'));
  assert.match(decodeURIComponent(backlinkCall!), /source=app\.bsky\.graph\.follow:subject/);
});
