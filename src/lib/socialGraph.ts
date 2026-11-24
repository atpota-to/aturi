/**
 * The social graph around one account, and the shapes the explorer draws it
 * in. Pure: no fetch, no clock, no React. `utils/atproto/graphData.ts`
 * gathers the inputs from public endpoints; `components/explore/graph/`
 * draws them as an orbit, a ledger and a flow you grow by clicking.
 *
 * The tally, the degree breakdown and the orbit placement are ported from
 * dame.is (`src/lib/graphLists.js` and the Analytics studio's Graph tab, MIT,
 * same author). Two things differ, because the explorer reads any account
 * with no sign-in:
 *
 *   - "2nd degree" there comes from a weekly snapshot of everyone the
 *     owner's follows follow. Here it is counted on demand, account by
 *     account, with the AppView's getRelationships: how many of the
 *     subject's follows follow this one. So it is known only for the
 *     accounts it was counted for, and `inCommon` is null everywhere else.
 *   - Inbound engagement there is the owner's notifications. Here it is the
 *     likes, reposts, replies and quotes Constellation indexes against the
 *     subject's own posts, plus mentions of their DID.
 */

/** The rolling window engagement is counted over. */
export const WINDOW_DAYS = 30;
export const DAY_MS = 86_400_000;

export type EngagementKind = 'like' | 'repost' | 'reply' | 'quote' | 'mention';
export const ENGAGEMENT_KINDS: readonly EngagementKind[] = ['like', 'repost', 'reply', 'quote', 'mention'];

/** One act of engagement between the subject and someone else. `at` is ms. */
export type EngagementEvent = { did: string; kind: EngagementKind; at: number };

export type KindCounts = Partial<Record<EngagementKind, number>>;

export type GraphPerson = {
  did: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
  /** The subject follows them. */
  following: boolean;
  /**
   * They follow the subject. Checked for the subject's follows and for
   * everyone who engaged either way; an account in neither set reads false
   * without having been asked.
   */
  followedBy: boolean;
  /** How many of the subject's follows follow them, where that was counted. */
  inCommon: number | null;
  /** Engagement from them to the subject, and from the subject to them. */
  in: number;
  out: number;
  inKinds: KindCounts;
  outKinds: KindCounts;
};

/**
 * Where an account sits relative to the subject. The order is closeness, and
 * it is the order of the orbit's rings from the centre out.
 */
export type Relation = 'mutual' | 'following' | 'follower' | 'second' | 'further';
export const RELATION_ORDER: readonly Relation[] = ['mutual', 'following', 'follower', 'second', 'further'];

export function relationOf(p: Pick<GraphPerson, 'following' | 'followedBy' | 'inCommon'>): Relation {
  if (p.following && p.followedBy) return 'mutual';
  if (p.following) return 'following';
  if (p.followedBy) return 'follower';
  if ((p.inCommon ?? 0) > 0) return 'second';
  return 'further';
}

export const engagementOf = (p: Pick<GraphPerson, 'in' | 'out'>): number => p.in + p.out;

export type Tally = { in: number; out: number; inKinds: KindCounts; outKinds: KindCounts };

/**
 * Count engagement per account inside a window, both directions. Events
 * outside [t0, t1] and events from `exclude` (the subject, who likes their
 * own posts) are dropped.
 */
export function tally(
  inbound: readonly EngagementEvent[],
  outbound: readonly EngagementEvent[],
  { t0 = -Infinity, t1 = Infinity, exclude = null }: { t0?: number; t1?: number; exclude?: string | null } = {},
): Map<string, Tally> {
  const out = new Map<string, Tally>();
  const add = (ev: EngagementEvent, dir: 'in' | 'out') => {
    if (!ev?.did || ev.did === exclude) return;
    if (!Number.isFinite(ev.at) || ev.at < t0 || ev.at > t1) return;
    let row = out.get(ev.did);
    if (!row) out.set(ev.did, (row = { in: 0, out: 0, inKinds: {}, outKinds: {} }));
    row[dir] += 1;
    const kinds = dir === 'in' ? row.inKinds : row.outKinds;
    kinds[ev.kind] = (kinds[ev.kind] ?? 0) + 1;
  };
  for (const ev of inbound) add(ev, 'in');
  for (const ev of outbound) add(ev, 'out');
  return out;
}

