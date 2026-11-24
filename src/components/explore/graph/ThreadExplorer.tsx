'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Ban, Maximize2, Minus, Plus, RotateCcw, Scan, Search, SlidersHorizontal, X } from 'lucide-react';
import PageToolbar from '@/components/PageToolbar';
import {
  defaultFolds,
  flattenThread,
  relationOf,
  treeLayout,
  type Relation,
  type ThreadPost,
} from '@/lib/socialGraph';
import {
  PIN_SLOTS,
  blockBetween,
  blockLinks,
  blockWords,
  blockedWith,
  indexBlocks,
  outsideLabels,
  parentsOf,
  pathTo,
  postMatches,
  readCut,
  sortReplies,
  type Between,
  type CutReading,
  type CutReply,
  type ReplyOrder,
} from '@/lib/threadInsights';
import {
  linkRecords,
  loadReplies,
  loadThread,
  loadThreadRelations,
  otherLinks,
  postAccounts,
  postQuotes,
  type FollowRelation,
  type GraphAccount,
  type LinkRecord,
  type LinkSource,
  type ThreadGraph,
} from '@/utils/atproto/graphData';
import { loadThreadInsights, type ThreadInsights } from '@/utils/atproto/threadInsightsData';
import { useTreeMotion, type MotionNode } from './motion';
import {
  Face,
  GraphDefs,
  GraphDetail,
  Legend,
  fmt,
  markProps,
  nameOf,
  relationColor,
  truncate,
  usePickedDetails,
  wrapLines,
} from './shared';
import { AccountInsight, CutDetail, type BlockRow } from './ThreadInsightPane';
import ThreadToolbar, { pinColor, type Layers, type PersonRow } from './ThreadToolbar';

/* ------------------------------------------------------------------ */
/* Opening and closing                                                  */
/* ------------------------------------------------------------------ */

/**
 * The explorer is open while the address ends in `#explore-<rkey>`, so Back
 * closes it, a link can open it, and the title bar's button and the Thread
 * section's both open the same one. Opening sets the hash, which adds a
 * history entry; closing goes back over that entry when this page added it,
 * and otherwise (arrived with the hash already on) clears it in place, so
 * closing never leaves the page.
 */
const hashFor = (rkey: string) => `#explore-${rkey}`;
let pushedHash: string | null = null;
let opener: HTMLElement | null = null;

/**
 * Whether to skip motion: the site's own setting (`data-reduce-motion` on
 * <html>, globals.css), which starts from the OS's and can be flipped either
 * way in settings.
 */
