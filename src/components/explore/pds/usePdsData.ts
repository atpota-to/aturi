'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from 'react';
import { standingOf } from '@/lib/pdsExplorer';
import { getProfile, type AppViewProfile } from '@/utils/atproto/appview';
import {
  backlinkDetailsVersion,
  cachedProfile,
  loadProfiles,
  subscribeBacklinkDetails,
} from '@/utils/atproto/backlinkDetails';
import { describeRepo, type DescribeRepoResponse } from '@/utils/atproto/pdsClient';
import {
  describeServer,
  getProtectedResourceMetadata,
  getServerHealth,
  listRepos,
  type RepoEntry,
  type ServerDescription,
  type ServerHealth,
} from '@/utils/atproto/pdsServer';
import { tidToDate } from '@/utils/atproto/tid';

/**
 * What the PDS explorer reads from a host, kept for the visit and shared by
 * every pane that shows it: the rail's counts, the overview, the accounts
 * list and the classic page all read one listing, so switching views or
 * coming back from an account never lists the host again.
 *
 *   server     describeServer, _health and the OAuth protected-resource
 *              metadata, each optional but the first
 *   accounts   listRepos, a thousand at a time (the lexicon's maximum), the
 *              first page as soon as anything asks
 *   names      handles, display names and avatars from the AppView's profile
 *              cache (getProfiles, 25 a request, shared with the backlinks
 *              lists), and for an account the AppView doesn't know, the
 *              host's own describeRepo, a few at a time
 */

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A value per key that components subscribe to. */
function keyedStore<T>() {
  const values = new Map<string, T>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    get: (key: string) => values.get(key),
    set(key: string, value: T) {
      values.set(key, value);
      listeners.get(key)?.forEach((listener) => listener());
    },
    subscribe(key: string, listener: () => void) {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      const own = set;
      own.add(listener);
      return () => {
        own.delete(listener);
      };
    },
  };
}

// ─── The server ──────────────────────────────────────────────────────────────

export type PdsServer = {
  info: ServerDescription | null;
  /** describeServer failed: not a PDS, or not answering. */
  error: string | null;
  health: ServerHealth | null;
  /** The authorization servers its accounts sign in through. Null until known, or when it doesn't say. */
  authServers: string[] | null;
};

const EMPTY_SERVER: PdsServer = { info: null, error: null, health: null, authServers: null };
const servers = keyedStore<PdsServer>();

