import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHandleChecks,
  handleSyntaxProblem,
  handleVerdict,
  normalizeHandleInput,
  readDnsRecords,
  readWellKnown,
  type HandleEvidence,
  type HandleProbe,
} from '@/lib/tools/handle';

const DID = 'did:plc:z72i7hdynmk6r22z27h6tvur';
const OTHER = 'did:plc:oky5czdrnfjpqslsw2a5iclo';

function probe(overrides: { records?: string[]; httpStatus?: number; body?: string; httpError?: string } = {}): HandleProbe {
  const handle = 'alice.example.com';
  return {
    handle,
    dns: {
      name: `_atproto.${handle}`,
      status: overrides.records?.length ? 'found' : 'none',
      records: overrides.records ?? [],
    },
    http: overrides.httpError
      ? { url: `https://${handle}/.well-known/atproto-did`, status: 'error', error: overrides.httpError }
      : {
          url: `https://${handle}/.well-known/atproto-did`,
          status: 'answered',
          httpStatus: overrides.httpStatus ?? 404,
          body: overrides.body ?? '',
        },
  };
}

const statusOf = (evidence: HandleEvidence, id: string) =>
  buildHandleChecks(evidence).find((check) => check.id === id)?.status;

test('normalizeHandleInput tidies what people paste', () => {
  assert.deepEqual(normalizeHandleInput(' @Alice.Example.com '), { ok: true, handle: 'alice.example.com' });
  assert.deepEqual(normalizeHandleInput('at://alice.example.com'), { ok: true, handle: 'alice.example.com' });
  assert.deepEqual(normalizeHandleInput('https://alice.example.com/profile'), { ok: true, handle: 'alice.example.com' });
  assert.deepEqual(normalizeHandleInput('alice.example.com.'), { ok: true, handle: 'alice.example.com' });
  assert.equal(normalizeHandleInput('did:plc:abc').ok, false);
  assert.equal(normalizeHandleInput('').ok, false);
});

test('handleSyntaxProblem follows the handle spec', () => {
  assert.equal(handleSyntaxProblem('alice.example.com'), null);
  assert.equal(handleSyntaxProblem('xn--ls8h.test-1.io'), null);
  assert.ok(handleSyntaxProblem('alice'));
  assert.ok(handleSyntaxProblem('alice..com'));
  assert.ok(handleSyntaxProblem('-alice.com'));
  assert.ok(handleSyntaxProblem('alice_b.com'));
  assert.ok(handleSyntaxProblem('alice.123'));
  assert.ok(handleSyntaxProblem('alice.local'));
  assert.ok(handleSyntaxProblem(`${'a'.repeat(64)}.com`));
});

test('readDnsRecords accepts one did= record and explains the rest', () => {
  assert.equal(readDnsRecords([`did=${DID}`]).did, DID);
  assert.equal(readDnsRecords(['v=spf1 -all', `did=${DID}`]).did, DID);
  assert.equal(readDnsRecords([]).absent, true);
  assert.equal(readDnsRecords([]).problem, null);
  // Other TXT values at the name, but nothing that reads as a claim.
  assert.ok(readDnsRecords(['hello']).problem);
  assert.equal(readDnsRecords(['hello']).absent, true);
  assert.match(readDnsRecords([`did=${DID}`, `did=${OTHER}`]).problem ?? '', /More than one/);
  assert.match(readDnsRecords([`did = ${DID}`]).problem ?? '', /exactly/);
  assert.match(readDnsRecords(['did=alice.example.com']).problem ?? '', /not a valid/);
});

test('readWellKnown tells a missing file from a wrong one', () => {
  assert.equal(readWellKnown(probe({ httpStatus: 200, body: `${DID}\n` }).http).did, DID);
  assert.equal(readWellKnown(probe({ httpStatus: 404 }).http).absent, true);
  assert.equal(readWellKnown(probe({ httpError: 'timed out' }).http).absent, true);
  assert.match(readWellKnown(probe({ httpStatus: 200, body: '<!doctype html><html>' }).http).problem ?? '', /web page/);
  assert.match(readWellKnown(probe({ httpStatus: 200, body: `did=${DID}` }).http).problem ?? '', /only the DID/);
  assert.match(readWellKnown(probe({ httpStatus: 500 }).http).problem ?? '', /HTTP 500/);
});

