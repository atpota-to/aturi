'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  defaultFolds,
  engagementOf,
  flattenThread,
  flowLayout,
  relationOf,
  stackAround,
  type GraphPerson,
  type Relation,
  type ThreadPost,
} from '@/lib/socialGraph';
import {
  accountCounts,
  followedByFollows,
  graphPage,
  type GraphAccount,
  type Neighbourhood,
} from '@/utils/atproto/graphData';
import { useTreeMotion, type MotionNode } from './motion';
import { Face, GraphDefs, atName, fmt, markProps, nameOf, relationColor, truncate, wrapLines, type FocusProps } from './shared';

/* ------------------------------------------------------------------ */
/* Shared drawing                                                       */
/* ------------------------------------------------------------------ */

function Connector({ x1, y1, x2, y2, hot }: { x1: number; y1: number; x2: number; y2: number; hot?: boolean }) {
  const mx = (x1 + x2) / 2;
  return (
    <path
      d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
      className="fx-graph-edge"
      data-hot={hot || undefined}
    />
  );
}

/**
 * The flow's scroll box. The chart is drawn at 1:1 so its words stay
 * readable, and scrolls natively in both directions; when it grows a column,
 * the box brings the new column into view. Once a card has been dragged out
 * of place, a Tidy button in the corner puts them all back.
 */
