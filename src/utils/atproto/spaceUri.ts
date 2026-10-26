/**
 * Permissioned-space AT URI grammar. Pure, no network IO, no imports.
 *
 * A space address wedges a literal `space` marker into the path position a
 * public collection NSID would occupy:
 *
 *   at://{authorityDid}/space/{spaceType}/{skey}
 *   at://{authorityDid}/space/{spaceType}/{skey}/{authorDid}/{collection}/{rkey}
 *
 * The marker and a collection NSID can never be confused: an NSID needs at
 * least three dot-separated segments and `space` has none. That is the
 * protocol's intended discriminator, so every check here is exact-segment
 * equality — never a `startsWith('space')` prefix test, which would swallow a
 * real NSID like `space.example.thing`.
 *
 * Unlike a public AT URI, neither the authority nor the author may be a
 * handle: a space's identity and membership are keyed on DIDs.
 */

export const SPACE_MARKER = 'space';

export type SpaceRefParts = {
  /** Space authority. Always a DID — never a handle. */
  authority: string;
  /** Space type. Always a full NSID. */
  spaceType: string;
  /** Space key. Record-key syntax. */
  skey: string;
};

export type SpaceAtUriParts = SpaceRefParts & {
  /** Member whose permissioned repo holds the record. Always a DID. */
  author?: string;
  collection?: string;
  rkey?: string;
};

/** Overall AT URI length ceiling, per the AT URI spec. */
const MAX_AT_URI_LENGTH = 8192;

/**
 * Characters an AT URI may not contain. Anything outside the RFC-3986 subset
 * the spec blesses is rejected outright rather than percent-decoded, which
 * keeps a URI that reaches the parser identical to the one that reaches the
 * wire.
 */
const INVALID_CHAR_REGEXP = /[^a-zA-Z0-9._~:@!$&'()*+,;=%/\\[\]#?-]/;

/**
 * Structural split only. Every captured group is re-validated below against
 * the DID / NSID / record-key rules; the regex just carves the string up and
 * flags the three things strict mode forbids (trailing slash, query, hash).
 *
 * Capture order: authority, spaceType, skey, author, collection, rkey,
 * trailing slash, query, fragment. Positional rather than named because the
 * app's TypeScript target predates named capture groups.
 */
const SPACE_AT_URI_REGEXP =
  /^at:\/\/([^/?#\s]+)\/space\/([^/?#\s]+)\/([^/?#\s]+)(?:\/([^/?#\s]+)\/([^/?#\s]+)\/([^/?#\s]+))?(\/)?(?:\?([^#\s]*))?(?:#([^\s]*))?$/;

const DID_REGEXP = /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/;
const MAX_DID_LENGTH = 2048;

const NSID_CHARS_REGEXP = /^[a-zA-Z0-9.-]*$/;
/** 253 chars of reversed domain + a dot + a 63-char name segment. */
const MAX_NSID_LENGTH = 317;
const MAX_NSID_SEGMENT_LENGTH = 63;

const RECORD_KEY_REGEXP = /^[a-zA-Z0-9_~.:-]{1,512}$/;

export function isValidDid(value: string): boolean {
  return typeof value === 'string' && value.length <= MAX_DID_LENGTH && DID_REGEXP.test(value);
}

export function isValidNsid(value: string): boolean {
  if (typeof value !== 'string') return false;
  if (value.length > MAX_NSID_LENGTH) return false;
  if (!NSID_CHARS_REGEXP.test(value)) return false;

  const segments = value.split('.');
  if (segments.length < 3) return false;

  for (const segment of segments) {
    if (segment.length < 1 || segment.length > MAX_NSID_SEGMENT_LENGTH) return false;
    if (segment.startsWith('-') || segment.endsWith('-')) return false;
  }

  // The authority half is a reversed domain, so its first label follows
  // hostname rules; the trailing name segment is a camel-case identifier and
  // admits neither hyphens nor a leading digit.
  if (/^[0-9]/.test(segments[0])) return false;
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(segments[segments.length - 1])) return false;

  return true;
}

export function isValidRecordKey(value: string): boolean {
  if (typeof value !== 'string') return false;
  if (value === '.' || value === '..') return false;
  return RECORD_KEY_REGEXP.test(value);
}

/**
 * Exact-segment test for the `space` marker in the first path position. Says
 * nothing about whether the rest of the URI is well formed — that is
 * {@link parseSpaceAtUri}'s job. Callers use this to decide *which* grammar to
 * apply, so it deliberately matches malformed space URIs too: a bad space URI
 * must fail as a space URI rather than silently fall through to the public
 * repo/collection/rkey reading, which is what causes truncated addresses.
 */
export function isSpaceUri(input: string | null | undefined): boolean {
  if (typeof input !== 'string') return false;
  if (!input.startsWith('at://')) return false;
  const pathStart = input.indexOf('/', 5); // after "at://"
  if (pathStart === -1) return false;
  const rest = input.slice(pathStart + 1);
  return rest === SPACE_MARKER || rest.startsWith(`${SPACE_MARKER}/`);
}

/**
 * Strict parse. Returns null (never throws) for anything non-conforming:
 * a handle authority, a non-NSID space type, a bad space key, a trailing
 * slash, a query string, a fragment, or a partial record tail.
 */
export function parseSpaceAtUri(uri: string | null | undefined): SpaceAtUriParts | null {
  if (typeof uri !== 'string') return null;
  if (uri.length > MAX_AT_URI_LENGTH) return null;
  if (INVALID_CHAR_REGEXP.test(uri)) return null;

  const m = uri.match(SPACE_AT_URI_REGEXP);
  if (!m) return null;
  const [, authority, spaceType, skey, author, collection, rkey, trailingSlash, query, hash] = m;

  // Strict mode: an address that carries a query, a fragment, or a trailing
  // slash is not the canonical spelling, and the canonical spelling is what a
  // space credential's `sub` is compared against byte-for-byte.
  if (trailingSlash !== undefined || query !== undefined || hash !== undefined) return null;

  if (!isValidDid(authority)) return null;
  if (!isValidNsid(spaceType)) return null;
  if (!isValidRecordKey(skey)) return null;

  if (author === undefined) return { authority, spaceType, skey };

  // The record tail is all-or-nothing; the regex already enforces that, but
  // the validation has to cover all three parts before we hand them back.
  if (!isValidDid(author)) return null;
  if (!isValidNsid(collection)) return null;
  if (!isValidRecordKey(rkey)) return null;

  return { authority, spaceType, skey, author, collection, rkey };
}

/**
 * `at://{authority}/space/{spaceType}/{skey}` — the canonical spelling of a
 * space reference. The PDS compares a credential's `sub` string-exactly
 * against the `space` parameter, so callers must build space refs through
 * this and never by hand-concatenation.
 */
export function formatSpaceRef(parts: SpaceRefParts): string {
  return `at://${parts.authority}/${SPACE_MARKER}/${parts.spaceType}/${parts.skey}`;
}

/**
 * The space ref, plus `/{author}/{collection}/{rkey}` when all three are
 * present. A partial record tail is dropped rather than emitted: a URI naming
 * an author but no record is not addressable.
 */
export function formatSpaceAtUri(parts: SpaceAtUriParts): string {
  const ref = formatSpaceRef(parts);
  if (parts.author && parts.collection && parts.rkey) {
    return `${ref}/${parts.author}/${parts.collection}/${parts.rkey}`;
  }
  return ref;
}

/** True when parts name a space itself rather than a record inside one. */
export function isSpaceRefParts(parts: SpaceAtUriParts): boolean {
  return !parts.author && !parts.collection && !parts.rkey;
}
