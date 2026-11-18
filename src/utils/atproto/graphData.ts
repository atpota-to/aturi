/**
 * Gathers the social graph around one account, and a post's whole thread,
 * for the explorer's Graph views. Public endpoints only (the Bluesky
 * AppView, the account's own PDS, Constellation), so it works for anyone,
 * signed in or not. The shapes and the arithmetic live in
 * `lib/socialGraph.ts`; this file only fetches.
 *
 * Who follows whom always comes from the AppView's getRelationships, never
 * from Constellation. Constellation began indexing on 2025-01-28 and has not
 * backfilled, so any follow older than that is missing from it: on a sample
 * account it found 156 of 228 follow-backs, and every one it missed predated
 * the index (checked 2026-11-18). Constellation is still the source for
 * likes, reposts, replies, quotes and mentions, which the 30-day window
 * keeps well inside what it has.
 *
 * Every read is bounded (see LIMITS) and the neighbourhood loads in stages,
 * handed to the caller as they land, so the drawing fills in rather than
 * waiting on the slowest read. For a typical account the whole thing is a
 * few hundred requests, which is why the explorer only starts it when the
 * Graph tab is opened, and keeps the result for ten minutes.
 */

import { withIdentification } from '../requestDeadline';
import { TTLMap } from './cache';
import { APPVIEW, CONSTELLATION } from './config';
import {
  DAY_MS,
  WINDOW_DAYS,
  buildThread,
  didOfUri,
  tally,
  tidToMs,
  type EngagementEvent,
  type EngagementKind,
  type GraphPerson,
  type ThreadPost,
  type ThreadPostInput,
} from '@/lib/socialGraph';

/**
 * Bluesky writes a mention facet with its `$type` and Constellation indexes
 * the two spellings as separate paths; on a sample account the typed one held
 * 1,347 links and the bare one 66 (checked 2026-11-18). Both are read.
 */
const MENTION_SOURCES = [
  'app.bsky.feed.post:facets[app.bsky.richtext.facet].features[app.bsky.richtext.facet#mention].did',
  'app.bsky.feed.post:facets[].features[app.bsky.richtext.facet#mention].did',
];

/** Where each kind of engagement with a post is indexed. Quotes have two. */
const POST_SOURCES: Record<Exclude<EngagementKind, 'mention'>, string[]> = {
  like: ['app.bsky.feed.like:subject.uri'],
  repost: ['app.bsky.feed.repost:subject.uri'],
  reply: ['app.bsky.feed.post:reply.parent.uri'],
  quote: ['app.bsky.feed.post:embed.record.uri', 'app.bsky.feed.post:embed.record.record.uri'],
};

/**
 * How far each read goes. The point of each number is a request budget, not
 * a claim about what matters: an account that follows 5,000 people still
 * gets a drawing, of the part that was read.
 */
export const LIMITS = {
  /** Follows read, at 100 a page. */
  follows: 1000,
  /** Outbound records read inside the window, per collection. */
  likes: 1000,
  reposts: 300,
  posts: 500,
  /** Author-feed pages scanned to choose whose engagement to read. */
  feedPages: 3,
  /** Own posts whose likes, reposts, replies and quotes are read. */
  inboundPosts: 40,
  /** Constellation answers at most 100 per page; one page per post and kind. */
  perList: 100,
  /** Engaged accounts outside the follow graph counted for follows in common. */
  inCommonCandidates: 16,
  /** Past this many follows, one count is more than 20 requests: skipped. */
  inCommonMaxFollows: 600,
  /** Accounts getRelationships answers for in one request. */
  relChunk: 30,
  concurrency: 6,
} as const;

type Ctx = { calls: number; signal?: AbortSignal };

