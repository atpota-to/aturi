/**
 * Constellation backlinks service client. All calls swallow network / 4xx /
 * 5xx errors and return `null` so the UI can render "Unavailable" without
 * wrapping every call site in try/catch.
 */

import { CONSTELLATION } from './config';

export type BacklinkSource = {
  collection: string;
  path: string;
  source: string;
  count: number;
  distinctDids: number | null;
};

export type BacklinkRecord = {
  did: string;
  collection: string;
  rkey: string;
};

export type BacklinksPage = {
  records?: BacklinkRecord[];
  linking_records?: BacklinkRecord[];
  cursor?: string;
};

type SourceInfo = {
  records?: number;
  count?: number;
  distinct_dids?: number;
  distinctDids?: number;
};

type SourcesResponse = {
  links?: Record<string, Record<string, SourceInfo>>;
};

/**
 * Every request is bounded. Without a timeout a host that accepts the
 * connection and never answers holds the serverless invocation until the
 * platform kills it, which on the MCP route means one caller can occupy a
 * function slot for the full maxDuration.
 */
const REQUEST_TIMEOUT_MS = 8000;

/** The caller's signal, if any, plus the deadline above. */
function withDeadline(signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: withDeadline() });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * All sources (collection + record path) that point at `target`, with
 * per-source counts and distinct linking DIDs. `target` can be an AT URI
 * (record) OR a bare DID (identity backlinks like follows / blocks).
 */
export async function getBacklinkSources(
  target: string,
): Promise<SourcesResponse | Record<string, Record<string, SourceInfo>> | null> {
  if (!target) return null;
  const url = `${CONSTELLATION}/links/all?target=${encodeURIComponent(target)}`;
  return fetchJsonOrNull(url);
}

/**
 * Paginated backlinks for a (target, source) tuple. Returns the raw response
 * (`{ records, cursor }`) or `null`. The remote API returns either `records`
 * or `linking_records` depending on the endpoint version — callers should
 * normalize.
 */