/** How many of a set of accounts sit in each relation, and the total. */
export function breakdown(people: Iterable<GraphPerson>): Record<Relation, number> & { total: number } {
  const counts = { mutual: 0, following: 0, follower: 0, second: 0, further: 0, total: 0 };
  for (const p of people) {
    counts[relationOf(p)] += 1;
    counts.total += 1;
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Exchange: engagement in and out, as relationships                    */
/* ------------------------------------------------------------------ */

/**
 * Accounts that engaged with the subject (in), that the subject engaged with
 * (out), and both. `in` and `out` each include the accounts counted in
 * `both`; `reach` is everyone on either side, counted once.
 */
export type ExchangeTotals = { in: number; out: number; both: number; reach: number };

export function exchangeTotals(people: Iterable<Pick<GraphPerson, 'in' | 'out'>>): ExchangeTotals {
  const t = { in: 0, out: 0, both: 0, reach: 0 };
  for (const p of people) {
    if (p.in > 0) t.in += 1;
    if (p.out > 0) t.out += 1;
    if (p.in > 0 && p.out > 0) t.both += 1;
    if (p.in > 0 || p.out > 0) t.reach += 1;
  }
  return t;
}

/** How many accounts took part in each kind of engagement, each way. */
export function kindReach(
  people: Iterable<Pick<GraphPerson, 'inKinds' | 'outKinds'>>,
): { in: Record<EngagementKind, number>; out: Record<EngagementKind, number> } {
  const zero = () => Object.fromEntries(ENGAGEMENT_KINDS.map((k) => [k, 0])) as Record<EngagementKind, number>;
  const out = { in: zero(), out: zero() };
  for (const p of people) {
    for (const k of ENGAGEMENT_KINDS) {
      if ((p.inKinds[k] ?? 0) > 0) out.in[k] += 1;
      if ((p.outKinds[k] ?? 0) > 0) out.out[k] += 1;
    }
  }
  return out;
}

/**
 * Accounts with engagement both ways, the most mutual first: ranked by the
 * smaller side, so forty likes one way and one back sits below ten each way,
 * then by the total.
 */
export function backAndForth<P extends Pick<GraphPerson, 'did' | 'in' | 'out'>>(people: Iterable<P>, limit = Infinity): P[] {
  return [...people]
    .filter((p) => p.in > 0 && p.out > 0)
    .sort(
      (a, b) =>
        Math.min(b.in, b.out) - Math.min(a.in, a.out) || b.in + b.out - (a.in + a.out) || (a.did < b.did ? -1 : 1),
    )
    .slice(0, limit);
}

/**
 * Distinct accounts engaging each way per day: `days` buckets of 24 hours
 * from `t0`. Events outside them and events from `exclude` are dropped.
 */
export function dailyReach(
  inbound: readonly EngagementEvent[],
  outbound: readonly EngagementEvent[],
  { t0, days = WINDOW_DAYS, exclude = null }: { t0: number; days?: number; exclude?: string | null },
): { in: number[]; out: number[] } {
  const bucket = (events: readonly EngagementEvent[]) => {
    const sets = Array.from({ length: days }, () => new Set<string>());
    for (const ev of events) {
      if (!ev?.did || ev.did === exclude || !Number.isFinite(ev.at)) continue;
      const i = Math.floor((ev.at - t0) / DAY_MS);
      if (i >= 0 && i < days) sets[i].add(ev.did);
    }
    return sets.map((s) => s.size);
  };
  return { in: bucket(inbound), out: bucket(outbound) };
}

/**
 * Orbit radius in [0, 1], 0 being the subject.
 *
 * Mutuals on the innermost ring, one-way follows either way just outside it,
 * 2nd degree spread across the middle by follows in common (more, closer),
 * and accounts with no measured link on the rim. Engagement never moves
 * anyone in or out; the orbit draws it as size, so "close in the graph" and
 * "talks to them a lot" stay two readable things instead of one blended
 * score. dame.is has no follower ring because its orbit is the owner's own;
 * here followers who never got a follow back are a real group.
 */
export const ORBIT_RINGS = { mutual: 0.2, following: 0.31, follower: 0.42, secondNear: 0.52, secondFar: 0.88, further: 0.96 };

export function orbitRadius(p: GraphPerson, maxInCommon = 100): number {
  switch (relationOf(p)) {
    case 'mutual':
      return ORBIT_RINGS.mutual;
    case 'following':
      return ORBIT_RINGS.following;
    case 'follower':
      return ORBIT_RINGS.follower;
    case 'second': {
      const t = Math.log1p(p.inCommon ?? 0) / Math.log1p(Math.max(2, maxInCommon));
      return ORBIT_RINGS.secondFar - (ORBIT_RINGS.secondFar - ORBIT_RINGS.secondNear) * Math.min(1, t);
    }
    default:
      return ORBIT_RINGS.further;
  }
}

/** A stable number in [0, 1) for a string (FNV-1a), so a dot keeps its place. */
export function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * The golden angle, in radians. Stepping round a circle by it spreads any run
 * of consecutive steps evenly, however many there are, which is what lets the
 * orbit place each account by its arrival alone.
 */
export const GOLDEN_ANGLE = 2.399963229728653;

/* ------------------------------------------------------------------ */
/* Threads                                                              */
/* ------------------------------------------------------------------ */

export type ThreadPostInput = {
  uri: string;
  parent: string | null;
  did: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
  text: string;
  createdAt: string;
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
  hasMedia: boolean;
};

export type ThreadPost = ThreadPostInput & {
  depth: number;
  kids: ThreadPost[];
  /** This post and every reply under it. */
  size: number;
};

/**
 * A reply tree from a flat list. Replies sit in the order they were posted.
 * Posts whose parent is missing (blocked, deleted, not returned) are dropped
 * rather than floated to the top, so the tree never claims a post replied to
 * something it didn't.
 */
export function buildThread(posts: readonly ThreadPostInput[], rootUri: string): ThreadPost | null {
  const byUri = new Map<string, ThreadPost>();
  for (const p of posts) byUri.set(p.uri, { ...p, depth: 0, kids: [], size: 1 });
  const root = byUri.get(rootUri);
  if (!root) return null;
  for (const p of byUri.values()) {
    if (p === root || !p.parent) continue;
    byUri.get(p.parent)?.kids.push(p);
  }
  const walk = (p: ThreadPost, depth: number): number => {
    p.depth = depth;
    p.kids.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.uri < b.uri ? -1 : 1));
    p.size = 1 + p.kids.reduce((s, k) => s + walk(k, depth + 1), 0);
    return p.size;
  };
  walk(root, 0);
  return root;
}

