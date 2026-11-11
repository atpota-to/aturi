'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { fetchRanking, type CollectionRow } from '../../TrendingLexicons';
import {
  fetchCollections,
  fetchCollectionStats,
  fetchPrefix,
  fetchRecentRecordsResult,
  fetchTimeseries,
  searchLexiconsResult,
} from '@/utils/ufos/client';
import {
  isoAgo,
  orderForMetric,
  type ApiRecord,
  statForMetric,
  type JustCount,
  type Metric,
  type NsidCount,
  type PrefixChild,
} from '@/utils/ufos/config';
import { namespaceKey } from '@/utils/ufos/nsid';
import { WINDOWS, type Window } from '@/utils/ufos/windows';

/**
 * The lexicon workbench's reads from UFOs (ufos-api.microcosm.blue), each
 * kept for the visit and shared between whoever asks: the rail's tree and
 * the main pane list the same namespace, and stepping back to a list should
 * find it as it was rather than ask again. UFOs is run by a volunteer and
 * rolls its counts up hourly, so nothing here is fetched twice in a visit
 * for the same window, and per-lexicon series go out four at a time.
 */

export const ZERO: JustCount = { creates: 0, updates: 0, deletes: 0, dids_estimate: 0 };

/** Rows in Trending and Top: a screen and a half, and 25 sparklines. */
export const RANKED_COUNT = 25;
const CATALOG_PAGE = 100;
const PREFIX_PAGE = 200;
/** The pool the rail's namespaces are drawn from, by accounts. */
const ACTIVE_POOL = 200;
const SERIES_CONCURRENCY = 4;

/** Namespaces left out of the rail: private DM traffic, as the Top list does. */
const HIDDEN_NAMESPACES = ['chat.'];

type Loaded<T> = { data: T | null; error: string | null; loading: boolean };

const memo = new Map<string, Promise<unknown>>();

/** One request per key per visit; a failure is forgotten so the next asker retries. */
function once<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = memo.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const value = compute();
  memo.set(key, value);
  value.catch(() => {
    if (memo.get(key) === value) memo.delete(key);
  });
  return value;
}

/**
 * Reads `load()` for `key`, keeping the last answer up while the next loads
 * (a window or metric change re-sorts a list; it shouldn't blank it).
 */
function useLoad<T>(key: string | null, load: () => Promise<T>): Loaded<T> & { key: string | null } {
  const [state, setState] = useState<Loaded<T> & { key: string | null }>({
    data: null,
    error: null,
    loading: key !== null,
    key: null,
  });
  useEffect(() => {
    if (key === null) {
      setState({ data: null, error: null, loading: false, key: null });
      return undefined;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    load().then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false, key });
      },
      (err: unknown) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : String(err),
            loading: false,
          }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // `load` is rebuilt every render; the key names everything it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

// ─── Ranked lists ────────────────────────────────────────────────────────────

/**
 * Trending or Top, ranked by the metric over the window, each row with its
 * change against the window before. The sparklines come separately
 * (useSeries), so the list draws as soon as the ranking is in.
 */
export function useRanked(mode: 'trending' | 'top', window: Window, metric: Metric) {
  const key = `ranked|${mode}|${window}|${metric}`;
  return useLoad<CollectionRow[]>(key, () =>
    once(key, () => fetchRanking(window, mode, metric, RANKED_COUNT, { withSeries: false, withPrior: true })),
  );
}

// ─── Series ──────────────────────────────────────────────────────────────────

const series = new Map<string, JustCount[]>();
const seriesListeners = new Set<() => void>();
let seriesVersion = 0;
const queue: (() => Promise<void>)[] = [];
let running = 0;

function pump() {
  while (running < SERIES_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    running++;
    void job().finally(() => {
      running--;
      pump();
    });
  }
}

function requestSeries(nsid: string, window: Window) {
  const key = `${window}|${nsid}`;
  if (series.has(key) || memo.has(`series|${key}`)) return;
  const cfg = WINDOWS[window];
  memo.set(
    `series|${key}`,
    new Promise<void>((resolve) => {
      queue.push(async () => {
        const { series: got } = await fetchTimeseries({ collection: nsid, since: isoAgo(cfg.hours), step: cfg.step });
        series.set(key, (got.get(nsid) ?? []).slice(-cfg.bucketCount));
        seriesVersion++;
        seriesListeners.forEach((l) => l());
        resolve();
      });
      pump();
    }),
  );
}

function subscribeSeries(listener: () => void) {
  seriesListeners.add(listener);
  return () => seriesListeners.delete(listener);
}

