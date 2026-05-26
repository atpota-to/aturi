'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TrendingUp } from 'lucide-react';
import AppearIn from './AppearIn';

const UFOS_API = 'https://ufos-api.microcosm.blue';

type Window = '1d' | '7d' | '30d';

type WindowConfig = {
  label: string;
  /** Hours covered, used to build `since` ISO. */
  hours: number;
  /** Step in seconds for the timeseries — sized so each window renders
   *  ~10-30 sparkline buckets. */
  step: number;
  /** Number of trailing buckets to keep on the chart. */
  bucketCount: number;
};

const WINDOWS: Record<Window, WindowConfig> = {
  '1d': { label: '1d', hours: 24, step: 60 * 60 * 2, bucketCount: 12 },
  '7d': { label: '7d', hours: 24 * 7, step: 60 * 60 * 12, bucketCount: 14 },
  '30d': { label: '30d', hours: 24 * 30, step: 60 * 60 * 24, bucketCount: 30 },
};

type CollectionRow = {
  nsid: string;
  creates: number;
  dids_estimate: number;
  /** Bucketed creates for the sparkline. Length matches WINDOWS[window].bucketCount. */
  series: number[];
};

/**
 * Trending / top lexicons strip on /explore. Hits the UFOs API
 * (ufos-api.microcosm.blue) to rank collections by `creates` in the
 * chosen window, then fetches a per-collection timeseries to render
 * a sparkline next to each row.
 *
 * One toggle row (1d / 7d / 30d) re-fetches both the ranking and the
 * sparklines. Each fetch is independent; the previous window's data
 * stays on-screen while the new one loads so the layout doesn't
 * collapse.
 */
export default function TrendingLexicons() {
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
        const next = await fetchTrending(window);
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
  }, [window]);

  return (
    <AppearIn delay={0.12}>
      <section
        style={{
          border: '1px solid var(--border-medium)',
          background: 'var(--bg-secondary)',
        }}
      >
        <Header window={window} setWindow={setWindow} />
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {error ? (
            <div className="explore-error" style={{ padding: '1rem' }}>
              Couldn&rsquo;t reach the trending API: {error}
            </div>
          ) : rows ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {rows.map((row, i) => (
                <Row
                  key={row.nsid}
                  row={row}
                  rank={i + 1}
                  window={window}
                  isLast={i === rows.length - 1}
                />
              ))}
            </ul>
          ) : loading ? (
            <p className="explore-placeholder" style={{ padding: '1rem' }}>
              Loading trending lexicons…
            </p>
          ) : null}
        </div>
      </section>
    </AppearIn>
  );
}

function Header({
  window,
  setWindow,
}: {
  window: Window;
  setWindow: (w: Window) => void;
}) {
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
        <TrendingUp size={14} aria-hidden style={{ color: 'var(--text-accent)' }} />
        Trending lexicons
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
        role="group"
        aria-label="Time window"
        style={{
          display: 'inline-flex',
          border: '1px solid var(--border-medium)',
          background: 'var(--bg-tertiary)',
          padding: '2px',
        }}
      >
        {(Object.keys(WINDOWS) as Window[]).map((w) => {
          const active = w === window;
          return (
            <button
              key={w}
              type="button"
              onClick={() => w !== window && setWindow(w)}
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
              {WINDOWS[w].label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Row({
  row,
  rank,
  window,
  isLast,
}: {
  row: CollectionRow;
  rank: number;
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
      </Link>
    </li>
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

// ─── Fetching ──────────────────────────────────────────────────────────────

const TOP_N = 10;

async function fetchTrending(window: Window): Promise<CollectionRow[]> {
  const cfg = WINDOWS[window];
  const sinceIso = new Date(Date.now() - cfg.hours * 60 * 60 * 1000).toISOString();

  // Step 1: rank collections by creates in the window.
  const url =
    `${UFOS_API}/collections` +
    `?order=records-created&limit=${TOP_N}&since=${encodeURIComponent(sinceIso)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    collections?: { nsid: string; creates: number; dids_estimate: number }[];
  };
  const top = data.collections || [];

  // Step 2: timeseries per collection. Fetched in parallel; failures
  // leave that row with an empty series rather than dropping it.
  const series = await Promise.all(
    top.map((c) => fetchSeries(c.nsid, sinceIso, cfg.step, cfg.bucketCount)),
  );

  return top.map((c, i) => ({
    nsid: c.nsid,
    creates: c.creates,
    dids_estimate: c.dids_estimate,
    series: series[i],
  }));
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
