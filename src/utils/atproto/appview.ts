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

async function fetchJsonOrNull<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { signal });
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

/**
 * app.bsky.actor.getProfiles — batch profile lookup, 25 actors per request.
 *
 * Any page that renders a list of DIDs (a feedback board's authors, a
 * backlink list) would otherwise issue one `getProfile` per row. This chunks
 * the set and returns what the AppView knows, keyed by DID. Actors it has
 * never seen — accounts on a PDS the AppView doesn't index — are simply
 * absent, so callers should fall back to identity resolution rather than
 * treat a miss as an error.
 */
export async function getProfiles(
  actors: readonly string[],
  opts: { signal?: AbortSignal } = {},
): Promise<Map<string, AppViewProfile>> {
  const out = new Map<string, AppViewProfile>();
  const unique = Array.from(new Set(actors.filter(Boolean)));
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 25) chunks.push(unique.slice(i, i + 25));

  await Promise.all(
    chunks.map(async (chunk) => {
      const params = new URLSearchParams();
      chunk.forEach((actor) => params.append('actors', actor));
      const data = await fetchJsonOrNull<{ profiles?: AppViewProfile[] }>(
        `${APPVIEW}/xrpc/app.bsky.actor.getProfiles?${params}`,
        opts.signal,
      );
      for (const profile of data?.profiles ?? []) {
        if (profile?.did) out.set(profile.did, profile);
      }
    }),
  );

  return out;
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

/**
 * Minimum query length before the sign-in box will ask the AppView anything.
 *
 * Deliberately longer than the explorer's search box (which starts at 2). The
 * sign-in field is pre-authentication: each request tells a third party
 * (public.api.bsky.app) which account is about to authenticate, which the
 * explorer's search box — a public-lookup surface by definition — doesn't
 * reveal. Three characters is short enough that suggestions still arrive
 * while a handle is being typed, and long enough that a stray keystroke in a
 * focused field doesn't broadcast a prefix.
 */
export const HANDLE_TYPEAHEAD_MIN_LENGTH = 3;

/**
 * Whether a sign-in input's current value is worth a typeahead lookup.
 *
 * The AppView typeahead is handle/display-name oriented, so DIDs and at://
 * URIs are skipped outright rather than sent and discarded. A value that
 * already carries a scheme or a path separator isn't a handle either.
 *
 * Note what this does NOT do: returning `false` only means "don't ask the
 * AppView". Every value remains submittable — handles on a self-hosted or
 * non-Bluesky PDS never appear in these results at all, so suggestions are
 * an additive convenience and never a validity check.
 */
export function shouldQueryHandleTypeahead(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < HANDLE_TYPEAHEAD_MIN_LENGTH) return false;
  if (trimmed.startsWith('did:') || trimmed.startsWith('at://')) return false;
  if (trimmed.includes('/') || trimmed.includes(' ')) return false;
  return true;
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

/**
 * The recursive node shape getPostThread actually returns once depth or
 * parentHeight is non-zero. AppViewPostThread above types only the top post
 * (all its existing callers need); consumers that walk the tree read the
 * response through this instead. `$type` distinguishes real posts from
 * blocked/not-found placeholders.
 */
export type AppViewThreadNode = {
  $type?: string;
  post?: {
    uri: string;
    cid: string;
    author?: { did: string; handle?: string; displayName?: string; avatar?: string };
    record?: Record<string, unknown>;
    replyCount?: number;
    repostCount?: number;
    likeCount?: number;
    quoteCount?: number;
    indexedAt?: string;
  };
  parent?: AppViewThreadNode;
  replies?: AppViewThreadNode[];
};

/** A post as returned by search/feed endpoints. */
export type AppViewPostView = {
  uri: string;
  cid: string;
  author?: { did: string; handle?: string; displayName?: string; avatar?: string };
  record?: Record<string, unknown>;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt?: string;
};

export type SearchPostsPage = {
  posts?: AppViewPostView[];
  cursor?: string;
  hitsTotal?: number;
};

/**
 * app.bsky.feed.searchPosts — full-text post search. Public, no auth, but
 * the most rate-limit-sensitive endpoint this module touches; callers
 * should keep limits modest and cache where they can. Returns null on any
 * failure so call sites can distinguish "no results" from "search down".
 */
export async function searchPosts(opts: {
  q: string;
  sort?: 'top' | 'latest';
  since?: string;
  until?: string;
  author?: string;
  lang?: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<SearchPostsPage | null> {
  const { q, sort, since, until, author, lang, limit = 25, cursor, signal } = opts;
  if (!q) return null;
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (sort) params.set('sort', sort);
  if (since) params.set('since', since);
  if (until) params.set('until', until);
  if (author) params.set('author', author);
  if (lang) params.set('lang', lang);
  if (cursor) params.set('cursor', cursor);
  return fetchJsonOrNull<SearchPostsPage>(
    `${APPVIEW}/xrpc/app.bsky.feed.searchPosts?${params}`,
    signal,
  );
}

export type SearchActorsPage = {
  actors?: AppViewProfile[];
  cursor?: string;
};

/**
 * app.bsky.actor.searchActors — full actor search with complete profiles,
 * where searchActorsTypeahead above returns prefix suggestions. Returns
 * null on failure, an empty actors array on a real "no matches".
 */
export async function searchActors(
  q: string,
  opts: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<SearchActorsPage | null> {
  if (!q) return null;
  const { limit = 10, cursor, signal } = opts;
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return fetchJsonOrNull<SearchActorsPage>(
    `${APPVIEW}/xrpc/app.bsky.actor.searchActors?${params}`,
    signal,
  );
}
