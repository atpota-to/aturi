'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, BarChart3, Sparkles } from 'lucide-react';
import AppearIn from './AppearIn';
import { Skeleton } from '@/components/SkeletonLoader';
import { Credit, DeltaPill, Segmented, Sparkline } from './lexicons/primitives';
import {
  fetchCollections,
  fetchCollectionStats,
  fetchTimeseries,
} from '@/utils/ufos/client';
import {
  isoAgo,
  METRIC_LABEL,
  orderForMetric,
  statForMetric,
  type Metric,
} from '@/utils/ufos/config';
import { formatCount } from '@/utils/ufos/format';
import { namespaceKey, schemaPathFor, splitNsid } from '@/utils/ufos/nsid';
import { WINDOWS, type Window } from '@/utils/ufos/windows';

type Mode = 'top' | 'trending';

const RESULT_COUNT = 10;
/** Row count after "Show more". */
const EXPANDED_COUNT = 20;
/**
 * Pull more candidates than we'll display so the filter (drop app.bsky.*
 * in trending) + dedup (one row per top-2-segment namespace) still leaves
 * enough rows to fill the table.
 */
const CANDIDATE_POOL_FACTOR = 5;

type CollectionRow = {
  nsid: string;
  /** Metric value in the current window — what gets displayed in Top mode. */
  value: number;
  series: number[];
  /** % change vs the equivalent prior window; null when prior is 0 or unknown. */
  deltaPct: number | null;
};

/**
 * Top / Trending lexicons strip on /explore. Hits the UFOs API
 * (ufos-api.microcosm.blue) and exposes three independent toggles:
 *
 *   - mode: Trending (% change vs prior window) or Top (absolute leaders)
 *   - metric: creates / updates / deletes / dids
 *   - window: 1d / 7d / 30d
 *
 * Bluesky-namespace collections are filtered out of TRENDING only — they
 * dominate every absolute ranking but the % change view is more useful
 * highlighting non-Bluesky momentum. Top keeps the whole catalog. Both
 * modes dedupe by top-2-segment namespace so `social.grain.gallery` and
 * `social.grain.like` aren't both in the table at once.
 */
