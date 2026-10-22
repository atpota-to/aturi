'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileText, GitBranch, Layers } from 'lucide-react';
import AppearIn from '../AppearIn';
import { useChromeBarField } from '../ChromeBarContext';
import { Skeleton } from '@/components/SkeletonLoader';
import { AppSiteLink, Credit, DeltaPill, Segmented, Sparkline } from './primitives';
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
  appDomainFor,
  groupPathFor,
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
  const router = useRouter();
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

  // There's no list to narrow on this page, so the bottom chrome bar keeps
  // offering the section's own action: search for another lexicon. Routes
  // through the group page, which resolves a namespace, a free-text term, or
  // a full NSID that turns out to have nothing published under it.
  const [search, setSearch] = useState('');
  useChromeBarField({
    placeholder: 'Search lexicons…',
    label: 'Search lexicons',
    value: search,
    onChange: setSearch,
    onSubmit: () => {
      const trimmed = search.trim();
      if (trimmed) router.push(groupPathFor(trimmed));
    },
  });

  const publisher = publisherForNsid(nsid);
  const group = namespaceKey(nsid);
  const appDomain = appDomainFor(groupPrefix(nsid));
  const hasActivity = current ? statTotal(current) > 0 : true;

  return (
    <div className="fn-lexdetail">
      <AppearIn rise>
        <Link href="/explore/lexicons" className="fn-backlink">
          <ArrowLeft size={14} aria-hidden /> All lexicons
        </Link>
      </AppearIn>

      {/* Header card */}
      <AppearIn delay={0.04}>
        <div className="fn-lexhead">
          <span className="fn-kicker fn-lexhead-kicker">
            <Layers size={13} aria-hidden />
            Lexicon
          </span>
          <h1 className="fn-lexhead-title fn-lexhead-mono">{nsid}</h1>
          <div className="fn-lexhead-meta">
            <span>
              group{' '}
              <Link href={groupPathFor(group)} prefetch={false}>
                {group}
              </Link>
            </span>
            <span>
              publisher <strong>{publisher}</strong>
            </span>
          </div>
          <div className="fn-lexhead-actions">
            <Link href={schemaPathFor(nsid)} prefetch={false} className="fn-btn">
              <FileText size={13} aria-hidden /> View schema record
            </Link>
            {appDomain && <AppSiteLink domain={appDomain} />}
          </div>
        </div>
      </AppearIn>

      {/* Window toggle */}
      <AppearIn delay={0.06}>
        <div className="fn-lexdetail-window">
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
        <div className="fn-stat-grid">
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
        <div className="fn-list-card fn-chart-card">
          <div className="fn-chart-head">
            <h2 className="fn-list-card-title">
              {METRIC_LABEL[metric]} over the last {cfg.label}
            </h2>
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
        <Section title="Collections in this group" icon={<GitBranch size={14} aria-hidden />}>
          {siblings === null ? (
            <SkeletonList rows={4} />
          ) : siblings.length === 0 ? (
            <p className="explore-placeholder fn-list-card-msg">
              No sibling collections found in {groupPrefix(nsid)}.
            </p>
          ) : (
            <ul className="fn-list-rows">
              {siblings.map((c) => (
                <li key={c.nsid}>
                  <Link href={lexiconPathFor(c.nsid)} prefetch={false} className="fn-row fn-browse-grid">
                    <span className="fn-row-nsid">{c.nsid}</span>
                    <span className="fn-row-count" title={`${c.creates.toLocaleString()} creates`}>
                      {formatCount(c.creates)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {siblings && siblings.length > 0 && groupPrefix(nsid).includes('.') && (
            <Link href={groupPathFor(groupPrefix(nsid))} prefetch={false} className="fn-list-card-foot">
              Browse all of {groupPrefix(nsid)} →
            </Link>
          )}
        </Section>
      </AppearIn>

      {/* Recent samples */}
      <AppearIn delay={0.14}>
        <Section title="Recent records" icon={<FileText size={14} aria-hidden />}>
          {samples === null ? (
            <SkeletonList rows={5} />
          ) : samples.length === 0 ? (
            <p className="explore-placeholder fn-list-card-msg">
              No recent records sampled for this lexicon.
            </p>
          ) : (
            <ul className="fn-list-rows">
              {samples.slice(0, SAMPLE_LIMIT).map((r, i) => {
                const href = explorePathFromAtUri(
                  `at://${r.did}/${r.collection}/${r.rkey}`,
                );
                const inner = (
                  <>
                    <span className="fn-row-nsid">
                      {shortDid(r.did)}
                      <span style={{ color: 'var(--text-tertiary)' }}> / {r.rkey}</span>
                    </span>
                    <span className="fn-row-time">{relativeTime(r.time_us / 1000)}</span>
                  </>
                );
                return (
                  <li key={`${r.did}-${r.rkey}-${i}`}>
                    {href ? (
                      <Link href={href} prefetch={false} className="fn-row fn-sample-row">
                        {inner}
                      </Link>
                    ) : (
                      <div className="fn-sample-row">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </AppearIn>

      <AppearIn delay={0.16}>
        <div className="fn-list-card">
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
    <div className="fn-stat">
      <span className="fn-stat-label">{label}</span>
      <span
        className="fn-stat-value"
        title={current != null ? current.toLocaleString() : undefined}
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
    <section className="fn-list-card">
      <div className="fn-list-card-head">
        <div className="fn-list-card-title-row">
          <span className="fn-list-card-icon" aria-hidden>
            {icon}
          </span>
          <h2 className="fn-list-card-title">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function SkeletonList({ rows }: { rows: number }) {
  return (
    <ul aria-hidden className="fn-list-rows">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="fn-sample-row">
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
