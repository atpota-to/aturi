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

async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
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
      // but getBacklinks rejects that — its `source` param uses the
      // unprefixed form ("app.bsky.graph.follow:subject"). Strip it.
      const sourcePath = path.startsWith('.') ? path.slice(1) : path;
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
