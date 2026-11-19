'use client';

import { useMemo, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import {
  RELATION_ORDER,
  breakdown,
  icicleLayout,
  relationOf,
  type GraphPerson,
  type Relation,
  type ThreadPost,
} from '@/lib/socialGraph';
import type { Neighbourhood } from '@/utils/atproto/graphData';
import {
  Face,
  GraphDefs,
  ZoomBox,
  atName,
  fmt,
  markProps,
  nameOf,
  relationColor,
  relationLabel,
  truncate,
  useWidth,
  type FocusProps,
} from './shared';

/** People per side. Past this the bands are too thin to read or point at. */
const SIDE = 14;

/**
 * Below this width the bands give way to two lists. Above it the drawing is
 * laid out at the box's own width (up to 1200 units, never under 720), so its
 * names stay near their real size instead of shrinking with a fixed canvas.
 * The cap is past the widest the Graph tab gets, so a wide box gets longer
 * bands and roomier names rather than the same drawing scaled up.
 */
const BANDS_MIN_WIDTH = 520;

/**
 * Who engages with the account and who it engages with, side by side, band
 * width by count, with the dame.is degree bars underneath: of everyone on
 * each side, how many are mutuals, follows, followers, 2nd degree and further.
 */
export function LedgerAccount({ data, focus, onFocus, onSelect }: { data: Neighbourhood } & FocusProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const subject = atName(data.subject);
  const { left, right, inbound, outbound } = useMemo(() => {
    const inbound = data.people.filter((p) => p.in > 0);
    const outbound = data.people.filter((p) => p.out > 0);
    return {
      inbound,
      outbound,
      left: [...inbound].sort((a, b) => b.in - a.in).slice(0, SIDE),
      right: [...outbound].sort((a, b) => b.out - a.out).slice(0, SIDE),
    };
  }, [data.people]);
  const focused = focus?.kind === 'person' ? focus.person.did : null;

  return (
    <div ref={ref} className="fx-graph-ledger">
      {!left.length && !right.length ? (
        <p className="explore-placeholder">No engagement either way in the last 30 days.</p>
      ) : width >= BANDS_MIN_WIDTH ? (
        <Bands
          left={left}
          right={right}
          subject={data.subject}
          focused={focused}
          onFocus={onFocus}
          onSelect={onSelect}
          width={Math.min(1200, Math.max(720, width))}
        />
      ) : (
        <div className="fx-graph-ledger-lists">
          <RankList title="Engaged with them most" people={left} value={(p) => p.in} focused={focused} onFocus={onFocus} onSelect={onSelect} />
          <RankList title="They engaged with most" people={right} value={(p) => p.out} focused={focused} onFocus={onFocus} onSelect={onSelect} />
        </div>
      )}
      <div className="fx-graph-bars">
        <DegreeBar label="Who engaged with them" people={inbound} subject={subject} />
        <DegreeBar label="Who they engaged with" people={outbound} subject={subject} />
      </div>
    </div>
  );
}

function Bands({
  left,
  right,
  subject,
  focused,
  onFocus,
  onSelect,
  width: W,
}: {
  left: GraphPerson[];
  right: GraphPerson[];
  subject: Neighbourhood['subject'];
  focused: string | null;
  onFocus: FocusProps['onFocus'];
  onSelect: FocusProps['onSelect'];
  width: number;
}) {
  // The label column on each side: a count, a name and an avatar.
  const LABEL = Math.round(W * 0.27);
  const rowH = 38;
  const top = 48;
  const H = Math.max(left.length, right.length) * rowH;
  const sumL = left.reduce((s, p) => s + p.in, 0);
  const sumR = right.reduce((s, p) => s + p.out, 0);
  const scale = (H - 20) / Math.max(1, sumL, sumR);
  const CX = W / 2;
  const BW = 14;
  const barTop = top + (H - Math.max(sumL, sumR) * scale) / 2;

  const side = (list: GraphPerson[], value: (p: GraphPerson) => number, isLeft: boolean) => {
    let acc = barTop;
    return list.map((p, i) => {
      const v = value(p);
      const y = top + i * rowH + rowH / 2;
      const th = Math.max(2, v * scale);
      const px = isLeft ? LABEL : W - LABEL;
      const cx = isLeft ? CX - BW / 2 : CX + BW / 2;
      const mx = (px + cx) / 2;
      const y1 = y - th / 2;
      const y2 = acc;
      acc += th;
      const d = isLeft
        ? `M${px},${y1} C${mx},${y1} ${mx},${y2} ${cx},${y2} L${cx},${y2 + th} C${mx},${y2 + th} ${mx},${y1 + th} ${px},${y1 + th} Z`
        : `M${cx},${y2} C${mx},${y2} ${mx},${y1} ${px},${y1} L${px},${y1 + th} C${mx},${y1 + th} ${mx},${y2 + th} ${cx},${y2 + th} Z`;
      const color = relationColor(relationOf(p));
      return (
        <g key={`${isLeft ? 'l' : 'r'}${p.did}`} className="fx-graph-band-row">
          <path d={d} fill={color} fillOpacity={focused === p.did ? 0.6 : 0.3} className="fx-graph-fade" />
          <g
            className="fx-graph-mark fx-graph-fade"
            role="img"
            aria-label={`${nameOf(p)}: ${fmt(v)}`}
            data-focus={focused === p.did || undefined}
            {...markProps(
              () => onFocus({ kind: 'person', person: p }),
              onSelect && (() => onSelect({ kind: 'person', person: p })),
            )}
          >
            <rect x={isLeft ? 10 : W - LABEL} y={y - rowH / 2 + 2} width={LABEL - 10} height={rowH - 4} className="fx-graph-hit" />
            <rect x={isLeft ? px - 5 : px} y={y1} width={5} height={th} fill={color} rx={2} />
            <Face x={isLeft ? px - 24 : px + 24} y={y} r={11} avatar={p.avatar} name={nameOf(p)} />
            <text x={isLeft ? px - 42 : px + 42} y={y + 5} textAnchor={isLeft ? 'end' : 'start'} className="fx-graph-t-name">
              {truncate(nameOf(p), Math.floor((LABEL - 80) / 7.6))}
            </text>
            <text x={isLeft ? 12 : W - 12} y={y + 5} textAnchor={isLeft ? 'start' : 'end'} className="fx-graph-t-num">
              {fmt(v)}
            </text>
          </g>
        </g>
      );
    });
  };

  return (
    <svg viewBox={`0 0 ${W} ${top + H + 16}`} className="fx-graph-svg fx-graph-bands" role="group" aria-label="Who engages with this account, and whom it engages with">
      <GraphDefs />
      <text x={12} y={24} className="fx-graph-t-head">
        Engaged with them most
      </text>
      <text x={W - 12} y={24} textAnchor="end" className="fx-graph-t-head">
        They engaged with most
      </text>
      {side(left, (p) => p.in, true)}
      {side(right, (p) => p.out, false)}
      <rect x={CX - BW / 2} y={barTop} width={BW} height={Math.max(sumL, sumR) * scale} rx={4} className="fx-graph-spine" />
      <g className="fx-graph-mark" role="img" aria-label={nameOf(subject)} {...markProps(() => onFocus(null), onSelect && (() => onSelect(null)))}>
        <Face x={CX} y={barTop - 22} r={16} avatar={subject.avatar} name={nameOf(subject)} ring="var(--text-primary)" />
      </g>
    </svg>
  );
}

function RankList({
  title,
  people,
  value,
  focused,
  onFocus,
  onSelect,
}: {
  title: string;
  people: GraphPerson[];
  value: (p: GraphPerson) => number;
  focused: string | null;
  onFocus: FocusProps['onFocus'];
  onSelect: FocusProps['onSelect'];
}) {
  const max = Math.max(1, ...people.map(value));
  return (
    <section className="fx-graph-rank">
      <h3 className="fx-graph-rank-h">{title}</h3>
      <ol>
        {people.map((p) => (
          <li key={p.did}>
            <button
              type="button"
              className="fx-graph-rank-row"
              data-focus={focused === p.did || undefined}
              onClick={() => (onSelect ?? onFocus)({ kind: 'person', person: p })}
              onFocus={() => onFocus({ kind: 'person', person: p })}
            >
              <span className="fx-graph-rank-name">{nameOf(p)}</span>
              <span className="fx-graph-rank-bar" aria-hidden>
                <span style={{ width: `${(value(p) / max) * 100}%`, background: relationColor(relationOf(p)) }} />
              </span>
              <span className="fx-graph-rank-n">{fmt(value(p))}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The dame.is degree bar: one set of accounts, split by where they sit. */
function DegreeBar({ label, people, subject }: { label: string; people: GraphPerson[]; subject: string }) {
  const counts = breakdown(people);
  const present = RELATION_ORDER.filter((r) => counts[r] > 0);
  const pct = (r: Relation) => Math.round((counts[r] / Math.max(1, counts.total)) * 100);
  return (
    <figure className="fx-graph-bar">
      <figcaption className="fx-graph-bar-head">
        {label}
        <span>{fmt(counts.total)} accounts</span>
      </figcaption>
      <div className="fx-graph-bar-track" aria-hidden>
        {present.map((r) => (
          <span key={r} style={{ flexGrow: counts[r], background: relationColor(r) }} title={`${relationLabel(r, subject)}: ${fmt(counts[r])}`} />
        ))}
      </div>
      <dl className="fx-graph-bar-table">
        {present.map((r) => (
          <div key={r}>
            <dt>
              <span className="fx-graph-swatch" style={{ background: relationColor(r) }} aria-hidden />
              {relationLabel(r, subject)}
            </dt>
            <dd>
              {fmt(counts[r])} <span>{pct(r)}%</span>
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

/**
 * A thread as an icicle: each post as wide as the replies under it, so the
 * replies that drew the conversation are the wide ones. Choosing a block
 * zooms into its branch.
 */
export function LedgerThread({
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
  const [top, setTop] = useState<ThreadPost[]>([]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const at = top[top.length - 1] ?? root;
  // Laid out at the box's own width, so names keep their size in a narrow
  // pane and only the blocks wide enough to hold one are labelled.
  const W = Math.max(480, Math.min(1100, width || 1000));
  const RH = 54;
  const cells = useMemo(() => icicleLayout(at, W, RH), [at, W]);
  const rows = Math.max(...cells.map((c) => c.y)) / RH + 1;
  const focused = focus?.kind === 'post' ? focus.post.uri : null;
  return (
    <div ref={ref} className="fx-graph-main">
      <ZoomBox
        label="Icicle chart of the thread"
        maxWidth={W}
        aspect={(rows * RH + 8) / W}
        tools={
          top.length > 0 && (
            <button type="button" className="fx-graph-tool" onClick={() => setTop(top.slice(0, -1))}>
              <ArrowUp size={14} aria-hidden />
              Up a level
            </button>
          )
        }
      >
        <svg viewBox={`0 0 ${W} ${rows * RH + 8}`} className="fx-graph-svg">
          {cells.map(({ post, x, y, w, h }) => {
            const rel = post === root ? 'op' : relationOfAuthor(post.did);
            const roomy = w > 80;
            const canOpen = post !== at && post.kids.length > 0;
            return (
              <g
                key={post.uri}
                className="fx-graph-mark fx-graph-cell fx-graph-fade"
                style={{ animationDelay: `${Math.min(900, (post.depth - at.depth) * 110)}ms` }}
                role="button"
                aria-label={`${post.displayName || post.handle}, ${fmt(post.size - 1)} replies under it${canOpen ? ', open its branch' : ''}`}
                data-focus={focused === post.uri || undefined}
                data-current={current === post.uri || undefined}
                {...markProps(
                  () => onFocus({ kind: 'post', post }),
                  canOpen || onSelect
                    ? () => {
                        onSelect?.({ kind: 'post', post });
                        if (canOpen) setTop([...top, post]);
                      }
                    : undefined,
                  w > 6,
                )}
              >
                <rect x={x + 1} y={y + 1} width={Math.max(1, w - 2)} height={h - 2} rx={3} fill={relationColor(rel)} fillOpacity={0.22} />
                <rect x={x + 1} y={y + 1} width={Math.max(1, w - 2)} height={4} rx={2} fill={relationColor(rel)} />
                {roomy && (
                  <>
                    <text x={x + 8} y={y + 24} className="fx-graph-t-name">
                      {truncate(post.displayName || post.handle || '', Math.floor(w / 8.4))}
                    </text>
                    <text x={x + 8} y={y + 42} className="fx-graph-t-body">
                      {truncate(post.text, Math.floor(w / 7))}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </ZoomBox>
      <p className="fx-graph-caption">
        Each post is as wide as the replies under it. Choose one with replies to open its branch.
      </p>
    </div>
  );
}
