/**
 * The activity calendar's reading: every collection in a repository, newest
 * record first, back to the start of the window.
 *
 * `com.atproto.repo.listRecords` returns a collection in descending key
 * order by default (`reverse=true` is oldest first), 100 records a page at
 * most. TIDs sort by time, so a collection is read from its newest record
 * and reading stops at the first key older than the window; a quiet
 * collection costs one request. A collection whose keys carry no time
 * cannot stop early and is read to its end.
 *
 * The cost lands on the account's own PDS, which is often one person's
 * server, so it is bounded twice: a few collections at a time, and a page
 * budget per run, for each collection and overall. A collection that runs
 * out of budget keeps its cursor and is marked `partial`; running again
 * resumes there rather than starting over. That is what "Read further back"
 * does, and also why Stop loses nothing.
 *
 * What has been read is kept for the life of the page, by DID, so returning
 * to an account or reading further never repeats a request. Only day counts
 * are kept: each page's records are dropped as soon as their keys are
 * counted.
 */

import { resolveIdentifier } from '@/utils/atproto/identity';
import { describeRepo, listRecordsPage } from '@/utils/atproto/pdsClient';
import { buildWindow, emptyScan, tallyPage, type ActivityWindow, type CollectionScan } from './activity';

/** listRecords refuses more than this. */
const PAGE_SIZE = 100;
/** A page of long records can pass the client's response cap; this size never has. */
const SMALL_PAGE_SIZE = 25;
/** Collections read at once. */
export const SCAN_CONCURRENCY = 3;
/** Pages one collection may take in one run: 5,000 records. */
export const PAGES_PER_COLLECTION = 50;
/** Pages one run may take in all. */
export const PAGES_PER_RUN = 250;

export type ActivityScan = {
  did: string;
  handle: string | null;
  pds: string;
  window: ActivityWindow;
  /** One entry per collection, in the order the PDS lists them. */
  collections: CollectionScan[];
  /**
   * `reading` while requests are going out. `done` when every collection has
   * been read back to the window's start. `partial` when the run ended with
   * some left short: the budget ran out, or Stop was pressed.
   */
  phase: 'reading' | 'done' | 'partial';
  /** Why a `partial` run ended. */
  endedBy?: 'budget' | 'stop';
  /** Requests made by this run. */
  pagesThisRun: number;
};

/** Set `stop` to end a run after the requests already in flight. */
export type ScanStopper = { stop: boolean };

type Cached = { windowStart: number; scans: Map<string, CollectionScan> };

/** What has been read so far, by DID. A new day starts a new window, and a new count. */
const cache = new Map<string, Cached>();

function isTooLarge(err: unknown): boolean {
  return err instanceof Error && /too large/i.test(err.message);
}

function failureText(err: unknown): string {
  const status = (err as { status?: number } | null)?.status;
  if (status) return `the PDS answered HTTP ${status}`;
  if (err instanceof Error && /timeout|timed out|abort/i.test(`${err.name} ${err.message}`)) {
    return 'the PDS did not answer in time';
  }
  return 'the PDS could not be reached';
}

/** The record key is the last segment of the record's at:// URI. */
function rkeyOf(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1);
}

/**
 * Read an account's year. Publishes after every page, so the calendar fills
 * in as it loads. Throws only when the account or its collections cannot be
 * found at all; a collection that fails is recorded on its own row and the
 * rest carry on.
 */
export async function scanActivity(
  actor: string,
  ctx: {
    signal: AbortSignal;
    publish: (scan: ActivityScan) => void;
    stopper: ScanStopper;
    now?: Date;
  },
): Promise<ActivityScan> {
  const { signal, publish, stopper } = ctx;

  let identity;
  try {
    identity = await resolveIdentifier(actor);
  } catch {
    throw new Error(`${actor} could not be resolved. Check the spelling, or try its DID.`);
  }
  if (identity.repoStatus) {
    throw new Error(
      `This account is ${identity.repoStatus.status ?? 'inactive'}, so its PDS will not serve its records.`,
    );
  }
  const { did, handle, pds } = identity;

  let names: string[];
  try {
    names = (await describeRepo(pds, did)).collections ?? [];
  } catch (err) {
    throw new Error(`The account's collections could not be listed: ${failureText(err)}.`);
  }

  const window = buildWindow(ctx.now ?? new Date());
  let cached = cache.get(did);
  if (!cached || cached.windowStart !== window.startMs) {
    cached = { windowStart: window.startMs, scans: new Map() };
    cache.set(did, cached);
  }
  const scans = cached.scans;
  for (const name of names) {
    const known = scans.get(name);
    // A collection that failed or stopped short last time gets another go.
    if (!known) scans.set(name, emptyScan(name));
    else if (known.state !== 'done') scans.set(name, { ...known, state: 'waiting', error: undefined });
  }

  let pagesThisRun = 0;
  const snapshot = (phase: ActivityScan['phase'], endedBy?: ActivityScan['endedBy']): ActivityScan => ({
    did,
    handle,
    pds,
    window,
    collections: names.map((name) => scans.get(name) as CollectionScan),
    phase,
    endedBy,
    pagesThisRun,
  });
  const put = (scan: CollectionScan) => {
    scans.set(scan.collection, scan);
    if (!signal.aborted) publish(snapshot('reading'));
  };
  publish(snapshot('reading'));

  async function readCollection(name: string): Promise<void> {
    let scan = scans.get(name) as CollectionScan;
    if (scan.state === 'done') return;
    let pagesHere = 0;

    for (;;) {
      if (signal.aborted) return;
      if (stopper.stop || pagesHere >= PAGES_PER_COLLECTION || pagesThisRun >= PAGES_PER_RUN) {
        put({ ...scan, state: 'partial' });
        return;
      }
      if (scan.state !== 'reading') {
        scan = { ...scan, state: 'reading' };
        put(scan);
      }

      pagesThisRun += 1;
      pagesHere += 1;
      let page;
      try {
        try {
          page = await listRecordsPage(pds, { repo: did, collection: name, limit: PAGE_SIZE, cursor: scan.cursor });
        } catch (err) {
          if (!isTooLarge(err)) throw err;
          pagesThisRun += 1;
          page = await listRecordsPage(pds, { repo: did, collection: name, limit: SMALL_PAGE_SIZE, cursor: scan.cursor });
        }
      } catch (err) {
        put({ ...scan, state: 'failed', error: failureText(err) });
        return;
      }
      // A run that was replaced while this page was in flight must not write
      // over what its successor has read since.
      if (signal.aborted) return;

      const records = page.records ?? [];
      const tallied = tallyPage(
        scan,
        records.map((record) => ({ rkey: rkeyOf(record.uri), createdAt: record.value?.createdAt })),
        window,
      );
      scan = { ...tallied.scan, cursor: page.cursor };
      if (tallied.passedWindow || !page.cursor || records.length === 0) {
        put({ ...scan, state: 'done', cursor: undefined });
        return;
      }
      put(scan);
    }
  }

  const queue = [...names];
  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const name = queue.shift();
        if (name === undefined) return;
        await readCollection(name);
      }
    }),
  );

  const short = names.some((name) => scans.get(name)?.state === 'partial');
  return snapshot(short ? 'partial' : 'done', short ? (stopper.stop ? 'stop' : 'budget') : undefined);
}
