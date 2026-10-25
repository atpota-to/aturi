'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppearIn from '../AppearIn';
import { Skeleton } from '@/components/SkeletonLoader';
import { DeltaPill, Segmented } from './primitives';
import { useNewLexicons, NEW_EXPANDED_COUNT, NEW_RESULT_COUNT } from './NewLexicons';
import {
  EXPANDED_COUNT,
  RESULT_COUNT,
  fetchRanking,
  type CollectionRow,
  type Mode,
} from '../TrendingLexicons';
import { METRIC_LABEL, type Metric } from '@/utils/ufos/config';
import { lexiconPathFor, schemaPathFor } from '@/utils/ufos/nsid';
import { WINDOWS, type Window } from '@/utils/ufos/windows';

/**
 * "This week in the Atmosphere" on /explore: the trending strip's Top and
 * Trending views side by side with the new-lexicons list, under one window
 * and one metric control. The full strip, with sparklines, lives on
 * /explore/lexicons, which each card's footer links to.
 */

const WINDOW_NAMES: Record<
  Window,
  { label: string; noun: string; heading: string; comparison: string }
> = {
  '1d': {
    label: 'Day',
    noun: 'day',
    heading: 'Today in the Atmosphere',
    comparison: 'yesterday → today',
  },
  '7d': {
    label: 'Week',
    noun: 'week',
    heading: 'This week in the Atmosphere',
    comparison: 'last week → this week',
  },
  '30d': {
    label: 'Month',
    noun: 'month',
    heading: 'This month in the Atmosphere',
    comparison: 'last month → this month',
  },
};

/** What each metric counts, for the card subtitles. */
const METRIC_NOUN: Record<Metric, string> = {
  dids: 'Accounts',
  creates: 'Records created',
  updates: 'Records updated',
  deletes: 'Records deleted',
};

export default function AtmospherePulse() {
  const [timeWindow, setTimeWindow] = useState<Window>('7d');
  const [metric, setMetric] = useState<Metric>('dids');
  const names = WINDOW_NAMES[timeWindow];

  return (
    <AppearIn delay={0.12}>
      <section aria-labelledby="fn-pulse-title" className="fn-pulse">
        <div className="fn-pulse-head">
          <div className="fn-pulse-heading">
            <h2 id="fn-pulse-title">{names.heading}</h2>
            <span>Lexicon activity from UFOs, compared with the {names.noun} before</span>
          </div>
          <div className="fn-pulse-controls">
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
                label: WINDOW_NAMES[w].label,
              }))}
              value={timeWindow}
              onChange={(v) => setTimeWindow(v as Window)}
            />
          </div>
        </div>
        <div className="fn-pulse-grid">
          <RankingCard mode="top" timeWindow={timeWindow} metric={metric} />
          <RankingCard mode="trending" timeWindow={timeWindow} metric={metric} />
          <NewCard timeWindow={timeWindow} />
        </div>
      </section>
    </AppearIn>
  );
}

