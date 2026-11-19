/**
 * Reads what the thread explorer says about a thread beyond its shape: the
 * accounts in it, the replies Bluesky folds away or leaves out, and the
 * blocks between the people posting. What each answer means is decided in
 * `lib/threadInsights.ts`; this file only fetches.
 *
 * Public endpoints only, answering a browser directly:
 *
 *   - The AppView, for profiles, for posts asked for on their own, and for
 *     the replies its app folds away (getPostThreadOtherV2, which answers
 *     logged out, checked 2026-11-19).
 *   - Constellation, for every reply that exists, so the ones the AppView
 *     leaves out can be found, and for block records: one request per
 *     account, filtered to the thread's other accounts. Its `did` filter
 *     took 176 DIDs in one request (7.4 kB of URL) without complaint.
 *   - Slingshot, for a left-out reply's record when the AppView won't
 *     return it, which tells a deleted reply (dropped here) from a withheld
 *     one.
 *
 * A reply is only looked for under posts whose reply count is higher than
 * the replies the thread returned: the AppView counts the replies it leaves
 * out (a post counted 80 and listed 77; Constellation held 80) but not ones
 * it never indexed, so those are missed. One it returns on its own is then
 * looked for under its parent alone, so a reply the whole thread's read
 * merely didn't reach is never called hidden. Every read is bounded (LIMITS); on
 * a 321-post thread with 177 accounts the block reads were 177 requests and
 * found 82 blocks.
 */

import { flattenThread, didOfUri, tidToMs } from '@/lib/socialGraph';
import {
  participantsByPriority,
  type AuthorFacts,
  type BlockPair,
  type CutReply,
  type FoldReason,
  type InsightLabel,
} from '@/lib/threadInsights';
import { withIdentification } from '../requestDeadline';
import { TTLMap } from './cache';
import { APPVIEW, CONSTELLATION, SLINGSHOT } from './config';
import { chunk, getJson, pool, type Ctx, type ThreadGraph } from './graphData';

export const INSIGHT_LIMITS = {
  /** Posts whose replies are compared with Constellation's, most missing first. */
  gapPosts: 30,
  /** Constellation pages read per post, at 100 a page. */
  gapPages: 3,
  /** Left-out replies looked into, in all. */
  cut: 80,
  /** Accounts asked about one at a time when getProfiles leaves them out. */
  silentAccounts: 40,
  /** Posts whose folded replies are asked for, most replied-to first. */
  foldAnchors: 25,
  /** Accounts whose blocks are read: one request each. */
  blockAccounts: 150,
  /** A reply younger than this may only be waiting to be indexed. */
  graceMs: 10 * 60_000,
  /**
   * The AppView returns at most this many levels of replies below the post
   * asked for, whatever depth is asked (depth=50 came back 10 deep, checked
   * 2026-11-19), so a post on the last level has replies it didn't return.
   * The explorer reads those when the post's replies are opened.
   */
  depth: 10,
  /** The most direct replies the AppView lists under one post. */
  replyCap: 200,
  concurrency: 6,
} as const;

export type InsightStage = 'reading' | 'blocks' | 'done';

export type ThreadInsights = {
  stage: InsightStage;
  /** How far through the block reads, 0 to 1. */
  blocksDone: number;
  /** Everyone in the thread the AppView describes, by DID. */
  authors: Map<string, AuthorFacts>;
  /** Replies in the thread that Bluesky's app keeps behind "show more". */
  folded: Map<string, FoldReason>;
  /** Replies that exist but are missing from the thread. Filled in at once, after the rest is read. */
  cut: CutReply[];
  /** The blocks found so far. Complete once `stage` is done. */
  blocks: BlockPair[];
  /** Accounts whose blocks were read. */
  blocksRead: Set<string>;
  /** Everyone who posted, the left-out replies' authors included. */
  participants: number;
  /** Posts with more replies than one answer lists, where a missing one can't be told from a crowded one. */
  crowded: number;
  requests: number;
};

const cache = new TTLMap<string, ThreadInsights>(10 * 60_000);

type LabelView = { val?: unknown; src?: unknown };

function labelsOf(labels: unknown): InsightLabel[] {
  if (!Array.isArray(labels)) return [];
  return (labels as LabelView[]).flatMap((l) =>
    typeof l?.val === 'string' && typeof l?.src === 'string' ? [{ val: l.val, src: l.src }] : [],
  );
}

type ProfileView = {
  did: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
  createdAt?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  labels?: unknown;
};

const factsOf = (p: ProfileView): AuthorFacts => ({
  did: p.did,
  handle: p.handle && p.handle !== 'handle.invalid' ? p.handle : undefined,
  displayName: p.displayName?.trim() || undefined,
  avatar: p.avatar,
  createdAt: p.createdAt,
  followers: p.followersCount,
  follows: p.followsCount,
  posts: p.postsCount,
  labels: labelsOf(p.labels),
});

