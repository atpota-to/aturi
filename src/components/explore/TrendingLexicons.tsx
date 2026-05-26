'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, BarChart3, Sparkles } from 'lucide-react';
import AppearIn from './AppearIn';

const UFOS_API = 'https://ufos-api.microcosm.blue';

type Window = '1d' | '7d' | '30d';
type Mode = 'top' | 'trending';
type Metric = 'creates' | 'updates' | 'deletes' | 'dids';

type WindowConfig = {
  label: string;
  hours: number;
  step: number;
  bucketCount: number;
};

const WINDOWS: Record<Window, WindowConfig> = {
  '1d': { label: '1d', hours: 24, step: 60 * 60 * 2, bucketCount: 12 },
  '7d': { label: '7d', hours: 24 * 7, step: 60 * 60 * 12, bucketCount: 14 },
  '30d': { label: '30d', hours: 24 * 30, step: 60 * 60 * 24, bucketCount: 30 },
};

const METRIC_LABEL: Record<Metric, string> = {
  creates: 'Creates',
  updates: 'Updates',
  deletes: 'Deletes',
  dids: 'DIDs',
};

const RESULT_COUNT = 10;
/**
 * Pull more candidates than we'll display so the filter (drop app.bsky.*
 * in trending) + dedup (one row per top-2-segment namespace) still leaves
 * enough rows to fill the table.
 */
