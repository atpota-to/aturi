/**
 * AT URI / explorer URL helpers. Pure, no network IO.
 */

export type ParsedAtUri = {
  repo: string;
  collection?: string;
  rkey?: string;
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
  const m = String(atUri).match(/^at:\/\/[^/]+\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : null;
}

/**
 * Parse an at:// URI into its components. Returns null for non-AT URIs.
 */
export function parseAtUri(uri: string | null | undefined): ParsedAtUri | null {
  if (!uri) return null;
  const m = String(uri).match(/^at:\/\/([^/]+)(?:\/([^/?#]+)(?:\/([^/?#]+))?)?/);
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