function startServer(base: string) {
  if (servers.get(base)) return;
  servers.set(base, EMPTY_SERVER);
  const patch = (next: Partial<PdsServer>) => servers.set(base, { ...(servers.get(base) ?? EMPTY_SERVER), ...next });
  describeServer(base).then(
    (info) => patch({ info }),
    (err) => patch({ error: message(err) }),
  );
  // Both best-effort: older and non-reference PDSs answer neither, and
  // neither says anything is wrong with the host.
  getServerHealth(base).then(
    (health) => patch({ health }),
    () => {},
  );
  getProtectedResourceMetadata(base).then(
    (meta) => {
      const list = Array.isArray(meta.authorization_servers)
        ? meta.authorization_servers.filter((s): s is string => typeof s === 'string' && /^https?:\/\//.test(s))
        : [];
      if (list.length) patch({ authServers: list });
    },
    () => {},
  );
}

export function usePdsServer(base: string): PdsServer {
  const subscribe = useCallback((listener: () => void) => servers.subscribe(base, listener), [base]);
  const value = useSyncExternalStore(
    subscribe,
    () => servers.get(base) ?? EMPTY_SERVER,
    () => EMPTY_SERVER,
  );
  useEffect(() => startServer(base), [base]);
  return value;
}

// ─── The accounts ────────────────────────────────────────────────────────────

/** listRepos' maximum. A busy host lists hundreds of thousands, so pages, not everything. */
export const REPO_PAGE = 1000;

export type PdsRepos = {
  repos: RepoEntry[];
  cursor: string | undefined;
  /** Nothing more to list: the host said so, or sent an empty page. */
  done: boolean;
  loading: boolean;
  /** The last page failed. A host that refuses to list at all (bsky.social does) fails the first. */
  error: string | null;
};

const EMPTY_REPOS: PdsRepos = { repos: [], cursor: undefined, done: false, loading: false, error: null };
const repoStore = keyedStore<PdsRepos>();

async function loadRepoPage(base: string): Promise<void> {
  const before = repoStore.get(base) ?? EMPTY_REPOS;
  if (before.loading || before.done) return;
  repoStore.set(base, { ...before, loading: true, error: null });
  try {
    const res = await listRepos(base, { limit: REPO_PAGE, cursor: before.cursor });
    const batch = Array.isArray(res.repos) ? res.repos.filter((r) => r && typeof r.did === 'string') : [];
    const now = repoStore.get(base) ?? before;
    // A host's pages can overlap at their edges; an account is listed once.
    const seen = new Set(now.repos.map((r) => r.did));
    const fresh = batch.filter((r) => !seen.has(r.did) && Boolean(seen.add(r.did)));
    repoStore.set(base, {
      repos: fresh.length ? [...now.repos, ...fresh] : now.repos,
      cursor: res.cursor,
      // A cursor that doesn't move would page forever.
      done: !res.cursor || batch.length === 0 || res.cursor === before.cursor,
      loading: false,
      error: null,
    });
  } catch (err) {
    repoStore.set(base, { ...(repoStore.get(base) ?? before), loading: false, error: message(err) });
  }
}

/** The host's listing, the first page fetched on first use; `loadMore` asks for the next. */
export function usePdsRepos(base: string): PdsRepos & { loadMore: () => void } {
  const subscribe = useCallback((listener: () => void) => repoStore.subscribe(base, listener), [base]);
  const state = useSyncExternalStore(
    subscribe,
    () => repoStore.get(base) ?? EMPTY_REPOS,
    () => EMPTY_REPOS,
  );
  useEffect(() => {
    if (!repoStore.get(base)) void loadRepoPage(base);
  }, [base]);
  const loadMore = useCallback(() => void loadRepoPage(base), [base]);
  return { ...state, loadMore };
}

/** An account as the explorer sorts, filters and draws it. */
export type AccountRow = {
  did: string;
  /** Its place in the host's listing. */
  index: number;
  /** `active`, or why it isn't (pdsExplorer.ts, standingOf). */
  standing: string;
  /** When its repo last changed: its head commit's rev, a TID. */
  date: Date | null;
  rev: string | null;
  head: string | null;
};

export function useAccountRows(repos: readonly RepoEntry[]): AccountRow[] {
  return useMemo(
    () =>
      repos.map((r, index) => ({
        did: r.did,
        index,
        standing: standingOf(r),
        date: r.rev ? tidToDate(r.rev) : null,
        rev: r.rev ?? null,
        head: r.head ?? null,
      })),
    [repos],
  );
}

// ─── Names ───────────────────────────────────────────────────────────────────

export type AccountName = {
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
};

// Handles the host gave for accounts the AppView doesn't know. Keyed by DID:
// a handle is the account's, whichever host is asked.
const pdsHandles = new Map<string, string | null>();
const pendingHandles = new Set<string>();
const handleListeners = new Set<() => void>();
let handlesVersion = 0;

function subscribeHandles(listener: () => void) {
  handleListeners.add(listener);
  return () => {
    handleListeners.delete(listener);
  };
}

function usable(handle: string | undefined | null): string | null {
  return handle && handle !== 'handle.invalid' ? handle : null;
}

/**
 * What's known of an account's name: undefined while its profile is still
 * being asked for, otherwise whatever the AppView and the host have said.
 */
export function nameOf(did: string): AccountName | undefined {
  const profile = cachedProfile(did);
  if (profile === undefined) return undefined;
  if (profile === null) return { handle: pdsHandles.get(did) ?? null, displayName: null, avatar: null };
  return {
    handle: usable(profile.handle) ?? pdsHandles.get(did) ?? null,
    displayName: profile.displayName?.trim() || null,
    avatar: profile.avatar || null,
  };
}

/**
 * Re-renders as names arrive, from either source. The number changes
 * whenever any name does, for memos that read `nameOf`.
 */
export function useNamesVersion(): number {
  const profiles = useSyncExternalStore(subscribeBacklinkDetails, backlinkDetailsVersion, () => 0);
  const handles = useSyncExternalStore(subscribeHandles, () => handlesVersion, () => 0);
  return profiles + handles;
}

/**
 * The AppView asked a hundred accounts at a time, one hundred after another,
 * in the order given: a list asks in the order it shows, so what's on
 * screen is named first. Restarting with a new order skips whatever has
 * already been asked.
 */
const PROFILE_CHUNK = 100;

export function useLoadProfiles(dids: readonly string[]): void {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < dids.length && !cancelled; i += PROFILE_CHUNK) {
        const chunk = dids.slice(i, i + PROFILE_CHUNK).filter((did) => cachedProfile(did) === undefined);
        if (chunk.length) await loadProfiles(chunk);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dids]);
}