type PostView = {
  uri: string;
  author: ProfileView;
  record?: { text?: string; createdAt?: string };
  embed?: { $type?: string; media?: { $type?: string } };
  labels?: unknown;
  likeCount?: number;
  repostCount?: number;
};

type RecordValue = { text?: unknown; createdAt?: unknown; embed?: { $type?: string; media?: { $type?: string } } };

const isMedia = (t?: string) => !!t && /images|video/.test(t);

type Answer<T> = { ok: true; body: T } | { ok: false; status: number; error?: string; message?: string };

/** A GET whose failure says why, for the cases where the reason is the answer. */
async function getAnswer<T>(url: string, ctx: Ctx): Promise<Answer<T>> {
  if (ctx.signal?.aborted) return { ok: false, status: 0 };
  ctx.calls += 1;
  try {
    const res = await fetch(url, withIdentification({ signal: ctx.signal }));
    const body = (await res.json().catch(() => null)) as (T & { error?: unknown; message?: unknown }) | null;
    if (res.ok && body) return { ok: true, body };
    return {
      ok: false,
      status: res.status,
      error: typeof body?.error === 'string' ? body.error : undefined,
      message: typeof body?.message === 'string' ? body.message : undefined,
    };
  } catch {
    return { ok: false, status: 0 };
  }
}

type BacklinkPage = { records?: { did: string; collection: string; rkey: string }[]; cursor?: string | null };

/**
 * Everything the explorer's insights need for a thread, in stages: the
 * profiles, folded and left-out replies first, then the blocks among
 * everyone who posted, a batch at a time. `onUpdate` hears each state as
 * it lands, and the promise resolves with the finished one (null if
 * abandoned).
 */
