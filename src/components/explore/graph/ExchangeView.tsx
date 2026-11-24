'use client';

import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  DAY_MS,
  ENGAGEMENT_KINDS,
  backAndForth,
  exchangeTotals,
  kindReach,
  type EngagementKind,
  type ExchangeTotals,
  type GraphPerson,
} from '@/lib/socialGraph';
import type { Neighbourhood } from '@/utils/atproto/graphData';
import { Avatar, atName, fmt, nameOf, useWidth, type FocusProps } from './shared';

/** Rows in the back-and-forth list. */
const PAIRS = 12;

const KIND_LABELS: Record<EngagementKind, string> = {
  like: 'Likes',
  repost: 'Reposts',
  reply: 'Replies',
  quote: 'Quotes',
  mention: 'Mentions',
};

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/**
 * Engagement as relationships rather than counts of acts: who engaged with
 * the account, whom it engaged with, and who is on both sides. Totals and
 * their overlap, the same two directions day by day, by kind, and the
 * accounts with the most going both ways, which open in the details pane.
 *
 * Blue, orange and green are the follower, following and mutual colours:
 * the same three directions, read from engagement instead of follows.
 */
export function ExchangeAccount({ data, focus, onFocus, onSelect }: { data: Neighbourhood } & FocusProps) {
  const subject = atName(data.subject);
  const totals = useMemo(() => exchangeTotals(data.people), [data.people]);
  const kinds = useMemo(() => kindReach(data.people), [data.people]);
  const pairs = useMemo(() => backAndForth(data.people, PAIRS), [data.people]);
  const focused = focus?.kind === 'person' ? focus.person.did : null;
  const pairsId = useId();

  if (!totals.reach) {
    return <p className="explore-placeholder">No engagement either way in the last 30 days.</p>;
  }
  return (
    <div className="fx-graph-x">
      <ExchangeSummary totals={totals} />
      <Days days={data.days} start={data.windowStart} readFrom={data.inboundSince} />
      <div className="fx-graph-x-pair">
        <ByKind kinds={kinds} subject={subject} />
        <section className="fx-graph-rank" aria-labelledby={pairsId}>
          <h3 className="fx-graph-rank-h" id={pairsId}>
            Back and forth
          </h3>
          {pairs.length ? (
            <BackAndForth people={pairs} focused={focused} onFocus={onFocus} onSelect={onSelect} />
          ) : (
            <p className="fx-graph-x-empty">No one engaged both ways.</p>
          )}
        </section>
      </div>
      {data.inboundPosts > 0 && (
        <p className="fx-graph-caption">
          Engagement with {subject} is read from their {fmt(data.inboundPosts)} most-engaged{' '}
          {data.inboundPosts === 1 ? 'post' : 'posts'}{' '}
          {data.inboundSince - data.windowStart > DAY_MS ? `since ${dayLabel(data.inboundSince)}` : 'of the last 30 days'}.
        </p>
      )}
    </div>
  );
}

/** The view's key, in place of the relation key the other layouts carry. */
export function ExchangeLegend({ subject }: { subject: string }) {
  return (
    <ul className="fx-graph-legend" aria-label="Key">
      <li>
        <span className="fx-graph-swatch" data-dir="in" aria-hidden />
        Engaged with {subject}
      </li>
      <li>
        <span className="fx-graph-swatch" data-dir="both" aria-hidden />
        Both ways
      </li>
      <li>
        <span className="fx-graph-swatch" data-dir="out" aria-hidden />
        {subject} engaged with
      </li>
    </ul>
  );
}

/**
 * In, both ways and out as three figures, over the overlap drawn to scale:
 * the top row is everyone in, the bottom row everyone out, and the column
 * they share is both ways. Shared with the account card (ExchangeCard).
 */
export function ExchangeSummary({ totals, compact = false }: { totals: ExchangeTotals; compact?: boolean }) {
  const share = totals.reach ? Math.round((totals.both / totals.reach) * 100) : 0;
  return (
    <div className="fx-graph-xs" data-compact={compact || undefined}>
      <dl className="fx-graph-xs-stats">
        <div>
          <dt>
            <span className="fx-graph-swatch" data-dir="in" aria-hidden />
            In
          </dt>
          <dd>{fmt(totals.in)}</dd>
        </div>
        <div>
          <dt>
            <span className="fx-graph-swatch" data-dir="both" aria-hidden />
            Both ways
          </dt>
          <dd>
            {fmt(totals.both)}
            {totals.both > 0 && (
              <span title={`${share}% of the ${fmt(totals.reach)} accounts engaged either way`}>{share}%</span>
            )}
          </dd>
        </div>
        <div>
          <dt>
            <span className="fx-graph-swatch" data-dir="out" aria-hidden />
            Out
          </dt>
          <dd>{fmt(totals.out)}</dd>
        </div>
      </dl>
      <Overlap totals={totals} />
    </div>
  );
}

