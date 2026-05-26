/**
 * PDS record scan. Given a target DID, resolve its PDS, call describeRepo,
 * and return the set of collection NSIDs the repo holds. Used by the popup
 * to dim waypoints whose `expectedCollections` aren't present and to boost
 * confirmed-active waypoints in smart recommendations.
 *
 * Results are cached in chrome.storage.local keyed by DID with a 1h TTL.
 * Each scan adds at most two network calls — a didDoc fetch (PLC directory
 * or did:web .well-known) and the describeRepo XRPC — which only fires on
 * a cache miss.
 */

import { browser } from '#imports';
import { fetchDidDocument, extractPdsEndpoint } from '@aturi/didResolver';
import { describeRepo } from '@aturi/atproto/pdsClient';

const CACHE_KEY = 'aturi.repoScan.v1';
const TTL_MS = 60 * 60 * 1000; // 1 hour

type CacheEntry = {
  collections: string[];
  fetchedAt: number;
};

type Cache = Record<string, CacheEntry>;

// In-memory mirror so multiple popup opens within the same service-worker
// lifetime don't re-read chrome.storage.local.
let memoryCache: Cache | null = null;

async function loadCache(): Promise<Cache> {
  if (memoryCache) return memoryCache;
  try {
    const items = await browser.storage.local.get(CACHE_KEY);
    const raw = (items as Record<string, unknown>)[CACHE_KEY];
    memoryCache = raw && typeof raw === 'object' ? (raw as Cache) : {};
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

async function persistCache(cache: Cache): Promise<void> {
  memoryCache = cache;
  try {
    await browser.storage.local.set({ [CACHE_KEY]: cache });
  } catch {
    // Storage failures are non-fatal — the in-memory copy still helps.
  }
}

function isFresh(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < TTL_MS;
}

/**
 * Resolve a DID to its PDS endpoint via the didDoc. Returns null when the
 * DID can't be resolved (offline, retired DID, malformed didDoc, etc.).
 */
async function pdsForDid(did: string): Promise<string | null> {
  const didDoc = await fetchDidDocument(did);
  if (!didDoc) return null;
  const endpoint = extractPdsEndpoint(didDoc);
  return endpoint ? endpoint.replace(/\/$/, '') : null;
}

/**
 * Scan the target repo and return the set of NSIDs the user has records in.
 * Returns null when the scan fails (network error, no PDS, etc.) so callers
 * can keep the "unknown" UI state rather than misclassifying every waypoint
 * as 'absent'.
 */
export async function scanRepoCollections(
  did: string,
): Promise<Set<string> | null> {
  if (!did.startsWith('did:')) return null;
  const cache = await loadCache();
  const cached = cache[did];
  if (isFresh(cached)) {
    return new Set(cached.collections);
  }

  const pds = await pdsForDid(did);
  if (!pds) return null;

  try {
    const desc = await describeRepo(pds, did);
    const collections = Array.isArray(desc.collections) ? desc.collections : [];
    const next: Cache = { ...cache, [did]: { collections, fetchedAt: Date.now() } };
    // Trim the cache so it doesn't grow unbounded — keep the 50 most
    // recently fetched DIDs.
    const trimmed = pruneCache(next);
    await persistCache(trimmed);
    return new Set(collections);
  } catch (err) {
    console.warn('[aturi:repoScan] describeRepo failed', { did, err });
    return null;
  }
}

const CACHE_MAX = 50;

function pruneCache(cache: Cache): Cache {
  const entries = Object.entries(cache);
  if (entries.length <= CACHE_MAX) return cache;
  entries.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
  return Object.fromEntries(entries.slice(0, CACHE_MAX));
}

/**
 * Read whatever's cached for `did` without triggering a fetch. Returns null
 * when there's no entry — used by the popup's initial render to short-circuit
 * waypoint classification before the live scan completes.
 */
export async function cachedRepoCollections(
  did: string,
): Promise<Set<string> | null> {
  if (!did.startsWith('did:')) return null;
  const cache = await loadCache();
  const cached = cache[did];
  if (!isFresh(cached)) return null;
  return new Set(cached.collections);
}
