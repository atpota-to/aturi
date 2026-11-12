/**
 * A DAG-CBOR decoder, for the repo archive inspector.
 *
 * Every block in a repository export is DAG-CBOR: the commit, each node of
 * the tree, each record. It is CBOR with the choices taken out, which is what
 * makes it small to read: lengths are always stated up front, map keys are
 * always strings, the only tag is 42 (a link to another block by its CID),
 * and the only float is the 64-bit one.
 *
 * This reads exactly that and refuses the rest by name, rather than guessing
 * at a block that was not written to the format. There is no CBOR library in
 * the tree and the repo adds none, so it is written out here; it is a
 * decoder only, since nothing in the inspector writes blocks.
 *
 * Two things come back in a form JSON cannot hold, because the inspector
 * needs the bytes themselves: a byte string is a `Uint8Array` (a tree key, a
 * signature) and a link is a `CidLink`. `cborToJson` turns a decoded value
 * into the JSON the rest of the site shows records in, `{ "$bytes": … }` and
 * `{ "$link": … }`.
 */

export class CborError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CborError';
  }
}

const BASE32_LOWER = 'abcdefghijklmnopqrstuvwxyz234567';
const BASE58_BTC = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** RFC 4648 base32, lower case, no padding. */
export function encodeBase32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_LOWER[(value >>> bits) & 31];
    }
    // Keep only the bits not yet written, so the shift above never overflows.
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32_LOWER[(value << (5 - bits)) & 31];
  return out;
}

