/**
 * The identifier decoder: take apart the strings atproto is made of and say
 * what each part means.
 *
 * Everything here is pure and runs in the browser. Nothing typed into the
 * decoder is sent anywhere, which matters because one of the things it reads
 * is a token.
 *
 * `decodeIdentifier` returns every reading that fits, most specific first. A
 * string can honestly be two things (`app.bsky.feed.post` is an NSID, and
 * also a syntactically valid handle), and saying both is more useful than
 * guessing.
 */

import { handleSyntaxProblem } from './handle';

export type DecodedKind =
  | 'tid'
  | 'cid'
  | 'at-uri'
  | 'did'
  | 'key'
  | 'nsid'
  | 'jwt'
  | 'handle'
  | 'datetime'
  | 'record-key';

export type DecodedFact = {
  label: string;
  value: string;
  /** Worth a copy button. */
  copy?: boolean;
  /** Prose rather than an identifier: set in the sans face. */
  plain?: boolean;
};

export type DecodedLink = {
  label: string;
  /** A path on this site when it starts with `/`, otherwise an outside URL. */
  href: string;
};

export type Decoded = {
  kind: DecodedKind;
  /** What it is, e.g. "Timestamp identifier (TID)". */
  title: string;
  /** One sentence on what that means. */
  summary: string;
  facts: DecodedFact[];
  /** Decoded JSON to show whole: a token's header and claims. */
  json?: { label: string; value: unknown }[];
  /** Things worth a second look: an expired token, a hash atproto does not use. */
  notes?: string[];
  links?: DecodedLink[];
  /** The parts of a compound identifier, each decoded in turn. */
  parts?: { label: string; decoded: Decoded }[];
};

/* -------------------------------------------------------------------------- *
 * Encodings
 * -------------------------------------------------------------------------- */

const BASE32_SORTABLE = '234567abcdefghijklmnopqrstuvwxyz';
const BASE32_LOWER = 'abcdefghijklmnopqrstuvwxyz234567';
const BASE58_BTC = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** RFC 4648 base32, lower case, no padding: the `b` multibase CIDs use. */
export function decodeBase32(text: string): Uint8Array | null {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    const index = BASE32_LOWER.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Bitcoin's base58: the `z` multibase keys use, and CIDv0. */
export function decodeBase58(text: string): Uint8Array | null {
  let value = BigInt(0);
  for (const char of text) {
    const index = BASE58_BTC.indexOf(char);
    if (index < 0) return null;
    value = value * BigInt(58) + BigInt(index);
  }
  const bytes: number[] = [];
  while (value > BigInt(0)) {
    bytes.unshift(Number(value & BigInt(0xff)));
    value >>= BigInt(8);
  }
  // Each leading "1" is a leading zero byte, which the number itself drops.
  for (const char of text) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function decodeBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** An unsigned LEB128 varint, as multiformats prefixes are written. */
function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  for (let i = offset; i < bytes.length && shift <= 28; i++) {
    value |= (bytes[i] & 0x7f) << shift;
    if ((bytes[i] & 0x80) === 0) return { value, next: i + 1 };
    shift += 7;
  }
  return null;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* -------------------------------------------------------------------------- *
 * Time
 * -------------------------------------------------------------------------- */

function relativeTime(ms: number, now: number): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [365 * 86_400_000, 'year'],
    [30 * 86_400_000, 'month'],
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1000, 'second'],
  ];
  for (const [size, name] of units) {
    if (abs >= size) {
      const n = Math.floor(abs / size);
      const span = `${n} ${name}${n === 1 ? '' : 's'}`;
      return diff < 0 ? `${span} ago` : `in ${span}`;
    }
  }
  return 'now';
}

