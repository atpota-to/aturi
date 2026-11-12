/**
 * A CARv1 reader, for the repo archive inspector.
 *
 * A CAR file is a header and then blocks, each prefixed by its length:
 *
 *   varint | header      a DAG-CBOR map, { version: 1, roots: [link, …] }
 *   varint | CID | data  one block, the varint counting the CID and the data
 *   …
 *
 * `com.atproto.sync.getRepo` returns one, with the repository's latest commit
 * as its first root. Nothing here knows about repositories: it reads blocks
 * and hands them back by CID. carRepo.ts makes a repository of them.
 *
 * The file is read in place. Each block is a view over the one buffer the
 * file arrived in, so opening a 100 MB export does not copy 100 MB.
 */

import { CborError, CidLink, cidToString, decodeCborAt } from './cbor';
import { decodeBase32, decodeBase58 } from './decode';

export class CarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CarError';
  }
}

export type CarFile = {
  /** The header's roots, as CID text. For a repository, the first is its commit. */
  roots: string[];
  /** Every distinct block, by CID text. */
  blocks: Map<string, Uint8Array>;
  /** Blocks that appeared again after their first copy. The format allows it. */
  duplicates: number;
  /** The size of the whole file in bytes. */
  size: number;
};

/**
 * An unsigned LEB128 varint. Multiplied rather than shifted, since a block
 * length can pass 2^31 on paper and a shift would wrap it negative.
 */
export function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let scale = 1;
  for (let i = offset; i < bytes.length && i < offset + 8; i++) {
    const byte = bytes[i];
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return { value, next: i + 1 };
    scale *= 128;
  }
  throw new CarError(offset >= bytes.length ? 'The file ends where a length should be' : 'A length in the file is malformed');
}

export type ParsedCid = {
  version: 0 | 1;
  /** The multicodec of what the block holds: 0x71 dag-cbor, 0x55 raw. */
  codec: number;
  /** The multihash code: 0x12 is sha2-256. */
  hash: number;
  digest: Uint8Array;
  /** Where the CID ends. */
  next: number;
};

/**
 * Read a binary CID starting at `offset`. A CIDv0 is a bare sha2-256
 * multihash (0x12 0x20 and 32 bytes), which is how it is told apart: no
 * CIDv1 starts with 0x12.
 */
export function parseCid(bytes: Uint8Array, offset = 0): ParsedCid {
  if (bytes[offset] === 0x12 && bytes[offset + 1] === 0x20) {
    const next = offset + 34;
    if (next > bytes.length) throw new CarError('A CID runs past the end of the data');
    return { version: 0, codec: 0x70, hash: 0x12, digest: bytes.subarray(offset + 2, next), next };
  }
  const version = readVarint(bytes, offset);
  if (version.value !== 1) throw new CarError(`A CID has version ${version.value}; only 0 and 1 exist`);
  const codec = readVarint(bytes, version.next);
  const hash = readVarint(bytes, codec.next);
  const length = readVarint(bytes, hash.next);
  const next = length.next + length.value;
  if (next > bytes.length) throw new CarError('A CID runs past the end of the data');
  return { version: 1, codec: codec.value, hash: hash.value, digest: bytes.subarray(length.next, next), next };
}

/** The bytes of a CID from its text form, or null when the text is not one. */
export function cidFromString(text: string): Uint8Array | null {
  if (text.startsWith('b')) return decodeBase32(text.slice(1));
  if (text.startsWith('Qm')) return decodeBase58(text);
  return null;
}

/**
 * A CAR file part-way through being read. `step` reads up to `budget` more
 * blocks and says whether the end was reached, so a caller with a page to
 * keep alive can read a large file a slice at a time (carRepo.ts,
 * `openArchive`). `readCar` is the same reader run straight through.
 */
export type CarReader = {
  /** Read up to `budget` blocks. True once the whole file has been read. */
  step(budget: number): boolean;
  /** How far into the file the reader is, in bytes. */
  offset(): number;
  file: CarFile;
};