function still(): boolean {
  const set = document.documentElement.dataset.reduceMotion;
  return set ? set === 'true' : window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The box of the button the explorer opens from, as the `clip-path` the
 * explorer grows out of and shrinks back into (graph.css), or null when the
 * button isn't on screen to grow out of.
 */
function insetOf(el: HTMLElement | null): string | null {
  const r = el?.getBoundingClientRect();
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;
  if (!r || !r.width || r.bottom <= 0 || r.right <= 0 || r.top >= h || r.left >= w) return null;
  const px = (n: number) => `${Math.round(Math.max(0, n))}px`;
  return `inset(${px(r.top)} ${px(w - r.right)} ${px(h - r.bottom)} ${px(r.left)} round 10px)`;
}

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function openExplorer(rkey: string) {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  pushedHash = hashFor(rkey);
  window.location.hash = pushedHash.slice(1);
}

function closeExplorer(hash: string) {
  if (pushedHash === hash) {
    pushedHash = null;
    window.history.back();
  } else {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  opener?.focus();
  opener = null;
}

/**
 * "Explore thread" for a Bluesky post: a button that opens the full-screen
 * explorer, and the explorer itself while it's open.
 */
export default function ThreadExplorer({ uri, rkey }: { uri: string; rkey: string }) {
  const hash = hashFor(rkey);
  const open = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash === hash,
    () => false,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Closed, the explorer stays up a moment longer while it shrinks back
  // into the button, then goes. Reduced motion makes that instant.
  const [leaving, setLeaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setLeaving(!open);
  }
  useEffect(() => {
    if (!leaving) return undefined;
    // In case the animation never ends: a hidden tab doesn't run it.
    const t = window.setTimeout(() => setLeaving(false), 600);
    return () => window.clearTimeout(t);
  }, [leaving]);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="fn-rec-btn"
        onClick={() => openExplorer(rkey)}
        title="Explore this post’s replies, quotes, likes and links full screen"
      >
        <Maximize2 size={14} aria-hidden /> Explore thread
      </button>
      {(open || leaving) &&
        createPortal(
          <Explorer
            uri={uri}
            origin={buttonRef}
            leaving={!open}
            onLeft={() => setLeaving(false)}
            onClose={() => closeExplorer(hash)}
          />,
          document.body,
        )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The tree                                                             */
/* ------------------------------------------------------------------ */

type GroupKind = 'quotes' | 'likes' | 'reposts' | 'links';
const GROUPS: readonly GroupKind[] = ['quotes', 'likes', 'reposts', 'links'];

type ListState = {
  items: (GraphAccount | ThreadPost | LinkSource | LinkRecord)[];
  cursor?: string;
  loading: boolean;
  failed: boolean;
};

type XKind =
  | { kind: 'post'; post: ThreadPost }
  | { kind: 'ghost'; cut: CutReply; reading: CutReading }
  | { kind: 'group'; open: string; label: string }
  | { kind: 'account'; account: GraphAccount }
  | { kind: 'source'; open: string; source: LinkSource; isOpen: boolean }
  | { kind: 'record'; record: LinkRecord; label: string }
  | { kind: 'note'; text: string; action?: () => void };
type XNode = { key: string; w: number; h: number; children: XNode[] } & XKind;

const SIZE = {
  post: [300, 120],
  ghost: [300, 104],
  group: [210, 36],
  account: [240, 46],
  source: [240, 40],
  record: [260, 50],
  note: [200, 34],
} as const;

/** Replies shown under a post before "more replies", in the chosen order. */
const REPLIES_AT_ONCE = 6;
/** Items shown in a group before "Show more". */
const PAGE = 8;
/** No path through quotes of quotes goes deeper than this. */
const MAX_DEPTH = 40;
/** The canvas's margin above and below the tree. */
const PAD = 48;
/**
 * Its margin either side, wider, so the first and last columns of cards can
 * be brought in from the screen's edge rather than pinned to it.
 */
const PAD_X = 160;
/** The search and filters, which a phone shows as a sheet (aria-controls). */
const SHEET_ID = 'fx-tx-tools';

const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

/** Pointing at a card only marks it (CSS); the details wait for a click. */
const quiet = () => {};

const isEditable = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

/** A left-out reply, shaped as a post so the details pane can be opened on it. */
function ghostPost(c: CutReply): ThreadPost {
  return {
    uri: c.uri,
    parent: c.parent,
    did: c.did,
    handle: c.author?.handle,
    displayName: c.author?.displayName,
    avatar: c.author?.avatar,
    text: c.text ?? '',
    createdAt: c.createdAt ?? '',
    likes: c.likes ?? 0,
    reposts: c.reposts ?? 0,
    replies: 0,
    quotes: 0,
    hasMedia: c.hasMedia,
    depth: 0,
    kids: [],
    size: 1,
  };
}

/** A small circle with a bar through it: the drawing's mark for a block. */
function BlockGlyph({ x, y, r = 7 }: { x: number; y: number; r?: number }) {
  const d = r * 0.62;
  return (
    <g className="fx-tx-blockglyph" aria-hidden>
      <circle cx={x} cy={y} r={r} />
      <line x1={x - d} y1={y + d} x2={x + d} y2={y - d} />
    </g>
  );
}

/** A pill in the top-right corner of a card. */
type Badge = { id: string; text: string; cls: string; title: string; icon?: 'block'; color?: string; round?: boolean };

const badgeWidth = (b: Badge) => (b.round ? 18 : b.text.length * 6.3 + (b.icon ? 26 : 14));

function drawBadges(badges: Badge[], right: number, y: number): { nodes: React.ReactNode; left: number } {
  let cx = right;
  const nodes = badges.map((b) => {
    const w = badgeWidth(b);
    cx -= w;
    const at = cx;
    cx -= 5;
    return (
      <g key={b.id} className={`fx-tx-badge ${b.cls}`}>
        <title>{b.title}</title>
        {b.round ? (
          <>
            <circle cx={at + 9} cy={y + 9} r={9} style={{ fill: b.color }} />
            <text x={at + 9} y={y + 13} textAnchor="middle">
              {b.text}
            </text>
          </>
        ) : (
          <>
            <rect x={at} y={y} width={w} height={18} rx={9} />
            {b.icon === 'block' && <BlockGlyph x={at + 11} y={y + 9} r={5} />}
            <text x={at + (b.icon ? 20 : 7)} y={y + 13}>
              {b.text}
            </text>
          </>
        )}
      </g>
    );
  });
  return { nodes, left: cx };
}

/**
 * A Bluesky post's whole neighbourhood, full screen: the thread it belongs
 * to as a tree of post cards, and on each card the ways in from elsewhere
 * (quotes, likes, reposts, and records in other apps that link to it), each
 * opening as a branch of its own. Quote posts are posts like any other, so a
 * quote opens onto its own replies, quotes and links, and the tree can wander
 * across threads.
 *
 * On top of the tree it says what the Bluesky app doesn't (see
 * lib/threadInsights.ts): the replies Bluesky leaves out, drawn where they
 * would be; the replies it folds away; and the blocks between the people
 * posting, as a mark on each card, as the line between two posts when it
 * runs across a reply, and as arcs from whoever is pinned or picked. The
 * toolbar searches the thread, pins up to four people to trace (their
 * posts, and the way down to each, take a colour and a number), reorders
 * and folds the tree, and turns those layers on and off.
 *
 * A card's details open beside the canvas for a click and close again with
 * a second click, their close button or Esc (a second Esc closes the
 * explorer). Pointing at a card only marks it.
 */
function Explorer({
  uri,
  origin,
  leaving,
  onLeft,
  onClose,
}: {
  uri: string;
  /** The button it opened from: it grows out of it and shrinks back in. */
  origin: RefObject<HTMLElement | null>;
  /** Closed, and on its way out. */
  leaving: boolean;
  onLeft: () => void;
  onClose: () => void;
}) {
  const [thread, setThread] = useState<ThreadGraph | null>(null);
  const [failed, setFailed] = useState(false);
  const [relations, setRelations] = useState<Map<string, FollowRelation>>(() => new Map());
  const [folded, setFolded] = useState<Set<string> | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [lists, setLists] = useState<Map<string, ListState>>(() => new Map());
  const [subtrees, setSubtrees] = useState<Map<string, ThreadPost | 'loading' | 'failed'>>(() => new Map());
  const [shown, setShown] = useState<Map<string, number>>(() => new Map());
  const { picked: focus, pick, close, closePane, drawingProps } = usePickedDetails<HTMLDivElement>(false);
  const focusRef = useRef(focus);
  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);
  const [zoom, setZoom] = useState(1);
  const [reveal, setReveal] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [insights, setInsights] = useState<ThreadInsights | null>(null);
  const [order, setOrder] = useState<ReplyOrder>('discussed');
  const [query, setQuery] = useState('');
  const [matchAt, setMatchAt] = useState(-1);
  const [pins, setPins] = useState<string[]>([]);
  const [layers, setLayers] = useState<Layers>({ blocks: false, cut: true, spotlight: true });
  // Posts that must be drawn, whatever is folded: search hits stepped to,
  // pinned people's posts, anyone jumped to. Their way down is opened too.
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [goto, setGoto] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const pinCursor = useRef(new Map<string, number>());
  const cutCursor = useRef(-1);
  // On a phone the search and filters (ThreadToolbar) sit in a sheet that
  // rises out of the bottom toolbar, and this is whether it's up. Wider, they
  // stay under the header and this does nothing (graph.css).
  const [sheet, setSheet] = useState(false);
  const sheetRef = useRef(sheet);
  useEffect(() => {
    sheetRef.current = sheet;
  }, [sheet]);
  const leavingRef = useRef(leaving);
  useEffect(() => {
    leavingRef.current = leaving;
  }, [leaving]);

  // It grows out of the button it opened from, and shrinks back into it on
  // the way out, wherever that button is now (graph.css).
  useLayoutEffect(() => {
    const el = dialogRef.current;
    const from = insetOf(origin.current);
    if (!el) return;
    if (from) el.style.setProperty('--fx-tx-from', from);
    else el.style.removeProperty('--fx-tx-from');
  }, [origin, leaving]);

  // The page underneath stays put while the explorer is up. Escape closes
  // it, once any details open beside the canvas are closed, and / searches.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    dialogRef.current?.focus();
    // The explorer owns the keyboard while it's up. The site's shortcuts and
    // the workbench's (Esc closes the record, j and k step through records)
    // listen on window, so a key stops here, at the document, on its way
    // there: one Esc used to close both the explorer and the record under it.
    // What the key does by default (Tab, scrolling, typing) is untouched.
    const onKey = (e: KeyboardEvent) => {
      if (leavingRef.current) return;
      e.stopPropagation();
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditable(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (sheetRef.current) setSheet(false);
      else if (focusRef.current) close(true);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      root.style.overflow = before;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, close]);

  // A tap anywhere but the sheet puts it away, as the site menu's sheet does;
  // the toolbar's own button toggles it, so it's left to do that.
  useEffect(() => {
    if (!sheet) return undefined;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest(`#${SHEET_ID}, [aria-controls="${SHEET_ID}"]`)) return;
      setSheet(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [sheet]);

  useEffect(() => {
    const ac = new AbortController();
    loadThread(uri, ac.signal).then((t) => {
      if (ac.signal.aborted) return;
      if (!t) setFailed(true);
      else setThread(t);
    });
    return () => ac.abort();
  }, [uri]);

  useEffect(() => {
    if (!thread) return undefined;
    const ac = new AbortController();
    void loadThreadInsights(thread, setInsights, ac.signal);
    return () => ac.abort();
  }, [thread]);

  const op = thread?.root.did ?? null;
  const opName = thread?.root.handle ? `@${thread.root.handle}` : 'the first poster';

  // What a big thread starts with folded: past the second level, except on
  // the way to the post the explorer was opened from.
  const ancestors = useMemo(() => {
    if (!thread) return new Set<string>();
    const byUri = new Map(flattenThread(thread.root).map((p) => [p.uri, p]));
    const out = new Set<string>();
    for (let p = byUri.get(thread.focus); p?.parent; p = byUri.get(p.parent)) out.add(p.parent);
    return out;
  }, [thread]);
  const foldedNow = useMemo(() => {
    if (folded) return folded;
    if (!thread) return new Set<string>();
    const f = defaultFolds(thread.root);
    for (const a of ancestors) f.delete(a);
    return f;
  }, [folded, thread, ancestors]);
  const expandedNow = useMemo(() => new Set([...expanded, ...ancestors]), [expanded, ancestors]);

  /* ---------------- what the insights say ---------------- */

  const allPosts = useMemo(() => (thread ? flattenThread(thread.root) : []), [thread]);
  const cuts = useMemo(() => insights?.cut ?? [], [insights?.cut]);
  const cutByParent = useMemo(() => {
    const m = new Map<string, CutReply[]>();
    for (const c of cuts) m.set(c.parent, [...(m.get(c.parent) ?? []), c]);
    return m;
  }, [cuts]);
  const cutByUri = useMemo(() => new Map(cuts.map((c) => [c.uri, c])), [cuts]);
  const postByUri = useMemo(() => new Map(allPosts.map((p) => [p.uri, p])), [allPosts]);
  const didOfPost = useMemo(() => new Map(allPosts.map((p) => [p.uri, p.did])), [allPosts]);
  const authorOf = useCallback((u: string) => didOfPost.get(u) ?? cutByUri.get(u)?.did, [didOfPost, cutByUri]);
  const parents = useMemo(() => {
    const m = thread ? parentsOf(thread.root) : new Map<string, string | null>();
    for (const c of cuts) m.set(c.uri, c.parent);
    return m;
  }, [thread, cuts]);
  const blockIndex = useMemo(() => indexBlocks(insights?.blocks ?? []), [insights?.blocks]);
  const blocksDone = insights?.stage === 'done';
  const postsBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of allPosts) m.set(p.did, (m.get(p.did) ?? 0) + 1);
    return m;
  }, [allPosts]);

  const handles = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of allPosts) if (p.handle) m.set(p.did, p.handle);
    for (const [d, f] of insights?.authors ?? []) if (f.handle && !m.has(d)) m.set(d, f.handle);
    for (const c of cuts) if (c.author?.handle && !m.has(c.did)) m.set(c.did, c.author.handle);
    return m;
  }, [allPosts, insights?.authors, cuts]);
  const atNameOf = useCallback(
    (did: string | undefined) => {
      if (!did) return 'someone';
      const h = handles.get(did);
      return h ? `@${h}` : `${did.slice(0, 16)}…`;
    },
    [handles],
  );

  const readingOf = useCallback(
    (c: CutReply): CutReading =>
      readCut(c, {
        rootDid: op ?? '',
        parentDid: didOfPost.get(c.parent) ?? '',
        name: atNameOf,
        blocks: blockIndex,
        blocksDone,
        blocksRead: (d) => insights?.blocksRead.has(d) ?? false,
        gateRestricted: thread?.gate.restricted ?? false,
      }),
    [op, didOfPost, atNameOf, blockIndex, blocksDone, insights?.blocksRead, thread?.gate.restricted],
  );

  /* ---------------- reading what a branch needs ---------------- */

  const asked = useRef(new Set<string>());
  const listsRef = useRef(lists);
  const fetchList = useCallback(async (key: string, more = false) => {
    const [postUri, kind, ...rest] = key.split('|');
    const prev = listsRef.current.get(key);
    if (prev?.loading || (prev && !more) || (prev && more && !prev.cursor)) return;
    if (!more && asked.current.has(key)) return;
    asked.current.add(key);
    const pending: ListState = { items: prev?.items ?? [], cursor: prev?.cursor, loading: true, failed: false };
    listsRef.current.set(key, pending);
    setLists((m) => new Map(m).set(key, pending));
    let page: { items: ListState['items']; cursor?: string } | null;
    if (kind === 'likes' || kind === 'reposts') page = await postAccounts(postUri, kind, prev?.cursor);
    else if (kind === 'quotes') page = await postQuotes(postUri, prev?.cursor);
    else if (kind === 'links') {
      const sources = await otherLinks(postUri);
      page = sources ? { items: sources } : null;
    } else page = await linkRecords(postUri, rest.join('|'), prev?.cursor);
    const next: ListState = page
      ? { items: [...(prev?.items ?? []), ...page.items], cursor: page.cursor, loading: false, failed: false }
      : { items: prev?.items ?? [], cursor: prev?.cursor, loading: false, failed: true };
    listsRef.current.set(key, next);
    setLists((m) => new Map(m).set(key, next));
  }, []);

  useEffect(() => {
    for (const key of open) if (!asked.current.has(key)) void fetchList(key);
  }, [open, fetchList]);

  // Every new account gets its relation to the first poster, a batch at a time.
  const relAsked = useRef(new Set<string>());
  useEffect(() => {
    if (!op || !thread) return;
    const dids = new Set<string>(flattenThread(thread.root).map((p) => p.did));
    for (const l of lists.values()) {
      for (const item of l.items) {
        if ('did' in item && typeof item.did === 'string') dids.add(item.did);
      }
    }
    for (const s of subtrees.values()) if (typeof s === 'object') flattenThread(s).forEach((p) => dids.add(p.did));
    for (const c of cuts) dids.add(c.did);
    const missing = [...dids].filter((d) => d !== op && !relAsked.current.has(d));
    if (!missing.length) return;
    missing.forEach((d) => relAsked.current.add(d));
    void loadThreadRelations(op, missing).then((r) => {
      if (r) setRelations((m) => new Map([...m, ...r]));
    });
  }, [op, thread, lists, subtrees, cuts]);

  const relationOfDid = useCallback(
    (did: string): Relation | 'op' => {
      if (did === op) return 'op';
      const r = relations.get(did);
      return r ? relationOf({ ...r, inCommon: null }) : 'further';
    },
    [op, relations],
  );

  const relationFor = useCallback(
    (did: string): string | null => {
      if (did === op) return 'Started this thread';
      const r = relations.get(did);
      if (!r) return null;
      if (r.following && r.followedBy) return `Mutual with ${opName}`;
      if (r.following) return `${opName} follows them`;
      if (r.followedBy) return `Follows ${opName}`;
      return `Neither follows ${opName}`;
    },
    [op, opName, relations],
  );

  /* ---------------- finding and tracing ---------------- */

  // The thread's posts in the order they're drawn, each post's left-out
  // replies after its own, for stepping through search hits and through a
  // pinned person's posts top to bottom.
  const treeOrder = useMemo(() => {
    const out: string[] = [];
    const walk = (p: ThreadPost) => {
      out.push(p.uri);
      for (const k of sortReplies(p.kids, order)) walk(k);
      for (const c of cutByParent.get(p.uri) ?? []) out.push(c.uri);
    };
    if (thread) walk(thread.root);
    return out;
  }, [thread, order, cutByParent]);

  const searching = query.trim().length > 0;
  const matches = useMemo(() => {
    if (!searching) return [];
    return treeOrder.filter((u) => {
      const p = cutByUri.get(u);
      if (p) return layers.cut && postMatches({ text: p.text ?? '', handle: p.author?.handle, displayName: p.author?.displayName }, query);
      const post = postByUri.get(u);
      return !!post && postMatches(post, query);
    });
  }, [searching, treeOrder, cutByUri, postByUri, query, layers.cut]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const currentHit = matchAt >= 0 ? (matches[matchAt] ?? null) : null;

  // The way down to each pinned person's posts, one set per pin.
  const pinPaths = useMemo(
    () => pins.map((did) => pathTo(parents, treeOrder.filter((u) => authorOf(u) === did))),
    [pins, parents, treeOrder, authorOf],
  );
  const traceSlot = useCallback((u: string) => pinPaths.findIndex((s) => s.has(u)), [pinPaths]);

  const mustShow = useMemo(() => pathTo(parents, revealed), [parents, revealed]);
  const forcedOpen = useMemo(
    () => new Set([...mustShow].map((u) => parents.get(u)).filter((u): u is string => !!u)),
    [mustShow, parents],
  );

  // Whoever a pinned person is in a block with stays lit too, so the arcs
  // between them don't end on a faded card.
  const pinPeers = useMemo(() => new Set(pins.flatMap((d) => [...blockedWith(blockIndex, d)])), [pins, blockIndex]);
  const spot = layers.spotlight && (searching || pins.length > 0);
  const lit = useCallback(
    (u: string | null, did: string | null) =>
      (searching && !!u && matchSet.has(u)) ||
      (pins.length > 0 &&
        ((!!did && (pins.includes(did) || pinPeers.has(did))) || (!!u && pinPaths.some((s) => s.has(u))))),
    [searching, matchSet, pins, pinPeers, pinPaths],
  );

  const goTo = useCallback((u: string) => {
    setRevealed((s) => (s.has(u) ? s : new Set(s).add(u)));
    setGoto(u);
    setFlash(u);
  }, []);

  useEffect(() => {
    if (!flash) return undefined;
    const t = window.setTimeout(() => setFlash(null), 1600);
    return () => window.clearTimeout(t);
  }, [flash]);

  const onQuery = (q: string) => {
    setQuery(q);
    setMatchAt(-1);
  };

  const step = (by: 1 | -1) => {
    if (!matches.length) return;
    const next = matchAt < 0 ? (by === 1 ? 0 : matches.length - 1) : (matchAt + by + matches.length) % matches.length;
    setMatchAt(next);
    goTo(matches[next]);
  };

  const togglePin = (did: string) => {
    if (pins.includes(did)) {
      setPins((ps) => ps.filter((d) => d !== did));
      return;
    }
    if (pins.length >= PIN_SLOTS) return;
    setPins((ps) => [...ps, did]);
    // Everything they posted is drawn, so the trace is whole, and the view
    // goes to the first of it.
    const theirs = treeOrder.filter((u) => authorOf(u) === did);
    setRevealed((s) => new Set([...s, ...theirs]));
    if (cuts.some((c) => c.did === did)) setLayers((l) => ({ ...l, cut: true }));
    if (theirs.length) {
      pinCursor.current.set(did, 0);
      setGoto(theirs[0]);
      setFlash(theirs[0]);
    }
  };

  const postsOf = useCallback((did: string) => treeOrder.filter((u) => authorOf(u) === did), [treeOrder, authorOf]);

  const jumpTo = (did: string) => {
    const list = postsOf(did);
    if (!list.length) return;
    const i = ((pinCursor.current.get(did) ?? -1) + 1) % list.length;
    pinCursor.current.set(did, i);
    goTo(list[i]);
  };

  /** Someone named in the details: their first post, drawn, shown and picked. */
  const goToPerson = (did: string) => {
    const first = postsOf(did)[0];
    if (!first) return;
    goTo(first);
    const c = cutByUri.get(first);
    if (c) setLayers((l) => ({ ...l, cut: true }));
    const post = c ? ghostPost(c) : postByUri.get(first);
    if (post && !(focus?.kind === 'post' && focus.post.uri === first)) pick({ kind: 'post', post });
  };

  const nextCut = () => {
    if (!cuts.length) return;
    const ordered = treeOrder.filter((u) => cutByUri.has(u));
    cutCursor.current = (cutCursor.current + 1) % ordered.length;
    setLayers((l) => ({ ...l, cut: true }));
    goTo(ordered[cutCursor.current]);
  };

  const expandAll = () => {
    setFolded(new Set());
    setExpanded(new Set(allPosts.filter((p) => p.kids.length).map((p) => p.uri)));
  };

  const collapseAll = () => {
    if (!thread) return;
    const base = thread.root.depth;
    setFolded(new Set(allPosts.filter((p) => p.depth > base && p.kids.length && !ancestors.has(p.uri)).map((p) => p.uri)));
    setExpanded(new Set());
    setRevealed(new Set());
  };

  /* ---------------- toggles ---------------- */

  const toggleOpen = (key: string, nodeKey: string) => {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setReveal(nodeKey);
  };

  const toggleReplies = (post: ThreadPost, nodeKey: string, loaded: boolean) => {
    if (!loaded) {
      if (subtrees.has(post.uri)) return;
      setSubtrees((m) => new Map(m).set(post.uri, 'loading'));
      // The view follows the replies in once they're read, as it followed
      // the note that says they're being read.
      void loadReplies(post.uri).then((tree) => {
        setSubtrees((m) => new Map(m).set(post.uri, tree ?? 'failed'));
        setReveal(nodeKey);
      });
    } else {
      const showing = !foldedNow.has(post.uri) || forcedOpen.has(post.uri);
      setFolded(() => {
        const next = new Set(foldedNow);
        if (showing) next.add(post.uri);
        else next.delete(post.uri);
        return next;
      });
      // Folding a post lets go of whatever was holding its replies open.
      if (showing) {
        setRevealed((s) => new Set([...s].filter((u) => u === post.uri || !pathTo(parents, [u]).has(post.uri))));
      }
    }
    setReveal(nodeKey);
  };

  const showMore = (key: string) => {
    const n = (shown.get(key) ?? PAGE) + PAGE;
    setShown((m) => new Map(m).set(key, n));
    const l = listsRef.current.get(key);
    if (l && l.items.length < n && l.cursor) void fetchList(key, true);
  };

  /* ---------------- building the tree ---------------- */

  const tree = useMemo(() => {
    if (!thread) return null;
    const note = (key: string, text: string, action?: () => void): XNode => ({
      key,
      kind: 'note',
      text,
      action,
      w: SIZE.note[0],
      h: SIZE.note[1],
      children: [],
    });
    const postNode = (post: ThreadPost, key: string, depth: number): XNode => {
      const children: XNode[] = [];
      if (depth < MAX_DEPTH) {
        const sub = subtrees.get(post.uri);
        const source = typeof sub === 'object' ? sub : post;
        const repliesOpen = !foldedNow.has(post.uri) || forcedOpen.has(post.uri);
        let more: XNode | null = null;
        if (sub === 'loading') children.push(note(`${key}>loading`, 'Reading replies…'));
        else if (sub === 'failed') children.push(note(`${key}>failed`, 'Couldn’t read the replies'));
        else if (source.kids.length && repliesOpen) {
          const sorted = sortReplies(source.kids, order);
          const kids = expandedNow.has(post.uri)
            ? sorted
            : sorted.filter((k, i) => i < REPLIES_AT_ONCE || mustShow.has(k.uri));
          for (const k of kids) children.push(postNode(k, `${key}>${k.uri}`, depth + 1));
          const hidden = sorted.length - kids.length;
          if (hidden > 0) {
            more = note(`${key}>more`, `${plural(hidden, 'more reply', 'more replies')}`, () => {
              setExpanded((e) => new Set(e).add(post.uri));
              setReveal(key);
            });
          }
        }
        // Left-out replies go where the AppView would have put them, after
        // the replies it did return, unless those are folded away.
        if (layers.cut && (repliesOpen || !source.kids.length)) {
          for (const c of cutByParent.get(post.uri) ?? []) {
            children.push({
              key: `${key}>${c.uri}`,
              kind: 'ghost',
              cut: c,
              reading: readingOf(c),
              w: SIZE.ghost[0],
              h: SIZE.ghost[1],
              children: [],
            });
          }
        }
        if (more) children.push(more);
        for (const g of GROUPS) {
          const openKey = `${post.uri}|${g}`;
          if (open.has(openKey)) children.push(groupNode(post, g, key, depth));
        }
      }
      return { key, kind: 'post', post, w: SIZE.post[0], h: SIZE.post[1], children };
    };
    const groupNode = (post: ThreadPost, g: GroupKind, parentKey: string, depth: number): XNode => {
      const openKey = `${post.uri}|${g}`;
      const key = `${parentKey}|${g}`;
      const list = lists.get(openKey);
      const n = shown.get(openKey) ?? PAGE;
      const children: XNode[] = [];
      if (!list || (list.loading && !list.items.length)) children.push(note(`${key}>loading`, 'Reading…'));
      else if (list.failed && !list.items.length) children.push(note(`${key}>failed`, 'Couldn’t read this'));
      else if (!list.items.length) children.push(note(`${key}>none`, g === 'links' ? 'No links from other apps' : 'None found'));
      else {
        for (const item of list.items.slice(0, n)) {
          if (g === 'quotes') {
            const q = item as ThreadPost;
            children.push(postNode(q, `${key}>${q.uri}`, depth + 2));
          } else if (g === 'links') {
            const src = item as LinkSource;
            const srcOpen = `${post.uri}|link|${src.source}`;
            const srcKey = `${key}>${src.source}`;
            const recs: XNode[] = [];
            if (open.has(srcOpen)) {
              const l = lists.get(srcOpen);
              const m = shown.get(srcOpen) ?? PAGE;
              if (!l || (l.loading && !l.items.length)) recs.push(note(`${srcKey}>loading`, 'Reading…'));
              else if (l.failed && !l.items.length) recs.push(note(`${srcKey}>failed`, 'Couldn’t read this'));
              else {
                for (const r of l.items.slice(0, m) as LinkRecord[]) {
                  recs.push({ key: `${srcKey}>${r.uri}`, kind: 'record', record: r, label: src.label, w: SIZE.record[0], h: SIZE.record[1], children: [] });
                }
                if (l.items.length > m || l.cursor) recs.push(note(`${srcKey}>more`, 'Show more', () => showMore(srcOpen)));
              }
            }
            children.push({ key: srcKey, kind: 'source', open: srcOpen, source: src, isOpen: open.has(srcOpen), w: SIZE.source[0], h: SIZE.source[1], children: recs });
          } else {
            const a = item as GraphAccount;
            children.push({ key: `${key}>${a.did}`, kind: 'account', account: a, w: SIZE.account[0], h: SIZE.account[1], children: [] });
          }
        }
        if (list.items.length > n || list.cursor) children.push(note(`${key}>more`, 'Show more', () => showMore(openKey)));
      }
      const label =
        g === 'quotes'
          ? plural(post.quotes, 'quote', 'quotes')
          : g === 'likes'
            ? plural(post.likes, 'like', 'likes')
            : g === 'reposts'
              ? plural(post.reposts, 'repost', 'reposts')
              : 'Links from other apps';
      return { key, kind: 'group', open: openKey, label, w: SIZE.group[0], h: SIZE.group[1], children };
    };
    return postNode(thread.root, thread.root.uri, 0);
    // showMore reads refs and state setters only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, subtrees, foldedNow, expandedNow, open, lists, shown, order, mustShow, forcedOpen, layers.cut, cutByParent, readingOf]);

  const layout = useMemo(() => (tree ? treeLayout(tree, { colGap: 64, rowGap: 14 }) : null), [tree]);
  const byKey = useMemo(() => {
    const m = new Map<string, XNode>();
    const walk = (n: XNode) => {
      m.set(n.key, n);
      n.children.forEach(walk);
    };
    if (tree) walk(tree);
    return m;
  }, [tree]);
  const motionNodes = useMemo<MotionNode<XNode>[]>(
    () => layout?.nodes.map((p) => ({ key: p.key, x: p.x, y: p.y, w: p.w, h: p.h, parent: p.parent, data: byKey.get(p.key)! })) ?? [],
    [layout, byKey],
  );
  const motion = useTreeMotion(motionNodes, zoom);
  /** The cards as drawn now, after any drags, without the ones folding away. */
  const shownItems = useMemo(() => motion.items.filter((it) => !it.leaving), [motion.items]);
  // Where each post is first drawn: in the thread before any quote branch.
  const keyOfUri = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of byKey.values()) {
      const u = n.kind === 'post' ? n.post.uri : n.kind === 'ghost' ? n.cut.uri : null;
      if (u && !m.has(u)) m.set(u, n.key);
    }
    return m;
  }, [byKey]);

  /* ---------------- moving around ---------------- */

  const placeOf = motion.place;

  // Open on the post the explorer was opened from, in the middle.
  const started = useRef(false);
  const autoScroll = useRef<{ left: number; top: number } | null>(null);
  const focusKey = useMemo(
    () => (thread ? ([...byKey.values()].find((n) => n.kind === 'post' && n.post.uri === thread.focus)?.key ?? thread.root.uri) : null),
    [thread, byKey],
  );
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !layout || !focusKey || started.current) return;
    started.current = true;
    const p = placeOf(focusKey);
    if (p) {
      box.scrollLeft = Math.max(0, (p.x + PAD_X) * zoom - box.clientWidth / 3);
      box.scrollTop = Math.max(0, (p.y + PAD + p.h / 2) * zoom - box.clientHeight / 2);
      autoScroll.current = { left: box.scrollLeft, top: box.scrollTop };
    }
  }, [layout, focusKey, placeOf, zoom]);

  // Left-out replies land a moment after the thread and push the cards
  // around them aside. If the reader hasn't moved the view yet, it follows
  // the post it opened on as that glides to its new place.
  const followed = useRef(false);
  const cutsKnown = !!insights && insights.stage !== 'reading';
  useEffect(() => {
    const box = boxRef.current;
    const at = autoScroll.current;
    if (followed.current || !cutsKnown || !box || !at || !focusKey) return;
    followed.current = true;
    if (Math.abs(box.scrollLeft - at.left) > 2 || Math.abs(box.scrollTop - at.top) > 2) return;
    const p = placeOf(focusKey);
    if (!p) return;
    box.scrollTo({
      left: Math.max(0, (p.x + PAD_X) * zoom - box.clientWidth / 3),
      top: Math.max(0, (p.y + PAD + p.h / 2) * zoom - box.clientHeight / 2),
      behavior: still() ? 'auto' : 'smooth',
    });
  }, [cutsKnown, focusKey, placeOf, zoom]);

  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // After a branch opens or closes, the view follows it. The post and its
  // replies come into view, moving no further than needed, when they fit.
  // When they don't (at full size on a phone, a post and its replies never
  // do), the replies that just appeared win, with the end of the post they
  // hang off still showing at the left. The view glides as the cards do.
  const shownBefore = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !reveal) return;
    setReveal(null);
    const p = placeOf(reveal);
    if (!p) return;
    const kids = shownItems.filter((n) => n.parent === reveal);
    const fresh = kids.filter((k) => !shownBefore.current.has(k.key));
    const show = fresh.length ? fresh : kids;
    const z = zoom;
    const margin = 40;
    /** Scroll along one axis so a..b (on screen) is in view, or if it can't all be, to `lead`. */
    const along = (pos: number, size: number, a: number, b: number, lead: number) => {
      if (b - a + margin * 2 > size) return lead;
      if (b + margin > pos + size) pos = b + margin - size;
      if (a - margin < pos) pos = a - margin;
      return pos;
    };
    const kidsLeft = show.length ? Math.min(...show.map((k) => k.x)) : p.x;
    const right = Math.max(p.x + p.w, ...show.map((k) => k.x + k.w));
    const top = Math.min(p.y, ...show.map((k) => k.y));
    const bottom = Math.max(p.y + p.h, ...show.map((k) => k.y + k.h));
    const sx = (x: number) => (x + PAD_X) * z;
    const sy = (y: number) => (y + PAD) * z;
    const left = along(
      box.scrollLeft,
      box.clientWidth,
      sx(p.x),
      sx(right),
      show.length ? sx(kidsLeft) - Math.min(96, box.clientWidth / 4) : sx(p.x) - margin,
    );
    const scrollTop = along(
      box.scrollTop,
      box.clientHeight,
      sy(top),
      sy(bottom),
      sy(show.length ? Math.min(...show.map((k) => k.y)) : p.y) - margin,
    );
    box.scrollTo({ left: Math.max(0, left), top: Math.max(0, scrollTop), behavior: still() ? 'auto' : 'smooth' });
  }, [reveal, shownItems, placeOf, zoom]);
  // What was drawn before this render, for the effect above to tell the
  // replies that just appeared from those already there. Declared after it,
  // so it runs after it.
  useEffect(() => {
    shownBefore.current = new Set(shownItems.map((n) => n.key));
  }, [shownItems]);

  // A post stepped to (a search hit, a pinned person's next post, someone
  // named in the details) comes to the middle of the screen.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !goto) return;
    const key = keyOfUri.get(goto);
    const p = key ? placeOf(key) : null;
    setGoto(null);
    if (!p) return;
    box.scrollTo({
      left: Math.max(0, (p.x + PAD_X + p.w / 2) * zoom - box.clientWidth / 2),
      top: Math.max(0, (p.y + PAD + p.h / 2) * zoom - box.clientHeight / 2),
      behavior: still() ? 'auto' : 'smooth',
    });
  }, [goto, keyOfUri, placeOf, zoom]);

  // Zoom about a point on screen (the pointer, or the middle).
  const zoomTo = useCallback((next: number, at?: { x: number; y: number }) => {
    const box = boxRef.current;
    if (!box) return;
    setZoom((z) => {
      const k = Math.max(0.35, Math.min(2, next)) / z;
      const px = at?.x ?? box.clientWidth / 2;
      const py = at?.y ?? box.clientHeight / 2;
      const cx = box.scrollLeft + px;
      const cy = box.scrollTop + py;
      requestAnimationFrame(() => {
        box.scrollLeft = cx * k - px;
        box.scrollTop = cy * k - py;
      });
      return z * k;
    });
  }, []);

  // Pinch or ctrl/cmd + wheel zooms; a plain wheel scrolls as usual.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = box.getBoundingClientRect();
      zoomTo(zoomRef.current * (e.deltaY > 0 ? 0.9 : 1.1), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [zoomTo, thread]);

  // A mouse drag on the background pans; touch scrolls natively.
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    // A press on a card clicks or drags the card.
    if ((e.target as Element).closest('[data-mnode]')) return;
    const box = boxRef.current!;
    drag.current = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop };
    box.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const box = boxRef.current!;
    box.scrollLeft = d.left - (e.clientX - d.x);
    box.scrollTop = d.top - (e.clientY - d.y);
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const width = layout ? Math.max(layout.width, motion.bounds.right) + PAD_X * 2 : 0;
  const height = layout ? Math.max(layout.height, motion.bounds.bottom) + PAD * 2 : 0;

  const fit = () => {
    const box = boxRef.current;
    if (!box || !layout) return;
    const z = Math.min(1, box.clientWidth / width, box.clientHeight / height);
    setZoom(Math.max(0.35, z));
    requestAnimationFrame(() => box.scrollTo({ left: 0, top: 0 }));
  };

  /* ---------------- drawing ---------------- */

  const focusedKey =
    focus?.kind === 'post'
      ? focus.post.uri
      : focus?.kind === 'person'
        ? focus.person.did
        : focus?.kind === 'record'
          ? focus.record.uri
          : null;
  const focusDid =
    focus?.kind === 'post'
      ? focus.post.did
      : focus?.kind === 'person'
        ? focus.person.did
        : focus?.kind === 'record'
          ? focus.record.did
          : null;

  /** The marks a card's author carries, whatever card it is. */
  const authorBadges = (did: string, uri: string | null): Badge[] => {
    const out: Badge[] = [];
    if (did === op) out.push({ id: 'op', text: 'OP', cls: 'fx-tx-b-op', title: `${opName} started this thread` });
    const slot = pins.indexOf(did);
    if (slot >= 0) out.push({ id: 'pin', text: String(slot + 1), cls: 'fx-tx-b-pin', title: `Pinned (${slot + 1})`, round: true, color: pinColor(slot) });
    const n = blockedWith(blockIndex, did).size;
    if (n) {
      out.push({
        id: 'block',
        text: fmt(n),
        cls: 'fx-tx-b-block',
        icon: 'block',
        title: `In a block with ${plural(n, 'other person', 'other people')} in this thread`,
      });
    }
    const fold = uri ? insights?.folded.get(uri) : undefined;
    if (fold) {
      out.push({
        id: 'fold',
        text: fold === 'author' ? 'Hidden by OP' : 'Folded',
        cls: 'fx-tx-b-fold',
        title:
          fold === 'author'
            ? `${opName} hid this reply. Bluesky’s app shows it only to people who ask to see hidden replies.`
            : 'Bluesky’s app keeps this reply out of the thread until someone asks to see more replies.',
      });
    }
    const label = outsideLabels(insights?.authors.get(did)?.labels ?? [], did)[0];
    if (label) out.push({ id: 'label', text: label, cls: 'fx-tx-b-label', title: `The account is labelled “${label}”` });
    return out;
  };

  /** Rings round a card: one for the thread's author, one in a pinned person's colour. */
  const rings = (did: string, x: number, y: number, w: number, h: number) => {
    const slot = pins.indexOf(did);
    return (
      <>
        {slot >= 0 && (
          <rect x={x - 7} y={y - 7} width={w + 14} height={h + 14} rx={16} className="fx-tx-pin-ring" style={{ stroke: pinColor(slot) }} />
        )}
        {did === op && <rect x={x - 3.5} y={y - 3.5} width={w + 7} height={h + 7} rx={13} className="fx-tx-op-ring" />}
      </>
    );
  };

  // The card whose details are open stays lit, and so does everyone its
  // block arcs run to.
  const focusPeers = focusDid ? blockedWith(blockIndex, focusDid) : new Set<string>();
  const markState = (u: string | null, did: string | null) => ({
    'data-dim':
      spot && !lit(u, did) && !(u && u === focusedKey) && !(did && (did === focusDid || focusPeers.has(did))) ? '' : undefined,
    'data-hit': u && matchSet.has(u) ? '' : undefined,
    'data-hit-current': u && u === currentHit ? '' : undefined,
    'data-flash': u && u === flash ? '' : undefined,
  });

  const drawNode = (n: XNode, x: number, y: number) => {
    if (n.kind === 'post') return drawPost(n, n.post, x, y);
    if (n.kind === 'ghost') return drawGhost(n, n.cut, n.reading, x, y);
    if (n.kind === 'group' || n.kind === 'source') {
      const label = n.kind === 'group' ? n.label : `${n.source.label} · ${fmt(n.source.count)}`;
      const isOpen = n.kind === 'group' || n.isOpen;
      return (
        <g
          key={n.key}
          className="fx-graph-mark fx-tx-group"
          role="button"
          aria-expanded={isOpen}
          aria-label={n.kind === 'group' ? `${label}, close` : label}
          data-open={isOpen || undefined}
          data-dim={spot || undefined}
          {...markProps(quiet, () => toggleOpen(n.open, n.key))}
        >
          <rect x={x} y={y} width={n.w} height={n.h} rx={n.h / 2} />
          <text x={x + 16} y={y + n.h / 2 + 4.5} className="fx-graph-t-name">
            {truncate(label, Math.floor((n.w - 28) / 7.4))}
          </text>
        </g>
      );
    }
    if (n.kind === 'account') {
      const a = n.account;
      const badges = drawBadges(authorBadges(a.did, null), x + n.w - 8, y - 9);
      return (
        <g
          key={n.key}
          className="fx-graph-mark"
          role="button"
          aria-label={nameOf(a)}
          data-focus={focusedKey === a.did || undefined}
          {...markState(null, a.did)}
          {...markProps(quiet, () => pick({ kind: 'person', person: a }))}
        >
          {rings(a.did, x, y, n.w, n.h)}
          <rect x={x} y={y} width={n.w} height={n.h} rx={10} className="fx-graph-card" data-op={a.did === op || undefined} />
          <Face x={x + 24} y={y + n.h / 2} r={13} avatar={a.avatar} name={nameOf(a)} ring={relationColor(relationOfDid(a.did))} />
          <text x={x + 47} y={y + 20} className="fx-graph-t-name">
            {truncate(nameOf(a), 24)}
          </text>
          <text x={x + 47} y={y + 36} className="fx-graph-t-sub">
            {truncate(a.handle ? `@${a.handle}` : a.did, 26)}
          </text>
          {badges.nodes}
        </g>
      );
    }
    if (n.kind === 'record') {
      const r = n.record;
      const who = r.author ?? { did: r.did };
      return (
        <g
          key={n.key}
          className="fx-graph-mark"
          role="button"
          aria-label={`${n.label} by ${nameOf(who)}`}
          data-focus={focusedKey === r.uri || undefined}
          {...markState(null, r.did)}
          {...markProps(quiet, () => pick({ kind: 'record', record: r, label: n.label }))}
        >
          <rect x={x} y={y} width={n.w} height={n.h} rx={10} className="fx-graph-card" />
          <Face x={x + 24} y={y + n.h / 2} r={13} avatar={who.avatar} name={nameOf(who)} ring={relationColor(relationOfDid(r.did))} />
          <text x={x + 47} y={y + 21} className="fx-graph-t-name">
            {truncate(nameOf(who), 26)}
          </text>
          <text x={x + 47} y={y + 38} className="fx-graph-t-sub">
            {truncate(r.collection, 30)}
          </text>
        </g>
      );
    }
    const action = n.action;
    return (
      <g
        key={n.key}
        className={action ? 'fx-graph-mark' : undefined}
        role={action ? 'button' : undefined}
        tabIndex={action ? 0 : undefined}
        data-dim={spot || undefined}
        onClick={action}
        onKeyDown={
          action
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  action();
                }
              }
            : undefined
        }
      >
        <rect x={x} y={y} width={n.w} height={n.h} rx={9} className="fx-graph-stub" />
        <text x={x + 14} y={y + n.h / 2 + 4.5} className="fx-graph-t-body">
          {n.text}
        </text>
      </g>
    );
  };

  const drawGhost = (n: XNode, c: CutReply, reading: CutReading, x: number, y: number) => {
    const name = c.author?.displayName || c.author?.handle || atNameOf(c.did);
    const tag = drawBadges(
      [{ id: 'cut', text: 'Left out', cls: 'fx-tx-b-cut', title: 'Bluesky leaves this reply out of the thread' }],
      x + n.w - 10,
      y + 12,
    );
    const lines = c.text === null ? [] : wrapLines(c.text || (c.hasMedia ? 'An image or video' : ''), 40, 2);
    const pillW = Math.min(n.w - 24, reading.label.length * 6.6 + 18);
    return (
      <g
        key={n.key}
        className="fx-graph-mark fx-tx-ghost"
        data-tone={reading.tone}
        role="button"
        aria-label={`Left out on Bluesky: ${name}. ${reading.label}`}
        data-focus={focusedKey === c.uri || undefined}
        {...markState(c.uri, c.did)}
        {...markProps(quiet, () => pick({ kind: 'post', post: ghostPost(c) }))}
      >
        <rect x={x} y={y} width={n.w} height={n.h} rx={10} className="fx-tx-ghost-card" />
        <g className="fx-tx-ghost-body">
          <Face x={x + 26} y={y + 22} r={11} avatar={c.author?.avatar} name={name} ring={relationColor(relationOfDid(c.did))} />
          <text x={x + 44} y={y + 27} className="fx-graph-t-name">
            {truncate(name, Math.max(6, Math.floor((tag.left - x - 50) / 7.4)))}
          </text>
          {c.text === null ? (
            <text x={x + 14} y={y + 52} className="fx-graph-t-body fx-tx-ghost-none">
              Its text couldn’t be read
            </text>
          ) : (
            lines.map((line, i) => (
              <text key={i} x={x + 14} y={y + 50 + i * 16} className="fx-graph-t-body">
                {line}
              </text>
            ))
          )}
        </g>
        {tag.nodes}
        <g className="fx-tx-cut-pill">
          <rect x={x + 12} y={y + n.h - 30} width={pillW} height={22} rx={11} />
          <text x={x + 12 + pillW / 2} y={y + n.h - 15} textAnchor="middle">
            {truncate(reading.label, Math.floor((pillW - 14) / 6.6))}
          </text>
        </g>
      </g>
    );
  };

  const drawPost = (n: XNode, post: ThreadPost, x: number, y: number) => {
    const sub = subtrees.get(post.uri);
    const kids = typeof sub === 'object' ? sub.kids : post.kids;
    const loaded = kids.length > 0;
    const repliesShown = loaded && (!foldedNow.has(post.uri) || forcedOpen.has(post.uri));
    const replyCount = Math.max(post.replies, kids.length);
    type Chip = { id: string; label: string; active: boolean; act: () => void };
    const chips: Chip[] = [];
    if (replyCount > 0) {
      chips.push({
        id: 'replies',
        label: plural(replyCount, 'reply', 'replies'),
        active: repliesShown || sub === 'loading',
        act: () => toggleReplies(post, n.key, loaded),
      });
    }
    const counts: Record<GroupKind, number> = { quotes: post.quotes, likes: post.likes, reposts: post.reposts, links: -1 };
    for (const g of GROUPS) {
      if (counts[g] === 0) continue;
      const openKey = `${post.uri}|${g}`;
      chips.push({
        id: g,
        label:
          g === 'quotes'
            ? plural(post.quotes, 'quote', 'quotes')
            : g === 'likes'
              ? plural(post.likes, 'like', 'likes')
              : g === 'reposts'
                ? plural(post.reposts, 'repost', 'reposts')
                : 'Links',
        active: open.has(openKey),
        act: () => toggleOpen(openKey, n.key),
      });
    }
    let cx = x + 12;
    const placedChips = chips
      .map((c) => {
        const w = c.label.length * 6.6 + 18;
        const at = cx;
        cx += w + 6;
        return { ...c, x: at, w };
      })
      .filter((c) => c.x + c.w <= x + n.w - 8);
    const lines = wrapLines(post.text || (post.hasMedia ? 'An image or video' : ''), 40, 2);
    const isCurrent = post.uri === thread?.focus;
    const badges = drawBadges(authorBadges(post.did, post.uri), x + n.w - 10, y + 12);
    const nameRoom = Math.max(6, Math.floor((badges.left - x - 50) / 7.4));
    return (
      <g key={n.key} {...markState(post.uri, post.did)}>
        {rings(post.did, x, y, n.w, n.h)}
        <g
          className="fx-graph-mark"
          role="button"
          aria-label={`${post.displayName || post.handle}${post.did === op ? ' (started the thread)' : ''}: ${truncate(post.text, 90) || 'no text'}`}
          data-focus={focusedKey === post.uri || undefined}
          {...markProps(quiet, () => {
            pick({ kind: 'post', post });
            // A click also opens the replies if they're closed, but never
            // folds them: reading a post shouldn't fold away what's under it.
            // The replies chip still does both.
            if (replyCount > 0 && !repliesShown) toggleReplies(post, n.key, loaded);
          })}
        >
          <rect
            x={x}
            y={y}
            width={n.w}
            height={n.h}
            rx={10}
            className="fx-graph-card"
            data-current={isCurrent || undefined}
            data-op={post.did === op || undefined}
          />
          <Face x={x + 26} y={y + 22} r={11} avatar={post.avatar} name={post.handle || post.did} ring={relationColor(relationOfDid(post.did))} />
          <text x={x + 44} y={y + 27} className="fx-graph-t-name">
            {truncate(post.displayName || post.handle || '', Math.min(26, nameRoom))}
          </text>
          {lines.map((line, i) => (
            <text key={i} x={x + 14} y={y + 50 + i * 16} className="fx-graph-t-body">
              {line}
            </text>
          ))}
          {badges.nodes}
        </g>
        {placedChips.map((c) => (
          <g
            key={c.id}
            className="fx-graph-mark fx-tx-chip"
            role="button"
            aria-pressed={c.active}
            aria-label={`${c.label} on this post`}
            data-active={c.active || undefined}
            {...markProps(quiet, c.act)}
          >
            <rect x={c.x} y={y + n.h - 32} width={c.w} height={22} rx={11} />
            <text x={c.x + c.w / 2} y={y + n.h - 17} textAnchor="middle">
              {c.label}
            </text>
          </g>
        ))}
      </g>
    );
  };

  /** The account a node is about, if it's about one. */
  const didOfNode = (n: XNode): string | null =>
    n.kind === 'post' ? n.post.did : n.kind === 'ghost' ? n.cut.did : n.kind === 'account' ? n.account.did : null;
  const uriOfNode = (n: XNode): string | null => (n.kind === 'post' ? n.post.uri : n.kind === 'ghost' ? n.cut.uri : null);

  // Arcs for the blocks worth drawing: all of them with the Blocks layer
  // on, otherwise only a pinned or picked account's. Each pair is joined
  // once, between its two nearest cards, and points at whoever is blocked.
  const arcs = useMemo(() => {
    type Card = (typeof shownItems)[number];
    const cards = new Map<string, Card[]>();
    for (const p of shownItems) {
      const did = didOfNode(p.data);
      if (did) cards.set(did, [...(cards.get(did) ?? []), p]);
    }
    const wanted = blockLinks(blockIndex).filter(
      (l) => layers.blocks || pins.includes(l.a) || pins.includes(l.b) || l.a === focusDid || l.b === focusDid,
    );
    const out: { key: string; d: string; both: boolean; a: string; b: string }[] = [];
    for (const { a, b, between } of wanted) {
      const ca = cards.get(a);
      const cb = cards.get(b);
      if (!ca || !cb) continue;
      let best: [Card, Card] | null = null;
      let dist = Infinity;
      for (const p of ca) {
        for (const q of cb) {
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d < dist) {
            dist = d;
            best = [p, q];
          }
        }
      }
      if (!best) continue;
      // From the blocker to the blocked; both ways gets an arrow at each end.
      const [from, to] = between.aBlocksB ? best : [best[1], best[0]];
      const x1 = from.x + from.w;
      const y1 = from.y + from.h / 2;
      const x2 = to.x + to.w;
      const y2 = to.y + to.h / 2;
      const bulge = 36 + Math.min(240, Math.abs(y2 - y1) * 0.2 + Math.abs(x2 - x1) * 0.1);
      const cxp = Math.max(x1, x2) + bulge;
      out.push({
        key: `${a} ${b}`,
        d: `M${x1},${y1} C${cxp},${y1} ${cxp},${y2} ${x2},${y2}`,
        both: between.aBlocksB && between.bBlocksA,
        a,
        b,
      });
    }
    return out;
  }, [shownItems, blockIndex, layers.blocks, pins, focusDid]);

  /* ---------------- the toolbar and the details ---------------- */

  const people = useMemo((): PersonRow[] => {
    const rows = new Map<string, PersonRow>();
    const row = (did: string, p: { handle?: string; displayName?: string; avatar?: string }) => {
      let r = rows.get(did);
      if (!r) {
        const f = insights?.authors.get(did);
        const handle = p.handle ?? f?.handle;
        r = {
          did,
          name: p.displayName || f?.displayName || (handle ? `@${handle}` : did),
          handle,
          avatar: p.avatar ?? f?.avatar,
          posts: 0,
          blocks: blockedWith(blockIndex, did).size,
          cut: 0,
          op: did === op,
        };
        rows.set(did, r);
      }
      return r;
    };
    for (const p of allPosts) row(p.did, p).posts += 1;
    for (const c of cuts) row(c.did, c.author ?? {}).cut += 1;
    return [...rows.values()].sort((a, b) => Number(b.op) - Number(a.op) || b.posts + b.cut - (a.posts + a.cut) || a.name.localeCompare(b.name));
  }, [allPosts, cuts, insights?.authors, blockIndex, op]);

  const links = useMemo(() => blockLinks(blockIndex), [blockIndex]);
  const foldedCount = insights?.folded.size ?? 0;
  const summary = !thread ? null : (
    <>
      {(!insights || insights.stage !== 'done') && (
        <span className="fx-graph-status" role="status">
          {!insights || insights.stage === 'reading'
            ? 'Looking for left-out replies…'
            : `Reading blocks… ${Math.round(insights.blocksDone * 100)}%`}
        </span>
      )}
      {insights && (
        <>
          <span
            className="fx-tx-stat"
            data-tone="block"
            title={
              insights.stage === 'done'
                ? `Blocks between people who posted here, read for ${fmt(insights.blocksRead.size)} of ${fmt(insights.participants)} accounts. Blocks made through moderation lists can’t be seen.`
                : undefined
            }
          >
            <Ban size={13} aria-hidden />
            {plural(links.length, 'block', 'blocks')}
          </span>
          <button
            type="button"
            className="fx-tx-stat"
            data-tone="cut"
            onClick={nextCut}
            disabled={!cuts.length}
            title={cuts.length ? 'Go to the next reply Bluesky leaves out' : 'No replies found missing from the thread'}
          >
            {fmt(cuts.length)} left out
          </button>
          <span className="fx-tx-stat" title="Replies Bluesky’s app keeps behind “show more”, hidden by the thread’s author or folded by Bluesky">
            {fmt(foldedCount)} folded
          </span>
        </>
      )}
    </>
  );

  const insightPane = (did: string, profileLinks: boolean) => {
    const e = blockIndex.get(did);
    const rows: BlockRow[] = [...blockedWith(blockIndex, did)].map((o) => ({
      did: o,
      name: atNameOf(o),
      theyBlock: e?.blocks.has(o) ?? false,
      blockedBy: e?.blockedBy.has(o) ?? false,
    }));
    const foldedBy = { author: 0, bluesky: 0 };
    for (const [u, why] of insights?.folded ?? []) if (didOfPost.get(u) === did) foldedBy[why] += 1;
    return (
      <AccountInsight
        did={did}
        facts={insights?.authors.get(did)}
        name={atNameOf(did)}
        isOp={did === op}
        postsHere={postsBy.get(did) ?? 0}
        blocks={rows}
        blocksState={!blocksDone ? 'reading' : insights?.blocksRead.has(did) ? 'done' : 'unread'}
        folded={foldedBy}
        cut={cuts.filter((c) => c.did === did).length}
        pinSlot={pins.indexOf(did)}
        canPin={pins.length < PIN_SLOTS}
        onPin={() => togglePin(did)}
        onGo={goToPerson}
        profileLinks={profileLinks}
      />
    );
  };

  const focusCut = focus?.kind === 'post' ? cutByUri.get(focus.post.uri) : undefined;

  return (
    <div
      ref={dialogRef}
      className="fx-tx"
      data-pick
      data-sheet={sheet || undefined}
      data-leaving={leaving || undefined}
      inert={leaving}
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onLeft();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="fx-tx-title"
      tabIndex={-1}
    >
      <div className="fx-tx-head">
        <div className="fx-tx-title">
          <h2 id="fx-tx-title">Thread</h2>
          {thread && (
            <span className="fx-graph-status">
              {plural(thread.posts, 'post', 'posts')}, started by {opName}
            </span>
          )}
        </div>
        {thread && (
          <div className="fx-tx-keys">
            <Legend keys={['mutual', 'following', 'follower', 'further']} subject={opName} op />
            <MarksKey />
          </div>
        )}
        <div className="fx-tx-tools">
          <button type="button" className="fx-graph-tool" onClick={() => zoomTo(zoom / 1.25)} aria-label="Zoom out">
            <Minus size={14} aria-hidden />
          </button>
          <button type="button" className="fx-graph-tool" onClick={() => zoomTo(zoom * 1.25)} aria-label="Zoom in">
            <Plus size={14} aria-hidden />
          </button>
          {motion.moved && (
            <button type="button" className="fx-graph-tool" onClick={motion.tidy} title="Put the cards you moved back in place">
              <RotateCcw size={14} aria-hidden />
              Tidy
            </button>
          )}
          <button type="button" className="fx-graph-tool" onClick={fit}>
            <Scan size={14} aria-hidden />
            Fit
          </button>
          <button type="button" className="fx-graph-tool fx-tx-close" onClick={onClose}>
            <X size={14} aria-hidden />
            Close
          </button>
        </div>
      </div>
      {thread && (
        <ThreadToolbar
          id={SHEET_ID}
          searchRef={searchRef}
          query={query}
          onQuery={onQuery}
          matches={matches.length}
          matchAt={matchAt}
          onStep={step}
          people={people}
          pins={pins}
          onTogglePin={togglePin}
          onJumpPin={jumpTo}
          order={order}
          onOrder={setOrder}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          layers={layers}
          onLayer={(key, on) => setLayers((l) => ({ ...l, [key]: on }))}
          summary={summary}
        />
      )}
      <div className="fx-tx-body" data-open={focus ? '' : undefined}>
        <div
          ref={boxRef}
          className="fx-tx-canvas"
          data-dragging={dragging || undefined}
          data-moving={motion.rootProps['data-moving']}
          data-spot={spot || undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          {...drawingProps}
        >
          {failed ? (
            <p className="explore-error fx-tx-msg">Couldn’t read this thread from the Bluesky AppView.</p>
          ) : !layout ? (
            <p className="explore-placeholder fx-tx-msg" role="status">
              Reading the thread…
            </p>
          ) : (
            <svg
              width={width * zoom}
              height={height * zoom}
              viewBox={`${-PAD_X} ${-PAD} ${width} ${height}`}
              className="fx-graph-svg"
              role="group"
              aria-label="The thread, its quotes, likes, reposts and links"
            >
              <GraphDefs />
              <defs>
                <marker
                  id="fx-tx-arrow"
                  viewBox="0 0 10 10"
                  refX={9}
                  refY={5}
                  markerWidth={7}
                  markerHeight={7}
                  orient="auto-start-reverse"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M0,1 L10,5 L0,9 z" className="fx-tx-arrowhead" />
                </marker>
              </defs>
              <g {...motion.rootProps}>
                {motion.items.map((it) => {
                  const edge = motion.edgeProps(it);
                  if (!edge) return null;
                  const child = it.data;
                  const from = it.parent ? motion.place(it.parent) : undefined;
                  const parent = from?.data ?? (it.parent ? byKey.get(it.parent) : undefined);
                  const childDid = didOfNode(child);
                  const childUri = uriOfNode(child);
                  const across: Between | null =
                    parent?.kind === 'post' && childDid && child.kind !== 'account'
                      ? blockBetween(blockIndex, parent.post.did, childDid)
                      : null;
                  const slot = parent?.kind === 'post' && childUri ? traceSlot(childUri) : -1;
                  return (
                    <g
                      key={`e-${it.key}`}
                      className="fx-tx-edge-wrap"
                      data-dim={spot && slot < 0 && !lit(childUri, childDid) ? '' : undefined}
                    >
                      <path
                        {...edge}
                        className="fx-graph-edge fx-tx-edge"
                        data-cut={child.kind === 'ghost' || undefined}
                        data-block={across ? '' : undefined}
                        data-pin={slot >= 0 || undefined}
                        style={slot >= 0 ? { stroke: pinColor(slot) } : undefined}
                      >
                        {across && parent?.kind === 'post' && childDid && (
                          <title>{blockWords(across, atNameOf(parent.post.did), atNameOf(childDid))}</title>
                        )}
                      </path>
                      {/* At the curve's middle, where the cards are now; it
                          catches up when a card glides or is dragged. */}
                      {across && from && !it.leaving && (
                        <BlockGlyph x={(from.x + from.w + it.x) / 2} y={(from.y + from.h / 2 + it.y + it.h / 2) / 2} />
                      )}
                    </g>
                  );
                })}
                <g className="fx-tx-arcs" aria-hidden>
                  {arcs.map((arc) => (
                    <path
                      key={arc.key}
                      d={arc.d}
                      className="fx-tx-arc"
                      data-dim={
                        spot && !(pins.includes(arc.a) || pins.includes(arc.b) || arc.a === focusDid || arc.b === focusDid)
                          ? ''
                          : undefined
                      }
                      markerEnd="url(#fx-tx-arrow)"
                      markerStart={arc.both ? 'url(#fx-tx-arrow)' : undefined}
                    />
                  ))}
                </g>
                {motion.items.map((it) => (
                  <g key={it.key} {...motion.nodeProps(it)}>
                    {drawNode(it.data, 0, 0)}
                  </g>
                ))}
              </g>
            </svg>
          )}
        </div>
        {thread && focus && (
          <div className="fx-tx-side">
            {focusCut ? (
              <CutDetail
                cut={focusCut}
                reading={readingOf(focusCut)}
                name={atNameOf(focusCut.did)}
                parentName={atNameOf(didOfPost.get(focusCut.parent))}
                onClose={closePane}
              />
            ) : (
              <GraphDetail focus={focus} subjectName={opName} relationFor={relationFor} onClose={closePane} />
            )}
            {focusDid && insightPane(focusDid, focus.kind !== 'person')}
          </div>
        )}
      </div>
      {/* On a phone the header's controls move down here, under the thumb,
          and the search and filters open from it as a sheet (graph.css).
          Inside the dialog, so a screen reader can reach it. */}
      <PageToolbar
        label="Thread"
        start={[
          {
            id: 'tools',
            label: 'Search and filters',
            wide: true,
            icon: searching ? <Search size={17} aria-hidden /> : <SlidersHorizontal size={17} aria-hidden />,
            text: searching ? query : undefined,
            status: searching ? (matches.length ? `${matchAt < 0 ? '–' : fmt(matchAt + 1)}/${fmt(matches.length)}` : '0') : undefined,
            badge: pins.length,
            expanded: sheet,
            controls: SHEET_ID,
            disabled: !thread,
            onClick: () => setSheet((v) => !v),
          },
        ]}
        end={[
          ...(motion.moved
            ? [{ id: 'tidy', label: 'Put the cards you moved back in place', icon: <RotateCcw size={17} aria-hidden />, onClick: motion.tidy }]
            : []),
          { id: 'out', group: 'Zoom', label: 'Zoom out', icon: <Minus size={18} aria-hidden />, onClick: () => zoomTo(zoom / 1.25) },
          { id: 'in', group: 'Zoom', label: 'Zoom in', icon: <Plus size={18} aria-hidden />, onClick: () => zoomTo(zoom * 1.25) },
          { id: 'fit', label: 'Fit the thread to the screen', icon: <Scan size={17} aria-hidden />, onClick: fit },
          { id: 'close', label: 'Close', icon: <X size={19} aria-hidden />, onClick: onClose },
        ]}
      />
    </div>
  );
}

/** What the drawing's own marks mean, beside the relation colours. */
function MarksKey() {
  return (
    <ul className="fx-graph-legend fx-tx-marks" aria-label="Marks">
      <li>
        <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden>
          <path d="M1,6 H25" className="fx-tx-key-block" />
          <BlockGlyph x={13} y={6} r={5} />
        </svg>
        Block
      </li>
      <li>
        <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden>
          <rect x={1} y={1} width={20} height={12} rx={3} className="fx-tx-key-cut" />
        </svg>
        Left out on Bluesky
      </li>
    </ul>
  );
}