function timeFacts(ms: number, now: number): DecodedFact[] {
  const date = new Date(ms);
  return [
    { label: 'UTC', value: date.toISOString(), copy: true },
    { label: 'Your time', value: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' }), plain: true },
    { label: 'Relative', value: relativeTime(ms, now), plain: true },
  ];
}

/* -------------------------------------------------------------------------- *
 * TID
 * -------------------------------------------------------------------------- */

const TID_REGEXP = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

export type TidParts = { micros: bigint; clockId: number };

/**
 * A TID is a 64-bit number in 13 base32-sortable characters: a zero bit,
 * 53 bits of microseconds since 1970, and a 10-bit clock id that keeps two
 * writers in the same microsecond apart.
 */
export function parseTid(tid: string): TidParts | null {
  if (!TID_REGEXP.test(tid)) return null;
  let value = BigInt(0);
  for (const char of tid) value = (value << BigInt(5)) | BigInt(BASE32_SORTABLE.indexOf(char));
  return { micros: value >> BigInt(10), clockId: Number(value & BigInt(0x3ff)) };
}

export function formatTid(micros: bigint, clockId = 0): string {
  let value = (micros << BigInt(10)) | BigInt(clockId & 0x3ff);
  let out = '';
  for (let i = 0; i < 13; i++) {
    out = BASE32_SORTABLE[Number(value & BigInt(31))] + out;
    value >>= BigInt(5);
  }
  return out;
}

function decodeTid(tid: string, now: number): Decoded | null {
  const parts = parseTid(tid);
  if (!parts) return null;
  const ms = Number(parts.micros / BigInt(1000));
  const year = new Date(ms).getUTCFullYear();
  const notes: string[] = [];
  // atproto launched in 2022. A key that decodes far outside it is more
  // likely thirteen letters that happen to fit the alphabet.
  if (year < 2020 || year > new Date(now).getUTCFullYear() + 5) {
    notes.push(`This decodes to ${year}, which is outside the years atproto has existed. It may be a custom record key rather than a TID.`);
  }
  return {
    kind: 'tid',
    title: 'Timestamp identifier (TID)',
    summary: 'A record key or repo revision that carries the moment it was made, so keys sort in the order they were written.',
    facts: [
      ...timeFacts(ms, now),
      { label: 'Microseconds since 1970', value: parts.micros.toString(), copy: true },
      { label: 'Clock ID', value: String(parts.clockId) },
    ],
    notes: notes.length ? notes : undefined,
  };
}

/* -------------------------------------------------------------------------- *
 * CID
 * -------------------------------------------------------------------------- */

const CODECS: Record<number, { name: string; meaning: string }> = {
  0x71: { name: 'dag-cbor', meaning: 'A record, a commit or a node of the repository tree.' },
  0x55: { name: 'raw', meaning: 'A blob: an image, a video, any uploaded file.' },
  0x70: { name: 'dag-pb', meaning: 'An IPFS file node. atproto does not use this codec.' },
};

const HASHES: Record<number, string> = {
  0x12: 'sha2-256',
  0x13: 'sha2-512',
  0x1e: 'blake3',
};

function decodeCid(text: string): Decoded | null {
  let bytes: Uint8Array | null = null;
  let version = 1;
  let encoding = '';
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(text)) {
    bytes = decodeBase58(text);
    version = 0;
    encoding = 'base58btc, with no prefix';
  } else if (/^b[a-z2-7]{20,}$/.test(text)) {
    bytes = decodeBase32(text.slice(1));
    encoding = 'base32 (multibase prefix b)';
  } else if (/^z[1-9A-HJ-NP-Za-km-z]{20,}$/.test(text)) {
    bytes = decodeBase58(text.slice(1));
    encoding = 'base58btc (multibase prefix z)';
  }
  if (!bytes || bytes.length < 4) return null;

  let offset = 0;
  let codec = 0x70;
  if (version === 1) {
    const v = readVarint(bytes, 0);
    if (!v || v.value !== 1) return null;
    const c = readVarint(bytes, v.next);
    if (!c) return null;
    codec = c.value;
    offset = c.next;
  }
  const hash = readVarint(bytes, offset);
  if (!hash) return null;
  const length = readVarint(bytes, hash.next);
  if (!length) return null;
  const digest = bytes.subarray(length.next);
  if (digest.length !== length.value) return null;

  const codecInfo = CODECS[codec];
  const hashName = HASHES[hash.value];
  const notes: string[] = [];
  if (version === 0) notes.push('This is a CIDv0. atproto only uses CIDv1.');
  if (hash.value !== 0x12) notes.push('atproto records and blobs are hashed with sha2-256. This uses a different hash.');
  if (version === 1 && codec !== 0x71 && codec !== 0x55) {
    notes.push('atproto uses dag-cbor for records and raw for blobs. This is neither.');
  }
  return {
    kind: 'cid',
    title: 'Content identifier (CID)',
    summary: 'The hash of a piece of data, with a prefix that says how it was encoded and hashed. Change the data and the CID changes.',
    facts: [
      { label: 'Version', value: `CIDv${version}` },
      { label: 'Encoding', value: encoding, plain: true },
      {
        label: 'Codec',
        value: codecInfo ? `${codecInfo.name} (0x${codec.toString(16)})` : `0x${codec.toString(16)}`,
      },
      ...(codecInfo ? [{ label: 'Addresses', value: codecInfo.meaning, plain: true }] : []),
      {
        label: 'Hash',
        value: `${hashName ?? `0x${hash.value.toString(16)}`}, ${length.value * 8} bits`,
      },
      { label: 'Digest', value: toHex(digest), copy: true },
    ],
    notes: notes.length ? notes : undefined,
  };
}

