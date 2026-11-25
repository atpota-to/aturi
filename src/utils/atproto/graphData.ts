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
 * Graph tab is opened or the account card is asked for its relationships,
 * shares one read between them, and keeps the result for ten minutes.
 */

import { withIdentification } from '../requestDeadline';
import { appForCollection } from './backlinkRelations';
import { TTLMap } from './cache';
import { forgetStoredGraph, isFresh, readStoredGraph, storeGraph } from './graphStore';
import { APPVIEW, CONSTELLATION } from './config';
import { backlinksFromPage, flattenSources, getBacklinkSources, getBacklinks } from './constellation';
import {
  DAY_MS,
  WINDOW_DAYS,
  buildThread,
  dailyReach,
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
  /**
   * Author-feed pages scanned, at 100 a page, to choose whose engagement to
   * read. The scan stops on its own at the start of the window, so this only
   * bounds it for accounts that post far more than most. It was 3, which on
   * a busy account reached back about 12 of the 30 days and left the rest of
   * the window unread.
   */
  feedPages: 20,
  /**
   * Own posts whose likes, reposts, replies and quotes are read, the most
   * engaged first. Sized for the whole window: it was 40 when the scan above
   * stopped at 12 days or so.
   */
  inboundPosts: 100,
  /** Constellation answers at most 100 per page; one page per post and kind. */
  perList: 100,
  /** Engaged accounts outside the follow graph counted for follows in common. */
  inCommonCandidates: 16,
  /** Past this many follows, one count is more than 20 requests: skipped. */
  inCommonMaxFollows: 600,
  /** Accounts getRelationships answers for in one request. */
  relChunk: 30,
  /** Engaged accounts outside the follows checked for following back. */
  strangers: 1500,
  concurrency: 6,
} as const;

export type Ctx = { calls: number; signal?: AbortSignal };

export async function getJson<T>(url: string, ctx: Ctx): Promise<T | null> {
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

export async function pool<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

export const chunk = <T,>(list: readonly T[], size: number): T[][] =>
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
 * `onPart` hears each request's accounts once they are answered (or the
 * request failed), with how many of `others` that makes so far.
 */
