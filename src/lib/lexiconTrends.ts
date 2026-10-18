/**
 * Network-wide lexicon comparisons over UFOs (ufos-api.microcosm.blue): which
 * lexicons are new in a window, and which rose or fell against the window
 * before it. Shared by the MCP lexicon tools and the explorer's
 * /api/lexicons/new route, the way waypointCatalog.ts is shared by
 * /api/waypoints and list_waypoints.
 *
 * UFOs answers neither question in one request, so both are assembled from
 * paged listings and batched stats. Failures throw McpToolError, whose codes
 * and hints are the public API's (see errors.ts), so the route can render the
 * same body the tools do.
 */

import {
  fetchCollections,
  fetchCollectionStatsResult,
  fetchRecentRecordsResult,
} from '@/utils/ufos/client';
import type { JustCount, NsidCount } from '@/utils/ufos/config';
import { WINDOWS, type Window } from '@/utils/ufos/windows';
import { mapWithConcurrency } from '@/utils/atproto/slingshot';
import { isValidNsid } from '@/utils/atproto/spaceUri';
import { McpToolError } from '@/lib/mcp/errors';

/**
 * /collections pages only when `order` is absent, at most 200 per page. In
 * October 2026 a 7d window was 2,860 NSIDs in 15 pages (~3s) and 30d was 30
 * pages. The cap is double that; a window busier than it is refused rather
 * than answered from the first half of the alphabet.
 */
const PAGE_SIZE = 200;
const MAX_PAGES = 60;

/**
 * Collections per /collections/stats request are bounded by URL length, not
 * count: valid NSIDs need no escaping but run to 317 characters, so a fixed
 * count of long ones could reach a length the server refuses, and one
 * refused batch fails the whole call. 2,000 characters fits about fifty
 * typical NSIDs. Four at a time because UFOs is run by a volunteer.
 */
const STATS_BATCH_CHARS = 2_000;
const CONCURRENCY = 4;

/**
 * /collections/stats defaults `since` to a week ago, so the history query
 * names a start explicitly. UFOs' rollups actually begin on 2025-04-12, the
 * first day /timeseries reports any app.bsky.feed.post activity; that date
 * is what "first seen" is relative to.
 */
const ALL_HISTORY_SINCE = '1970-01-01T00:00:00Z';
export const UFOS_HISTORY_BEGINS = '2025-04-12';

/**
 * Answers here cost UFOs dozens of requests each, and an agent that asks
 * "what's new?" once per reply would repeat them all day. UFOs rolls its
 * counts up hourly, so an answer up to ten minutes old says nearly what a
 * fresh one would. Every window starts on a ten-minute boundary and every
 * cache key carries that boundary, which does two things: an answer is
 * reused for at most ten minutes, and every caller in the same ten minutes
 * gets identical window bounds, so a comparison can fetch both of its
 * windows at once instead of waiting to learn where the first one began.
 *
 * The cache is per instance. Each warm serverless instance keeps its own,
 * which bounds the load each one sends rather than the total.
 */
const SLOT_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const clearers: Array<() => void> = [];

/**
 * A bounded map of pending or settled answers. Pending work is shared, so
 * concurrent callers make one set of requests; a failure is dropped as soon
 * as it settles, so the next caller retries instead of inheriting it.
 */
function memo<T>(maxEntries: number) {
  const entries = new Map<string, Promise<T>>();
  clearers.push(() => entries.clear());
  return (key: string, compute: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit) return hit;
    const value = compute();
    entries.set(key, value);
    value.catch(() => {
      if (entries.get(key) === value) entries.delete(key);
    });
    for (const oldest of entries.keys()) {
      if (entries.size <= maxEntries) break;
      entries.delete(oldest);
    }
    return value;
  };
}

/** Forget every cached answer. For tests, which stub a different network each time. */
export function clearLexiconTrendsCache(): void {
  for (const clear of clearers) clear();
}

function unavailable(hint: string): McpToolError {
  return new McpToolError('upstream_error', 'The UFOs lexicon-stats service is unavailable', hint);
}

/** Start of the window ending now, on the current ten-minute boundary. */
export function windowStart(win: Window, now = Date.now()): string {
  return new Date(Math.floor(now / SLOT_MS) * SLOT_MS - WINDOWS[win].hours * HOUR_MS).toISOString();
}

