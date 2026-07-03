/**
 * Local, browser-only history of explorer searches. Powers the "recent" and
 * "frequent" recommendations shown under the nav-bar search dropdown. Nothing
 * here touches the network or the user's PDS — it lives entirely in
 * localStorage so it works signed-out and never leaves the device.
 */

import { encodeRepo } from './atproto/urls';

export const SEARCH_HISTORY_STORAGE_KEY = 'aturi.searchHistory.v1';

/** Cap the stored list so the key can't grow without bound. */
const MAX_ENTRIES = 50;
/** A path needs this many visits before it's considered "frequent". */
const FREQUENT_MIN_COUNT = 2;

export type SearchHistoryEntry = {
  /** Destination explorer path. Doubles as the dedup key. */
  path: string;
  /** Primary line — display name, handle, or the raw query. */
  label: string;
  /** Secondary line — usually `@handle`. */
  sublabel?: string;
  avatar?: string;
  did?: string;
  handle?: string;
  /** Total number of recorded visits. */
  count: number;
  /** Epoch ms of the most recent visit. */
  lastVisited: number;
};

function isEntry(value: unknown): value is SearchHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.path === 'string' &&
    typeof e.label === 'string' &&
    typeof e.count === 'number' &&
    typeof e.lastVisited === 'number'
  );
}

const EXPLORE_PREFIX = '/explore/';

/**
 * Canonicalize a stored path for dedup. Only the leading actor segment is
 * touched — its `@` prefix is stripped and it's lowercased so `/explore/@Dame.is`,
 * `/explore/dame.is`, and `/explore/DAME.IS` collapse to one key. The
 * collection/rkey tail is left byte-for-byte intact because rkeys are
 * case-sensitive and must stay distinct.
 */
function normalizePathKey(path: string): string {
  if (!path.startsWith(EXPLORE_PREFIX)) return path;
  const rest = path.slice(EXPLORE_PREFIX.length);
  const slash = rest.indexOf('/');
  const rawSeg = slash >= 0 ? rest.slice(0, slash) : rest;
  const tail = slash >= 0 ? rest.slice(slash) : '';
  let actor = rawSeg;
  try {
    actor = decodeURIComponent(rawSeg);
  } catch {
    // keep the raw segment if it isn't valid percent-encoding
  }
  actor = actor.replace(/^@+/, '').toLowerCase();
  return `${EXPLORE_PREFIX}${actor}${tail}`;
}

/** An `/explore/<actor>` path with no collection/rkey tail — the only shape
 *  where a shared DID means "the same destination" and merging is safe. */
function isActorLevelPath(pathKey: string): boolean {
  return (
    pathKey.startsWith(EXPLORE_PREFIX) &&
    !pathKey.slice(EXPLORE_PREFIX.length).includes('/')
  );
}

/** Combine two entries for the same destination: newest wins for display
 *  metadata, counts sum, recency is the later of the two. */
function mergeEntries(a: SearchHistoryEntry, b: SearchHistoryEntry): SearchHistoryEntry {
  const newest = b.lastVisited >= a.lastVisited ? b : a;
  const oldest = newest === b ? a : b;
  return {
    path: newest.path,
    label: newest.label || oldest.label,
    sublabel: newest.sublabel ?? oldest.sublabel,
    avatar: newest.avatar ?? oldest.avatar,
    did: newest.did ?? oldest.did,
    handle: newest.handle ?? oldest.handle,
    count: a.count + b.count,
    lastVisited: Math.max(a.lastVisited, b.lastVisited),
  };
}

/**
 * Collapse entries that point at the same account. Two things create split
 * entries the old exact-path dedup missed: (1) handle vs `@handle` vs casing,
 * and (2) the same actor visited once by handle and once by DID. We fold both —
 * first by canonical path, then by shared DID for actor-level paths — so a
 * profile shows up once no matter how it was reached. Record-level paths never
 * merge across DIDs so distinct records of one author stay separate.
 */
function dedupeEntries(entries: SearchHistoryEntry[]): SearchHistoryEntry[] {
  const byKey = new Map<string, SearchHistoryEntry>();
  const didToKey = new Map<string, string>();

  for (const raw of entries) {
    const pathKey = normalizePathKey(raw.path);
    const didKey =
      isActorLevelPath(pathKey) && raw.did ? raw.did.toLowerCase() : null;

    let key = pathKey;
    if (didKey && didToKey.has(didKey)) key = didToKey.get(didKey)!;

    const prev = byKey.get(key);
    byKey.set(key, prev ? mergeEntries(prev, raw) : { ...raw });
    if (didKey && !didToKey.has(didKey)) didToKey.set(didKey, key);
  }

  return [...byKey.values()];
}

export function readSearchHistory(): SearchHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupeEntries(parsed.filter(isEntry));
  } catch {
    return [];
  }
}

