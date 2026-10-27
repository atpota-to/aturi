/**
 * Identity resolution. Bridges the existing top-level didResolver helpers
 * with the explorer's "give me {did, handle, pds}" needs.
 *
 *   resolveHandle(handle) — appview first, falls back to bsky.social.
 *   resolveIdentifier(input) — accepts handle | did | at://… and returns
 *     the canonical identity bundle the explorer pages depend on.
 */

import { withIdentification } from '../requestDeadline';
import {
  resolveDidToHandle,
  resolvePdsEndpoint,
  type DidDocument,
} from '../didResolver';
import { APPVIEW, HANDLE_RESOLVER_FALLBACK, RELAY } from './config';
import { describeRepo, getRepoStatus } from './pdsClient';
import { TTLMap } from './cache';

export type IdentityBundle = {
  did: string;
  handle: string | null;
  pds: string;
  /**
   * Set only when the account's PDS reports the repo as inactive — taken
   * down, suspended, deactivated, deleted. Null in the ordinary case, and
   * also when a repo read simply failed (a PDS that's down or unreachable
   * says nothing about the account, so callers keep showing the raw error
   * rather than a status they never got).
   */
  repoStatus: InactiveRepo | null;
};

/**
 * Why an account's repo won't serve reads, straight from the host that
 * refused. Deliberately just the two facts the PDS hands over in one extra
 * request: this sits on the path to first paint, so anything that needs a
 * third-party lookup (the head rev, whether the handle still resolves) is
 * left to the components that display it.
 */
export type InactiveRepo = {
  /** `status` from com.atproto.sync.getRepoStatus, verbatim. */
  status: string | null;
  /** The repo read error that prompted the status lookup. */
  error: string;
};

const HANDLE_TTL = 5 * 60_000;
const handleToDidCache = new TTLMap<string, string>(HANDLE_TTL);

