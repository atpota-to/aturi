/**
 * Pure NSID helpers shared by the lexicons pages and the record-page
 * usage card. No network IO.
 */

/** First two segments — `app.bsky.feed.post` -> `app.bsky`. Single- or
 * two-segment NSIDs return the whole NSID. */
export function namespaceKey(nsid: string): string {
  const parts = nsid.split('.');
  if (parts.length <= 2) return nsid;
  return `${parts[0]}.${parts[1]}`;
}

/**
 * Split an NSID into its top-2-segment namespace and the remainder, so
 * narrow screens can stack the two on separate lines instead of truncating.
 * `app.bsky.feed.post` -> `{ head: 'app.bsky', tail: 'feed.post' }`. NSIDs
 * with two or fewer segments return an empty tail.
 */
export function splitNsid(nsid: string): { head: string; tail: string } {
  const parts = nsid.split('.');
  if (parts.length <= 2) return { head: nsid, tail: '' };
  return { head: `${parts[0]}.${parts[1]}`, tail: parts.slice(2).join('.') };
}

/** The parent lexicon group — everything before the final NSID segment.
 * `app.bsky.feed.post` -> `app.bsky.feed`. Used as the `/prefix` argument
 * to find sibling collections. */
export function groupPrefix(nsid: string): string {
  const parts = nsid.split('.');
  if (parts.length <= 1) return nsid;
  return parts.slice(0, -1).join('.');
}

/**
 * Convention: an NSID like `<tld>.<owner>.<...>` maps to `<owner>.<tld>`
 * as the publisher's handle. `net.anisota.harvest.minigame` ->
 * `anisota.net`, `app.bsky.feed.post` -> `bsky.app`, etc.
 */
export function publisherForNsid(nsid: string): string {
  const parts = nsid.split('.');
  if (parts.length < 2) return nsid;
  return `${parts[1]}.${parts[0]}`;
}

/** Lexicon-schema records live at this collection on the publisher's
 * repo, keyed by the full NSID. The explorer's record page renders them
 * via RecordPreview, falling through to a not-found message when the
 * publisher hasn't published a schema. */
export function schemaPathFor(nsid: string): string {
  const publisher = publisherForNsid(nsid);
  return `/explore/${publisher}/com.atproto.lexicon.schema/${encodeURIComponent(nsid)}`;
}

/** Deep link into the lexicons explorer for a given NSID. */
export function lexiconPathFor(nsid: string): string {
  return `/explore/lexicons/${encodeURIComponent(nsid)}`;
}

/** Deep link into the namespace/prefix browse page for a lexicon group
 * (e.g. `net.anisota`) or a free-text term. */
export function groupPathFor(prefix: string): string {
  return `/explore/lexicons/group/${encodeURIComponent(prefix)}`;
}