export function flattenThread(root: ThreadPost): ThreadPost[] {
  const out: ThreadPost[] = [];
  const walk = (p: ThreadPost) => {
    out.push(p);
    p.kids.forEach(walk);
  };
  walk(root);
  return out;
}

/**
 * Radial tree: the first post at the centre, one ring per reply depth, each
 * leaf an equal share of the circle and each parent at the middle of its
 * children's span.
 */
export function radialLayout(
  root: ThreadPost,
  radius: number,
): { pos: Map<string, { x: number; y: number; angle: number }>; maxDepth: number } {
  const all = flattenThread(root);
  const maxDepth = Math.max(1, ...all.map((p) => p.depth));
  const leaves = all.filter((p) => !p.kids.length).length || 1;
  const angle = new Map<string, number>();
  let i = 0;
  const place = (p: ThreadPost): number => {
    if (!p.kids.length) {
      const a = (i++ / leaves) * Math.PI * 2;
      angle.set(p.uri, a);
      return a;
    }
    const as = p.kids.map(place);
    const a = (Math.min(...as) + Math.max(...as)) / 2;
    angle.set(p.uri, a);
    return a;
  };
  place(root);
  const pos = new Map<string, { x: number; y: number; angle: number }>();
  for (const p of all) {
    const a = angle.get(p.uri) ?? 0;
    const r = (p.depth / maxDepth) * radius;
    pos.set(p.uri, { x: Math.cos(a) * r, y: Math.sin(a) * r, angle: a });
  }
  return { pos, maxDepth };
}

