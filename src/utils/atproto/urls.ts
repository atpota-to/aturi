/**
 * AT URI / explorer URL helpers. Pure, no network IO.
 */

import {
  SPACE_MARKER,
  isSpaceUri,
  isValidDid,
  isValidNsid,
  isValidRecordKey,
  parseSpaceAtUri,
  type SpaceAtUriParts,
} from './spaceUri';

export type ParsedAtUri = {
  repo: string;
  collection?: string;
  rkey?: string;
  /**
   * Present only for permissioned space URIs. When set, `collection` and
   * `rkey` are deliberately left undefined: a caller that ignores `space`
   * degrades to the repo level, which is safe, instead of building a public
   * record path out of space components, which is wrong.
   */
  space?: SpaceAtUriParts;
};

/**
 * Build an at:// URI from parts.
 */
export function toAtUri({
  did,
  collection,
  rkey,
}: {
  did: string;
  collection?: string;
  rkey?: string;
}): string {
  if (collection && rkey) return `at://${did}/${collection}/${rkey}`;
  if (collection) return `at://${did}/${collection}`;
  return `at://${did}`;
}

/**
 * Extract the rkey from an at://did/collection/rkey URI.
 */
export function rkeyFromAtUri(atUri: string | null | undefined): string | null {
  if (!atUri) return null;
  // A space URI's third segment is the space type, not a record key, so the
  // public regex below would hand back an NSID. Parse it as what it is.
  if (isSpaceUri(atUri)) return parseSpaceAtUri(atUri)?.rkey ?? null;
  const m = String(atUri).match(/^at:\/\/[^/]+\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : null;
}

/**
 * Parse an at:// URI into its components. Returns null for non-AT URIs.
 */
export function parseAtUri(uri: string | null | undefined): ParsedAtUri | null {
  if (!uri) return null;
  // Space addresses have their own grammar and their own path depth. A
  // malformed one returns null rather than falling through to the public
  // regex, which would silently truncate it to repo/`space`/spaceType.
  if (isSpaceUri(uri)) {
    const space = parseSpaceAtUri(uri);
    return space ? { repo: space.authority, space } : null;
  }
  const m = String(uri).match(/^at:\/\/([^/?#]+)(?:\/([^/?#]+)(?:\/([^/?#]+))?)?/);
  if (!m) return null;
  const [, repo, collection, rkey] = m;
  return { repo, collection, rkey };
}

/**
 * Repo path-segments contain colons (DIDs) and dots (handles). Both are
 * URL-safe in path segments without encoding, and encoding `:` breaks the
 * readability of DID URLs. Leave them raw; only encode the truly reserved
 * characters.
 */
export function encodeRepo(input: string | null | undefined): string {
  return String(input || '').replace(/[?#]/g, encodeURIComponent);
}

/**
 * Explorer path for a permissioned space address.
 *
 *   /explore/{authority}/space/{spaceType}/{skey}
 *   /explore/{authority}/space/{spaceType}/{skey}/{author}/{collection}/{rkey}
 *
 * The authority and the author are both DIDs and both use `encodeRepo`, so
 * their colons stay raw and match the shape of every other explorer repo path.
 */
export function spaceExplorePath(parts: SpaceAtUriParts): string {
  const base = `/explore/${encodeRepo(parts.authority)}/${SPACE_MARKER}/${parts.spaceType}/${encodeURIComponent(parts.skey)}`;
  if (parts.author && parts.collection && parts.rkey) {
    return `${base}/${encodeRepo(parts.author)}/${parts.collection}/${encodeURIComponent(parts.rkey)}`;
  }
  return base;
}

/**
 * Authority position in an *explorer* path, which is not the same rule as the
 * at:// grammar's. A space ref is DID-only because a credential's `sub` is
 * compared byte for byte, but `/explore/{repo}/space/...` resolves its repo
 * segment through the identity resolver, so a handle addresses the same space.
 * The space pages build their own share links from `handle || did`, and a
 * DID-only test here would mean a link aturi.to emitted doesn't route back into
 * aturi.to. Same shape test the reverse parsers use: a DID, or a dotted name.
 */
function isExploreAuthority(value: string): boolean {
  return value.startsWith('did:') || value.includes('.');
}

/**
 * Inverse of {@link spaceExplorePath}, over already-split, already-decoded
 * path segments starting at the authority — i.e.
 * `pathname.split('/').filter(Boolean).slice(1)` for an `/explore/...` path.
 * Returns the canonical explorer path, or null when the segments don't spell an
 * addressable space page.
 *
 * Every depth the route tree serves is accepted, including the two partial ones
 * — `/explore/{repo}/space` (which spaces an account writes to) and
 * `/explore/{repo}/space/{type}` (the same, narrowed) — because both are real
 * pages with their own share links. Only the author position stays DID-only,
 * which is what the route itself enforces.
 */
export function spaceExplorePathFromSegments(segments: string[]): string | null {
  const [authority, marker, spaceType, skey, author, collection, rkey] = segments;
  if (marker !== SPACE_MARKER) return null;
  if (!authority || !isExploreAuthority(authority)) return null;
  const marked = `/explore/${encodeRepo(authority)}/${SPACE_MARKER}`;
  if (segments.length === 2) return marked;

  if (!spaceType || !isValidNsid(spaceType)) return null;
  if (segments.length === 3) return `${marked}/${spaceType}`;

  if (!skey || !isValidRecordKey(skey)) return null;
  const ref = `${marked}/${spaceType}/${encodeURIComponent(skey)}`;
  if (segments.length === 4) return ref;

  // Anything between the space ref and a full record address is not an
  // addressable page, so it is rejected rather than degraded.
  if (segments.length !== 7) return null;
  if (!isValidDid(author)) return null;
  if (!isValidNsid(collection)) return null;
  if (!isValidRecordKey(rkey)) return null;
  return `${ref}/${encodeRepo(author)}/${collection}/${encodeURIComponent(rkey)}`;
}

/**
 * Convert an at:// URI (or a bare DID) into the corresponding /explore/...
 * SPA path. Returns null for empty/unparseable input.
 *
 *   at://did:plc:abc/app.bsky.feed.post/xyz  → /explore/did:plc:abc/app.bsky.feed.post/xyz
 *   at://did:plc:abc/app.bsky.feed.post      → /explore/did:plc:abc/app.bsky.feed.post
 *   at://did:plc:abc                         → /explore/did:plc:abc
 *   did:plc:abc                              → /explore/did:plc:abc
 */
export function explorePathFromAtUri(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input);
  if (s.startsWith('did:')) return `/explore/${s}`;
  const parsed = parseAtUri(s);
  if (!parsed) return null;
  if (parsed.space) return spaceExplorePath(parsed.space);
  const { repo, collection, rkey } = parsed;
  if (rkey) return `/explore/${encodeRepo(repo)}/${collection}/${encodeURIComponent(rkey)}`;
  if (collection) return `/explore/${encodeRepo(repo)}/${collection}`;
  return `/explore/${encodeRepo(repo)}`;
}

/**
 * Short DID like "did:plc:abc1…wxyz" for display in dense tables.
 */
export function shortDid(did: string | null | undefined): string {
  if (typeof did !== 'string') return '';
  if (!did.startsWith('did:plc:') || did.length <= 18) return did;
  return `${did.slice(0, 12)}…${did.slice(-4)}`;
}