export async function loadThreadInsights(
  thread: ThreadGraph,
  onUpdate: (insights: ThreadInsights) => void,
  signal?: AbortSignal,
): Promise<ThreadInsights | null> {
  const key = thread.root.uri;
  const hit = cache.get(key);
  if (hit) {
    onUpdate(hit);
    return hit;
  }
  const ctx: Ctx = { calls: 0, signal };
  const posts = flattenThread(thread.root);
  const inThread = new Set(posts.map((p) => p.uri));
  const authors = new Map<string, AuthorFacts>();
  const folded = new Map<string, FoldReason>(
    thread.gate.hidden.filter((u) => inThread.has(u)).map((u): [string, FoldReason] => [u, 'author']),
  );
  let cut: CutReply[] = [];
  const blocks: BlockPair[] = [];
  const blocksRead = new Set<string>();
  let stage: InsightStage = 'reading';
  let blocksDone = 0;
  let crowded = 0;
  let participants = new Set(posts.map((p) => p.did)).size;
  let lastEmit = 0;

  // Fresh collections each time, so React sees a change and a state already
  // handed out never moves under a render.
  const snapshot = (): ThreadInsights => ({
    stage,
    blocksDone,
    authors: new Map(authors),
    folded: new Map(folded),
    cut: [...cut],
    blocks: [...blocks],
    blocksRead: new Set(blocksRead),
    participants,
    crowded,
    requests: ctx.calls,
  });
  // At most a few times a second, unless a stage has just turned over.
  const emit = (force = true) => {
    if (signal?.aborted || (!force && Date.now() - lastEmit < 250)) return;
    lastEmit = Date.now();
    onUpdate(snapshot());
  };

  const readProfiles = (dids: readonly string[]) =>
    pool(chunk(dids, 25), 4, async (part) => {
      const params = new URLSearchParams();
      part.forEach((d) => params.append('actors', d));
      const data = await getJson<{ profiles?: ProfileView[] }>(`${APPVIEW}/xrpc/app.bsky.actor.getProfiles?${params}`, ctx);
      for (const p of data?.profiles ?? []) authors.set(p.did, factsOf(p));
      emit(false);
    });

  // The replies the app folds away, under the posts with the most replies.
  const readFolds = () => {
    const anchors = posts
      .filter((p) => p.kids.length > 0)
      .sort((a, b) => b.kids.length - a.kids.length)
      .slice(0, INSIGHT_LIMITS.foldAnchors);
    return pool(anchors, 4, async (p) => {
      const data = await getJson<{ thread?: { uri?: string; value?: { hiddenByThreadgate?: boolean } }[] }>(
        `${APPVIEW}/xrpc/app.bsky.unspecced.getPostThreadOtherV2?anchor=${encodeURIComponent(p.uri)}`,
        ctx,
      );
      for (const item of data?.thread ?? []) {
        if (!item.uri || !inThread.has(item.uri) || folded.has(item.uri)) continue;
        folded.set(item.uri, item.value?.hiddenByThreadgate ? 'author' : 'bluesky');
      }
      emit(false);
    });
  };

  // Replies that exist and are missing from the thread, and why.
  const readCut = async () => {
    const base = thread.root.depth;
    const gaps = posts.filter((p) => p.replies > p.kids.length && p.depth - base < INSIGHT_LIMITS.depth);
    crowded = gaps.filter((p) => p.kids.length >= INSIGHT_LIMITS.replyCap).length;
    const asked = gaps
      .filter((p) => p.kids.length < INSIGHT_LIMITS.replyCap)
      .sort((a, b) => b.replies - b.kids.length - (a.replies - a.kids.length))
      .slice(0, INSIGHT_LIMITS.gapPosts);
    const now = Date.now();
    const found = await pool(asked, 4, async (p) => {
      const out: { uri: string; did: string; parent: string }[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < INSIGHT_LIMITS.gapPages; page++) {
        const params = new URLSearchParams({ subject: p.uri, source: 'app.bsky.feed.post:reply.parent.uri', limit: '100' });
        if (cursor) params.set('cursor', cursor);
        const data = await getJson<BacklinkPage>(`${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${params}`, ctx);
        for (const r of data?.records ?? []) {
          if (r.collection !== 'app.bsky.feed.post') continue;
          const uri = `at://${r.did}/${r.collection}/${r.rkey}`;
          if (inThread.has(uri)) continue;
          const ms = tidToMs(r.rkey);
          if (ms !== null && now - ms < INSIGHT_LIMITS.graceMs) continue;
          out.push({ uri, did: r.did, parent: p.uri });
        }
        if (!data?.cursor) break;
        cursor = data.cursor;
      }
      return out;
    });
    const list = found.flat().slice(0, INSIGHT_LIMITS.cut);
    if (!list.length || signal?.aborted) return;

    // Which of them the AppView returns when asked for them alone. A batch
    // that got no answer says nothing either way, so its replies are dropped
    // (`unasked`), as are any the checks below find aren't left out at all.
    const served = new Map<string, PostView>();
    const unasked = new Set<string>();
    await pool(chunk(list, 25), 4, async (part) => {
      const params = new URLSearchParams();
      part.forEach((m) => params.append('uris', m.uri));
      const data = await getJson<{ posts?: PostView[] }>(`${APPVIEW}/xrpc/app.bsky.feed.getPosts?${params}`, ctx);
      if (!data) part.forEach((m) => unasked.add(m.uri));
      for (const p of data?.posts ?? []) served.set(p.uri, p);
    });

    // A reply returned on its own is looked for again in its parent's own
    // thread, as the shadowban checker does: one found there was only out of
    // reach of the whole thread's read, not left out by the AppView.
    const parents = [...new Set(list.filter((m) => served.has(m.uri)).map((m) => m.parent))];
    await pool(parents, 4, async (parent) => {
      const params = new URLSearchParams({ uri: parent, depth: '1', parentHeight: '0' });
      const data = await getJson<{ thread?: { replies?: { post?: { uri?: string }; uri?: string }[] } }>(
        `${APPVIEW}/xrpc/app.bsky.feed.getPostThread?${params}`,
        ctx,
      );
      if (!data) {
        list.filter((m) => m.parent === parent).forEach((m) => unasked.add(m.uri));
        return;
      }
      const there = new Set((data.thread?.replies ?? []).map((r) => r.post?.uri ?? r.uri));
      list.filter((m) => m.parent === parent && there.has(m.uri)).forEach((m) => unasked.add(m.uri));
    });

    // The authors, for the details, and for any the AppView won't describe,
    // what it says instead: suspended, deactivated, or never seen.
    await readProfiles([...new Set(list.map((m) => m.did))].filter((d) => !authors.has(d)));
    const account = new Map<string, CutReply['account']>();
    const silent = [...new Set(list.filter((m) => !served.has(m.uri)).map((m) => m.did))]
      .filter((d) => !authors.has(d))
      .slice(0, INSIGHT_LIMITS.silentAccounts);
    await pool(silent, 4, async (did) => {
      const a = await getAnswer<ProfileView>(`${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`, ctx);
      if (a.ok) {
        authors.set(did, factsOf(a.body));
        return;
      }
      if (a.error === 'AccountTakedown') account.set(did, 'suspended');
      else if (a.error === 'AccountDeactivated') account.set(did, 'deactivated');
      else if (a.status === 400 && /not found/i.test(a.message ?? '')) account.set(did, 'missing');
    });
    const accountOf = (did: string): CutReply['account'] => (authors.has(did) ? 'active' : (account.get(did) ?? 'unknown'));

    // A reply the AppView won't return is read from the repository, through
    // Slingshot: gone means it was deleted and the index hasn't caught up.
    const records = new Map<string, { text: string; hasMedia: boolean; createdAt?: string } | 'deleted'>();
    const toRead = list.filter(
      (m) => !served.has(m.uri) && !unasked.has(m.uri) && !['suspended', 'deactivated'].includes(accountOf(m.did)),
    );
    await pool(toRead, 4, async (m) => {
      const a = await getAnswer<{ value?: RecordValue }>(
        `${SLINGSHOT}/xrpc/blue.microcosm.repo.getRecordByUri?at_uri=${encodeURIComponent(m.uri)}`,
        ctx,
      );
      if (a.ok) {
        const v = a.body.value ?? {};
        records.set(m.uri, {
          text: typeof v.text === 'string' ? v.text : '',
          hasMedia: isMedia(v.embed?.$type) || isMedia(v.embed?.media?.$type),
          createdAt: typeof v.createdAt === 'string' ? v.createdAt : undefined,
        });
      } else if (a.error === 'RecordNotFound') {
        records.set(m.uri, 'deleted');
      }
    });

    cut = list.flatMap((m): CutReply[] => {
      if (unasked.has(m.uri)) return [];
      const view = served.get(m.uri);
      if (view) {
        return [
          {
            uri: m.uri,
            did: m.did,
            parent: m.parent,
            author: { handle: view.author.handle, displayName: view.author.displayName || undefined, avatar: view.author.avatar },
            text: String(view.record?.text ?? ''),
            hasMedia: isMedia(view.embed?.$type) || isMedia(view.embed?.media?.$type),
            createdAt: view.record?.createdAt,
            served: true,
            account: 'active',
            labels: [...labelsOf(view.labels), ...labelsOf(view.author.labels)],
            likes: view.likeCount,
            reposts: view.repostCount,
          },
        ];
      }
      const rec = records.get(m.uri);
      if (rec === 'deleted') return [];
      const a = authors.get(m.did);
      const tid = tidToMs(m.uri.split('/').pop() ?? '');
      return [
        {
          uri: m.uri,
          did: m.did,
          parent: m.parent,
          author: a ? { handle: a.handle, displayName: a.displayName, avatar: a.avatar } : undefined,
          text: rec ? rec.text : null,
          hasMedia: rec?.hasMedia ?? false,
          createdAt: rec?.createdAt ?? (tid ? new Date(tid).toISOString() : undefined),
          served: false,
          account: accountOf(m.did),
          labels: a?.labels ?? [],
        },
      ];
    });
  };

  await Promise.all([readProfiles([...new Set(posts.map((p) => p.did))]), readFolds(), readCut()]);
  if (signal?.aborted) return null;

  // Blocks among everyone who posted, the left-out replies' authors (and
  // whoever they answered) read first: one request per account, asking which
  // of the others have a block record naming it.
  stage = 'blocks';
  participants = new Set([...posts.map((p) => p.did), ...cut.map((c) => c.did)]).size;
  emit();
  const first = [...new Set(cut.flatMap((c) => [c.did, didOfUri(c.parent) ?? '']))].filter(Boolean);
  const people = participantsByPriority(thread.root, { focus: thread.focus, first }).slice(0, INSIGHT_LIMITS.blockAccounts);
  const seen = new Set<string>();
  let finished = 0;
  await pool(people, INSIGHT_LIMITS.concurrency, async (subject) => {
    const others = people.filter((d) => d !== subject);
    let ok = true;
    for (const part of chunk(others, 150)) {
      let cursor: string | undefined;
      for (let page = 0; page < 3; page++) {
        const params = new URLSearchParams({ subject, source: 'app.bsky.graph.block:subject', limit: '100' });
        part.forEach((d) => params.append('did', d));
        if (cursor) params.set('cursor', cursor);
        const data = await getJson<BacklinkPage>(`${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${params}`, ctx);
        if (!data) {
          ok = false;
          break;
        }
        for (const r of data.records ?? []) {
          const k = `${r.did} ${subject}`;
          if (seen.has(k)) continue;
          seen.add(k);
          blocks.push({ from: r.did, to: subject });
        }
        if (!data.cursor) break;
        cursor = data.cursor;
      }
    }
    if (ok) blocksRead.add(subject);
    finished += 1;
    blocksDone = finished / people.length;
    emit(false);
  });
  if (signal?.aborted) return null;

  stage = 'done';
  blocksDone = 1;
  const done = snapshot();
  cache.set(key, done);
  onUpdate(done);
  return done;
}