export type IcicleCell = { post: ThreadPost; x: number; y: number; w: number; h: number };

/**
 * Icicle: the chosen post spans the full width, and each reply under it gets
 * a share of its parent's width equal to its share of the replies there, so
 * the replies that drew the conversation are the wide ones.
 */
export function icicleLayout(root: ThreadPost, width: number, rowHeight: number): IcicleCell[] {
  const out: IcicleCell[] = [];
  const base = root.depth;
  const walk = (p: ThreadPost, x: number, w: number) => {
    out.push({ post: p, x, y: (p.depth - base) * rowHeight, w, h: rowHeight });
    const inner = p.size - 1;
    if (!inner) return;
    let cx = x;
    for (const k of p.kids) {
      const kw = (w * k.size) / inner;
      walk(k, cx, kw);
      cx += kw;
    }
  };
  walk(root, 0, width);
  return out;
}

export type FlowCard = { post: ThreadPost; x: number; y: number; folded: number };
export type FlowStub = { parent: ThreadPost; hidden: number; x: number; y: number };

/**
 * The thread as a left-to-right tree of cards. Replies go most-discussed
 * first, `perNode` at a time, with a stub saying how many more there are; a
 * folded post shows how many replies it hides. `y` is a row index times
 * `rowHeight`, parents centred on their children.
 */