function FlowBox({
  label,
  width,
  height,
  reveal,
  onTidy,
  children,
}: {
  label: string;
  width: number;
  height: number;
  onTidy?: () => void;
  /**
   * A card (in drawing coordinates) to bring into view when `key` changes:
   * scrolled sideways only as far as it takes to show it with a little of
   * what's beside it, and centred up and down.
   */
  reveal: { x: number; y: number; w: number; h: number; key: string } | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box || !reveal) return;
    const margin = 48;
    let left = box.scrollLeft;
    if (reveal.x - margin < left) left = reveal.x - margin;
    else if (reveal.x + reveal.w + margin > left + box.clientWidth) left = reveal.x + reveal.w + margin - box.clientWidth;
    const top = reveal.y + reveal.h / 2 - box.clientHeight / 2;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
    // Only the key decides when to scroll; the card moves with layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.key]);
  return (
    <div className="fx-graph-flow-frame">
      <div ref={ref} className="fx-graph-scroll fx-graph-flow" role="group" aria-label={label}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="fx-graph-svg">
          <GraphDefs />
          {children}
        </svg>
      </div>
      {onTidy && (
        <button type="button" className="fx-graph-tool fx-graph-tidy" onClick={onTidy} title="Put the cards you moved back in place">
          <RotateCcw size={14} aria-hidden />
          Tidy
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* An account, grown by clicking                                        */
/* ------------------------------------------------------------------ */

type GroupSource =
  | { kind: 'local'; accounts: GraphAccount[] }
  | { kind: 'follows' | 'followers'; did: string }
  | { kind: 'inCommon'; did: string };

type FlowGroup = { key: string; label: string; count: number | null; source: GroupSource; note?: string };

type Loaded = { accounts: GraphAccount[]; cursor?: string; loading: boolean; failed: boolean };

const PAGE = 8;
const PERSON_W = 250;
const GROUP_W = 220;
const COL_GAP = 70;
const ROW = 62;
const CARD_H = 50;
const SUBJECT_W = 200;
const PAD = 24;

/**
 * The account as a flow chart you grow. The account opens into its
 * relationships (from the graph already read), a relationship into its
 * people, and a person into their own follows and followers, read live a
 * page at a time, and on as far as anyone cares to go. One branch is open
 * per column, so the chart is always a path with its choices beside it.
 */
export function FlowAccount({ data, focus, onFocus, onSelect }: { data: Neighbourhood } & FocusProps) {
  const subject = data.subject;
  const people = useMemo(() => new Map(data.people.map((p) => [p.did, p])), [data.people]);
  // [groupKey, personDid, groupKey, personDid, …]
  const [path, setPath] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(() => new Map());
  const [shown, setShown] = useState<Map<string, number>>(() => new Map());
  const [counts, setCounts] = useState<Map<string, { follows?: number; followers?: number }>>(() => new Map());

  const subjectGroups = useMemo<FlowGroup[]>(() => {
    const by = (list: GraphPerson[], key: (p: GraphPerson) => number) => [...list].sort((a, b) => key(b) - key(a));
    const mutuals = by(data.people.filter((p) => relationOf(p) === 'mutual'), engagementOf);
    const follows = by(data.people.filter((p) => p.following), engagementOf);
    const engagedIn = by(data.people.filter((p) => p.in > 0), (p) => p.in);
    const engagedOut = by(data.people.filter((p) => p.out > 0), (p) => p.out);
    const s = data.subject.did;
    return [
      { key: `${s}|mutuals`, label: 'Mutuals', count: mutuals.length, source: { kind: 'local', accounts: mutuals } },
      { key: `${s}|follows`, label: 'Follows', count: follows.length, source: { kind: 'local', accounts: follows }, note: 'Most engaged first.' },
      { key: `${s}|followers`, label: 'Followers', count: data.subject.followersCount ?? null, source: { kind: 'followers', did: s }, note: 'Newest first, read live.' },
      { key: `${s}|in`, label: 'Engaged with them', count: engagedIn.length, source: { kind: 'local', accounts: engagedIn }, note: 'In the last 30 days.' },
      { key: `${s}|out`, label: 'They engaged with', count: engagedOut.length, source: { kind: 'local', accounts: engagedOut }, note: 'In the last 30 days.' },
    ];
  }, [data.people, data.subject]);

  const personGroups = useCallback(
    (did: string): FlowGroup[] => {
      const c = counts.get(did);
      const known = people.get(did);
      const out: FlowGroup[] = [
        { key: `${did}|follows`, label: 'Follows', count: c?.follows ?? null, source: { kind: 'follows', did }, note: 'Newest first, read live.' },
        { key: `${did}|followers`, label: 'Followers', count: c?.followers ?? null, source: { kind: 'followers', did }, note: 'Newest first, read live.' },
      ];
      if (data.follows.length && did !== subject.did) {
        out.push({
          key: `${did}|common`,
          label: `Followers ${atName(subject)} follows`,
          count: known?.inCommon ?? null,
          source: { kind: 'inCommon', did },
          note: `Accounts ${atName(subject)} follows that follow them, read live.`,
        });
      }
      return out;
    },
    [counts, people, data.follows.length, subject],
  );

  const groupByKey = useCallback(
    (key: string): FlowGroup | undefined => {
      const did = key.slice(0, key.indexOf('|'));
      return (did === subject.did ? subjectGroups : personGroups(did)).find((g) => g.key === key);
    },
    [subject.did, subjectGroups, personGroups],
  );

  // Read what an open group needs, a page at a time. The ref holds what has
  // been asked for, so two renders in a row never ask twice.
  const asked = useRef<Map<string, Loaded>>(new Map());
  const fetchPage = useCallback(
    async (g: FlowGroup, more = false) => {
      if (g.source.kind === 'local') return;
      const prev = asked.current.get(g.key);
      if (prev?.loading || (prev && !more) || (prev && more && !prev.cursor)) return;
      const pending = { accounts: prev?.accounts ?? [], cursor: prev?.cursor, loading: true, failed: false };
      asked.current.set(g.key, pending);
      setLoaded((m) => new Map(m).set(g.key, pending));
      let next: Loaded;
      if (g.source.kind === 'inCommon') {
        const list = await followedByFollows(g.source.did, data.follows);
        next = { accounts: list ?? [], loading: false, failed: !list };
      } else {
        const page = await graphPage(g.source.did, g.source.kind, prev?.cursor);
        next = page
          ? { accounts: [...(prev?.accounts ?? []), ...page.accounts], cursor: page.cursor, loading: false, failed: false }
          : { accounts: prev?.accounts ?? [], cursor: prev?.cursor, loading: false, failed: true };
      }
      asked.current.set(g.key, next);
      setLoaded((m) => new Map(m).set(g.key, next));
    },
    [data.follows],
  );

  const accountsOf = (g: FlowGroup): { list: GraphAccount[]; loading: boolean; failed: boolean; more: boolean } => {
    const n = shown.get(g.key) ?? PAGE;
    if (g.source.kind === 'local') return { list: g.source.accounts.slice(0, n), loading: false, failed: false, more: g.source.accounts.length > n };
    const l = loaded.get(g.key);
    const all = l?.accounts ?? [];
    return { list: all.slice(0, n), loading: !l || l.loading, failed: !!l?.failed, more: all.length > n || !!l?.cursor };
  };

  // When a person opens, read their follow and follower counts once.
  const openPerson = async (did: string) => {
    if (counts.has(did)) return;
    setCounts((m) => new Map(m).set(did, {}));
    const p = await accountCounts(did);
    if (p) setCounts((m) => new Map(m).set(did, { follows: p.followsCount, followers: p.followersCount }));
  };

  useEffect(() => {
    for (let i = 0; i < path.length; i += 2) {
      const g = groupByKey(path[i]);
      if (g) void fetchPage(g);
    }
  }, [path, groupByKey, fetchPage]);

  const choose = (level: number, key: string) => {
    setPath((p) => (p[level] === key ? p.slice(0, level) : [...p.slice(0, level), key]));
  };

  const onMore = (key: string) => {
    const g = groupByKey(key);
    if (g) showMore(g);
  };

  const showMore = (g: FlowGroup) => {
    const n = (shown.get(g.key) ?? PAGE) + PAGE;
    setShown((m) => new Map(m).set(g.key, n));
    const l = loaded.get(g.key);
    if (g.source.kind !== 'local' && l && l.accounts.length < n && l.cursor) void fetchPage(g, true);
  };

  // Lay the columns out: each one stacked around the open card before it.
  // Every card names the card it hangs off, which is where it grows from.
  type Item =
    | { type: 'group'; key: string; parent: string; g: FlowGroup; level: number; x: number; y: number; open: boolean }
    | { type: 'person'; key: string; parent: string; a: GraphAccount; level: number; x: number; y: number; open: boolean; count: number | null }
    | { type: 'note'; key: string; parent: string; text: string; level: number; x: number; y: number; moreFor?: string };
  const items: Item[] = [];
  let x = SUBJECT_W + COL_GAP;
  let anchor = { key: 'subject', y: CARD_H / 2 };
  let columns: { owner: string; groups: FlowGroup[] } | null = { owner: subject.did, groups: subjectGroups };
  let level = 0;
  while (columns) {
    // A column of relationships.
    const ys = stackAround(anchor.y, columns.groups.length, ROW, CARD_H);
    let openGroup: { g: FlowGroup; y: number } | null = null;
    columns.groups.forEach((g, i) => {
      const open = path[level] === g.key;
      items.push({ type: 'group', key: g.key, parent: anchor.key, g, level, x, y: ys[i], open });
      if (open) openGroup = { g, y: ys[i] };
    });
    if (!openGroup) break;
    const og = openGroup as { g: FlowGroup; y: number };
    // A column of people.
    x += GROUP_W + COL_GAP;
    const { list, loading, failed, more } = accountsOf(og.g);
    const rows = list.length + (loading || failed || more || !list.length ? 1 : 0);
    const py = stackAround(og.y + CARD_H / 2, Math.max(1, rows), ROW, CARD_H);
    let openPersonAt: { did: string; y: number } | null = null;
    list.forEach((a, i) => {
      const open = path[level + 1] === a.did;
      const known = people.get(a.did);
      const count =
        og.g.key.endsWith('|in') && known ? known.in : og.g.key.endsWith('|out') && known ? known.out : known ? engagementOf(known) || null : null;
      items.push({ type: 'person', key: `${level + 1}-${a.did}`, parent: og.g.key, a: known ?? a, level: level + 1, x, y: py[i], open, count });
      if (open) openPersonAt = { did: a.did, y: py[i] };
    });
    const tailY = py[list.length] ?? py[py.length - 1];
    const note = (key: string, text: string, moreFor?: string) =>
      items.push({ type: 'note', key: `${og.g.key}-${key}`, parent: og.g.key, text, level: level + 1, x, y: tailY, moreFor });
    if (loading) note('loading', 'Reading…');
    else if (failed) note('failed', 'Couldn’t read this list');
    else if (!list.length) note('empty', 'Nobody here');
    else if (more) note('more', 'Show more', og.g.key);
    if (!openPersonAt) break;
    const op = openPersonAt as { did: string; y: number };
    anchor = { key: `${level + 1}-${op.did}`, y: op.y + CARD_H / 2 };
    x += PERSON_W + COL_GAP;
    level += 2;
    columns = { owner: op.did, groups: personGroups(op.did) };
  }

  const minY = Math.min(0, ...items.map((i) => i.y));
  const shift = PAD - minY;
  const subjectY = shift;

  type Card = { type: 'subject' } | Item;
  const motion = useTreeMotion<Card>([
    { key: 'subject', x: 0, y: subjectY, w: SUBJECT_W, h: CARD_H, parent: null, data: { type: 'subject' } },
    ...items.map((it) => ({
      key: it.key,
      x: it.x,
      y: it.y + shift,
      w: it.type === 'group' ? GROUP_W : PERSON_W,
      h: CARD_H,
      parent: it.parent,
      edge: it.type !== 'note',
      data: it,
    })),
  ]);

  const maxY = Math.max(Math.max(CARD_H, ...items.map((i) => i.y + CARD_H)) + shift, motion.bounds.bottom) + PAD;
  const width =
    Math.max(...items.map((i) => i.x + (i.type === 'group' ? GROUP_W : PERSON_W)), SUBJECT_W, motion.bounds.right) + PAD * 2;
  const last = items[items.length - 1];
  const lastAt = last ? motion.place(last.key) : undefined;
  const focusedDid = focus?.kind === 'person' ? focus.person.did : null;

  const colorOf = (did: string): string | undefined => {
    const p = people.get(did);
    return p ? relationColor(relationOf(p)) : undefined;
  };

  const drawCard = (it: Card) => {
    if (it.type === 'subject') {
      return (
        <g className="fx-graph-mark" role="img" aria-label={nameOf(subject)} {...markProps(() => onFocus(null), onSelect && (() => onSelect(null)))}>
          <rect x={0} y={0} width={SUBJECT_W} height={CARD_H} rx={10} className="fx-graph-card" data-strong />
          <Face x={26} y={CARD_H / 2} r={16} avatar={subject.avatar} name={nameOf(subject)} ring="var(--text-primary)" />
          <text x={52} y={22} className="fx-graph-t-name">
            {truncate(nameOf(subject), 17)}
          </text>
          <text x={52} y={39} className="fx-graph-t-sub">
            {truncate(atName(subject), 20)}
          </text>
        </g>
      );
    }
    if (it.type === 'group') {
      const { g } = it;
      return (
        <g
          className="fx-graph-mark"
          role="button"
          aria-expanded={it.open}
          aria-label={`${g.label}${g.count != null ? `, ${fmt(g.count)}` : ''}`}
          {...markProps(
            () => onFocus({ kind: 'group', label: g.label, count: g.count, note: g.note }),
            () => choose(it.level, g.key),
          )}
        >
          <rect x={0} y={0} width={GROUP_W} height={CARD_H} rx={10} className="fx-graph-card" data-group data-open={it.open || undefined} />
          <text x={14} y={22} className="fx-graph-t-name">
            {truncate(g.label, 26)}
          </text>
          <text x={14} y={39} className="fx-graph-t-sub">
            {g.count != null ? `${fmt(g.count)} ${g.count === 1 ? 'account' : 'accounts'}` : 'open to read'}
          </text>
        </g>
      );
    }
    if (it.type === 'person') {
      const { a } = it;
      return (
        <g
          className="fx-graph-mark"
          role="button"
          aria-expanded={it.open}
          aria-label={nameOf(a)}
          data-focus={focusedDid === a.did || undefined}
          {...markProps(
            () => onFocus({ kind: 'person', person: a }),
            () => {
              onSelect?.({ kind: 'person', person: a });
              choose(it.level, a.did);
              void openPerson(a.did);
            },
          )}
        >
          <rect x={0} y={0} width={PERSON_W} height={CARD_H} rx={10} className="fx-graph-card" data-open={it.open || undefined} />
          <Face x={28} y={CARD_H / 2} r={15} avatar={a.avatar} name={nameOf(a)} ring={colorOf(a.did)} />
          <text x={54} y={22} className="fx-graph-t-name">
            {truncate(nameOf(a), it.count != null ? 20 : 24)}
          </text>
          <text x={54} y={39} className="fx-graph-t-sub">
            {truncate(a.handle ? `@${a.handle}` : a.did, 26)}
          </text>
          {it.count != null && (
            <text x={PERSON_W - 12} y={22} textAnchor="end" className="fx-graph-t-num">
              {fmt(it.count)}
            </text>
          )}
        </g>
      );
    }
    const moreFor = it.moreFor;
    return (
      <g
        className={moreFor ? 'fx-graph-mark' : undefined}
        role={moreFor ? 'button' : undefined}
        tabIndex={moreFor ? 0 : undefined}
        onClick={moreFor ? () => onMore(moreFor) : undefined}
        onKeyDown={
          moreFor
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onMore(moreFor);
                }
              }
            : undefined
        }
      >
        <rect x={0} y={6} width={PERSON_W} height={CARD_H - 12} rx={9} className="fx-graph-stub" />
        <text x={14} y={30} className="fx-graph-t-body">
          {it.text}
        </text>
      </g>
    );
  };

  return (
    <>
      <FlowBox
        label="Flow chart of this account’s relationships"
        width={width}
        height={Math.max(maxY, 320)}
        reveal={
          // Nothing opened yet: start at the account, on the left.
          last && lastAt && path.length
            ? { x: lastAt.x + PAD, y: lastAt.y, w: lastAt.w, h: CARD_H, key: path.join('>') }
            : null
        }
        onTidy={motion.moved ? motion.tidy : undefined}
      >
        <g transform={`translate(${PAD} 0)`}>
          <g {...motion.rootProps}>
            {motion.items.map((it) => {
              const edge = motion.edgeProps(it);
              const hot = it.data.type !== 'subject' && it.data.type !== 'note' && it.data.open;
              return edge ? <path key={`e-${it.key}`} {...edge} className="fx-graph-edge" data-hot={hot || undefined} /> : null;
            })}
            {motion.items.map((it) => (
              <g key={it.key} {...motion.nodeProps(it)}>
                {drawCard(it.data)}
              </g>
            ))}
          </g>
        </g>
      </FlowBox>
      <p className="fx-graph-caption">
        Open a relationship to see who’s in it, and a person to open theirs. Their follows and followers are read live,
        so this goes as far as you like. Drag a card with a mouse to move it out of the way.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* A thread                                                             */
/* ------------------------------------------------------------------ */

const T_COL = 330;
const T_W = 260;
const T_ROW = 88;
const T_H = 74;

/**
 * The thread left to right, one column per reply depth. Replies come
 * most-discussed first, six at a time; past the second level a big thread
 * starts folded, except along the way to the post the page is about.
 *
 * Where a click opens a post's details (`onSelect`), folding moves off the
 * card to a button on its edge, so reading the first post doesn't fold the
 * whole thread away. A click on a folded post still opens its replies, as
 * its "+n" does.
 */
export function FlowThread({
  root,
  current,
  relationOfAuthor,
  focus,
  onFocus,
  onSelect,
}: {
  root: ThreadPost;
  current: string;
  relationOfAuthor: (did: string) => Relation | 'op';
} & FocusProps) {
  const ancestors = useMemo(() => {
    const byUri = new Map(flattenThread(root).map((p) => [p.uri, p]));
    const out = new Set<string>();
    for (let p = byUri.get(current); p?.parent; p = byUri.get(p.parent)) out.add(p.parent);
    return out;
  }, [root, current]);
  const [folded, setFolded] = useState<Set<string>>(() => {
    const f = defaultFolds(root);
    for (const a of ancestors) f.delete(a);
    return f;
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(ancestors));
  const layout = useMemo(
    () => flowLayout(root, { folded, expanded, colWidth: T_COL, rowHeight: T_ROW }),
    [root, folded, expanded],
  );
  const pos = useMemo(() => new Map(layout.cards.map((c) => [c.post.uri, c])), [layout]);
  const [lastToggled, setLastToggled] = useState<string | null>(null);
  const focused = focus?.kind === 'post' ? focus.post.uri : null;

  const toggle = (p: ThreadPost) => {
    if (!p.kids.length) return;
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(p.uri)) next.delete(p.uri);
      else next.add(p.uri);
      return next;
    });
    setLastToggled(p.uri);
  };

  type Card = { type: 'card'; post: ThreadPost; hidden: number } | { type: 'stub'; parent: ThreadPost; hidden: number };
  const motionNodes = useMemo<MotionNode<Card>[]>(
    () => [
      ...layout.cards.map((c) => ({
        key: c.post.uri,
        x: c.x,
        y: c.y,
        w: T_W,
        h: T_H,
        parent: c.post.parent && pos.has(c.post.parent) ? c.post.parent : null,
        data: { type: 'card' as const, post: c.post, hidden: c.folded },
      })),
      ...layout.stubs.map((s) => ({
        key: `more-${s.parent.uri}`,
        x: s.x,
        y: s.y,
        w: T_W,
        h: T_H,
        parent: s.parent.uri,
        data: { type: 'stub' as const, parent: s.parent, hidden: s.hidden },
      })),
    ],
    [layout, pos],
  );
  const motion = useTreeMotion(motionNodes);

  const width = Math.max((layout.maxDepth + 1) * T_COL, motion.bounds.right) + 120;
  const height = Math.max(layout.rows * T_ROW, T_ROW, motion.bounds.bottom) + PAD;
  const revealAt = motion.place(lastToggled ?? current) ?? motion.place(root.uri);

  const drawCard = (it: Card) => {
    if (it.type === 'stub') {
      const { parent, hidden } = it;
      return (
        <g
          className="fx-graph-mark"
          role="button"
          aria-label={`Show ${hidden} more replies`}
          {...markProps(
            () => onFocus({ kind: 'post', post: parent }),
            () => {
              setExpanded((e) => new Set(e).add(parent.uri));
              setLastToggled(parent.uri);
            },
          )}
        >
          <rect x={0} y={18} width={T_W} height={T_H - 36} rx={9} className="fx-graph-stub" />
          <text x={14} y={T_H / 2 + 5} className="fx-graph-t-body">
            {fmt(hidden)} more {hidden === 1 ? 'reply' : 'replies'}
          </text>
        </g>
      );
    }
    const { post, hidden } = it;
    const rel = post === root ? 'op' : relationOfAuthor(post.did);
    const lines = wrapLines(post.text || (post.hasMedia ? 'An image or video' : ''), 36, 2);
    return (
      <>
        <g
          className="fx-graph-mark"
          role="button"
          aria-expanded={!onSelect && post.kids.length ? !folded.has(post.uri) : undefined}
          aria-label={`${post.displayName || post.handle}: ${truncate(post.text, 80) || 'no text'}`}
          data-focus={focused === post.uri || undefined}
          {...markProps(
            () => onFocus({ kind: 'post', post }),
            onSelect
              ? () => {
                  onSelect({ kind: 'post', post });
                  // A click also opens folded replies, but never folds them;
                  // that's the edge button's job.
                  if (post.kids.length && folded.has(post.uri)) toggle(post);
                }
              : () => toggle(post),
          )}
        >
          <rect x={0} y={0} width={T_W} height={T_H} rx={10} className="fx-graph-card" data-current={post.uri === current || undefined} />
          <Face x={26} y={22} r={11} avatar={post.avatar} name={post.handle || post.did} ring={relationColor(rel)} />
          <text x={44} y={27} className="fx-graph-t-name">
            {truncate(post.displayName || post.handle || '', 22)}
          </text>
          {post.likes > 0 && (
            <text x={T_W - 12} y={27} textAnchor="end" className="fx-graph-t-sub">
              {fmt(post.likes)} ♥
            </text>
          )}
          {lines.map((line, i) => (
            <text key={i} x={14} y={48 + i * 16} className="fx-graph-t-body">
              {line}
            </text>
          ))}
        </g>
        {onSelect && hidden === 0 && post.kids.length > 0 && !folded.has(post.uri) && (
          <g
            className="fx-graph-mark fx-graph-fold"
            role="button"
            aria-expanded
            aria-label={`Fold the ${post.kids.length === 1 ? 'reply' : 'replies'} under this post`}
            {...markProps(() => onFocus({ kind: 'post', post }), () => toggle(post))}
          >
            <circle cx={T_W} cy={T_H / 2} r={9} />
            <line x1={T_W - 4} y1={T_H / 2} x2={T_W + 4} y2={T_H / 2} />
          </g>
        )}
        {hidden > 0 && (
          <g
            className="fx-graph-mark"
            role="button"
            aria-label={`Show ${hidden} replies`}
            {...markProps(() => onFocus({ kind: 'post', post }), () => toggle(post))}
          >
            <Connector x1={T_W} y1={T_H / 2} x2={T_W + 16} y2={T_H / 2} />
            <rect x={T_W + 16} y={T_H / 2 - 14} width={64} height={28} rx={14} className="fx-graph-stub" />
            <text x={T_W + 48} y={T_H / 2 + 5} textAnchor="middle" className="fx-graph-t-num">
              +{fmt(hidden)}
            </text>
          </g>
        )}
      </>
    );
  };

  return (
    <>
      <FlowBox
        label="Flow chart of the thread"
        width={width}
        height={height}
        reveal={
          revealAt
            ? { x: revealAt.x + PAD, y: revealAt.y + PAD / 2, w: T_W, h: T_H, key: `${lastToggled ?? current}:${folded.size}:${expanded.size}` }
            : null
        }
        onTidy={motion.moved ? motion.tidy : undefined}
      >
        <g transform={`translate(${PAD} ${PAD / 2})`}>
          <g {...motion.rootProps}>
            {motion.items.map((it) => {
              const edge = motion.edgeProps(it);
              const hot = it.data.type === 'card' && (ancestors.has(it.key) || it.key === current);
              return edge ? <path key={`e-${it.key}`} {...edge} className="fx-graph-edge" data-hot={hot || undefined} /> : null;
            })}
            {motion.items.map((it) => (
              <g key={it.key} {...motion.nodeProps(it)}>
                {drawCard(it.data)}
              </g>
            ))}
          </g>
        </g>
      </FlowBox>
      <p className="fx-graph-caption">
        Replies one column deeper, most-discussed first.{' '}
        {onSelect
          ? 'Choose a post to read it whole, and to open its replies if they’re folded; the button on its edge folds them.'
          : 'Choose a post to fold or open what’s under it.'}{' '}
        Drag a card with a mouse to move it out of the way.
      </p>
    </>
  );
}