test('a handle that resolves and is claimed back passes', () => {
  const evidence: HandleEvidence = {
    handle: 'alice.example.com',
    probe: probe({ records: [`did=${DID}`] }),
    document: {
      alsoKnownAs: ['at://alice.example.com'],
      service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }],
    },
    pds: { endpoint: 'https://pds.example.com', reachable: true, handle: 'alice.example.com', handleIsCorrect: true, active: true },
    appview: { handle: 'alice.example.com' },
  };
  const checks = buildHandleChecks(evidence);
  assert.deepEqual(
    checks.map((c) => [c.id, c.status]),
    [
      ['dns', 'pass'],
      // No file is fine when the record answers.
      ['http', 'info'],
      ['document', 'pass'],
      ['claim', 'pass'],
      ['pds', 'pass'],
      ['appview', 'pass'],
    ],
  );
  assert.equal(handleVerdict(evidence, checks).tone, 'pass');
});

test('a domain that points at a DID which does not claim it fails', () => {
  const evidence: HandleEvidence = {
    handle: 'alice.example.com',
    probe: probe({ records: [`did=${DID}`] }),
    document: { alsoKnownAs: ['at://alice.bsky.social'], service: [] },
    appview: { handle: 'alice.bsky.social' },
  };
  const checks = buildHandleChecks(evidence);
  assert.equal(statusOf(evidence, 'claim'), 'fail');
  const verdict = handleVerdict(evidence, checks);
  assert.equal(verdict.tone, 'fail');
  assert.equal(verdict.did, DID);
});

test('neither method set up fails both and skips the rest', () => {
  const evidence: HandleEvidence = { handle: 'alice.example.com', probe: probe() };
  const checks = buildHandleChecks(evidence);
  assert.equal(statusOf(evidence, 'dns'), 'fail');
  assert.equal(statusOf(evidence, 'http'), 'fail');
  assert.equal(statusOf(evidence, 'claim'), 'skip');
  assert.equal(handleVerdict(evidence, checks).tone, 'fail');
});

test('the two methods disagreeing is a warning, and DNS wins', () => {
  const evidence: HandleEvidence = {
    handle: 'alice.example.com',
    probe: probe({ records: [`did=${DID}`], httpStatus: 200, body: OTHER }),
    document: { alsoKnownAs: ['at://alice.example.com'], service: [] },
    appview: { handle: 'alice.example.com' },
  };
  const checks = buildHandleChecks(evidence);
  assert.equal(statusOf(evidence, 'agree'), 'warn');
  assert.equal(handleVerdict(evidence, checks).did, DID);
});

test('a broken well-known file beside a working record is a warning, not a failure', () => {
  const evidence: HandleEvidence = {
    handle: 'alice.example.com',
    probe: probe({ records: [`did=${DID}`], httpStatus: 200, body: '<html>site</html>' }),
  };
  assert.equal(statusOf(evidence, 'http'), 'warn');
});

test('steps not yet observed are pending, and so is the verdict', () => {
  const waiting: HandleEvidence = { handle: 'alice.example.com' };
  assert.ok(buildHandleChecks(waiting).every((c) => c.status === 'pending'));
  const partial: HandleEvidence = { handle: 'alice.example.com', probe: probe({ records: [`did=${DID}`] }) };
  const checks = buildHandleChecks(partial);
  assert.equal(statusOf(partial, 'dns'), 'pass');
  assert.equal(statusOf(partial, 'document'), 'pending');
  assert.equal(handleVerdict(partial, checks).tone, 'pending');
});

test('handle.invalid on the AppView is a lag when everything else agrees', () => {
  const evidence: HandleEvidence = {
    handle: 'alice.example.com',
    probe: probe({ records: [`did=${DID}`] }),
    document: {
      alsoKnownAs: ['at://alice.example.com'],
      service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example.com' }],
    },
    pds: { endpoint: 'https://pds.example.com', reachable: true, handleIsCorrect: true, active: true },
    appview: { handle: 'handle.invalid' },
  };
  assert.equal(statusOf(evidence, 'appview'), 'warn');
  assert.equal(handleVerdict(evidence, buildHandleChecks(evidence)).tone, 'warn');
});
