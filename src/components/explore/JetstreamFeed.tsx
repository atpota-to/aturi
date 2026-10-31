'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Pause, Play } from 'lucide-react';
import {
  createJetstreamConnection,
  type JetstreamCommit,
} from '@/utils/atproto/jetstream';
import { explorePathFromAtUri, shortDid } from '@/utils/atproto/urls';
import AtUriLink from './AtUriLink';

type Op = 'create' | 'update' | 'delete';

type Row = {
  uri: string;
  did: string;
  collection: string;
  rkey: string;
  value: Record<string, unknown>;
  op: Op;
  ts: number;
  receivedAt: number;
};

type Stats = {
  total: number;
  uniqueDids: number;
  uniqueCollections: number;
};

const EMPTY_STATS: Stats = {
  total: 0,
  uniqueDids: 0,
  uniqueCollections: 0,
};

// Flush interval — slower than the firehose tempo on purpose. A faster flush
// makes the feed feel "live" but with thousands of events/sec the rendered
// list churns so fast that nothing is readable.
const FLUSH_INTERVAL_MS = 750;
// Hard cap on how many new rows we surface per flush. We deliberately *drop*
// events past this so the list reads as a sample of activity rather than a
// strobe of every commit. The rate counter below preserves the sense of
// scale.
const MAX_INSERTS_PER_FLUSH = 6;
type Props = {
  /** Limit the firehose subscription to these NSIDs. */
  initialCollections?: string[];
  /**
   * Which commit operations to surface. Defaults to `['create']` so the
   * homepage strip stays calm; pass all three to see the full mutation
   * stream on the explorer.
   */
  wantedOps?: Op[];
  /** Render the +/~/× op pill on each row. */
  showOpLabels?: boolean;
  /** Show the rolling stats footer (totals, op breakdown, cardinality). */
  showStats?: boolean;
  /** Show the ~N/s throughput indicator in the header. */
  showRate?: boolean;
  /** Show the Pause/Resume button in the header. */
  showPauseButton?: boolean;
  /** Pin the row viewport to this height. */
  height?: string;
  /** Max rows kept in the visible list before old rows drop off. */
  maxVisible?: number;
};

/**
 * Live record feed from the Jetstream firehose.
 *
 * Two-layer throttle:
 *
 *   1. Buffer in a ref; flush to state on a fixed interval (FLUSH_INTERVAL_MS).
 *   2. Per-flush cap (MAX_INSERTS_PER_FLUSH) so the visible list doesn't
 *      churn even when the firehose dumps hundreds of events between flushes.
 *
 * Visual change cue is a brief left-edge accent on each newly-arrived row,
 * not a row-wide fade-in — at ~50 events/sec the row-wide flash reads as
 * a strobe.
 *
 * Most chrome is opt-in via props so the same component can drive the
 * minimal homepage demo (rows only) and the verbose explorer dashboard
 * (op labels + rolling stats).
 */
