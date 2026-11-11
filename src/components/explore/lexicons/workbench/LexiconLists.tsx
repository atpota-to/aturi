'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Loader2, Pin, Search } from 'lucide-react';
import { CHROME_RESULTS_ID, useChromeBarField } from '../../ChromeBarContext';
import { SkeletonBar } from '../../skeletons/primitives';
import LexiconFavicon from '../../tabs/LexiconFavicon';
import { FileGlyph, FolderGlyph, fileKindOf } from '../../workbench/FileIcons';
import { AppSiteLink, Credit, DeltaPill, Nsid, Segmented, Sparkline } from '../primitives';
import { useNewLexicons } from '../NewLexicons';
import { LEXICON_LIST_LABELS, type LexiconLocation, type LexiconScope } from '@/lib/lexiconExplorer';
import { PIN_GROUP_SUFFIX } from '@/utils/preferences';
import { statForMetric, type JustCount, type Metric } from '@/utils/ufos/config';
import { formatCount } from '@/utils/ufos/format';
import { appDomainFor, namespaceKey, splitNsid } from '@/utils/ufos/nsid';
import { WINDOWS } from '@/utils/ufos/windows';
import { LIST_ICONS, useLexiconPins, type AddressFor } from './LexiconRail';
import {
  changePct,
  RANKED_COUNT,
  seriesFor,
  useCatalog,
  useNamespace,
  useRanked,
  useSearch,
  useSeries,
  type NamespaceEntry,
} from './useLexiconData';

/** The metric in the workbench's own words: "DIDs" says less than it should. */
export const METRIC_WORD: Record<Metric, string> = {
  dids: 'Accounts',
  creates: 'Creates',
  updates: 'Updates',
  deletes: 'Deletes',
};
export const METRICS: Metric[] = ['dids', 'creates', 'updates', 'deletes'];

export type ListHost = {
  loc: LexiconLocation;
  addressFor: AddressFor;
  /** Lexicons as rows, or as files (the Files view's icons). */
  display: 'rows' | 'icons';
  onMetric: (metric: Metric) => void;
  /** The lexicons the list shows, in order: for J and K. */
  onVisible: (nsids: string[]) => void;
  /** Under the records of the open lexicon: the bottom bar's filter is theirs. */
  covered: boolean;
};

/**
 * The workbench's main pane when it lists lexicons: the four network-wide
 * lists, a namespace's contents or a search's results. Each is the same
 * frame as an account's collection (CollectionPane): a head with the title
 * and its controls, a filter over what's loaded, the list, which is all that
 * scrolls, and a foot.
 */
export default function LexiconListPane(host: ListHost) {
  const { scope } = host.loc;
  // Keyed, so a new list starts with its own filter and sort.
  const key = scope.kind === 'list' ? `list|${scope.list}` : scope.kind === 'namespace' ? `ns|${scope.prefix}` : `q|${scope.term}`;
  if (scope.kind === 'namespace') return <NamespacePane key={key} host={host} prefix={scope.prefix} />;
  if (scope.kind === 'search') return <SearchPane key={key} host={host} term={scope.term} />;
  if (scope.list === 'new') return <NewPane key={key} host={host} />;
  if (scope.list === 'all') return <CatalogPane key={key} host={host} />;
  return <RankedPane key={key} host={host} mode={scope.list} />;
}

// ─── Frame ───────────────────────────────────────────────────────────────────

function useFilter() {
  const [filter, setFilter] = useState('');
  return { filter, setFilter, query: filter.trim().toLowerCase() };
}

/** The same filter in the phone's bottom bar, with its tally. */
function usePublishFilter(
  host: ListHost,
  { filter, setFilter, query }: ReturnType<typeof useFilter>,
  total: number | null,
  shown: number,
  label: string,
) {
  useChromeBarField(
    host.covered
      ? null
      : {
          placeholder: 'Filter this list…',
          label,
          value: filter,
          onChange: setFilter,
          resultsId: CHROME_RESULTS_ID,
          inPage: true,
          status: total === null ? null : query ? `${shown}/${total}` : `${total}`,
        },
  );
}

