'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ExternalLink, Square, X } from 'lucide-react';
import LexiconFavicon from '@/components/explore/tabs/LexiconFavicon';
import { Nsid, Segmented } from '@/components/explore/lexicons/primitives';
import { encodeRepo } from '@/utils/atproto/urls';
import {
  appOf,
  dateFromKey,
  dayBreakdown,
  matchesFilter,
  normalizeActorInput,
  sumDays,
  summarize,
  totalsBy,
  type ActivityFilter,
  type CollectionScan,
} from '@/lib/tools/activity';
import {
  PAGES_PER_COLLECTION,
  SCAN_CONCURRENCY,
  scanActivity,
  type ActivityScan,
  type ScanStopper,
} from '@/lib/tools/activityScan';
import { toolHref } from '@/lib/tools/catalog';
import ActivityHeatmap, { formatDayName } from './ActivityHeatmap';
import { ToolCard, ToolEmpty, ToolError, ToolForm, ToolIntro, ToolSection, ToolShell, ToolSkeleton } from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'activity';
const EXAMPLES = [{ value: 'bsky.app' }, { value: 'atproto.com' }, { value: 'aturi.to' }];

const BY_OPTIONS: { value: 'app' | 'collection'; label: string }[] = [
  { value: 'app', label: 'By app' },
  { value: 'collection', label: 'By collection' },
];

/**
 * Collections named in a "what is missing" list before it says "and N more".
 * Stopping early can leave dozens unread, and the count is what matters.
 */
const GAPS_SHOWN = 6;

const SHORT_DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const DAY_MONTH = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

function percent(share: number): string {
  if (share > 0 && share < 0.01) return '<1%';
  return `${Math.round(share * 100)}%`;
}

/** How many collections have been read as far as this run will take them. */
function settled(collections: CollectionScan[]): number {
  return collections.filter((c) => c.state === 'done' || c.state === 'failed' || c.state === 'partial').length;
}

/**
 * A year of one account's writes, read from the timestamps in its record
 * keys. The arithmetic is in src/lib/tools/activity.ts and the reading in
 * activityScan.ts; this starts a read, shows it filling in, and draws the
 * result.
 */