export default function TrendingLexicons({
  showExploreAllLink = true,
}: {
  /** The "Explore all" header link points at /explore/lexicons; hide it
   * when the strip is rendered on that page itself. */
  showExploreAllLink?: boolean;
} = {}) {
  const [mode, setMode] = useState<Mode>('trending');
  const [metric, setMetric] = useState<Metric>('dids');
  const [window, setWindow] = useState<Window>('7d');
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<CollectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const limit = expanded ? EXPANDED_COUNT : RESULT_COUNT;

  useEffect(() => {
    let cancelled = false;
    setError(null);

    // Note: we intentionally don't clear `rows` here. On toggle refetches
    // the previous table stays visible until the new data arrives, so the
    // skeleton only appears on the very first load (rows === null).
    (async () => {
      try {
        const next = await fetchRanking(window, mode, metric, limit);
        if (!cancelled) setRows(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [window, mode, metric, limit]);

  // Slice defensively: while an expand is in flight `rows` still holds the
  // previous (shorter or longer) result, and collapsing should take effect
  // immediately rather than waiting on the refetch.
  const visible = rows ? rows.slice(0, limit) : null;

  return (
    <AppearIn delay={0.12}>
      <section
        style={{
          border: '1px solid var(--border-medium)',
          background: 'var(--bg-secondary)',
        }}
      >
        <Header
          mode={mode}
          setMode={setMode}
          metric={metric}
          setMetric={setMetric}
          window={window}
          setWindow={setWindow}
          showExploreAllLink={showExploreAllLink}
        />
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {error ? (
            <div className="explore-error" style={{ padding: '1rem' }}>
              Couldn&rsquo;t reach the UFOs API: {error}
            </div>
          ) : visible ? (
            visible.length === 0 ? (
              <p
                className="explore-placeholder"
                style={{ padding: '1rem', margin: 0 }}
              >
                No lexicons matched in this window.
              </p>
            ) : (
              <>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {visible.map((row, i) => (
                    <Row
                      key={row.nsid}
                      row={row}
                      rank={i + 1}
                      mode={mode}
                      metric={metric}
                      window={window}
                      isLast={i === visible.length - 1}
                    />
                  ))}
                </ul>
                {/* Hide the toggle only when collapsed and the list is
                    already short — there's nothing more to reveal. */}
                {(expanded || visible.length >= RESULT_COUNT) && (
                  <ShowMore
                    expanded={expanded}
                    onToggle={() => setExpanded((v) => !v)}
                  />
                )}
              </>
            )
          ) : (
            // First load: render a full-height skeleton table so the
            // section reserves its final size instead of starting tiny and
            // jumping tall once the data lands.
            <SkeletonRows mode={mode} count={limit} />
          )}
        </div>
        <Credit />
      </section>
    </AppearIn>
  );
}

function Header({
  mode,
  setMode,
  metric,
  setMetric,
  window,
  setWindow,
  showExploreAllLink,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  metric: Metric;
  setMetric: (m: Metric) => void;
  window: Window;
  setWindow: (w: Window) => void;
  showExploreAllLink: boolean;
}) {
  const Icon = mode === 'trending' ? Sparkles : BarChart3;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.625rem',
        padding: '0.875rem 1rem',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontFamily: 'var(--font-serif)',
          color: 'var(--text-primary)',
          fontSize: '0.9375rem',
        }}
      >
        <Icon size={14} aria-hidden style={{ color: 'var(--text-accent)' }} />
        {mode === 'trending' ? 'Trending lexicons' : 'Top lexicons'}
        <span
          style={{
            marginLeft: '0.25rem',
            fontSize: '0.7rem',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          via UFOs
        </span>
        {showExploreAllLink && (
          <Link
            href="/explore/lexicons"
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem',
              fontSize: '0.8125rem',
              color: 'var(--text-accent)',
              textDecoration: 'none',
            }}
          >
            Explore all <ArrowUpRight size={12} aria-hidden />
          </Link>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <Segmented
          ariaLabel="View mode"
          options={[
            { value: 'trending', label: 'Trending' },
            { value: 'top', label: 'Top' },
          ]}
          value={mode}
          onChange={(v) => setMode(v as Mode)}
        />
        <Segmented
          ariaLabel="Metric"
          options={(Object.keys(METRIC_LABEL) as Metric[]).map((m) => ({
            value: m,
            label: METRIC_LABEL[m],
          }))}
          value={metric}
          onChange={(v) => setMetric(v as Metric)}
        />
        <Segmented
          ariaLabel="Time window"
          options={(Object.keys(WINDOWS) as Window[]).map((w) => ({
            value: w,
            label: WINDOWS[w].label,
          }))}
          value={window}
          onChange={(v) => setWindow(v as Window)}
        />
      </div>
    </div>
  );
}

/** Expand / collapse control under the table. */
function ShowMore({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-subtle)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          width: '100%',
          padding: '0.5rem',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-medium)',
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-serif)',
          fontSize: '0.8125rem',
          cursor: 'pointer',
        }}
      >
        {expanded ? `Show top ${RESULT_COUNT}` : `Show top ${EXPANDED_COUNT}`}
      </button>
    </div>
  );
}

/**
 * Placeholder table shown on first load. Mirrors the real Row grid exactly
 * — same column template, gap, padding, row count and separators — so its
 * height matches the loaded table and the section doesn't resize when data
 * arrives. The sparkline placeholder is 24px tall (the live Sparkline's
 * height) so per-row height is identical too.
 */