export function createCarReader(bytes: Uint8Array): CarReader {
  if (bytes.length === 0) throw new CarError('The file is empty');

  let header;
  let offset: number;
  try {
    const length = readVarint(bytes, 0);
    if (length.value === 0 || length.next + length.value > bytes.length) {
      throw new CarError('the header is longer than the file');
    }
    header = decodeCborAt(bytes.subarray(length.next, length.next + length.value)).value;
    offset = length.next + length.value;
  } catch (err) {
    // A file that is not a CAR at all fails here, on its first bytes.
    const detail = err instanceof CarError || err instanceof CborError ? ` (${err.message})` : '';
    throw new CarError(`This does not look like a CAR file: its header could not be read${detail}`);
  }

  if (header === null || typeof header !== 'object' || Array.isArray(header) || header instanceof Uint8Array || header instanceof CidLink) {
    throw new CarError('This does not look like a CAR file: its header is not a map');
  }
  if (header.version !== 1) {
    throw new CarError(
      header.version === 2
        ? 'This is a CARv2 file. Repository exports are CARv1.'
        : 'This does not look like a CAR file: its header names no version',
    );
  }
  const roots = Array.isArray(header.roots)
    ? header.roots.filter((root): root is CidLink => root instanceof CidLink).map((root) => root.toString())
    : [];

  const file: CarFile = { roots, blocks: new Map(), duplicates: 0, size: bytes.length };

  return {
    file,
    offset: () => offset,
    step(budget) {
      for (let read = 0; read < budget && offset < bytes.length; read++) {
        const length = readVarint(bytes, offset);
        const end = length.next + length.value;
        if (length.value === 0) throw new CarError('The file holds an empty block where a CID should be');
        if (end > bytes.length) {
          throw new CarError('The file ends in the middle of a block. The download may have been cut short.');
        }
        const section = bytes.subarray(length.next, end);
        const cid = parseCid(section, 0);
        const key = cidToString(section.subarray(0, cid.next));
        if (file.blocks.has(key)) file.duplicates++;
        else file.blocks.set(key, section.subarray(cid.next));
        offset = end;
      }
      return offset >= bytes.length;
    },
  };
}

export function readCar(bytes: Uint8Array): CarFile {
  const reader = createCarReader(bytes);
  reader.step(Infinity);
  return reader.file;
}

export type HashCheck = {
  /** Blocks whose sha2-256 was recomputed. */
  checked: number;
  /** Blocks addressed by another hash, which this cannot recompute. */
  skipped: number;
  /** CIDs whose data does not hash to what the CID says. */
  mismatched: string[];
};

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Recompute every block's hash and compare it with its CID.
 *
 * This shows the file is internally consistent: each block is the data its
 * address says it is. It does not show who wrote it. That takes the commit's
 * signature, which needs a curve the browser's own crypto does not offer.
 *
 * Runs in batches and reports as it goes, so a large archive can show
 * progress and be stopped.
 */
export async function verifyBlockHashes(
  car: CarFile,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<HashCheck> {
  const result: HashCheck = { checked: 0, skipped: 0, mismatched: [] };
  const entries = [...car.blocks.entries()];
  const BATCH = 256;
  for (let start = 0; start < entries.length; start += BATCH) {
    if (options.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    await Promise.all(
      entries.slice(start, start + BATCH).map(async ([text, data]) => {
        const cidBytes = cidFromString(text);
        const cid = cidBytes ? parseCid(cidBytes) : null;
        if (!cid || cid.hash !== 0x12) {
          result.skipped++;
          return;
        }
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
        result.checked++;
        if (!sameBytes(digest, cid.digest)) result.mismatched.push(text);
      }),
    );
    options.onProgress?.(Math.min(start + BATCH, entries.length), entries.length);
  }
  return result;
}
