import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RELAYS,
  hostOfEndpoint,
  normalizeRelayInput,
  readHostStatus,
  readStatus,
  relayVerdict,
  requestCrawlCommand,
  type RelayAnswer,
  type RelayResult,
} from '@/lib/tools/relay';
import { RELAY } from '@/utils/atproto/config';

const HOST = 'pds.example.com';

const active: RelayAnswer = { state: 'known', status: 'active', accountCount: 12, seq: 3400 };
const offline: RelayAnswer = { state: 'known', status: 'offline', accountCount: 0, seq: null };
const unknown: RelayAnswer = { state: 'unknown' };
const silent: RelayAnswer = { state: 'error', message: 'no answer' };

const results = (...answers: (RelayAnswer | undefined)[]): RelayResult[] =>
  answers.map((answer, index) => ({ relay: RELAYS[index % RELAYS.length], answer }));

test('the relay list starts with the one the explorer already asks, and names no host twice', () => {
  assert.equal(RELAYS[0].host, new URL(RELAY).host);
  assert.equal(new Set(RELAYS.map((r) => r.host)).size, RELAYS.length);
  for (const relay of RELAYS) assert.match(relay.host, /^[a-z0-9.-]+$/);
});

test('normalizeRelayInput tells a host from an account, and leaves a bare domain open', () => {
  assert.deepEqual(normalizeRelayInput(' PDS.Example.com '), { ok: true, kind: 'either', host: 'pds.example.com' });
  assert.deepEqual(normalizeRelayInput('https://pds.example.com/xrpc/_health'), {
    ok: true,
    kind: 'host',
    host: 'pds.example.com',
  });
  assert.deepEqual(normalizeRelayInput('http://pds.example.com:2583'), { ok: true, kind: 'host', host: 'pds.example.com:2583' });
  assert.deepEqual(normalizeRelayInput('@alice.example.com'), { ok: true, kind: 'account', identifier: 'alice.example.com' });
  assert.deepEqual(normalizeRelayInput('at://alice.example.com/app.bsky.feed.post/abc'), {
    ok: true,
    kind: 'account',
    identifier: 'alice.example.com',
  });
  assert.deepEqual(normalizeRelayInput('did:plc:z72i7hdynmk6r22z27h6tvur'), {
    ok: true,
    kind: 'account',
    identifier: 'did:plc:z72i7hdynmk6r22z27h6tvur',
  });
  assert.deepEqual(normalizeRelayInput('at://did:plc:z72i7hdynmk6r22z27h6tvur'), {
    ok: true,
    kind: 'account',
    identifier: 'did:plc:z72i7hdynmk6r22z27h6tvur',
  });
  assert.equal(normalizeRelayInput('').ok, false);
  assert.equal(normalizeRelayInput('localhost').ok, false);
  assert.equal(normalizeRelayInput('not a host').ok, false);
  assert.equal(normalizeRelayInput('did:key:z6Mk').ok, false);
});

test('hostOfEndpoint reads the host out of a PDS endpoint', () => {
  assert.equal(hostOfEndpoint('https://PDS.example.com/'), 'pds.example.com');
  assert.equal(hostOfEndpoint('nonsense'), null);
});

test('readHostStatus reads a known host, an unknown one and a failure apart', () => {
  assert.deepEqual(
    readHostStatus(200, { hostname: HOST, status: 'active', accountCount: 12, seq: 3400 }),
    active,
  );
  // Only hostname is required of the response.
  assert.deepEqual(readHostStatus(200, { hostname: HOST }), {
    state: 'known',
    status: null,
    accountCount: null,
    seq: null,
  });
  // -1 is the reference relay's "no cursor recorded yet".
  assert.equal((readHostStatus(200, { hostname: HOST, seq: -1 }) as { seq: number | null }).seq, null);
  assert.deepEqual(readHostStatus(404, { error: 'HostNotFound', message: 'host not found' }), unknown);
  assert.deepEqual(readHostStatus(500, null), { state: 'error', message: 'HTTP 500' });
  assert.deepEqual(readHostStatus(400, { error: 'InvalidRequest' }), {
    state: 'error',
    message: 'InvalidRequest (HTTP 400)',
  });
  // A 200 that is not a host status is not a known host.
  assert.equal(readHostStatus(200, {}).state, 'error');
});