function Pane({
  icon,
  title,
  mono,
  sub,
  actions,
  filter,
  setFilter,
  meta,
  stale,
  children,
  foot,
}: {
  icon?: ReactNode;
  title: ReactNode;
  mono?: boolean;
  sub?: ReactNode;
  actions?: ReactNode;
  filter: string;
  setFilter: (v: string) => void;
  meta?: ReactNode;
  stale?: boolean;
  children: ReactNode;
  foot?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // The lexicon open beside the list stays in sight as J and K step through.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;
    const reveal = () => {
      const row = scroller.querySelector<HTMLElement>('[data-current]');
      if (!row) return;
      const box = scroller.getBoundingClientRect();
      const at = row.getBoundingClientRect();
      if (at.top < box.top + 32 || at.bottom > box.bottom) row.scrollIntoView({ block: 'nearest' });
    };
    reveal();
    const observer = new MutationObserver(reveal);
    observer.observe(scroller, { subtree: true, attributes: true, attributeFilter: ['data-current'] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="fx-wb-pane fx-lx-pane">
      <div className="fx-wb-pane-head" data-crumbed>
        <div className="fx-titlebar">
          <div className="fx-title-row">
            {icon && (
              <span className="fx-lx-title-icon" aria-hidden>
                {icon}
              </span>
            )}
            <h1 className="fx-h1" data-mono={mono || undefined}>
              {title}
            </h1>
          </div>
          {actions && <div className="fx-actions">{actions}</div>}
        </div>
        {sub && <div className="fx-lx-sub">{sub}</div>}
      </div>
      <section aria-label="Lexicons" className="fx-records fx-wb-records" id={CHROME_RESULTS_ID}>
        <div className="fx-records-tools">
          <label className="fx-field">
            <Search size={14} aria-hidden />
            <span className="fx-sr">Filter this list</span>
            <input
              type="text"
              placeholder="Filter this list"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && filter) {
                  e.preventDefault();
                  setFilter('');
                }
              }}
            />
          </label>
          {meta && (
            <span className="fx-records-tools-meta" aria-live="polite">
              {meta}
            </span>
          )}
        </div>
        <div ref={scrollRef} className="fx-wb-scroll" data-stale={stale || undefined}>
          {children}
        </div>
        <div className="fx-records-foot fx-lx-foot">
          {foot ?? <span />}
          <Credit />
        </div>
      </section>
    </div>
  );
}

function Message({ children, error }: { children: ReactNode; error?: boolean }) {
  return <p className={error ? 'explore-error fx-lx-msg' : 'fx-records-msg'}>{children}</p>;
}

function NoMatch({ filter }: { filter: string }) {
  return (
    <Message>
      Nothing in this list matches <code>{filter.trim()}</code>.
    </Message>
  );
}

function LoadMore({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      data-wait={loading || undefined}
      className="fx-btn fx-btn-sm"
      style={{ fontWeight: 600 }}
    >
      {loading && <Loader2 size={13} className="explore-spin" aria-hidden />}
      Load more
    </button>
  );
}

/** The window, in words, for a pane's subtitle. */
function windowWords(host: ListHost): string {
  const label = WINDOWS[host.loc.window].label;
  return label === '1d' ? 'the last day' : label === '7d' ? 'the last week' : 'the last 30 days';
}

function useReportVisible(host: ListHost, nsids: string[]) {
  const joined = nsids.join(' ');
  const { onVisible } = host;
  useEffect(() => {
    onVisible(joined ? joined.split(' ') : []);
  }, [joined, onVisible]);
}

// ─── Cells ───────────────────────────────────────────────────────────────────

/** An NSID with its namespace quieter than the rest, broken at dots. */
function NsidCell({ nsid, within, suffix }: { nsid: string; within?: string; suffix?: string }) {
  const split = within ? { head: within, tail: nsid.slice(within.length + 1) } : splitNsid(nsid);
  const end = suffix ? <span className="fx-lx-ns">{suffix}</span> : null;
  if (!split.tail) {
    return (
      <span className="fx-lx-nsid" title={nsid}>
        <span className="fx-lx-leaf">
          <Nsid value={nsid} />
        </span>
        {end}
      </span>
    );
  }
  return (
    <span className="fx-lx-nsid" title={nsid}>
      <span className="fx-lx-ns">
        <Nsid value={split.head} />.
      </span>
      <wbr />
      <span className="fx-lx-leaf">
        <Nsid value={split.tail} />
      </span>
      {end}
    </span>
  );
}

