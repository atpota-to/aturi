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

/**
 * Hosts that give every project its own subdomain. An NSID under one names
 * its site a label deeper than `<owner>.<tld>`:
 * `io.github.romiojoseph.blog.post` lives at `romiojoseph.github.io`, not
 * `github.io`. Only the hosts that turn up in published NSIDs.
 */
const PROJECT_HOST_SUFFIXES = new Set(['github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev']);

/** Second-level labels that country TLDs sell names under (`com.ar`, `co.uk`,
 * `ac.id`), which push the registrable domain a label deeper the same way. */
const COUNTRY_SECOND_LEVELS = new Set(['ac', 'co', 'com', 'edu', 'gov', 'ne', 'net', 'or', 'org']);

const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The domain a namespace's app most likely lives at: the reversed prefix cut
 * to its registrable domain. `app.voresky` and `app.voresky.feed` ->
 * `voresky.app`, `ar.com.cabildoabierto` -> `cabildoabierto.com.ar`. Takes
 * a namespace prefix, not a full NSID, whose final segment is a name rather
 * than a domain label (pass `groupPrefix(nsid)`). Null when the prefix stops
 * at a shared suffix (`io.github`) or is not made of hostname labels, so a
 * free-text group page never links anywhere. A guess from naming convention:
 * nothing checks that the domain resolves or that its owner wrote the lexicon.
 */
export function appDomainFor(prefix: string): string | null {
  const labels = prefix.toLowerCase().split('.');
  if (labels.length < 2 || !labels.every((l) => HOSTNAME_LABEL.test(l))) return null;
  // TLDs are at least two characters and never start with a digit.
  if (labels[0].length < 2 || !/^[a-z]/.test(labels[0])) return null;
  const pair = `${labels[1]}.${labels[0]}`;
  const sharedSuffix =
    PROJECT_HOST_SUFFIXES.has(pair) ||
    (labels[0].length === 2 && COUNTRY_SECOND_LEVELS.has(labels[1]));
  const depth = sharedSuffix ? 3 : 2;
  if (labels.length < depth) return null;
  return labels.slice(0, depth).reverse().join('.');
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
