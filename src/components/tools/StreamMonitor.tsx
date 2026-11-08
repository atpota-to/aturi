'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Activity, ArrowUp, Braces, Eraser, Pause, Play, Search, User } from 'lucide-react';
import AppearIn from '@/components/explore/AppearIn';
import CopyButton from '@/components/explore/CopyButton';
import LinkifiedJson from '@/components/explore/LinkifiedJson';
import RichRecordCard, { recordHasRichCard } from '@/components/explore/RichRecordCard';
import ShareLinkChip from '@/components/explore/ShareLinkChip';
import { CHROME_RESULTS_ID, useChromeBarField } from '@/components/explore/ChromeBarContext';
import { Segmented } from '@/components/explore/lexicons/primitives';
import RecordPreview from '@/components/RecordPreview';
import { replay } from '@/lib/motion';
import { subscribeJetstream } from '@/utils/atproto/jetstream';
import { getPlcAuditLog } from '@/utils/atproto/plc';
import { subscribePlcStream, type PlcStreamEntry } from '@/utils/atproto/plcStream';
import type { SocketStatus } from '@/utils/atproto/reconnectingSocket';
import { resolveDidHandle, resolveHandle } from '@/utils/atproto/identity';
import { searchActorsTypeahead, shouldQueryHandleTypeahead } from '@/utils/atproto/appview';
import { parseAtUri, shortDid } from '@/utils/atproto/urls';
import { searchLexicons } from '@/utils/ufos/client';
import {
  DEFAULT_VIEW,
  MAX_ACCOUNTS,
  MAX_COLLECTIONS,
  PRESETS,
  STREAM_KINDS,
  compileFilter,
  describePlcChange,
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
  type PlcChange,
  type SourceChoice,
  type StreamItem,
  type StreamKind,
  type StreamProbe,
  type StreamSource,
} from '@/lib/streamMonitor';
import TokenField, { type FieldToken, type Suggestion } from './TokenField';

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
/**
 * Matching events a second below which the list counts as calm: new rows get
 * the arrival accent and accounts are looked up as they scroll into view.
 * Above it the accent would sit on every row, and lookups would mean
 * hundreds of requests a minute for rows nobody can read at that speed.
 */
const CALM_RATE = 3;
/** Least time between two ripples of a source's live dot. */
const BLIP_MS = 1_200;
/**
 * How long an empty list shows skeleton rows after connecting or a filter
 * change, before it says it is waiting. A busy stream fills it well inside
 * this; saying "waiting" any sooner flashes past on every load.
 */
const WARMUP_MS = 4_000;

const KIND_META = new Map(STREAM_KINDS.map((k) => [k.id, k]));
const SOURCES: { id: StreamSource; label: string; short: string }[] = [
  { id: 'jetstream', label: 'Jetstream', short: 'Jetstream' },
  { id: 'plc', label: 'PLC directory', short: 'PLC' },
];
const SOURCE_OPTIONS: { value: SourceChoice; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'jetstream', label: 'Jetstream' },
  { value: 'plc', label: 'PLC directory' },
];

type Counts = Record<StreamKind, number>;
type Rates = Record<StreamSource, number>;
/** A listed event, and whether it arrived while the list was calm. */
type Row = StreamItem & { accent: boolean };

function zeroCounts(): Counts {
  return Object.fromEntries(STREAM_KINDS.map((k) => [k.id, 0])) as Counts;
}

type Stats = {
  counts: Counts;
  matched: number;
  rates: Rates;
  /** Matching events a second. */
  matchedRate: number;
  sampled: boolean;
  /** Nothing has matched yet, and the filters are still new. */
  warming: boolean;
  /** Matching events that arrived while the list was held. */
  held: number;
};

