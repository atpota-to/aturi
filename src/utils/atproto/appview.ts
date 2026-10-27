/**
 * Bluesky AppView (`public.api.bsky.app`) client for the explorer's
 * engagement overlay (likes / reposts / replies / follower counts).
 */

import { withIdentification } from '../requestDeadline';
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
    const res = await fetch(url, withIdentification({ signal }));
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
  return (await getProfilesResult(actors, opts)).profiles;
}

/**
 * Failure-aware variant of {@link getProfiles}.
 *
 * The plain version cannot distinguish "the AppView has never indexed these
 * accounts" from "the AppView did not answer", because both end as an empty
 * map. A page rendering avatars can treat those the same; a caller that
 * reports "not found" as a fact cannot, so this returns whether any chunk
 * failed.
 */
export async function getProfilesResult(
  actors: readonly string[],
  opts: { signal?: AbortSignal } = {},
): Promise<{ profiles: Map<string, AppViewProfile>; failed: boolean }> {
  const out = new Map<string, AppViewProfile>();
  const unique = Array.from(new Set(actors.filter(Boolean)));
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 25) chunks.push(unique.slice(i, i + 25));

  const outcomes = await Promise.all(
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
      return data !== null;
    }),
  );

  return { profiles: out, failed: outcomes.some((ok) => !ok) };
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
      withIdentification({ signal }),
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

/** One item in an author feed: a post, optionally reposted or a reply. */
export type AuthorFeedItem = {
  post: AppViewPostView;
  reason?: { $type?: string; by?: { did: string; handle?: string; displayName?: string } };
  reply?: unknown;
};

export type AuthorFeedPage = {
  feed?: AuthorFeedItem[];
  cursor?: string;
};

/**
 * app.bsky.feed.getAuthorFeed — an account's own posts, in reverse
 * chronological order, each carrying the AppView's engagement counts
 * (likes/reposts/replies/quotes). Public, no auth. `filter` narrows what the
 * feed includes; the default matches the AppView's own default.
 */
