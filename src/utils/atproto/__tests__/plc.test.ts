import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPlcAuditLog, plcCreatedAt, relativeAge, type PlcAuditEntry } from '@/utils/atproto/plc';

/**
 * The account card's Created row and the Repo at a glance tile both read an
 * account's age from these. The cases are the edges a 30-day month gets wrong
 * and the ones where the log has nothing usable to say.
 */

const at = (iso: string) => new Date(iso);

test('relativeAge counts days under a month', () => {
  const now = at('2026-11-19T12:00:00Z');
  assert.equal(relativeAge(at('2026-11-19T08:00:00Z'), { now }), 'today');
  assert.equal(relativeAge(at('2026-11-18T08:00:00Z'), { now }), '1 day old');
  assert.equal(relativeAge(at('2026-10-25T12:00:00Z'), { now }), '25 days old');
});

test('relativeAge counts calendar months, not 30-day blocks', () => {
  const now = at('2026-11-19T12:00:00Z');
  assert.equal(relativeAge(at('2026-10-19T12:00:00Z'), { now }), '1 month old');
  assert.equal(relativeAge(at('2026-10-20T12:00:00Z'), { now }), '30 days old');
  assert.equal(relativeAge(at('2026-05-01T12:00:00Z'), { now }), '6 months old');
});

test('relativeAge never reports twelve months as a remainder', () => {
  // 360 days before: once read "0 yr 12 mo old".
  assert.equal(relativeAge(at('2025-11-24T12:00:00Z'), { now: at('2026-11-19T12:00:00Z') }), '11 months old');
  // A day short of a second anniversary: once read "1 yr 12 mo old".
  assert.equal(relativeAge(at('2024-11-20T12:00:00Z'), { now: at('2026-11-19T12:00:00Z') }), '1 yr 11 mo old');
  assert.equal(relativeAge(at('2024-11-19T12:00:00Z'), { now: at('2026-11-19T12:00:00Z') }), '2 years old');
  assert.equal(relativeAge(at('2023-04-26T12:00:00Z'), { now: at('2026-11-19T12:00:00Z') }), '3 yr 6 mo old');
});

test('relativeAge can say the same span as a time', () => {
  const now = at('2026-11-19T12:00:00Z');
  assert.equal(relativeAge(at('2023-03-02T13:44:00Z'), { now, suffix: 'ago' }), '3 yr 8 mo ago');
  assert.equal(relativeAge(at('2025-11-19T12:00:00Z'), { now, suffix: 'ago' }), '1 year ago');
  assert.equal(relativeAge(at('2026-11-07T12:00:00Z'), { now, suffix: 'ago' }), '12 days ago');
  assert.equal(relativeAge(at('2026-11-19T09:00:00Z'), { now, suffix: 'ago' }), 'today');
});

test('relativeAge says so when the date is ahead of the clock', () => {
  assert.equal(relativeAge(at('2027-01-01T00:00:00Z'), { now: at('2026-11-19T12:00:00Z') }), 'in the future');
});

test('plcCreatedAt reads the first operation, and nothing else', () => {
  const entry = (createdAt: string): PlcAuditEntry => ({ did: 'did:plc:test', operation: {}, createdAt });
  assert.equal(
    plcCreatedAt([entry('2023-04-26T14:31:07.000Z'), entry('2024-01-01T00:00:00.000Z')])?.toISOString(),
    '2023-04-26T14:31:07.000Z',
  );
  assert.equal(plcCreatedAt([]), null);
  assert.equal(plcCreatedAt([entry('not a date')]), null);
});

test('getPlcAuditLog shares one request between callers that ask at once', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify([{ did: 'did:plc:inflight', operation: {}, createdAt: '2023-04-26T00:00:00Z' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const [a, b] = await Promise.all([getPlcAuditLog('did:plc:inflight'), getPlcAuditLog('did:plc:inflight')]);
    assert.equal(calls, 1);
    assert.equal(a, b);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('getPlcAuditLog lets a failed request be tried again', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('nope', { status: 503, statusText: 'Service Unavailable' });
  }) as typeof fetch;
  try {
    await assert.rejects(getPlcAuditLog('did:plc:retry'));
    await assert.rejects(getPlcAuditLog('did:plc:retry'));
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