/* -------------------------------------------------------------------------- *
 * Keys: did:key and the multibase keys in DID documents
 * -------------------------------------------------------------------------- */

const KEY_TYPES: Record<number, { name: string; alg: string | null; length: number }> = {
  0xe7: { name: 'secp256k1 (K-256)', alg: 'ES256K', length: 33 },
  0x1200: { name: 'NIST P-256', alg: 'ES256', length: 33 },
  0xed: { name: 'Ed25519', alg: 'EdDSA', length: 32 },
  0x1201: { name: 'NIST P-384', alg: 'ES384', length: 49 },
};

function decodeKey(text: string): Decoded | null {
  const isDidKey = text.startsWith('did:key:');
  const multibase = isDidKey ? text.slice('did:key:'.length) : text;
  if (!/^z[1-9A-HJ-NP-Za-km-z]{30,}$/.test(multibase)) return null;
  const bytes = decodeBase58(multibase.slice(1));
  if (!bytes) return null;
  const codec = readVarint(bytes, 0);
  if (!codec) return null;
  const type = KEY_TYPES[codec.value];
  if (!type) return null;
  const key = bytes.subarray(codec.next);
  const notes: string[] = [];
  if (key.length !== type.length) {
    notes.push(`A ${type.name} public key in this form is ${type.length} bytes. This one is ${key.length}.`);
  }
  if (codec.value !== 0xe7 && codec.value !== 0x1200) {
    notes.push('atproto signs repositories and tokens with K-256 or P-256 keys. This is another curve.');
  }
  return {
    kind: 'key',
    title: isDidKey ? 'Public key (did:key)' : 'Public key (multibase)',
    summary: isDidKey
      ? 'A DID that is nothing but a public key: the key is the identifier. PLC operations list rotation keys in this form.'
      : 'A public key as a DID document writes it, under publicKeyMultibase. The #atproto key signs the account’s repository.',
    facts: [
      { label: 'Curve', value: type.name, plain: true },
      ...(type.alg ? [{ label: 'JWT algorithm', value: type.alg }] : []),
      { label: 'Encoding', value: 'base58btc (multibase prefix z), compressed point', plain: true },
      { label: 'Key bytes', value: toHex(key), copy: true },
    ],
    notes: notes.length ? notes : undefined,
  };
}