const EMPTY_STATS: Stats = {
  counts: zeroCounts(),
  matched: 0,
  rates: { jetstream: 0, plc: 0 },
  matchedRate: 0,
  sampled: false,
  warming: true,
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
  held: Row[];
  heldMatched: number;
  counts: Counts;
  matched: number;
  received: Rates;
  samples: { t: number; jetstream: number; plc: number; matched: number }[];
  lastBlip: Rates;
  /** When the matched count last went back to zero. */
  zeroSince: number;
  /** Collections seen in commits, and how often, for the collection field. */
  seenCollections: Map<string, number>;
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
    lastBlip: { jetstream: 0, plc: 0 },
    zeroSince: Date.now(),
    seenCollections: new Map(),
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

// Suggestions for the two token fields: accounts from the AppView typeahead
// the sign-in field uses, collections from the UFOs lexicon search.
async function suggestAccounts(query: string, signal: AbortSignal): Promise<Suggestion[]> {
  if (!shouldQueryHandleTypeahead(query)) return [];
  const actors = await searchActorsTypeahead(query.replace(/^@/, ''), { limit: 6, signal });
  return actors.map((a) => ({
    value: a.handle,
    title: a.displayName?.trim() || a.handle,
    detail: a.handle,
    avatar: a.avatar ?? '',
    did: a.did,
  }));
}

/** Most collections the monitor tallies from the live stream, for suggestions. */
const MAX_SEEN_COLLECTIONS = 5_000;

/**
 * Collection suggestions, best first: the namespace itself as a wildcard
 * when the text is one, then collections this page has seen go by, most
 * frequent first, then the UFOs lexicon search. The search alone ranks
 * alphabetically and is full of one-account test NSIDs (`app.bsky.graph.aa`
 * before `app.bsky.graph.follow`), so its results need more than one
 * account to be offered.
 */
async function suggestCollections(
  query: string,
  signal: AbortSignal,
  seen: Map<string, number>,
): Promise<Suggestion[]> {
  const q = query.toLowerCase().replace(/\.\*?$/, '');
  const items: Suggestion[] = [];
  const wildcard = q.includes('.') ? parseCollectionToken(`${q}.*`) : null;
  if (wildcard) items.push({ value: wildcard, title: wildcard, detail: 'Every collection in this namespace' });

  const local = [...seen]
    .filter(([nsid]) => nsid.toLowerCase().includes(q))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  for (const [nsid, n] of local) {
    items.push({ value: nsid, title: nsid, detail: `${formatCount(n)} seen on this page` });
  }

  if (items.length < 7) {
    const matches = await searchLexicons(query, signal);
    for (const m of matches.sort((a, b) => b.dids_estimate - a.dids_estimate)) {
      if (items.length >= 7 || m.dids_estimate < 2) break;
      if (items.some((i) => i.value === m.nsid)) continue;
      items.push({ value: m.nsid, title: m.nsid, detail: `${formatCount(m.dids_estimate)} accounts` });
    }
  }
  return items;
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
 *
 * Laid out like the explorer's landings: the intro's copy on the left and
 * the ways in (here, preset views) on the right, then one card whose head,
 * tinted filter band and rows follow the feedback board and the lexicon
 * cards.
 */
export default function StreamMonitor({ intro }: { intro: ReactNode }) {
  const searchParams = useSearchParams();
  const [view, setView] = useState<MonitorView>(() => viewFromSearch(searchParams));
  const hidden = useSyncExternalStore(subscribeVisibility, getHidden, getHiddenOnServer);
  const [paused, setPaused] = useState(false);
  const [scrolledAway, setScrolledAway] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [socket, setSocket] = useState<Record<StreamSource, SocketStatus>>({
    jetstream: 'connecting',
    plc: 'connecting',
  });
  // Handle → DID, or null when it would not resolve.
  const [handleDids, setHandleDids] = useState<Record<string, string | null>>({});
  const requested = useRef(new Set<string>());
  const live = useRef<LiveState>(createLiveState());
  const listRef = useRef<HTMLDivElement>(null);
  const dots = useRef<Record<StreamSource, HTMLSpanElement | null>>({ jetstream: null, plc: null });

  const search = viewToSearch(view);

  // Keep the address bar in step, so the view can be bookmarked or shared.
  useEffect(() => {
    const next = `${window.location.pathname}${search ? `?${search}` : ''}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', next);
    }
  }, [search]);

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
    if (probe.collection) {
      const seen = s.seenCollections;
      const n = seen.get(probe.collection);
      if (n !== undefined) seen.set(probe.collection, n + 1);
      else if (seen.size < MAX_SEEN_COLLECTIONS) seen.set(probe.collection, 1);
    }
    // The live dot ripples on data rather than blinking on a timer, as the
    // explorer's Live button does (motion.css, "Live indicator").
    const now = Date.now();
    if (now - s.lastBlip[probe.source] > BLIP_MS) {
      s.lastBlip[probe.source] = now;
      replay(dots.current[probe.source], 'data-blip');
    }
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
      s.lastDropAt = now;
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

      s.samples.push({ t: now, jetstream: s.received.jetstream, plc: s.received.plc, matched: s.matched });
      while (s.samples.length > 2 && now - s.samples[1].t >= RATE_WINDOW_MS) s.samples.shift();
      const first = s.samples[0];
      const span = (now - first.t) / 1000;
      const per = (n: number) => (span > 0 ? Math.max(0, n) / span : 0);
      const rates: Rates = {
        jetstream: per(s.received.jetstream - first.jetstream),
        plc: per(s.received.plc - first.plc),
      };
      const matchedRate = per(s.matched - first.matched);
      const accent = matchedRate < CALM_RATE;

      const fresh: Row[] = [];
      for (const list of s.pending.values()) for (const build of list) fresh.push({ ...build(), accent });
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
        matchedRate,
        sampled: now - s.lastDropAt < SAMPLED_NOTE_MS,
        warming: s.matched === 0 && now - s.zeroSince < WARMUP_MS,
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
    s.samples = [];
    s.zeroSince = Date.now();
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

  const suggestSeenCollections = useCallback(
    (query: string, signal: AbortSignal) => suggestCollections(query, signal, live.current.seenCollections),
    [],
  );

  // On a phone the Contains filter moves into the bottom bar, as a repo's
  // lexicon filter does; wider, the bar keeps its jump search.
  useChromeBarField({
    placeholder: 'Filter events…',
    label: 'Filter events by text',
    value: view.text,
    onChange: (text) => changeView({ text }),
    resultsId: CHROME_RESULTS_ID,
    inPage: true,
  });

  // ── Render ──────────────────────────────────────────────────────────────

  const visible = useMemo(() => rows.filter((r) => matchesFilter(filter, r)), [rows, filter]);
  const calm = stats.matchedRate < CALM_RATE;
  const lookup = held || calm;

  const connection = (source: StreamSource): Connection => {
    if (!sourceShown(view.source, source)) return 'off';
    if (accountsPending && noAccountResolved) return 'waiting';
    if (!(source === 'jetstream' ? jetstreamWanted : plcWanted)) return 'off';
    if (hidden) return 'background';
    return socket[source];
  };
  const shownSources = SOURCES.filter(({ id }) => sourceShown(view.source, id));
  const connecting = shownSources.some(({ id }) => {
    const c = connection(id);
    return c === 'connecting' || c === 'reconnecting';
  });

  const accountTokens: FieldToken[] = view.accounts.map((a) => {
    if (a.startsWith('did:')) return { value: a };
    if (!(a in handleDids)) return { value: a, state: 'pending', note: 'resolving…' };
    const did = handleDids[a];
    return did
      ? { value: a, title: did }
      : { value: a, state: 'error', note: 'not found', title: 'This handle did not resolve to a DID' };
  });

  let emptyMessage = 'Waiting for matching events. With narrow filters this can take a while.';
  if (!jetstreamWanted && !plcWanted && !noAccountResolved) emptyMessage = 'Every event type is switched off.';
  if (accountsPending && noAccountResolved) emptyMessage = 'Resolving handles…';
  else if (noAccountResolved) emptyMessage = 'None of those accounts resolved to a DID.';
  if (hidden) emptyMessage = 'Paused while this tab is in the background.';
  const showSkeleton =
    visible.length === 0 && !hidden && (connecting || ((jetstreamWanted || plcWanted) && stats.warming));

  const via = shownSources.map((s) => s.short).join(' · ');

  return (
    <div className="fn-tools fn-sm">
      <AppearIn rise>
        <header className="fn-x-intro fn-sm-intro">
          <div className="fn-x-intro-copy">{intro}</div>
          <div className="fn-x-intro-search fn-sm-presets">
            <div className="fn-x-tries">
              <span>Try</span>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="fn-chip fn-sm-preset"
                  aria-pressed={search === viewToSearch(preset.view)}
                  title={preset.hint}
                  onClick={() => {
                    changeView(preset.view);
                    showLatest();
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </header>
      </AppearIn>

      <AppearIn delay={0.06}>
        <section className="fn-list-card fn-sm-card" aria-labelledby="fn-sm-title" id={CHROME_RESULTS_ID}>
          <div className="fn-list-card-head fn-sm-head">
            <div className="fn-list-card-title-row">
              <span className="fn-list-card-icon" aria-hidden>
                <Activity size={14} />
              </span>
              <h2 id="fn-sm-title" className="fn-list-card-title">
                Live events
              </h2>
              {via && <span className="fn-list-card-via">via {via}</span>}
              <div className="fn-sm-head-actions">
                <button type="button" className="fx-btn" onClick={() => setPaused((p) => !p)}>
                  {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
                  {paused ? 'Resume' : 'Pause'}
                </button>
                <button type="button" className="fx-btn" onClick={clear} title="Clear the list and counts">
                  <Eraser size={14} aria-hidden />
                  Clear
                </button>
                <ShareLinkChip
                  url={`/tools/stream${search ? `?${search}` : ''}`}
                  title="Copy a link to this view"
                  iconOnly
                  className="fx-title-share"
                />
              </div>
            </div>
            <div className="fn-sm-statusline">
              {shownSources.map(({ id, label }) => (
                <SourceStatus
                  key={id}
                  label={label}
                  state={connection(id)}
                  rate={stats.rates[id]}
                  dotRef={(el) => {
                    dots.current[id] = el;
                  }}
                />
              ))}
              <span className="fn-sm-matched">
                <strong>{stats.matched.toLocaleString()}</strong> matched
              </span>
            </div>
          </div>

          <div className="fn-sm-band">
            <div className="fn-sm-band-row">
              <Segmented
                ariaLabel="Source"
                options={SOURCE_OPTIONS}
                value={view.source}
                onChange={(source) => changeView({ source })}
              />
              {search && (
                <button type="button" className="fn-sm-reset" onClick={() => changeView(DEFAULT_VIEW)}>
                  Reset filters
                </button>
              )}
            </div>
            <div className="fn-sm-kinds">
              {shownSources.map(({ id, label }) => (
                <div key={id} role="group" aria-label={`${label} events`} className="fn-sm-kind-group">
                  {view.source === 'both' && <span className="fn-sm-kind-source">{label}</span>}
                  {STREAM_KINDS.filter((k) => k.source === id).map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      className="fn-fb-chip fn-sm-kind"
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
            <div className="fn-sm-fields">
              <TokenField
                label="Accounts"
                icon={<User size={14} />}
                placeholder="Accounts: handle or DID"
                hint="Handles or DIDs, for both sources. Jetstream sends only these accounts' events."
                tokens={accountTokens}
                max={MAX_ACCOUNTS}
                parse={(raw) => {
                  const token = parseAccountToken(raw);
                  if (!token) return { error: `“${raw}” isn’t a handle or DID.` };
                  return { value: token.kind === 'did' ? token.did : token.handle };
                }}
                onChange={(accounts) => changeView({ accounts })}
                suggest={suggestAccounts}
                onPick={(s) => {
                  // The typeahead already knows the DID; no need to resolve it again.
                  if (s.did) {
                    requested.current.add(s.value);
                    setHandleDids((prev) => ({ ...prev, [s.value]: s.did! }));
                  }
                  changeView({ accounts: [...view.accounts, s.value] });
                }}
              />
              {view.source !== 'plc' && (
                <TokenField
                  label="Collections"
                  icon={<Braces size={14} />}
                  placeholder="Collections: NSID or app.bsky.*"
                  hint="NSIDs, or a namespace ending in .* (app.bsky.graph.*). Narrows Jetstream commits; identity and account events have no collection and still show."
                  tokens={view.collections.map((value) => ({ value }))}
                  max={MAX_COLLECTIONS}
                  parse={(raw) => {
                    const nsid = parseCollectionToken(raw);
                    return nsid ? { value: nsid } : { error: `“${raw}” isn’t an NSID or a namespace like app.bsky.*` };
                  }}
                  onChange={(collections) => changeView({ collections })}
                  suggest={suggestSeenCollections}
                />
              )}
              <label className="fx-field fn-sm-text" title="Matched anywhere in the event’s JSON: post text, handles, URIs, PDS hosts">
                <Search size={14} aria-hidden />
                <span className="fn-sr-only">Contains text</span>
                <input
                  type="search"
                  value={view.text}
                  placeholder="Contains text"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => changeView({ text: e.target.value })}
                />
              </label>
            </div>
          </div>

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

          {/* The column heads scroll with the rows (sticky), so a scrollbar
              narrows both alike and the columns stay lined up. */}
          <div
            ref={listRef}
            className="fn-sm-scroll"
            onScroll={(e) => setScrolledAway(e.currentTarget.scrollTop > 8)}
          >
            <ColumnHeads />
            <ol className="fn-sm-list" aria-label="Events, newest first">
              {showSkeleton ? (
                <SkeletonRows />
              ) : visible.length === 0 ? (
                <li className="fn-sm-empty">{emptyMessage}</li>
              ) : (
                visible.map((item) => (
                  <EventRow
                    key={item.id}
                    item={item}
                    open={openId === item.id}
                    lookup={lookup}
                    onToggle={toggleRow}
                    onWatchAccount={watchAccount}
                    onWatchCollection={watchCollection}
                  />
                ))
              )}
            </ol>
          </div>

          <footer className="fn-sm-foot">
            {stats.sampled
              ? `Busy stream: the list keeps up to ${(PER_KIND_PER_FLUSH * 1000) / FLUSH_MS} events a second of each type. The counts include every event.`
              : `Newest first. The last ${MAX_ROWS} are kept.`}
            {!calm && !held && ' Pause to see handles.'}
          </footer>
        </section>
      </AppearIn>
    </div>
  );
}

function SourceStatus({
  label,
  state,
  rate,
  dotRef,
}: {
  label: string;
  state: Connection;
  rate: number;
  dotRef: (el: HTMLSpanElement | null) => void;
}) {
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
      <span ref={dotRef} className="fx-dot" data-live={state === 'open' || undefined} aria-hidden />
      <span className="fn-sm-status-label">{label}</span>
      <span className="fn-sm-status-text">{text[state]}</span>
    </span>
  );
}

/**
 * The account a row is about: the handle once known, the short DID until
 * then. Looked up only while `lookup` is on and the cell is on screen; the
 * lookup is cached and shared (resolveDidHandle), so a handle seen once is
 * free after that.
 */
function AccountCell({ did, lookup }: { did: string; lookup: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [handle, setHandle] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!lookup || handle || !el) return undefined;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      resolveDidHandle(did).then((h) => {
        if (!cancelled && h) setHandle(h);
      });
    });
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [did, lookup, handle]);
  return (
    <code ref={ref} className="fn-sm-account" data-handle={handle ? '' : undefined} title={did}>
      {handle ? `@${handle}` : shortDid(did)}
    </code>
  );
}

/**
 * A record's preview line, with the references likes, reposts and follows
 * carry cut down to what tells them apart: `feed.post by did:plc:abcd…wxyz`
 * rather than the whole at:// URI.
 */
function compactPreview(preview: string): { text: string; mono: boolean } {
  const parsed = preview.startsWith('at://') ? parseAtUri(preview) : null;
  if (parsed) {
    const tail = parsed.collection ? parsed.collection.split('.').slice(-2).join('.') : 'repo';
    return { text: `${tail} by ${shortDid(parsed.repo)}`, mono: true };
  }
  if (/^did:[a-z]+:\S+$/.test(preview)) return { text: shortDid(preview), mono: true };
  return { text: preview, mono: false };
}

/** The "what" and "detail" cells, which mean different things per kind. */
function Summary({ item }: { item: StreamItem }) {
  switch (item.kind) {
    case 'create':
    case 'update':
    case 'delete':
      return (
        <>
          <span className="fn-sm-nsid" title={item.collection}>
            {item.collection}
          </span>
          {item.preview ? (
            <PreviewText preview={item.preview} />
          ) : (
            <span className="fn-sm-detail-mono">{item.rkey}</span>
          )}
        </>
      );
    case 'identity':
      return (
        <>
          {item.handle ? (
            <span className="fn-sm-handle">@{item.handle}</span>
          ) : (
            <span className="fn-sm-muted">identity refreshed</span>
          )}
          <span />
        </>
      );
    case 'account':
      return (
        <>
          <span>
            <span className="fn-sm-pill" data-active={item.active || undefined}>
              {item.active ? 'active' : item.status ?? 'inactive'}
            </span>
          </span>
          <span />
        </>
      );
    case 'plc-tombstone':
      return (
        <>
          <span className="fn-sm-muted">tombstoned</span>
          <span />
        </>
      );
    default:
      return (
        <>
          {item.handle ? (
            <span className="fn-sm-handle" title={item.handle}>
              @{item.handle}
            </span>
          ) : (
            <span className="fn-sm-muted">no handle</span>
          )}
          <span className="fn-sm-detail-mono" title={item.pds}>
            {item.pds ?? 'no PDS'}
          </span>
        </>
      );
  }
}

function PreviewText({ preview }: { preview: string }) {
  const { text, mono } = compactPreview(preview);
  return (
    <span className={mono ? 'fn-sm-detail-mono' : 'fn-sm-detail-text'} title={preview}>
      {text}
    </span>
  );
}

const EventRow = memo(function EventRow({
  item,
  open,
  lookup,
  onToggle,
  onWatchAccount,
  onWatchCollection,
}: {
  item: Row;
  open: boolean;
  lookup: boolean;
  onToggle: (id: number) => void;
  onWatchAccount: (did: string) => void;
  onWatchCollection: (collection: string) => void;
}) {
  const meta = KIND_META.get(item.kind)!;
  const at = new Date(item.time);
  // PLC rows name the handle themselves, and so do identity events that
  // carry one; looking those accounts up again would only repeat it.
  const resolvable = item.source === 'jetstream' && !(item.kind === 'identity' && item.handle);
  return (
    // data-fresh runs the feed's one-off arrival accent (globals.css), only
    // for rows that arrived while the list was calm enough to notice it.
    <li className="fn-sm-row explore-jetstream-row" data-fresh={item.accent ? '' : undefined}>
      <button
        type="button"
        className="fn-sm-row-main fn-sm-grid"
        aria-expanded={open}
        onClick={() => onToggle(item.id)}
      >
        <time className="fn-sm-time" dateTime={at.toISOString()} title={at.toISOString()}>
          {timeFormat.format(at)}
        </time>
        <span className="fn-sm-badge" data-kind={item.kind}>
          {meta.badge}
        </span>
        {resolvable ? (
          <AccountCell did={item.did} lookup={lookup || open} />
        ) : (
          <code className="fn-sm-account" title={item.did}>
            {shortDid(item.did)}
          </code>
        )}
        <Summary item={item} />
      </button>
      {open && (
        <RowDetail item={item} onWatchAccount={onWatchAccount} onWatchCollection={onWatchCollection} />
      )}
    </li>
  );
});

type DetailView = 'preview' | 'fields' | 'changes' | 'json';

function RowDetail({
  item,
  onWatchAccount,
  onWatchCollection,
}: {
  item: StreamItem;
  onWatchAccount: (did: string) => void;
  onWatchCollection: (collection: string) => void;
}) {
  const commit =
    item.source === 'jetstream' && (item.data as { kind?: string }).kind === 'commit'
      ? (item.data as { commit: { record?: Record<string, unknown>; cid?: string } }).commit
      : null;
  const record = commit?.record && item.collection && item.rkey ? commit.record : null;
  const hasPreview =
    !!record &&
    recordHasRichCard(item.collection!, item.rkey!) &&
    item.collection !== 'app.bsky.actor.profile';

  const views: { value: DetailView; label: string }[] = [];
  if (hasPreview) views.push({ value: 'preview', label: 'Preview' });
  if (record) views.push({ value: 'fields', label: 'Fields' });
  if (item.source === 'plc') views.push({ value: 'changes', label: 'Changes' });
  views.push({ value: 'json', label: 'JSON' });
  const [shown, setShown] = useState<DetailView>(views[0].value);

  const uri = item.collection && item.rkey ? `at://${item.did}/${item.collection}/${item.rkey}` : null;

  return (
    <div className="fn-sm-detail">
      <div className="fn-sm-detail-bar">
        {views.length > 1 && (
          <Segmented ariaLabel="Event view" options={views} value={shown} onChange={setShown} />
        )}
        <div className="fn-sm-actions">
          <Link href={item.href} prefetch={false} className="fx-btn">
            Open in explorer
          </Link>
          <button type="button" className="fx-btn" onClick={() => onWatchAccount(item.did)}>
            Watch account
          </button>
          {item.collection && (
            <button type="button" className="fx-btn" onClick={() => onWatchCollection(item.collection!)}>
              Watch collection
            </button>
          )}
          <CopyButton value={JSON.stringify(item.data, null, 2)} label="Copy JSON" />
        </div>
      </div>
      {shown === 'preview' && record && uri && (
        <div className="fn-sm-preview">
          <RichRecordCard
            handle={item.did}
            did={item.did}
            collection={item.collection!}
            rkey={item.rkey!}
            record={{ uri, cid: commit?.cid ?? '', value: record }}
            identity={{ did: item.did, handle: null, pds: '', repoStatus: null }}
          />
        </div>
      )}
      {shown === 'fields' && record && uri && (
        <RecordPreview
          record={{ uri, cid: commit?.cid, value: record }}
          collection={item.collection!}
          handle={item.did}
          rkey={item.rkey!}
          hideExplorerCtas
        />
      )}
      {shown === 'changes' && <PlcChanges entry={item.data as PlcStreamEntry} />}
      {shown === 'json' && <LinkifiedJson value={item.data} className="explore-json fn-sm-json" />}
    </div>
  );
}

function shortValue(value: string | null): string {
  if (!value) return '—';
  return value.length > 40 ? `${value.slice(0, 24)}…${value.slice(-8)}` : value;
}

/**
 * What a PLC operation changed, read against the operation before it in the
 * DID's audit log. Fetched when the row is opened, not before: one request
 * for a row someone asked about, none for the rest.
 */
function PlcChanges({ entry }: { entry: PlcStreamEntry }) {
  const [state, setState] = useState<{ changes: PlcChange[] } | { error: string } | null>(null);
  const tombstone = plcKind(entry.operation) === 'plc-tombstone';
  const genesis = plcKind(entry.operation) === 'plc-new';

  useEffect(() => {
    if (tombstone) return undefined;
    let cancelled = false;
    const load = genesis
      ? Promise.resolve({ changes: describePlcChange(null, entry.operation) })
      : getPlcAuditLog(entry.did).then((log) => {
          const at = log.findIndex((e) => e.cid === entry.cid);
          if (at < 0) return { error: 'This operation isn’t in the DID’s log yet. Try again in a moment.' };
          const before = log.slice(0, at).reverse().find((e) => !e.nullified);
          return { changes: describePlcChange(before?.operation ?? null, entry.operation) };
        });
    load
      .catch(() => ({ error: 'Couldn’t read the DID’s log from plc.directory.' }))
      .then((result) => {
        if (!cancelled) setState(result);
      });
    return () => {
      cancelled = true;
    };
  }, [entry, genesis, tombstone]);

  if (tombstone) {
    return <p className="fn-sm-note">Tombstoned: this DID is deactivated and can’t be updated again.</p>;
  }
  if (!state) return <p className="fn-sm-note">Reading the DID’s log…</p>;
  if ('error' in state) return <p className="fn-sm-note">{state.error}</p>;
  if (!state.changes.length) {
    return <p className="fn-sm-note">No change to the handle, PDS or keys. Another field was rewritten.</p>;
  }
  return (
    <dl className="fn-sm-changes">
      {state.changes.map((c) => (
        <div key={c.label} className="fn-sm-change">
          <dt>{c.label}</dt>
          <dd>
            {c.label === 'Rotation keys' ? (
              'changed'
            ) : genesis ? (
              <code title={c.to ?? undefined}>{shortValue(c.to)}</code>
            ) : (
              <>
                <code title={c.from ?? undefined}>{shortValue(c.from)}</code>
                <span aria-label="to"> → </span>
                <code title={c.to ?? undefined}>{shortValue(c.to)}</code>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ColumnHeads() {
  return (
    <div className="fn-col-head fn-sm-grid fn-sm-cols" aria-hidden>
      <span>Time</span>
      <span>Event</span>
      <span>Account</span>
      <span>What</span>
      <span>Detail</span>
    </div>
  );
}

/**
 * Placeholder rows while the sockets connect: the live rows' grid in the
 * site's .fn-skel bars, so the list holds its shape when the first events
 * replace them.
 */
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 10 }, (_, i) => (
        <li key={i} aria-hidden className="fn-sm-row fn-sm-skel-row" style={{ opacity: 1 - i * 0.07 }}>
          <span className="fn-sm-grid fn-sm-row-main">
            <span className="fn-skel fn-sm-bar" style={{ width: '7ch' }} />
            <span className="fn-skel fn-sm-bar" style={{ width: '6ch' }} />
            <span className="fn-skel fn-sm-bar" style={{ width: '14ch' }} />
            <span className="fn-skel fn-sm-bar" style={{ width: `${14 + (i % 4) * 3}ch` }} />
            <span className="fn-skel fn-sm-bar" style={{ width: `${30 - (i % 3) * 6}%` }} />
          </span>
        </li>
      ))}
    </>
  );
}

/**
 * What the static page shows until the monitor renders (it reads its filters
 * from the query string, so it renders in the browser): the same intro, and
 * the card's outline in skeleton bars, so nothing moves when it arrives.
 */
export function StreamMonitorSkeleton({ intro }: { intro: ReactNode }) {
  return (
    <div className="fn-tools fn-sm" aria-busy>
      <header className="fn-x-intro fn-sm-intro">
        <div className="fn-x-intro-copy">{intro}</div>
        <div className="fn-x-intro-search fn-sm-presets">
          <div className="fn-x-tries">
            <span>Try</span>
            {PRESETS.map((p) => (
              <span key={p.id} className="fn-chip fn-sm-preset">
                {p.label}
              </span>
            ))}
          </div>
        </div>
      </header>
      <section className="fn-list-card fn-sm-card" aria-hidden>
        <div className="fn-list-card-head fn-sm-head">
          <div className="fn-list-card-title-row">
            <span className="fn-list-card-icon">
              <Activity size={14} />
            </span>
            <span className="fn-list-card-title">Live events</span>
          </div>
          <div className="fn-sm-statusline">
            <span className="fn-skel fn-sm-bar" style={{ width: '22ch' }} />
          </div>
        </div>
        <div className="fn-sm-band">
          <span className="fn-skel" style={{ width: 260, height: 34 }} />
          <span className="fn-skel" style={{ width: '70%', height: 28 }} />
          <span className="fn-skel" style={{ width: '100%', height: 36 }} />
        </div>
        <div className="fn-sm-scroll">
          <ColumnHeads />
          <ol className="fn-sm-list">
            <SkeletonRows />
          </ol>
        </div>
      </section>
    </div>
  );
}
