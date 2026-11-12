import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CarError,
  cidFromString,
  createCarReader,
  parseCid,
  readCar,
  readVarint,
  verifyBlockHashes,
} from '@/lib/tools/car';
import { CidLink } from '@/lib/tools/cbor';
import { block, carFile, cidFor, encode, sampleRepo, sha256, type Block } from './carFixtures';

test('varints of one and several bytes', () => {
  assert.deepEqual(readVarint(Uint8Array.from([0x05]), 0), { value: 5, next: 1 });
  assert.deepEqual(readVarint(Uint8Array.from([0xff, 0xac, 0x02]), 1), { value: 300, next: 3 });
  // Past 2^31, where a shift would have wrapped.
  assert.deepEqual(readVarint(Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x10]), 0), { value: 2 ** 32, next: 5 });
  assert.throws(() => readVarint(Uint8Array.from([0x80]), 0), CarError);
  assert.throws(() => readVarint(new Uint8Array(0), 0), /ends where a length/);
});

test('a CID is parsed into its parts, v1 and v0', () => {
  const data = encode({ hello: 'world' });
  const cid = cidFor(data);
  const parsed = parseCid(cid.bytes);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.codec, 0x71);
  assert.equal(parsed.hash, 0x12);
  assert.deepEqual(parsed.digest, sha256(data));
  assert.equal(parsed.next, 36);

  const v0 = parseCid(Uint8Array.from([0x12, 0x20, ...sha256(data)]));
  assert.equal(v0.version, 0);
  assert.equal(v0.next, 34);
  assert.throws(() => parseCid(Uint8Array.from([0x02, 0x71, 0x12, 0x20])), /version 2/);
  assert.throws(() => parseCid(Uint8Array.from([0x01, 0x71, 0x12, 0x20, 1, 2])), /runs past the end/);
});

test('CID text converts back to the bytes it came from', () => {
  const cid = cidFor(encode('x'));
  assert.deepEqual(cidFromString(cid.toString()), cid.bytes);
  assert.equal(cidFromString('not a cid'), null);
});

test('a CAR file gives back its roots and every block', () => {
  const { bytes, blocks, head } = sampleRepo();
  const car = readCar(bytes);
  assert.deepEqual(car.roots, [head.cid.toString()]);
  assert.equal(car.blocks.size, blocks.length);
  assert.equal(car.duplicates, 0);
  assert.equal(car.size, bytes.length);
  for (const { cid, data } of blocks) {
    assert.deepEqual(car.blocks.get(cid.toString()), data);
  }
});

test('blocks are views over the file, not copies', () => {
  const { bytes, head } = sampleRepo();
  const car = readCar(bytes);
  assert.equal(car.blocks.get(head.cid.toString())?.buffer, bytes.buffer);
});

test('a repeated block is counted once and noted', () => {
  const a = block({ n: 1 });
  const b = block({ n: 2 });
  const car = readCar(carFile([a.cid], [a, b, a, a]));
  assert.equal(car.blocks.size, 2);
  assert.equal(car.duplicates, 2);
});

test('a CIDv0 block is tolerated', () => {
  const data = encode({ old: true });
  const v0: Block = { cid: new CidLink(Uint8Array.from([0x12, 0x20, ...sha256(data)])), data };
  const car = readCar(carFile([], [v0]));
  assert.equal(car.blocks.size, 1);
  assert.match([...car.blocks.keys()][0], /^Qm/);
  assert.deepEqual([...car.blocks.values()][0], data);
});

test('reading in steps gives the same file as reading straight through', () => {
  const { bytes } = sampleRepo();
  const reader = createCarReader(bytes);
  let steps = 0;
  while (!reader.step(2)) steps++;
  assert.ok(steps >= 3);
  assert.equal(reader.offset(), bytes.length);
  assert.deepEqual([...reader.file.blocks.keys()], [...readCar(bytes).blocks.keys()]);
});

test('files that are not CARv1 are refused in words', () => {
  assert.throws(() => readCar(new Uint8Array(0)), /empty/);
  assert.throws(() => readCar(new TextEncoder().encode('{"records":[]}')), /does not look like a CAR file/);
  assert.throws(() => readCar(new TextEncoder().encode('<!doctype html><html>')), /does not look like a CAR file/);
  assert.throws(() => readCar(carFile([], [], 2)), /CARv2/);
  // A header that is valid CBOR but not a map.
  const notMap = encode([1, 2, 3]);
  assert.throws(() => readCar(Uint8Array.from([notMap.length, ...notMap])), /not a map/);
});

test('a file cut short says so', () => {
  const { bytes } = sampleRepo();
  assert.throws(() => readCar(bytes.subarray(0, bytes.length - 10)), /cut short/);
});

test('block hashes are recomputed and compared with their CIDs', async () => {
  const { bytes, blocks } = sampleRepo();
  const car = readCar(bytes);
  const progress: number[] = [];
  const ok = await verifyBlockHashes(car, { onProgress: (done) => progress.push(done) });
  assert.deepEqual(ok, { checked: blocks.length, skipped: 0, mismatched: [] });
  assert.deepEqual(progress, [blocks.length]);

  // Flip a byte inside one block's data: its CID no longer matches.
  const tampered = bytes.slice();
  tampered[tampered.length - 1] ^= 0xff;
  const bad = await verifyBlockHashes(readCar(tampered));
  assert.equal(bad.mismatched.length, 1);
  assert.equal(bad.mismatched[0], blocks[blocks.length - 1].cid.toString());
});

test('a block addressed by another hash is skipped, not failed', async () => {
  const data = encode({ n: 1 });
  // 0x13 is sha2-512; only its length is honoured here.
  const other: Block = { cid: new CidLink(Uint8Array.from([0x01, 0x71, 0x13, 0x04, 1, 2, 3, 4])), data };
  const result = await verifyBlockHashes(readCar(carFile([], [other])));
  assert.deepEqual(result, { checked: 0, skipped: 1, mismatched: [] });
});

test('checking hashes can be stopped', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(verifyBlockHashes(readCar(sampleRepo().bytes), { signal: controller.signal }), /Stopped/);
});
