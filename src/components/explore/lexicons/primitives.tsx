'use client';

import { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { formatPct } from '@/utils/ufos/format';

/**
 * Shared presentational primitives for the lexicons surfaces (trending
 * strip, browse + detail pages, record-page usage card). Extracted from
 * the original TrendingLexicons so there's a single source of truth.
 */

// ─── Sparkline ───────────────────────────────────────────────────────────

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

/**
 * Minimal SVG line chart. Defaults to the 90×24 strip used in tables;
 * pass `fullWidth` for a responsive chart (e.g. the detail page) where
 * the viewBox coordinate space (`width`/`height`) drives the aspect ratio
 * and the element stretches to its container.
 */
export function Sparkline({
  data,
  width = 90,
  height = 24,
  ariaLabel = 'Activity sparkline',
  fullWidth = false,
  strokeWidth = 1.25,
}: {
  data: number[];
  width?: number;
  height?: number;
  ariaLabel?: string;
  fullWidth?: boolean;
  strokeWidth?: number;
}) {
  const path = useMemo(() => buildPath(data, width, height), [data, width, height]);
  return (
    <svg
      width={fullWidth ? undefined : width}
      height={fullWidth ? undefined : height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fullWidth ? 'none' : undefined}
      role="img"
      aria-label={ariaLabel}
      style={{ display: 'block', width: fullWidth ? '100%' : undefined, height: fullWidth ? '100%' : undefined }}
    >
      {path && (
        <path
          d={path}
          fill="none"
          stroke="var(--text-accent)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

// ─── Segmented toggle ──────────────────────────────────────────────────────

export function Segmented<T extends string>({
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

// ─── Delta pill ────────────────────────────────────────────────────────────

export function DeltaPill({ pct }: { pct: number | null }) {
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

// ─── microcosm.blue credit ──────────────────────────────────────────────────

export function Credit() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '0.4rem',
        padding: '0.625rem 1rem',
        borderTop: '1px solid var(--border-subtle)',
        fontSize: '0.7rem',
        color: 'var(--text-tertiary)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        fontFamily: 'var(--font-serif)',
      }}
    >
      <span>Data from</span>
      <a
        href="https://www.microcosm.blue"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--text-accent)', textDecoration: 'none' }}
      >
        microcosm.blue
      </a>
    </div>
  );
}
