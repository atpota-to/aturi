'use client';

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowUp,
  Braces,
  Check,
  ChevronDown,
  ChevronUp,
  Eraser,
  ExternalLink,
  Eye,
  Info,
  Pause,
  Play,
  Search,
  SlidersHorizontal,
  Square,
  Unplug,
  User,
  X,
} from 'lucide-react';
import CopyButton from '@/components/explore/CopyButton';
import LinkifiedJson from '@/components/explore/LinkifiedJson';
import RichRecordCard, { recordHasRichCard } from '@/components/explore/RichRecordCard';
import ShareLinkChip from '@/components/explore/ShareLinkChip';
import {
  useChromeBarField,
  useChromeBarPanel,
  useChromeBarTransport,
} from '@/components/explore/ChromeBarContext';
import { Segmented } from '@/components/explore/lexicons/primitives';
import { useMediaQuery } from '@/components/explore/useIsNarrow';
import RecordPreview from '@/components/RecordPreview';
import SegmentThumb from '@/components/SegmentThumb';
import { replay } from '@/lib/motion';
import { getSiteMenuSnapshot, setSiteMenuOpen, subscribeSiteMenu } from '@/lib/siteMenu';
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

/**
 * Where the layout changes, by viewport width; tools.css uses the same two.
 * Up to a phone's width the bottom toolbar takes over the transport, the
 * text filter and the filters button (ExploreChromeBar), as the explorer's
 * in-page fields hand over at 640px. Below a desktop's, the filters and the
 * open event become drawers over the list rather than columns beside it.
 */
const PHONE_QUERY = '(max-width: 640px)';
const DRAWERS_QUERY = '(max-width: 1023px)';
const FILTERS_ID = 'fn-sm-filters';
const INSPECTOR_ID = 'fn-sm-inspector';

const KIND_META = new Map(STREAM_KINDS.map((k) => [k.id, k]));
const SOURCES: { id: StreamSource; label: string; short: string }[] = [
  { id: 'jetstream', label: 'Jetstream', short: 'Jetstream' },
  { id: 'plc', label: 'PLC directory', short: 'PLC' },
];
const SOURCE_OPTIONS: { value: SourceChoice; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'jetstream', label: 'Jetstream' },
  { value: 'plc', label: 'PLC' },
];

/**
 * Live: connected, and the list moves. Paused: still connected, counting,
 * and holding new rows above the list. Stopped: both sockets closed, so
 * nothing is downloaded. Not kept in the link: a shared view always opens
 * live.
 */
type Transport = 'live' | 'paused' | 'stopped';

type Counts = Record<StreamKind, number>;
type Rates = Record<StreamSource, number>;
/** A listed event, and whether it arrived while the list was calm. */
type EventRow = StreamItem & { gap?: undefined; accent: boolean };
/**
 * Where the stream was stopped and played again: nothing in between was
 * received, and the list says so rather than closing over the hole.
 */
type GapRow = { gap: true; id: number; from: number; to: number };
type Row = EventRow | GapRow;

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

type Connection = SocketStatus | 'off' | 'background' | 'waiting' | 'stopped';

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

function formatSpan(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function connectionText(state: Connection, rate: number): string {
  switch (state) {
    case 'open':
      return formatRate(rate);
    case 'connecting':
      return 'connecting…';
    case 'reconnecting':
      return 'reconnecting…';
    case 'off':
      return 'off';
    case 'stopped':
      return 'stopped';
    case 'background':
      return 'paused in background';
    default:
      return 'waiting for handles';
  }
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
 * Sizes the monitor to the window: from where it starts, under the site
 * header, to the window's foot, less the phone's bottom toolbar
 * (--explore-chrome-h, which ExploreChromeBar measures and which is 0 where
 * the bar isn't drawn). So the page itself never scrolls; only the list and
 * the panels do.
 *
 * The start is summed from offsetTop, which leaves out the transform the
 * page transition settles the page in with, and read again when the header
 * changes height (a larger text size) or the window does. tools.css carries
 * a fallback for the first paint.
 */
function useFillViewport(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      let top = 0;
      for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
        top += node.offsetTop;
      }
      el.style.setProperty('--fn-sm-top', `${top}px`);
    };
    measure();
    const header =
      el.closest('[data-page-key]')?.querySelector('.fn-header') ?? document.querySelector('.fn-header');
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref]);
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
 * scrolled away from the top, or has an event open, so a row can be read
 * without it sliding away. Stop goes further and closes both sockets.
 *
 * Laid out as a dashboard that fills the window under the site header:
 * a toolbar (title, transport, status), the filters in a rail on the left,
 * the list, and the open event in an inspector on the right. Below desktop
 * width the rail and the inspector become drawers, and on a phone sheets
 * that rise out of the bottom toolbar, which carries the transport, the
 * text filter and the filters button (ExploreChromeBar).
 */
