import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CborError,
  CidLink,
  cborToJson,
  cidToString,
  decodeCbor,
  decodeCborAt,
  encodeBase32,
  encodeBase64,
} from '@/lib/tools/cbor';
import { decodeBase32 } from '@/lib/tools/decode';
import { encode } from './carFixtures';

const hex = (text: string) => Uint8Array.from(text.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? []);
const decodeHex = (text: string) => decodeCbor(hex(text));

// A real record CID, read from the network when this was written.
const POST_CID = 'bafyreibu7nij5fidh2dx7ljpypstqetii3q7333it52w3l3uekrpbuj5rq';

test('integers decode at every width (RFC 8949, appendix A)', () => {
  assert.equal(decodeHex('00'), 0);
  assert.equal(decodeHex('17'), 23);
  assert.equal(decodeHex('1818'), 24);
  assert.equal(decodeHex('1903e8'), 1000);
  assert.equal(decodeHex('1a000f4240'), 1_000_000);
  assert.equal(decodeHex('1b000000e8d4a51000'), 1_000_000_000_000);
  assert.equal(decodeHex('20'), -1);
  assert.equal(decodeHex('3863'), -100);
  assert.equal(decodeHex('3903e7'), -1000);
});

test('integers past 2^53 come back as BigInt, and as digits in JSON', () => {
  assert.equal(decodeHex('1b001fffffffffffff'), Number.MAX_SAFE_INTEGER);
  assert.equal(decodeHex('1bffffffffffffffff'), BigInt('18446744073709551615'));
  assert.equal(decodeHex('3bffffffffffffffff'), BigInt('-18446744073709551616'));
  assert.equal(cborToJson(decodeHex('1bffffffffffffffff')), '18446744073709551615');
});

test('strings, including ones that are not ASCII', () => {
  assert.equal(decodeHex('60'), '');
  assert.equal(decodeHex('6161'), 'a');
  assert.equal(decodeHex('62c3bc'), 'ü');
  assert.equal(decodeHex('64f0908591'), '𐅑');
  const long = 'A longer string with an emoji 🌿 in it, well past the short-string path.';
  assert.equal(decodeCbor(encode(long)), long);
});

test('byte strings stay bytes, and become $bytes in JSON', () => {
  assert.deepEqual(decodeHex('40'), new Uint8Array(0));
  assert.deepEqual(decodeHex('4401020304'), Uint8Array.from([1, 2, 3, 4]));
  assert.deepEqual(cborToJson(decodeHex('4401020304')), { $bytes: 'AQIDBA' });
  assert.equal(encodeBase64(Uint8Array.from([0xff, 0xfe])), '//4');
});

test('arrays, maps, and the three simple values', () => {
  assert.deepEqual(decodeHex('80'), []);
  assert.deepEqual(decodeHex('83010203'), [1, 2, 3]);
  assert.deepEqual(decodeHex('a0'), {});
  assert.deepEqual(decodeHex('a26161016162820203'), { a: 1, b: [2, 3] });
  assert.equal(decodeHex('f4'), false);
  assert.equal(decodeHex('f5'), true);
  assert.equal(decodeHex('f6'), null);
});

test('64-bit floats decode; the shorter ones are refused', () => {
  assert.equal(decodeHex('fb3ff199999999999a'), 1.1);
  assert.throws(() => decodeHex('f93c00'), /64-bit floats/);
  assert.throws(() => decodeHex('fa47c35000'), /64-bit floats/);
});

test('tag 42 is a link, and becomes $link in JSON', () => {
  const cid = decodeBase32(POST_CID.slice(1)) as Uint8Array;
  const link = decodeCbor(encode(new CidLink(cid)));
  assert.ok(link instanceof CidLink);
  assert.equal(link.toString(), POST_CID);
  assert.deepEqual(cborToJson({ ref: link }), { ref: { $link: POST_CID } });
});

test('CIDs print as base32 for v1 and base58 for v0', () => {
  const cid = decodeBase32(POST_CID.slice(1)) as Uint8Array;
  assert.equal(cidToString(cid), POST_CID);
  assert.equal(`b${encodeBase32(cid)}`, POST_CID);
  // A CIDv0 is a bare sha2-256 multihash.
  const v0 = Uint8Array.from([0x12, 0x20, ...new Uint8Array(32).fill(1)]);
  assert.match(cidToString(v0), /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/);
});

test('what DAG-CBOR does not allow is refused by name', () => {
  assert.throws(() => decodeHex('5f4101ff'), /Indefinite lengths/);
  assert.throws(() => decodeHex('9f01ff'), /Indefinite lengths/);
  assert.throws(() => decodeHex('bf616101ff'), /Indefinite lengths/);
  assert.throws(() => decodeHex('f7'), /undefined/);
  assert.throws(() => decodeHex('c074323031332d30332d32315432303a30343a30305a'), /Tag 0 is not allowed/);
  assert.throws(() => decodeHex('a10102'), /Map keys must be strings/);
  // Tag 42 around something that is not a CID behind a zero byte.
  assert.throws(() => decodeHex('d82a6161'), /link \(tag 42\)/);
  assert.throws(() => decodeHex('d82a420171'), /link \(tag 42\)/);
});

test('truncated and overlong data are errors, not partial values', () => {
  assert.throws(() => decodeHex('1903'), CborError);
  assert.throws(() => decodeHex('6461'), /ends in the middle/);
  assert.throws(() => decodeHex('8301'), /ends in the middle/);
  assert.throws(() => decodeHex(''), /ends in the middle/);
  // A count far past what the data could hold.
  assert.throws(() => decodeHex('9a00ffffff'), /ends in the middle/);
  assert.throws(() => decodeHex('0000'), /more data after/);
});

test('nesting is bounded', () => {
  const deep = hex('81'.repeat(400) + '00');
  assert.throws(() => decodeCbor(deep), /nested too deeply/);
  assert.deepEqual(decodeCbor(hex('81'.repeat(10) + '00')), [[[[[[[[[[0]]]]]]]]]]);
});

test('decodeCborAt reads one value and says where it ended', () => {
  const { value, next } = decodeCborAt(hex('ff6161f6'), 1);
  assert.equal(value, 'a');
  assert.equal(next, 3);
});

test('a key named __proto__ is data, not a prototype', () => {
  const decoded = decodeCbor(encode({ ['__proto__']: { polluted: true } } as never)) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  assert.deepEqual(Object.keys(decoded), ['__proto__']);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  const json = cborToJson(decoded as never) as Record<string, unknown>;
  assert.deepEqual(Object.keys(json), ['__proto__']);
});

test('a record decodes to the JSON the PDS would give', () => {
  const cid = new CidLink(decodeBase32(POST_CID.slice(1)) as Uint8Array);
  const record = {
    $type: 'app.bsky.feed.post',
    text: 'hello',
    langs: ['en'],
    reply: null,
    embed: { image: { $type: 'blob', ref: cid, mimeType: 'image/png', size: 1234 } },
  };
  assert.deepEqual(cborToJson(decodeCbor(encode(record))), {
    $type: 'app.bsky.feed.post',
    text: 'hello',
    langs: ['en'],
    reply: null,
    embed: { image: { $type: 'blob', ref: { $link: POST_CID }, mimeType: 'image/png', size: 1234 } },
  });
});