export function flowLayout(
  root: ThreadPost,
  {
    folded,
    expanded,
    perNode = 6,
    colWidth,
    rowHeight,
  }: { folded: ReadonlySet<string>; expanded: ReadonlySet<string>; perNode?: number; colWidth: number; rowHeight: number },
): { cards: FlowCard[]; stubs: FlowStub[]; rows: number; maxDepth: number } {
  const cards: FlowCard[] = [];
  const stubs: FlowStub[] = [];
  let row = 0;
  let maxDepth = 0;
  const base = root.depth;
  const place = (p: ThreadPost): number => {
    const col = p.depth - base;
    maxDepth = Math.max(maxDepth, col);
    const isFolded = folded.has(p.uri) && p.kids.length > 0;
    const sorted = [...p.kids].sort((a, b) => b.size - a.size || Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const kids = isFolded ? [] : expanded.has(p.uri) ? sorted : sorted.slice(0, perNode);
    let y: number;
    if (!kids.length) {
      y = row++ * rowHeight;
    } else {
      const ys = kids.map(place);
      const hidden = p.kids.length - kids.length;
      if (hidden > 0) {
        const sy = row++ * rowHeight;
        stubs.push({ parent: p, hidden, x: (col + 1) * colWidth, y: sy });
        ys.push(sy);
      }
      y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    cards.push({ post: p, x: col * colWidth, y, folded: isFolded ? p.size - 1 : 0 });
    return y;
  };
  place(root);
  return { cards, stubs, rows: row, maxDepth };
}

/**
 * Which posts a flow chart folds on first draw: past the second level, for
 * threads big enough that drawing everything would bury the shape. Small
 * threads open in full.
 */
export function defaultFolds(root: ThreadPost, { minSize = 40, depth = 2 } = {}): Set<string> {
  const out = new Set<string>();
  if (root.size < minSize) return out;
  for (const p of flattenThread(root)) if (p.depth - root.depth >= depth && p.kids.length) out.add(p.uri);
  return out;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

const S32 = '234567abcdefghijklmnopqrstuvwxyz';

/**
 * Milliseconds since the epoch from a TID record key, or null when the key
 * isn't one. Constellation returns linking records as (did, collection,
 * rkey), and for likes and reposts the TID is the only clock it gives.
 */
export function tidToMs(rkey: string): number | null {
  if (!/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/.test(rkey)) return null;
  let n = BigInt(0);
  for (const c of rkey) n = n * BigInt(32) + BigInt(S32.indexOf(c));
  return Number((n >> BigInt(10)) / BigInt(1000));
}

export function didOfUri(uri: string | undefined | null): string | null {
  const m = /^at:\/\/(did:[^/]+)/.exec(uri || '');
  return m ? m[1] : null;
}

/** Items laid in a column of `n` rows centred on `centre`. Returns each row's top. */
export function stackAround(centre: number, n: number, rowHeight: number, cardHeight: number): number[] {
  const top = centre - (n * rowHeight - (rowHeight - cardHeight)) / 2;
  return Array.from({ length: n }, (_, i) => top + i * rowHeight);
}

/* ------------------------------------------------------------------ */
/* A tree of mixed cards                                                */
/* ------------------------------------------------------------------ */

export type TreeNode = { key: string; w: number; h: number; children: TreeNode[] };
export type PlacedNode = { key: string; x: number; y: number; w: number; h: number; parent: string | null; depth: number };

/**
 * Left to right, one column per depth, each column as wide as its widest
 * card. Leaves stack top to bottom; a parent sits level with the middle of
 * its children, and a parent taller than its children pushes the whole
 * subtree down so nothing overlaps. Cards can be any height, which the
 * thread explorer needs: a post is taller than a person.
 */
export function treeLayout(
  root: TreeNode,
  { colGap = 56, rowGap = 12 }: { colGap?: number; rowGap?: number } = {},
): { nodes: PlacedNode[]; width: number; height: number } {
  const colWidth: number[] = [];
  const measure = (n: TreeNode, depth: number) => {
    colWidth[depth] = Math.max(colWidth[depth] ?? 0, n.w);
    n.children.forEach((c) => measure(c, depth + 1));
  };
  measure(root, 0);
  const colX = colWidth.map((_, i) => colWidth.slice(0, i).reduce((s, w) => s + w + colGap, 0));

  const placed = new Map<string, PlacedNode>();
  const shift = (n: TreeNode, dy: number) => {
    placed.get(n.key)!.y += dy;
    n.children.forEach((c) => shift(c, dy));
  };
  // Places `n` with its subtree starting at `top`; returns the subtree's bottom.
  const place = (n: TreeNode, depth: number, top: number, parent: string | null): number => {
    const me: PlacedNode = { key: n.key, x: colX[depth], y: top, w: n.w, h: n.h, parent, depth };
    placed.set(n.key, me);
    if (!n.children.length) return top + n.h;
    let cursor = top;
    let bottom = top;
    for (const c of n.children) {
      bottom = place(c, depth + 1, cursor, n.key);
      cursor = bottom + rowGap;
    }
    const first = placed.get(n.children[0].key)!;
    const last = placed.get(n.children[n.children.length - 1].key)!;
    me.y = (first.y + first.h / 2 + last.y + last.h / 2) / 2 - n.h / 2;
    if (me.y < top) {
      const dy = top - me.y;
      shift(n, dy);
      bottom += dy;
    }
    return Math.max(bottom, me.y + n.h);
  };
  const height = place(root, 0, 0, null);
  const nodes = [...placed.values()];
  const width = Math.max(...nodes.map((p) => p.x + p.w));
  return { nodes, width, height };
}
