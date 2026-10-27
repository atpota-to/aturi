'use client';

import { Fragment, useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, ExternalLink } from 'lucide-react';
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
          // A stretched viewBox would otherwise stretch the stroke with it.
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

// ─── NSID ───────────────────────────────────────────────────────────────────

/**
 * An NSID with a break opportunity after every dot, so a long one wraps at a
 * segment boundary on a phone rather than being cut mid-word or ending in an
 * ellipsis that hides the one segment that tells two apart.
 */
export function Nsid({ value }: { value: string }) {
  const segments = value.split('.');
  return (
    <>
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <>
              .<wbr />
            </>
          )}
          {seg}
        </Fragment>
      ))}
    </>
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
    <div role="group" aria-label={ariaLabel} className="fn-segmented">
      {options.map(({ value: v, label }) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            onClick={() => v !== value && onChange(v)}
            aria-pressed={active}
            className="fn-segmented-option"
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
          fontFamily: 'var(--font-sans)',
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
        fontFamily: 'var(--font-sans)',
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

// ─── App site link ──────────────────────────────────────────────────────────

/**
 * Outbound button to the site a namespace's app most likely lives at (see
 * `appDomainFor`). Sized to sit beside the detail page's "View schema record"
 * button. The domain is inferred from the NSID, so the tooltip says so.
 */
export function AppSiteLink({ domain }: { domain: string }) {
  return (
    <a
      href={`https://${domain}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`${domain}, inferred from the NSID`}
      className="fn-btn"
    >
      <ExternalLink size={13} aria-hidden /> Visit {domain}
    </a>
  );
}

// ─── microcosm.blue credit ──────────────────────────────────────────────────

/**
 * `standalone` for a page's closing caption rather than a card's footer: the
 * same line without the rule and padding a footer carries, so it doesn't need
 * a card of its own to sit in.
 */
export function Credit({ standalone = false }: { standalone?: boolean }) {
  return (
    <div className={standalone ? 'fn-credit fn-credit-standalone' : 'fn-credit'}>
      <span>Data from</span>
      <a href="https://www.microcosm.blue" target="_blank" rel="noopener noreferrer">
        microcosm.blue
      </a>
    </div>
  );
}