/* -------------------------------------------------------------------------- *
 * DID
 * -------------------------------------------------------------------------- */

function decodeDid(text: string): Decoded | null {
  if (text.startsWith('did:key:')) return decodeKey(text);
  const match = text.match(/^did:([a-z]+):([A-Za-z0-9._:%-]+)$/);
  if (!match) return null;
  const [, method, id] = match;
  if (method === 'plc') {
    const valid = /^[a-z2-7]{24}$/.test(id);
    return {
      kind: 'did',
      title: 'DID (did:plc)',
      summary: 'A permanent account identifier registered in the PLC directory. It stays the same when the handle or the PDS changes.',
      facts: [
        { label: 'Method', value: 'plc' },
        { label: 'Identifier', value: id, copy: true },
        { label: 'Made from', value: 'The first 15 bytes of the sha2-256 hash of the account’s first signed operation, in base32.', plain: true },
        { label: 'Document', value: `https://plc.directory/${text}`, copy: true },
        { label: 'History', value: `https://plc.directory/${text}/log/audit`, copy: true },
      ],
      notes: valid ? undefined : ['A did:plc identifier is exactly 24 base32 characters (a to z and 2 to 7). This one is not.'],
      links: [{ label: 'Open in the Explorer', href: `/explore/${text}` }],
    };
  }
  if (method === 'web') {
    const [host, ...path] = id.split(':').map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
    const documentUrl = path.length
      ? `https://${host}/${path.join('/')}/did.json`
      : `https://${host}/.well-known/did.json`;
    return {
      kind: 'did',
      title: 'DID (did:web)',
      summary: 'An identifier that is a domain name. Its document is a file on that domain, so whoever controls the domain controls the identity.',
      facts: [
        { label: 'Method', value: 'web' },
        { label: 'Host', value: host, copy: true },
        { label: 'Document', value: documentUrl, copy: true },
      ],
      notes: path.length
        ? ['atproto only accepts did:web identifiers that are a bare hostname, with no path.']
        : undefined,
      links: [{ label: 'Open in the Explorer', href: `/explore/${text}` }],
    };
  }
  return {
    kind: 'did',
    title: `DID (did:${method})`,
    summary: 'A decentralized identifier. atproto accounts use the plc and web methods; this is another one.',
    facts: [
      { label: 'Method', value: method },
      { label: 'Identifier', value: id, copy: true },
    ],
  };
}

/* -------------------------------------------------------------------------- *
 * NSID and handle
 * -------------------------------------------------------------------------- */

const NSID_REGEXP = /^[a-zA-Z]([a-zA-Z0-9-]{0,62})?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,62})?)+\.[a-zA-Z][a-zA-Z0-9]{0,62}$/;

function decodeNsid(text: string): Decoded | null {
  const [nsid, fragment] = text.split('#');
  if (nsid.length > 317 || !NSID_REGEXP.test(nsid)) return null;
  const segments = nsid.split('.');
  if (segments.length < 3) return null;
  const name = segments[segments.length - 1];
  const authority = segments.slice(0, -1).reverse().join('.');
  return {
    kind: 'nsid',
    title: 'Namespaced identifier (NSID)',
    summary: 'The name of a lexicon: a record type or an API method. It reads as a reversed domain name with the type’s name on the end.',
    facts: [
      { label: 'Name', value: name },
      { label: 'Authority', value: authority, copy: true },
      { label: 'Namespace', value: segments.slice(0, -1).join('.') },
      { label: 'Published at', value: `_lexicon.${authority}`, copy: true },
      ...(fragment !== undefined
        ? [{ label: 'Definition', value: `#${fragment}` }]
        : []),
    ],
    links: [
      { label: 'Open in the lexicon explorer', href: `/explore/lexicons/${nsid}` },
      { label: 'Check how it is published', href: `/tools/lexicon?nsid=${encodeURIComponent(nsid)}` },
    ],
  };
}

