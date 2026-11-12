/**
 * Builders for the CBOR, CAR and repository tests: a small DAG-CBOR encoder
 * and the few lines it takes to wrap blocks into a CAR file. Test-only. The
 * tool itself never writes either format, so nothing here ships.
 */

import { createHash } from 'node:crypto';
import { CidLink, cidToString } from '@/lib/tools/cbor';

function head(major: number, value: number): number[] {
  const m = major << 5;
  if (value < 24) return [m | value];
  if (value < 0x100) return [m | 24, value];
  if (value < 0x10000) return [m | 25, value >> 8, value & 0xff];
  return [m | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

export type Encodable =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | CidLink
  | Encodable[]
  | { [key: string]: Encodable };

/** Encode a value as DAG-CBOR. Map keys are written in the order given. */
export function encode(value: Encodable): Uint8Array {
  const out: number[] = [];
  const write = (v: Encodable) => {
    if (v === null) out.push(0xf6);
    else if (v === true) out.push(0xf5);
    else if (v === false) out.push(0xf4);
    else if (typeof v === 'number') {
      if (!Number.isInteger(v)) {
        const buffer = new DataView(new ArrayBuffer(8));
        buffer.setFloat64(0, v);
        out.push(0xfb, ...new Uint8Array(buffer.buffer));
      } else if (v >= 0) out.push(...head(0, v));
      else out.push(...head(1, -1 - v));
    } else if (typeof v === 'string') {
      const bytes = new TextEncoder().encode(v);
      out.push(...head(3, bytes.length), ...bytes);
    } else if (v instanceof Uint8Array) {
      out.push(...head(2, v.length), ...v);
    } else if (v instanceof CidLink) {
      out.push(0xd8, 42, ...head(2, v.bytes.length + 1), 0x00, ...v.bytes);
    } else if (Array.isArray(v)) {
      out.push(...head(4, v.length));
      v.forEach(write);
    } else {
      const keys = Object.keys(v);
      out.push(...head(5, keys.length));
      for (const key of keys) {
        write(key);
        write(v[key]);
      }
    }
  };
  write(value);
  return Uint8Array.from(out);
}

export function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

/** The CIDv1 of a block: version 1, the codec, sha2-256, 32 bytes of digest. */
export function cidFor(data: Uint8Array, codec = 0x71): CidLink {
  return new CidLink(Uint8Array.from([0x01, codec, 0x12, 0x20, ...sha256(data)]));
}

export type Block = { cid: CidLink; data: Uint8Array };

/** A block from a value, addressed by its own hash. */
export function block(value: Encodable): Block {
  const data = encode(value);
  return { cid: cidFor(data), data };
}

function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
}

/** A CARv1 file: the header, then each block behind its length. */
export function carFile(roots: CidLink[], blocks: Block[], version = 1): Uint8Array {
  const header = encode({ version, roots });
  const out: number[] = [...varint(header.length), ...header];
  for (const { cid, data } of blocks) {
    out.push(...varint(cid.bytes.length + data.length), ...cid.bytes, ...data);
  }
  return Uint8Array.from(out);
}

const text = (value: string) => new TextEncoder().encode(value);

export type TreeEntry = { p: number; k: string; v: CidLink; t?: CidLink | null };

/** One tree node, with keys given already cut to their suffix. */
export function node(left: CidLink | null, entries: TreeEntry[]): Block {
  return block({
    l: left,
    e: entries.map((entry) => ({ p: entry.p, k: text(entry.k), v: entry.v, t: entry.t ?? null })),
  });
}

export function commit(did: string, data: CidLink, extra: { [key: string]: Encodable } = {}): Block {
  return block({
    did,
    version: 3,
    data,
    rev: '3n22yg6lg2k2f',
    prev: null,
    sig: new Uint8Array(64).fill(7),
    ...extra,
  });
}

export const DID = 'did:plc:z72i7hdynmk6r22z27h6tvur';

/**
 * A small, well-formed repository: five records in two collections, in a
 * tree of three nodes.
 *
 *            top: [ …post/3aaa ]  → right
 *   left: [ …like/3aaa, …like/3bbb ]      right: [ …post/3bbb, …post/3ccc ]
 */
export function sampleRepo() {
  const records = {
    like1: block({ $type: 'app.bsky.feed.like', createdAt: '2026-01-01T00:00:00.000Z' }),
    like2: block({ $type: 'app.bsky.feed.like', createdAt: '2026-01-02T00:00:00.000Z' }),
    post1: block({ $type: 'app.bsky.feed.post', text: 'one', createdAt: '2026-01-03T00:00:00.000Z' }),
    post2: block({ $type: 'app.bsky.feed.post', text: 'two', createdAt: '2026-01-04T00:00:00.000Z' }),
    post3: block({ $type: 'app.bsky.feed.post', text: 'three', createdAt: '2026-01-05T00:00:00.000Z' }),
  };
  const left = node(null, [
    { p: 0, k: 'app.bsky.feed.like/3aaa', v: records.like1.cid },
    // Shares "app.bsky.feed.like/3" with the key before it.
    { p: 20, k: 'bbb', v: records.like2.cid },
  ]);
  const right = node(null, [
    { p: 0, k: 'app.bsky.feed.post/3bbb', v: records.post2.cid },
    { p: 20, k: 'ccc', v: records.post3.cid },
  ]);
  const top = node(left.cid, [{ p: 0, k: 'app.bsky.feed.post/3aaa', v: records.post1.cid, t: right.cid }]);
  const head = commit(DID, top.cid);
  const blocks = [head, top, left, right, ...Object.values(records)];
  return { records, left, right, top, head, blocks, bytes: carFile([head.cid], blocks) };
}

export { cidToString };
