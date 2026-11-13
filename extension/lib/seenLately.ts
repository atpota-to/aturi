/**
 * "Seen lately": a small local log of the repos the popup has met on pages,
 * surfaced under the header search and on the no-data page so a lookup can
 * start from someone you came across recently. Each entry carries what a row
 * needs (handle, PDS host, how many pages) and nothing about the pages
 * themselves beyond a hash of the last one counted.
 *
 * Written when the popup opens on a page with AT URIs, and enriched once the
 * popup has resolved a repo's identity (its handle and PDS host). Gated on the
 * `historyEnabled` pref, like the waypoint recents.
 *
 * Stored in `browser.storage.local` rather than `sync`:
 *   - it's noisy, device-specific browsing data — no value in syncing
 *   - it can grow larger than the per-key sync quota
 *
 * The storage key predates the name: the log began as the Inspect tab's
 * history, and keeping the key carries existing entries over.
 */
import { browser } from '#imports';
import { parseAtUri } from '@aturi/atproto/urls';

const STORAGE_KEY = 'aturi.inspectHistory.v1';
const MAX_ENTRIES = 50;

export type SeenRepo = {
  /**
   * The repo as first seen (a handle or a DID), and the DID once the popup
   * has resolved it. Entries for one account found both ways are merged
   * onto the DID.
   */
  repo: string;
  did?: string;
  handle?: string;
  /** Bare hostname of the repo's PDS, e.g. `pds.atpota.to`. */
  pdsHost?: string;
  /** Pages the repo has been seen on. */
  count: number;
  /** ms-since-epoch of the most recent appearance. */
  lastSeen: number;
  /**
   * Hash of the page that last counted, so reopening the popup on the same
   * page does not count it twice.
   */
  lastPage?: string;
};

type StoredShape = { entries?: SeenRepo[] };

type StorageArea = {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

function getLocalArea(): StorageArea | null {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    return browser.storage.local as unknown as StorageArea;
  }
  return null;
}

function isEntry(e: unknown): e is SeenRepo {
  const v = e as SeenRepo | null;
  return (
    !!v &&
    typeof v.repo === 'string' &&
    typeof v.count === 'number' &&
    typeof v.lastSeen === 'number'
  );
}

async function readEntries(): Promise<SeenRepo[]> {
  const area = getLocalArea();
  if (!area) return [];
  try {
    const got = await area.get(STORAGE_KEY);
    const raw = got?.[STORAGE_KEY] as StoredShape | undefined;
    if (!raw || !Array.isArray(raw.entries)) return [];
    return raw.entries.filter(isEntry);
  } catch {
    return [];
  }
}

async function writeEntries(entries: SeenRepo[]): Promise<void> {
  const area = getLocalArea();
  if (!area) return;
  try {
    await area.set({ [STORAGE_KEY]: { entries } satisfies StoredShape });
  } catch {
    /* ignore — local storage write failures aren't worth surfacing */
  }
}

// Writes are read-modify-write, and the popup fires several close together
// (the scan's record, then one enrichment per resolved identity). Chaining
// them keeps a later write from clobbering an earlier one.
let writeQueue: Promise<void> = Promise.resolve();

