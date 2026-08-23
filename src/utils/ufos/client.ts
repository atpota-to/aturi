/**
 * Typed client for the UFOs API (ufos-api.microcosm.blue). Mirrors the
 * `src/utils/atproto/appview.ts` pattern: a private `fetchJsonOrNull`
 * helper plus one function per endpoint. Every function degrades
 * gracefully (empty result / null) instead of throwing, so callers can
 * render without try/catch.
 *
 * Live data: requests use `cache: 'no-store'` for parity with the
 * original TrendingLexicons fetchers.
 */

import {
  UFOS_API,
  type ApiRecord,
  type CollectionOrder,
  type JustCount,
  type NsidCount,
  type PrefixChild,
  type UfosMeta,
} from './config';

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

async function fetchJsonOrNull<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: withDeadline(init?.signal ?? undefined), ...init });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Append `since`/`until` ISO bounds to a param set when provided. */
function appendRange(params: URLSearchParams, since?: string, until?: string) {
  if (since) params.set('since', since);
  if (until) params.set('until', until);
}

/**
 * GET /collections — list collections with stats.
 *
 * `order` and `cursor` are mutually exclusive (sorted results can't be
 * paged); when `order` is set we drop `cursor`. Returns `{ collections,
 * cursor }`; `cursor` is non-null when more pages are available.
 */
export async function fetchCollections(opts: {
  order?: CollectionOrder;
  cursor?: string;
  limit?: number;
  since?: string;
  until?: string;
} = {}): Promise<{ collections: NsidCount[]; cursor: string | null; failed: boolean }> {
  const params = new URLSearchParams();
  if (opts.order) {
    params.set('order', opts.order);
  } else if (opts.cursor) {
    params.set('cursor', opts.cursor);
  }
  if (opts.limit != null) params.set('limit', String(opts.limit));
  appendRange(params, opts.since, opts.until);
  const data = await fetchJsonOrNull<{ collections?: NsidCount[]; cursor?: string | null }>(
    `${UFOS_API}/collections?${params.toString()}`,
  );
  // `failed` distinguishes a real request failure (null) from a genuinely
  // empty result ([]), so callers can show an error state instead of silently
  // rendering an outage as "no data". Existing callers ignore the extra field.
  return { collections: data?.collections ?? [], cursor: data?.cursor ?? null, failed: data === null };
}

/**
 * GET /collections/stats — record stats for one or more collections over
 * a time window. Returned as a Map keyed by NSID for ergonomic `.get`.
 */
export async function fetchCollectionStats(opts: {
  collections: string[];
  since?: string;
  until?: string;
}): Promise<Map<string, JustCount>> {
  if (opts.collections.length === 0) return new Map();
  const params = new URLSearchParams();
  for (const c of opts.collections) params.append('collection', c);
  appendRange(params, opts.since, opts.until);
  const data = await fetchJsonOrNull<Record<string, JustCount>>(
    `${UFOS_API}/collections/stats?${params.toString()}`,
  );
  const out = new Map<string, JustCount>();
  if (data) {
    for (const [nsid, entry] of Object.entries(data)) {
      if (entry && typeof entry === 'object') out.set(nsid, entry);
    }
  }
  return out;
}

/**
 * GET /timeseries — time-bucketed stats for a single collection. `step`
 * is in seconds (min 3600, rounded down to the hour by the API). Returns
 * the aligned `range` (bucket timestamps) and a `series` Map keyed by NSID.
 */
export async function fetchTimeseries(opts: {
  collection: string;
  since?: string;
  step?: number;
  until?: string;
}): Promise<{ range: string[]; series: Map<string, JustCount[]> }> {
  const params = new URLSearchParams({ collection: opts.collection });
  if (opts.step != null) params.set('step', String(opts.step));
  appendRange(params, opts.since, opts.until);
  const data = await fetchJsonOrNull<{
    range?: string[];
    series?: Record<string, JustCount[]>;
  }>(`${UFOS_API}/timeseries?${params.toString()}`);
  const series = new Map<string, JustCount[]>();
  if (data?.series) {
    for (const [nsid, buckets] of Object.entries(data.series)) {
      if (Array.isArray(buckets)) series.set(nsid, buckets);
    }
  }
  return { range: data?.range ?? [], series };
}