const CANDIDATE_POOL = 50;

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
export default function TrendingLexicons() {
  const [mode, setMode] = useState<Mode>('trending');
  const [metric, setMetric] = useState<Metric>('dids');
  const [window, setWindow] = useState<Window>('7d');
  const [rows, setRows] = useState<CollectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const next = await fetchRanking(window, mode, metric);
        if (!cancelled) setRows(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [window, mode, metric]);

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
        />
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {error ? (
            <div className="explore-error" style={{ padding: '1rem' }}>
              Couldn&rsquo;t reach the UFOs API: {error}
            </div>
          ) : rows ? (
            rows.length === 0 ? (
              <p
                className="explore-placeholder"
                style={{ padding: '1rem', margin: 0 }}
              >
                {mode === 'trending'
                  ? 'No non-Bluesky lexicons matched in this window.'
                  : 'No lexicons matched in this window.'}
              </p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {rows.map((row, i) => (
                  <Row
                    key={row.nsid}
                    row={row}
                    rank={i + 1}
                    mode={mode}
                    metric={metric}
                    window={window}
                    isLast={i === rows.length - 1}
                  />
                ))}
              </ul>
            )
          ) : loading ? (
            <p
              className="explore-placeholder"
              style={{ padding: '1rem', margin: 0 }}
            >
              Loading {mode} lexicons…
            </p>
          ) : null}
        </div>
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
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  metric: Metric;
  setMetric: (m: Metric) => void;
  window: Window;
  setWindow: (w: Window) => void;
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

function Segmented<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-tertiary)',
        padding: '2px',
      }}
    >
      {options.map(({ value: v, label }) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            onClick={() => v !== value && onChange(v)}
            aria-pressed={active}
            style={{
              padding: '0.3rem 0.7rem',
              background: active ? 'var(--accent-moss)' : 'transparent',
              color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
              border: 0,
              fontFamily: 'var(--font-serif)',
              fontSize: '0.8125rem',
              cursor: active ? 'default' : 'pointer',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
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
        href={`/at/${row.nsid}`}
        title={`Browse ${row.nsid}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '2rem minmax(0, 1fr) 7rem auto',
          alignItems: 'center',
          gap: '0.875rem',
          padding: '0.625rem 1rem',
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
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8125rem',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {row.nsid}
        </span>
        <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Sparkline data={row.series} window={window} />
        </span>
        {mode === 'trending' ? (
          <DeltaPill pct={row.deltaPct} />
        ) : (
          <span
            title={`${row.value.toLocaleString()} ${METRIC_LABEL[metric].toLowerCase()}`}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              textAlign: 'right',
            }}
          >
            {formatCount(row.value)}
          </span>
        )}
      </Link>
    </li>
  );
}

function DeltaPill({ pct }: { pct: number | null }) {
  if (pct === null || !isFinite(pct)) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.75rem',
          color: 'var(--text-tertiary)',
          textAlign: 'right',
        }}
      >
        new
      </span>
    );
  }
  const positive = pct >= 0;
  const Arrow = positive ? ArrowUpRight : ArrowDownRight;
  const color = positive ? 'var(--text-accent)' : 'var(--danger)';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '0.25rem',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.75rem',
        color,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      <Arrow size={11} aria-hidden />
      {formatPct(pct)}
    </span>
  );
}

function Sparkline({ data, window }: { data: number[]; window: Window }) {
  const width = 90;
  const height = 24;
  const path = useMemo(() => buildPath(data, width, height), [data]);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Activity over the last ${WINDOWS[window].label}`}
      style={{ display: 'block' }}
    >
      {path && (
        <path
          d={path}
          fill="none"
          stroke="var(--text-accent)"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function buildPath(data: number[], w: number, h: number): string | null {
  if (data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = data.length > 1 ? w / (data.length - 1) : 0;
  const pad = 2;
  const useable = h - pad * 2;
  return data
    .map((v, i) => {
      const x = i * stepX;
      const y = pad + useable - ((v - min) / span) * useable;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatPct(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  if (Math.abs(pct) >= 100) return `${sign}${pct.toFixed(0)}%`;
  return `${sign}${pct.toFixed(1)}%`;
}

// ─── NSID grouping ─────────────────────────────────────────────────────────

function isBluesky(nsid: string): boolean {
  return nsid.startsWith('app.bsky.');
}

/** First two segments — `app.bsky.feed.post` -> `app.bsky`. Single-segment
 * NSIDs return the whole NSID. */
function namespaceKey(nsid: string): string {
  const parts = nsid.split('.');
  if (parts.length <= 2) return nsid;
  return `${parts[0]}.${parts[1]}`;
}

function filterAndDedup<T extends { nsid: string }>(
  rows: T[],
  dropBluesky: boolean,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (dropBluesky && isBluesky(r.nsid)) continue;
    const key = namespaceKey(r.nsid);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ─── Fetching ──────────────────────────────────────────────────────────────

type RawCollection = {
  nsid: string;
  creates: number;
  updates: number;
  deletes: number;
  dids_estimate: number;
};

type MetricStats = {
  creates: number;
  updates: number;
  deletes: number;
  dids_estimate: number;
};

function isoAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/** /collections only supports two sort orders. Pick the closest to the
 * chosen metric so the candidate pool is well-aligned; deletes / updates
 * fall back to records-created since the API can't sort by them. */
function orderForMetric(metric: Metric): 'records-created' | 'dids-estimate' {
  return metric === 'dids' ? 'dids-estimate' : 'records-created';
}

function statForMetric(s: MetricStats, metric: Metric): number {
  if (metric === 'creates') return s.creates ?? 0;
  if (metric === 'updates') return s.updates ?? 0;
  if (metric === 'deletes') return s.deletes ?? 0;
  return s.dids_estimate ?? 0;
}

async function fetchRanking(
  window: Window,
  mode: Mode,
  metric: Metric,
): Promise<CollectionRow[]> {
  const cfg = WINDOWS[window];
  const sinceIso = isoAgo(cfg.hours);

  // 1) Candidate pool. Order by whichever the API supports best for this
  //    metric; ties / unsupported orders fall back to records-created.
  const candidates = await fetchTopRaw(
    sinceIso,
    CANDIDATE_POOL,
    orderForMetric(metric),
  );

  // 2) Filter (bsky dropped only in trending) + dedup by top-2-segment ns.
  const filtered = filterAndDedup(candidates, mode === 'trending');
  if (filtered.length === 0) return [];

  // 3) Score by the chosen metric. /collections gives us creates +
  //    dids_estimate directly; updates / deletes need a stats lookup.
  const directlyAvailable = metric === 'creates' || metric === 'dids';
  const currentMap = directlyAvailable
    ? new Map(filtered.map((c) => [c.nsid, statForMetric(c, metric)]))
    : await fetchStats(
        filtered.map((c) => c.nsid),
        sinceIso,
        /* until */ new Date().toISOString(),
        metric,
      );

  if (mode === 'top') {
    const sorted = [...filtered].sort(
      (a, b) => (currentMap.get(b.nsid) ?? 0) - (currentMap.get(a.nsid) ?? 0),
    );
    const picked = sorted.slice(0, RESULT_COUNT);
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
  const priorMap = await fetchStats(
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
    .slice(0, RESULT_COUNT);

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

async function fetchTopRaw(
  sinceIso: string,
  limit: number,
  order: 'records-created' | 'dids-estimate',
): Promise<RawCollection[]> {
  const url =
    `${UFOS_API}/collections` +
    `?order=${order}&limit=${limit}&since=${encodeURIComponent(sinceIso)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { collections?: RawCollection[] };
  return data.collections || [];
}

/** /collections/stats returns a flat { nsid: { creates, updates, deletes,
 * dids_estimate } } map. Pick the metric we care about and project. */
async function fetchStats(
  nsids: string[],
  sinceIso: string,
  untilIso: string,
  metric: Metric,
): Promise<Map<string, number>> {
  if (nsids.length === 0) return new Map();
  const params = new URLSearchParams();
  for (const n of nsids) params.append('collection', n);
  params.set('since', sinceIso);
  params.set('until', untilIso);
  try {
    const res = await fetch(`${UFOS_API}/collections/stats?${params.toString()}`, {
      cache: 'no-store',
    });
    if (!res.ok) return new Map();
    const data = (await res.json()) as Record<string, Partial<MetricStats>>;
    const out = new Map<string, number>();
    for (const [nsid, entry] of Object.entries(data)) {
      if (entry && typeof entry === 'object') {
        out.set(nsid, statForMetric(entry as MetricStats, metric));
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

async function fetchSeries(
  collection: string,
  sinceIso: string,
  step: number,
  bucketCount: number,
  metric: Metric,
): Promise<number[]> {
  const url =
    `${UFOS_API}/timeseries` +
    `?collection=${encodeURIComponent(collection)}` +
    `&since=${encodeURIComponent(sinceIso)}` +
    `&step=${step}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      series?: Record<string, MetricStats[]>;
    };
    const bucket = data.series?.[collection] || [];
    const trimmed = bucket.slice(-bucketCount);
    return trimmed.map((b) => statForMetric(b, metric));
  } catch {
    return [];
  }
}
