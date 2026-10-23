'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Boxes, Users } from 'lucide-react';
import { Sparkline } from './primitives';
import { fetchCollectionStatsResult, fetchTimeseries } from '@/utils/ufos/client';
import { isoAgo, type JustCount } from '@/utils/ufos/config';
import { formatCount } from '@/utils/ufos/format';
import { lexiconPathFor } from '@/utils/ufos/nsid';

const WINDOW_HOURS = 24 * 7;
const SERIES_STEP = 60 * 60 * 12; // 12h buckets over a week

/**
 * Compact "how much is this lexicon used across the atmosphere" card for
 * the bottom of a record page. Given the record's collection NSID, pulls
 * 7-day creates / DID-estimate from the UFOs API plus a small sparkline,
 * and links into the lexicon's detail page. Renders nothing if the data
 * can't be reached so it never disrupts the record view.
 */
export default function LexiconUsageCard({ collection }: { collection: string }) {
  const [stats, setStats] = useState<JustCount | null>(null);
  const [series, setSeries] = useState<number[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setSeries([]);
    setFailed(false);

    const sinceIso = isoAgo(WINDOW_HOURS);
    (async () => {
      const [statsRes, tsRes] = await Promise.allSettled([
        // The failure-aware call: the plain one answers an outage with an
        // empty map, which read here as "0 creates · 0 repos" for even the
        // busiest lexicon in the network.
        fetchCollectionStatsResult({ collections: [collection], since: sinceIso }),
        fetchTimeseries({ collection, since: sinceIso, step: SERIES_STEP }),
      ]);
      if (cancelled) return;
      if (statsRes.status === 'rejected' || statsRes.value.failed) {
        setFailed(true);
      } else if (statsRes.value.stats.has(collection)) {
        setStats(statsRes.value.stats.get(collection)!);
      } else {
        setStats({ creates: 0, updates: 0, deletes: 0, dids_estimate: 0 });
      }
      if (tsRes.status === 'fulfilled') {
        setSeries(tsRes.value.series.get(collection)?.map((b) => b.creates) ?? []);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [collection]);

  // Total fetch failure: stay invisible rather than show a broken card.
  if (failed) return null;

  return (
    <Link
      href={lexiconPathFor(collection)}
      prefetch={false}
      title={`Explore usage of ${collection} across the atmosphere`}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '1.25rem',
        padding: '14px 16px',
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--bg-secondary)',
        textDecoration: 'none',
        color: 'var(--text-primary)',
        transition: 'background 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--surface-subtle)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-secondary)';
      }}
    >
      <span
        style={{
          flexBasis: '100%',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-accent)',
        }}
      >
        Lexicon usage · across the atmosphere · 7d
      </span>

      <Stat
        icon={<Boxes size={14} aria-hidden />}
        value={stats ? formatCount(stats.creates) : null}
        label="creates"
      />
      <Stat
        icon={<Users size={14} aria-hidden />}
        value={stats ? formatCount(stats.dids_estimate) : null}
        label="repos"
      />

      {series.some((v) => v > 0) && (
        <span style={{ width: 90, height: 24, marginLeft: 'auto' }}>
          <Sparkline data={series} ariaLabel={`${collection} activity over the last 7 days`} />
        </span>
      )}

      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.2rem',
          marginLeft: series.some((v) => v > 0) ? undefined : 'auto',
          fontSize: '0.8125rem',
          color: 'var(--text-accent)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        Explore this lexicon <ArrowUpRight size={13} aria-hidden />
      </span>
    </Link>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string | null;
  label: string;
}) {
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', lineHeight: 1 }}
      title={label}
    >
      <span style={{ color: 'var(--text-tertiary)', display: 'inline-flex' }}>{icon}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', fontWeight: 600 }}>
        {value ?? '—'}
      </span>
      <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8125rem' }}>{label}</span>
    </span>
  );
}
