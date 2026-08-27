import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UPSTREAM_TIMEOUT_MS,
  UPSTREAM_USER_AGENT,
  withDeadline,
  withIdentification,
} from '@/utils/requestDeadline';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { upstreamFetch } from '@/utils/upstreamFetch';

test('a deadline is always attached, with or without a caller signal', () => {
  assert.ok(withDeadline() instanceof AbortSignal);
  assert.ok(withDeadline(new AbortController().signal) instanceof AbortSignal);
  assert.ok(withDeadline(null) instanceof AbortSignal);
});

test('the caller signal still aborts the request', () => {
  const controller = new AbortController();
  const combined = withDeadline(controller.signal);
  assert.equal(combined.aborted, false);
  controller.abort();
  assert.equal(combined.aborted, true);
});

test('withIdentification survives being spread into another options object', () => {
  // The bug this guards: `{ cache: 'no-store', signal: …, ...init }` put the
  // caller's init last, so an init carrying an explicit `signal: undefined`
  // silently erased the deadline. Spreading the *result* is the safe order.
  const init: RequestInit = { signal: undefined, cache: 'no-store' };
  const merged = { cache: 'no-store' as RequestCache, ...withIdentification(init) };
  assert.ok(merged.signal instanceof AbortSignal, 'deadline was dropped by the spread');
});

test('an existing caller signal is preserved through withIdentification', () => {
  const controller = new AbortController();
  const merged = withIdentification({ signal: controller.signal });
  const signal = merged.signal as AbortSignal;
  assert.equal(signal.aborted, false);
  controller.abort();
  assert.equal(signal.aborted, true);
});

test('requests identify this deployment off-browser', () => {
  // Node has no `window`, so the header is set here; in the extension's
  // browser context it is omitted, since browsers forbid scripts from
  // setting User-Agent.
  const headers = withIdentification().headers as Record<string, string> | undefined;
  assert.equal(headers?.['User-Agent'], UPSTREAM_USER_AGENT);
  assert.match(UPSTREAM_USER_AGENT, /aturi\.to/);
});

test('caller headers are kept alongside the identification header', () => {
  const headers = withIdentification({ headers: { accept: 'application/json' } }) .headers as Record<string, string>;
  assert.equal(headers.accept, 'application/json');
  assert.equal(headers['User-Agent'], UPSTREAM_USER_AGENT);
});

test('the deadline matches upstreamFetch, so the two cannot drift', () => {
  assert.equal(UPSTREAM_TIMEOUT_MS, 8000);
});

test('upstreamFetch identifies itself on the wire, headers and all', async () => {
  // The unit assertions above check the object we build. This checks what a
  // server actually receives, which is the only thing an operator sees, and
  // it covers upstreamFetch as well as withIdentification: upstreamFetch
  // spent a while sending undici's default `node` because nothing tested it.
  const seen: Array<{ path: string; ua: string | undefined; accept: string | undefined }> = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url ?? '', ua: req.headers['user-agent'], accept: req.headers.accept });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    await fetch(`${base}/with-identification`, withIdentification());
    await upstreamFetch(`${base}/upstream-fetch`);
    await upstreamFetch(`${base}/upstream-fetch-with-headers`, {
      headers: { accept: 'application/json' },
    });
  } finally {
    server.close();
  }

  assert.equal(seen.length, 3);
  for (const request of seen) {
    assert.equal(request.ua, UPSTREAM_USER_AGENT, `${request.path} was not identified`);
  }
  // A caller's own headers survive alongside the identification.
  assert.equal(seen[2].accept, 'application/json');
});