function batchByLength(nsids: string[], maxChars: number): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const nsid of nsids) {
    const cost = nsid.length + '&collection='.length;
    if (current.length > 0 && chars + cost > maxChars) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(nsid);
    chars += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * /collections/stats for any number of NSIDs over one range, or null if any
 * batch failed. Callers fail on null: a missing batch would read as zeroes,
 * which here means "new" or "fell to nothing", not "unknown".
 */
export async function statsInBatches(
  nsids: string[],
  since: string,
  until?: string,
): Promise<Map<string, JustCount> | null> {
  const results = await mapWithConcurrency(batchByLength(nsids, STATS_BATCH_CHARS), CONCURRENCY, (batch) =>
    fetchCollectionStatsResult({ collections: batch, since, until }),
  );
  if (results.some((r) => r.failed)) return null;
  return new Map(results.flatMap((r) => [...r.stats]));
}

/** Percent change to one decimal; null when there is nothing to compare against. */
export function percentChange(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

async function pageWindow(since: string, until?: string): Promise<NsidCount[]> {
  const rows: NsidCount[] = [];
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page === MAX_PAGES) {
      throw new McpToolError(
        'invalid_parameter',
        `More than ${MAX_PAGES * PAGE_SIZE} lexicons were active in this window, more than one call can page`,
        'Use a shorter window.',
      );
    }
    const result = await fetchCollections({ cursor, since, until, limit: PAGE_SIZE });
    if (result.failed) throw unavailable('Safe to retry; if it persists, ufos-api.microcosm.blue is down.');
    rows.push(...result.collections);
    if (!result.cursor) return rows;
    cursor = result.cursor;
  }
}

const listings = memo<NsidCount[]>(12);

/** Every NSID with activity from `since` to `until` (or now), from the unordered listing. */
function listActive(since: string, until?: string): Promise<NsidCount[]> {
  return listings(`${since} ${until ?? 'now'}`, () => pageWindow(since, until));
}

function accounts(entry: JustCount | undefined): number {
  return entry?.dids_estimate ?? 0;
}

export type NewLexicons = {
  since: string;
  /** NSIDs with any activity in the window. */
  activeInWindow: number;
  /** Those with enough accounts and a valid NSID, whose history was checked. */
  checked: number;
  /** The ones with no history before the window, most accounts first. */
  lexicons: NsidCount[];
};

const newLexiconAnswers = memo<NewLexicons>(32);

/**
 * NSIDs active in the window that UFOs never saw before it, used by at least
 * `minAccounts` accounts.
 *
 * The direct route would page both sides of the difference, and the "before"
 * side is the network's whole history: 34,764 NSIDs, 174 sequential pages and
 * 34s in October 2026. So only the window is paged, NSIDs under the account
 * threshold are dropped, and /collections/stats is asked about the rest's
 * history before the window. Checked against a full two-sided scan of the
 * same window, this found the same 46 NSIDs, and its history check took
 * about a second.
 */
export function findNewLexicons(win: Window, minAccounts: number): Promise<NewLexicons> {
  const since = windowStart(win);
  return newLexiconAnswers(`${win} ${since} ${minAccounts}`, async () => {
    const active = await listActive(since);
    // UFOs makes no promise that every collection it saw is a valid NSID,
    // and the follow-up tools reject ones that are not.
    const candidates = active.filter((c) => accounts(c) >= minAccounts && isValidNsid(c.nsid));
    const prior = await statsInBatches(
      candidates.map((c) => c.nsid),
      ALL_HISTORY_SINCE,
      since,
    );
    if (!prior) {
      throw unavailable('Retry shortly; without their history, established lexicons would be reported as new.');
    }
    // UFOs answers zeroes for an NSID it has never seen. One missing from the
    // answer altogether is unexplained, so it is not called new.
    const lexicons = candidates
      .filter((c) => {
        const before = prior.get(c.nsid);
        return before !== undefined && !before.creates && !before.updates && !before.deletes && !before.dids_estimate;
      })
      .sort((a, b) => accounts(b) - accounts(a) || b.creates - a.creates || a.nsid.localeCompare(b.nsid));
    return { since, activeInWindow: active.length, checked: candidates.length, lexicons };
  });
}