function encodeBase58(bytes: Uint8Array): string {
  let value = BigInt(0);
  for (const byte of bytes) value = (value << BigInt(8)) | BigInt(byte);
  let out = '';
  while (value > BigInt(0)) {
    out = BASE58_BTC[Number(value % BigInt(58))] + out;
    value /= BigInt(58);
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** Bytes as standard base64 without padding, the form `$bytes` takes. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  // In slices, since a spread of a large array overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/=+$/, '');
}

/**
 * A CID as text, from its binary form: base32 with the `b` prefix for a
 * CIDv1, which is how atproto writes them, and bare base58 for a CIDv0.
 */
export function cidToString(bytes: Uint8Array): string {
  if (bytes.length === 34 && bytes[0] === 0x12 && bytes[1] === 0x20) return encodeBase58(bytes);
  return `b${encodeBase32(bytes)}`;
}

/** A link to another block. The text form is worked out once, on first use. */
export class CidLink {
  readonly bytes: Uint8Array;
  private text: string | null = null;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  toString(): string {
    if (this.text === null) this.text = cidToString(this.bytes);
    return this.text;
  }
}

export type CborValue =
  | null
  | boolean
  | number
  /** An integer past 2^53 - 1, which a JavaScript number cannot hold exactly. */
  | bigint
  | string
  | Uint8Array
  | CidLink
  | CborValue[]
  | { [key: string]: CborValue };

/** Nesting past this is refused: no record needs it, and a hostile block could use it to exhaust the stack. */
const MAX_DEPTH = 256;

const textDecoder = new TextDecoder('utf-8');

type Cursor = { bytes: Uint8Array; view: DataView; at: number };

function need(cursor: Cursor, count: number) {
  if (cursor.at + count > cursor.bytes.length) {
    throw new CborError('The data ends in the middle of a value');
  }
}

/**
 * The number that follows a type byte: in the byte itself when it is under
 * 24, otherwise in the next 1, 2, 4 or 8 bytes. Returned as a bigint only
 * when it is too large to be a safe integer.
 */
function readArgument(cursor: Cursor, info: number): number | bigint {
  if (info < 24) return info;
  if (info === 24) {
    need(cursor, 1);
    return cursor.bytes[cursor.at++];
  }
  if (info === 25) {
    need(cursor, 2);
    const value = cursor.view.getUint16(cursor.at);
    cursor.at += 2;
    return value;
  }
  if (info === 26) {
    need(cursor, 4);
    const value = cursor.view.getUint32(cursor.at);
    cursor.at += 4;
    return value;
  }
  if (info === 27) {
    need(cursor, 8);
    const value = cursor.view.getBigUint64(cursor.at);
    cursor.at += 8;
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  }
  if (info === 31) throw new CborError('Indefinite lengths are not allowed in DAG-CBOR');
  throw new CborError(`Reserved length encoding (${info})`);
}

/** A length, which unlike an integer value can never sensibly be a bigint. */
function readLength(cursor: Cursor, info: number): number {
  const length = readArgument(cursor, info);
  if (typeof length === 'bigint') throw new CborError('A length is larger than any block could be');
  return length;
}

function readText(cursor: Cursor, length: number): string {
  need(cursor, length);
  const start = cursor.at;
  cursor.at += length;
  // Map keys and record keys are short ASCII, and there are a great many of
  // them; building those directly is several times quicker than a decoder call.
  if (length < 32) {
    let ascii = true;
    let out = '';
    for (let i = start; i < start + length; i++) {
      const byte = cursor.bytes[i];
      if (byte > 0x7f) {
        ascii = false;
        break;
      }
      out += String.fromCharCode(byte);
    }
    if (ascii) return out;
  }
  return textDecoder.decode(cursor.bytes.subarray(start, start + length));
}

function readValue(cursor: Cursor, depth: number): CborValue {
  if (depth > MAX_DEPTH) throw new CborError('The data is nested too deeply');
  need(cursor, 1);
  const initial = cursor.bytes[cursor.at++];
  const major = initial >> 5;
  const info = initial & 0x1f;

  switch (major) {
    case 0:
      return readArgument(cursor, info);
    case 1: {
      // A negative integer is stored as -1 minus the number.
      const value = readArgument(cursor, info);
      if (typeof value === 'bigint') return BigInt(-1) - value;
      return value === Number.MAX_SAFE_INTEGER ? BigInt(-1) - BigInt(value) : -1 - value;
    }
    case 2: {
      const length = readLength(cursor, info);
      need(cursor, length);
      const out = cursor.bytes.subarray(cursor.at, cursor.at + length);
      cursor.at += length;
      return out;
    }
    case 3:
      return readText(cursor, readLength(cursor, info));
    case 4: {
      const length = readLength(cursor, info);
      // Every item takes at least a byte, so a count past what is left is a lie.
      need(cursor, length);
      const out: CborValue[] = new Array(length);
      for (let i = 0; i < length; i++) out[i] = readValue(cursor, depth + 1);
      return out;
    }
    case 5: {
      const length = readLength(cursor, info);
      need(cursor, length);
      const out: { [key: string]: CborValue } = {};
      for (let i = 0; i < length; i++) {
        need(cursor, 1);
        const keyInitial = cursor.bytes[cursor.at++];
        if (keyInitial >> 5 !== 3) throw new CborError('Map keys must be strings in DAG-CBOR');
        const key = readText(cursor, readLength(cursor, keyInitial & 0x1f));
        const value = readValue(cursor, depth + 1);
        // Defined rather than assigned, so a key named __proto__ is data like any other.
        Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
      }
      return out;
    }
    case 6: {
      const tag = readArgument(cursor, info);
      if (tag !== 42) throw new CborError(`Tag ${tag} is not allowed in DAG-CBOR; the only tag is 42, a link`);
      const inner = readValue(cursor, depth + 1);
      // A link is a byte string: a zero byte, then the CID.
      if (!(inner instanceof Uint8Array) || inner.length < 2 || inner[0] !== 0x00) {
        throw new CborError('A link (tag 42) must hold a CID as bytes after a zero byte');
      }
      return new CidLink(inner.subarray(1));
    }
    default: {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 27) {
        need(cursor, 8);
        const value = cursor.view.getFloat64(cursor.at);
        cursor.at += 8;
        return value;
      }
      if (info === 25 || info === 26) throw new CborError('Only 64-bit floats are allowed in DAG-CBOR');
      if (info === 23) throw new CborError('"undefined" is not allowed in DAG-CBOR');
      if (info === 31) throw new CborError('Indefinite lengths are not allowed in DAG-CBOR');
      throw new CborError(`Simple value ${info} is not allowed in DAG-CBOR`);
    }
  }
}

function cursorOver(bytes: Uint8Array, at: number): Cursor {
  return { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), at };
}

/**
 * Decode one value starting at `offset` and say where it ended, for data
 * that is followed by more: a CAR header before its blocks.
 */
export function decodeCborAt(bytes: Uint8Array, offset = 0): { value: CborValue; next: number } {
  const cursor = cursorOver(bytes, offset);
  const value = readValue(cursor, 0);
  return { value, next: cursor.at };
}

/** Decode a block that holds exactly one value. Bytes left over are an error. */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const { value, next } = decodeCborAt(bytes, 0);
  if (next !== bytes.length) throw new CborError('There is more data after the end of the value');
  return value;
}

/**
 * A decoded value as the JSON atproto uses for records: a link becomes
 * `{ "$link": "<CID>" }` and bytes become `{ "$bytes": "<base64>" }`.
 *
 * An integer too large for a JavaScript number becomes its digits in a
 * string, since JSON written from here has to parse back exactly. The data
 * model allows 64-bit integers; in practice records do not hold them.
 */
export function cborToJson(value: CborValue): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? value.toString() : value;
  }
  if (value instanceof Uint8Array) return { $bytes: encodeBase64(value) };
  if (value instanceof CidLink) return { $link: value.toString() };
  if (Array.isArray(value)) return value.map(cborToJson);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    Object.defineProperty(out, key, {
      value: cborToJson(value[key]),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}
