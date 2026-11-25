/**
 * The Graph tab's finished reads, kept in this browser for a day.
 *
 * A read of one account's neighbourhood is a few hundred requests to the
 * account's PDS, the AppView and Constellation (graphData.ts), and the same
 * account tends to be opened again: from the account card, after a reload,
 * from another tab. A day-old picture of a 30-day window is close enough, so
 * a finished read is stored in IndexedDB and served until it is 24 hours
 * old, or until someone asks for a fresh one (the Graph tab's Refresh).
 *
 * IndexedDB rather than localStorage: a busy account's read runs to a few
 * megabytes once every person and their engagement is in it, past what
 * localStorage holds, and IndexedDB clones the object as it is. Where there is
 * no IndexedDB (a private window, server rendering) or it fails, every call
 * here quietly does nothing and the graph is read as before.
 *
 * Entries carry a `schema` string that graphData.ts builds from the shape
 * of a read and the limits it ran under, so a read stored by an older build
 * is never shown as if the current one had made it.
 */

const DB_NAME = 'aturi-graph';
const STORE = 'neighbourhoods';
/** How long a finished read is served before it is read again. */
export const GRAPH_CACHE_MS = 24 * 60 * 60 * 1000;
/** The most accounts kept at once; the oldest go first. */
const MAX_ENTRIES = 40;

type Entry<T> = { did: string; schema: string; savedAt: number; value: T };

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'did' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then((db) => {
    // A failed open is tried again next time rather than remembered.
    if (!db) opening = null;
    return db;
  });
  return opening;
}

function run<R>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<R>): Promise<R | null> {
  return open().then(
    (db) =>
      new Promise<R | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = work(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** Whether a read stamped `at` (ms) is still young enough to serve at `now`. */
export function isFresh(at: number, now = Date.now()): boolean {
  return Number.isFinite(at) && now - at >= 0 && now - at < GRAPH_CACHE_MS;
}

/** The stored read for `did`, if one was made under `schema` and is still fresh. */
export async function readStoredGraph<T>(did: string, schema: string): Promise<{ value: T; savedAt: number } | null> {
  const entry = (await run('readonly', (s) => s.get(did))) as Entry<T> | undefined | null;
  if (!entry || entry.schema !== schema || !isFresh(entry.savedAt)) return null;
  return { value: entry.value, savedAt: entry.savedAt };
}

/** Keep a finished read, and clear out stale or surplus ones. */
export async function storeGraph<T>(did: string, schema: string, value: T, savedAt: number): Promise<void> {
  await run('readwrite', (s) => s.put({ did, schema, savedAt, value } satisfies Entry<T>));
  const all = ((await run('readonly', (s) => s.getAll())) ?? []) as Entry<unknown>[];
  const keep = all
    .filter((e) => e.schema === schema && isFresh(e.savedAt))
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_ENTRIES);
  const kept = new Set(keep.map((e) => e.did));
  for (const e of all) if (!kept.has(e.did)) await run('readwrite', (s) => s.delete(e.did));
}

/** Drop the stored read for `did`, so the next load reads it fresh. */
export async function forgetStoredGraph(did: string): Promise<void> {
  await run('readwrite', (s) => s.delete(did));
}
