'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowUp, Eraser, Pause, Play } from 'lucide-react';
import CopyButton from '@/components/explore/CopyButton';
import LinkifiedJson from '@/components/explore/LinkifiedJson';
import { Segmented } from '@/components/explore/lexicons/primitives';
import { subscribeJetstream } from '@/utils/atproto/jetstream';
import { subscribePlcStream } from '@/utils/atproto/plcStream';
import type { SocketStatus } from '@/utils/atproto/reconnectingSocket';
import { resolveHandle } from '@/utils/atproto/identity';
import { shortDid } from '@/utils/atproto/urls';
import {
  DEFAULT_VIEW,
  MAX_ACCOUNTS,
  MAX_COLLECTIONS,
  STREAM_KINDS,
  compileFilter,
  formatCount,
  itemFromJetstream,
  itemFromPlc,
  kindsOf,
  matchesExceptKind,
  matchesFilter,
  parseAccountToken,
  parseCollectionToken,
  plcKind,
  sourceShown,
  viewFromSearch,
  viewToSearch,
  type MonitorView,
  type SourceChoice,
  type StreamItem,
  type StreamKind,
  type StreamProbe,
  type StreamSource,
} from '@/lib/streamMonitor';
import TokenField, { type FieldToken } from './TokenField';

/** How often buffered events reach the list. */
const FLUSH_MS = 500;
/**
 * Most rows any one event type adds per flush, newest kept. An unfiltered
 * Jetstream runs at thousands of creates a second; capping each type rather
 * than the whole batch keeps a rare account event or PLC operation from being
 * crowded out by likes. The counters stay exact either way.
 */
const PER_KIND_PER_FLUSH = 10;
/** Rows kept, on screen and while held. */
const MAX_ROWS = 300;
const RATE_WINDOW_MS = 5_000;
/** How long the "sampled" note lingers after the last dropped event. */
const SAMPLED_NOTE_MS = 3_000;

const KIND_META = new Map(STREAM_KINDS.map((k) => [k.id, k]));
const SOURCES: { id: StreamSource; label: string }[] = [
  { id: 'jetstream', label: 'Jetstream' },
  { id: 'plc', label: 'PLC directory' },
];
const SOURCE_OPTIONS: { value: SourceChoice; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'jetstream', label: 'Jetstream' },
  { value: 'plc', label: 'PLC directory' },
];

type Counts = Record<StreamKind, number>;
type Rates = Record<StreamSource, number>;

function zeroCounts(): Counts {
  return Object.fromEntries(STREAM_KINDS.map((k) => [k.id, 0])) as Counts;
}

type Stats = {
  counts: Counts;
  matched: number;
  rates: Rates;
  sampled: boolean;
  /** Matching events that arrived while the list was held. */
  held: number;
};

const EMPTY_STATS: Stats = {
  counts: zeroCounts(),
  matched: 0,
  rates: { jetstream: 0, plc: 0 },
  sampled: false,
  held: 0,
};

/**
 * Everything the socket callbacks write to. Kept in one ref so a busy stream
 * costs no React work per event; a timer samples it into state.
 */
type LiveState = {
  nextId: number;
  pending: Map<StreamKind, (() => StreamItem)[]>;
  lastDropAt: number;
  held: StreamItem[];
  heldMatched: number;
  counts: Counts;
  matched: number;
  received: Rates;
  samples: { t: number; jetstream: number; plc: number }[];
};

function createLiveState(): LiveState {
  return {
    nextId: 1,
    pending: new Map(),
    lastDropAt: 0,
    held: [],
    heldMatched: 0,
    counts: zeroCounts(),
    matched: 0,
    received: { jetstream: 0, plc: 0 },
    samples: [],
  };
}

type Connection = SocketStatus | 'off' | 'background' | 'waiting';

// A hidden tab keeps its websockets open at full rate (they aren't throttled
// like timers), so the monitor drops both while the tab is in the background
// and reconnects at the live edge when it comes back.
function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}
const getHidden = () => document.hidden;
const getHiddenOnServer = () => false;

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatRate(perSecond: number): string {
  if (perSecond > 0 && perSecond < 10) return `${perSecond.toFixed(1)}/s`;
  return `${formatCount(Math.round(perSecond))}/s`;
}