function RankingCard({
  mode,
  timeWindow,
  metric,
}: {
  mode: Mode;
  timeWindow: Window;
  metric: Metric;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<CollectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const limit = expanded ? EXPANDED_COUNT : RESULT_COUNT;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // Previous rows stay up while a toggle refetches; the skeleton is for
    // first load only. No sparklines here, so no per-row series requests.
    fetchRanking(timeWindow, mode, metric, limit, { withSeries: false, withPrior: true })
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [timeWindow, mode, metric, limit]);

  const visible = rows ? rows.slice(0, limit) : null;
  const max = visible ? Math.max(1, ...visible.map((r) => r.value)) : 1;
  // Log scale: app.bsky.feed.like sits two orders of magnitude above the
  // rest, and a linear bar drew rows 2 to 10 as the same 2px stub.
  const scale = (v: number) => Math.log10(v + 1) / Math.log10(max + 1);
  const id = `fn-pulse-${mode}`;
  const noun = METRIC_NOUN[metric];
  const unit = noun.toLowerCase();

  return (
    <section aria-labelledby={id} className="fn-list-card fn-pulse-card">
      <div className="fn-list-card-head">
        <h3 id={id} className="fn-list-card-title">
          {mode === 'top' ? 'Most active' : 'Rising'}
        </h3>
        <span className="fn-list-card-sub">
          {mode === 'top'
            ? metric === 'dids'
              ? 'Accounts writing each lexicon'
              : `${noun} in each lexicon`
            : `${noun} ${WINDOW_NAMES[timeWindow].comparison}`}
        </span>
      </div>
      <div className="fn-list-card-body">
        {error ? (
          <div className="explore-error fn-list-card-msg">
            Couldn&rsquo;t reach the UFOs API: {error}
          </div>
        ) : visible ? (
          visible.length === 0 ? (
            <p className="explore-placeholder fn-list-card-msg">No lexicons matched in this window.</p>
          ) : (
            <ol className="fn-list-rows">
              {visible.map((row, i) => (
                <li key={row.nsid}>
                  {mode === 'top' ? (
                    <Link
                      href={schemaPathFor(row.nsid)}
                      prefetch={false}
                      title={`Open the ${row.nsid} lexicon schema`}
                      className="fn-row fn-pulse-row fn-pulse-row-ranked"
                    >
                      <span className="fn-row-rank">{i + 1}</span>
                      <span className="fn-pulse-nsid-bar">
                        <span className="fn-pulse-nsid">{row.nsid}</span>
                        <span className="fn-pulse-bar" aria-hidden title="Bar length is on a log scale">
                          <span style={{ width: `${Math.max(2, Math.round(scale(row.value) * 100))}%` }} />
                        </span>
                      </span>
                      <span className="fn-row-figures">
                        <span
                          className="fn-row-count"
                          title={`${row.value.toLocaleString()} ${unit}`}
                        >
                          {row.value.toLocaleString('en-US')}
                        </span>
                        <DeltaPill pct={row.deltaPct} />
                      </span>
                    </Link>
                  ) : (
                    <Link
                      href={schemaPathFor(row.nsid)}
                      prefetch={false}
                      title={`Open the ${row.nsid} lexicon schema`}
                      className="fn-row fn-pulse-row"
                    >
                      <span className="fn-pulse-nsid">{row.nsid}</span>
                      <span
                        className="fn-pulse-before-now"
                        title={`${(row.prior ?? 0).toLocaleString()} → ${row.value.toLocaleString()} ${unit}`}
                      >
                        <span>{(row.prior ?? 0).toLocaleString('en-US')} →</span>{' '}
                        <strong>{row.value.toLocaleString('en-US')}</strong>
                      </span>
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          )
        ) : (
          <PulseSkeleton count={limit} />
        )}
      </div>
      <CardFoot
        showToggle={!!visible && (expanded || visible.length >= RESULT_COUNT)}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        toggleLabel={expanded ? `Show top ${RESULT_COUNT}` : `Show top ${EXPANDED_COUNT}`}
        href={mode === 'top' ? '/explore/lexicons' : '/explore/lexicons#trending'}
        linkLabel={mode === 'top' ? 'All lexicons' : 'All rising lexicons'}
      />
    </section>
  );
}

function NewCard({ timeWindow }: { timeWindow: Window }) {
  const { answer, error } = useNewLexicons(timeWindow);
  const [expanded, setExpanded] = useState(false);
  const limit = expanded ? NEW_EXPANDED_COUNT : NEW_RESULT_COUNT;
  const visible = answer ? answer.lexicons.slice(0, limit) : null;
  const noun = WINDOW_NAMES[timeWindow].noun;

  return (
    <section aria-labelledby="fn-pulse-new" className="fn-list-card fn-pulse-card">
      <div className="fn-list-card-head">
        <h3 id="fn-pulse-new" className="fn-list-card-title">
          New this {noun}
        </h3>
        <span className="fn-list-card-sub">
          First seen in the last {WINDOWS[timeWindow].label}, by accounts
        </span>
      </div>
      <div className="fn-list-card-body">
        {error ? (
          <div className="explore-error fn-list-card-msg">Couldn&rsquo;t load new lexicons: {error}</div>
        ) : visible ? (
          visible.length === 0 ? (
            <p className="explore-placeholder fn-list-card-msg">
              Nothing new with three or more accounts in this window.
            </p>
          ) : (
            <ol className="fn-list-rows">
              {visible.map((lexicon) => (
                <li key={lexicon.nsid}>
                  <Link
                    href={lexiconPathFor(lexicon.nsid)}
                    prefetch={false}
                    title={`Open ${lexicon.nsid} in the lexicons explorer`}
                    className="fn-row fn-pulse-row"
                  >
                    <span className="fn-pulse-nsid">{lexicon.nsid}</span>
                    <span
                      className="fn-row-count"
                      title={`${lexicon.didsEstimate.toLocaleString()} accounts, ${lexicon.creates.toLocaleString()} records`}
                    >
                      {lexicon.didsEstimate.toLocaleString('en-US')}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )
        ) : (
          <PulseSkeleton count={NEW_RESULT_COUNT} />
        )}
      </div>
      <CardFoot
        showToggle={!!answer && answer.count > NEW_RESULT_COUNT}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        toggleLabel={
          expanded
            ? `Show ${NEW_RESULT_COUNT}`
            : `Show ${Math.min(answer?.count ?? 0, NEW_EXPANDED_COUNT)} of ${answer?.count ?? 0}`
        }
        href="/explore/lexicons#new"
        linkLabel="All new lexicons"
      />
    </section>
  );
}

/** Card footer: the "All …" link, beside the show-more toggle when there is more to show. */
function CardFoot({
  showToggle,
  expanded,
  onToggle,
  toggleLabel,
  href,
  linkLabel,
}: {
  showToggle: boolean;
  expanded: boolean;
  onToggle: () => void;
  toggleLabel: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="fn-pulse-foot">
      {showToggle && (
        <button type="button" onClick={onToggle} aria-expanded={expanded}>
          {toggleLabel}
        </button>
      )}
      <Link href={href}>{linkLabel}</Link>
    </div>
  );
}

function PulseSkeleton({ count }: { count: number }) {
  const widths = ['62%', '78%', '52%', '70%', '46%', '82%', '58%', '66%', '50%', '74%'];
  return (
    <ol aria-hidden className="fn-list-rows">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}>
          <div className="fn-pulse-row">
            <span style={{ flex: 1, minWidth: 0 }}>
              <Skeleton width={widths[i % widths.length]} height="0.75rem" />
            </span>
            <Skeleton width="3rem" height="0.75rem" />
          </div>
        </li>
      ))}
    </ol>
  );
}
