/**
 * What the thread explorer can say about a thread beyond its shape: who in
 * it blocks whom, which replies Bluesky leaves out or folds away, and the
 * accounts behind the posts. Pure: the reads are in
 * `utils/atproto/threadInsightsData.ts`, the drawing in
 * `components/explore/graph/ThreadExplorer.tsx`.
 *
 * Three kinds of reply never reach a reader of the thread on bsky.app, and
 * each is told apart from public data alone:
 *
 *   - Cut off: the reply exists (Constellation indexes it against the post
 *     it answers) but the AppView leaves it out of the thread. Why is read
 *     from what anyone can see: a suspended or deactivated account, a post
 *     the AppView won't return even on its own, a block between the replier
 *     and the post's or the thread's author, a moderation label, the
 *     thread's reply limits. With none of those, it is what the shadowban
 *     checker calls a reply missing for no visible reason.
 *   - Folded: the AppView returns the reply, but Bluesky's app keeps it
 *     behind "show more", either because the thread's author hid it or
 *     because Bluesky ranks it there (getPostThreadOtherV2).
 *   - Blocked across: two people in the thread, one of whom has a block
 *     record naming the other. Blocks made by subscribing to a moderation
 *     list name the list, not the account, so they can't be seen this way.
 */

import { BLUESKY_MODERATION_DID } from '@/lib/tools/labels';
import { moderationLabels } from '@/lib/tools/shadowban';
import { flattenThread, type ThreadPost } from './socialGraph';

export type InsightLabel = { val: string; src: string };

/** An account in the thread, as the AppView describes it. */
export type AuthorFacts = {
  did: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
  /** When the AppView first indexed the profile. */
  createdAt?: string;
  followers?: number;
  follows?: number;
  posts?: number;
  labels: InsightLabel[];
};

/** Labels on an account or post that someone other than the account set. */
export function outsideLabels(labels: readonly InsightLabel[], did: string): string[] {
  return moderationLabels([...labels], did);
}

/* ------------------------------------------------------------------ */
/* Blocks                                                               */
/* ------------------------------------------------------------------ */

/** `from` has a block record naming `to`. */
export type BlockPair = { from: string; to: string };

export type BlockIndex = Map<string, { blocks: Set<string>; blockedBy: Set<string> }>;

export function indexBlocks(pairs: readonly BlockPair[]): BlockIndex {
  const out: BlockIndex = new Map();
  const entry = (did: string) => {
    let e = out.get(did);
    if (!e) out.set(did, (e = { blocks: new Set(), blockedBy: new Set() }));
    return e;
  };
  for (const { from, to } of pairs) {
    if (from === to) continue;
    entry(from).blocks.add(to);
    entry(to).blockedBy.add(from);
  }
  return out;
}

export type Between = { aBlocksB: boolean; bBlocksA: boolean };

/** The block between two accounts, either way, or null when there is none. */
export function blockBetween(index: BlockIndex | null, a: string, b: string): Between | null {
  if (!index || a === b) return null;
  const aBlocksB = index.get(a)?.blocks.has(b) ?? false;
  const bBlocksA = index.get(b)?.blocks.has(a) ?? false;
  return aBlocksB || bBlocksA ? { aBlocksB, bBlocksA } : null;
}

/** Everyone an account is in a block with, either way. */
export function blockedWith(index: BlockIndex | null, did: string): Set<string> {
  const e = index?.get(did);
  return new Set([...(e?.blocks ?? []), ...(e?.blockedBy ?? [])]);
}