/**
 * Live Jetstream and PLC directory events in one list, filtered by source,
 * event type, account, collection and text.
 *
 * Account and collection filters go to Jetstream as `wantedDids` and
 * `wantedCollections`, so a narrow view downloads only what it shows. The
 * PLC stream has no server-side filters and is matched here. The same
 * predicate runs over rows already listed, so narrowing a filter takes
 * effect at once; widening one shows what arrives next.
 *
 * The list holds still (new events wait above it) while it is paused,
 * scrolled away from the top, or has a row open, so a row can be read
 * without it sliding away.
 */
export default function StreamMonitor() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<MonitorView>(() => viewFromSearch(searchParams));
  const hidden = useSyncExternalStore(subscribeVisibility, getHidden, getHiddenOnServer);
  const [paused, setPaused] = useState(false);
  const [scrolledAway, setScrolledAway] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [rows, setRows] = useState<StreamItem[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [socket, setSocket] = useState<Record<StreamSource, SocketStatus>>({
    jetstream: 'connecting',
    plc: 'connecting',
  });
  // Handle → DID, or null when it would not resolve.
  const [handleDids, setHandleDids] = useState<Record<string, string | null>>({});
  const requested = useRef(new Set<string>());
  const live = useRef<LiveState>(createLiveState());
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the address bar in step, so the view can be bookmarked or shared.
  useEffect(() => {
    const qs = viewToSearch(view);
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', next);
    }
  }, [view]);

  // ── Accounts ────────────────────────────────────────────────────────────

  useEffect(() => {
    for (const account of view.accounts) {
      if (account.startsWith('did:') || requested.current.has(account)) continue;
      requested.current.add(account);
      resolveHandle(account)
        .catch(() => null)
        .then((did) => {
          setHandleDids((prev) => ({ ...prev, [account]: did && did.startsWith('did:') ? did : null }));
        });
    }
  }, [view.accounts]);

  const accountDids = useMemo(() => {
    if (!view.accounts.length) return null;
    const dids = new Set<string>();
    for (const account of view.accounts) {
      const did = account.startsWith('did:') ? account : handleDids[account];
      if (did) dids.add(did);
    }
    return dids;
  }, [view.accounts, handleDids]);

  const accountsPending = view.accounts.some((a) => !a.startsWith('did:') && !(a in handleDids));
  const noAccountResolved = accountDids !== null && accountDids.size === 0;

  // ── Filters ─────────────────────────────────────────────────────────────

  const filter = useMemo(() => compileFilter(view, accountDids), [view, accountDids]);
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const held = paused || scrolledAway || openId !== null;
  const holdRef = useRef(held);
  useEffect(() => {
    holdRef.current = held;
  }, [held]);

  const wants = (source: StreamSource) =>
    sourceShown(view.source, source) &&
    kindsOf(source).some((k) => filter.kinds.has(k)) &&
    !noAccountResolved;
  const jetstreamWanted = wants('jetstream');
  const plcWanted = wants('plc');

  // ── Ingest ──────────────────────────────────────────────────────────────

  const ingest = useCallback((probe: StreamProbe, build: (id: number) => StreamItem) => {
    const s = live.current;
    s.received[probe.source] += 1;
    const f = filterRef.current;
    if (!matchesExceptKind(f, probe)) return;
    s.counts[probe.kind] += 1;
    if (!f.kinds.has(probe.kind)) return;
    s.matched += 1;
    if (holdRef.current) s.heldMatched += 1;
    const id = s.nextId++;
    let list = s.pending.get(probe.kind);
    if (!list) {
      list = [];
      s.pending.set(probe.kind, list);
    }
    // Rows are built when they are kept, not for every event.
    list.push(() => build(id));
    if (list.length > PER_KIND_PER_FLUSH) {
      list.shift();
      s.lastDropAt = Date.now();
    }
  }, []);

  const setSocketStatus = useCallback((source: StreamSource, status: SocketStatus) => {
    setSocket((prev) => (prev[source] === status ? prev : { ...prev, [source]: status }));
  }, []);

  // Strings, so a new array with the same members doesn't reconnect.
  const didsKey = accountDids ? [...accountDids].sort().join(' ') : '';
  const collectionsKey = view.collections.join(' ');

  useEffect(() => {
    if (!jetstreamWanted || hidden) return undefined;
    return subscribeJetstream(
      {
        wantedDids: didsKey ? didsKey.split(' ') : undefined,
        wantedCollections: collectionsKey ? collectionsKey.split(' ') : undefined,
      },
      {
        onEvent: (evt, raw) => {
          const commit = evt.kind === 'commit' ? evt.commit : null;
          ingest(
            {
              source: 'jetstream',
              kind: commit ? commit.operation : (evt.kind as StreamKind),
              did: evt.did,
              collection: commit?.collection,
              raw,
            },
            (id) => itemFromJetstream(evt, raw, id),
          );
        },
        onStatus: (status) => setSocketStatus('jetstream', status),
      },
    );
  }, [jetstreamWanted, hidden, didsKey, collectionsKey, ingest, setSocketStatus]);

  useEffect(() => {
    if (!plcWanted || hidden) return undefined;
    return subscribePlcStream(
      {},
      {
        onEvent: (entry, raw) => {
          ingest(
            { source: 'plc', kind: plcKind(entry.operation), did: entry.did, raw },
            (id) => itemFromPlc(entry, raw, id),
          );
        },
        onStatus: (status) => setSocketStatus('plc', status),
      },
    );
  }, [plcWanted, hidden, ingest, setSocketStatus]);

  // ── Flush ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const timer = setInterval(() => {
      const s = live.current;
      const now = Date.now();

      s.samples.push({ t: now, jetstream: s.received.jetstream, plc: s.received.plc });
      while (s.samples.length > 2 && now - s.samples[1].t >= RATE_WINDOW_MS) s.samples.shift();
      const first = s.samples[0];
      const span = (now - first.t) / 1000;
      const rates: Rates =
        span > 0
          ? {
              jetstream: (s.received.jetstream - first.jetstream) / span,
              plc: (s.received.plc - first.plc) / span,
            }
          : { jetstream: 0, plc: 0 };

      const fresh: StreamItem[] = [];
      for (const list of s.pending.values()) for (const build of list) fresh.push(build());
      s.pending.clear();
      fresh.sort((a, b) => b.id - a.id);

      if (holdRef.current) {
        if (fresh.length) s.held = [...fresh, ...s.held].slice(0, MAX_ROWS);
      } else if (fresh.length || s.held.length) {
        const incoming = [...fresh, ...s.held];
        s.held = [];
        s.heldMatched = 0;
        setRows((prev) => [...incoming, ...prev].slice(0, MAX_ROWS));
      }

      setStats({
        counts: { ...s.counts },
        matched: s.matched,
        rates,
        sampled: now - s.lastDropAt < SAMPLED_NOTE_MS,
        held: s.heldMatched,
      });
    }, FLUSH_MS);
    return () => clearInterval(timer);
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────

  /** Counts describe the current filters, so they restart when those change. */
  const resetCounts = useCallback(() => {
    const s = live.current;
    s.counts = zeroCounts();
    s.matched = 0;
    s.heldMatched = 0;
  }, []);

  const changeView = useCallback(
    (patch: Partial<MonitorView>, { recount = true } = {}) => {
      if (recount) resetCounts();
      setView((prev) => ({ ...prev, ...patch }));
    },
    [resetCounts],
  );

  const clear = useCallback(() => {
    const s = live.current;
    s.pending.clear();
    s.held = [];
    resetCounts();
    setRows([]);
    setOpenId(null);
  }, [resetCounts]);

  const showLatest = useCallback(() => {
    setPaused(false);
    setOpenId(null);
    setScrolledAway(false);
    listRef.current?.scrollTo({ top: 0 });
  }, []);

  const toggleRow = useCallback((id: number) => {
    setOpenId((prev) => (prev === id ? null : id));
  }, []);

  const watchAccount = useCallback(
    (did: string) => {
      resetCounts();
      setView((prev) =>
        prev.accounts.includes(did) || prev.accounts.length >= MAX_ACCOUNTS
          ? prev
          : { ...prev, accounts: [...prev.accounts, did] },
      );
      showLatest();
    },
    [resetCounts, showLatest],
  );

  const watchCollection = useCallback(
    (collection: string) => {
      resetCounts();
      setView((prev) =>
        prev.collections.includes(collection) || prev.collections.length >= MAX_COLLECTIONS
          ? prev
          : { ...prev, collections: [...prev.collections, collection] },
      );
      showLatest();
    },
    [resetCounts, showLatest],
  );

  function toggleKind(kind: StreamKind): void {
    const on = view.kinds.includes(kind);
    changeView(
      { kinds: on ? view.kinds.filter((k) => k !== kind) : [...view.kinds, kind] },
      { recount: false },
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const visible = useMemo(() => rows.filter((r) => matchesFilter(filter, r)), [rows, filter]);

  const connection = (source: StreamSource): Connection => {
    if (!sourceShown(view.source, source)) return 'off';
    if (accountsPending && noAccountResolved) return 'waiting';
    if (!(source === 'jetstream' ? jetstreamWanted : plcWanted)) return 'off';
    if (hidden) return 'background';
    return socket[source];
  };

  const accountTokens: FieldToken[] = view.accounts.map((a) => {
    if (a.startsWith('did:')) return { value: a };
    if (!(a in handleDids)) return { value: a, state: 'pending', note: 'resolving…' };
    const did = handleDids[a];
    return did
      ? { value: a, title: did }
      : { value: a, state: 'error', note: 'not found', title: 'This handle did not resolve to a DID' };
  });

  const isDefault = viewToSearch(view) === '';

  let emptyMessage = 'Waiting for events. With narrow filters this can take a while.';
  if (!jetstreamWanted && !plcWanted && !noAccountResolved) emptyMessage = 'Every event type is switched off.';
  if (accountsPending && noAccountResolved) emptyMessage = 'Resolving handles…';
  else if (noAccountResolved) emptyMessage = 'None of those accounts resolved to a DID.';
  if (hidden) emptyMessage = 'Paused while this tab is in the background.';

  return (
    <>
      <section className="fn-sm-filters" aria-label="Filters">
        <div className="fn-sm-field">
          <span className="explore-small-caps">Source</span>
          <Segmented
            ariaLabel="Source"
            options={SOURCE_OPTIONS}
            value={view.source}
            onChange={(source) => changeView({ source })}
          />
        </div>

        <div className="fn-sm-field">
          <span className="explore-small-caps">Events</span>
          <div className="fn-sm-kinds">
            {SOURCES.filter(({ id }) => sourceShown(view.source, id)).map(({ id, label }) => (
              <div key={id} role="group" aria-label={`${label} events`} className="fn-sm-kind-group">
                {view.source === 'both' && <span className="fn-sm-kind-source">{label}</span>}
                {STREAM_KINDS.filter((k) => k.source === id).map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    className="fn-toggle fn-sm-kind"
                    aria-pressed={view.kinds.includes(k.id)}
                    title={k.hint}
                    onClick={() => toggleKind(k.id)}
                  >
                    {k.label}
                    <span className="fn-sm-kind-count">{formatCount(stats.counts[k.id])}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="fn-sm-filter-grid">
          <TokenField
            label="Accounts"
            placeholder="alice.bsky.social, did:plc:…"
            hint="Handles or DIDs. Applies to both sources."
            tokens={accountTokens}
            max={MAX_ACCOUNTS}
            parse={(raw) => {
              const token = parseAccountToken(raw);
              if (!token) return { error: `“${raw}” isn’t a handle or DID.` };
              return { value: token.kind === 'did' ? token.did : token.handle };
            }}
            onChange={(accounts) => changeView({ accounts })}
          />

          {view.source !== 'plc' && (
            <TokenField
              label="Collections"
              placeholder="app.bsky.feed.post, app.bsky.graph.*"
              hint="NSIDs, or a namespace ending in .*. Narrows Jetstream commits; identity and account events have no collection and still show."
              tokens={view.collections.map((value) => ({ value }))}
              max={MAX_COLLECTIONS}
              parse={(raw) => {
                const nsid = parseCollectionToken(raw);
                return nsid ? { value: nsid } : { error: `“${raw}” isn’t an NSID or a namespace like app.bsky.*` };
              }}
              onChange={(collections) => changeView({ collections })}
            />
          )}

          <div className="fn-sm-field">
            <label htmlFor="fn-sm-text" className="explore-small-caps">
              Contains
            </label>
            <input
              id="fn-sm-text"
              type="search"
              className="explore-input"
              value={view.text}
              placeholder="Any text"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => changeView({ text: e.target.value })}
            />
            <p className="fn-sm-hint">Matched anywhere in the event’s JSON: post text, handles, URIs, PDS hosts.</p>
          </div>
        </div>

        {!isDefault && (
          <button type="button" className="fn-sm-reset" onClick={() => changeView(DEFAULT_VIEW)}>
            Reset filters
          </button>
        )}
      </section>

      <section className="fn-sm-feed" aria-label="Live events">
        <header className="fn-sm-feed-head">
          <div className="fn-sm-statuses">
            {SOURCES.filter(({ id }) => sourceShown(view.source, id)).map(({ id, label }) => (
              <SourceStatus key={id} label={label} state={connection(id)} rate={stats.rates[id]} />
            ))}
          </div>
          <span className="fn-sm-matched">
            <strong>{stats.matched.toLocaleString()}</strong> matched
          </span>
          <div className="fn-sm-head-actions">
            <button type="button" className="fl-feed-pause" onClick={() => setPaused((p) => !p)}>
              {paused ? <Play size={11} aria-hidden /> : <Pause size={11} aria-hidden />}
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" className="fl-feed-pause" onClick={clear}>
              <Eraser size={11} aria-hidden />
              Clear
            </button>
          </div>
        </header>

        {held && (
          <button type="button" className="fn-sm-held" onClick={showLatest}>
            <ArrowUp size={13} aria-hidden />
            {stats.held > 0
              ? `${stats.held.toLocaleString()} new ${stats.held === 1 ? 'event' : 'events'} · show latest`
              : paused
                ? 'Paused · resume'
                : 'Holding while you read · back to live'}
          </button>
        )}

        <ol
          ref={listRef}
          className="fn-sm-list"
          onScroll={(e) => setScrolledAway(e.currentTarget.scrollTop > 8)}
        >
          {visible.length === 0 ? (
            <li className="fn-sm-empty">{emptyMessage}</li>
          ) : (
            visible.map((item) => (
              <Row
                key={item.id}
                item={item}
                open={openId === item.id}
                onToggle={toggleRow}
                onWatchAccount={watchAccount}
                onWatchCollection={watchCollection}
              />
            ))
          )}
        </ol>

        <footer className="fn-sm-foot">
          {stats.sampled
            ? `Busy stream: the list keeps up to ${(PER_KIND_PER_FLUSH * 1000) / FLUSH_MS} events a second of each type. The counts include every event.`
            : `Newest first. The last ${MAX_ROWS} are kept.`}
        </footer>
      </section>
    </>
  );
}

function SourceStatus({ label, state, rate }: { label: string; state: Connection; rate: number }) {
  const text: Record<Connection, string> = {
    open: formatRate(rate),
    connecting: 'connecting…',
    reconnecting: 'reconnecting…',
    off: 'off',
    background: 'paused in background',
    waiting: 'waiting for handles',
  };
  return (
    <span className="fn-sm-status" data-state={state}>
      <span className="fn-sm-dot" aria-hidden />
      <span className="fn-sm-status-label">{label}</span>
      <span className="fn-sm-status-text">{text[state]}</span>
    </span>
  );
}

const Row = memo(function Row({
  item,
  open,
  onToggle,
  onWatchAccount,
  onWatchCollection,
}: {
  item: StreamItem;
  open: boolean;
  onToggle: (id: number) => void;
  onWatchAccount: (did: string) => void;
  onWatchCollection: (collection: string) => void;
}) {
  const meta = KIND_META.get(item.kind)!;
  const at = new Date(item.time);
  return (
    // data-fresh runs the feed's one-off arrival accent (globals.css).
    <li className="fn-sm-row explore-jetstream-row" data-fresh="">
      <button
        type="button"
        className="fn-sm-row-main"
        aria-expanded={open}
        onClick={() => onToggle(item.id)}
      >
        <time className="fn-sm-time" dateTime={at.toISOString()} title={at.toISOString()}>
          {timeFormat.format(at)}
        </time>
        <span className="fn-sm-badge" data-kind={item.kind}>
          {meta.badge}
        </span>
        <code className="fn-sm-did" title={item.did}>
          {shortDid(item.did)}
        </code>
        <span className="fn-sm-primary" title={item.primary}>
          {item.primary}
        </span>
        <span className="fn-sm-secondary" title={item.secondary}>
          {item.secondary}
        </span>
      </button>
      {open && (
        <div className="fn-sm-detail">
          <div className="fn-sm-actions">
            <Link href={item.href} prefetch={false} className="fn-btn">
              Open in explorer
            </Link>
            <button type="button" className="fn-btn" onClick={() => onWatchAccount(item.did)}>
              Watch this account
            </button>
            {item.collection && (
              <button type="button" className="fn-btn" onClick={() => onWatchCollection(item.collection!)}>
                Watch this collection
              </button>
            )}
            <CopyButton value={JSON.stringify(item.data, null, 2)} label="Copy JSON" />
          </div>
          <LinkifiedJson value={item.data} className="explore-json fn-sm-json" />
        </div>
      )}
    </li>
  );
});