export default function ActivityCalendar() {
  const [{ actor: raw }, setQuery] = useToolQuery(['actor'] as const);
  const input = raw ? normalizeActorInput(raw) : null;
  const actor = input?.ok ? input.actor : null;

  // Stop ends a read early without throwing its results away, so it cannot
  // be the run's abort signal: each read gets a flag of its own to watch.
  const stopper = useRef<ScanStopper>({ stop: false });
  const run = useToolRun<ActivityScan>(actor, ({ signal, publish }) => {
    const mine: ScanStopper = { stop: false };
    stopper.current = mine;
    return scanActivity(actor as string, { signal, publish, stopper: mine });
  });

  // Reading further back starts a new run, which has nothing to show until
  // its first page lands. Keep the calendar already on screen until then.
  const [kept, setKept] = useState<{ actor: string; scan: ActivityScan } | null>(null);
  if (actor && run.data && kept?.scan !== run.data) setKept({ actor, scan: run.data });
  const scan = run.data ?? (kept && kept.actor === actor ? kept.scan : undefined);
  const running = run.status === 'loading';

  return (
    <ToolShell
      slug={SLUG}
      share={actor ? `${toolHref(SLUG)}?actor=${encodeURIComponent(actor)}` : undefined}
      form={
        <ToolForm
          value={raw}
          onSubmit={(value) => setQuery({ actor: value })}
          label="Handle or DID of the account"
          placeholder="alice.example.com"
          submitLabel="Draw"
          busy={running}
          examples={EXAMPLES}
          icon={<CalendarDays size={17} />}
        />
      }
    >
      {input && !input.ok && <ToolError>{input.reason}</ToolError>}

      {run.status === 'error' && <ToolError onRetry={run.rerun}>{run.error}</ToolError>}

      {actor && !scan && running && (
        <ToolSection title="The last 12 months" meta="Finding the account…">
          <ToolSkeleton rows={3} />
        </ToolSection>
      )}

      {scan && (
        <ActivityResults
          key={scan.did}
          scan={scan}
          running={running}
          onStop={() => {
            stopper.current.stop = true;
          }}
          onMore={run.rerun}
        />
      )}

      {!raw && (
        <ToolIntro
          title="How it works"
          items={[
            {
              term: 'Record keys carry the time',
              text: (
                <>
                  Most record keys are TIDs, which hold the moment they were made. A key such as{' '}
                  <code>3lb2…</code> dates its record without the record being kept. Keys with no time in
                  them fall back to the record&rsquo;s <code>createdAt</code>.
                </>
              ),
            },
            {
              term: 'Every collection, newest first',
              text: 'Each collection in the repository is read from its newest record back, and reading stops at the first key older than the calendar. Posts, likes, and records from any other app count alike.',
            },
            {
              term: 'A bounded number of requests',
              text: `The account’s own PDS answers every request, so only ${SCAN_CONCURRENCY} collections are read at a time and each stops after ${PAGES_PER_COLLECTION} pages. A collection that runs longer says so, and can be read further.`,
            },
            {
              term: 'What it cannot see',
              text: 'A deleted record leaves no key behind and an edit does not change one. The calendar shows records that still exist, on the day each was created.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}

function ActivityResults({
  scan,
  running,
  onStop,
  onMore,
}: {
  scan: ActivityScan;
  running: boolean;
  onStop: () => void;
  onMore: () => void;
}) {
  const [filter, setFilter] = useState<ActivityFilter>(null);
  const [by, setBy] = useState<'app' | 'collection'>('app');
  const [selected, setSelected] = useState<string | null>(null);

  const { collections, window, did } = scan;
  const days = useMemo(() => sumDays(collections, filter), [collections, filter]);
  const summary = useMemo(() => summarize(days, window), [days, window]);
  const shares = useMemo(() => totalsBy(collections, by), [collections, by]);
  const breakdown = useMemo(
    () => (selected ? dayBreakdown(collections, selected).filter((row) => matchesFilter(row.collection, filter)) : []),
    [collections, selected, filter],
  );

  // A PDS reports a handle it could not confirm as `handle.invalid`, which
  // names nobody and resolves to nothing. The DID always does.
  const handle = scan.handle && scan.handle !== 'handle.invalid' ? scan.handle : null;
  const name = handle ? `@${handle}` : did;
  const explorePath = `/explore/${encodeRepo(handle ?? did)}`;
  const reading = collections.filter((c) => c.state === 'reading').map((c) => c.collection);
  const done = settled(collections);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const range = `${SHORT_DATE.format(dateFromKey(window.firstKey))} to ${SHORT_DATE.format(dateFromKey(window.todayKey))}`;

  const partial = collections.filter((c) => c.state === 'partial');
  const failed = collections.filter((c) => c.state === 'failed');
  const undated = collections.reduce((sum, c) => sum + c.undated, 0);
  const selectedTotal = breakdown.reduce((sum, row) => sum + row.count, 0);

  function toggleFilter(key: string) {
    setFilter((current) => (current && current.by === by && current.key === key ? null : { by, key }));
  }

  return (
    <>
      <ToolSection title="The last 12 months" meta={range}>
        <ToolCard className="fn-tool-activity-card">
          <div className="fn-tool-activity-head">
            <p className="fn-tool-activity-total">
              <strong>{plural(summary.total, 'record')}</strong> on{' '}
              <strong>{plural(summary.activeDays, 'day')}</strong> by{' '}
              <Link href={explorePath} prefetch={false}>
                {name}
              </Link>
            </p>
            {filter && (
              <button
                type="button"
                className="fn-tool-activity-filter"
                onClick={() => setFilter(null)}
                aria-label={`Showing ${filter.key} only. Show every app`}
              >
                <span>
                  <Nsid value={filter.key} />
                </span>
                <X size={12} aria-hidden />
              </button>
            )}
          </div>

          <ActivityHeatmap
            window={window}
            days={days}
            label={`Records written by ${name}, by day`}
            selected={selected}
            onSelect={setSelected}
          />

          {running && collections.length > 0 && (
            <div className="fn-tool-activity-progress" role="status">
              <div className="fn-tool-activity-progress-line">
                <span>
                  Reading {done} of {plural(collections.length, 'collection')}
                  {reading.length > 0 && (
                    <>
                      : <code>{reading[0]}</code>
                      {reading.length > 1 && ` and ${reading.length - 1} more`}
                    </>
                  )}
                </span>
                <button type="button" className="fx-btn fx-btn-sm" onClick={onStop}>
                  <Square size={11} aria-hidden /> Stop
                </button>
              </div>
              <div className="fn-tool-progress">
                <span style={{ width: `${Math.round((done / collections.length) * 100)}%` }} />
              </div>
            </div>
          )}

          <p className="fn-tool-note">
            Days are in your time zone ({timeZone}). Records that still exist are counted on the day each
            was created; deleted records and later edits leave no trace in a record key.
          </p>
        </ToolCard>
      </ToolSection>

      {selected && (
        <ToolSection
          title={formatDayName(selected)}
          meta={
            <button type="button" className="fn-tool-link" onClick={() => setSelected(null)}>
              Close
            </button>
          }
        >
          {breakdown.length === 0 ? (
            <ToolEmpty>
              {filter
                ? `Nothing from ${filter.key} was written on this day and still exists.`
                : 'Nothing written on this day still exists.'}
            </ToolEmpty>
          ) : (
            <ToolCard flush>
              <ul className="fn-tool-rows">
                {breakdown.map((row) => (
                  <li key={row.collection} className="fn-tool-row">
                    <LexiconFavicon prefix={appOf(row.collection)} />
                    <span className="fn-tool-row-main">
                      <Link
                        href={`${explorePath}/${row.collection}`}
                        prefetch={false}
                        className="fn-tool-row-title fn-tool-activity-nsid"
                      >
                        <Nsid value={row.collection} />
                      </Link>
                    </span>
                    <span className="fn-tool-row-end">{plural(row.count, 'record')}</span>
                  </li>
                ))}
              </ul>
              <p className="fn-tool-activity-foot">
                {plural(selectedTotal, 'record')} in all. Each link opens the whole collection in the Explorer,
                newest first.
              </p>
            </ToolCard>
          )}
        </ToolSection>
      )}

      <div className="fn-stat-grid fn-tool-activity-stats">
        <Stat label="Records" value={summary.total.toLocaleString()} sub={filter ? `in ${filter.key}` : `in ${plural(collections.length, 'collection')}`} />
        <Stat
          label="Active days"
          value={summary.activeDays.toLocaleString()}
          sub={`of ${summary.windowDays.toLocaleString()}`}
        />
        <Stat
          label="Longest streak"
          value={summary.longestStreak ? plural(summary.longestStreak.days, 'day') : 'None'}
          sub={
            summary.longestStreak
              ? summary.longestStreak.days === 1
                ? DAY_MONTH.format(dateFromKey(summary.longestStreak.startKey))
                : `${DAY_MONTH.format(dateFromKey(summary.longestStreak.startKey))} to ${DAY_MONTH.format(dateFromKey(summary.longestStreak.endKey))}`
              : 'No day has a record'
          }
        />
        <Stat
          label="Most active day"
          value={summary.busiestDay ? summary.busiestDay.count.toLocaleString() : 'None'}
          sub={summary.busiestDay ? SHORT_DATE.format(dateFromKey(summary.busiestDay.key)) : 'No day has a record'}
          onClick={summary.busiestDay ? () => setSelected(summary.busiestDay?.key ?? null) : undefined}
        />
        <Stat
          label="Busiest month"
          value={summary.busiestMonth ? summary.busiestMonth.count.toLocaleString() : 'None'}
          sub={summary.busiestMonth ? summary.busiestMonth.label : 'No month has a record'}
        />
      </div>

      <ToolSection
        title="Where it was written"
        meta={
          filter ? (
            <button type="button" className="fn-tool-link" onClick={() => setFilter(null)}>
              Show everything
            </button>
          ) : (
            `${plural(shares.length, by === 'app' ? 'app' : 'collection')} with records this year`
          )
        }
      >
        <div className="fn-tool-bar fn-tool-activity-bar">
          <Segmented ariaLabel="Group records by" options={BY_OPTIONS} value={by} onChange={setBy} />
          <span className="fn-tool-note">Pick a row to show only its records on the calendar.</span>
        </div>
        {shares.length === 0 ? (
          <ToolEmpty>
            {running ? 'Nothing counted yet.' : 'This account wrote nothing in the last 12 months that still exists.'}
          </ToolEmpty>
        ) : (
          <ToolCard flush>
            <ul className="fn-tool-rows">
              {shares.map((row) => {
                const active = filter?.by === by && filter.key === row.key;
                return (
                  <li key={row.key} className="fn-tool-activity-share" data-active={active || undefined}>
                    <button
                      type="button"
                      className="fn-tool-activity-share-main"
                      aria-pressed={active}
                      onClick={() => toggleFilter(row.key)}
                    >
                      <LexiconFavicon prefix={appOf(row.key)} />
                      <span className="fn-tool-activity-share-name">
                        <span className="fn-tool-activity-nsid">
                          <Nsid value={row.key} />
                        </span>
                        {by === 'app' && row.collections > 1 && (
                          <span className="fn-tool-row-sub">{plural(row.collections, 'collection')}</span>
                        )}
                      </span>
                      <span aria-hidden className="fn-tool-activity-share-bar">
                        <span style={{ width: `${Math.max(2, Math.round(row.share * 100))}%` }} />
                      </span>
                      <span className="fn-tool-activity-share-count">{row.count.toLocaleString()}</span>
                      <span className="fn-tool-activity-share-pct">{percent(row.share)}</span>
                    </button>
                    {by === 'collection' && (
                      <Link
                        href={`${explorePath}/${row.key}`}
                        prefetch={false}
                        className="fn-tool-activity-share-open"
                        aria-label={`Open ${row.key} in the Explorer`}
                        title="Open in the Explorer"
                      >
                        <ExternalLink size={13} aria-hidden />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </ToolCard>
        )}
      </ToolSection>

      {!running && (partial.length > 0 || failed.length > 0 || undated > 0) && (
        <ToolSection title="What is missing">
          <ToolCard>
            {partial.length > 0 && (
              <div className="fn-tool-activity-gap">
                <p>
                  {scan.endedBy === 'stop'
                    ? `Reading was stopped with ${plural(partial.length, 'collection')} unfinished. `
                    : `${plural(partial.length, 'collection')} ${partial.length === 1 ? 'is' : 'are'} longer than one read covers (${(PAGES_PER_COLLECTION * 100).toLocaleString()} records each). `}
                  Days before the dates below are missing their records.
                </p>
                <ul className="fn-tool-activity-gaps">
                  {partial.slice(0, GAPS_SHOWN).map((c) => (
                    <li key={c.collection}>
                      <code>{c.collection}</code>
                      <span>
                        {c.reachedMs !== undefined
                          ? `read back to ${SHORT_DATE.format(new Date(c.reachedMs))}`
                          : c.pages > 0
                            ? `${plural(c.pages, 'page')} read`
                            : 'not read yet'}
                      </span>
                    </li>
                  ))}
                  {partial.length > GAPS_SHOWN && (
                    <li>
                      <span>and {plural(partial.length - GAPS_SHOWN, 'more collection')}</span>
                    </li>
                  )}
                </ul>
              </div>
            )}
            {failed.length > 0 && (
              <div className="fn-tool-activity-gap">
                <p>{plural(failed.length, 'collection')} could not be read, and {failed.length === 1 ? 'is' : 'are'} not on the calendar.</p>
                <ul className="fn-tool-activity-gaps">
                  {failed.slice(0, GAPS_SHOWN).map((c) => (
                    <li key={c.collection}>
                      <code>{c.collection}</code>
                      <span>{c.error ?? 'the PDS did not answer'}</span>
                    </li>
                  ))}
                  {failed.length > GAPS_SHOWN && (
                    <li>
                      <span>and {plural(failed.length - GAPS_SHOWN, 'more collection')}</span>
                    </li>
                  )}
                </ul>
              </div>
            )}
            {undated > 0 && (
              <p>
                {plural(undated, 'record')} {undated === 1 ? 'has' : 'have'} no time in {undated === 1 ? 'its' : 'their'} key
                and no <code>createdAt</code>, so {undated === 1 ? 'it is' : 'they are'} not on the calendar.
              </p>
            )}
            {(partial.length > 0 || failed.length > 0) && (
              <div className="fn-tool-actions">
                <button type="button" className="fx-btn fx-btn-sm" onClick={onMore}>
                  {failed.length > 0 && partial.length === 0
                    ? 'Try those again'
                    : scan.endedBy === 'stop'
                      ? 'Continue reading'
                      : 'Read further back'}
                </button>
              </div>
            )}
          </ToolCard>
        </ToolSection>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  /** Makes the tile a button, for a stat that points at a day. */
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="fn-stat-label">{label}</span>
      <span className="fn-stat-value">{value}</span>
      <span className="fn-tool-activity-stat-sub">{sub}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="fn-stat fn-tool-activity-stat" onClick={onClick} title="Show this day">
      {body}
    </button>
  ) : (
    <div className="fn-stat fn-tool-activity-stat">{body}</div>
  );
}