function decodeHandle(text: string): Decoded | null {
  const handle = text.replace(/^@/, '').toLowerCase();
  if (handleSyntaxProblem(handle)) return null;
  const labels = handle.split('.');
  return {
    kind: 'handle',
    title: 'Handle',
    summary: 'A domain name used as an account’s name. It is only valid while it points at a DID and that DID points back.',
    facts: [
      { label: 'Handle', value: handle, copy: true },
      { label: 'DNS record', value: `_atproto.${handle}`, copy: true },
      { label: 'Well-known file', value: `https://${handle}/.well-known/atproto-did`, copy: true },
      { label: 'Parent domain', value: labels.slice(1).join('.') },
    ],
    links: [
      { label: 'Check this handle', href: `/tools/handle?handle=${encodeURIComponent(handle)}` },
      { label: 'Open in the Explorer', href: `/explore/${handle}` },
    ],
  };
}

/* -------------------------------------------------------------------------- *
 * Record key
 * -------------------------------------------------------------------------- */

const RECORD_KEY_REGEXP = /^[a-zA-Z0-9_~.:-]{1,512}$/;

function decodeRecordKey(text: string): Decoded | null {
  if (!RECORD_KEY_REGEXP.test(text) || text === '.' || text === '..') return null;
  return {
    kind: 'record-key',
    title: 'Record key',
    summary:
      text === 'self'
        ? 'The key a collection uses when an account has exactly one record in it, such as a profile.'
        : 'The name of one record inside a collection. Most are TIDs; this one is a key the app chose.',
    facts: [
      { label: 'Key', value: text, copy: true },
      { label: 'Length', value: `${text.length} of 512 characters`, plain: true },
    ],
  };
}

/* -------------------------------------------------------------------------- *
 * at:// URI
 * -------------------------------------------------------------------------- */