/** `col` names the column, for a narrow pane to put the secondary one away. */
function Count({ value, unit, col }: { value: number; unit: string; col?: 'creates' }) {
  return (
    <span className="fx-lx-num" data-col={col} title={`${value.toLocaleString()} ${unit}`}>
      {formatCount(value)}
    </span>
  );
}

/** Change against the window before: a pill, "new" when there was nothing, blank when unknown. */
function Change({ current, prior }: { current: number; prior: number | null }) {
  if (prior === null) return <span className="fx-lx-change" />;
  if (prior <= 0) {
    return <span className="fx-lx-change">{current > 0 ? <DeltaPill pct={null} /> : null}</span>;
  }
  return (
    <span className="fx-lx-change">
      <DeltaPill pct={changePct(current, prior)} />
    </span>
  );
}

type SortKey = 'name' | 'accounts' | 'creates';

function SortHead({
  label,
  by,
  sort,
  onSort,
  numeric,
  col,
}: {
  label: string;
  by: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
  numeric?: boolean;
  col?: 'creates';
}) {
  const active = sort.key === by;
  const Arrow = sort.desc ? ArrowDown : ArrowUp;
  const order = by === 'name' ? (sort.desc ? 'Z to A' : 'A to Z') : sort.desc ? 'highest first' : 'lowest first';
  return (
    <span data-num={numeric || undefined} data-col={col}>
      <button
        type="button"
        className="fx-lx-sort"
        onClick={() => onSort(by)}
        data-active={active || undefined}
        aria-label={`Sort by ${label.toLowerCase()}${active ? `, ${order}` : ''}`}
      >
        {label}
        {active && <Arrow size={11} aria-hidden />}
      </button>
    </span>
  );
}

function useSort(initial: { key: SortKey; desc: boolean }) {
  const [sort, setSort] = useState(initial);
  const onSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: key !== 'name' }));
  return { sort, onSort };
}

function sorted<T>(rows: T[], sort: { key: SortKey; desc: boolean }, read: (row: T) => { name: string; counts: JustCount }) {
  const dir = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = read(a);
    const y = read(b);
    if (sort.key === 'name') return dir * x.name.localeCompare(y.name);
    const field = sort.key === 'accounts' ? 'dids_estimate' : 'creates';
    return dir * (x.counts[field] - y.counts[field]) || x.name.localeCompare(y.name);
  });
}

