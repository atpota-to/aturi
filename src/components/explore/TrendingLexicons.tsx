'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, BarChart3, Sparkles } from 'lucide-react';
import AppearIn from './AppearIn';

const UFOS_API = 'https://ufos-api.microcosm.blue';

type Window = '1d' | '7d' | '30d';
type Mode = 'top' | 'trending';

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

const RESULT_COUNT = 10;
/**
 * Pull more candidates than we'll display so the filter (drop app.bsky.*)
 * + dedup (one row per top-2-segment namespace) still leaves enough rows
 * to fill the table.
 */
const CANDIDATE_POOL = 50;

type CollectionRow = {
  nsid: string;
  creates: number;
  series: number[];
  /** % change vs the equivalent prior window; null when prior is 0 or unknown. */
  deltaPct: number | null;
};

/**
 * Top / Trending lexicons strip on /explore. Hits the UFOs API
 * (ufos-api.microcosm.blue) to rank collections in the chosen window,
 * filters out the Bluesky namespace (it would otherwise dominate every
 * row), and dedupes so each top-2-segment namespace contributes one row.
 *
 * Two modes:
 *   - Top: sorted by absolute creates in the window.
 *   - Trending: sorted by % change vs the prior equivalent window. Rows
 *     show the delta instead of the absolute count.
 *
 * Sparklines come from per-collection timeseries fetches.
 */
export default function TrendingLexicons() {
  const [mode, setMode] = useState<Mode>('trending');
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
        const next = await fetchRanking(window, mode);
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
  }, [window, mode]);

  return (
    <AppearIn delay={0.12}>
      <section
        style={{
          border: '1px solid var(--border-medium)',
          background: 'var(--bg-secondary)',
        }}
      >
        <Header mode={mode} setMode={setMode} window={window} setWindow={setWindow} />
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {error ? (
            <div className="explore-error" style={{ padding: '1rem' }}>
              Couldn&rsquo;t reach the UFOs API: {error}
            </div>
          ) : rows ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {rows.map((row, i) => (
                <Row
                  key={row.nsid}
                  row={row}
                  rank={i + 1}
                  mode={mode}
                  window={window}
                  isLast={i === rows.length - 1}
                />
              ))}
              {rows.length === 0 && (
                <p
                  className="explore-placeholder"
                  style={{ padding: '1rem', margin: 0 }}
                >
                  No non-Bluesky lexicons matched in this window.
                </p>
              )}
            </ul>
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
  window,
  setWindow,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  window: Window;
  setWindow: (w: Window) => void;
}) {
  const Icon = mode === 'trending' ? Sparkles : BarChart3;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        padding: '0.875rem 1rem',
        flexWrap: 'wrap',
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
      <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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
  window,
  isLast,
}: {
  row: CollectionRow;
  rank: number;
  mode: Mode;
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
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              textAlign: 'right',
            }}
          >
            {formatCount(row.creates)}
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
  if (Math.abs(pct) >= 1000) return `${sign}${pct.toFixed(0)}%`;
  if (Math.abs(pct) >= 100) return `${sign}${pct.toFixed(0)}%`;
  return `${sign}${pct.toFixed(1)}%`;
}

// ─── NSID grouping ─────────────────────────────────────────────────────────

/** Bluesky namespaces dominate every ranking; filter them out so the
 * surface highlights everything else. */
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

function filterAndDedup<T extends { nsid: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (isBluesky(r.nsid)) continue;
    const key = namespaceKey(r.nsid);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ─── Fetching ──────────────────────────────────────────────────────────────

type RawCollection = { nsid: string; creates: number; dids_estimate: number };

function isoAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function fetchRanking(window: Window, mode: Mode): Promise<CollectionRow[]> {
  const cfg = WINDOWS[window];
  const sinceIso = isoAgo(cfg.hours);

  // 1) Pull a candidate pool ranked by absolute creates in the window —
  //    bigger than RESULT_COUNT because filter + dedup will thin it.
  const ranked = await fetchTopRaw(sinceIso, CANDIDATE_POOL);
  const filtered = filterAndDedup(ranked);
  if (filtered.length === 0) return [];

  if (mode === 'top') {
    const picked = filtered.slice(0, RESULT_COUNT);
    const series = await Promise.all(
      picked.map((c) => fetchSeries(c.nsid, sinceIso, cfg.step, cfg.bucketCount)),
    );
    return picked.map((c, i) => ({
      nsid: c.nsid,
      creates: c.creates,
      series: series[i],
      deltaPct: null,
    }));
  }

  // 2) Trending — get the equivalent prior window's creates per candidate,
  //    then rank by % change. Capped at the filtered pool size so we don't
  //    hit /timeseries for collections that won't make the cut.
  const priorSinceIso = isoAgo(cfg.hours * 2);
  const priorUntilIso = sinceIso;
  const candidates = filtered.slice(0, CANDIDATE_POOL);
  const priorMap = await fetchPriorCreates(
    candidates.map((c) => c.nsid),
    priorSinceIso,
    priorUntilIso,
  );

  const withDelta = candidates.map((c) => {
    const prior = priorMap.get(c.nsid) ?? 0;
    const deltaPct = prior > 0 ? ((c.creates - prior) / prior) * 100 : null;
    return { ...c, deltaPct };
  });

  // Rank by computable delta descending; null deltas (brand-new lexicons)
  // sort to the back so the headline rows are genuine accelerations.
  const ranked2 = withDelta
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
    ranked2.map((c) => fetchSeries(c.nsid, sinceIso, cfg.step, cfg.bucketCount)),
  );
  return ranked2.map((c, i) => ({
    nsid: c.nsid,
    creates: c.creates,
    series: series[i],
    deltaPct: c.deltaPct,
  }));
}

async function fetchTopRaw(sinceIso: string, limit: number): Promise<RawCollection[]> {
  const url =
    `${UFOS_API}/collections` +
    `?order=records-created&limit=${limit}&since=${encodeURIComponent(sinceIso)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { collections?: RawCollection[] };
  return data.collections || [];
}

/** Fetch /collections/stats for several collections at once — the endpoint
 * accepts repeated `collection=` query params. Returns NSID -> creates. */
async function fetchPriorCreates(
  nsids: string[],
  sinceIso: string,
  untilIso: string,
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
    // Response is a flat { nsid: { creates, updates, deletes, dids_estimate } }
    // map, not a { collections: [...] } envelope like /collections.
    const data = (await res.json()) as Record<string, { creates?: number }>;
    const out = new Map<string, number>();
    for (const [nsid, entry] of Object.entries(data)) {
      if (entry && typeof entry === 'object') {
        out.set(nsid, entry.creates ?? 0);
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
      series?: Record<string, { creates: number }[]>;
    };
    const bucket = data.series?.[collection] || [];
    const trimmed = bucket.slice(-bucketCount);
    return trimmed.map((b) => b.creates ?? 0);
  } catch {
    return [];
  }
}
