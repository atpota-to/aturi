import { getSiteUrl } from '@/lib/config';

/**
 * Canonical URL builders for the profile and record surfaces.
 *
 * Every profile and record is reachable at more than one path: the bare
 * `aturi.to/{handle}` form (kept for backwards compatibility) and the canonical
 * `aturi.to/profile/{handle}` form, each of which accepts either a handle or a
 * DID. `src/app/profile/**` re-exports the bare routes' page modules, so the
 * duplicates render byte-identical HTML. Without a canonical link, a crawler
 * treats each spelling as its own page and keeps re-crawling all of them — for
 * a URL space as large as "every record in the network", that adds up fast.
 *
 * These helpers always resolve to the DID form. A handle can be reassigned to a
 * different identity, but a DID is stable for the lifetime of the account, so a
 * DID-based canonical never has to be re-pointed. It also matches where the
 * `@handle` routes already redirect to.
 *
 * Path segments are deliberately NOT percent-encoded. A canonical link has to
 * be byte-identical to the URL actually served, and these routes serve DIDs
 * unencoded (`/profile/did:plc:abc123`). Encoding would turn the colons into
 * `%3A` and point the canonical at a URL that doesn't exist. This is safe
 * because every segment involved is drawn from a restricted alphabet: DIDs and
 * NSIDs are alphanumerics plus `:._-`, and record keys are limited to
 * `[a-zA-Z0-9.-_~]` by the atproto spec. None of those need escaping in a path.
 */

/** Canonical URL for a single atproto identity's profile page. */
export function buildProfileCanonical(did: string): string {
  return `${getSiteUrl()}/profile/${did}`;
}

/**
 * Canonical URL for a single record. Note that posts are handled separately by
 * `buildPostMetadata` in `src/utils/postMetadata.ts`, which points at the
 * prettier `/profile/{handle}/post/{rkey}` route instead.
 */
export function buildRecordCanonical(
  did: string,
  collection: string,
  rkey: string,
): string {
  return `${getSiteUrl()}/profile/${did}/${collection}/${rkey}`;
}