export default function JetstreamFeed({
  initialCollections,
  wantedOps,
  showOpLabels = false,
  showStats = false,
  showRate = true,
  showPauseButton = true,
  height = '32rem',
  maxVisible = 20,
}: Props) {
  const [collections] = useState<string[] | undefined>(
    initialCollections && initialCollections.length ? initialCollections : undefined,
  );
  // Memoize so we don't reconnect on every render when the caller passes
  // an inline array literal.
  const ops = useMemo<Op[]>(
    () => (wantedOps && wantedOps.length ? wantedOps : ['create']),
    // Stringify so a new array with the same values doesn't trip the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wantedOps?.join('|')],
  );
  const [paused, setPaused] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  // Events per second over the last ~5s, computed from the buffer's arrival
  // rate (not just what we render). Lets users see the firehose volume even
  // though we only surface a sample of rows.
  const [eps, setEps] = useState(0);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const buffer = useRef<Row[]>([]);
  const epsCounter = useRef<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stats are accumulated in a ref (no per-event React state churn) and
  // sampled to state on each flush tick.
  const statsRef = useRef({
    total: 0,
    uniqueDids: new Set<string>(),
    uniqueCollections: new Set<string>(),
  });

  // Read `paused` inside tick() via a ref so toggling it doesn't tear down and
  // reopen the websocket (which dropped the buffer and hammered the Jetstream
  // server on every click). Pause now just stops rendering rows while the
  // socket — and the live throughput counter — keep running.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Close the socket while the tab is backgrounded. Unlike timers, websockets
  // are NOT throttled in hidden tabs, so an unattended background tab would
  // otherwise keep pulling the full firehose (bandwidth, CPU, mobile data,
  // battery) indefinitely. Reconnecting when the user returns is cheap.
  const [hidden, setHidden] = useState(
    typeof document !== 'undefined' && document.hidden,
  );
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (hidden) return; // hold the socket closed while the tab is backgrounded
    const dispose = createJetstreamConnection(
      { wantedCollections: collections, wantedOps: ops },
      (evt: JetstreamCommit) => {
        const did = evt.did;
        const c = evt.commit.collection;
        const rkey = evt.commit.rkey;
        const value = (evt.commit.record as Record<string, unknown>) || {};
        const op = evt.commit.operation;
        const uri = `at://${did}/${c}/${rkey}`;
        const receivedAt = Date.now();
        buffer.current.push({
          uri,
          did,
          collection: c,
          rkey,
          value,
          op,
          ts: evt.time_us,
          receivedAt,
        });
        // Track arrival rate for the throughput indicator.
        epsCounter.current.push(receivedAt);
        // Stats — total events seen plus the unique-cardinality Sets.
        // Sets grow with session length; the component unmounts (and the
        // ref clears) when the user navigates away, so memory is bounded
        // by tab lifetime.
        const s = statsRef.current;
        s.total += 1;
        s.uniqueDids.add(did);
        s.uniqueCollections.add(c);
        // Bound buffer + counter so memory stays flat under steady load.
        if (buffer.current.length > 400) {
          buffer.current.splice(0, buffer.current.length - 400);
        }
      },
    );

    function tick() {
      const now = Date.now();
      // Throughput: events received in the last 5 seconds.
      epsCounter.current = epsCounter.current.filter((t) => now - t < 5_000);
      setEps(Math.round(epsCounter.current.length / 5));

      if (showStats) {
        const s = statsRef.current;
        setStats({
          total: s.total,
          uniqueDids: s.uniqueDids.size,
          uniqueCollections: s.uniqueCollections.size,
        });
      }

      if (!pausedRef.current && buffer.current.length > 0) {
        // Take only the most recent N from the buffer — older events drop.
        const buf = buffer.current;
        const take = buf.slice(-MAX_INSERTS_PER_FLUSH).reverse();
        buffer.current = [];
        setRows((prev) => {
          // Dedupe by (uri, op, ts) so a single commit can't show twice
          // but a create followed by an update on the same URI still
          // surfaces as two rows.
          const seen = new Set(prev.map((r) => `${r.uri}|${r.op}|${r.ts}`));
          const fresh = take.filter((r) => !seen.has(`${r.uri}|${r.op}|${r.ts}`));
          if (fresh.length === 0) return prev;
          const next = [...fresh, ...prev];
          return next.slice(0, maxVisible);
        });
      }

      timerRef.current = setTimeout(tick, FLUSH_INTERVAL_MS);
    }
    timerRef.current = setTimeout(tick, FLUSH_INTERVAL_MS);

    return () => {
      dispose();
      if (timerRef.current) clearTimeout(timerRef.current);
      buffer.current = [];
      epsCounter.current = [];
    };
    // `paused` intentionally excluded — handled via pausedRef so pausing
    // doesn't reconnect. `hidden` gates the socket for tab visibility.
  }, [collections, ops, hidden, showStats, maxVisible]);

  return (
    <section className="fl-feed">
      <header className="fl-feed-head">
        <span className="fl-feed-live" data-paused={paused ? '' : undefined} aria-hidden>
          <Activity size={14} />
        </span>
        <span className="fl-feed-title">Live across the Atmosphere</span>
        {showRate && eps > 0 && (
          <span className="fl-feed-rate" title="Events per second across the live network feed">
            ~{eps.toLocaleString()}/s
          </span>
        )}
        {showPauseButton && (
          <button type="button" onClick={() => setPaused((p) => !p)} className="fl-feed-pause">
            {paused ? <Play size={11} /> : <Pause size={11} />}
            {paused ? 'Resume' : 'Pause'}
          </button>
        )}
      </header>

      <ul
        className="explore-jetstream-scroll"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          // Pin the viewport so the surrounding page doesn't reflow once
          // jetstream events start arriving. Skeleton rows below fill the
          // space until real rows take over.
          height,
          // overflow: hidden (not auto) so the browser doesn't track a
          // scroll position for this element at all. Rows beyond the
          // viewport are clipped — fine for a live demo where the
          // freshest rows are always at the top.
          overflow: 'hidden',
          // overflow-anchor: none opts out of browser scroll anchoring
          // for this element. With anchoring on, Chromium picked an <li>
          // inside the ul as the scroll anchor; each batch of prepends
          // shifted the anchor's position within the (clipped) ul, and
          // the browser tried to compensate by nudging the OUTER
          // document scroll down to "keep" the anchor at its original
          // viewport y. This is what was scrolling the page each batch.
          overflowAnchor: 'none',
          // contain: layout isolates the ul's internal layout from the
          // rest of the page so DOM mutations inside it can't affect
          // the surrounding document's layout calculations.
          contain: 'layout',
        }}
      >
        {rows.length === 0 && <SkeletonRows showOpColumn={showOpLabels} />}
        {rows.map((r) => (
          <FeedRow
            key={`${r.uri}|${r.op}|${r.ts}`}
            row={r}
            showOpLabel={showOpLabels}
          />
        ))}
      </ul>

      {showStats && <StatsFooter stats={stats} />}
    </section>
  );
}

