/**
 * Slingshot client — microcosm's atproto edge record cache.
 *
 * Constellation hands back link *coordinates* (`{ did, collection, rkey }`),
 * not record content, so anything built on backlinks needs a second hop to
 * hydrate them. Doing that against each author's PDS means resolving every
 * DID to its host first: two round trips per record, from a browser, fanned
 * out across dozens of repos.
 *
 * Slingshot collapses that into one cached edge request per AT URI, and
 * resolves identity in one hop as well. Like the Constellation client, every
 * call swallows network / 4xx / 5xx errors and returns `null` so call sites
 * can render a placeholder instead of wrapping each one in try/catch.
 *
 * Endpoints used (see https://slingshot.microcosm.blue/openapi):
 *   GET /xrpc/blue.microcosm.repo.getRecordByUri?at_uri=…
 *   GET /xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=…
 */

import { withIdentification } from '../requestDeadline';
import { SLINGSHOT } from './config';

/** The subset of a DID document Slingshot returns: identity + host. */
export type MiniDoc = {
  did: string;
  handle: string | null;
  pds: string;
  signing_key?: string;
};

export type FetchedRecord<T = Record<string, unknown>> = {
  uri: string;
  cid: string;
  value: T;
};

async function fetchJsonOrNull<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, withIdentification({ signal }));
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Resolve a handle or DID to `{ did, handle, pds }` in a single request.
 * Returns null when the identity doesn't resolve.
 */
export async function resolveMiniDoc(
  identifier: string,
  signal?: AbortSignal,
): Promise<MiniDoc | null> {
  if (!identifier) return null;
  const url = `${SLINGSHOT}/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=${encodeURIComponent(
    identifier,
  )}`;
  const doc = await fetchJsonOrNull<MiniDoc>(url, signal);
  return doc?.did ? doc : null;
}

/**
 * Fetch a single record by AT URI. The repo segment may be a DID or a handle;
 * Slingshot resolves it either way.
 */
export async function getRecordByUri<T = Record<string, unknown>>(
  atUri: string,
  signal?: AbortSignal,
): Promise<FetchedRecord<T> | null> {
  if (!atUri) return null;
  const url = `${SLINGSHOT}/xrpc/blue.microcosm.repo.getRecordByUri?at_uri=${encodeURIComponent(
    atUri,
  )}`;
  const rec = await fetchJsonOrNull<FetchedRecord<T>>(url, signal);
  return rec?.value ? rec : null;
}

/**
 * Run `task` over `items` with at most `limit` in flight. Hydrating a page of
 * backlinks means one request per record; firing 50 at once gets us rate
 * limited and starves the rest of the page of connections, while awaiting
 * them serially is 50 sequential round trips. Results keep input order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Hydrate many AT URIs at once, keyed by URI. URIs that fail to resolve are
 * absent from the map rather than present-with-null, so callers can filter
 * with a single `.get()` check. Duplicate URIs are fetched once.
 */
export async function getRecordsByUris<T = Record<string, unknown>>(
  uris: readonly string[],
  opts: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<Map<string, FetchedRecord<T>>> {
  const { concurrency = 8, signal } = opts;
  const unique = Array.from(new Set(uris.filter(Boolean)));
  const out = new Map<string, FetchedRecord<T>>();
  const fetched = await mapWithConcurrency(unique, concurrency, (uri) =>
    getRecordByUri<T>(uri, signal),
  );
  fetched.forEach((rec, i) => {
    if (rec) out.set(unique[i], rec);
  });
  return out;
}