function update(fn: (entries: SeenRepo[]) => SeenRepo[] | null): Promise<void> {
  const run = async () => {
    const next = fn(await readEntries());
    if (next) await writeEntries(next);
  };
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

/** Most recent first. */
export function byRecency(a: SeenRepo, b: SeenRepo): number {
  return b.lastSeen - a.lastSeen;
}

/**
 * A short, stable key for a page: the URL without its fragment, hashed
 * (FNV-1a) so the log never holds the address itself.
 */
export function pageKey(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const bare = url.split('#')[0];
  let h = 0x811c9dc5;
  for (let i = 0; i < bare.length; i++) {
    h ^= bare.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function sameId(a: string | undefined, b: string): boolean {
  if (!a) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function matches(entry: SeenRepo, id: string): boolean {
  return sameId(entry.repo, id) || sameId(entry.did, id) || sameId(entry.handle, id);
}

/** The repo segment of each AT URI, deduped. */
export function reposFromUris(uris: string[]): string[] {
  const repos = new Map<string, string>();
  for (const uri of uris) {
    const repo = parseAtUri(uri)?.repo;
    if (repo) repos.set(repo.toLowerCase(), repo);
  }
  return Array.from(repos.values());
}

/**
 * Count `repos` as seen on the page `page` at `now`. A repo already counted
 * for this same page only has its time refreshed; one seen several times on
 * one page counts once. Pure, so the rules can be tested without storage.
 */
export function applySeen(
  entries: SeenRepo[],
  repos: string[],
  page: string | undefined,
  now: number,
): SeenRepo[] {
  const next = entries.slice();
  const touched = new Set<SeenRepo>();
  for (const repo of repos) {
    const at = next.findIndex(e => matches(e, repo));
    if (at === -1) {
      const fresh: SeenRepo = { repo, count: 1, lastSeen: now, lastPage: page };
      next.push(fresh);
      touched.add(fresh);
      continue;
    }
    const prev = next[at];
    // A handle and a DID for one account can both appear on a page: the
    // second sighting is the same page, not another one.
    if (touched.has(prev)) continue;
    const samePage = page !== undefined && prev.lastPage === page;
    const updated: SeenRepo = {
      ...prev,
      count: samePage ? prev.count : prev.count + 1,
      lastSeen: now,
      lastPage: page ?? prev.lastPage,
    };
    next[at] = updated;
    touched.add(updated);
  }
  return next.sort(byRecency).slice(0, MAX_ENTRIES);
}

export type SeenIdentity = {
  did: string;
  handle?: string | null;
  pdsHost?: string | null;
};

/**
 * Fold what the popup learned about a repo into the log: every entry for the
 * account (found by its DID, its handle, or the identifier it was seen as)
 * becomes one entry keyed by the DID, carrying the handle and PDS host. Does
 * not add an account the log has not seen. Returns null when nothing changes.
 */
export function applyIdentity(
  entries: SeenRepo[],
  identity: SeenIdentity,
  seenAs?: string,
): SeenRepo[] | null {
  const ids = [identity.did, identity.handle ?? undefined, seenAs].filter(
    (v): v is string => !!v,
  );
  const hits = entries.filter(e => ids.some(id => matches(e, id)));
  if (hits.length === 0) return null;

  const latest = hits.reduce((a, b) => (b.lastSeen > a.lastSeen ? b : a));
  // The tallies add up, less the page they were last counted on when both
  // names counted the same one: a page showing an account by handle and by
  // DID is the usual way one account gets two entries.
  const sharedPages = latest.lastPage
    ? hits.filter(e => e !== latest && e.lastPage === latest.lastPage).length
    : 0;
  const merged: SeenRepo = {
    repo: identity.did,
    did: identity.did,
    handle: identity.handle ?? latest.handle,
    pdsHost: identity.pdsHost ?? latest.pdsHost,
    count: hits.reduce((sum, e) => sum + e.count, 0) - sharedPages,
    lastSeen: latest.lastSeen,
    lastPage: latest.lastPage,
  };
  const unchanged =
    hits.length === 1 &&
    hits[0].repo === merged.repo &&
    hits[0].did === merged.did &&
    hits[0].handle === merged.handle &&
    hits[0].pdsHost === merged.pdsHost;
  if (unchanged) return null;

  const rest = entries.filter(e => !hits.includes(e));
  return [...rest, merged].sort(byRecency);
}

/** Record the repos of the given AT URIs as seen on the page at `pageUrl`. */
export function recordSeenRepos(uris: string[], pageUrl: string | null): Promise<void> {
  const repos = reposFromUris(uris);
  if (repos.length === 0) return Promise.resolve();
  const page = pageKey(pageUrl);
  return update(entries => applySeen(entries, repos, page, Date.now()));
}

/** Attach a resolved identity to the log's entries for that account. */
export function noteSeenIdentity(identity: SeenIdentity, seenAs?: string): Promise<void> {
  return update(entries => applyIdentity(entries, identity, seenAs));
}

/** The log, most recently seen first. */
export async function loadSeenLately(): Promise<SeenRepo[]> {
  const entries = await readEntries();
  return entries.sort(byRecency);
}

export function clearSeenLately(): Promise<void> {
  return update(() => []);
}

/** What a row calls the repo: its handle, else its DID or the raw identifier. */
export function seenLabel(entry: SeenRepo): string {
  return entry.handle || entry.did || entry.repo;
}

/**
 * The rows for a typed filter: entries whose handle, DID or PDS host contain
 * the text, ignoring case and a leading @.
 */
export function filterSeen(entries: SeenRepo[], query: string): SeenRepo[] {
  const q = query.trim().replace(/^@/, '').toLowerCase();
  if (!q) return entries;
  return entries.filter(e =>
    [e.handle, e.did, e.repo, e.pdsHost].some(v => !!v && v.toLowerCase().includes(q)),
  );
}