/** Each pair of accounts in a block once, whichever way it runs. */
export function blockLinks(index: BlockIndex | null): { a: string; b: string; between: Between }[] {
  const out: { a: string; b: string; between: Between }[] = [];
  if (!index) return out;
  const seen = new Set<string>();
  for (const [a, e] of index) {
    for (const b of [...e.blocks, ...e.blockedBy]) {
      const key = a < b ? `${a} ${b}` : `${b} ${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a, b, between: blockBetween(index, a, b)! });
    }
  }
  return out;
}

/** "@a blocks @b", "@a and @b block each other": a block in words. */
export function blockWords(between: Between, a: string, b: string): string {
  if (between.aBlocksB && between.bBlocksA) return `${a} and ${b} block each other`;
  return between.aBlocksB ? `${a} blocks ${b}` : `${b} blocks ${a}`;
}

/* ------------------------------------------------------------------ */
/* Folded and cut-off replies                                           */
/* ------------------------------------------------------------------ */

/** Why the app keeps a reply the AppView returns behind "show more". */
export type FoldReason = 'author' | 'bluesky';

/** A reply that exists but that the AppView leaves out of the thread. */
export type CutReply = {
  uri: string;
  did: string;
  /** The post it answers, which is in the tree. */
  parent: string;
  author?: { handle?: string; displayName?: string; avatar?: string };
  /** From the AppView when it returns the post alone, else from the repository; null when neither could. */
  text: string | null;
  hasMedia: boolean;
  createdAt?: string;
  /** The AppView returns the post when asked for it on its own. */
  served: boolean;
  /** Whether the AppView describes the account, and if not, what it said. */
  account: 'active' | 'suspended' | 'deactivated' | 'missing' | 'unknown';
  /** Labels on the post or its author that the author didn't set. */
  labels: InsightLabel[];
  likes?: number;
  reposts?: number;
};

export type CutCause =
  | 'suspended'
  | 'deactivated'
  | 'missing'
  | 'withheld'
  | 'block'
  | 'labelled'
  | 'gated'
  | 'checking'
  | 'unexplained';

/**
 * How a cut-off reply is drawn. `moderation` is Bluesky acting on the
 * account or post, `social` is something the people in the thread did,
 * `neutral` is the account no longer being there, and `unknown` is no
 * reason anyone can see.
 */
export type CutTone = 'moderation' | 'social' | 'neutral' | 'unknown';

export type CutReading = {
  cause: CutCause;
  tone: CutTone;
  /** A few words, for the card. */
  label: string;
  /** A sentence, for the details. */
  reason: string;
  /** Anything else found that would also explain it. */
  also: string[];
};

export type CutContext = {
  rootDid: string;
  parentDid: string;
  /** How an account is named in a sentence: "@handle". */
  name: (did: string) => string;
  /** The blocks read so far. */
  blocks: BlockIndex;
  /** Every block read has come back, so a block not found isn't there to find. */
  blocksDone: boolean;
  /** Whether an account was among those whose blocks were read. */
  blocksRead: (did: string) => boolean;
  /** The thread's author limits who can reply. */
  gateRestricted: boolean;
};

const LIST_BLOCK_NOTE =
  'Blocks made by subscribing to a moderation list don’t name the account, so one of those can’t be ruled out.';

/** Who set a label, to start a sentence with. */
function labelSource(labels: readonly InsightLabel[], val: string): string {
  return labels.some((l) => l.val === val && l.src === BLUESKY_MODERATION_DID) ? 'Bluesky’s moderators' : 'A labeler';
}

/** Why a cut-off reply is missing from its thread, as far as public data says. */
export function readCut(reply: CutReply, ctx: CutContext): CutReading {
  const who = ctx.name(reply.did);
  if (reply.account === 'suspended') {
    return {
      cause: 'suspended',
      tone: 'moderation',
      label: 'Account suspended',
      reason: `Bluesky suspended ${who}, so none of their posts appear in any thread.`,
      also: [],
    };
  }
  if (reply.account === 'deactivated') {
    return {
      cause: 'deactivated',
      tone: 'neutral',
      label: 'Account deactivated',
      reason: `${who} deactivated their account, so Bluesky shows none of their posts until they come back.`,
      also: [],
    };
  }
  if (reply.account === 'missing') {
    return {
      cause: 'missing',
      tone: 'neutral',
      label: 'Not on Bluesky',
      reason: `Bluesky has no profile for ${who}, so it doesn’t show their reply.`,
      also: [],
    };
  }
  if (!reply.served) {
    return {
      cause: 'withheld',
      tone: 'moderation',
      label: 'Not served',
      reason:
        reply.text === null
          ? 'Bluesky won’t return this reply even on its own, and its record couldn’t be read either.'
          : `The reply is still in ${who}’s repository, but Bluesky won’t return it, even on its own. Posts that are taken down, or labelled to be hidden, are left out this way.`,
      also: [],
    };
  }

  // The AppView returns the post alone but leaves it out of the thread.
  const found: CutReading[] = [];
  const blockWith = (other: string, role: string) => {
    if (other === reply.did) return;
    const between = blockBetween(ctx.blocks, reply.did, other);
    if (!between) return;
    found.push({
      cause: 'block',
      tone: 'social',
      label: `Block with ${ctx.name(other)}`,
      reason: `${blockWords(between, who, ctx.name(other))}, ${role}. Bluesky leaves a reply out of a thread when there’s a block between its author and the author of the post it answers or of the thread.`,
      also: [],
    });
  };
  blockWith(ctx.parentDid, 'who wrote the post it replies to');
  if (ctx.rootDid !== ctx.parentDid) blockWith(ctx.rootDid, 'who started the thread');
  const labels = outsideLabels(reply.labels, reply.did);
  if (labels.length) {
    const quoted = labels.map((v) => `“${v}”`).join(', ');
    found.push({
      cause: 'labelled',
      tone: 'moderation',
      label: `Labelled “${labels[0]}”`,
      reason: `${labelSource(reply.labels, labels[0])} labelled ${who} or this reply ${quoted}, which can keep a reply out of threads.`,
      also: [],
    });
  }
  if (ctx.gateRestricted && reply.did !== ctx.rootDid) {
    found.push({
      cause: 'gated',
      tone: 'social',
      label: 'Reply limits',
      reason: `${ctx.name(ctx.rootDid)} limits who can reply to this thread, and Bluesky leaves out replies from anyone outside that limit.`,
      also: [],
    });
  }
  if (found.length) return { ...found[0], also: found.slice(1).map((f) => f.reason) };

  if (!ctx.blocksDone) {
    return {
      cause: 'checking',
      tone: 'neutral',
      label: 'Checking…',
      reason: 'Bluesky returns this reply on its own but leaves it out of the thread. Looking for a block that would explain it…',
      also: [],
    };
  }
  const unread = [reply.did, ctx.parentDid, ctx.rootDid].some((d) => !ctx.blocksRead(d));
  return {
    cause: 'unexplained',
    tone: 'unknown',
    label: 'No visible reason',
    reason: `Bluesky returns this reply on its own but leaves it out of the thread, and no block, label or reply limit that anyone can see explains it. A reply left out like this is what a hidden account looks like.`,
    also: [unread ? 'Not everyone’s blocks were read for this thread, so a block could still be the reason.' : LIST_BLOCK_NOTE],
  };
}

/* ------------------------------------------------------------------ */
/* Finding, ordering and tracing                                        */
/* ------------------------------------------------------------------ */

const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

/**
 * Whether a post matches what was typed in the search box: anywhere in its
 * text, its author's name or handle. A query starting with @ matches
 * handles only, from the start, so "@al" finds @alice.bsky.social and not
 * a post that mentions "royal".
 */
export function postMatches(post: { text: string; handle?: string; displayName?: string }, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return false;
  if (q.startsWith('@')) {
    const h = q.slice(1);
    return !!h && fold(post.handle ?? '').startsWith(h);
  }
  return [post.text, post.displayName ?? '', post.handle ?? ''].some((s) => fold(s).includes(q));
}

export type ReplyOrder = 'discussed' | 'oldest' | 'newest' | 'liked';

export const REPLY_ORDER_LABELS: Record<ReplyOrder, string> = {
  discussed: 'Most discussed',
  oldest: 'Oldest first',
  newest: 'Newest first',
  liked: 'Most liked',
};

const at = (p: ThreadPost) => Date.parse(p.createdAt) || 0;

/** A post's replies in the chosen order, ties broken by age so the order never shuffles. */
export function sortReplies(kids: readonly ThreadPost[], order: ReplyOrder): ThreadPost[] {
  const cmp: Record<ReplyOrder, (a: ThreadPost, b: ThreadPost) => number> = {
    discussed: (a, b) => b.size - a.size || at(a) - at(b),
    oldest: (a, b) => at(a) - at(b),
    newest: (a, b) => at(b) - at(a),
    liked: (a, b) => b.likes - a.likes || at(a) - at(b),
  };
  return [...kids].sort((a, b) => cmp[order](a, b) || (a.uri < b.uri ? -1 : 1));
}

/** Each post's parent, by URI. */
export function parentsOf(root: ThreadPost): Map<string, string | null> {
  return new Map(flattenThread(root).map((p) => [p.uri, p.parent]));
}

/** Every post on the way down from the first post to each of these, the posts themselves included. */
export function pathTo(parents: ReadonlyMap<string, string | null>, uris: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const uri of uris) {
    for (let u: string | null | undefined = uri; u && !out.has(u); u = parents.get(u)) out.add(u);
  }
  return out;
}

/**
 * The thread's accounts, most worth reading first: the thread's author, the
 * post the explorer opened on, the accounts named in `first` (whoever a
 * cut-off reply needs explaining for), then whoever posted most.
 */
export function participantsByPriority(
  root: ThreadPost,
  { focus, first = [] }: { focus?: string; first?: readonly string[] } = {},
): string[] {
  const posts = flattenThread(root);
  const count = new Map<string, number>();
  for (const p of posts) count.set(p.did, (count.get(p.did) ?? 0) + 1);
  const focusDid = posts.find((p) => p.uri === focus)?.did;
  const rest = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!);
  return [...new Set([root.did, ...(focusDid ? [focusDid] : []), ...first, ...rest])];
}

/** How many highlight colours the explorer has for pinned accounts. */
export const PIN_SLOTS = 4;
