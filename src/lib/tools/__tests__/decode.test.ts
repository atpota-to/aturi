import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TID } from '@atproto/common-web';
import {
  decodeBase32,
  decodeBase58,
  decodeIdentifier,
  formatTid,
  isSensitiveInput,
  parseTid,
} from '@/lib/tools/decode';

// Real identifiers, read from the network when this was written.
const POST_TID = '3n22yg6lg2k2f';
const POST_CID = 'bafyreibu7nij5fidh2dx7ljpypstqetii3q7333it52w3l3uekrpbuj5rq';
const BSKY_DID = 'did:plc:z72i7hdynmk6r22z27h6tvur';
const BSKY_KEY = 'zQ3shQo6TF2moaqMTrUZEM1jeuYRQXeHEx4evX9751y2qPqRA';
const NOW = Date.UTC(2026, 10, 12);

const fact = (decoded: { facts: { label: string; value: string }[] }, label: string) =>
  decoded.facts.find((f) => f.label === label)?.value;

function jwt(header: object, payload: object, signature = 'c2ln'): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part(header)}.${part(payload)}.${signature}`;
}

test('a TID decodes to the same time the reference parser gives, and back', () => {
  const parts = parseTid(POST_TID);
  assert.ok(parts);
  assert.equal(Number(parts.micros), TID.fromStr(POST_TID).timestamp());
  assert.equal(formatTid(parts.micros, parts.clockId), POST_TID);
  assert.equal(parseTid('self'), null);
  // The first character holds the high bit, which must be zero.
  assert.equal(parseTid('zzzzzzzzzzzzz'), null);
});

test('a TID is read as a timestamp identifier', () => {
  const [decoded] = decodeIdentifier(POST_TID, NOW);
  assert.equal(decoded.kind, 'tid');
  assert.match(fact(decoded, 'UTC') ?? '', /^20\d\d-/);
  assert.equal(decoded.notes, undefined);
});

test('thirteen letters that decode far outside atproto’s years are flagged', () => {
  const [decoded] = decodeIdentifier('2222222222222', NOW);
  assert.equal(decoded.kind, 'tid');
  assert.ok(decoded.notes?.length);
});

test('a record CID is CIDv1, dag-cbor, sha2-256', () => {
  const [decoded] = decodeIdentifier(POST_CID, NOW);
  assert.equal(decoded.kind, 'cid');
  assert.equal(fact(decoded, 'Version'), 'CIDv1');
  assert.match(fact(decoded, 'Codec') ?? '', /^dag-cbor/);
  assert.equal(fact(decoded, 'Hash'), 'sha2-256, 256 bits');
  assert.equal(fact(decoded, 'Digest')?.length, 64);
  assert.equal(decoded.notes, undefined);
});

test('a CIDv0 is read, and noted as a form atproto does not use', () => {
  const [decoded] = decodeIdentifier('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG', NOW);
  assert.equal(decoded.kind, 'cid');
  assert.equal(fact(decoded, 'Version'), 'CIDv0');
  assert.ok(decoded.notes?.some((note) => /CIDv0/.test(note)));
});

test('base32 and base58 decode to the bytes they encode', () => {
  assert.deepEqual([...(decodeBase32('mzxw6ytboi') ?? [])], [...Buffer.from('foobar')]);
  assert.equal(decodeBase32('not base32!'), null);
  assert.deepEqual([...(decodeBase58('2NEpo7TZRRrLZSi2U') ?? [])], [...Buffer.from('Hello World!')]);
  // A leading "1" is a leading zero byte.
  assert.deepEqual([...(decodeBase58('11') ?? [])], [0, 0]);
});

test('a signing key from a DID document is a K-256 key', () => {
  const [decoded] = decodeIdentifier(BSKY_KEY, NOW);
  assert.equal(decoded.kind, 'key');
  assert.match(fact(decoded, 'Curve') ?? '', /secp256k1/);
  assert.equal(fact(decoded, 'JWT algorithm'), 'ES256K');
  // A compressed point: 33 bytes.
  assert.equal(fact(decoded, 'Key bytes')?.length, 66);
  const [asDid] = decodeIdentifier(`did:key:${BSKY_KEY}`, NOW);
  assert.equal(asDid.kind, 'key');
});

test('DIDs are read by method', () => {
  const [plc] = decodeIdentifier(BSKY_DID, NOW);
  assert.equal(plc.kind, 'did');
  assert.equal(fact(plc, 'Document'), `https://plc.directory/${BSKY_DID}`);
  assert.equal(plc.notes, undefined);

  const [short] = decodeIdentifier('did:plc:abc', NOW);
  assert.ok(short.notes?.length);

  const [web] = decodeIdentifier('did:web:example.com', NOW);
  assert.equal(fact(web, 'Document'), 'https://example.com/.well-known/did.json');
});