async function relationshipsWith(
  actor: string,
  others: readonly string[],
  ctx: Ctx,
  onPart?: (part: readonly string[], answered: number, found: Map<string, FollowRelation>) => void,
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
    onPart?.(part, answered, out);
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

export type GraphStage = 'follows' | 'mutuals' | 'outbound' | 'inbound' | 'common' | 'done';

export const STAGE_LABELS: Record<GraphStage, string> = {
  follows: 'Reading who they follow',
  mutuals: 'Checking who follows them back',
  outbound: `Reading ${WINDOW_DAYS} days of their likes, reposts and posts`,
  inbound: 'Reading who engaged with their posts',
  common: 'Counting follows in common',
  done: 'Done',
};

/** The stages in the order they run, for a progress bar. */
export const STAGE_ORDER: readonly GraphStage[] = ['follows', 'mutuals', 'outbound', 'inbound', 'common'];

export type Neighbourhood = {
  subject: Profile & { did: string };
  /**
   * The accounts whose relation to the subject is known, in the order it
   * became known. The order only ever grows at the end, so a drawing can
   * give each account a place the moment it arrives and never move it for
   * anyone else's sake.
   */
  people: GraphPerson[];
  /** The subject's follows, as DIDs, for the flow view's "followed by their follows". */
  follows: string[];
  stage: GraphStage;
  /** How far through the current stage, 0 to 1, where that can be known. */
  stageDone: number;
  /** The subject's own likes, reposts and posts read from the window. */
  records: number;
  /** How many of the subject's posts their inbound engagement was read from. */
  inboundPosts: number;
  /**
   * The oldest of the subject's posts scanned for those, in ms, or
   * `windowStart` when the scan reached the start of the window. A busy
   * poster's feed pages (LIMITS.feedPages) can run out first, and engagement
   * on posts older than this went unread.
   */
  inboundSince: number;
  /** Distinct accounts engaging each way, per day of the window, oldest first. */
  days: { in: number[]; out: number[] };
  requests: number;
  windowStart: number;
  windowEnd: number;
};

/**
 * Finished reads, by DID, served until they are a day old (graphStore.ts).
 * Kept here for this page's lifetime and in IndexedDB across reloads and
 * tabs; a read's age runs from `windowEnd`, the moment it started.
 */
const neighbourhoodCache = new Map<string, Neighbourhood>();

/**
 * What a stored read must match to be served: the shape of a Neighbourhood
 * and the limits it was read under. Bump the leading number when the shape
 * changes; a change to LIMITS or the window retires old reads by itself.
 */
const STORE_SCHEMA = `neighbourhood/1/${WINDOW_DAYS}/${JSON.stringify(LIMITS)}`;

/** A finished read of `did` young enough to show, from this page's memory. */
function cachedNeighbourhood(did: string): Neighbourhood | undefined {
  const n = neighbourhoodCache.get(did);
  if (n && isFresh(n.windowEnd)) return n;
  if (n) neighbourhoodCache.delete(did);
  return undefined;
}

/** Remember a finished read here and in the browser's store. */
function keepNeighbourhood(n: Neighbourhood, store: boolean) {
  neighbourhoodCache.set(n.subject.did, n);
  if (store) void storeGraph(n.subject.did, STORE_SCHEMA, n, n.windowEnd);
}

/**
 * Forget the finished read of `did`, here and in the browser's store, so the
 * next loadNeighbourhood reads it fresh. A read already under way is left to
 * finish. Resolves once the stored copy is gone.
 */
export function forgetNeighbourhood(did: string): Promise<void> {
  neighbourhoodCache.delete(did);
  return forgetStoredGraph(did);
}

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
 * A read in progress, shared by everyone who asked for it: the Graph tab and
 * the account card's summary can both want the same account at once, and the
 * read is a few hundred requests. It stops when the last of them lets go.
 */
type Flight = {
  latest: Neighbourhood | null;
  listeners: Set<(n: Neighbourhood) => void>;
  ac: AbortController;
  done: Promise<Neighbourhood | null>;
};
const flights = new Map<string, Flight>();

/** Anyone following an account's graph without having asked for a read. */
const watchers = new Map<string, Set<(n: Neighbourhood) => void>>();

/**
 * The social graph around `subject`, in stages. `onUpdate` receives each
 * stage's state as it lands (the same object shape every time, never
 * mutated afterwards), and the promise resolves with the finished one, or
 * null if the read failed or `signal` gave up on it.
 */
export function loadNeighbourhood(
  subject: { did: string; pds: string },
  onUpdate: (n: Neighbourhood) => void,
  signal?: AbortSignal,
): Promise<Neighbourhood | null> {
  const cached = cachedNeighbourhood(subject.did);
  if (cached) {
    onUpdate(cached);
    return Promise.resolve(cached);
  }
  let flight = flights.get(subject.did);
  if (!flight) {
    const ac = new AbortController();
    const f: Flight = { latest: null, listeners: new Set(), ac, done: Promise.resolve(null) };
    const emit = (n: Neighbourhood) => {
      f.latest = n;
      f.listeners.forEach((l) => l(n));
      watchers.get(subject.did)?.forEach((w) => w(n));
    };
    // A read stored in the last day is served as it is; otherwise read.
    f.done = readStoredGraph<Neighbourhood>(subject.did, STORE_SCHEMA)
      .then((stored) => {
        if (ac.signal.aborted) return null;
        if (stored) {
          keepNeighbourhood(stored.value, false);
          emit(stored.value);
          return stored.value;
        }
        return readNeighbourhood(subject, emit, ac.signal);
      })
      .finally(() => {
      if (flights.get(subject.did) === f) flights.delete(subject.did);
    });
    flights.set(subject.did, f);
    flight = f;
  }
  const f = flight;
  f.listeners.add(onUpdate);
  if (f.latest) onUpdate(f.latest);
  const leave = () => {
    if (!f.listeners.delete(onUpdate) || f.listeners.size) return;
    f.ac.abort();
    if (flights.get(subject.did) === f) flights.delete(subject.did);
  };
  if (signal?.aborted) leave();
  else signal?.addEventListener('abort', leave, { once: true });
  return f.done.then((n) => {
    f.listeners.delete(onUpdate);
    return signal?.aborted ? null : n;
  });
}

/**
 * Follow an account's graph without starting a read: `onUpdate` hears the
 * cached read at once if there is one, a read in progress as it lands, and
 * any read someone starts later. Returns the unsubscribe.
 */
export function watchNeighbourhood(did: string, onUpdate: (n: Neighbourhood) => void): () => void {
  let set = watchers.get(did);
  if (!set) watchers.set(did, (set = new Set()));
  set.add(onUpdate);
  const now = cachedNeighbourhood(did) ?? flights.get(did)?.latest;
  if (now) onUpdate(now);
  // Nothing here yet: a read stored in an earlier visit is shown without
  // starting a new one, unless a read starts first.
  else
    void readStoredGraph<Neighbourhood>(did, STORE_SCHEMA).then((stored) => {
      if (!stored || !set.has(onUpdate) || cachedNeighbourhood(did) || flights.get(did)?.latest) return;
      keepNeighbourhood(stored.value, false);
      onUpdate(stored.value);
    });
  return () => {
    set.delete(onUpdate);
    if (!set.size && watchers.get(did) === set) watchers.delete(did);
  };
}

/** One read, start to finish; loadNeighbourhood shares it and caches it. */
async function readNeighbourhood(
  subject: { did: string; pds: string },
  onUpdate: (n: Neighbourhood) => void,
  signal?: AbortSignal,
): Promise<Neighbourhood | null> {
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
  let inboundPosts = 0;
  let inboundSince = windowStart;
  // Every act of engagement read, each way, for the per-day counts.
  const outbound: EngagementEvent[] = [];
  const inbound: EngagementEvent[] = [];
  let lastEmit = 0;
  const follows: string[] = [];
  // Who may be drawn, in the order they became drawable: an account joins
  // once its relation to the subject is settled, so it arrives on its own
  // ring rather than landing on one and jumping to another.
  const known: string[] = [];
  const isKnown = new Set<string>();
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
  const reveal = (dids: readonly string[]) => {
    for (const did of dids) {
      if (isKnown.has(did) || !people.has(did)) continue;
      isKnown.add(did);
      known.push(did);
    }
    tick(stageDone);
  };
  // A fresh array of fresh objects each time, so React sees a change and a
  // stage already handed out never moves under a render.
  const snapshot = (): Neighbourhood => ({
    subject: { ...profile, did: subject.did },
    people: known.map((did) => {
      const p = people.get(did)!;
      return { ...p, inKinds: { ...p.inKinds }, outKinds: { ...p.outKinds } };
    }),
    follows: [...follows],
    stage,
    stageDone,
    records,
    inboundPosts,
    inboundSince,
    days: dailyReach(inbound, outbound, { t0: windowStart, exclude: subject.did }),
    requests: ctx.calls,
    windowStart,
    windowEnd,
  });

  // Accounts outside the follows who engaged either way are checked for
  // following back in batches as they turn up, alongside the reads that find
  // them, three batches at a time, and drawn as each batch is answered.
  const queued = new Set<string>();
  const waiting: string[] = [];
  const checks: Promise<void>[] = [];
  let running = 0;
  const slots: (() => void)[] = [];
  // A slot is taken the moment it's granted, and handed straight to the next
  // in line when freed, so no more than three are ever out at once.
  const slot = () => {
    if (running < 3) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise<void>((go) => slots.push(go));
  };
  const release = () => {
    const next = slots.shift();
    if (next) next();
    else running -= 1;
  };
  const check = async (batch: string[]) => {
    await slot();
    const [rel, named] = await Promise.all([relationshipsWith(subject.did, batch, ctx), profilesFor(batch, ctx)]);
    release();
    for (const did of batch) {
      const p = people.get(did)!;
      if (rel?.get(did)?.followedBy) p.followedBy = true;
      const n = named.get(did);
      if (n) Object.assign(p, { handle: n.handle, displayName: n.displayName, avatar: n.avatar });
    }
    reveal(batch);
  };
  const enqueue = (all = false) => {
    for (const p of people.values()) {
      if (p.following || queued.has(p.did)) continue;
      queued.add(p.did);
      // Past the cap an account is drawn unchecked, as no link.
      if (queued.size > LIMITS.strangers) reveal([p.did]);
      else waiting.push(p.did);
    }
    while (waiting.length >= LIMITS.relChunk || (all && waiting.length)) {
      checks.push(check(waiting.splice(0, LIMITS.relChunk)));
    }
  };

  // 1. Follows.
  emit('follows');
  const read = await readFollows(subject.did, ctx);
  for (const p of read.list) {
    if (p.did === subject.did || people.has(p.did)) continue;
    people.set(p.did, { ...blank(p.did, p), following: true });
    follows.push(p.did);
  }

  // 2. Which of them follow back, drawn a batch at a time as answered.
  emit('mutuals');
  await relationshipsWith(subject.did, follows, ctx, (part, answered, found) => {
    for (const did of part) if (found.get(did)?.followedBy) people.get(did)!.followedBy = true;
    stageDone = answered / follows.length;
    reveal(part);
  });

  // 3. Outbound: the subject's own records.
  emit('outbound');
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
  enqueue();

  // 4. Inbound: who engaged with the subject's most-engaged recent posts.
  // Finding them is the feed scan, then reading them is the backlinks; the
  // scan gets the first quarter of the stage's progress.
  emit('inbound');
  const SCAN_SHARE = 0.25;
  const feed: FeedItem['post'][] = [];
  let cursor: string | undefined;
  let scannedAll = false;
  let reached = windowEnd;
  for (let i = 0; i < LIMITS.feedPages; i++) {
    const params = new URLSearchParams({ actor: subject.did, filter: 'posts_with_replies', limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const page = await getJson<{ feed?: FeedItem[]; cursor?: string }>(
      `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?${params}`,
      ctx,
    );
    if (!page) break;
    if (!page.feed?.length) {
      scannedAll = true;
      break;
    }
    let old = false;
    for (const item of page.feed) {
      if (item.reason || item.post.author.did !== subject.did) continue;
      const at = Date.parse(item.post.record?.createdAt ?? '');
      if (at < windowStart) {
        old = true;
        continue;
      }
      if (at < reached) reached = at;
      feed.push(item.post);
    }
    // The scan is the first part of the stage: how far back it has got.
    tick((SCAN_SHARE * (windowEnd - reached)) / (windowEnd - windowStart));
    if (old || !page.cursor) {
      scannedAll = true;
      break;
    }
    cursor = page.cursor;
  }
  if (!scannedAll) {
    const oldest = Math.min(...feed.map((p) => Date.parse(p.record?.createdAt ?? '')).filter(Number.isFinite));
    inboundSince = Number.isFinite(oldest) ? Math.max(windowStart, oldest) : windowEnd;
  }
  const score = (p: FeedItem['post']) => (p.likeCount ?? 0) + (p.repostCount ?? 0) + (p.replyCount ?? 0) + (p.quoteCount ?? 0);
  const picked = [...feed].sort((a, b) => score(b) - score(a)).slice(0, LIMITS.inboundPosts).filter((p) => score(p) > 0);
  inboundPosts = picked.length;

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
    enqueue();
    tick(SCAN_SHARE + ((1 - SCAN_SHARE) * finished) / jobs.length);
  });
  applyTally(inbound);
  enqueue(true);
  await Promise.all(checks);

  // 5. Follows in common, for the most engaged accounts with no direct link:
  // how many of the subject's follows follow each one. Skipped when the
  // follows weren't all read, since a count of part of them would be wrong.
  emit('common');
  if (!read.capped && follows.length && follows.length <= LIMITS.inCommonMaxFollows) {
    const candidates = known
      .map((did) => people.get(did)!)
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
  keepNeighbourhood(done, true);
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
  /**
   * The thread's reply rules, from the threadgate the AppView returns with
   * it: whether its author limits who may reply, and the replies they hid.
   */
  gate: { restricted: boolean; hidden: string[] };
};

type ThreadgateView = { record?: { allow?: unknown; hiddenReplies?: unknown } };

function readGate(view: ThreadgateView | undefined): ThreadGraph['gate'] {
  const record = view?.record ?? {};
  return {
    // `allow` absent means anyone may reply; any list, even an empty one, limits it.
    restricted: Array.isArray(record.allow),
    hidden: Array.isArray(record.hiddenReplies) ? record.hiddenReplies.filter((u): u is string => typeof u === 'string') : [],
  };
}

const threadCache = new TTLMap<string, ThreadGraph>(5 * 60_000);

const isMedia = (t?: string) => !!t && /images|video/.test(t);

type PostView = NonNullable<ThreadNode['post']>;

function postInput(p: PostView, parent: string | null): ThreadPostInput {
  return {
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
  };
}

/** A reply tree flattened, leaving out blocked and deleted posts and what hangs under them. */
function flattenNode(n: ThreadNode, parent: string | null, out: ThreadPostInput[]) {
  const p = n.post;
  if (!p || (n.$type && n.$type !== 'app.bsky.feed.defs#threadViewPost')) return;
  out.push(postInput(p, parent));
  for (const r of n.replies ?? []) flattenNode(r, p.uri, out);
}

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
  const data = await getJson<{ thread?: ThreadNode; threadgate?: ThreadgateView }>(
    `${APPVIEW}/xrpc/app.bsky.feed.getPostThread?${params}`,
    ctx,
  );
  if (!data?.thread?.post) return null;
  const flat: ThreadPostInput[] = [];
  flattenNode(data.thread, null, flat);
  const root = buildThread(flat, data.thread.post.uri);
  if (!root) return null;
  const out: ThreadGraph = { root, focus: uri, posts: flat.length, gate: readGate(data.threadgate) };
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

/* ------------------------------------------------------------------ */
/* The thread explorer                                                  */
/* ------------------------------------------------------------------ */

/**
 * The replies under any post, as a tree rooted at it: for a post the
 * explorer reached from outside the thread it opened on (a quote, say).
 */
export async function loadReplies(uri: string, signal?: AbortSignal): Promise<ThreadPost | null> {
  const params = new URLSearchParams({ uri, depth: '20', parentHeight: '0' });
  const data = await getJson<{ thread?: ThreadNode }>(`${APPVIEW}/xrpc/app.bsky.feed.getPostThread?${params}`, {
    calls: 0,
    signal,
  });
  if (!data?.thread?.post) return null;
  const flat: ThreadPostInput[] = [];
  flattenNode(data.thread, null, flat);
  return buildThread(flat, data.thread.post.uri);
}

/** One page of who liked or reposted a post, 50 at a time, from the AppView. */
export async function postAccounts(
  uri: string,
  kind: 'likes' | 'reposts',
  cursor?: string,
  signal?: AbortSignal,
): Promise<{ items: GraphAccount[]; cursor?: string } | null> {
  const params = new URLSearchParams({ uri, limit: '50' });
  if (cursor) params.set('cursor', cursor);
  const method = kind === 'likes' ? 'getLikes' : 'getRepostedBy';
  const page = await getJson<{ likes?: { actor: Profile }[]; repostedBy?: Profile[]; cursor?: string }>(
    `${APPVIEW}/xrpc/app.bsky.feed.${method}?${params}`,
    { calls: 0, signal },
  );
  if (!page) return null;
  const list = kind === 'likes' ? (page.likes ?? []).map((l) => l.actor) : (page.repostedBy ?? []);
  return { items: list.map(toAccount), cursor: page.cursor };
}

/** One page of the posts quoting a post, as tree nodes with no replies read yet. */
export async function postQuotes(
  uri: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<{ items: ThreadPost[]; cursor?: string } | null> {
  const params = new URLSearchParams({ uri, limit: '25' });
  if (cursor) params.set('cursor', cursor);
  const page = await getJson<{ posts?: PostView[]; cursor?: string }>(`${APPVIEW}/xrpc/app.bsky.feed.getQuotes?${params}`, {
    calls: 0,
    signal,
  });
  if (!page) return null;
  const items = (page.posts ?? []).map((p) => buildThread([postInput(p, null)], p.uri)).filter((p): p is ThreadPost => !!p);
  return { items, cursor: page.cursor };
}

/**
 * The ways a post is linked that the explorer's own chips don't cover, as
 * Constellation counts them: everything but Bluesky's likes, reposts,
 * replies and quotes, which come from the AppView with the full history.
 */
const COVERED_SOURCES = new Set([
  'app.bsky.feed.like:subject.uri',
  'app.bsky.feed.repost:subject.uri',
  'app.bsky.feed.post:reply.parent.uri',
  'app.bsky.feed.post:reply.root.uri',
  'app.bsky.feed.post:embed.record.uri',
  'app.bsky.feed.post:embed.record.record.uri',
]);

export type LinkSource = { source: string; label: string; count: number };

export async function otherLinks(uri: string): Promise<LinkSource[] | null> {
  const sources = flattenSources(await getBacklinkSources(uri));
  if (!sources) return null;
  return sources
    .filter((s) => s.count > 0 && !COVERED_SOURCES.has(s.source))
    .map((s) => ({ source: s.source, label: `${appForCollection(s.collection).name}: ${s.collection.split('.').pop()}`, count: s.count }));
}

export type LinkRecord = { uri: string; did: string; collection: string; rkey: string; author?: GraphAccount };

/** One page of the records behind a link source, with their authors named. */
export async function linkRecords(
  uri: string,
  source: string,
  cursor?: string,
): Promise<{ items: LinkRecord[]; cursor?: string } | null> {
  const page = await getBacklinks(uri, source, { limit: 25, cursor });
  if (!page) return null;
  const records = backlinksFromPage(page);
  const named = await profilesFor([...new Set(records.map((r) => r.did))], { calls: 0 });
  return {
    items: records.map((r) => ({
      uri: `at://${r.did}/${r.collection}/${r.rkey}`,
      did: r.did,
      collection: r.collection,
      rkey: r.rkey,
      author: named.has(r.did) ? toAccount(named.get(r.did)!) : undefined,
    })),
    cursor: page.cursor ?? undefined,
  };
}
