/**
 * Identity resolution. Bridges the existing top-level didResolver helpers
 * with the explorer's "give me {did, handle, pds}" needs.
 *
 *   resolveHandle(handle) — appview first, falls back to bsky.social.
 *   resolveIdentifier(input) — accepts handle | did | at://… and returns
 *     the canonical identity bundle the explorer pages depend on.
 */

import { resolveDidToHandle, resolvePdsEndpoint } from '../didResolver';
import { APPVIEW, HANDLE_RESOLVER_FALLBACK } from './config';
import { describeRepo } from './pdsClient';
import { TTLMap } from './cache';

export type IdentityBundle = {
  did: string;
  handle: string | null;
  pds: string;
};

const HANDLE_TTL = 5 * 60_000;
const handleToDidCache = new TTLMap<string, string>(HANDLE_TTL);

async function tryFetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
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

  let handle: string | null = null;
  try {
    const desc = await describeRepo(resolved.pdsEndpoint.replace(/\/$/, ''), resolved.did);
    handle = desc?.handle || null;
  } catch {
    // describeRepo failures are non-fatal — the explorer still works by DID.
  }
  return {
    did: resolved.did,
    handle,
    pds: resolved.pdsEndpoint.replace(/\/$/, ''),
  };
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