function SkeletonRows({ mode, count }: { mode: Mode; count: number }) {
  // Varied nsid widths so the column reads as organic text rather than a
  // stack of identical bars.
  const nsidWidths = ['62%', '78%', '52%', '70%', '46%', '82%', '58%', '66%', '50%', '74%'];
  return (
    <ul aria-hidden style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          style={{
            borderBottom: i === count - 1 ? undefined : '1px solid var(--border-subtle)',
          }}
        >
          <div className="lexicon-row-grid">
            <Skeleton width="1.25rem" height="0.75rem" />
            {/* Mirror the NSID cell: a single bar on wide screens, two
                stacked bars on mobile (matching the head/tail two-line
                layout) so the skeleton and loaded rows keep equal heights. */}
            <span className="lexicon-row-nsid-skel">
              <Skeleton width={nsidWidths[i % nsidWidths.length]} height="0.75rem" />
              <span className="lexicon-nsid-tail-skel">
                <Skeleton width={nsidWidths[(i + 4) % nsidWidths.length]} height="0.75rem" />
              </span>
            </span>
            <span className="lexicon-row-spark">
              <Skeleton width="90px" height="24px" />
            </span>
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '0.2rem',
              }}
            >
              <Skeleton width="2.5rem" height="0.75rem" />
              {/* Trending stacks a delta under the count — mirror it so the
                  row height matches the loaded table in either mode. */}
              {mode === 'trending' && <Skeleton width="2.75rem" height="0.75rem" />}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Row({
  row,
  rank,
  mode,
  metric,
  window,
  isLast,
}: {
  row: CollectionRow;
  rank: number;
  mode: Mode;
  metric: Metric;
  window: Window;
  isLast: boolean;
}) {
  return (
    <li
      style={{
        borderBottom: isLast ? undefined : '1px solid var(--border-subtle)',
      }}
    >
      <Link
        href={schemaPathFor(row.nsid)}
        title={`Open the ${row.nsid} lexicon schema`}
        className="lexicon-row-grid"
        style={{
          textDecoration: 'none',
          color: 'var(--text-primary)',
          transition: 'background 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-tertiary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {rank.toString().padStart(2, '0')}
        </span>
        <NsidLabel nsid={row.nsid} />
        <span className="lexicon-row-spark">
          <Sparkline
            data={row.series}
            ariaLabel={`Activity over the last ${WINDOWS[window].label}`}
          />
        </span>
        {mode === 'trending' ? (
          // Trending shows both the absolute count for the window and the
          // % change vs the prior window — count on top, delta below.
          <span
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '0.2rem',
            }}
          >
            <CountValue value={row.value} metric={metric} />
            <DeltaPill pct={row.deltaPct} />
          </span>
        ) : (
          <CountValue value={row.value} metric={metric} />
        )}
      </Link>
    </li>
  );
}

/**
 * The NSID cell. On wide screens it renders as a single truncating line
 * (`app.bsky.feed.post`); on narrow screens CSS stacks the top-2-segment
 * namespace over the remainder (`app.bsky` / `feed.post`) so the whole NSID
 * stays readable instead of ellipsizing. The joining dot is a `::before` on
 * the tail so it only shows inline, not as a stray leading dot when stacked.
 */
function NsidLabel({ nsid }: { nsid: string }) {
  const { head, tail } = splitNsid(nsid);
  return (
    <span className="lexicon-row-nsid" title={nsid}>
      <span className="lexicon-nsid-head">{head}</span>
      {tail && <span className="lexicon-nsid-tail">{tail}</span>}
    </span>
  );
}

function CountValue({ value, metric }: { value: number; metric: Metric }) {
  return (
    <span
      title={`${value.toLocaleString()} ${METRIC_LABEL[metric].toLowerCase()}`}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.75rem',
        color: 'var(--text-tertiary)',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        textAlign: 'right',
      }}
    >
      {formatCount(value)}
    </span>
  );
}

// ─── NSID grouping ─────────────────────────────────────────────────────────

/**
 * Namespaces we suppress from the Trending view. Both flavors of Bluesky
 * (public app + chat) dominate every absolute ranking and barely move in
 * % terms, so they crowd out the smaller projects we want surfaced.
 */
const TRENDING_HIDDEN_PREFIXES = ['app.bsky.', 'chat.bsky.'];

/**
 * Namespaces we suppress from the Top view too. Chat collections are
 * private DM traffic — they're real activity but not interesting to
 * publish as "what's hot on the protocol". Bluesky's public namespace
 * stays in Top (it's the elephant in the room and that's accurate).
 */
const TOP_HIDDEN_PREFIXES = ['chat.'];

function hasHiddenPrefix(nsid: string, prefixes: string[]): boolean {
  return prefixes.some((p) => nsid.startsWith(p));
}

