/**
 * The endpoint itself, driven through its real POST export.
 *
 * Everything else in this directory tests a tool or a helper against a double.
 * The bug these cover lived in neither: the route advertised a capability the
 * catalog cannot exercise, a client took it at its word and opened a
 * subscriptions/listen stream, and that stream is meant to stay open until the
 * client hangs up — which on a function with a sixty second ceiling meant it
 * was killed instead, about a hundred times an hour. Nothing below the route
 * could have caught it, so these go through the route.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '@/app/api/mcp/route';

/**
 * Fail rather than hang: a regression here is a body that never closes.
 *
 * Cancelled on the way out, not just abandoned. A stream left open keeps its
 * keepalive running and takes the rest of the file down with it, which turns
 * one honest failure into four confusing ones.
 */
async function bodyWithin(response: Response, ms: number): Promise<string> {
  if (!response.body) return response.text();

  // The reader is held here rather than left to response.text(), which locks
  // it: a body that text() is still reading cannot be cancelled, so the stream
  // survives the failure and the runner abandons the rest of the file with
  // "Promise resolution is still pending".
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + ms;
  let out = '';

  try {
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`body still open after ${ms}ms`);

      // Deliberately not unref'd, and cleared the moment the read settles. A
      // stalled subscription stream is held open only by the SDK's own
      // keepalive, which is unref'd; if this timer were too, nothing would be
      // keeping the loop alive and the runner would abandon the whole file
      // with "Promise resolution is still pending" before any assertion ran.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expiry = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`body still open after ${ms}ms`)), left);
      });

      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([reader.read(), expiry]);
      } finally {
        clearTimeout(timer);
      }

      if (chunk.done) return out + decoder.decode();
      out += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function jsonRpc(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://aturi.to/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** The first `data:` payload out of an SSE body. */
function firstEvent(sse: string): Record<string, unknown> {
  const line = sse.split('\n').find((l) => l.startsWith('data: '));
  assert.ok(line, `no data frame in: ${sse.slice(0, 200)}`);
  return JSON.parse(line.slice(6));
}

test('the server does not claim its tool or prompt lists can change', async () => {
  // They cannot: the registry is fixed at build time and the server is rebuilt
  // per request from it. Claiming otherwise invites a subscription that can
  // only ever deliver keepalives until the platform kills the invocation.
  const response = await POST(
    jsonRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    }),
  );

  const result = firstEvent(await bodyWithin(response, 10_000)).result as {
    capabilities: { tools?: { listChanged?: boolean }; prompts?: { listChanged?: boolean } };
  };
  assert.equal(result.capabilities.tools?.listChanged, false);
  assert.equal(result.capabilities.prompts?.listChanged, false);
});

test('a subscription is refused outright, not held open', async () => {
  // The modern route needs all of this to be reached at all: the 2026-07-28
  // revision in both the header and the envelope, and the Mcp-Method header
  // agreeing with the body. Getting any of it wrong falls through to the
  // stateless path and answers "Method not found", which would make this test
  // pass for entirely the wrong reason.
  const response = await POST(
    jsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'subscriptions/listen',
        params: {
          notifications: { toolsListChanged: true },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
      { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'subscriptions/listen' },
    ),
  );

  const body = await bodyWithin(response, 10_000);
  assert.doesNotMatch(body, /keepalive/, 'a refused subscription must not stream');
  assert.doesNotMatch(
    body,
    /Method not found/,
    'this fell through to the legacy path and tested nothing',
  );

  const error = (body.startsWith('event:') ? firstEvent(body) : JSON.parse(body)).error as {
    message: string;
  };
  assert.match(error.message, /Subscription limit reached/);
});

test('an ordinary call still works through the real route', async () => {
  const response = await POST(jsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  const result = firstEvent(await bodyWithin(response, 10_000)).result as {
    tools: Array<{ name: string }>;
  };
  assert.ok(result.tools.length > 20, `expected the full catalog, got ${result.tools.length}`);
});

test('CORS headers survive whatever the transport returns', async () => {
  const response = await POST(jsonRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }));
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  await bodyWithin(response, 10_000);
});