async function getJson<T>(url: string, ctx: Ctx): Promise<T | null> {
  if (ctx.signal?.aborted) return null;
  ctx.calls += 1;
  try {
    const res = await fetch(url, withIdentification({ signal: ctx.signal }));
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function pool<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const chunk = <T,>(list: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

type BacklinkPage = { total?: number; records?: { did: string; collection: string; rkey: string }[]; cursor?: string | null };

function backlinksUrl(subject: string, source: string, limit: number, dids: readonly string[] = []): string {
  const params = new URLSearchParams({ subject, source, limit: String(limit) });
  for (const d of dids) params.append('did', d);
  return `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${params}`;
}

export type FollowRelation = { following: boolean; followedBy: boolean };

type RelationshipsPage = {
  relationships?: { did?: string; following?: string; followedBy?: string; notFound?: boolean }[];
};

/**
 * Whether `actor` follows each of `others`, and each of them follows
 * `actor`: app.bsky.graph.getRelationships, 30 DIDs a request. Accounts the
 * AppView doesn't know are left out. Null when every request failed.
 * `onPart` hears how many of `others` have been answered so far.
 */
async function relationshipsWith(
  actor: string,
  others: readonly string[],
  ctx: Ctx,
  onPart?: (answered: number) => void,
): Promise<Map<string, FollowRelation> | null> {
  const out = new Map<string, FollowRelation>();
  const parts = chunk(others, LIMITS.relChunk);
  let answered = 0;
  let ok = 0;
  await pool(parts, 4, async (part) => {
    const params = new URLSearchParams({ actor });
    part.forEach((d) => params.append('others', d));
    const page = await getJson<RelationshipsPage>(`${APPVIEW}/xrpc/app.bsky.graph.getRelationships?${params}`, ctx);
    answered += part.length;
    if (page) {
      ok += 1;
      for (const r of page.relationships ?? []) {
        if (r.did && !r.notFound) out.set(r.did, { following: !!r.following, followedBy: !!r.followedBy });
      }
    }
    onPart?.(answered);
  });
  return ok || !parts.length ? out : null;
}

type Profile = { did: string; handle?: string; displayName?: string; avatar?: string; followsCount?: number; followersCount?: number };

async function profilesFor(dids: readonly string[], ctx: Ctx): Promise<Map<string, Profile>> {
  const out = new Map<string, Profile>();
  await pool(chunk(dids, 25), 4, async (part) => {
    const params = new URLSearchParams();
    part.forEach((d) => params.append('actors', d));
    const data = await getJson<{ profiles?: Profile[] }>(`${APPVIEW}/xrpc/app.bsky.actor.getProfiles?${params}`, ctx);
    for (const p of data?.profiles ?? []) out.set(p.did, p);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Follows                                                              */
/* ------------------------------------------------------------------ */

type GraphListPage = { follows?: Profile[]; followers?: Profile[]; cursor?: string };

const followsCache = new TTLMap<string, { list: Profile[]; capped: boolean }>(10 * 60_000);

/** Everyone `did` follows, up to `max`, newest follow first. */
async function readFollows(did: string, ctx: Ctx, max: number = LIMITS.follows) {
  const hit = followsCache.get(did);
  if (hit && (hit.list.length >= max || !hit.capped)) return hit;
  const list: Profile[] = [];
  let cursor: string | undefined;
  let capped = false;
  while (true) {
    const params = new URLSearchParams({ actor: did, limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const page = await getJson<GraphListPage>(`${APPVIEW}/xrpc/app.bsky.graph.getFollows?${params}`, ctx);
    if (!page) break;
    list.push(...(page.follows ?? []));
    if (!page.cursor || !page.follows?.length) break;
    if (list.length >= max) {
      capped = true;
      break;
    }
    cursor = page.cursor;
  }
  const out = { list, capped };
  if (!ctx.signal?.aborted) followsCache.set(did, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* The neighbourhood                                                    */
/* ------------------------------------------------------------------ */

export type GraphStage = 'follows' | 'mutuals' | 'outbound' | 'inbound' | 'followers' | 'common' | 'done';

export const STAGE_LABELS: Record<GraphStage, string> = {
  follows: 'Reading who they follow',
  mutuals: 'Checking who follows them back',
  outbound: `Reading ${WINDOW_DAYS} days of their likes, reposts and posts`,
  inbound: 'Reading who engaged with their posts',
  followers: 'Checking which of those follow them',
  common: 'Counting follows in common',
  done: 'Done',
};

/** The stages in the order they run, for a progress bar. */
export const STAGE_ORDER: readonly GraphStage[] = ['follows', 'mutuals', 'outbound', 'inbound', 'followers', 'common'];

export type Neighbourhood = {
  subject: Profile & { did: string };
  people: GraphPerson[];
  /** The subject's follows, as DIDs, for the flow view's "followed by their follows". */
  follows: string[];
  stage: GraphStage;
  /** How far through the current stage, 0 to 1, where that can be known. */
  stageDone: number;
  /** The subject's own likes, reposts and posts read from the window. */
  records: number;
  requests: number;
  windowStart: number;
  windowEnd: number;
};

const neighbourhoodCache = new TTLMap<string, Neighbourhood>(10 * 60_000);

type ListRecordsPage = { records?: { uri: string; value: Record<string, unknown> }[]; cursor?: string };

/** One collection's records from the window, newest first, up to `max`. */
async function recentRecords(pds: string, did: string, collection: string, max: number, since: number, ctx: Ctx) {
  const out: { uri: string; value: Record<string, unknown>; at: number }[] = [];
  let cursor: string | undefined;
  let failed = false;
  let reachedWindow = false;
  while (out.length < max) {
    const params = new URLSearchParams({ repo: did, collection, limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const page = await getJson<ListRecordsPage>(`${pds}/xrpc/com.atproto.repo.listRecords?${params}`, ctx);
    if (!page) {
      failed = out.length === 0;
      break;
    }
    for (const r of page.records ?? []) {
      const at = Date.parse(String(r.value?.createdAt ?? ''));
      // A record with no usable date neither counts nor ends the read.
      if (!Number.isFinite(at)) continue;
      if (at < since) {
        reachedWindow = true;
        break;
      }
      out.push({ uri: r.uri, value: r.value, at });
      if (out.length >= max) break;
    }
    if (reachedWindow || !page.cursor || !page.records?.length) {
      reachedWindow = true;
      break;
    }
    cursor = page.cursor;
  }
  return { records: out, failed, capped: !reachedWindow && out.length >= max };
}

function strongRefUri(v: unknown): string | null {
  return v && typeof v === 'object' && typeof (v as { uri?: unknown }).uri === 'string' ? (v as { uri: string }).uri : null;
}

/** What one of the subject's own posts says about who they engaged with. */
function outboundFromPost(value: Record<string, unknown>, at: number): EngagementEvent[] {
  const out: EngagementEvent[] = [];
  const reply = value.reply as { parent?: unknown } | undefined;
  const parent = didOfUri(strongRefUri(reply?.parent));
  if (parent) out.push({ did: parent, kind: 'reply', at });
  const embed = value.embed as { $type?: string; record?: unknown } | undefined;
  const quoted =
    embed?.$type === 'app.bsky.embed.record'
      ? strongRefUri(embed.record)
      : embed?.$type === 'app.bsky.embed.recordWithMedia'
        ? strongRefUri((embed.record as { record?: unknown } | undefined)?.record)
        : null;
  if (quoted && quoted.includes('/app.bsky.feed.post/')) {
    const did = didOfUri(quoted);
    if (did) out.push({ did, kind: 'quote', at });
  }
  const facets = Array.isArray(value.facets) ? value.facets : [];
  for (const f of facets) {
    for (const feat of (f as { features?: unknown[] })?.features ?? []) {
      const ft = feat as { $type?: string; did?: unknown };
      if (ft?.$type === 'app.bsky.richtext.facet#mention' && typeof ft.did === 'string') {
        out.push({ did: ft.did, kind: 'mention', at });
      }
    }
  }
  return out;
}

type FeedItem = {
  post: {
    uri: string;
    author: { did: string };
    record?: { createdAt?: string };
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    quoteCount?: number;
  };
  reason?: unknown;
};

/**
 * The social graph around `subject`, in stages. `onUpdate` receives each
 * stage's state as it lands (the same object shape every time, never
 * mutated afterwards), and the promise resolves with the finished one.
 */
export async function loadNeighbourhood(
  subject: { did: string; pds: string },
  onUpdate: (n: Neighbourhood) => void,
  signal?: AbortSignal,
): Promise<Neighbourhood | null> {
  const cached = neighbourhoodCache.get(subject.did);
  if (cached) {
    onUpdate(cached);
    return cached;
  }
  const ctx: Ctx = { calls: 0, signal };
  const windowEnd = Date.now();
  const windowStart = windowEnd - WINDOW_DAYS * DAY_MS;

  const profile = (await getJson<Profile>(
    `${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(subject.did)}`,
    ctx,
  )) ?? { did: subject.did };
  const people = new Map<string, GraphPerson>();
  const blank = (did: string, p?: Profile): GraphPerson => ({
    did,
    handle: p?.handle,
    displayName: p?.displayName,
    avatar: p?.avatar,
    following: false,
    followedBy: false,
    inCommon: null,
    in: 0,
    out: 0,
    inKinds: {},
    outKinds: {},
  });
  let stage: GraphStage = 'follows';
  let stageDone = 0;
  let records = 0;
  let lastEmit = 0;
  const follows: string[] = [];
  const emit = (next: GraphStage) => {
    stage = next;
    stageDone = 0;
    if (signal?.aborted) return;
    lastEmit = Date.now();
    onUpdate(snapshot());
  };
  // Progress inside a long stage, at most a few times a second: often enough
  // for the drawing to fill in visibly, not so often it redraws on every reply.
  const tick = (done: number, force = false) => {
    stageDone = Math.max(stageDone, Math.min(1, done));
    if (signal?.aborted || (!force && Date.now() - lastEmit < 250)) return;
    lastEmit = Date.now();
    onUpdate(snapshot());
  };
  // A fresh array of fresh objects each time, so React sees a change and a
  // stage already handed out never moves under a render.
  const snapshot = (): Neighbourhood => ({
    subject: { ...profile, did: subject.did },
    people: [...people.values()].map((p) => ({ ...p, inKinds: { ...p.inKinds }, outKinds: { ...p.outKinds } })),
    follows: [...follows],
    stage,
    stageDone,
    records,
    requests: ctx.calls,
    windowStart,
    windowEnd,
  });

  // 1. Follows.
  emit('follows');
  const read = await readFollows(subject.did, ctx);
  for (const p of read.list) {
    if (p.did === subject.did || people.has(p.did)) continue;
    people.set(p.did, { ...blank(p.did, p), following: true });
    follows.push(p.did);
  }

  // 2. Which of them follow back.
  emit('mutuals');
  await relationshipsWith(subject.did, follows, ctx, (n) => tick(n / follows.length)).then((rel) => {
    for (const [did, r] of rel ?? []) if (r.followedBy) people.get(did)!.followedBy = true;
  });

  // 3. Outbound: the subject's own records.
  emit('outbound');
  const outbound: EngagementEvent[] = [];
  const [likes, reposts, posts] = await Promise.all([
    recentRecords(subject.pds, subject.did, 'app.bsky.feed.like', LIMITS.likes, windowStart, ctx),
    recentRecords(subject.pds, subject.did, 'app.bsky.feed.repost', LIMITS.reposts, windowStart, ctx),
    recentRecords(subject.pds, subject.did, 'app.bsky.feed.post', LIMITS.posts, windowStart, ctx),
  ]);
  for (const r of likes.records) {
    const did = didOfUri(strongRefUri(r.value.subject));
    if (did) outbound.push({ did, kind: 'like', at: r.at });
  }
  for (const r of reposts.records) {
    const did = didOfUri(strongRefUri(r.value.subject));
    if (did) outbound.push({ did, kind: 'repost', at: r.at });
  }
  for (const r of posts.records) outbound.push(...outboundFromPost(r.value, r.at));
  records = likes.records.length + reposts.records.length + posts.records.length;

  const applyTally = (inbound: EngagementEvent[]) => {
    const t = tally(inbound, outbound, { t0: windowStart, t1: windowEnd, exclude: subject.did });
    for (const [did, row] of t) {
      const p = people.get(did) ?? blank(did);
      Object.assign(p, row);
      people.set(did, p);
    }
  };
  applyTally([]);

  // 4. Inbound: who engaged with the subject's most-engaged recent posts.
  emit('inbound');
  const feed: FeedItem['post'][] = [];
  let cursor: string | undefined;
  for (let i = 0; i < LIMITS.feedPages; i++) {
    const params = new URLSearchParams({ actor: subject.did, filter: 'posts_with_replies', limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const page = await getJson<{ feed?: FeedItem[]; cursor?: string }>(
      `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?${params}`,
      ctx,
    );
    if (!page?.feed?.length) break;
    let old = false;
    for (const item of page.feed) {
      if (item.reason || item.post.author.did !== subject.did) continue;
      const at = Date.parse(item.post.record?.createdAt ?? '');
      if (at < windowStart) {
        old = true;
        continue;
      }
      feed.push(item.post);
    }
    if (old || !page.cursor) break;
    cursor = page.cursor;
  }
  const score = (p: FeedItem['post']) => (p.likeCount ?? 0) + (p.repostCount ?? 0) + (p.replyCount ?? 0) + (p.quoteCount ?? 0);
  const picked = [...feed].sort((a, b) => score(b) - score(a)).slice(0, LIMITS.inboundPosts).filter((p) => score(p) > 0);

  const inbound: EngagementEvent[] = [];
  const seen = new Set<string>();
  const jobs: { subject: string; kind: EngagementKind; source: string; fallback: number }[] = [];
  for (const p of picked) {
    const at = Date.parse(p.record?.createdAt ?? '') || windowEnd;
    const counts: Record<Exclude<EngagementKind, 'mention'>, number> = {
      like: p.likeCount ?? 0,
      repost: p.repostCount ?? 0,
      reply: p.replyCount ?? 0,
      quote: p.quoteCount ?? 0,
    };
    for (const kind of Object.keys(POST_SOURCES) as (keyof typeof POST_SOURCES)[]) {
      // The AppView's counts say which lists are empty, and those cost nothing.
      if (!counts[kind]) continue;
      for (const source of POST_SOURCES[kind]) jobs.push({ subject: p.uri, kind, source, fallback: at });
    }
  }
  for (const source of MENTION_SOURCES) jobs.push({ subject: subject.did, kind: 'mention', source, fallback: 0 });
  let finished = 0;
  await pool(jobs, LIMITS.concurrency, async (job) => {
    const page = await getJson<BacklinkPage>(backlinksUrl(job.subject, job.source, LIMITS.perList), ctx);
    finished += 1;
    for (const r of page?.records ?? []) {
      const key = `${r.did}/${r.collection}/${r.rkey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const at = tidToMs(r.rkey) ?? job.fallback;
      inbound.push({ did: r.did, kind: job.kind, at });
    }
    applyTally(inbound);
    tick(finished / jobs.length);
  });
  applyTally(inbound);

  // 5. Which of the engaged accounts outside their follows follow them.
  emit('followers');
  const strangers = [...people.values()]
    .filter((p) => !p.following)
    .sort((a, b) => b.in + b.out - (a.in + a.out))
    .slice(0, 600)
    .map((p) => p.did);
  const fans = await relationshipsWith(subject.did, strangers, ctx, (n) => tick((0.8 * n) / Math.max(1, strangers.length)));
  for (const [did, r] of fans ?? []) {
    const p = people.get(did);
    if (p && r.followedBy) p.followedBy = true;
  }
  const unnamed = [...people.values()].filter((p) => !p.handle).map((p) => p.did);
  const named = await profilesFor(unnamed, ctx);
  for (const [did, p] of named) Object.assign(people.get(did)!, { handle: p.handle, displayName: p.displayName, avatar: p.avatar });

  // 6. Follows in common, for the most engaged accounts with no direct link:
  // how many of the subject's follows follow each one. Skipped when the
  // follows weren't all read, since a count of part of them would be wrong.
  emit('common');
  if (!read.capped && follows.length && follows.length <= LIMITS.inCommonMaxFollows) {
    const candidates = [...people.values()]
      .filter((p) => !p.following && !p.followedBy && p.in + p.out > 0)
      .sort((a, b) => b.in + b.out - (a.in + a.out))
      .slice(0, LIMITS.inCommonCandidates);
    let counted = 0;
    await pool(candidates, 3, async (p) => {
      const rel = await relationshipsWith(p.did, follows, ctx);
      counted += 1;
      if (rel) people.get(p.did)!.inCommon = [...rel.values()].filter((r) => r.followedBy).length;
      tick(counted / candidates.length, true);
    });
  }

  if (signal?.aborted) return null;
  stage = 'done';
  const done = snapshot();
  neighbourhoodCache.set(subject.did, done);
  onUpdate(done);
  return done;
}

/* ------------------------------------------------------------------ */
/* Growing the flow                                                     */
/* ------------------------------------------------------------------ */

export type GraphAccount = { did: string; handle?: string; displayName?: string; avatar?: string };

const toAccount = (p: Profile): GraphAccount => ({ did: p.did, handle: p.handle, displayName: p.displayName, avatar: p.avatar });

/** One page of an account's follows or followers, 50 at a time. */
export async function graphPage(
  did: string,
  direction: 'follows' | 'followers',
  cursor?: string,
  signal?: AbortSignal,
): Promise<{ accounts: GraphAccount[]; cursor?: string } | null> {
  const ctx: Ctx = { calls: 0, signal };
  const params = new URLSearchParams({ actor: did, limit: '50' });
  if (cursor) params.set('cursor', cursor);
  const method = direction === 'follows' ? 'getFollows' : 'getFollowers';
  const page = await getJson<GraphListPage>(`${APPVIEW}/xrpc/app.bsky.graph.${method}?${params}`, ctx);
  if (!page) return null;
  return { accounts: (page[direction] ?? []).map(toAccount), cursor: page.cursor };
}

/**
 * Which of the subject's follows follow `did`, as accounts: the people who
 * put someone in the subject's 2nd degree, by name.
 */
export async function followedByFollows(
  did: string,
  follows: readonly string[],
  signal?: AbortSignal,
): Promise<GraphAccount[] | null> {
  const ctx: Ctx = { calls: 0, signal };
  const rel = await relationshipsWith(did, follows, ctx);
  if (!rel) return null;
  const found = [...rel].filter(([, r]) => r.followedBy).map(([d]) => d);
  const named = await profilesFor(found, ctx);
  return found.map((d) => (named.has(d) ? toAccount(named.get(d)!) : { did: d }));
}

/** Follow and follower counts for one account, for a flow card that opens. */
export async function accountCounts(did: string, signal?: AbortSignal): Promise<Profile | null> {
  return getJson<Profile>(`${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`, { calls: 0, signal });
}

/* ------------------------------------------------------------------ */
/* Threads                                                              */
/* ------------------------------------------------------------------ */

type ThreadNode = {
  $type?: string;
  post?: {
    uri: string;
    author: { did: string; handle?: string; displayName?: string; avatar?: string };
    record?: { text?: string; createdAt?: string; reply?: { root?: { uri?: string } } };
    embed?: { $type?: string; media?: { $type?: string } };
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    quoteCount?: number;
  };
  replies?: ThreadNode[];
};


export type ThreadGraph = {
  root: ThreadPost;
  /** The post the page is about, which may be any reply in the thread. */
  focus: string;
  posts: number;
};

const threadCache = new TTLMap<string, ThreadGraph>(5 * 60_000);

const isMedia = (t?: string) => !!t && /images|video/.test(t);

/**
 * The whole thread a post belongs to, from its first post down, as far as
 * the AppView returns it. Blocked and deleted posts are left out, and so is
 * anything under them.
 */
export async function loadThread(uri: string, signal?: AbortSignal): Promise<ThreadGraph | null> {
  const cached = threadCache.get(uri);
  if (cached) return cached;
  const ctx: Ctx = { calls: 0, signal };
  const one = await getJson<{ posts?: NonNullable<ThreadNode['post']>[] }>(
    `${APPVIEW}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`,
    ctx,
  );
  const rootUri = one?.posts?.[0]?.record?.reply?.root?.uri || uri;
  const params = new URLSearchParams({ uri: rootUri, depth: '50', parentHeight: '0' });
  const data = await getJson<{ thread?: ThreadNode }>(`${APPVIEW}/xrpc/app.bsky.feed.getPostThread?${params}`, ctx);
  if (!data?.thread?.post) return null;
  const flat: ThreadPostInput[] = [];
  const walk = (n: ThreadNode, parent: string | null) => {
    const p = n.post;
    if (!p || (n.$type && n.$type !== 'app.bsky.feed.defs#threadViewPost')) return;
    flat.push({
      uri: p.uri,
      parent,
      did: p.author.did,
      handle: p.author.handle,
      displayName: p.author.displayName || undefined,
      avatar: p.author.avatar,
      text: String(p.record?.text ?? ''),
      createdAt: p.record?.createdAt ?? '',
      likes: p.likeCount ?? 0,
      reposts: p.repostCount ?? 0,
      replies: p.replyCount ?? 0,
      quotes: p.quoteCount ?? 0,
      hasMedia: isMedia(p.embed?.$type) || isMedia(p.embed?.media?.$type),
    });
    for (const r of n.replies ?? []) walk(r, p.uri);
  };
  walk(data.thread, null);
  const root = buildThread(flat, data.thread.post.uri);
  if (!root) return null;
  const out: ThreadGraph = { root, focus: uri, posts: flat.length };
  if (!signal?.aborted) threadCache.set(uri, out);
  return out;
}

/**
 * Each author's relation to `op`, both ways, from getRelationships: one
 * request per 30 authors, so a handful for most threads.
 */
export async function loadThreadRelations(
  op: string,
  authors: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, FollowRelation> | null> {
  const ctx: Ctx = { calls: 0, signal };
  const unique = [...new Set(authors)].filter((d) => d !== op);
  const rel = await relationshipsWith(op, unique, ctx);
  return signal?.aborted ? null : rel;
}
