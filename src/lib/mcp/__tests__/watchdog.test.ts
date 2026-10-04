import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  WATCHDOG_MS,
  currentPhase,
  describeStuckRequest,
  watchRequest,
  type RequestPhase,
} from '@/lib/mcp/watchdog';

const post = (headers: Record<string, string> = {}) =>
  new Request('https://aturi.to/api/mcp', { method: 'POST', headers });

const ok = () => Promise.resolve(new Response('hi'));

/** A body that emits its chunks with a gap, the way the transport's does. */
function drip(chunks: string[], gapMs = 5): Response {
  const encoder = new TextEncoder();
  let i = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (i >= chunks.length) {
          controller.close();
          return;
        }
        await new Promise((r) => setTimeout(r, gapMs));
        controller.enqueue(encoder.encode(chunks[i++]));
      },
    }),
    { status: 207, statusText: 'Multi-Status', headers: { 'x-transport': 'set-by-sdk' } },
  );
}

test('a streamed body arrives whole, in order, with its status and headers', async () => {
  // The route hands back whatever this returns, so a rebuild that drops the
  // transport's status or headers, or that buffers the stream, breaks SSE.
  const response = await watchRequest(post(), async () => drip(['event: a\n', 'data: 1\n', '\n']));
  assert.equal(response.status, 207);
  assert.equal(response.statusText, 'Multi-Status');
  assert.equal(response.headers.get('x-transport'), 'set-by-sdk');
  assert.equal(await response.text(), 'event: a\ndata: 1\n\n');
});

test('chunks are not coalesced on the way through', async () => {
  const response = await watchRequest(post(), async () => drip(['one', 'two', 'three']));
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const seen: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen.push(decoder.decode(value));
  }
  assert.deepEqual(seen, ['one', 'two', 'three']);
});

test('CORS headers can still be set on what comes back', async () => {
  const response = await watchRequest(post(), ok);
  response.headers.set('Access-Control-Allow-Origin', '*');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
});

test('a cancelled body cancels the source', async () => {
  let cancelled = false;
  const response = await watchRequest(
    post(),
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull() {},
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  await response.body!.cancel('client went away');
  assert.equal(cancelled, true);
});

test('a bodyless response passes straight through', async () => {
  const response = await watchRequest(post(), async () => new Response(null, { status: 202 }));
  assert.equal(response.status, 202);
  assert.equal(response.body, null);
});

test('the handler runs with a phase attached, starting before the body is read', async () => {
  // Read the stage rather than keeping the phase: it is a live object that
  // watchRequest moves on as the request progresses, so a reference held past
  // the handler reports the end state, not the one under test.
  let stage: string | undefined;
  await watchRequest(post(), async () => {
    stage = currentPhase()?.stage;
    return new Response('hi');
  });
  assert.equal(stage, 'reading-body');
});

test('what the event hook writes on the phase survives into the log line', async () => {
  // Stands in for mcp-handler's REQUEST_RECEIVED firing mid-flight: the hook
  // reaches the in-flight request through the async context, not an argument.
  let phase: RequestPhase | undefined;
  await watchRequest(post(), async () => {
    phase = currentPhase()!;
    phase.stage = 'dispatching';
    phase.method = 'tools/call';
    phase.tool = 'get_thread';
    return new Response('hi');
  });
  assert.equal(phase?.method, 'tools/call');
  assert.equal(phase?.tool, 'get_thread');
  // Once the handler has returned, the work is in the stream, not the handler.
  assert.equal(phase?.stage, 'streaming');
});

test('no phase leaks outside a request', async () => {
  assert.equal(currentPhase(), undefined);
  await watchRequest(post(), ok);
  assert.equal(currentPhase(), undefined);
});

test('a handler that throws still propagates', async () => {
  await assert.rejects(
    watchRequest(post(), async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
});

test('a request that finishes says nothing', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    const response = await watchRequest(post(), async () => drip(['done']));
    await response.text();
    assert.equal(warn.mock.callCount(), 0);
  } finally {
    warn.mock.restore();
  }
});

test('a stuck request names its stage, its method, and who sent it', () => {
  const line = describeStuckRequest(
    post({ 'user-agent': 'some-client/1.2', 'content-length': '142', accept: 'text/event-stream' }),
    { stage: 'streaming', method: 'tools/call', tool: 'get_thread' },
    30001,
  );
  assert.match(line, /^\[mcp\] POST stuck in streaming after 30001ms/);
  assert.match(line, /method=tools\/call tool=get_thread/);
  assert.match(line, /ua="some-client\/1\.2"/);
  assert.match(line, /content-length=142/);
});

test('a request stuck before its envelope parsed has no method to report', () => {
  // The case worth telling apart from every other: nothing was dispatched, so
  // there is no method and no tool, and the line must not imply otherwise.
  const line = describeStuckRequest(post(), { stage: 'reading-body' }, 30000);
  assert.match(line, /stuck in reading-body after 30000ms/);
  assert.doesNotMatch(line, /method=|tool=/);
  assert.match(line, /ua="-" content-length=- accept="-"/);
});

test('an absurd header cannot run away with the log line', () => {
  const line = describeStuckRequest(post({ 'user-agent': 'x'.repeat(5000) }), { stage: 'reading-body' }, 1);
  assert.ok(line.length < 400, `line was ${line.length} chars`);
});

test('the watchdog fires inside the platform limit, after the tool budget', () => {
  assert.ok(WATCHDOG_MS < 60_000, 'a stuck request must get to speak before the kill');
  assert.ok(WATCHDOG_MS > 25_000, 'an ordinary budget give-up should resolve before this fires');
});
