import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UPSTREAM_TIMEOUT_MS,
  UPSTREAM_USER_AGENT,
  withDeadline,
  withIdentification,
} from '@/utils/requestDeadline';

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