function writeSearchHistory(entries: SearchHistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify(entries),
    );
  } catch {
    // localStorage can throw in private modes / when full; ignore.
  }
}

export function clearSearchHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Pull the actor identifier (handle or DID) out of an `/explore/<repo>` path
 * so we can look the profile up for avatar enrichment. Returns null for PDS
 * paths (`/explore/pds/<host>`) and anything that isn't a repo destination —
 * those have no actor avatar to fetch.
 */
export function actorFromPath(path: string): string | null {
  const prefix = '/explore/';
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  if (!rest || rest.startsWith('pds/')) return null;
  const seg = rest.split('/')[0];
  if (!seg) return null;
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * Patch an existing entry's display metadata (avatar/handle/label/…) in place
 * without touching its visit count or recency. Used to backfill avatars that
 * free-text searches couldn't capture at record time. Returns whether a stored
 * entry was actually updated.
 */
export function enrichEntry(
  path: string,
  patch: Partial<Omit<SearchHistoryEntry, 'path' | 'count' | 'lastVisited'>>,
): boolean {
  const entries = readSearchHistory();
  const i = entries.findIndex((e) => e.path === path);
  if (i < 0) return false;
  entries[i] = { ...entries[i], ...patch };
  writeSearchHistory(entries);
  return true;
}

type SearchVisitInput = {
  path: string;
  label: string;
  sublabel?: string;
  avatar?: string;
  did?: string;
  handle?: string;
};

/**
 * Record one navigation. Dedups by destination path: an existing entry has
 * its count bumped and metadata refreshed (new non-empty values win, but a
 * previously-known avatar/displayName is kept if the new visit lacks one).
 */
function recordVisit(input: SearchVisitInput): void {
  const rawPath = input.path?.trim();
  const label = input.label?.trim();
  if (!rawPath || !label) return;

  // Store the canonical path so trivial variants (@handle, casing) never
  // create a second entry in the first place.
  const path = normalizePathKey(rawPath);

  const entries = readSearchHistory();
  const now = Date.now();
  const inDid = input.did?.toLowerCase();
  // Match an existing entry by canonical path, or by DID when we know it — the
  // latter folds a handle visit into a prior DID visit (and vice-versa).
  const existing = entries.findIndex(
    (e) =>
      normalizePathKey(e.path) === path ||
      (inDid != null &&
        e.did != null &&
        e.did.toLowerCase() === inDid &&
        isActorLevelPath(normalizePathKey(e.path))),
  );

  if (existing >= 0) {
    const prev = entries[existing];
    entries[existing] = {
      ...prev,
      label,
      sublabel: input.sublabel ?? prev.sublabel,
      avatar: input.avatar ?? prev.avatar,
      did: input.did ?? prev.did,
      handle: input.handle ?? prev.handle,
      count: prev.count + 1,
      lastVisited: now,
    };
  } else {
    entries.push({
      path,
      label,
      sublabel: input.sublabel,
      avatar: input.avatar,
      did: input.did,
      handle: input.handle,
      count: 1,
      lastVisited: now,
    });
  }

  // Keep the most-recent MAX_ENTRIES so the key stays bounded.
  entries.sort((a, b) => b.lastVisited - a.lastVisited);
  writeSearchHistory(entries.slice(0, MAX_ENTRIES));
}

/** Record a visit to an actor (handle/DID) — e.g. a typeahead pick. */
export function recordActorVisit(actor: {
  did?: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}): void {
  const handle = actor.handle?.trim();
  if (!handle) return;
  recordVisit({
    path: `/explore/${encodeRepo(handle)}`,
    label: actor.displayName?.trim() || handle,
    sublabel: `@${handle}`,
    avatar: actor.avatar,
    did: actor.did,
    handle,
  });
}

/** Record a free-text search whose resolved destination we already know. */
export function recordQueryVisit(rawQuery: string, path: string): void {
  recordVisit({ path, label: rawQuery.trim() });
}

/** Most recently visited entries, newest first. */
export function getRecents(
  entries: SearchHistoryEntry[],
  limit: number,
): SearchHistoryEntry[] {
  return [...entries]
    .sort((a, b) => b.lastVisited - a.lastVisited)
    .slice(0, limit);
}

/**
 * Most-visited entries, busiest first (ties broken by recency). Only entries
 * with repeat visits qualify, so the section stays meaningfully distinct from
 * "recent" instead of mirroring it for first-time lookups.
 */
export function getFrequent(
  entries: SearchHistoryEntry[],
  limit: number,
): SearchHistoryEntry[] {
  return entries
    .filter((e) => e.count >= FREQUENT_MIN_COUNT)
    .sort((a, b) => b.count - a.count || b.lastVisited - a.lastVisited)
    .slice(0, limit);
}
