'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minus, Plus, Scan, X } from 'lucide-react';
import {
  defaultFolds,
  flattenThread,
  relationOf,
  treeLayout,
  type Relation,
  type ThreadPost,
} from '@/lib/socialGraph';
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
import { Face, GraphDefs, GraphDetail, Legend, fmt, markProps, nameOf, relationColor, truncate, wrapLines, type GraphFocus } from './shared';

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
  return (
    <>
      <button
        type="button"
        className="fn-rec-btn"
        onClick={() => openExplorer(rkey)}
        title="Explore this post’s replies, quotes, likes and links full screen"
      >
        <Maximize2 size={14} aria-hidden /> Explore thread
      </button>
      {open && createPortal(<Explorer uri={uri} onClose={() => closeExplorer(hash)} />, document.body)}
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
  | { kind: 'group'; open: string; label: string }
  | { kind: 'account'; account: GraphAccount }
  | { kind: 'source'; open: string; source: LinkSource; isOpen: boolean }
  | { kind: 'record'; record: LinkRecord; label: string }
  | { kind: 'note'; text: string; action?: () => void };
type XNode = { key: string; w: number; h: number; children: XNode[] } & XKind;

const SIZE = {
  post: [300, 120],
  group: [210, 36],
  account: [240, 46],
  source: [240, 40],
  record: [260, 50],
  note: [200, 34],
} as const;

/** Replies shown under a post before "more replies", most-discussed first. */
const REPLIES_AT_ONCE = 6;
/** Items shown in a group before "Show more". */
const PAGE = 8;
/** No path through quotes of quotes goes deeper than this. */
const MAX_DEPTH = 40;

const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

/**
 * A Bluesky post's whole neighbourhood, full screen: the thread it belongs
 * to as a tree of post cards, and on each card the ways in from elsewhere
 * (quotes, likes, reposts, and records in other apps that link to it), each
 * opening as a branch of its own. Quote posts are posts like any other, so a
 * quote opens onto its own replies, quotes and links, and the tree can wander
 * across threads.
 */
function Explorer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const [thread, setThread] = useState<ThreadGraph | null>(null);
  const [failed, setFailed] = useState(false);
  const [relations, setRelations] = useState<Map<string, FollowRelation>>(() => new Map());
  const [folded, setFolded] = useState<Set<string> | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [lists, setLists] = useState<Map<string, ListState>>(() => new Map());
  const [subtrees, setSubtrees] = useState<Map<string, ThreadPost | 'loading' | 'failed'>>(() => new Map());
  const [shown, setShown] = useState<Map<string, number>>(() => new Map());
  const [focus, setFocus] = useState<GraphFocus | null>(null);
  const [zoom, setZoom] = useState(1);
  const [reveal, setReveal] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // The page underneath stays put while the explorer is up, and Escape closes it.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      root.style.overflow = before;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    const ac = new AbortController();
    loadThread(uri, ac.signal).then((t) => {
      if (ac.signal.aborted) return;
      if (!t) setFailed(true);
      else {
        setThread(t);
        setFocus({ kind: 'post', post: flattenThread(t.root).find((p) => p.uri === t.focus) ?? t.root });
      }
    });
    return () => ac.abort();
  }, [uri]);

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
    const missing = [...dids].filter((d) => d !== op && !relAsked.current.has(d));
    if (!missing.length) return;
    missing.forEach((d) => relAsked.current.add(d));
    void loadThreadRelations(op, missing).then((r) => {
      if (r) setRelations((m) => new Map([...m, ...r]));
    });
  }, [op, thread, lists, subtrees]);

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
      void loadReplies(post.uri).then((tree) => setSubtrees((m) => new Map(m).set(post.uri, tree ?? 'failed')));
    } else {
      setFolded(() => {
        const next = new Set(foldedNow);
        if (next.has(post.uri)) next.delete(post.uri);
        else next.add(post.uri);
        return next;
      });
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
        if (sub === 'loading') children.push(note(`${key}>loading`, 'Reading replies…'));
        else if (sub === 'failed') children.push(note(`${key}>failed`, 'Couldn’t read the replies'));
        else if (source.kids.length && !foldedNow.has(post.uri)) {
          const sorted = [...source.kids].sort(
            (a, b) => b.size - a.size || Date.parse(a.createdAt) - Date.parse(b.createdAt),
          );
          const kids = expandedNow.has(post.uri) ? sorted : sorted.slice(0, REPLIES_AT_ONCE);
          for (const k of kids) children.push(postNode(k, `${key}>${k.uri}`, depth + 1));
          const hidden = sorted.length - kids.length;
          if (hidden > 0) {
            children.push(
              note(`${key}>more`, `${plural(hidden, 'more reply', 'more replies')}`, () => {
                setExpanded((e) => new Set(e).add(post.uri));
                setReveal(`${key}>more`);
              }),
            );
          }
        }
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
  }, [thread, subtrees, foldedNow, expandedNow, open, lists, shown]);

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

  /* ---------------- moving around ---------------- */

  const PAD = 48;
  const placeOf = useCallback(
    (key: string) => layout?.nodes.find((n) => n.key === key) ?? null,
    [layout],
  );

  // Open on the post the explorer was opened from, in the middle.
  const started = useRef(false);
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !layout || !thread || started.current) return;
    started.current = true;
    const key = [...byKey.values()].find((n) => n.kind === 'post' && n.post.uri === thread.focus)?.key ?? thread.root.uri;
    const p = placeOf(key);
    if (p) {
      box.scrollLeft = Math.max(0, (p.x + PAD) * zoom - box.clientWidth / 3);
      box.scrollTop = Math.max(0, (p.y + PAD + p.h / 2) * zoom - box.clientHeight / 2);
    }
  }, [layout, thread, byKey, placeOf, zoom]);

  // After a branch opens, bring it into view, moving no further than needed.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !reveal) return;
    const p = placeOf(reveal);
    if (!p) return;
    const kids = layout!.nodes.filter((n) => n.parent === reveal);
    const right = Math.max(p.x + p.w, ...kids.map((k) => k.x + k.w));
    const top = Math.min(p.y, ...kids.map((k) => k.y));
    const bottom = Math.max(p.y + p.h, ...kids.map((k) => k.y + k.h));
    let left = box.scrollLeft;
    let scrollTop = box.scrollTop;
    const z = zoom;
    if ((right + PAD) * z + 40 > left + box.clientWidth) left = (right + PAD) * z + 40 - box.clientWidth;
    if ((p.x + PAD) * z - 40 < left) left = (p.x + PAD) * z - 40;
    if ((bottom + PAD) * z + 40 > scrollTop + box.clientHeight) scrollTop = (bottom + PAD) * z + 40 - box.clientHeight;
    if ((top + PAD) * z - 40 < scrollTop) scrollTop = (top + PAD) * z - 40;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({ left: Math.max(0, left), top: Math.max(0, scrollTop), behavior: reduce ? 'auto' : 'smooth' });
    setReveal(null);
  }, [reveal, layout, placeOf, zoom]);

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
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
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
    if ((e.target as Element).closest('.fx-graph-mark')) return;
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

  const fit = () => {
    const box = boxRef.current;
    if (!box || !layout) return;
    const z = Math.min(1, box.clientWidth / (layout.width + PAD * 2), box.clientHeight / (layout.height + PAD * 2));
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

  const drawNode = (n: XNode, x: number, y: number) => {
    if (n.kind === 'post') return drawPost(n, n.post, x, y);
    if (n.kind === 'group' || n.kind === 'source') {
      const label = n.kind === 'group' ? n.label : `${n.source.label} · ${fmt(n.source.count)}`;
      const isOpen = n.kind === 'group' || n.isOpen;
      return (
        <g
          key={n.key}
          className="fx-graph-mark fx-graph-slide fx-tx-group"
          role="button"
          aria-expanded={isOpen}
          aria-label={n.kind === 'group' ? `${label}, close` : label}
          data-open={isOpen || undefined}
          {...markProps(
            () => setFocus({ kind: 'group', label, count: n.kind === 'source' ? n.source.count : null }),
            () => toggleOpen(n.open, n.key),
          )}
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
      return (
        <g
          key={n.key}
          className="fx-graph-mark fx-graph-slide"
          role="button"
          aria-label={nameOf(a)}
          data-focus={focusedKey === a.did || undefined}
          {...markProps(() => setFocus({ kind: 'person', person: a }))}
        >
          <rect x={x} y={y} width={n.w} height={n.h} rx={10} className="fx-graph-card" />
          <rect x={x} y={y + 9} width={4} height={n.h - 18} rx={2} fill={relationColor(relationOfDid(a.did))} />
          <Face x={x + 26} y={y + n.h / 2} r={13} avatar={a.avatar} name={nameOf(a)} />
          <text x={x + 47} y={y + 20} className="fx-graph-t-name">
            {truncate(nameOf(a), 24)}
          </text>
          <text x={x + 47} y={y + 36} className="fx-graph-t-sub">
            {truncate(a.handle ? `@${a.handle}` : a.did, 26)}
          </text>
        </g>
      );
    }
    if (n.kind === 'record') {
      const r = n.record;
      const who = r.author ?? { did: r.did };
      return (
        <g
          key={n.key}
          className="fx-graph-mark fx-graph-slide"
          role="button"
          aria-label={`${n.label} by ${nameOf(who)}`}
          data-focus={focusedKey === r.uri || undefined}
          {...markProps(() => setFocus({ kind: 'record', record: r, label: n.label }))}
        >
          <rect x={x} y={y} width={n.w} height={n.h} rx={10} className="fx-graph-card" />
          <rect x={x} y={y + 9} width={4} height={n.h - 18} rx={2} fill={relationColor(relationOfDid(r.did))} />
          <Face x={x + 26} y={y + n.h / 2} r={13} avatar={who.avatar} name={nameOf(who)} />
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
        className={action ? 'fx-graph-mark fx-graph-slide' : 'fx-graph-slide'}
        role={action ? 'button' : undefined}
        tabIndex={action ? 0 : undefined}
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

  const drawPost = (n: XNode, post: ThreadPost, x: number, y: number) => {
    const sub = subtrees.get(post.uri);
    const kids = typeof sub === 'object' ? sub.kids : post.kids;
    const loaded = kids.length > 0;
    const repliesShown = loaded && !foldedNow.has(post.uri);
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
    return (
      <g key={n.key} className="fx-graph-slide">
        <g
          className="fx-graph-mark"
          role="button"
          aria-label={`${post.displayName || post.handle}: ${truncate(post.text, 90) || 'no text'}`}
          data-focus={focusedKey === post.uri || undefined}
          {...markProps(() => setFocus({ kind: 'post', post }))}
        >
          <rect x={x} y={y} width={n.w} height={n.h} rx={10} className="fx-graph-card" data-current={isCurrent || undefined} />
          <rect x={x} y={y + 10} width={4} height={n.h - 20} rx={2} fill={relationColor(relationOfDid(post.did))} />
          <Face x={x + 26} y={y + 22} r={11} avatar={post.avatar} name={post.handle || post.did} />
          <text x={x + 44} y={y + 27} className="fx-graph-t-name">
            {truncate(post.displayName || post.handle || '', 26)}
          </text>
          {lines.map((line, i) => (
            <text key={i} x={x + 14} y={y + 50 + i * 16} className="fx-graph-t-body">
              {line}
            </text>
          ))}
        </g>
        {placedChips.map((c) => (
          <g
            key={c.id}
            className="fx-graph-mark fx-tx-chip"
            role="button"
            aria-pressed={c.active}
            aria-label={`${c.label} on this post`}
            data-active={c.active || undefined}
            {...markProps(() => setFocus({ kind: 'post', post }), c.act)}
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

  const width = layout ? layout.width + PAD * 2 : 0;
  const height = layout ? layout.height + PAD * 2 : 0;

  return (
    <div ref={dialogRef} className="fx-tx" role="dialog" aria-modal="true" aria-labelledby="fx-tx-title" tabIndex={-1}>
      <div className="fx-tx-head">
        <div className="fx-tx-title">
          <h2 id="fx-tx-title">Thread</h2>
          {thread && (
            <span className="fx-graph-status">
              {plural(thread.posts, 'post', 'posts')}, started by {opName}
            </span>
          )}
        </div>
        {thread && <Legend keys={['mutual', 'following', 'follower', 'further']} subject={opName} op />}
        <div className="fx-tx-tools">
          <button type="button" className="fx-graph-tool" onClick={() => zoomTo(zoom / 1.25)} aria-label="Zoom out">
            <Minus size={14} aria-hidden />
          </button>
          <button type="button" className="fx-graph-tool" onClick={() => zoomTo(zoom * 1.25)} aria-label="Zoom in">
            <Plus size={14} aria-hidden />
          </button>
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
      <div className="fx-tx-body">
        <div
          ref={boxRef}
          className="fx-tx-canvas"
          data-dragging={dragging || undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
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
              viewBox={`${-PAD} ${-PAD} ${width} ${height}`}
              className="fx-graph-svg"
              role="group"
              aria-label="The thread, its quotes, likes, reposts and links"
            >
              <GraphDefs />
              {layout.nodes.map((p) => {
                if (!p.parent) return null;
                const a = layout.nodes.find((q) => q.key === p.parent)!;
                const x1 = a.x + a.w;
                const y1 = a.y + a.h / 2;
                const x2 = p.x;
                const y2 = p.y + p.h / 2;
                const mx = (x1 + x2) / 2;
                return (
                  <path
                    key={`e-${p.key}`}
                    d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                    className="fx-graph-edge fx-graph-fade"
                  />
                );
              })}
              {layout.nodes.map((p) => drawNode(byKey.get(p.key)!, p.x, p.y))}
            </svg>
          )}
        </div>
        <div className="fx-tx-side">
          {thread && (
            <GraphDetail
              focus={focus}
              subject={{ did: thread.root.did, handle: thread.root.handle, displayName: thread.root.displayName, avatar: thread.root.avatar }}
              subjectName={opName}
              relationFor={relationFor}
              emptyText="Point at, tap or tab to something to see it here."
            />
          )}
        </div>
      </div>
    </div>
  );
}