export default function StreamMonitor({ about }: { about: ReactNode }) {
  const searchParams = useSearchParams();
  const [view, setView] = useState<MonitorView>(() => viewFromSearch(searchParams));
  const hidden = useSyncExternalStore(subscribeVisibility, getHidden, getHiddenOnServer);
  const [transport, setTransport] = useState<Transport>('live');
  const [stoppedSince, setStoppedSince] = useState<number | null>(null);
  const [scrolledAway, setScrolledAway] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  // The event the inspector shows. Kept when it closes, so a drawer slides
  // away with its contents rather than empty.
  const [inspectId, setInspectId] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dots = useRef<Record<StreamSource | 'transport' | 'tally', HTMLSpanElement | null>>({
    jetstream: null,
    plc: null,
    transport: null,
    tally: null,
  });
  const drawers = useMediaQuery(DRAWERS_QUERY);
  useFillViewport(rootRef);

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

  const held = transport === 'paused' || scrolledAway || openId !== null;
  const holdRef = useRef(held);
  useEffect(() => {
    holdRef.current = held;
  }, [held]);
  // Only a live stream ripples the transport's dot; paused, it's still
  // connected but not what the dot stands for.
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = transport === 'live';
  }, [transport]);

  const stopped = transport === 'stopped';
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
      if (liveRef.current) {
        replay(dots.current.transport, 'data-blip');
        replay(dots.current.tally, 'data-blip');
      }
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

  // Stopped, neither socket is open: Stop is the way to download nothing.
  useEffect(() => {
    if (!jetstreamWanted || hidden || stopped) return undefined;
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
  }, [jetstreamWanted, hidden, stopped, didsKey, collectionsKey, ingest, setSocketStatus]);

  useEffect(() => {
    if (!plcWanted || hidden || stopped) return undefined;
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
  }, [plcWanted, hidden, stopped, ingest, setSocketStatus]);

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

      const fresh: EventRow[] = [];
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
    setInspectId(null);
  }, [resetCounts]);

  const showLatest = useCallback(() => {
    setTransport((t) => (t === 'paused' ? 'live' : t));
    setOpenId(null);
    setScrolledAway(false);
    listRef.current?.scrollTo({ top: 0 });
  }, []);

  function pause(): void {
    if (transport === 'live') setTransport('paused');
  }

  function stop(): void {
    if (stopped) return;
    setStoppedSince(Date.now());
    setTransport('stopped');
  }

  /**
   * Back to live. From a stop the sockets reconnect at the live edge, the
   * rates start over, and the list marks the gap, ahead of anything that
   * arrives after it.
   */
  function play(): void {
    if (transport === 'live') return;
    if (stopped) {
      const s = live.current;
      s.samples = [];
      s.zeroSince = Date.now();
      if (stoppedSince !== null) {
        const gap: GapRow = { gap: true, id: s.nextId++, from: stoppedSince, to: Date.now() };
        if (holdRef.current) s.held = [gap, ...s.held].slice(0, MAX_ROWS);
        else setRows((prev) => [gap, ...prev].slice(0, MAX_ROWS));
      }
      setStoppedSince(null);
      setSocket({ jetstream: 'connecting', plc: 'connecting' });
    }
    setTransport('live');
  }

  const openEvent = useCallback((id: number | null) => {
    setOpenId(id);
    if (id !== null) {
      setInspectId(id);
      setFiltersOpen(false);
    }
  }, []);

  const toggleRow = useCallback((id: number) => {
    setOpenId((prev) => (prev === id ? null : id));
    setInspectId(id);
    setFiltersOpen(false);
  }, []);

  function toggleFilters(): void {
    setSiteMenuOpen(false);
    // On a phone the filters and an open event are both sheets on the bar.
    if (!filtersOpen && window.matchMedia(PHONE_QUERY).matches) setOpenId(null);
    setFiltersOpen(!filtersOpen);
  }

  // The site menu is a sheet on the same toolbar: opening it puts the
  // filters away, and on a phone the open event too.
  useEffect(
    () =>
      subscribeSiteMenu(() => {
        if (!getSiteMenuSnapshot()) return;
        setFiltersOpen(false);
        if (window.matchMedia(PHONE_QUERY).matches) setOpenId(null);
      }),
    [],
  );

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

  // ── Derived ─────────────────────────────────────────────────────────────

  const visible = useMemo(
    () => rows.filter((r) => r.gap || matchesFilter(filter, r)),
    [rows, filter],
  );
  const calm = stats.matchedRate < CALM_RATE;
  const lookup = held || calm;

  const connection = (source: StreamSource): Connection => {
    if (!sourceShown(view.source, source)) return 'off';
    if (accountsPending && noAccountResolved) return 'waiting';
    if (!(source === 'jetstream' ? jetstreamWanted : plcWanted)) return 'off';
    if (stopped) return 'stopped';
    if (hidden) return 'background';
    return socket[source];
  };
  const shownSources = SOURCES.filter(({ id }) => sourceShown(view.source, id));
  const connecting = shownSources.some(({ id }) => {
    const c = connection(id);
    return c === 'connecting' || c === 'reconnecting';
  });

  // What the filters have set, for the filters buttons. The text filter is
  // in the bottom toolbar on a phone, in plain sight, so only the wider
  // button counts it.
  const shownKinds = STREAM_KINDS.filter((k) => sourceShown(view.source, k.source));
  const filterCount =
    (view.source !== 'both' ? 1 : 0) +
    (shownKinds.some((k) => !view.kinds.includes(k.id)) ? 1 : 0) +
    view.accounts.length +
    (view.source !== 'plc' ? view.collections.length : 0);
  const wideFilterCount = filterCount + (view.text.trim() ? 1 : 0);

  // ── Keyboard ────────────────────────────────────────────────────────────

  // Space pauses or resumes, S stops or plays, J and K step through events
  // (opening the newest if none is), Escape puts away the top layer. Keys the
  // site's shortcut engine has claimed (it calls preventDefault, and listens
  // first) are left to it, and so is typing.
  const visibleIds = useRef<number[]>([]);
  const keys = useRef<{
    togglePlay: () => void;
    toggleStop: () => void;
    step: (dir: number) => void;
    escape: () => boolean;
  }>({ togglePlay: () => {}, toggleStop: () => {}, step: () => {}, escape: () => false });
  useEffect(() => {
    visibleIds.current = visible.filter((r) => !r.gap).map((r) => r.id);
    keys.current = {
      togglePlay: () => (transport === 'live' ? pause() : play()),
      toggleStop: () => (stopped ? play() : stop()),
      step: (dir) => {
        const ids = visibleIds.current;
        if (!ids.length) return;
        const at = openId === null ? -1 : ids.indexOf(openId);
        const next = at < 0 ? ids[0] : ids[Math.min(ids.length - 1, Math.max(0, at + dir))];
        openEvent(next);
        requestAnimationFrame(() => {
          listRef.current?.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: 'nearest' });
        });
      },
      escape: () => {
        if (filtersOpen && drawers) {
          setFiltersOpen(false);
          return true;
        }
        if (openId !== null) {
          setOpenId(null);
          return true;
        }
        return false;
      },
    };
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') {
        if (keys.current.escape()) e.preventDefault();
        return;
      }
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]')) return;
      if (e.key === ' ') {
        // A focused button or link takes Space as a press.
        if (target?.closest('button, a, [role="button"]')) return;
        e.preventDefault();
        keys.current.togglePlay();
      } else if (e.key === 's' || e.key === 'S') {
        keys.current.toggleStop();
      } else if (e.key === 'j' || e.key === 'J') {
        keys.current.step(1);
      } else if (e.key === 'k' || e.key === 'K') {
        keys.current.step(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ── Chrome bar (phone) ──────────────────────────────────────────────────

  // On a phone the bottom toolbar becomes this page's: Pause and Stop, the
  // text filter and the filters button, with Back and Home moved into the
  // menu. Wider, the toolbar here holds them and the bar isn't drawn.
  useChromeBarTransport({ state: transport, connecting, onPlay: play, onPause: pause, onStop: stop });
  useChromeBarPanel({
    label: 'Filters',
    count: filterCount,
    open: filtersOpen,
    controls: FILTERS_ID,
    onToggle: toggleFilters,
  });
  useChromeBarField({
    placeholder: 'Filter events…',
    label: 'Filter events by text',
    value: view.text,
    onChange: (text) => changeView({ text }),
    inPage: true,
  });

  // ── Render ──────────────────────────────────────────────────────────────

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
  if (stopped) emptyMessage = 'Stopped. Play to connect again.';
  else if (hidden) emptyMessage = 'Paused while this tab is in the background.';
  const showSkeleton =
    !visible.some((r) => !r.gap) &&
    !hidden &&
    !stopped &&
    (connecting || ((jetstreamWanted || plcWanted) && stats.warming));

  const inspected = inspectId !== null ? rows.find((r): r is EventRow => r.id === inspectId && !r.gap) : undefined;
  const inspecting = openId !== null && inspected !== undefined;

  let heldLabel: string | null = null;
  if (stopped) {
    heldLabel = `Stopped${stoppedSince !== null ? ` at ${timeFormat.format(stoppedSince)}` : ''} · Play`;
  } else if (held) {
    if (stats.held > 0) {
      const n = `${stats.held.toLocaleString()} new ${stats.held === 1 ? 'event' : 'events'}`;
      heldLabel = transport === 'paused' ? `Paused · ${n} · Resume` : `${n} · Show latest`;
    } else if (transport === 'paused') heldLabel = 'Paused · Resume';
    else if (openId !== null) heldLabel = 'Holding while an event is open · Back to live';
    else heldLabel = 'Holding while you read · Back to live';
  }

  let tally: { state: string; label: string };
  if (stopped) tally = { state: 'stopped', label: 'Stopped' };
  else if (transport === 'paused') tally = { state: 'paused', label: 'Paused' };
  else if (connecting) tally = { state: 'connecting', label: 'Connecting' };
  else tally = { state: 'live', label: 'Live' };

  const presets = PRESETS.map((preset) => (
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
  ));

  return (
    <div
      ref={rootRef}
      className="fn-sm"
      data-filters={filtersOpen || undefined}
      data-inspect={inspecting || undefined}
    >
      <header className="fn-sm-toolbar">
        <div className="fn-sm-title">
          <button
            type="button"
            className="fx-btn fn-sm-filters-btn"
            aria-expanded={filtersOpen}
            aria-controls={FILTERS_ID}
            onClick={toggleFilters}
          >
            <SlidersHorizontal size={14} aria-hidden />
            Filters
            {wideFilterCount > 0 && <span className="fn-sm-filters-count">{wideFilterCount}</span>}
          </button>
          <Link href="/tools" className="fn-sm-crumb">
            Tools
          </Link>
          <span className="fn-sm-slash" aria-hidden>
            /
          </span>
          <h1 className="fn-sm-h1">Stream monitor</h1>
          <About>{about}</About>
        </div>

        <TransportControl
          state={transport}
          connecting={connecting}
          onPlay={play}
          onPause={pause}
          onStop={stop}
          dotRef={(el) => {
            dots.current.transport = el;
          }}
        />

        <div className="fn-sm-statusline">
          {shownSources.map(({ id, label, short }) => (
            <SourceStatus
              key={id}
              label={label}
              short={short}
              state={connection(id)}
              rate={stats.rates[id]}
              dotRef={(el) => {
                dots.current[id] = el;
              }}
            />
          ))}
        </div>

        <span className="fn-sm-matched">
          <strong>{stats.matched.toLocaleString()}</strong> matched
        </span>

        <div className="fn-sm-head-actions">
          <button
            type="button"
            className="fx-btn fn-sm-clear"
            onClick={clear}
            title="Clear the list and counts"
            aria-label="Clear the list and counts"
          >
            <Eraser size={14} aria-hidden />
            <span className="fn-sm-clear-label">Clear</span>
          </button>
          <ShareLinkChip
            url={`/tools/stream${search ? `?${search}` : ''}`}
            title="Copy a link to this view"
            iconOnly
            className="fx-title-share fn-sm-share"
          />
        </div>

        <span className="fn-sm-tally" data-state={tally.state}>
          {tally.state === 'paused' ? (
            <Pause size={9} fill="currentColor" aria-hidden />
          ) : tally.state === 'stopped' ? (
            <Square size={8} fill="currentColor" aria-hidden />
          ) : (
            <span
              ref={(el) => {
                dots.current.tally = el;
              }}
              className="fx-dot"
              data-live={tally.state === 'live' || undefined}
              aria-hidden
            />
          )}
          {tally.label}
        </span>

        <div className="fn-sm-presets fn-sm-strip-presets" role="group" aria-label="Views">
          {presets}
        </div>
      </header>

      <div className="fn-sm-body">
        <aside
          id={FILTERS_ID}
          className="fn-sm-rail"
          aria-label="Filters"
          inert={drawers && !filtersOpen}
        >
          <span className="fn-sm-grab" aria-hidden />
          <div className="fn-sm-rail-head">
            <h2 className="fn-sm-rail-title">Filters</h2>
            {search && (
              <button type="button" className="fn-sm-reset" onClick={() => changeView(DEFAULT_VIEW)}>
                Reset
              </button>
            )}
            <button type="button" className="fx-btn fn-sm-done" onClick={() => setFiltersOpen(false)}>
              Done
            </button>
          </div>

          <section className="fn-sm-sec fn-sm-sec-views">
            <h3 className="fn-sm-sec-title">Views</h3>
            <div className="fn-sm-presets" role="group" aria-label="Views">
              {presets}
            </div>
          </section>

          <section className="fn-sm-sec">
            <h3 className="fn-sm-sec-title">Source</h3>
            <Segmented
              ariaLabel="Source"
              options={SOURCE_OPTIONS}
              value={view.source}
              onChange={(source) => changeView({ source })}
            />
          </section>

          <section className="fn-sm-sec">
            <h3 className="fn-sm-sec-title">Event types</h3>
            {shownSources.map(({ id, label }) => (
              <div key={id} role="group" aria-label={`${label} events`} className="fn-sm-kgroup">
                <div className="fn-sm-kgroup-head">
                  <span>{label}</span>
                  <span className="fn-sm-kgroup-rate">{connectionText(connection(id), stats.rates[id])}</span>
                </div>
                <div className="fn-sm-klist">
                  {STREAM_KINDS.filter((k) => k.source === id).map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      className="fn-sm-kind"
                      aria-pressed={view.kinds.includes(k.id)}
                      title={k.hint}
                      onClick={() => toggleKind(k.id)}
                    >
                      <span className="fn-sm-check" aria-hidden>
                        <Check size={11} strokeWidth={3} />
                      </span>
                      <span className="fn-sm-badge" data-kind={k.id}>
                        {k.label}
                      </span>
                      <span className="fn-sm-kind-count">{formatCount(stats.counts[k.id])}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section className="fn-sm-sec">
            <h3 className="fn-sm-sec-title">Accounts</h3>
            <TokenField
              label="Accounts"
              icon={<User size={14} />}
              placeholder="Handle or DID"
              hint="Handles or DIDs, for both sources. Jetstream sends only these accounts’ events."
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
          </section>

          {view.source !== 'plc' && (
            <section className="fn-sm-sec">
              <h3 className="fn-sm-sec-title">Collections</h3>
              <TokenField
                label="Collections"
                icon={<Braces size={14} />}
                placeholder="NSID or app.bsky.*"
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
            </section>
          )}

          <section className="fn-sm-sec fn-sm-sec-text">
            <h3 className="fn-sm-sec-title">Contains text</h3>
            <label
              className="fx-field fn-sm-text"
              title="Matched anywhere in the event’s JSON: post text, handles, URIs, PDS hosts"
            >
              <Search size={14} aria-hidden />
              <span className="fn-sr-only">Contains text</span>
              <input
                type="search"
                value={view.text}
                placeholder="Post text, handles, URIs, hosts"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => changeView({ text: e.target.value })}
              />
            </label>
          </section>
        </aside>

        <section className="fn-sm-main" aria-label="Live events">
          {heldLabel && (
            <button
              type="button"
              className="fn-sm-held"
              data-tone={stopped ? 'stopped' : undefined}
              onClick={stopped ? play : showLatest}
            >
              {stopped || transport === 'paused' ? (
                <Play size={12} fill="currentColor" aria-hidden />
              ) : (
                <ArrowUp size={13} aria-hidden />
              )}
              {heldLabel}
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
              {visible.map((row) =>
                row.gap ? (
                  <GapLine key={row.id} gap={row} />
                ) : (
                  <EventLine
                    key={row.id}
                    item={row}
                    open={openId === row.id}
                    lookup={lookup}
                    onToggle={toggleRow}
                  />
                ),
              )}
              {showSkeleton ? (
                <SkeletonRows />
              ) : (
                !visible.some((r) => !r.gap) && <li className="fn-sm-empty">{emptyMessage}</li>
              )}
            </ol>
          </div>

          <footer className="fn-sm-foot">
            <span className="fn-sm-foot-note">
              {stats.sampled
                ? `Busy stream: the list keeps up to ${(PER_KIND_PER_FLUSH * 1000) / FLUSH_MS} events a second of each type. The counts include every event.`
                : `Newest first. The last ${MAX_ROWS} are kept.`}
              {!calm && !held && ' Pause to see handles.'}
            </span>
            <span className="fn-sm-keys" aria-hidden>
              <span>
                <kbd className="kbd">Space</kbd> pause
              </span>
              <span>
                <kbd className="kbd">S</kbd> stop
              </span>
              <span>
                <kbd className="kbd">J</kbd>
                <kbd className="kbd">K</kbd> step
              </span>
            </span>
          </footer>
        </section>

        <aside
          id={INSPECTOR_ID}
          className="fn-sm-insp"
          aria-label="Event"
          inert={!inspecting}
        >
          {inspected && (
            <Inspector
              item={inspected}
              onClose={() => setOpenId(null)}
              onStep={(dir) => keys.current.step(dir)}
              onWatchAccount={watchAccount}
              onWatchCollection={watchCollection}
            />
          )}
        </aside>

        <div
          className="fn-sm-scrim"
          aria-hidden
          onClick={() => {
            setFiltersOpen(false);
            setOpenId(null);
          }}
        />
      </div>
    </div>
  );
}

/**
 * Live, Pause and Stop, as the site's segmented control. The first option
 * reads as the state while it's chosen (Live, with the dot rippling on data)
 * and as the way back while it isn't (Play). Pause has nothing to hold
 * while stopped.
 */
function TransportControl({
  state,
  connecting,
  onPlay,
  onPause,
  onStop,
  dotRef,
}: {
  state: Transport;
  connecting: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  dotRef: (el: HTMLSpanElement | null) => void;
}) {
  const live = state === 'live';
  return (
    <div role="group" aria-label="Stream" className="fn-segmented fn-sm-transport">
      <SegmentThumb active={state} />
      <button
        type="button"
        className="fn-segmented-option"
        aria-pressed={live}
        onClick={onPlay}
        title={live ? 'Receiving' : 'Play (Space)'}
      >
        <span ref={dotRef} className="fx-dot" data-live={(live && !connecting) || undefined} aria-hidden />
        {!live ? 'Play' : connecting ? 'Connecting' : 'Live'}
      </button>
      <button
        type="button"
        className="fn-segmented-option"
        aria-pressed={state === 'paused'}
        disabled={state === 'stopped'}
        onClick={onPause}
        title="Pause: stay connected and hold new events (Space)"
      >
        <Pause size={12} fill="currentColor" aria-hidden />
        Pause
      </button>
      <button
        type="button"
        className="fn-segmented-option"
        aria-pressed={state === 'stopped'}
        onClick={onStop}
        title="Stop: disconnect from both streams (S)"
      >
        <Square size={11} fill="currentColor" aria-hidden />
        Stop
      </button>
    </div>
  );
}

/**
 * The intro, behind an ⓘ beside the title: the dashboard spends its height
 * on events, and the copy is there for whoever asks.
 */
function About({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="fn-sm-about">
      <button
        type="button"
        className="fn-sm-icon"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="About the stream monitor"
        title="About"
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={16} aria-hidden />
      </button>
      <div id={panelId} className="fn-sm-about-panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

function SourceStatus({
  label,
  short,
  state,
  rate,
  dotRef,
}: {
  label: string;
  short: string;
  state: Connection;
  rate: number;
  dotRef: (el: HTMLSpanElement | null) => void;
}) {
  return (
    <span className="fn-sm-status" data-state={state}>
      <span ref={dotRef} className="fx-dot" data-live={state === 'open' || undefined} aria-hidden />
      <span className="fn-sm-status-label">
        <span className="fn-sm-long">{label}</span>
        <span className="fn-sm-short">{short}</span>
      </span>
      <span className="fn-sm-status-text">{connectionText(state, rate)}</span>
    </span>
  );
}

/** A handle for a DID, looked up once and cached (resolveDidHandle). */
function useResolvedHandle(did: string, enabled: boolean): string | null {
  const [found, setFound] = useState<{ did: string; handle: string } | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    resolveDidHandle(did).then((h) => {
      if (!cancelled && h) setFound({ did, handle: h });
    });
    return () => {
      cancelled = true;
    };
  }, [did, enabled]);
  return found?.did === did ? found.handle : null;
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

/**
 * PLC rows name the handle themselves, and so do identity events that
 * carry one; looking those accounts up again would only repeat it.
 */
const resolvable = (item: StreamItem) => item.source === 'jetstream' && !(item.kind === 'identity' && item.handle);

const EventLine = memo(function EventLine({
  item,
  open,
  lookup,
  onToggle,
}: {
  item: EventRow;
  open: boolean;
  lookup: boolean;
  onToggle: (id: number) => void;
}) {
  const meta = KIND_META.get(item.kind)!;
  const at = new Date(item.time);
  return (
    // data-fresh runs the feed's one-off arrival accent (globals.css), only
    // for rows that arrived while the list was calm enough to notice it.
    <li
      className="fn-sm-row explore-jetstream-row"
      data-fresh={item.accent ? '' : undefined}
      data-row={item.id}
      aria-current={open || undefined}
    >
      <button
        type="button"
        className="fn-sm-row-main fn-sm-grid"
        aria-expanded={open}
        aria-controls={INSPECTOR_ID}
        onClick={() => onToggle(item.id)}
      >
        <time className="fn-sm-time" dateTime={at.toISOString()} title={at.toISOString()}>
          {timeFormat.format(at)}
        </time>
        <span className="fn-sm-badge" data-kind={item.kind}>
          {meta.badge}
        </span>
        {resolvable(item) ? (
          <AccountCell did={item.did} lookup={lookup || open} />
        ) : (
          <code className="fn-sm-account" title={item.did}>
            {shortDid(item.did)}
          </code>
        )}
        <Summary item={item} />
      </button>
    </li>
  );
});

function GapLine({ gap }: { gap: GapRow }) {
  return (
    <li className="fn-sm-gap">
      <Unplug size={13} aria-hidden />
      Stopped {timeFormat.format(gap.from)} to {timeFormat.format(gap.to)} ({formatSpan(gap.to - gap.from)}).
      Nothing from then was received.
    </li>
  );
}

type DetailView = 'preview' | 'fields' | 'changes' | 'json';

/**
 * The open event, beside the list (or over it, below desktop width): what
 * happened and to whom, the record page's views of it (the rich card, the
 * field table, for PLC operations what changed), and what to do next. Stays
 * mounted from one event to the next, so stepping through posts with J and
 * K keeps the view chosen.
 */
function Inspector({
  item,
  onClose,
  onStep,
  onWatchAccount,
  onWatchCollection,
}: {
  item: EventRow;
  onClose: () => void;
  onStep: (dir: number) => void;
  onWatchAccount: (did: string) => void;
  onWatchCollection: (collection: string) => void;
}) {
  const meta = KIND_META.get(item.kind)!;
  const at = new Date(item.time);
  const looked = useResolvedHandle(item.did, resolvable(item));
  const handle = resolvable(item) ? looked : (item.handle ?? null);

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
  const [preferred, setPreferred] = useState<DetailView | null>(null);
  const shown = views.some((v) => v.value === preferred) ? preferred! : views[0].value;

  const uri = item.collection && item.rkey ? `at://${item.did}/${item.collection}/${item.rkey}` : null;

  return (
    <>
      <span className="fn-sm-grab" aria-hidden />
      <div className="fn-sm-insp-head">
        <span className="fn-sm-badge" data-kind={item.kind}>
          {meta.badge}
        </span>
        <time className="fn-sm-time" dateTime={at.toISOString()} title={at.toISOString()}>
          {timeFormat.format(at)}
        </time>
        <div className="fn-sm-insp-nav">
          <button
            type="button"
            className="fn-sm-icon"
            onClick={() => onStep(-1)}
            aria-label="Newer event"
            title="Newer (K)"
          >
            <ChevronUp size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="fn-sm-icon"
            onClick={() => onStep(1)}
            aria-label="Older event"
            title="Older (J)"
          >
            <ChevronDown size={16} aria-hidden />
          </button>
          <button type="button" className="fn-sm-icon" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <X size={16} aria-hidden />
          </button>
        </div>
      </div>

      <div className="fn-sm-insp-title">
        <h2 className="fn-sm-insp-who">{handle ? `@${handle}` : shortDid(item.did)}</h2>
        <code className="fn-sm-insp-did">{item.did}</code>
        {item.collection && (
          <code className="fn-sm-insp-path">
            <span className="fn-sm-nsid">{item.collection}</span>
            {item.rkey && <span className="fn-sm-detail-mono"> / {item.rkey}</span>}
          </code>
        )}
      </div>

      {views.length > 1 && (
        <div className="fn-sm-insp-views">
          <Segmented ariaLabel="Event view" options={views} value={shown} onChange={setPreferred} />
        </div>
      )}

      <div className="fn-sm-insp-body">
        {shown === 'preview' && record && uri && (
          <div className="fn-sm-preview">
            <RichRecordCard
              key={item.id}
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
            key={item.id}
            record={{ uri, cid: commit?.cid, value: record }}
            collection={item.collection!}
            handle={item.did}
            rkey={item.rkey!}
            hideExplorerCtas
          />
        )}
        {shown === 'changes' && <PlcChanges key={item.id} entry={item.data as PlcStreamEntry} />}
        {shown === 'json' && <LinkifiedJson value={item.data} className="explore-json fn-sm-json" />}
      </div>

      <div className="fn-sm-insp-actions">
        <Link href={item.href} prefetch={false} className="fx-btn">
          <ExternalLink size={14} aria-hidden />
          Open in explorer
        </Link>
        <button type="button" className="fx-btn" onClick={() => onWatchAccount(item.did)}>
          <Eye size={14} aria-hidden />
          Watch account
        </button>
        {item.collection && (
          <button type="button" className="fx-btn" onClick={() => onWatchCollection(item.collection!)}>
            <Braces size={14} aria-hidden />
            Watch collection
          </button>
        )}
        <CopyButton value={JSON.stringify(item.data, null, 2)} label="Copy JSON" />
      </div>
    </>
  );
}

function shortValue(value: string | null): string {
  if (!value) return '—';
  return value.length > 40 ? `${value.slice(0, 24)}…${value.slice(-8)}` : value;
}

/**
 * What a PLC operation changed, read against the operation before it in the
 * DID's audit log. Fetched when the event is opened, not before: one request
 * for an event someone asked about, none for the rest.
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
      {Array.from({ length: 12 }, (_, i) => (
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
 * from the query string, so it renders in the browser): the same frame, with
 * the toolbar's title and the list's outline in skeleton bars, so nothing
 * moves when it arrives.
 */
export function StreamMonitorSkeleton({ about }: { about: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useFillViewport(rootRef);
  return (
    <div ref={rootRef} className="fn-sm" aria-busy>
      <header className="fn-sm-toolbar">
        <div className="fn-sm-title">
          <Link href="/tools" className="fn-sm-crumb">
            Tools
          </Link>
          <span className="fn-sm-slash" aria-hidden>
            /
          </span>
          <h1 className="fn-sm-h1">Stream monitor</h1>
          <About>{about}</About>
        </div>
        <div className="fn-sm-statusline">
          <span className="fn-skel fn-sm-bar" style={{ width: '22ch' }} />
        </div>
        <div className="fn-sm-presets fn-sm-strip-presets" aria-hidden>
          {PRESETS.map((p) => (
            <span key={p.id} className="fn-chip fn-sm-preset">
              {p.label}
            </span>
          ))}
        </div>
      </header>
      <div className="fn-sm-body">
        <aside className="fn-sm-rail" aria-hidden>
          <div className="fn-sm-rail-head">
            <span className="fn-sm-rail-title">Filters</span>
          </div>
          <span className="fn-skel" style={{ width: '100%', height: 96 }} />
          <span className="fn-skel" style={{ width: 180, height: 34 }} />
          <span className="fn-skel" style={{ width: '100%', height: 260 }} />
        </aside>
        <section className="fn-sm-main" aria-hidden>
          <div className="fn-sm-scroll">
            <ColumnHeads />
            <ol className="fn-sm-list">
              <SkeletonRows />
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}