function decodeAtUri(text: string, now: number): Decoded | null {
  const match = text.match(/^at:\/\/([^/?#\s]+)(?:\/([^/?#\s]+)(?:\/([^/?#\s]+))?)?(?:#(\S*))?$/);
  if (!match) return null;
  const [, authority, collection, rkey, fragment] = match;
  const parts: { label: string; decoded: Decoded }[] = [];

  const authorityDecoded = authority.startsWith('did:') ? decodeDid(authority) : decodeHandle(authority);
  if (authorityDecoded) parts.push({ label: 'Authority', decoded: authorityDecoded });
  if (collection) {
    const collectionDecoded = decodeNsid(collection);
    if (collectionDecoded) parts.push({ label: 'Collection', decoded: collectionDecoded });
  }
  if (rkey) {
    const rkeyDecoded = decodeTid(rkey, now) ?? decodeRecordKey(rkey);
    if (rkeyDecoded) parts.push({ label: 'Record key', decoded: rkeyDecoded });
  }

  const notes: string[] = [];
  if (!authorityDecoded) notes.push('The authority is neither a DID nor a valid handle.');
  if (collection && !decodeNsid(collection)) notes.push('The collection is not a valid NSID.');
  if (!authority.startsWith('did:')) {
    notes.push('The authority is a handle. Handles can change, so a URI that has to keep working should name the DID.');
  }

  const points = rkey ? 'one record' : collection ? 'a collection' : 'a repository';
  const path = [authority, collection, rkey].filter(Boolean).join('/');
  return {
    kind: 'at-uri',
    title: 'AT URI',
    summary: `The address of ${points}: whose repository, which collection, which record.`,
    facts: [
      { label: 'Authority', value: authority, copy: true },
      ...(collection ? [{ label: 'Collection', value: collection, copy: true }] : []),
      ...(rkey ? [{ label: 'Record key', value: rkey, copy: true }] : []),
      ...(fragment !== undefined ? [{ label: 'Fragment', value: `#${fragment}` }] : []),
      { label: 'Universal link', value: `https://aturi.to/${path}`, copy: true },
    ],
    notes: notes.length ? notes : undefined,
    links: [{ label: 'Open in the Explorer', href: `/explore/${path}` }],
    parts,
  };
}

/* -------------------------------------------------------------------------- *
 * JWT
 * -------------------------------------------------------------------------- */

const CLAIMS: Record<string, string> = {
  iss: 'Issuer: who made the token.',
  sub: 'Subject: the account it speaks for.',
  aud: 'Audience: the service it is meant for. A service must refuse a token addressed to another.',
  exp: 'Expires at.',
  iat: 'Issued at.',
  nbf: 'Not valid before.',
  jti: 'A one-off id, so a token cannot be replayed.',
  lxm: 'Lexicon method: the one XRPC method this service token may call.',
  scope: 'What the token may do.',
  client_id: 'The OAuth client it was issued to.',
  cnf: 'Confirmation: the thumbprint (jkt) of the DPoP key the token is bound to.',
  htm: 'The HTTP method this proof was made for.',
  htu: 'The URL this proof was made for.',
  ath: 'The hash of the access token this proof goes with.',
  nonce: 'The server-supplied nonce this proof answers.',
};

const TOKEN_TYPES: Record<string, string> = {
  'at+jwt': 'An OAuth access token.',
  'dpop+jwt': 'A DPoP proof: it shows the sender holds the key an access token is bound to, for one request.',
  'refresh+jwt': 'A refresh token.',
  jwt: 'A plain JWT. Service auth tokens between atproto services use this type.',
};

/** Session scopes a PDS puts in the tokens it issues for password sign-ins. */
const SESSION_SCOPES: Record<string, string> = {
  'com.atproto.access': 'A full session from the account password.',
  'com.atproto.refresh': 'A refresh token for a password session.',
  'com.atproto.appPass': 'A session from an app password.',
  'com.atproto.appPassPrivileged': 'A session from an app password that may also read direct messages.',
};

function parseJsonSegment(segment: string): Record<string, unknown> | null {
  const bytes = decodeBase64Url(segment);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function looksLikeJwt(text: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(text.trim());
}

function decodeJwt(text: string, now: number): Decoded | null {
  if (!looksLikeJwt(text)) return null;
  const [headerPart, payloadPart, signature] = text.split('.');
  const header = parseJsonSegment(headerPart);
  const payload = parseJsonSegment(payloadPart);
  if (!header || !payload) return null;

  const facts: DecodedFact[] = [];
  const notes: string[] = [];
  const typ = typeof header.typ === 'string' ? header.typ : '';
  if (typ) {
    facts.push({ label: 'Type', value: `${typ}. ${TOKEN_TYPES[typ.toLowerCase()] ?? ''}`.trim(), plain: true });
  }
  if (typeof header.alg === 'string') facts.push({ label: 'Algorithm', value: header.alg });
  if (typeof header.kid === 'string') facts.push({ label: 'Key ID', value: header.kid, copy: true });

  for (const [claim, value] of Object.entries(payload)) {
    if (claim === 'exp' || claim === 'iat' || claim === 'nbf') continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    facts.push({ label: claim, value: text, copy: typeof value === 'string' && text.length > 12 });
  }
  for (const claim of ['iat', 'nbf', 'exp'] as const) {
    const value = payload[claim];
    if (typeof value !== 'number') continue;
    const ms = value * 1000;
    facts.push({
      label: claim,
      value: `${new Date(ms).toISOString()} (${relativeTime(ms, now)})`,
    });
  }

  if (typeof payload.exp === 'number') {
    const ms = payload.exp * 1000;
    notes.push(ms < now ? `This token expired ${relativeTime(ms, now)}.` : `This token is still within its lifetime. It expires ${relativeTime(ms, now)}.`);
  } else {
    notes.push('This token has no expiry claim.');
  }
  if (typeof payload.scope === 'string' && SESSION_SCOPES[payload.scope]) {
    notes.push(SESSION_SCOPES[payload.scope]);
  }
  if (header.alg === 'none' || !signature) notes.push('This token is unsigned.');
  notes.push('The signature is not checked here. Decoding a token shows what it claims, not that the claims are true.');

  return {
    kind: 'jwt',
    title: 'JSON Web Token',
    summary: 'A signed set of claims. atproto uses them for sessions, OAuth access tokens, DPoP proofs and service-to-service auth.',
    facts,
    json: [
      { label: 'Header', value: header },
      { label: 'Claims', value: payload },
    ],
    notes,
  };
}

/** What each claim in a decoded token means, for the page to print beside it. */
export function claimMeaning(claim: string): string | null {
  return CLAIMS[claim] ?? null;
}

/* -------------------------------------------------------------------------- *
 * Datetime
 * -------------------------------------------------------------------------- */

function decodeDatetime(text: string, now: number): Decoded | null {
  let ms: number | null = null;
  let read = '';
  if (/^\d{10}$/.test(text)) {
    ms = Number(text) * 1000;
    read = 'Seconds since 1970';
  } else if (/^\d{13}$/.test(text)) {
    ms = Number(text);
    read = 'Milliseconds since 1970';
  } else if (/^\d{16}$/.test(text)) {
    ms = Math.floor(Number(text) / 1000);
    read = 'Microseconds since 1970';
  } else if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(text)) {
    const parsed = Date.parse(text.replace(' ', 'T'));
    if (!Number.isNaN(parsed)) {
      ms = parsed;
      read = 'A date and time';
    }
  }
  if (ms === null || !Number.isFinite(ms)) return null;
  const notes: string[] = [];
  if (read === 'A date and time' && !/(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    notes.push('No time zone was given, so this was read in your local time. atproto datetimes must carry one.');
  }
  return {
    kind: 'datetime',
    title: 'Timestamp',
    summary: `${read}. The TID is the record key a record written at this instant would get.`,
    facts: [
      ...timeFacts(ms, now),
      { label: 'Seconds', value: String(Math.floor(ms / 1000)), copy: true },
      { label: 'Milliseconds', value: String(ms), copy: true },
      { label: 'TID', value: formatTid(BigInt(ms) * BigInt(1000)), copy: true },
    ],
    notes: notes.length ? notes : undefined,
  };
}

/* -------------------------------------------------------------------------- *
 * Entry point
 * -------------------------------------------------------------------------- */

/**
 * True for input that should never be written to the address bar, where it
 * would land in history and in anything that logs URLs.
 */
export function isSensitiveInput(raw: string): boolean {
  return looksLikeJwt(raw) || raw.trim().length > 400;
}

/** Every way `raw` can be read, most specific first. Empty when nothing fits. */
export function decodeIdentifier(raw: string, now: number = Date.now()): Decoded[] {
  const text = raw.trim();
  if (!text) return [];

  const jwt = decodeJwt(text, now);
  if (jwt) return [jwt];
  // A "Bearer" or "DPoP" prefix copied along with the token.
  const stripped = text.replace(/^(Bearer|DPoP)\s+/i, '');
  if (stripped !== text) {
    const inner = decodeJwt(stripped, now);
    if (inner) return [inner];
  }

  if (/^at:\/\//i.test(text)) {
    const uri = decodeAtUri(text, now);
    return uri ? [uri] : [];
  }
  if (text.startsWith('did:')) {
    const did = decodeDid(text);
    return did ? [did] : [];
  }

  const out: Decoded[] = [];
  const push = (decoded: Decoded | null) => {
    if (decoded) out.push(decoded);
  };
  push(decodeTid(text, now));
  push(decodeCid(text));
  if (!out.length) push(decodeKey(text));
  push(decodeDatetime(text, now));
  push(decodeNsid(text));
  if (!text.includes('#')) push(decodeHandle(text));
  // A record key last, and only when nothing better explains the text: almost
  // any short string is a valid one.
  if (!out.length) push(decodeRecordKey(text));
  return out;
}