export type Direction = 'rising' | 'falling';

export type Mover = { nsid: string; now: JustCount; before: JustCount };

export type Movers = {
  since: string;
  previousSince: string;
  activeInWindow: number;
  activeInPreviousWindow: number;
  /** Rising only: NSIDs over the threshold now with no activity last window. */
  absentLastWindow: number;
  movers: Mover[];
};

const ZERO: JustCount = { creates: 0, updates: 0, deletes: 0, dids_estimate: 0 };

/**
 * Lexicons whose account count rose or fell most against the window of the
 * same length before this one, among those with at least `minAccounts`
 * accounts in the busier of the two.
 *
 * Both windows are read from the unordered listing, which agrees exactly with
 * /collections/stats; the ranked listing reads low (see list_trending_lexicons)
 * and would invent changes. Ranking is by (now + minAccounts) / (before +
 * minAccounts) rather than the raw ratio. On the raw ratio a lexicon that went
 * from 1 account to 12 outranks one that went from 46 to 1,144, and in October
 * 2026 eleven of the raw top fifteen started from one or two accounts. Rising
 * leaves out lexicons with no accounts last window, since there is no ratio to
 * take; list_new_lexicons covers them, and the count is reported. Falling
 * keeps lexicons that went quiet, with zeroes for this window.
 */
export async function findMovers(win: Window, direction: Direction, minAccounts: number): Promise<Movers> {
  const since = windowStart(win);
  const previousSince = new Date(Date.parse(since) - WINDOWS[win].hours * HOUR_MS).toISOString();
  const [current, previous] = await Promise.all([listActive(since), listActive(previousSince, since)]);

  const score = (m: Mover) => (accounts(m.now) + minAccounts) / (accounts(m.before) + minAccounts);
  const movers: Mover[] = [];
  let absentLastWindow = 0;

  if (direction === 'rising') {
    const before = new Map(previous.map((r) => [r.nsid, r]));
    for (const now of current) {
      if (accounts(now) < minAccounts || !isValidNsid(now.nsid)) continue;
      const then = before.get(now.nsid);
      if (!then || !accounts(then)) {
        absentLastWindow++;
        continue;
      }
      if (accounts(now) > accounts(then)) movers.push({ nsid: now.nsid, now, before: then });
    }
    movers.sort((a, b) => score(b) - score(a) || a.nsid.localeCompare(b.nsid));
  } else {
    const after = new Map(current.map((r) => [r.nsid, r]));
    for (const then of previous) {
      if (accounts(then) < minAccounts || !isValidNsid(then.nsid)) continue;
      const now = after.get(then.nsid) ?? ZERO;
      if (accounts(now) < accounts(then)) movers.push({ nsid: then.nsid, now, before: then });
    }
    movers.sort((a, b) => score(a) - score(b) || a.nsid.localeCompare(b.nsid));
  }

  return {
    since,
    previousSince,
    activeInWindow: current.length,
    activeInPreviousWindow: previous.length,
    absentLastWindow,
    movers,
  };
}

export type RecordSample = { records: number; accounts: number };

const samples = memo<RecordSample>(500);

/**
 * How many distinct accounts wrote the records in each NSID's recent sample
 * from /records. One account behind every recent record says where the
 * activity is concentrated, not that a lexicon is a test: in October 2026 one
 * new lexicon with four accounts in its window had all 42 sampled records
 * from one of them. A sample that failed is null rather than a failure of
 * the whole answer, since it only adds to one.
 */
export async function sampleRecordAccounts(nsids: string[]): Promise<Map<string, RecordSample | null>> {
  const slot = Math.floor(Date.now() / SLOT_MS);
  const results = await mapWithConcurrency(nsids, CONCURRENCY, (nsid) =>
    samples(`${slot} ${nsid}`, async () => {
      const { records, failed } = await fetchRecentRecordsResult([nsid]);
      if (failed) throw unavailable('Retry shortly.');
      return { records: records.length, accounts: new Set(records.map((r) => r.did)).size };
    }).catch(() => null),
  );
  return new Map(nsids.map((nsid, i) => [nsid, results[i]]));
}