async function tryFetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, withIdentification());
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Resolve a handle to a DID. Tries the AppView first, falls back to the
 * bsky.social PDS (which can resolve handles served via DNS even when the
 * appview hasn't seen them yet).
 */
export async function resolveHandle(handle: string): Promise<string | null> {
  if (!handle) return null;
  if (handle.startsWith('did:')) return handle;
  const cached = handleToDidCache.get(handle);
  if (cached) return cached;

  const qs = `handle=${encodeURIComponent(handle)}`;
  const resolved =
    (await tryFetchJson<{ did?: string }>(
      `${APPVIEW}/xrpc/com.atproto.identity.resolveHandle?${qs}`,
    ))?.did ??
    (await tryFetchJson<{ did?: string }>(
      `${HANDLE_RESOLVER_FALLBACK}/xrpc/com.atproto.identity.resolveHandle?${qs}`,
    ))?.did ??
    null;

  if (resolved) handleToDidCache.set(handle, resolved);
  return resolved;
}

const DID_HANDLE_TTL = 30 * 60_000;
const didToHandleCache = new TTLMap<string, string | null>(DID_HANDLE_TTL);
const didHandleInflight = new Map<string, Promise<string | null>>();

/**
 * Reverse-resolve a DID to its primary handle (the at:// entry in the DID
 * document's alsoKnownAs). Cached and de-duped so a record full of the same
 * DID — or repeated visits — doesn't re-hit plc.directory / the did:web host.
 * Returns null when the DID has no handle or resolution fails.
 */
export async function resolveDidHandle(did: string): Promise<string | null> {
  if (!did || !did.startsWith('did:')) return null;
  const cached = didToHandleCache.get(did);
  if (cached !== undefined) return cached;
  const existing = didHandleInflight.get(did);
  if (existing) return existing;
  const pending = resolveDidToHandle(did)
    .then((handle) => {
      didToHandleCache.set(did, handle);
      return handle;
    })
    .catch(() => null)
    .finally(() => {
      didHandleInflight.delete(did);
    });
  didHandleInflight.set(did, pending);
  return pending;
}

/**
 * Normalize a user-supplied identifier (handle, DID, or at://… URI) into
 * `{ did, handle, pds }`. Throws on failure.
 */
export async function resolveIdentifier(input: string): Promise<IdentityBundle> {
  const trimmed = String(input || '').trim();
  if (!trimmed) throw new Error('resolveIdentifier: empty input');

  // at:// URI shortcut — extract the repo segment.
  let target = trimmed;
  if (target.startsWith('at://')) {
    const m = target.match(/^at:\/\/([^/]+)/);
    if (m) target = m[1];
  }
  // People commonly write handles with the presentation-only @ prefix.
  // AT Protocol's resolver expects the bare handle.
  target = target.replace(/^@/, '');

  const resolved = await resolvePdsEndpoint(target);
  if (!resolved) throw new Error(`Could not resolve ${trimmed}`);
  const pds = resolved.pdsEndpoint.replace(/\/$/, '');

  let handle: string | null = null;
  let repoStatus: InactiveRepo | null = null;
  try {
    const desc = await describeRepo(pds, resolved.did);
    handle = desc?.handle || null;
  } catch (err) {
    // describeRepo is the explorer's first read into a repo, so it's also
    // where an inactive account first shows up: an opaque 400 that names
    // neither the handle nor the reason. Both are still recoverable. The DID
    // document is already in hand and carries the handle, and getRepoStatus
    // answers for repos that refuse every other read.
    handle = didDocHandle(resolved.didDoc);
    repoStatus = await inspectInactiveRepo(pds, resolved.did, err);
  }
  return { did: resolved.did, handle, pds, repoStatus };
}

/**
 * The handle a DID document claims: the first `at://` entry in alsoKnownAs.
 * A claim, not a verification — the DID's controller writes this field, and
 * nothing here checks that it still resolves back to the DID. The status
 * banner runs that check itself, where the round trip doesn't hold up a page.
 */
function didDocHandle(doc: DidDocument | null | undefined): string | null {
  const aka = doc?.alsoKnownAs?.find((entry) => entry.startsWith('at://'));
  return aka ? aka.slice('at://'.length) || null : null;
}

/**
 * Ask the PDS why a repo read failed.
 *
 * Returns null unless the host affirmatively reports the repo inactive, so an
 * unreachable or broken PDS keeps today's behaviour (the caller surfaces its
 * raw error) instead of being labelled with a status nobody supplied.
 */
async function inspectInactiveRepo(
  pds: string,
  did: string,
  cause: unknown,
): Promise<InactiveRepo | null> {
  const status = await getRepoStatus(pds, did).catch(() => null);
  if (!status || status.active !== false) return null;
  return {
    status: status.status || null,
    error: cause instanceof Error ? cause.message : String(cause),
  };
}

const REPO_REV_TTL = 5 * 60_000;
const repoRevCache = new TTLMap<string, string | null>(REPO_REV_TTL);
const repoRevInflight = new Map<string, Promise<string | null>>();

/**
 * The head rev of a repo its own PDS has stopped describing.
 *
 * getRepoStatus is implemented by relays as well as by PDSs, and a relay
 * answers it with the newest rev it holds for the repo — the one piece of
 * "when did this account last do anything" that survives the account going
 * inactive. Read it as the last write with that caveat attached: it is the
 * relay's newest rev, not the PDS confirming a commit.
 *
 * Cached and de-duped, because the status banner and the stats grid both
 * want it on the same page load, and returns null rather than throwing so
 * either can render without a catch.
 */
export async function getInactiveRepoRev(did: string): Promise<string | null> {
  const cached = repoRevCache.get(did);
  if (cached !== undefined) return cached;
  const existing = repoRevInflight.get(did);
  if (existing) return existing;
  const pending = getRepoStatus(RELAY, did)
    .then((status) => status.rev || null)
    .catch(() => null)
    .then((rev) => {
      repoRevCache.set(did, rev);
      return rev;
    })
    .finally(() => {
      repoRevInflight.delete(did);
    });
  repoRevInflight.set(did, pending);
  return pending;
}

/**
 * List the collection NSIDs held in a repo. Resolves the DID's PDS and calls
 * describeRepo. Returns null on any failure (unresolvable identity, no PDS,
 * network error) so callers keep the "unknown" state rather than treating a
 * failed scan as "this repo has no records". An empty array is a real answer
 * — the repo exists but holds no collections.
 *
 * Feeds the profile waypoint picker's `waypointActivity` check so clients the
 * account has no records for (no `sh.tangled.*`, no `social.grain.*`, …) can
 * be hidden.
 */
export async function fetchRepoCollections(did: string): Promise<string[] | null> {
  if (!did || !did.startsWith('did:')) return null;
  try {
    const resolved = await resolvePdsEndpoint(did);
    if (!resolved) return null;
    const desc = await describeRepo(
      resolved.pdsEndpoint.replace(/\/$/, ''),
      resolved.did,
    );
    return Array.isArray(desc.collections) ? desc.collections : null;
  } catch {
    return null;
  }
}