test('readStatus covers every status the lexicon names', () => {
  assert.equal(readStatus('active').tone, 'pass');
  assert.equal(readStatus('idle').recrawl, true);
  assert.equal(readStatus('offline').tone, 'fail');
  assert.equal(readStatus('offline').recrawl, true);
  assert.equal(readStatus('throttled').tone, 'warn');
  assert.equal(readStatus('banned').tone, 'fail');
  assert.equal(readStatus('banned').recrawl, false);
  assert.equal(readStatus(null).label, 'Known');
  assert.equal(readStatus('quarantined').label, 'quarantined');
});

test('the verdict is pending until every relay has answered', () => {
  assert.equal(relayVerdict(HOST, results(active, undefined), { reachable: true }).tone, 'pending');
});

test('every relay active is a pass', () => {
  const verdict = relayVerdict(HOST, results(active, active, active), { reachable: true });
  assert.equal(verdict.tone, 'pass');
  assert.match(verdict.title, /all 3 relays/);
  assert.equal(verdict.explainCrawl, false);
});

test('a relay that did not answer is left out of the count, and said so', () => {
  const verdict = relayVerdict(HOST, results(active, active, silent), { reachable: true });
  assert.equal(verdict.tone, 'pass');
  assert.match(verdict.title, /all 2 relays/);
  assert.match(verdict.text, /One relay did not answer/);
});

test('some relays active is a warning that explains how to reach the rest', () => {
  const verdict = relayVerdict(HOST, results(active, unknown, active, unknown), { reachable: true });
  assert.equal(verdict.tone, 'warn');
  assert.match(verdict.title, /2 of 4/);
  assert.equal(verdict.explainCrawl, true);
});

test('no relay knowing a live PDS fails and explains the crawl request', () => {
  const verdict = relayVerdict(HOST, results(unknown, unknown), { reachable: true });
  assert.equal(verdict.tone, 'fail');
  assert.match(verdict.title, /No relay knows/);
  assert.equal(verdict.explainCrawl, true);
});

test('no relay knowing a host that is not a PDS points at the hostname, not at crawling', () => {
  const verdict = relayVerdict(HOST, results(unknown, unknown), { reachable: false });
  assert.equal(verdict.tone, 'fail');
  assert.match(verdict.text, /check the hostname/);
  assert.equal(verdict.explainCrawl, false);
});

test('relays that know the host but dropped it fail, with the way back', () => {
  const verdict = relayVerdict(HOST, results(offline, offline), { reachable: true });
  assert.equal(verdict.tone, 'fail');
  assert.match(verdict.title, /none is reading it/);
  assert.equal(verdict.explainCrawl, true);
});

test('a ban is not something a crawl request fixes', () => {
  const banned: RelayAnswer = { state: 'known', status: 'banned', accountCount: 0, seq: null };
  const verdict = relayVerdict(HOST, results(banned, banned), { reachable: true });
  assert.equal(verdict.tone, 'fail');
  assert.match(verdict.text, /operator/);
  assert.equal(verdict.explainCrawl, false);
});

test('no relay answering at all says nothing about the host', () => {
  const verdict = relayVerdict(HOST, results(silent, silent), { reachable: true });
  assert.equal(verdict.tone, 'warn');
  assert.match(verdict.title, /None of the relays answered/);
});

test('requestCrawlCommand names the relay and the host', () => {
  const command = requestCrawlCommand('relay.example.net', HOST);
  assert.match(command, /https:\/\/relay\.example\.net\/xrpc\/com\.atproto\.sync\.requestCrawl/);
  assert.match(command, /\{"hostname":"pds\.example\.com"\}/);
});