function filterAndDedup<T extends { nsid: string }>(rows: T[], mode: Mode): T[] {
  const hidden = mode === 'trending' ? TRENDING_HIDDEN_PREFIXES : TOP_HIDDEN_PREFIXES;
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (hasHiddenPrefix(r.nsid, hidden)) continue;
    const key = namespaceKey(r.nsid);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ─── Fetching ──────────────────────────────────────────────────────────────

/** Stats projected to a single metric, keyed by NSID. */
async function fetchStatsMetric(
  nsids: string[],
  sinceIso: string,
  untilIso: string,
  metric: Metric,
): Promise<Map<string, number>> {
  const stats = await fetchCollectionStats({
    collections: nsids,
    since: sinceIso,
    until: untilIso,
  });
  const out = new Map<string, number>();
  for (const [nsid, entry] of stats) out.set(nsid, statForMetric(entry, metric));
  return out;
}

/** Timeseries for one collection, projected to the metric and trimmed to
 * the window's bucket count. */
async function fetchSeries(
  collection: string,
  sinceIso: string,
  step: number,
  bucketCount: number,
  metric: Metric,
): Promise<number[]> {
  const { series } = await fetchTimeseries({ collection, since: sinceIso, step });
  const bucket = series.get(collection) || [];
  return bucket.slice(-bucketCount).map((b) => statForMetric(b, metric));
}

async function fetchRanking(
  window: Window,
  mode: Mode,
  metric: Metric,
  resultCount: number,
): Promise<CollectionRow[]> {
  const cfg = WINDOWS[window];
  const sinceIso = isoAgo(cfg.hours);

  // 1) Candidate pool. Order by whichever the API supports best for this
  //    metric; ties / unsupported orders fall back to records-created.
  const { collections: candidates, failed } = await fetchCollections({
    order: orderForMetric(metric),
    limit: resultCount * CANDIDATE_POOL_FACTOR,
    since: sinceIso,
  });

  // A real API failure must surface as an error, not an empty leaderboard.
  // Without this the swallowed failure rendered "No lexicons matched in this
  // window." as if the network were fine and there were genuinely no activity.
  if (failed) {
    throw new Error('the UFOs API is unavailable');
  }

  // 2) Filter (mode-specific) + dedup by top-2-segment namespace.
  const filtered = filterAndDedup(candidates, mode);
  if (filtered.length === 0) return [];

  // 3) Score by the chosen metric. /collections gives us creates +
  //    dids_estimate directly; updates / deletes need a stats lookup.
  const directlyAvailable = metric === 'creates' || metric === 'dids';
  const currentMap = directlyAvailable
    ? new Map(filtered.map((c) => [c.nsid, statForMetric(c, metric)]))
    : await fetchStatsMetric(
        filtered.map((c) => c.nsid),
        sinceIso,
        /* until */ new Date().toISOString(),
        metric,
      );

  if (mode === 'top') {
    const sorted = [...filtered].sort(
      (a, b) => (currentMap.get(b.nsid) ?? 0) - (currentMap.get(a.nsid) ?? 0),
    );
    const picked = sorted.slice(0, resultCount);
    const series = await Promise.all(
      picked.map((c) =>
        fetchSeries(c.nsid, sinceIso, cfg.step, cfg.bucketCount, metric),
      ),
    );
    return picked.map((c, i) => ({
      nsid: c.nsid,
      value: currentMap.get(c.nsid) ?? 0,
      series: series[i],
      deltaPct: null,
    }));
  }

  // Trending: pull prior-window metric values, compute % change.
  const priorSinceIso = isoAgo(cfg.hours * 2);
  const priorUntilIso = sinceIso;
  const priorMap = await fetchStatsMetric(
    filtered.map((c) => c.nsid),
    priorSinceIso,
    priorUntilIso,
    metric,
  );

  const withDelta = filtered.map((c) => {
    const current = currentMap.get(c.nsid) ?? 0;
    const prior = priorMap.get(c.nsid) ?? 0;
    const deltaPct = prior > 0 ? ((current - prior) / prior) * 100 : null;
    return { nsid: c.nsid, value: current, deltaPct };
  });

  // Rank by delta desc; null deltas (no prior data) sort to the back.
  const ranked = withDelta
    .sort((a, b) => {
      const ad = a.deltaPct;
      const bd = b.deltaPct;
      if (ad === null && bd === null) return 0;
      if (ad === null) return 1;
      if (bd === null) return -1;
      return bd - ad;
    })
    .slice(0, resultCount);

  const series = await Promise.all(
    ranked.map((c) =>
      fetchSeries(c.nsid, sinceIso, cfg.step, cfg.bucketCount, metric),
    ),
  );
  return ranked.map((c, i) => ({
    nsid: c.nsid,
    value: c.value,
    series: series[i],
    deltaPct: c.deltaPct,
  }));
}