export async function getAuthorFeed(opts: {
  actor: string;
  filter?:
    | 'posts_with_replies'
    | 'posts_no_replies'
    | 'posts_with_media'
    | 'posts_and_author_threads';
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<AuthorFeedPage | null> {
  const { actor, filter, limit = 30, cursor, signal } = opts;
  if (!actor) return null;
  const params = new URLSearchParams({ actor, limit: String(limit) });
  if (filter) params.set('filter', filter);
  if (cursor) params.set('cursor', cursor);
  return fetchJsonOrNull<AuthorFeedPage>(
    `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?${params}`,
    signal,
  );
}

/** A trending topic from getTrends. `link` is an app-relative feed path. */
export type TrendView = {
  topic: string;
  displayName?: string;
  description?: string;
  link?: string;
  startedAt?: string;
  postCount?: number;
  status?: string;
  category?: string;
  actors?: AppViewProfile[];
};

export type TrendsPage = { trends?: TrendView[] };

/**
 * app.bsky.unspecced.getTrends — current trending topics with post volume.
 * "unspecced" means Bluesky may change or remove it without notice; callers
 * should treat a null return as "trends unavailable" and not depend on the
 * exact field set. Public, no auth.
 */
export async function getTrends(
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<TrendsPage | null> {
  const { limit = 10, signal } = opts;
  const params = new URLSearchParams({ limit: String(limit) });
  return fetchJsonOrNull<TrendsPage>(
    `${APPVIEW}/xrpc/app.bsky.unspecced.getTrends?${params}`,
    signal,
  );
}

export type GraphPage = {
  subject?: AppViewProfile;
  follows?: AppViewProfile[];
  followers?: AppViewProfile[];
  cursor?: string;
};

/**
 * app.bsky.graph.getFollows / getFollowers — the accounts an actor follows,
 * or that follow the actor. One page. Public, no auth. `direction` picks the
 * endpoint; the result array is keyed by the same word.
 */
export async function getSocialGraph(opts: {
  actor: string;
  direction: 'follows' | 'followers';
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<GraphPage | null> {
  const { actor, direction, limit = 50, cursor, signal } = opts;
  if (!actor) return null;
  const method = direction === 'follows' ? 'getFollows' : 'getFollowers';
  const params = new URLSearchParams({ actor, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return fetchJsonOrNull<GraphPage>(
    `${APPVIEW}/xrpc/app.bsky.graph.${method}?${params}`,
    signal,
  );
}

export type PostEngagementPage = {
  uri?: string;
  /** getLikes returns {actor, createdAt}; getRepostedBy/getQuotes return profiles/posts. */
  likes?: Array<{ actor: AppViewProfile; createdAt?: string; indexedAt?: string }>;
  repostedBy?: AppViewProfile[];
  posts?: AppViewPostView[];
  cursor?: string;
};

/**
 * The three "who engaged with this post" endpoints:
 * app.bsky.feed.getLikes / getRepostedBy / getQuotes. One page, public, no
 * auth. `kind` picks the endpoint and which array in the result is populated.
 */
export async function getPostEngagement(opts: {
  uri: string;
  kind: 'likes' | 'reposts' | 'quotes';
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<PostEngagementPage | null> {
  const { uri, kind, limit = 25, cursor, signal } = opts;
  if (!uri) return null;
  const method = kind === 'likes' ? 'getLikes' : kind === 'reposts' ? 'getRepostedBy' : 'getQuotes';
  const params = new URLSearchParams({ uri, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return fetchJsonOrNull<PostEngagementPage>(
    `${APPVIEW}/xrpc/app.bsky.feed.${method}?${params}`,
    signal,
  );
}

/** A custom feed generator's public record view. */
export type FeedGeneratorView = {
  uri: string;
  cid: string;
  did: string;
  creator?: AppViewProfile;
  displayName?: string;
  description?: string;
  avatar?: string;
  likeCount?: number;
  indexedAt?: string;
};

export type FeedGeneratorsPage = { feeds?: FeedGeneratorView[]; cursor?: string };

/**
 * The three ways to list feed generators, all public and unauthenticated:
 * an actor's own feeds (app.bsky.feed.getActorFeeds), the network's most
 * popular (app.bsky.unspecced.getPopularFeedGenerators), and Bluesky's
 * editorial suggestions (app.bsky.unspecced.getSuggestedFeeds). The two
 * unspecced ones may change without notice; `actor` is required only by the
 * first.
 */
export async function listFeedGenerators(opts: {
  source: 'actor' | 'popular' | 'suggested';
  actor?: string;
  query?: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<FeedGeneratorsPage | null> {
  const { source, actor, query, limit = 25, cursor, signal } = opts;
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);

  let method: string;
  if (source === 'actor') {
    if (!actor) return null;
    params.set('actor', actor);
    method = 'app.bsky.feed.getActorFeeds';
  } else if (source === 'popular') {
    if (query) params.set('query', query);
    method = 'app.bsky.unspecced.getPopularFeedGenerators';
  } else {
    // getSuggestedFeeds caps limit at 25 where its two siblings allow 50, and
    // answers 400 above it. Clamp rather than fail: the caller asked for "as
    // many as you have", not for an error.
    params.set('limit', String(Math.min(limit, 25)));
    method = 'app.bsky.unspecced.getSuggestedFeeds';
  }
  return fetchJsonOrNull<FeedGeneratorsPage>(`${APPVIEW}/xrpc/${method}?${params}`, signal);
}

/**
 * app.bsky.feed.getFeedGenerators — hydrate specific feed generator URIs
 * into their views, including whether the AppView considers each online.
 */
export async function getFeedGenerators(
  uris: readonly string[],
  opts: { signal?: AbortSignal } = {},
): Promise<FeedGeneratorsPage | null> {
  if (!uris.length) return null;
  const params = new URLSearchParams();
  for (const uri of uris) params.append('feeds', uri);
  return fetchJsonOrNull<FeedGeneratorsPage>(
    `${APPVIEW}/xrpc/app.bsky.feed.getFeedGenerators?${params}`,
    opts.signal,
  );
}

export type FeedSkeletonPage = {
  feed?: Array<{ post: AppViewPostView; feedContext?: string }>;
  cursor?: string;
};

/**
 * app.bsky.feed.getFeed — the posts a custom feed generator is serving right
 * now. Public for feeds that don't require auth; a feed whose generator is
 * offline or gated answers non-2xx, which surfaces here as null.
 */
export async function getFeed(opts: {
  feed: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<FeedSkeletonPage | null> {
  const { feed, limit = 25, cursor, signal } = opts;
  if (!feed) return null;
  const params = new URLSearchParams({ feed, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return fetchJsonOrNull<FeedSkeletonPage>(`${APPVIEW}/xrpc/app.bsky.feed.getFeed?${params}`, signal);
}

/**
 * app.bsky.feed.getListFeed — posts from every member of a curation list,
 * which is how "list feeds" are read. Same shape as getFeed.
 */
export async function getListFeed(opts: {
  list: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<FeedSkeletonPage | null> {
  const { list, limit = 25, cursor, signal } = opts;
  if (!list) return null;
  const params = new URLSearchParams({ list, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return fetchJsonOrNull<FeedSkeletonPage>(
    `${APPVIEW}/xrpc/app.bsky.feed.getListFeed?${params}`,
    signal,
  );
}

/** A curation or moderation list. `purpose` is the lexicon's list purpose. */
export type ListView = {
  uri: string;
  cid: string;
  name?: string;
  purpose?: string;
  description?: string;
  avatar?: string;
  listItemCount?: number;
  indexedAt?: string;
  creator?: AppViewProfile;
};

export type ListPage = {
  list?: ListView;
  items?: Array<{ uri: string; subject: AppViewProfile }>;
  cursor?: string;
};

export type ListsPage = { lists?: ListView[]; cursor?: string };

/** app.bsky.graph.getList — one list's metadata plus a page of its members. */
export async function getList(opts: {
  list: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<ListPage | null> {
  const { list, limit = 50, cursor, signal } = opts;
  if (!list) return null;
  const params = new URLSearchParams({ list, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return fetchJsonOrNull<ListPage>(`${APPVIEW}/xrpc/app.bsky.graph.getList?${params}`, signal);
}

/** app.bsky.graph.getLists — the lists an actor has created. */
export async function getLists(opts: {
  actor: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<ListsPage | null> {
  const { actor, limit = 25, cursor, signal } = opts;
  if (!actor) return null;
  const params = new URLSearchParams({ actor, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return fetchJsonOrNull<ListsPage>(`${APPVIEW}/xrpc/app.bsky.graph.getLists?${params}`, signal);
}

/**
 * app.bsky.feed.getPosts — hydrate up to 25 post URIs into full views with
 * engagement counts, in one request. The counterpart to get_record for the
 * Bluesky layer: same posts, but with the AppView's aggregates attached.
 */
export async function getPosts(
  uris: readonly string[],
  opts: { signal?: AbortSignal } = {},
): Promise<{ posts?: AppViewPostView[] } | null> {
  if (!uris.length) return null;
  const params = new URLSearchParams();
  for (const uri of uris) params.append('uris', uri);
  return fetchJsonOrNull<{ posts?: AppViewPostView[] }>(
    `${APPVIEW}/xrpc/app.bsky.feed.getPosts?${params}`,
    opts.signal,
  );
}

/**
 * app.bsky.graph.getSuggestedFollowsByActor — accounts the AppView considers
 * similar to one actor, which is public.
 *
 * The sibling app.bsky.actor.getSuggestions (the network-wide starting-point
 * list) is deliberately not wrapped here: unauthenticated it answers
 * `{"actors":[]}` every time, so exposing it would only promise something
 * that never arrives.
 */
export async function getFollowSuggestions(opts: {
  actor: string;
  signal?: AbortSignal;
}): Promise<{ actors?: AppViewProfile[]; suggestions?: AppViewProfile[] } | null> {
  const { actor, signal } = opts;
  if (!actor) return null;
  const params = new URLSearchParams({ actor });
  return fetchJsonOrNull(
    `${APPVIEW}/xrpc/app.bsky.graph.getSuggestedFollowsByActor?${params}`,
    signal,
  );
}

export type StarterPackView = {
  uri: string;
  cid: string;
  creator?: AppViewProfile;
  record?: Record<string, unknown>;
  listItemCount?: number;
  joinedAllTimeCount?: number;
  indexedAt?: string;
};

/** app.bsky.graph.getActorStarterPacks — the starter packs an actor made. */
export async function getActorStarterPacks(opts: {
  actor: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<{ starterPacks?: StarterPackView[]; cursor?: string } | null> {
  const { actor, limit = 25, cursor, signal } = opts;
  if (!actor) return null;
  const params = new URLSearchParams({ actor, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return fetchJsonOrNull(`${APPVIEW}/xrpc/app.bsky.graph.getActorStarterPacks?${params}`, signal);
}

export type LabelerView = {
  uri: string;
  cid: string;
  creator?: AppViewProfile;
  likeCount?: number;
  indexedAt?: string;
  policies?: { labelValues?: string[]; labelValueDefinitions?: unknown[] };
};

/**
 * app.bsky.labeler.getServices — the moderation services behind a set of
 * DIDs, with `detailed` returning each one's label policy. Labelers are
 * ordinary atproto accounts, so their DIDs come from the same places any
 * other DID does.
 */
export async function getLabelerServices(opts: {
  dids: readonly string[];
  detailed?: boolean;
  signal?: AbortSignal;
}): Promise<{ views?: LabelerView[] } | null> {
  const { dids, detailed = true, signal } = opts;
  if (!dids.length) return null;
  const params = new URLSearchParams();
  for (const did of dids) params.append('dids', did);
  if (detailed) params.set('detailed', 'true');
  return fetchJsonOrNull(`${APPVIEW}/xrpc/app.bsky.labeler.getServices?${params}`, signal);
}
