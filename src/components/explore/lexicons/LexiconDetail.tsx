'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileText, GitBranch, Layers } from 'lucide-react';
import AppearIn from '../AppearIn';
import { Skeleton } from '@/components/SkeletonLoader';
import { Credit, DeltaPill, Segmented, Sparkline } from './primitives';
import {
  fetchCollectionStats,
  fetchPrefix,
  fetchRecentRecords,
  fetchTimeseries,
} from '@/utils/ufos/client';
import {
  isoAgo,
  METRIC_LABEL,
  statForMetric,
  type ApiRecord,
  type JustCount,
  type Metric,
  type PrefixChildCollection,
} from '@/utils/ufos/config';
import { formatCount } from '@/utils/ufos/format';
import {
  groupPrefix,
  lexiconPathFor,
  namespaceKey,
  publisherForNsid,
  schemaPathFor,
} from '@/utils/ufos/nsid';
import { WINDOWS, type Window } from '@/utils/ufos/windows';
import { explorePathFromAtUri, shortDid } from '@/utils/atproto/urls';

const METRIC_ORDER: Metric[] = ['creates', 'updates', 'deletes', 'dids'];
const SIBLING_LIMIT = 10;
const SAMPLE_LIMIT = 8;

/**
 * Per-lexicon detail page (`/explore/lexicons/[nsid]`). Surfaces, for one
 * collection NSID: headline stats (with deltas vs the prior window), a
 * timeseries trend chart, sibling collections in the same lexicon group,
 * and recent record samples — all from the UFOs API. Renders for any
 * string; unknown NSIDs simply show empty states rather than erroring.
 */
