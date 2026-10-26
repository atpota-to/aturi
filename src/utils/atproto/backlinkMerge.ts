/**
 * One list of linking records drawn from several Constellation sources at
 * once: the Backlinks tab's "Followers" is eight follow lexicons, its
 * "Mentions" a dozen richtext paths.
 *
 * Constellation pages each source on its own cursor, most recently indexed
 * link first. That is close to creation order but not the same: an edited
 * starter pack links anew while its rkey keeps the date it was made. This
 * is a k-way merge over those pages that keeps each source's own order and
 * interleaves sources by the date in each head's TID rkey. Every source
 * keeps a buffer, the latest head across buffers is taken next, and a source
 * is only asked for another page once its buffer runs dry, so a 13.9M-link
 * source and a 2-link one cost the same first request each.
 *
 * Constellation returns one entry per link, not per record: a starter pack
 * whose three feeds were made by the target comes back three times. Entries
 * for a record already taken fold into it as `links`.
 */

import { getBacklinks, backlinksFromPage, type BacklinkRecord } from './constellation';
import { mapWithConcurrency } from './slingshot';
import { tidToDate } from './tid';

export type MergedBacklink = BacklinkRecord & {
  /** The AT URI of the linking record. */
  uri: string;
  /** The `collection:path` source it came through first. */
  source: string;
  /** How many links this record holds to the target (1 for most). */
  links: number;
};

export type BacklinkPage = { records: BacklinkRecord[]; cursor: string | null };

/** Fetches one page of a source; `null` when the request failed. */
export type BacklinkPageFetcher = (
  source: string,
  cursor: string | null,
  limit: number,
) => Promise<BacklinkPage | null>;

export type MergeBatch = {
  items: MergedBacklink[];
  /** Every source is exhausted: there is nothing more to take. */
  done: boolean;
  /** Sources whose last request failed; they are treated as exhausted. */
  failed: string[];
};

type SourceState = {
  source: string;
  buffer: BacklinkRecord[];
  cursor: string | null;
  exhausted: boolean;
  failed: boolean;
  /** Sort key of the last record taken from this source, or -Infinity. */
  lastKey: number;
};

/**
 * The key a source's head competes with: the time in its TID rkey. A head
 * whose rkey is not a TID (a custom key, `self`) has no date of its own, so
 * it rides with its neighbours in the same source: the record taken before
 * it, else the next dated record in the buffer. A source with no dated
 * record in sight sorts after every dated one, rather than heading a list
 * the reader expects to start with the latest links.
 */
function headKey(state: SourceState): number {
  const own = tidToDate(state.buffer[0].rkey);
  if (own) return own.getTime();
  if (Number.isFinite(state.lastKey)) return state.lastKey;
  for (const record of state.buffer) {
    const date = tidToDate(record.rkey);
    if (date) return date.getTime();
  }
  return Number.NEGATIVE_INFINITY;
}

export function createBacklinkMerge(
  sources: readonly string[],
  fetchPage: BacklinkPageFetcher,
  opts: { pageSize?: number; concurrency?: number } = {},
): { next: (n: number) => Promise<MergeBatch> } {
  const { pageSize = 25, concurrency = 6 } = opts;
  const states: SourceState[] = sources.map((source) => ({
    source,
    buffer: [],
    cursor: null,
    exhausted: false,
    failed: false,
    lastKey: Number.NEGATIVE_INFINITY,
  }));
  const taken = new Map<string, MergedBacklink>();

  async function refill(state: SourceState) {
    const page = await fetchPage(state.source, state.cursor, pageSize);
    if (!page) {
      state.exhausted = true;
      state.failed = true;
      return;
    }
    state.buffer.push(...page.records);
    state.cursor = page.cursor;
    if (!page.cursor || page.records.length === 0) state.exhausted = true;
  }

  async function next(n: number): Promise<MergeBatch> {
    const items: MergedBacklink[] = [];
    while (items.length < n) {
      const dry = states.filter((s) => s.buffer.length === 0 && !s.exhausted);
      if (dry.length) await mapWithConcurrency(dry, concurrency, refill);
      let best: SourceState | null = null;
      let bestKey = Number.NEGATIVE_INFINITY;
      for (const s of states) {
        if (!s.buffer.length) continue;
        const key = headKey(s);
        if (!best || key > bestKey) {
          best = s;
          bestKey = key;
        }
      }
      if (!best) break;
      const record = best.buffer.shift()!;
      best.lastKey = bestKey;
      const uri = `at://${record.did}/${record.collection}/${record.rkey}`;
      const seen = taken.get(uri);
      if (seen) {
        seen.links += 1;
        continue;
      }
      const item: MergedBacklink = { ...record, uri, source: best.source, links: 1 };
      taken.set(uri, item);
      items.push(item);
    }
    return {
      items,
      done: states.every((s) => s.exhausted && s.buffer.length === 0),
      failed: states.filter((s) => s.failed).map((s) => s.source),
    };
  }

  return { next };
}

/** The live fetcher: one `getBacklinks` page for `target` per call. */
export function constellationPageFetcher(target: string): BacklinkPageFetcher {
  return async (source, cursor, limit) => {
    const res = await getBacklinks(target, source, { limit, cursor: cursor ?? undefined });
    if (res === null) return null;
    return { records: backlinksFromPage(res), cursor: res.cursor || null };
  };
}