function RowsSkeleton({ cols, rows = 12 }: { cols: 'ranked' | 'new' | 'ns' | 'plain'; rows?: number }) {
  const widths = ['62%', '48%', '74%', '56%', '42%', '68%', '52%', '60%', '46%', '70%', '58%', '50%'];
  return (
    <ul className="fx-lx-list" data-cols={cols} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="fx-lx-item">
          <div className="fx-lx-row" data-skeleton>
            {(cols === 'ranked' || cols === 'new') && (
              <span className="fx-lx-rank">
                <SkeletonBar width="1rem" height="0.6rem" />
              </span>
            )}
            <span className="fx-lx-name">
              <SkeletonBar width="14px" height="14px" shape="control" style={{ flex: 'none' }} />
              <SkeletonBar width={widths[i % widths.length]} height="0.65rem" />
            </span>
            {cols === 'ranked' && (
              <span className="fx-lx-spark">
                <SkeletonBar width="84px" height="20px" shape="control" />
              </span>
            )}
            <span className="fx-lx-num">
              <SkeletonBar width="2.5rem" height="0.6rem" />
            </span>
            {cols !== 'ranked' && (
              <span className="fx-lx-num" data-col="creates">
                <SkeletonBar width="2.5rem" height="0.6rem" />
              </span>
            )}
            {(cols === 'ranked' || cols === 'ns') && (
              <span className="fx-lx-change">
                <SkeletonBar width="2.75rem" height="0.6rem" />
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Trending and Top ────────────────────────────────────────────────────────

function RankedPane({ host, mode }: { host: ListHost; mode: 'trending' | 'top' }) {
  const { loc, addressFor } = host;
  const ranked = useRanked(mode, loc.window, loc.metric);
  const rows = ranked.data;
  const getSeries = useSeries(useMemo(() => rows?.map((r) => r.nsid) ?? [], [rows]), loc.window);
  const filtering = useFilter();
  const { filter, setFilter, query } = filtering;
  const visible = useMemo(() => (rows ? rows.filter((r) => !query || r.nsid.toLowerCase().includes(query)) : null), [rows, query]);
  useReportVisible(host, visible?.map((r) => r.nsid) ?? []);
  usePublishFilter(host, filtering, rows?.length ?? null, visible?.length ?? 0, `Filter ${LEXICON_LIST_LABELS[mode]} lexicons`);
  const Icon = LIST_ICONS[mode];
  const scope: LexiconScope = { kind: 'list', list: mode };

  return (
    <Pane
      icon={<Icon size={16} />}
      title={mode === 'trending' ? 'Trending lexicons' : 'Top lexicons'}
      sub={
        mode === 'trending' ? (
          <>
            Ranked by the change in {METRIC_WORD[loc.metric].toLowerCase()} over {windowWords(host)} against the window
            before. One per namespace, with Bluesky’s own left out.
          </>
        ) : (
          <>
            Ranked by {METRIC_WORD[loc.metric].toLowerCase()} over {windowWords(host)}, one per namespace, with the change
            against the window before.
          </>
        )
      }
      actions={<MetricSwitch host={host} />}
      filter={filter}
      setFilter={setFilter}
      meta={rows ? `${rows.length} lexicons` : null}
      stale={ranked.loading && rows !== null}
    >
      {ranked.error && !rows ? (
        <Message error>Couldn’t reach the UFOs API: {ranked.error}</Message>
      ) : !visible ? (
        <RowsSkeleton cols="ranked" />
      ) : visible.length === 0 ? (
        rows && rows.length > 0 ? <NoMatch filter={filter} /> : <Message>No lexicons moved in this window.</Message>
      ) : (
        <ul className="fx-lx-list" data-cols="ranked">
          <li className="fx-lx-head" aria-hidden>
            <span>#</span>
            <span>Lexicon</span>
            <span>{WINDOWS[loc.window].label}</span>
            <span data-num>{METRIC_WORD[loc.metric]}</span>
            <span data-num>Change</span>
          </li>
          {visible.map((row) => {
            const rank = (rows?.indexOf(row) ?? 0) + 1;
            const line = seriesFor(getSeries(row.nsid), loc.metric);
            return (
              <li key={row.nsid} className="fx-lx-item">
                <Link
                  href={addressFor({ scope, nsid: row.nsid })}
                  prefetch={false}
                  className="fx-lx-row"
                  data-current={loc.nsid === row.nsid || undefined}
                  aria-current={loc.nsid === row.nsid ? 'true' : undefined}
                >
                  <span className="fx-lx-rank">{rank}</span>
                  <span className="fx-lx-name">
                    <LexiconFavicon prefix={namespaceKey(row.nsid)} />
                    <NsidCell nsid={row.nsid} />
                  </span>
                  <span className="fx-lx-spark">
                    {line ? (
                      line.some((v) => v > 0) && <Sparkline data={line} ariaLabel={`${row.nsid} over ${windowWords(host)}`} />
                    ) : (
                      <SkeletonBar width="84px" height="20px" shape="control" />
                    )}
                  </span>
                  <Count value={row.value} unit={METRIC_WORD[loc.metric].toLowerCase()} />
                  <Change current={row.value} prior={row.prior} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {rows && rows.length >= RANKED_COUNT && !query && (
        <p className="fx-lx-note">
          The top {RANKED_COUNT}. Every lexicon with activity in the window is under{' '}
          <Link href={addressFor({ scope: { kind: 'list', list: 'all' } })} prefetch={false}>
            All lexicons
          </Link>
          .
        </p>
      )}
    </Pane>
  );
}

function MetricSwitch({ host }: { host: ListHost }) {
  return (
    <Segmented
      ariaLabel="Rank by"
      options={METRICS.map((m) => ({ value: m, label: METRIC_WORD[m] }))}
      value={host.loc.metric}
      onChange={host.onMetric}
    />
  );
}

// ─── New ─────────────────────────────────────────────────────────────────────

function NewPane({ host }: { host: ListHost }) {
  const { loc, addressFor } = host;
  const { answer, error } = useNewLexicons(loc.window);
  const rows = answer?.lexicons ?? null;
  const filtering = useFilter();
  const { filter, setFilter, query } = filtering;
  const visible = useMemo(() => (rows ? rows.filter((r) => !query || r.nsid.toLowerCase().includes(query)) : null), [rows, query]);
  useReportVisible(host, visible?.map((r) => r.nsid) ?? []);
  usePublishFilter(host, filtering, rows?.length ?? null, visible?.length ?? 0, 'Filter new lexicons');
  const scope: LexiconScope = { kind: 'list', list: 'new' };

  return (
    <Pane
      icon={<LIST_ICONS.new size={16} />}
      title="New lexicons"
      sub={<>Record types seen for the first time in {windowWords(host)}, with three or more accounts using them.</>}
      filter={filter}
      setFilter={setFilter}
      meta={answer ? `${answer.count} new` : null}
    >
      {error && !rows ? (
        <Message error>Couldn’t load new lexicons: {error}</Message>
      ) : !visible ? (
        <RowsSkeleton cols="new" />
      ) : visible.length === 0 ? (
        rows && rows.length > 0 ? <NoMatch filter={filter} /> : <Message>Nothing new with three or more accounts in this window.</Message>
      ) : (
        <ul className="fx-lx-list" data-cols="new">
          <li className="fx-lx-head" aria-hidden>
            <span>#</span>
            <span>Lexicon</span>
            <span data-num>Accounts</span>
            <span data-num data-col="creates">Creates</span>
          </li>
          {visible.map((row) => (
            <li key={row.nsid} className="fx-lx-item">
              <Link
                href={addressFor({ scope, nsid: row.nsid })}
                prefetch={false}
                className="fx-lx-row"
                data-current={loc.nsid === row.nsid || undefined}
                aria-current={loc.nsid === row.nsid ? 'true' : undefined}
              >
                <span className="fx-lx-rank">{(rows?.indexOf(row) ?? 0) + 1}</span>
                <span className="fx-lx-name">
                  <LexiconFavicon prefix={namespaceKey(row.nsid)} />
                  <NsidCell nsid={row.nsid} />
                </span>
                <Count value={row.didsEstimate} unit="accounts" />
                <Count value={row.creates} unit="creates" col="creates" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {answer && (
        <p className="fx-lx-note">
          First seen means no activity UFOs recorded between {answer.historyBegins}, when its history begins, and the start
          of the window. Account counts are estimates, and a few accounts can still be one developer testing.
        </p>
      )}
    </Pane>
  );
}

// ─── All ─────────────────────────────────────────────────────────────────────

function CatalogPane({ host }: { host: ListHost }) {
  const { loc, addressFor } = host;
  const catalog = useCatalog(loc.window);
  const rows = catalog.rows;
  const { sort, onSort } = useSort({ key: 'name', desc: false });
  const filtering = useFilter();
  const { filter, setFilter, query } = filtering;
  const visible = useMemo(() => {
    if (!rows) return null;
    const matched = rows.filter((r) => !query || r.nsid.toLowerCase().includes(query));
    return sorted(matched, sort, (r) => ({ name: r.nsid, counts: r }));
  }, [rows, query, sort]);
  useReportVisible(host, visible?.map((r) => r.nsid) ?? []);
  usePublishFilter(host, filtering, rows?.length ?? null, visible?.length ?? 0, 'Filter all lexicons');
  const scope: LexiconScope = { kind: 'list', list: 'all' };

  return (
    <Pane
      icon={<LIST_ICONS.all size={16} />}
      title="All lexicons"
      sub={<>Every lexicon with activity in {windowWords(host)}, A to Z as UFOs pages them. Sorting sorts what’s loaded.</>}
      filter={filter}
      setFilter={setFilter}
      meta={rows ? `${formatCount(rows.length)} loaded` : null}
      stale={catalog.stale}
      foot={
        rows && (
          <span className="fx-lx-foot-more">
            {catalog.cursor ? `${formatCount(rows.length)} loaded, more on UFOs` : `All ${formatCount(rows.length)} loaded`}
            {catalog.cursor && <LoadMore onClick={catalog.loadMore} loading={catalog.loadingMore} />}
          </span>
        )
      }
    >
      {catalog.error && !rows ? (
        <Message error>Couldn’t reach the UFOs API: {catalog.error}</Message>
      ) : !visible ? (
        <RowsSkeleton cols="plain" />
      ) : visible.length === 0 ? (
        rows && rows.length > 0 ? <NoMatch filter={filter} /> : <Message>No lexicons had activity in this window.</Message>
      ) : host.display === 'icons' ? (
        <FileGrid
          items={visible.map((r) => ({ kind: 'lexicon', name: r.nsid, counts: r, prior: null }))}
          host={host}
          scopeFor={() => scope}
        />
      ) : (
        <ul className="fx-lx-list" data-cols="plain">
          <li className="fx-lx-head">
            <SortHead label="Lexicon" by="name" sort={sort} onSort={onSort} />
            <SortHead label="Accounts" by="accounts" sort={sort} onSort={onSort} numeric />
            <SortHead label="Creates" by="creates" sort={sort} onSort={onSort} numeric col="creates" />
          </li>
          {visible.map((row) => (
            <li key={row.nsid} className="fx-lx-item">
              <Link
                href={addressFor({ scope, nsid: row.nsid })}
                prefetch={false}
                className="fx-lx-row"
                data-current={loc.nsid === row.nsid || undefined}
                aria-current={loc.nsid === row.nsid ? 'true' : undefined}
              >
                <span className="fx-lx-name">
                  <LexiconFavicon prefix={namespaceKey(row.nsid)} />
                  <NsidCell nsid={row.nsid} />
                </span>
                <Count value={row.dids_estimate} unit="accounts" />
                <Count value={row.creates} unit="creates" col="creates" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Pane>
  );
}

// ─── A namespace ─────────────────────────────────────────────────────────────

function NamespacePane({ host, prefix }: { host: ListHost; prefix: string }) {
  const { loc, addressFor } = host;
  const ns = useNamespace(prefix, loc.window);
  const listing = ns.listing;
  const entries = listing?.entries ?? null;
  const { sort, onSort } = useSort({ key: 'accounts', desc: true });
  const filtering = useFilter();
  const { filter, setFilter, query } = filtering;
  const visible = useMemo(() => {
    if (!entries) return null;
    const matched = entries.filter((e) => !query || e.name.toLowerCase().includes(query));
    return sorted(matched, sort, (e) => ({ name: e.name, counts: e.counts }));
  }, [entries, query, sort]);
  useReportVisible(host, visible?.filter((e) => e.kind === 'lexicon').map((e) => e.name) ?? []);
  usePublishFilter(host, filtering, entries?.length ?? null, visible?.length ?? 0, `Filter entries under ${prefix}`);
  const { isPinned, toggle } = useLexiconPins();
  const pinEntry = `${prefix}${PIN_GROUP_SUFFIX}`;
  const pinned = isPinned(pinEntry);
  const domain = appDomainFor(prefix);
  const scope: LexiconScope = { kind: 'namespace', prefix };

  return (
    <Pane
      icon={<LexiconFavicon prefix={namespaceKey(prefix)} />}
      title={prefix}
      mono
      sub={
        listing ? (
          <>
            <strong>{formatCount(listing.total.dids_estimate)}</strong> accounts ·{' '}
            <strong>{formatCount(listing.total.creates)}</strong> records created over {windowWords(host)}
            {listing.priorTotal.dids_estimate > 0 && (
              <>
                {' '}
                <DeltaPill pct={changePct(listing.total.dids_estimate, listing.priorTotal.dids_estimate)} />
              </>
            )}
          </>
        ) : ns.error ? null : (
          <SkeletonBar width="16rem" height="0.7rem" />
        )
      }
      actions={
        <>
          <button
            type="button"
            className="fx-btn"
            aria-pressed={pinned}
            onClick={() => toggle(pinEntry)}
            title={pinned ? `Unpin ${prefix}.*` : `Pin ${prefix}.*, here and in every account’s collections`}
          >
            <Pin size={14} aria-hidden />
            {pinned ? 'Pinned' : 'Pin'}
          </button>
          {domain && <AppSiteLink domain={domain} />}
        </>
      }
      filter={filter}
      setFilter={setFilter}
      meta={entries ? `${entries.length} entries` : null}
      stale={ns.stale}
      foot={
        listing?.cursor ? (
          <span className="fx-lx-foot-more">
            {entries?.length} loaded, more on UFOs
            <LoadMore onClick={ns.loadMore} loading={ns.loadingMore} />
          </span>
        ) : undefined
      }
    >
      {ns.error && !listing ? (
        <Message error>Couldn’t reach the UFOs API: {ns.error}</Message>
      ) : !visible ? (
        <RowsSkeleton cols="ns" />
      ) : entries && entries.length === 0 ? (
        <div className="fx-records-msg">
          <p style={{ margin: 0 }}>
            Nothing under <code>{prefix}</code> had activity over {windowWords(host)}.
          </p>
          <p style={{ margin: '6px 0 0' }}>
            <Link href={addressFor({ scope, nsid: prefix })} prefetch={false}>
              Open {prefix} as a lexicon
            </Link>
            {loc.window !== '30d' && <> or widen the window above.</>}
          </p>
        </div>
      ) : visible.length === 0 ? (
        <NoMatch filter={filter} />
      ) : host.display === 'icons' ? (
        <FileGrid items={visible} host={host} scopeFor={() => scope} within={prefix} />
      ) : (
        <ul className="fx-lx-list" data-cols="ns">
          <li className="fx-lx-head">
            <SortHead label="Name" by="name" sort={sort} onSort={onSort} />
            <SortHead label="Accounts" by="accounts" sort={sort} onSort={onSort} numeric />
            <SortHead label="Creates" by="creates" sort={sort} onSort={onSort} numeric col="creates" />
            <span data-num>Change</span>
          </li>
          {visible.map((entry) => (
            <EntryRow key={`${entry.kind}|${entry.name}`} entry={entry} host={host} scope={scope} within={prefix} />
          ))}
        </ul>
      )}
    </Pane>
  );
}

function EntryRow({
  entry,
  host,
  scope,
  within,
}: {
  entry: NamespaceEntry;
  host: ListHost;
  scope: LexiconScope;
  within?: string;
}) {
  const { loc, addressFor } = host;
  const isNs = entry.kind === 'namespace';
  const current = !isNs && loc.nsid === entry.name;
  const href = isNs
    ? addressFor({ scope: { kind: 'namespace', prefix: entry.name } })
    : addressFor({ scope, nsid: entry.name });
  return (
    <li className="fx-lx-item">
      <Link
        href={href}
        prefetch={false}
        className="fx-lx-row"
        data-kind={entry.kind}
        data-current={current || undefined}
        aria-current={current ? 'true' : undefined}
      >
        <span className="fx-lx-name">
          {isNs ? <FolderGlyph /> : <FileGlyph kind={fileKindOf(entry.name)} />}
          <NsidCell
            nsid={entry.name}
            within={within && entry.name.startsWith(`${within}.`) ? within : undefined}
            suffix={isNs ? '.*' : undefined}
          />
        </span>
        <Count value={entry.counts.dids_estimate} unit="accounts" />
        <Count value={entry.counts.creates} unit="creates" col="creates" />
        <Change current={entry.counts.dids_estimate} prior={entry.prior ? statForMetric(entry.prior, 'dids') : null} />
      </Link>
    </li>
  );
}

/** Namespaces as folders and lexicons as files, for the Files view's icons. */
function FileGrid({
  items,
  host,
  scopeFor,
  within,
}: {
  items: NamespaceEntry[];
  host: ListHost;
  scopeFor: (item: NamespaceEntry) => LexiconScope;
  within?: string;
}) {
  const { loc, addressFor } = host;
  return (
    <ul className="fx-fd-grid">
      {items.map((item) => {
        const isNs = item.kind === 'namespace';
        const current = !isNs && loc.nsid === item.name;
        const name = within && item.name.startsWith(`${within}.`) ? item.name.slice(within.length + 1) : item.name;
        return (
          <li key={`${item.kind}|${item.name}`} className="fx-fd-item">
            <Link
              href={
                isNs
                  ? addressFor({ scope: { kind: 'namespace', prefix: item.name } })
                  : addressFor({ scope: scopeFor(item), nsid: item.name })
              }
              prefetch={false}
              className="fx-fd-tile"
              data-current={current || undefined}
              aria-current={current ? 'true' : undefined}
              title={item.name}
            >
              {isNs ? <FolderGlyph prefix={namespaceKey(item.name)} /> : <FileGlyph kind={fileKindOf(item.name)} />}
              <code className="fx-fd-name">{name}</code>
              <span className="fx-fd-meta">
                {formatCount(item.counts.dids_estimate)} {item.counts.dids_estimate === 1 ? 'account' : 'accounts'}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ─── A search ────────────────────────────────────────────────────────────────

function SearchPane({ host, term }: { host: ListHost; term: string }) {
  const { loc, addressFor } = host;
  const search = useSearch(term);
  const rows = search.data;
  const { sort, onSort } = useSort({ key: 'accounts', desc: true });
  const filtering = useFilter();
  const { filter, setFilter, query } = filtering;
  const visible = useMemo(() => {
    if (!rows) return null;
    const matched = rows.filter((r) => !query || r.nsid.toLowerCase().includes(query));
    return sorted(matched, sort, (r) => ({ name: r.nsid, counts: r }));
  }, [rows, query, sort]);
  useReportVisible(host, visible?.map((r) => r.nsid) ?? []);
  usePublishFilter(host, filtering, rows?.length ?? null, visible?.length ?? 0, `Filter lexicons matching ${term}`);
  const scope: LexiconScope = { kind: 'search', term };

  return (
    <Pane
      icon={<Search size={16} />}
      title={<>“{term}”</>}
      sub={rows ? <>{rows.length === 1 ? 'One lexicon matches' : `${rows.length} lexicons match`}, from UFOs’ search of every NSID it has seen.</> : null}
      filter={filter}
      setFilter={setFilter}
      meta={rows ? `${rows.length} found` : null}
    >
      {search.error && !rows ? (
        <Message error>Couldn’t reach the UFOs API: {search.error}</Message>
      ) : !visible ? (
        <RowsSkeleton cols="plain" />
      ) : visible.length === 0 ? (
        rows && rows.length > 0 ? <NoMatch filter={filter} /> : <Message>No lexicons matched “{term}”.</Message>
      ) : host.display === 'icons' ? (
        <FileGrid
          items={visible.map((r) => ({ kind: 'lexicon', name: r.nsid, counts: r, prior: null }))}
          host={host}
          scopeFor={() => scope}
        />
      ) : (
        <ul className="fx-lx-list" data-cols="plain">
          <li className="fx-lx-head">
            <SortHead label="Lexicon" by="name" sort={sort} onSort={onSort} />
            <SortHead label="Accounts" by="accounts" sort={sort} onSort={onSort} numeric />
            <SortHead label="Creates" by="creates" sort={sort} onSort={onSort} numeric col="creates" />
          </li>
          {visible.map((row) => (
            <li key={row.nsid} className="fx-lx-item">
              <Link
                href={addressFor({ scope, nsid: row.nsid })}
                prefetch={false}
                className="fx-lx-row"
                data-current={loc.nsid === row.nsid || undefined}
                aria-current={loc.nsid === row.nsid ? 'true' : undefined}
              >
                <span className="fx-lx-name">
                  <LexiconFavicon prefix={namespaceKey(row.nsid)} />
                  <NsidCell nsid={row.nsid} />
                </span>
                <Count value={row.dids_estimate} unit="accounts" />
                <Count value={row.creates} unit="creates" col="creates" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Pane>
  );
}