export default function LexiconDetail({ nsid }: { nsid: string }) {
  const [window, setWindow] = useState<Window>('7d');
  const [metric, setMetric] = useState<Metric>('creates');

  // Window-dependent: current + prior stats and timeseries buckets.
  const [current, setCurrent] = useState<JustCount | null>(null);
  const [prior, setPrior] = useState<JustCount | null>(null);
  const [buckets, setBuckets] = useState<JustCount[] | null>(null);

  // NSID-only: siblings + recent samples.
  const [siblings, setSiblings] = useState<PrefixChildCollection[] | null>(null);
  const [samples, setSamples] = useState<ApiRecord[] | null>(null);

  const cfg = WINDOWS[window];

  // Stats + timeseries — refetch on nsid/window. Previous values stay
  // visible until the new ones land (no skeleton flash on toggle).
  useEffect(() => {
    let cancelled = false;
    const sinceIso = isoAgo(cfg.hours);
    const nowIso = new Date().toISOString();
    const priorSinceIso = isoAgo(cfg.hours * 2);

    (async () => {
      const [curRes, priorRes, tsRes] = await Promise.allSettled([
        fetchCollectionStats({ collections: [nsid], since: sinceIso, until: nowIso }),
        fetchCollectionStats({ collections: [nsid], since: priorSinceIso, until: sinceIso }),
        fetchTimeseries({ collection: nsid, since: sinceIso, step: cfg.step }),
      ]);
      if (cancelled) return;
      setCurrent(curRes.status === 'fulfilled' ? curRes.value.get(nsid) ?? ZERO : ZERO);
      setPrior(priorRes.status === 'fulfilled' ? priorRes.value.get(nsid) ?? ZERO : ZERO);
      setBuckets(tsRes.status === 'fulfilled' ? tsRes.value.series.get(nsid) ?? [] : []);
    })();

    return () => {
      cancelled = true;
    };
  }, [nsid, cfg.hours, cfg.step]);

  // Siblings + samples — refetch on nsid only.
  useEffect(() => {
    let cancelled = false;
    setSiblings(null);
    setSamples(null);

    // /prefix needs a 2+ segment group prefix (single-segment 400s) and
    // 500s when an `order` is passed, so we omit order and rank the
    // children client-side.
    const prefix = groupPrefix(nsid);
    (async () => {
      const [prefixRes, recordsRes] = await Promise.allSettled([
        prefix.includes('.')
          ? fetchPrefix({ prefix })
          : Promise.resolve({ children: [], cursor: null, total: ZERO }),
        fetchRecentRecords([nsid]),
      ]);
      if (cancelled) return;
      if (prefixRes.status === 'fulfilled') {
        const collections = prefixRes.value.children.filter(
          (c): c is PrefixChildCollection => c.type === 'collection' && c.nsid !== nsid,
        );
        collections.sort((a, b) => b.creates - a.creates);
        setSiblings(collections.slice(0, SIBLING_LIMIT));
      } else {
        setSiblings([]);
      }
      setSamples(recordsRes.status === 'fulfilled' ? recordsRes.value : []);
    })();

    return () => {
      cancelled = true;
    };
  }, [nsid]);

  const series = useMemo(
    () => (buckets ? buckets.map((b) => statForMetric(b, metric)) : []),
    [buckets, metric],
  );

  const publisher = publisherForNsid(nsid);
  const group = namespaceKey(nsid);
  const hasActivity = current ? statTotal(current) > 0 : true;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <AppearIn rise>
        <Link
          href="/explore/lexicons"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            fontSize: '0.8125rem',
            color: 'var(--text-accent)',
            textDecoration: 'none',
            fontFamily: 'var(--font-serif)',
          }}
        >
          <ArrowLeft size={13} aria-hidden /> All lexicons
        </Link>
      </AppearIn>

      {/* Header card */}
      <AppearIn delay={0.04}>
        <div
          style={{
            border: '1px solid var(--border-medium)',
            background: 'var(--bg-secondary)',
            padding: '1.25rem 1.25rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
          }}
        >
          <div className="explore-small-caps" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <Layers size={13} aria-hidden style={{ color: 'var(--text-accent)' }} />
            Lexicon
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: '1.35rem',
              fontWeight: 500,
              color: 'var(--text-primary)',
              wordBreak: 'break-word',
              lineHeight: 1.2,
            }}
          >
            {nsid}
          </h1>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem 1.25rem',
              alignItems: 'center',
              fontSize: '0.8125rem',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span>
              group{' '}
              <span style={{ color: 'var(--text-secondary)' }}>{group}</span>
            </span>
            <span>
              publisher{' '}
              <span style={{ color: 'var(--text-secondary)' }}>{publisher}</span>
            </span>
          </div>
          <Link
            href={schemaPathFor(nsid)}
            style={{
              alignSelf: 'flex-start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              marginTop: '0.15rem',
              padding: '0.4rem 0.75rem',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.8125rem',
              textDecoration: 'none',
            }}
          >
            <FileText size={12} aria-hidden /> View schema record
          </Link>
        </div>
      </AppearIn>

      {/* Window toggle */}
      <AppearIn delay={0.06}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Segmented
            ariaLabel="Time window"
            options={(Object.keys(WINDOWS) as Window[]).map((w) => ({
              value: w,
              label: WINDOWS[w].label,
            }))}
            value={window}
            onChange={setWindow}
          />
        </div>
      </AppearIn>

      {/* Stat tiles */}
      <AppearIn delay={0.08}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))',
            gap: '1px',
            background: 'var(--border-subtle)',
            border: '1px solid var(--border-medium)',
          }}
        >
          {METRIC_ORDER.map((m) => (
            <StatTile
              key={m}
              label={METRIC_LABEL[m]}
              current={current ? statForMetric(current, m) : null}
              prior={prior ? statForMetric(prior, m) : null}
            />
          ))}
        </div>
      </AppearIn>

      {/* Trend chart */}
      <AppearIn delay={0.1}>
        <div
          style={{
            border: '1px solid var(--border-medium)',
            background: 'var(--bg-secondary)',
            padding: '1rem 1.25rem 1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.875rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span className="explore-small-caps">
              {METRIC_LABEL[metric]} over the last {cfg.label}
            </span>
            <Segmented
              ariaLabel="Metric"
              options={METRIC_ORDER.map((m) => ({ value: m, label: METRIC_LABEL[m] }))}
              value={metric}
              onChange={setMetric}
            />
          </div>
          <div style={{ height: 120, width: '100%' }}>
            {buckets === null ? (
              <Skeleton width="100%" height="120px" />
            ) : series.some((v) => v > 0) ? (
              <Sparkline
                data={series}
                width={600}
                height={120}
                fullWidth
                strokeWidth={2}
                ariaLabel={`${METRIC_LABEL[metric]} over the last ${cfg.label}`}
              />
            ) : (
              <p className="explore-placeholder" style={{ height: '100%', display: 'flex', alignItems: 'center' }}>
                No recorded activity in this window.
              </p>
            )}
          </div>
        </div>
      </AppearIn>

      {!hasActivity && current && (
        <p className="explore-muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          No recorded activity for this lexicon in the last {cfg.label}.
        </p>
      )}

      {/* Sibling collections */}
      <AppearIn delay={0.12}>
        <Section title="Collections in this group" icon={<GitBranch size={13} aria-hidden />}>
          {siblings === null ? (
            <SkeletonList rows={4} />
          ) : siblings.length === 0 ? (
            <p className="explore-placeholder" style={{ margin: 0 }}>
              No sibling collections found in {groupPrefix(nsid)}.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {siblings.map((c, i) => (
                <li
                  key={c.nsid}
                  style={{
                    borderBottom:
                      i === siblings.length - 1 ? undefined : '1px solid var(--border-subtle)',
                  }}
                >
                  <Link
                    href={lexiconPathFor(c.nsid)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
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
                        fontSize: '0.8125rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.nsid}
                    </span>
                    <span
                      title={`${c.creates.toLocaleString()} creates`}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.75rem',
                        color: 'var(--text-tertiary)',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatCount(c.creates)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </AppearIn>

      {/* Recent samples */}
      <AppearIn delay={0.14}>
        <Section title="Recent records" icon={<FileText size={13} aria-hidden />}>
          {samples === null ? (
            <SkeletonList rows={5} />
          ) : samples.length === 0 ? (
            <p className="explore-placeholder" style={{ margin: 0 }}>
              No recent records sampled for this lexicon.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {samples.slice(0, SAMPLE_LIMIT).map((r, i) => {
                const href = explorePathFromAtUri(
                  `at://${r.did}/${r.collection}/${r.rkey}`,
                );
                const inner = (
                  <>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.75rem',
                        color: 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {shortDid(r.did)}
                      <span style={{ color: 'var(--text-tertiary)' }}> / {r.rkey}</span>
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.7rem',
                        color: 'var(--text-tertiary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {relativeTime(r.time_us / 1000)}
                    </span>
                  </>
                );
                const rowStyle: React.CSSProperties = {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.875rem',
                  padding: '0.55rem 1rem',
                  textDecoration: 'none',
                  color: 'var(--text-primary)',
                  transition: 'background 0.2s ease',
                };
                return (
                  <li
                    key={`${r.did}-${r.rkey}-${i}`}
                    style={{
                      borderBottom:
                        i === Math.min(samples.length, SAMPLE_LIMIT) - 1
                          ? undefined
                          : '1px solid var(--border-subtle)',
                    }}
                  >
                    {href ? (
                      <Link
                        href={href}
                        style={rowStyle}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--bg-tertiary)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div style={rowStyle}>{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </AppearIn>

      <AppearIn delay={0.16}>
        <div style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)' }}>
          <Credit />
        </div>
      </AppearIn>
    </div>
  );
}

const ZERO: JustCount = { creates: 0, updates: 0, deletes: 0, dids_estimate: 0 };

function statTotal(s: JustCount): number {
  return s.creates + s.updates + s.deletes + s.dids_estimate;
}

function StatTile({
  label,
  current,
  prior,
}: {
  label: string;
  current: number | null;
  prior: number | null;
}) {
  const deltaPct =
    current != null && prior != null && prior > 0
      ? ((current - prior) / prior) * 100
      : null;
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        padding: '0.875rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
      }}
    >
      <span className="explore-small-caps">{label}</span>
      <span
        title={current != null ? current.toLocaleString() : undefined}
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: '1.35rem',
          color: 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
        }}
      >
        {current == null ? (
          <Skeleton width="3rem" height="1.1rem" />
        ) : (
          formatCount(current)
        )}
      </span>
      {current != null && deltaPct != null && (
        <span style={{ display: 'inline-flex' }}>
          <DeltaPill pct={deltaPct} />
        </span>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--border-subtle)',
        }}
        className="explore-small-caps"
      >
        <span style={{ color: 'var(--text-accent)', display: 'inline-flex' }}>{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function SkeletonList({ rows }: { rows: number }) {
  return (
    <ul aria-hidden style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <li
          key={i}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '0.625rem 1rem',
            borderBottom: i === rows - 1 ? undefined : '1px solid var(--border-subtle)',
          }}
        >
          <Skeleton width={`${50 + ((i * 7) % 30)}%`} height="0.75rem" />
          <Skeleton width="2.5rem" height="0.75rem" />
        </li>
      ))}
    </ul>
  );
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (!isFinite(diff) || diff < 0) return 'just now';
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
