/**
 * Shared constants, types, and pure helpers for the UFOs API
 * (ufos-api.microcosm.blue) — "every lexicon in the ATmosphere".
 *
 * No React/Next imports: this module is isomorphic so it can be consumed
 * from client components and (potentially) server code alike, mirroring
 * the `src/utils/atproto/config.ts` pattern.
 *
 * Field names match the UFOs OpenAPI schema exactly (notably
 * `dids_estimate` and `time_us`).
 */

export const UFOS_API = 'https://ufos-api.microcosm.blue';

/** Per-collection record-operation counts in a time window. */
export type JustCount = {
  creates: number;
  updates: number;
  deletes: number;
  dids_estimate: number;
};

/** A collection NSID with its counts (the `/collections`, `/search` row). */
export type NsidCount = JustCount & {
  nsid: string;
};

/**
 * A child of a `/prefix` listing — either a concrete collection or a
 * deeper sub-prefix (lexicon group) with aggregated counts. Discriminated
 * by `type`.
 */
export type PrefixChildCollection = JustCount & {
  type: 'collection';
  nsid: string;
};
export type PrefixChildPrefix = JustCount & {
  type: 'prefix';
  prefix: string;
};
export type PrefixChild = PrefixChildCollection | PrefixChildPrefix;

/** A recent record sample from `/records`. `record` is the raw value. */
export type ApiRecord = {
  collection: string;
  did: string;
  record: unknown;
  rkey: string;
  /** Firehose timestamp in MICROseconds since the epoch. */
  time_us: number;
};

/** Rollup / consumer freshness info from `/meta`. */
export type UfosMeta = {
  consumer: unknown;
  storage: unknown;
  storage_name: string;
};

/** The two sort orders `/collections` and `/prefix` accept. */
export type CollectionOrder = 'records-created' | 'dids-estimate';

/**
 * UI-facing metric. `dids` maps onto the API's `dids_estimate` field;
 * the other three are 1:1 with the operation counts.
 */
export type Metric = 'creates' | 'updates' | 'deletes' | 'dids';

export const METRIC_LABEL: Record<Metric, string> = {
  creates: 'Creates',
  updates: 'Updates',
  deletes: 'Deletes',
  dids: 'DIDs',
};

/** Project the count for the chosen metric out of a JustCount. */
export function statForMetric(s: JustCount, metric: Metric): number {
  if (metric === 'creates') return s.creates ?? 0;
  if (metric === 'updates') return s.updates ?? 0;
  if (metric === 'deletes') return s.deletes ?? 0;
  return s.dids_estimate ?? 0;
}

/**
 * `/collections` only supports two sort orders. Pick the closest to the
 * chosen metric; deletes / updates fall back to records-created since the
 * API can't sort by them.
 */
export function orderForMetric(metric: Metric): CollectionOrder {
  return metric === 'dids' ? 'dids-estimate' : 'records-created';
}

/** ISO timestamp `hours` ago — the form the API's `since`/`until` expect. */
export function isoAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}