/**
 * GET /search — lexicon search. The API requires at least two
 * alphanumeric/hyphen characters in the query; we validate client-side to
 * avoid 400s and return `[]` for too-short or failed queries so the
 * typeahead never needs try/catch.
 */
/**
 * Failure-aware variant of {@link searchLexicons}. The plain version collapses
 * an outage into the same `[]` a genuine zero-match produces, which is fine
 * for a typeahead that just renders nothing but wrong for a caller that
 * reports "nothing is published under that name" as a fact.
 */
export async function searchLexiconsResult(
  q: string,
  signal?: AbortSignal,
): Promise<{ matches: NsidCount[]; failed: boolean }> {
  const trimmed = q.trim();
  const alnum = trimmed.match(/[a-z0-9-]/gi);
  if (!alnum || alnum.length < 2) return { matches: [], failed: false };
  const params = new URLSearchParams({ q: trimmed });
  const data = await fetchJsonOrNull<{ matches?: NsidCount[] }>(
    `${UFOS_API}/search?${params.toString()}`,
    { signal },
  );
  return { matches: data?.matches ?? [], failed: data === null };
}

/** Failure-aware variant of {@link fetchRecentRecords}; see searchLexiconsResult. */
export async function fetchRecentRecordsResult(
  collections: string[],
  signal?: AbortSignal,
): Promise<{ records: ApiRecord[]; failed: boolean }> {
  if (collections.length === 0) return { records: [], failed: false };
  const params = new URLSearchParams();
  for (const c of collections) params.append('collection', c);
  const data = await fetchJsonOrNull<ApiRecord[]>(
    `${UFOS_API}/records?${params.toString()}`,
    { signal },
  );
  return { records: Array.isArray(data) ? data : [], failed: data === null };
}

export async function searchLexicons(q: string, signal?: AbortSignal): Promise<NsidCount[]> {
  const trimmed = q.trim();
  const alnum = trimmed.match(/[a-z0-9-]/gi);
  if (!alnum || alnum.length < 2) return [];
  const params = new URLSearchParams({ q: trimmed });
  const data = await fetchJsonOrNull<{ matches?: NsidCount[] }>(
    `${UFOS_API}/search?${params.toString()}`,
    { signal },
  );
  return data?.matches ?? [];
}

/**
 * GET /prefix — enumerate a lexicon group. `prefix` is everything before
 * the final NSID segment (e.g. `app.bsky.feed`). Like /collections,
 * `order` and `cursor` are mutually exclusive. Returns the group's
 * `children` (collections and sub-prefixes), a `cursor`, and aggregated
 * `total` counts.
 */
export async function fetchPrefix(opts: {
  prefix: string;
  order?: CollectionOrder;
  cursor?: string;
  limit?: number;
  since?: string;
  until?: string;
}): Promise<{ children: PrefixChild[]; cursor: string | null; total: JustCount }> {
  const params = new URLSearchParams({ prefix: opts.prefix });
  if (opts.order) {
    params.set('order', opts.order);
  } else if (opts.cursor) {
    params.set('cursor', opts.cursor);
  }
  if (opts.limit != null) params.set('limit', String(opts.limit));
  appendRange(params, opts.since, opts.until);
  const data = await fetchJsonOrNull<{
    children?: PrefixChild[];
    cursor?: string | null;
    total?: JustCount;
  }>(`${UFOS_API}/prefix?${params.toString()}`);
  const zero: JustCount = { creates: 0, updates: 0, deletes: 0, dids_estimate: 0 };
  return {
    children: data?.children ?? [],
    cursor: data?.cursor ?? null,
    total: data?.total ?? zero,
  };
}

/**
 * GET /records — recent record samples for one or more collections,
 * newest activity from the firehose. Returns `[]` on failure.
 */
export async function fetchRecentRecords(
  collections: string[],
  signal?: AbortSignal,
): Promise<ApiRecord[]> {
  if (collections.length === 0) return [];
  const params = new URLSearchParams();
  for (const c of collections) params.append('collection', c);
  const data = await fetchJsonOrNull<ApiRecord[]>(
    `${UFOS_API}/records?${params.toString()}`,
    { signal },
  );
  return Array.isArray(data) ? data : [];
}

/** GET /meta — rollup / consumer freshness info, or null on failure. */
export async function fetchMeta(): Promise<UfosMeta | null> {
  return fetchJsonOrNull<UfosMeta>(`${UFOS_API}/meta`);
}