function Overlap({ totals }: { totals: ExchangeTotals }) {
  const inOnly = totals.in - totals.both;
  const outOnly = totals.out - totals.both;
  // Each row has the same three parts in the same order, so the columns line
  // up; a part with nothing in it is left out of both rows alike.
  const parts = [
    { key: 'in-only', n: inOnly, top: 'in', bottom: null },
    { key: 'both', n: totals.both, top: 'both', bottom: 'both' },
    { key: 'out-only', n: outOnly, top: null, bottom: 'out' },
  ].filter((p) => p.n > 0);
  const row = (side: 'top' | 'bottom') => (
    <span className="fx-graph-xs-row">
      {parts.map((p) => (
        <span key={p.key} style={{ flexGrow: p.n }} data-dir={p[side] ?? undefined} />
      ))}
    </span>
  );
  return (
    <div
      className="fx-graph-xs-bar"
      role="img"
      aria-label={`${fmt(inOnly)} in only, ${fmt(totals.both)} both ways, ${fmt(outOnly)} out only`}
    >
      {row('top')}
      {row('bottom')}
    </div>
  );
}

/**
 * Accounts per day, in above the line and out below it on one scale, so a
 * day's balance reads at a glance. Pointing at a day, or stepping with the
 * arrow keys, names it above the chart. Days before `readFrom` had none of
 * the subject's posts read for engagement, and are shaded on the in side
 * rather than drawn as quiet.
 */
function Days({ days, start, readFrom }: { days: Neighbourhood['days']; start: number; readFrom: number }) {
  const [ref, width] = useWidth<HTMLElement>();
  const [at, setAt] = useState<number | null>(null);
  const n = days.in.length;
  const max = Math.max(1, ...days.in, ...days.out);
  const W = Math.max(240, width || 640);
  const gutter = 10 + fmt(max).length * 7;
  const half = 46;
  const base = 4 + half;
  const H = base + 1 + half + 4;
  const slot = (W - gutter) / n;
  const bw = Math.max(2, Math.min(14, slot - 3));
  const h = (v: number) => (v ? Math.max(1, (v / max) * half) : 0);
  const peak = Math.max(...days.in);
  const peakIn = days.in.indexOf(peak);
  const dayStart = (i: number) => start + i * DAY_MS;
  const unreadW = Math.max(0, Math.min(W - gutter, ((readFrom - start) / DAY_MS) * slot));

  const pointAt = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    const i = Math.floor((x - gutter) / slot);
    setAt(i >= 0 && i < n ? i : null);
  };
  const step = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const from = at ?? n;
    setAt(Math.max(0, Math.min(n - 1, from + (e.key === 'ArrowLeft' ? -1 : 1))));
  };

  return (
    <figure className="fx-graph-days" ref={ref}>
      <figcaption className="fx-graph-days-head">
        <span>Accounts per day</span>
        <span className="fx-graph-days-read" aria-live="polite">
          {at == null ? (
            peak > 0 && `Busiest: ${dayLabel(dayStart(peakIn))}, ${fmt(peak)} in`
          ) : (
            <>
              {dayLabel(dayStart(at))}
              <span>
                <span className="fx-graph-swatch" data-dir="in" aria-hidden />
                {fmt(days.in[at])} in
              </span>
              <span>
                <span className="fx-graph-swatch" data-dir="out" aria-hidden />
                {fmt(days.out[at])} out
              </span>
            </>
          )}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="fx-graph-days-svg"
        tabIndex={0}
        role="img"
        aria-label={`Accounts engaging each day for 30 days, in above the line and out below. Use the arrow keys to read a day.`}
        data-active={at == null ? undefined : ''}
        onPointerMove={pointAt}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setAt(null)}
        onKeyDown={step}
        onBlur={() => setAt(null)}
      >
        <line x1={gutter} x2={W} y1={4.5} y2={4.5} className="fx-graph-days-grid" />
        <line x1={gutter} x2={W} y1={H - 4.5} y2={H - 4.5} className="fx-graph-days-grid" />
        {unreadW > slot && (
          <g className="fx-graph-days-unread">
            <rect x={gutter} y={4.5} width={unreadW} height={base - 4.5} />
            {unreadW > 72 && (
              <text x={gutter + unreadW / 2} y={4.5 + (base - 4.5) / 2 + 4} textAnchor="middle">
                Not read
              </text>
            )}
          </g>
        )}
        <line x1={gutter} x2={W} y1={base + 0.5} y2={base + 0.5} className="fx-graph-days-base" />
        <text x={gutter - 6} y={12} textAnchor="end" className="fx-graph-t-num fx-graph-days-tick">
          {fmt(max)}
        </text>
        <text x={gutter - 6} y={H - 4} textAnchor="end" className="fx-graph-t-num fx-graph-days-tick">
          {fmt(max)}
        </text>
        {days.in.map((vin, i) => {
          const x = gutter + i * slot + (slot - bw) / 2;
          const hi = h(vin);
          const ho = h(days.out[i]);
          return (
            <g key={i} className="fx-graph-day" data-on={at === i || undefined}>
              {hi > 0 && <rect x={x} y={base - hi} width={bw} height={hi} rx={Math.min(2, bw / 2)} data-dir="in" />}
              {ho > 0 && <rect x={x} y={base + 1} width={bw} height={ho} rx={Math.min(2, bw / 2)} data-dir="out" />}
            </g>
          );
        })}
      </svg>
      <div className="fx-graph-days-axis" style={{ paddingLeft: `${(gutter / W) * 100}%` }}>
        <span>{dayLabel(start)}</span>
        <span>Today</span>
      </div>
    </figure>
  );
}

