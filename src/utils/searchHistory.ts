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

export function readSearchHistory(): SearchHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
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
  const path = input.path?.trim();
  const label = input.label?.trim();
  if (!path || !label) return;

  const entries = readSearchHistory();
  const now = Date.now();
  const existing = entries.findIndex((e) => e.path === path);

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