test('an at:// URI is taken apart into its three parts', () => {
  const [decoded] = decodeIdentifier(`at://${BSKY_DID}/app.bsky.feed.post/${POST_TID}`, NOW);
  assert.equal(decoded.kind, 'at-uri');
  assert.deepEqual(
    decoded.parts?.map((part) => [part.label, part.decoded.kind]),
    [
      ['Authority', 'did'],
      ['Collection', 'nsid'],
      ['Record key', 'tid'],
    ],
  );
  assert.equal(fact(decoded, 'Universal link'), `https://aturi.to/${BSKY_DID}/app.bsky.feed.post/${POST_TID}`);
  assert.equal(decoded.notes, undefined);
});

test('an at:// URI on a handle works, with a note that handles change', () => {
  const [decoded] = decodeIdentifier('at://bsky.app/app.bsky.actor.profile/self', NOW);
  assert.deepEqual(
    decoded.parts?.map((part) => part.decoded.kind),
    ['handle', 'nsid', 'record-key'],
  );
  assert.ok(decoded.notes?.some((note) => /handle/i.test(note)));
});

test('an NSID names its authority, and is also offered as a handle', () => {
  const readings = decodeIdentifier('app.bsky.feed.post', NOW);
  assert.deepEqual(
    readings.map((r) => r.kind),
    ['nsid', 'handle'],
  );
  assert.equal(fact(readings[0], 'Authority'), 'feed.bsky.app');
  assert.equal(fact(readings[0], 'Published at'), '_lexicon.feed.bsky.app');
  // Two segments cannot be an NSID.
  assert.deepEqual(decodeIdentifier('bsky.app', NOW).map((r) => r.kind), ['handle']);
});

test('a token is decoded, with its expiry said in words', () => {
  const token = jwt(
    { typ: 'at+jwt', alg: 'ES256K' },
    { iss: 'https://bsky.social', sub: BSKY_DID, scope: 'atproto', exp: NOW / 1000 - 3600 },
  );
  const [decoded] = decodeIdentifier(`Bearer ${token}`, NOW);
  assert.equal(decoded.kind, 'jwt');
  assert.equal(fact(decoded, 'sub'), BSKY_DID);
  assert.ok(decoded.notes?.some((note) => /expired 1 hour ago/.test(note)));
  assert.ok(decoded.notes?.some((note) => /not checked/.test(note)));
  assert.deepEqual(decoded.json?.map((j) => j.label), ['Header', 'Claims']);
});

test('tokens and long input are kept out of the address bar', () => {
  assert.equal(isSensitiveInput(jwt({ alg: 'ES256' }, { sub: 'x' })), true);
  assert.equal(isSensitiveInput(POST_TID), false);
});

test('timestamps convert to a TID', () => {
  const [decoded] = decodeIdentifier('2026-11-12T00:00:00Z', NOW);
  assert.equal(decoded.kind, 'datetime');
  const tid = fact(decoded, 'TID') ?? '';
  assert.equal(Number(parseTid(tid)?.micros), NOW * 1000);
  assert.equal(decodeIdentifier(String(NOW / 1000), NOW)[0].kind, 'datetime');
});

test('text that is nothing in particular decodes to nothing or a bare record key', () => {
  assert.deepEqual(decodeIdentifier('', NOW), []);
  assert.deepEqual(decodeIdentifier('hello world', NOW), []);
  assert.deepEqual(decodeIdentifier('self', NOW).map((r) => r.kind), ['record-key']);
});