/** Accounts per kind of engagement, toward the account on the left and from it on the right. */
function ByKind({ kinds, subject }: { kinds: ReturnType<typeof kindReach>; subject: string }) {
  const max = Math.max(1, ...ENGAGEMENT_KINDS.flatMap((k) => [kinds.in[k], kinds.out[k]]));
  const bar = (v: number) => ({ width: v ? `max(2px, calc((100% - 5ch) * ${(v / max).toFixed(4)}))` : '0' });
  const headId = useId();
  return (
    <section className="fx-graph-kinds" aria-labelledby={headId}>
      <h3 className="fx-graph-rank-h" id={headId}>
        By kind
      </h3>
      <table className="fx-graph-kinds-table">
        <thead>
          <tr>
            <th scope="col">To {subject}</th>
            <th scope="col">
              <span className="fn-sr-only">Kind</span>
            </th>
            <th scope="col">From {subject}</th>
          </tr>
        </thead>
        <tbody>
          {ENGAGEMENT_KINDS.map((k) => (
            <tr key={k}>
              <td>
                <div className="fx-graph-kinds-cell" data-side="in">
                  <span className="fx-graph-kinds-n">{fmt(kinds.in[k])}</span>
                  <span className="fx-graph-kinds-bar" data-dir="in" style={bar(kinds.in[k])} />
                </div>
              </td>
              <th scope="row">{KIND_LABELS[k]}</th>
              <td>
                <div className="fx-graph-kinds-cell" data-side="out">
                  <span className="fx-graph-kinds-bar" data-dir="out" style={bar(kinds.out[k])} />
                  <span className="fx-graph-kinds-n">{fmt(kinds.out[k])}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The accounts with the most going both ways, each a way into the details pane. */
function BackAndForth({
  people,
  focused,
  onFocus,
  onSelect,
}: {
  people: GraphPerson[];
  focused: string | null;
  onFocus: FocusProps['onFocus'];
  onSelect: FocusProps['onSelect'];
}) {
  const max = Math.max(1, ...people.flatMap((p) => [p.in, p.out]));
  const bar = (v: number) => ({ width: `max(2px, ${((v / max) * 100).toFixed(2)}%)` });
  return (
    <ol className="fx-graph-xlist">
      {people.map((p) => (
        <li key={p.did}>
          <button
            type="button"
            className="fx-graph-xrow"
            data-focus={focused === p.did || undefined}
            aria-label={`${nameOf(p)}: ${fmt(p.in)} in, ${fmt(p.out)} out`}
            onClick={() => (onSelect ?? onFocus)({ kind: 'person', person: p })}
            onFocus={() => onFocus({ kind: 'person', person: p })}
          >
            <Avatar src={p.avatar} name={nameOf(p)} />
            <span className="fx-graph-rank-name">{nameOf(p)}</span>
            <span className="fx-graph-xrow-mini" aria-hidden>
              <span className="fx-graph-xrow-n">{fmt(p.in)}</span>
              <span className="fx-graph-xrow-bars">
                <span data-side="in">
                  <span data-dir="in" style={bar(p.in)} />
                </span>
                <span data-side="out">
                  <span data-dir="out" style={bar(p.out)} />
                </span>
              </span>
              <span className="fx-graph-xrow-n">{fmt(p.out)}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