function FeedRow({ row, showOpLabel }: { row: Row; showOpLabel: boolean }) {
  const explorerHref = explorePathFromAtUri(row.uri);
  const tail = row.collection.split('.').slice(-2).join('.');
  // The `data-fresh` attribute triggers the CSS arrival animation
  // (defined as `forwards` so the final state is "transparent"). We set
  // it on every row — newly-mounted rows run the animation once, and
  // older rows that React keeps mounted stay at the completed
  // (transparent) keyframe. No render-time clock read needed.
  const rowContents = (
    <>
      {showOpLabel && <OpPill op={row.op} />}
      <code className="fl-feed-did" title={row.did}>
        {shortDid(row.did)}
      </code>
      <code className="fl-feed-nsid" title={row.collection}>
        {tail}
      </code>
    </>
  );

  const rowClass = 'fl-feed-row' + (showOpLabel ? ' fl-feed-row-ops' : '');

  return (
    <li data-fresh="" className="explore-jetstream-row">
      {explorerHref ? (
        <AtUriLink uri={row.uri} className={rowClass}>
          {rowContents}
        </AtUriLink>
      ) : (
        <div className={rowClass}>{rowContents}</div>
      )}
    </li>
  );
}

/**
 * Tiny pill that calls out which commit operation a row represents.
 * Color-coded so a wall of creates reads green and the rarer
 * updates/deletes pop without screaming.
 */
function OpPill({ op }: { op: Op }) {
  const meta: Record<Op, { label: string; title: string }> = {
    create: { label: '+', title: 'create' },
    update: { label: '~', title: 'update' },
    delete: { label: '×', title: 'delete' },
  };
  const m = meta[op];
  return (
    <span aria-label={m.title} title={m.title} className="fl-feed-op" data-op={op}>
      {m.label}
    </span>
  );
}

/**
 * Rolling counters: how many events have streamed by since mount, the
 * per-op breakdown, and how many distinct DIDs and lexicons we've seen.
 * Cardinality counters are capped (UNIQUE_*_CAP) so the trailing `+` is
 * the user-visible signal that they're past the cap.
 */
function StatsFooter({ stats }: { stats: Stats }) {
  const item = (label: string, value: string, hint?: string) => (
    <span className="fl-feed-stat" title={hint}>
      <strong>{value}</strong>
      {label}
    </span>
  );
  return (
    <footer className="fl-feed-foot">
      {item('total', stats.total.toLocaleString(), 'Events received since the feed loaded')}
      {item('users', stats.uniqueDids.toLocaleString(), 'Distinct DIDs spotted')}
      {item('lexicons', stats.uniqueCollections.toLocaleString(), 'Distinct NSIDs spotted')}
    </footer>
  );
}

/**
 * Skeleton placeholder rows shown until the first jetstream event arrives.
 * Mirrors the live row grid (DID column / collection column / preview
 * column) so the layout is stable as real rows replace them. The bars are
 * the site's shared .fn-skel, and the third-column width varies by index
 * so the stack reads as a list of distinct items rather than a uniform
 * pattern.
 */
function SkeletonRows({ showOpColumn }: { showOpColumn: boolean }) {
  // 14 rows fills the 32rem viewport without overflowing it (each row is
  // about 1.5rem tall including border).
  const rows = Array.from({ length: 14 });
  return (
    <>
      {rows.map((_, i) => (
        <li
          key={i}
          aria-hidden
          className={'fl-feed-row' + (showOpColumn ? ' fl-feed-row-ops' : '')}
          style={{ opacity: 0.9 - i * 0.04 }}
        >
          {showOpColumn && <SkeletonBar widthCh={2} />}
          <SkeletonBar widthCh={16} />
          <SkeletonBar widthCh={10 + (i % 4) * 2} />
        </li>
      ))}
    </>
  );
}

function SkeletonBar({
  widthCh,
  widthPct,
}: {
  widthCh?: number;
  widthPct?: string;
}) {
  return (
    <span
      className="fn-skel fl-feed-bar"
      style={{ width: widthPct || `${widthCh}ch` }}
    />
  );
}