/** Buckets for each of `nsids` over the window, as they arrive. A bucket carries every metric. */
export function useSeries(nsids: readonly string[], window: Window): (nsid: string) => JustCount[] | null {
  useSyncExternalStore(subscribeSeries, () => seriesVersion, () => 0);
  const joined = nsids.join(' ');
  useEffect(() => {
    if (!joined) return;
    for (const nsid of joined.split(' ')) requestSeries(nsid, window);
  }, [joined, window]);
  return useCallback((nsid: string) => series.get(`${window}|${nsid}`) ?? null, [window]);
}

export function seriesFor(buckets: JustCount[] | null, metric: Metric): number[] | null {
  return buckets ? buckets.map((b) => statForMetric(b, metric)) : null;
}

// ─── The catalog ─────────────────────────────────────────────────────────────

/**
 * Every lexicon with activity in the window, A to Z, a page at a time. The
 * API can't sort a paged listing, so the order is the catalog's own.
 */
export function useCatalog(window: Window) {
  const [pages, setPages] = useState<{ window: Window; rows: NsidCount[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const key = `catalog|${window}`;
    once(key, async () => {
      const res = await fetchCollections({ limit: CATALOG_PAGE, since: isoAgo(WINDOWS[window].hours) });
      if (res.failed) throw new Error('the UFOs API is unavailable');
      return res;
    }).then(
      (res) => {
        if (!cancelled) setPages({ window, rows: res.collections, cursor: res.cursor });
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [window]);

  const loadMore = useCallback(async () => {
    if (!pages?.cursor || loadingMore) return;
    setLoadingMore(true);
    const res = await fetchCollections({
      cursor: pages.cursor,
      limit: CATALOG_PAGE,
      since: isoAgo(WINDOWS[pages.window].hours),
    });
    setPages((prev) =>
      prev && prev.window === pages.window
        ? { ...prev, rows: [...prev.rows, ...res.collections], cursor: res.cursor }
        : prev,
    );
    setLoadingMore(false);
  }, [pages, loadingMore]);

  const current = pages && pages.window === window ? pages : null;
  return {
    rows: current?.rows ?? (pages ? pages.rows : null),
    cursor: current?.cursor ?? null,
    stale: pages !== null && pages.window !== window,
    error,
    loadingMore,
    loadMore,
  };
}

// ─── Namespaces ──────────────────────────────────────────────────────────────

export type NamespaceEntry = {
  /** A collection's NSID, or a deeper namespace's prefix. */
  name: string;
  kind: 'lexicon' | 'namespace';
  counts: JustCount;
  /** The same counts for the window before; null when the prior page didn't cover it. */
  prior: JustCount | null;
};

export type NamespaceListing = {
  prefix: string;
  entries: NamespaceEntry[];
  total: JustCount;
  priorTotal: JustCount;
  cursor: string | null;
};

/**
 * `/prefix` sometimes lists a namespace as a collection of the same name
 * beside itself (`app.bsky.actor` the collection, with one create, and
 * `app.bsky.actor` the namespace). Both are kept; they open different
 * places.
 */
function entriesOf(children: PrefixChild[], prior: Map<string, JustCount>, priorComplete: boolean): NamespaceEntry[] {
  return children.map((c) => {
    const name = c.type === 'prefix' ? c.prefix : c.nsid;
    const kind = c.type === 'prefix' ? 'namespace' : 'lexicon';
    const counts = { creates: c.creates, updates: c.updates, deletes: c.deletes, dids_estimate: c.dids_estimate };
    const before = prior.get(`${kind}|${name}`) ?? (priorComplete ? ZERO : null);
    return { name, kind, counts, prior: before };
  });
}

async function loadNamespace(prefix: string, window: Window): Promise<NamespaceListing> {
  const hours = WINDOWS[window].hours;
  const since = isoAgo(hours);
  const priorSince = isoAgo(hours * 2);
  const [current, before] = await Promise.all([
    fetchPrefix({ prefix, limit: PREFIX_PAGE, since }),
    fetchPrefix({ prefix, limit: PREFIX_PAGE, since: priorSince, until: since }),
  ]);
  const prior = new Map<string, JustCount>();
  for (const c of before.children) {
    prior.set(c.type === 'prefix' ? `namespace|${c.prefix}` : `lexicon|${c.nsid}`, c);
  }
  return {
    prefix,
    entries: entriesOf(current.children, prior, before.cursor === null),
    total: current.total,
    priorTotal: before.total,
    cursor: current.cursor,
  };
}

export function namespaceListing(prefix: string, window: Window): Promise<NamespaceListing> {
  return once(`ns|${window}|${prefix}`, () => loadNamespace(prefix, window));
}

/** A namespace's children in the window, with the window before for change. */
export function useNamespace(prefix: string | null, window: Window) {
  const key = prefix ? `ns|${window}|${prefix}` : null;
  const state = useLoad<NamespaceListing>(key, () => namespaceListing(prefix as string, window));
  const [more, setMore] = useState<{ key: string; entries: NamespaceEntry[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const fresh = state.key === key ? state.data : null;
  const extra = more && more.key === key ? more : null;

  const loadMore = useCallback(async () => {
    const cursor = extra ? extra.cursor : fresh?.cursor;
    if (!prefix || !cursor || loadingMore || !key) return;
    setLoadingMore(true);
    const res = await fetchPrefix({ prefix, cursor, limit: PREFIX_PAGE, since: isoAgo(WINDOWS[window].hours) });
    setMore((prev) => ({
      key,
      entries: [...(prev && prev.key === key ? prev.entries : []), ...entriesOf(res.children, new Map(), false)],
      cursor: res.cursor,
    }));
    setLoadingMore(false);
  }, [extra, fresh, prefix, loadingMore, key, window]);

  const listing = useMemo<NamespaceListing | null>(() => {
    const base = fresh ?? state.data;
    if (!base) return null;
    if (!extra) return base;
    return { ...base, entries: [...base.entries, ...extra.entries], cursor: extra.cursor };
  }, [fresh, state.data, extra]);

  return {
    listing: listing && (listing.prefix === prefix ? listing : null),
    stale: state.loading && state.data !== null,
    error: state.error,
    loadingMore,
    loadMore,
  };
}

// ─── Search ──────────────────────────────────────────────────────────────────

export function useSearch(term: string | null) {
  const key = term ? `search|${term}` : null;
  return useLoad<NsidCount[]>(key, () =>
    once(key as string, async () => {
      const res = await searchLexiconsResult(term as string);
      if (res.failed) throw new Error('the UFOs API is unavailable');
      return res.matches;
    }),
  );
}

// ─── One lexicon ─────────────────────────────────────────────────────────────

export type LexiconStats = { current: JustCount; prior: JustCount; buckets: JustCount[] };

/** One lexicon's counts for the window and the window before, and its buckets. */
export function useLexiconStats(nsid: string, window: Window) {
  const key = `stats|${window}|${nsid}`;
  return useLoad<LexiconStats>(key, () =>
    once(key, async () => {
      const cfg = WINDOWS[window];
      const since = isoAgo(cfg.hours);
      const [current, prior, ts] = await Promise.all([
        fetchCollectionStats({ collections: [nsid], since, until: new Date().toISOString() }),
        fetchCollectionStats({ collections: [nsid], since: isoAgo(cfg.hours * 2), until: since }),
        fetchTimeseries({ collection: nsid, since, step: cfg.step }),
      ]);
      return {
        current: current.get(nsid) ?? ZERO,
        prior: prior.get(nsid) ?? ZERO,
        buckets: ts.series.get(nsid) ?? [],
      };
    }),
  );
}

/**
 * The latest records UFOs sampled for a lexicon from the firehose. Kept for
 * the visit like the rest, so the inspector's tab and the main pane's list
 * show the same ones; Live is how to see newer.
 */
export function useRecentRecords(nsid: string) {
  const key = `records|${nsid}`;
  return useLoad<ApiRecord[]>(key, () =>
    once(key, async () => {
      const res = await fetchRecentRecordsResult([nsid]);
      if (res.failed) throw new Error('the UFOs API is unavailable');
      return [...res.records].sort((a, b) => b.time_us - a.time_us);
    }),
  );
}

// ─── The rail's namespaces ───────────────────────────────────────────────────

export type ActiveNamespace = { prefix: string; top: string; lexicons: number };

/**
 * The namespaces with the most-used lexicons in the window, in the order of
 * their busiest one. Drawn from a pool of the top lexicons by accounts, so
 * `lexicons` counts how many of a namespace's made that pool, not how many
 * it has.
 */
export function useActiveNamespaces(window: Window) {
  const key = `active|${window}`;
  return useLoad<ActiveNamespace[]>(key, () =>
    once(key, async () => {
      const res = await fetchCollections({
        order: orderForMetric('dids'),
        limit: ACTIVE_POOL,
        since: isoAgo(WINDOWS[window].hours),
      });
      if (res.failed) throw new Error('the UFOs API is unavailable');
      const out = new Map<string, ActiveNamespace>();
      for (const c of res.collections) {
        if (HIDDEN_NAMESPACES.some((h) => c.nsid.startsWith(h))) continue;
        const prefix = namespaceKey(c.nsid);
        if (!prefix.includes('.') || prefix === c.nsid) continue;
        const entry = out.get(prefix);
        if (entry) entry.lexicons++;
        else out.set(prefix, { prefix, top: c.nsid, lexicons: 1 });
      }
      return Array.from(out.values());
    }),
  );
}

/** Change against the window before as a percentage; null when there was nothing before. */
export function changePct(current: number, prior: number | null | undefined): number | null {
  if (prior == null || prior <= 0) return null;
  return ((current - prior) / prior) * 100;
}