// A list renders a row per account and a busy host lists thousands, so the
// host's own lookups for accounts the AppView doesn't know go out a few at a
// time; rows fill in as slots free up.
const HANDLE_LOOKUP_CONCURRENCY = 6;
let activeLookups = 0;
const lookupWaiters: (() => void)[] = [];

function acquireLookupSlot(): Promise<void> {
  if (activeLookups < HANDLE_LOOKUP_CONCURRENCY) {
    activeLookups++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => lookupWaiters.push(resolve));
}

function releaseLookupSlot(): void {
  const next = lookupWaiters.shift();
  if (next) next();
  else activeLookups--;
}

async function describeRepoLimited(base: string, did: string) {
  await acquireLookupSlot();
  try {
    return await describeRepo(base, did);
  } finally {
    releaseLookupSlot();
  }
}

/**
 * For a row on screen whose account the AppView doesn't know: ask the host.
 * An inactive account's host won't describe it either, and the row keeps its
 * DID.
 */
export function useHostHandle(base: string, did: string, wanted: boolean): void {
  useEffect(() => {
    if (!wanted || pdsHandles.has(did) || pendingHandles.has(did)) return;
    pendingHandles.add(did);
    describeRepoLimited(base, did)
      .then(
        (res) => pdsHandles.set(did, usable(res.handle)),
        () => pdsHandles.set(did, null),
      )
      .finally(() => {
        pendingHandles.delete(did);
        handlesVersion++;
        handleListeners.forEach((listener) => listener());
      });
  }, [base, did, wanted]);
}

// ─── One account ─────────────────────────────────────────────────────────────

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };
type Entry<T> = { promise: Promise<T>; settled?: Settled<T> };
const reads = new Map<string, Entry<unknown>>();

/** A read made once per key for the visit, its answer shared by whoever asks. */
function useCachedRead<T>(key: string | null, load: () => Promise<T>): { data: T | undefined; error: string | null } {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (!key) return undefined;
    let entry = reads.get(key) as Entry<T> | undefined;
    if (!entry) {
      const created: Entry<T> = { promise: loadRef.current() };
      created.promise.then(
        (value) => {
          created.settled = { ok: true, value };
        },
        (err) => {
          created.settled = { ok: false, error: message(err) };
        },
      );
      reads.set(key, created);
      entry = created;
    }
    if (entry.settled) return undefined;
    let cancelled = false;
    entry.promise.then(
      () => !cancelled && rerender(),
      () => !cancelled && rerender(),
    );
    return () => {
      cancelled = true;
    };
  }, [key]);
  const settled = key ? (reads.get(key) as Entry<T> | undefined)?.settled : undefined;
  return { data: settled?.ok ? settled.value : undefined, error: settled && !settled.ok ? settled.error : null };
}

/** The host's description of one repo: its handle, whether that checks out, and its collections. */
export function useDescribedRepo(base: string, did: string) {
  return useCachedRead<DescribeRepoResponse>(`describe|${base}|${did}`, () => describeRepo(base, did));
}

/** One account's whole AppView profile: its bio and counts. Null when the AppView doesn't know it. */
export function useFullProfile(did: string) {
  return useCachedRead<AppViewProfile | null>(`profile|${did}`, () => getProfile(did));
}