export async function getBacklinks(
  target: string,
  source: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<BacklinksPage | null> {
  if (!target || !source) return null;
  const { limit = 25, cursor } = opts;
  const params = new URLSearchParams({
    subject: target,
    source,
    limit: String(limit),
  });
  if (cursor) params.set('cursor', cursor);
  const url = `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${params}`;
  return fetchJsonOrNull<BacklinksPage>(url);
}

/**
 * Flatten getBacklinkSources output into a sorted array. Returns null if
 * the underlying call failed.
 */
export function flattenSources(
  raw: SourcesResponse | Record<string, Record<string, SourceInfo>> | null,
): BacklinkSource[] | null {
  if (!raw) return null;
  const links =
    (raw as SourcesResponse).links ||
    (raw as Record<string, Record<string, SourceInfo>>);
  const out: BacklinkSource[] = [];
  for (const [collection, paths] of Object.entries(links || {})) {
    if (!paths || typeof paths !== 'object') continue;
    for (const [path, info] of Object.entries(paths)) {
      const count = info?.records ?? info?.count ?? 0;
      const distinctDids = info?.distinct_dids ?? info?.distinctDids ?? null;
      // /links/all returns the path with a leading dot (e.g. ".subject"),
      // but getBacklinks' `source` param uses the unprefixed form
      // ("app.bsky.graph.follow:subject"), so the dot is stripped.
      //
      // The exception is a root-level link, whose whole path is "." —
      // stripping there leaves "collection:", which getBacklinks answers with
      // nothing at all rather than an error, silently hiding every root-path
      // source (sh.tangled.graph.vouch and friends). Verified against the
      // live index: "sh.tangled.graph.vouch:." returns records, and
      // "sh.tangled.graph.vouch:" returns none.
      const sourcePath = path === '.' ? path : path.replace(/^\./, '');
      out.push({
        collection,
        path,
        source: `${collection}:${sourcePath}`,
        count,
        distinctDids,
      });
    }
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

/**
 * Normalize a backlinks page response so callers always see a `records` array.
 */
export function backlinksFromPage(page: BacklinksPage | null): BacklinkRecord[] {
  if (!page) return [];
  return page.records ?? page.linking_records ?? [];
}

/** Constellation caps `limit` at 100 on every paginated endpoint. */
const MAX_PAGE = 100;

/**
 * Every backlink for a (target, source) tuple, following the cursor until the
 * index is exhausted or `max` records have been collected. Returns `null` only
 * when the *first* page fails — a mid-pagination failure yields what we have,
 * since a partial list beats an empty one for a feedback board.
 */
export async function getAllBacklinks(
  target: string,
  source: string,
  opts: { max?: number; reverse?: boolean; dids?: readonly string[] } = {},
): Promise<BacklinkRecord[] | null> {
  if (!target || !source) return null;
  const { max = 500, reverse = false, dids } = opts;
  const out: BacklinkRecord[] = [];
  let cursor: string | undefined;

  while (out.length < max) {
    const params = new URLSearchParams({
      subject: target,
      source,
      limit: String(Math.min(MAX_PAGE, max - out.length)),
    });
    if (cursor) params.set('cursor', cursor);
    if (reverse) params.set('reverse', 'true');
    // Repeat `did` to narrow the result to specific linking identities — far
    // cheaper than paging the whole set and filtering client-side when only
    // one author's links can possibly matter.
    for (const did of dids ?? []) params.append('did', did);
    const page = await fetchJsonOrNull<BacklinksPage>(
      `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${params}`,
    );
    if (!page) return out.length ? out : null;
    const records = backlinksFromPage(page);
    out.push(...records);
    if (!page.cursor || records.length === 0) break;
    cursor = page.cursor;
  }

  return out;
}

export type ManyToManyItem = {
  linkRecord: BacklinkRecord;
  /** The secondary target the join record points at (an AT URI or a DID). */
  otherSubject: string;
};

type ManyToManyPage = {
  items?: ManyToManyItem[];
  cursor?: string | null;
};

/**
 * Join records that link a target *and* a secondary target — e.g. an
 * `app.userinput.pin` carries both `space.uri` (the target) and `subject.uri`
 * (the pinned discussion). One request returns both ends of every pin, where
 * `getBacklinks` would return the pin coordinates and leave us to hydrate each
 * record just to read the other side.
 *
 * `pathToOther` is the record path of the secondary link *without* a leading
 * dot (`subject.uri` for a strongRef, `subject` for a bare DID string).
 */
export async function getManyToMany(
  target: string,
  source: string,
  pathToOther: string,
  opts: { max?: number } = {},
): Promise<ManyToManyItem[] | null> {
  if (!target || !source || !pathToOther) return null;
  const { max = 500 } = opts;
  const out: ManyToManyItem[] = [];
  let cursor: string | undefined;

  while (out.length < max) {
    const params = new URLSearchParams({
      subject: target,
      source,
      pathToOther,
      limit: String(Math.min(MAX_PAGE, max - out.length)),
    });
    if (cursor) params.set('cursor', cursor);
    const page = await fetchJsonOrNull<ManyToManyPage>(
      `${CONSTELLATION}/xrpc/blue.microcosm.links.getManyToMany?${params}`,
    );
    if (!page) return out.length ? out : null;
    const items = page.items ?? [];
    out.push(...items);
    if (!page.cursor || items.length === 0) break;
    cursor = page.cursor;
  }

  return out;
}

/**
 * Per-source counts for one target, keyed by `collection:path` in the same
 * `source` form `getBacklinks` takes. One request covers every relationship
 * pointing at a record — for a feedback discussion that's upvotes, downvotes,
 * replies, statuses and edits together, instead of five count calls.
 */
export async function getBacklinkCounts(
  target: string,
): Promise<Map<string, BacklinkSource> | null> {
  const sources = flattenSources(await getBacklinkSources(target));
  if (!sources) return null;
  return new Map(sources.map((s) => [s.source, s]));
}

