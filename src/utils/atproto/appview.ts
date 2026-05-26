/**
 * Bluesky AppView (`public.api.bsky.app`) client for the explorer's
 * engagement overlay (likes / reposts / replies / follower counts).
 */

import type { Agent } from '@atproto/api';
import { APPVIEW } from './config';

export type AppViewPostThread = {
  thread?: {
    post?: {
      uri: string;
      cid: string;
      author?: {
        did: string;
        handle?: string;
        displayName?: string;
        avatar?: string;
      };
      replyCount?: number;
      repostCount?: number;
      likeCount?: number;
      quoteCount?: number;
      indexedAt?: string;
      record?: Record<string, unknown>;
    };
  };
};

export type AppViewProfile = {
  did: string;
  handle?: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  banner?: string;
  pronouns?: string;
  followsCount?: number;
  followersCount?: number;
  postsCount?: number;
  createdAt?: string;
};

async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getProfile(actor: string): Promise<AppViewProfile | null> {
  if (!actor) return null;
  return fetchJsonOrNull<AppViewProfile>(
    `${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`,
  );
}

/**
 * Viewer-specific state the AppView attaches to an authenticated
 * getProfile response — only present when called via a signed-in agent.
 * Used by the explorer's relationship strip to surface "do we follow
 * each other / mutuals" signals.
 */
export type ViewerState = {
  /** AT URI of the viewer's follow record pointing at the target. */
  following?: string;
  /** AT URI of the target's follow record pointing at the viewer. */
  followedBy?: string;
  muted?: boolean;
  blockedBy?: boolean;
  blocking?: string;
};

export type KnownFollowers = {
  count: number;
  followers?: Array<{ did: string; handle?: string; displayName?: string; avatar?: string }>;
};

export type AppViewProfileWithViewer = AppViewProfile & {
  viewer?: ViewerState;
  knownFollowers?: KnownFollowers;
};

/**
 * Authenticated profile lookup that includes the AppView's `viewer` and
 * `knownFollowers` blocks. The unauthenticated `getProfile` above can't
 * compute relationship state — for that we need the AppView call to go
 * through the signed-in agent so it knows who "you" are.
 *
 * Important: an OAuth-authenticated Agent talks to the user's PDS by
 * default. Without an explicit `atproto-proxy` header the PDS forwards
 * `app.bsky.*` calls to the AppView WITHOUT attaching a service-auth
 * token identifying the user, so the AppView treats it as anonymous and
 * the `viewer` block comes back empty. `withProxy('bsky_appview', ...)`
 * sets the header so the PDS signs the proxied request as the user.
 */
export async function getProfileWithViewer(
  agent: Agent,
  actor: string,
): Promise<AppViewProfileWithViewer | null> {
  if (!actor) return null;
  try {
    const proxied = agent.withProxy('bsky_appview', 'did:web:api.bsky.app');
    const res = await proxied.app.bsky.actor.getProfile({ actor });
    return (res?.data ?? res) as AppViewProfileWithViewer;
  } catch (err) {
    // Log so we can see what's actually happening in the console when
    // viewer state goes missing — silent null was eating useful diagnostics.
    console.warn('[appview] getProfileWithViewer failed', { actor, err });
    return null;
  }
}

/** Lightweight actor record returned by typeahead/search endpoints. */
export type ActorTypeaheadResult = {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  description?: string;
};

/**
 * app.bsky.actor.searchActorsTypeahead — prefix-search autocomplete
 * suggestions for handle/display-name lookups. Public, no auth. Returns
 * `[]` when the search yields nothing or the call fails so callers can
 * render gracefully without try/catch.
 */
export async function searchActorsTypeahead(
  q: string,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<ActorTypeaheadResult[]> {
  if (!q) return [];
  const { limit = 8, signal } = opts;
  try {
    const params = new URLSearchParams({ q, limit: String(limit) });
    const res = await fetch(
      `${APPVIEW}/xrpc/app.bsky.actor.searchActorsTypeahead?${params}`,
      { signal },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { actors?: ActorTypeaheadResult[] };
    return Array.isArray(data.actors) ? data.actors : [];
  } catch {
    return [];
  }
}

export async function getPostThread(
  uri: string,
  opts: { depth?: number; parentHeight?: number } = {},
): Promise<AppViewPostThread | null> {
  if (!uri) return null;
  const { depth = 0, parentHeight = 0 } = opts;
  const params = new URLSearchParams({
    uri,
    depth: String(depth),
    parentHeight: String(parentHeight),
  });
  return fetchJsonOrNull<AppViewPostThread>(
    `${APPVIEW}/xrpc/app.bsky.feed.getPostThread?${params}`,
  );
}
