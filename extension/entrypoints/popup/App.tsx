import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { browser } from '#imports';
import { Check, Compass, Copy, Pause, Search, Shuffle, X } from 'lucide-react';
import type { ReverseMatch } from '@aturi/reverseParsers';
import type { WaypointActivity, WaypointData, WaypointType } from '@aturi/waypoints.data';
import { matchSupportedUrl, parseAtUri, isSupportedHost } from '@aturi/reverseParsers';
import { waypointActivity } from '@aturi/waypoints.data';
import { resolveDidHandle, resolveIdentifier } from '@aturi/atproto/identity';
import { getRecord } from '@aturi/atproto/pdsClient';
import { previewFor } from '@aturi/atproto/previewExtractors';
import { pdsHostname } from '@aturi/atproto/pdsServer';
import { shortDid } from '@aturi/atproto/urls';
import { matchCustomUrl } from '../../lib/template';
import {
  categorizedForType,
  categorizedVisibleAll,
  findWaypoint,
  newBuiltinWaypoints,
  recommendedForType,
  requiresDid,
  visibleWaypointIds,
  waypointHandlesContent,
} from '../../lib/catalog';
import {
  adoptWaypoints,
  bumpRecent,
  loadPrefs,
  markWaypointsKnown,
  onPrefsChanged,
  savePrefs,
  type Prefs,
} from '../../lib/prefs';
import { debugLog } from '../../lib/debugLog';
import { applyAppearance } from '../../lib/appearance';
import { resolveHandleToDid } from '../../lib/handleResolver';
import { describeWaypoint } from '../../lib/describe';
import { getWaypointHomePageUrl, homePageSubtitle } from '../../lib/homePage';
import { WaypointIcon } from '../../lib/Icons';
import { cachedRepoCollections, scanRepoCollections } from '../../lib/repoScan';
import { useInspectScan } from '../../lib/inspectScan';
import { buildExploreUrl } from '../../lib/aturiUrl';
import {
  initialOf,
  kindLabel,
  recordTitle,
  referencesFromHits,
  whereLabel,
  type PageReference,
} from '../../lib/pageRecords';
import {
  loadSeenLately,
  noteSeenIdentity,
  recordSeenRepos,
  type SeenIdentity,
  type SeenRepo,
} from '../../lib/seenLately';
import { writeToClipboard } from './actions';
import { GO_TO_LABEL, LookupField, SearchDrawer, SeenLatelySheet } from './Search';
import { PAGE_KEY, RecordCard, type CardEntry, type RecordDetails } from './RecordCard';

type PopupState =
  | { phase: 'loading' }
  | {
      phase: 'ready';
      prefs: Prefs;
      tabId: number | null;
      tabUrl: string | null;
      /** The page's own record, or null when the page has none. */
      match: ReverseMatch | null;
      isKnownHost: boolean;
    };

// Open the extension's options page. We prefer browser.runtime.openOptionsPage()
// because it focuses an existing options tab when one is already open. Some
// Chromium-derived browsers (notably Arc) do not implement the chrome://extensions
// surface that hosts embedded options, so the call can silently no-op. If it
// throws or never resolves, fall back to opening options.html in a new tab.
//
// When `tab` is passed, we always go through tabs.create so the URL hash makes
// it through — `openOptionsPage()` doesn't accept a target route.
async function openOptionsPage(tab?: string) {
  const fallbackUrl = browser.runtime.getURL(
    tab ? `/options.html#${tab}` : '/options.html'
  );
  if (tab) {
    await browser.tabs.create({ url: fallbackUrl });
    window.close();
    return;
  }
  try {
    const result = browser.runtime.openOptionsPage();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      await (result as Promise<unknown>);
    }
  } catch {
    await browser.tabs.create({ url: fallbackUrl });
  }
  window.close();
}

const LOADING_DETAILS: RecordDetails = {
  loading: true,
  did: null,
  handle: null,
  pds: null,
  cid: null,
  preview: '',
};

/**
 * Look up what the card shows about a record beyond its URI: the repo's DID,
 * handle and PDS, then the record itself for its CID and a preview. A repo-
 * level URI (a profile) reports its profile record's CID. Failures leave the
 * missing pieces null rather than throwing, so the card renders what it has.
 */
async function lookUpRecord(match: ReverseMatch): Promise<RecordDetails> {
  const { parsed } = match;
  const out: RecordDetails = { ...LOADING_DETAILS, loading: false, did: parsed.did ?? null };
  try {
    const identity = await resolveIdentifier(parsed.did ?? parsed.handle);
    out.did = identity.did;
    out.handle = identity.handle;
    out.pds = identity.pds;
    const collection = parsed.collection ?? 'app.bsky.actor.profile';
    const rkey = parsed.collection ? parsed.rkey : 'self';
    if (rkey) {
      try {
        const record = await getRecord(identity.pds, { repo: identity.did, collection, rkey });
        out.cid = record.cid;
        out.preview = previewFor(record.value);
      } catch {
        /* the identifiers above still stand without the record */
      }
    }
  } catch (err) {
    debugLog('record lookup failed', { uri: parsed.uri, err: String(err) });
  }
  return out;
}

/**
 * Handles for the references' tabs. The scan mostly finds URIs by DID, and a
 * tab is labelled by its author's handle, so each DID is reverse-resolved
 * (cached, and de-duped across tabs by the resolver), a few at a time.
 */
function useReferenceHandles(dids: string[]): Record<string, string | null> {
  const [handles, setHandles] = useState<Record<string, string | null>>({});
  const asked = useRef(new Set<string>());
  const key = dids.join('|');

  useEffect(() => {
    const todo = dids.filter(did => !asked.current.has(did));
    if (todo.length === 0) return undefined;
    todo.forEach(did => asked.current.add(did));
    let cancelled = false;
    const queue = todo.slice();
    const worker = async () => {
      while (!cancelled && queue.length > 0) {
        const did = queue.shift()!;
        const handle = await resolveDidHandle(did);
        if (!cancelled) setHandles(prev => ({ ...prev, [did]: handle }));
      }
    };
    for (let i = 0; i < Math.min(6, queue.length); i++) void worker();
    return () => {
      cancelled = true;
      // Whatever had not resolved yet is asked again on the next run.
      queue.forEach(did => asked.current.delete(did));
    };
    // `key` stands for `dids`, whose identity changes on every render.
  }, [key]);

  return handles;
}

/** The card's view of one record: its tab, title and identifiers. */
function cardEntry({
  key,
  match,
  pinned,
  prefs,
  details,
  labelHandle,
  provenance,
}: {
  key: string;
  match: ReverseMatch;
  pinned: boolean;
  prefs: Prefs;
  details: RecordDetails | undefined;
  labelHandle: string | null | undefined;
  provenance: string | null;
}): CardEntry {
  const { parsed } = match;
  const asSeen = parsed.handle;
  const handle =
    details?.handle ?? labelHandle ?? (asSeen.startsWith('did:') ? null : asSeen);
  const who = handle ?? (asSeen.startsWith('did:') ? shortDid(asSeen) : asSeen);
  const type: WaypointType = parsed.type === 'unknown' ? 'profile' : parsed.type;
  const kind = kindLabel(type, parsed.collection);
  const title = recordTitle(type, parsed.collection, who);
  const did = details?.did ?? parsed.did ?? null;
  const atUri = did
    ? parsed.collection && parsed.rkey
      ? `at://${did}/${parsed.collection}/${parsed.rkey}`
      : `at://${did}`
    : parsed.uri;
  const repoForLinks = handle ?? did ?? asSeen;
  const aturi = findWaypoint(prefs, 'aturi');
  const aturiLink =
    aturi?.getUrl(repoForLinks, parsed.collection, parsed.rkey, did ?? undefined) ?? null;
  return {
    key,
    pinned,
    match,
    who,
    tabLabel: pinned ? 'This page' : who,
    tabTitle: pinned
      ? `The page's own record · ${title}`
      : `${title}${provenance ? ` · ${provenance}` : ''}`,
    title,
    kind,
    collectionLabel: parsed.collection ?? kind.toLowerCase(),
    provenance,
    initial: initialOf(who),
    atUri,
    aturiLink,
    exploreUrl: buildExploreUrl(repoForLinks, parsed.collection, parsed.rkey),
    rkey: parsed.rkey,
    details,
  };
}

/**
 * The record a waypoint should act on: the open tab's, with whatever the
 * lookups added (the DID saves a resolve on a waypoint that needs one; a
 * reference found by DID reads better in a client's URL by its handle).
 */
function withLookups(entry: CardEntry): ReverseMatch | null {
  if (!entry.match) return null;
  const { source, parsed } = entry.match;
  const did = parsed.did ?? entry.details?.did ?? undefined;
  const handle =
    !entry.pinned && parsed.handle.startsWith('did:') && !entry.who.startsWith('did:')
      ? entry.who
      : parsed.handle;
  return { source, parsed: { ...parsed, did, handle } };
}

export default function App() {
  const [state, setState] = useState<PopupState>({ phase: 'loading' });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string>(PAGE_KEY);
  const [tabsTouched, setTabsTouched] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seen, setSeen] = useState<SeenRepo[]>([]);
  const [details, setDetails] = useState<Record<string, RecordDetails>>({});
  const requested = useRef(new Set<string>());
  const searchBtnRef = useRef<HTMLButtonElement>(null);
  const drawerInputRef = useRef<HTMLInputElement>(null);
  const lookupInputRef = useRef<HTMLInputElement>(null);
  const scan = useInspectScan();

  // Seen lately is read before this page's repos are written to it, so the
  // suggestions are the repos met before now and this page does not head its
  // own list. Identity notes wait for that write, so they can merge into it.
  const seenRead = useRef<Promise<void> | null>(null);
  const seenWritten = useRef<{ promise: Promise<void>; done: () => void } | null>(null);
  if (!seenWritten.current) {
    let done = () => {};
    const promise = new Promise<void>(resolve => {
      done = resolve;
    });
    seenWritten.current = { promise, done };
  }

  useEffect(() => {
    void init();
    // Listen for prefs changes (e.g. user toggled theme in the options page
    // while the popup was open) and re-apply appearance immediately.
    const unsub = onPrefsChanged(next => {
      applyAppearance(next);
      setState(prev => (prev.phase === 'ready' ? { ...prev, prefs: next } : prev));
    });
    return unsub;
  }, []);

  async function init() {
    const prefs = await loadPrefs();
    applyAppearance(prefs);
    seenRead.current = prefs.historyEnabled
      ? loadSeenLately().then(setSeen)
      : Promise.resolve();
    const tab = await getActiveTab();
    const tabId = (tab?.id as number | undefined) ?? null;
    const tabUrl = tab?.url ?? null;
    const base = { phase: 'ready' as const, prefs, tabId, tabUrl };
    if (!tab?.url) {
      setState({ ...base, match: null, isKnownHost: false });
      return;
    }

    let url: URL;
    try {
      url = new URL(tab.url);
    } catch {
      setState({ ...base, match: null, isKnownHost: false });
      return;
    }

    const isKnownHost = isSupportedHost(url.hostname);
    let match = matchSupportedUrl(url) ?? matchCustomUrl(url, prefs.customWaypoints);
    if (!match) {
      match = await queryHeadForAtUri(tab);
    }
    setState({ ...base, match, isKnownHost });
  }

  const ready = state.phase === 'ready' ? state : null;
  const prefs = ready?.prefs ?? null;
  const pageMatch = ready?.match ?? null;
  const historyEnabled = prefs?.historyEnabled ?? false;

  // Once the scan lands, count this page's repos in Seen lately, once.
  const scanDone = !scan.scanning;
  const seenRecorded = useRef(false);
  useEffect(() => {
    if (!ready || !scanDone || seenRecorded.current) return;
    seenRecorded.current = true;
    const written = seenWritten.current!;
    if (!ready.prefs.historyEnabled) {
      written.done();
      return;
    }
    const uris = scan.hits.map(h => h.uri);
    if (ready.match) uris.push(ready.match.parsed.uri);
    void (seenRead.current ?? Promise.resolve())
      .then(() => recordSeenRepos(uris, ready.tabUrl))
      .finally(written.done);
  }, [ready, scanDone, scan.hits]);

  const noteIdentity = useCallback(
    (identity: SeenIdentity, seenAs?: string) => {
      if (!historyEnabled) return;
      void seenWritten.current!.promise.then(() => noteSeenIdentity(identity, seenAs));
    },
    [historyEnabled],
  );

  const ensureDetails = useCallback(
    (key: string, match: ReverseMatch) => {
      if (requested.current.has(key)) return;
      requested.current.add(key);
      setDetails(prev => ({ ...prev, [key]: LOADING_DETAILS }));
      void lookUpRecord(match).then(found => {
        setDetails(prev => ({ ...prev, [key]: found }));
        if (found.did) {
          noteIdentity(
            {
              did: found.did,
              handle: found.handle,
              pdsHost: found.pds ? pdsHostname(found.pds) : null,
            },
            match.parsed.handle,
          );
        }
      });
    },
    [noteIdentity],
  );

  // The page's own record is looked up at once: the card shows it first, and
  // its DID is what tells the page's record apart from the references.
  useEffect(() => {
    if (pageMatch) ensureDetails(PAGE_KEY, pageMatch);
  }, [pageMatch, ensureDetails]);

  // References wait for the page's DID, which is what tells the page's own
  // record (often declared by DID) from the rest; a slow lookup only holds
  // them back so long.
  const [pageWaitOver, setPageWaitOver] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setPageWaitOver(true), 1500);
    return () => window.clearTimeout(t);
  }, []);
  const pageDetails = details[PAGE_KEY];
  const pageSettled =
    !pageMatch || !!pageMatch.parsed.did || pageWaitOver || (pageDetails && !pageDetails.loading);
  const refsReady = ready !== null && scanDone && pageSettled;
  const pageDid = pageMatch?.parsed.did ?? pageDetails?.did ?? null;

  const references: PageReference[] = useMemo(() => {
    if (!refsReady) return [];
    const hint = pageMatch
      ? {
          handle: pageMatch.parsed.handle,
          did: pageDid,
          collection: pageMatch.parsed.collection,
          rkey: pageMatch.parsed.rkey,
        }
      : null;
    return referencesFromHits(scan.hits, hint);
  }, [refsReady, scan.hits, pageMatch, pageDid]);

  const refDids = useMemo(
    () =>
      Array.from(
        new Set(
          references
            .map(r => r.match.parsed.handle)
            .filter(repo => repo.startsWith('did:')),
        ),
      ),
    [references],
  );
  const refHandles = useReferenceHandles(refDids);

  const notedHandles = useRef(new Set<string>());
  useEffect(() => {
    for (const [did, handle] of Object.entries(refHandles)) {
      if (!handle || notedHandles.current.has(did)) continue;
      notedHandles.current.add(did);
      noteIdentity({ did, handle });
    }
  }, [refHandles, noteIdentity]);

  // A reference is looked up in full when its tab opens.
  useEffect(() => {
    const ref = references.find(r => r.key === openKey);
    if (ref) ensureDetails(ref.key, ref.match);
  }, [openKey, references, ensureDetails]);

  const pageSourceName = pageMatch && prefs ? findWaypoint(prefs, pageMatch.source)?.name ?? null : null;
  const pageEntry: CardEntry | null = useMemo(() => {
    if (!prefs) return null;
    if (!pageMatch) {
      return {
        key: PAGE_KEY,
        pinned: true,
        match: null,
        who: '',
        tabLabel: 'This page',
        tabTitle: 'This page has no Atmosphere record of its own',
        title: '',
        kind: '',
        collectionLabel: '',
        provenance: null,
        initial: '',
        atUri: '',
        aturiLink: null,
        exploreUrl: '',
      };
    }
    return cardEntry({
      key: PAGE_KEY,
      match: pageMatch,
      pinned: true,
      prefs,
      details: pageDetails,
      labelHandle: null,
      provenance: pageSourceName ? `on ${pageSourceName}` : null,
    });
  }, [prefs, pageMatch, pageDetails, pageSourceName]);

  const refEntries: CardEntry[] = useMemo(() => {
    if (!prefs) return [];
    return references.map(ref =>
      cardEntry({
        key: ref.key,
        match: ref.match,
        pinned: false,
        prefs,
        details: details[ref.key],
        labelHandle: refHandles[ref.match.parsed.handle],
        provenance: whereLabel(ref.where, ref.relation),
      }),
    );
  }, [prefs, references, details, refHandles]);

  const openEntry =
    (openKey === PAGE_KEY ? pageEntry : refEntries.find(e => e.key === openKey)) ?? pageEntry;
  const openMatch = openEntry ? withLookups(openEntry) : null;
  // On a page with no record of its own the field sits in the card, so the
  // bar's glyph and `/` go to it instead of opening the drawer.
  const lookupShown = ready !== null && openEntry !== null && openEntry.match === null;

  function selectRecord(key: string) {
    setOpenKey(key);
    setTabsTouched(true);
  }

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    searchBtnRef.current?.focus();
  }, []);

  function onSearchGlyph() {
    if (lookupShown) {
      lookupInputRef.current?.focus();
      return;
    }
    if (drawerOpen) closeDrawer();
    else setDrawerOpen(true);
  }

  // `/` anywhere outside a field goes to the go-to field: the drawer on a
  // record's page, the card's own field on a page with none.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!ready) return;
      e.preventDefault();
      if (lookupShown) lookupInputRef.current?.focus();
      else if (drawerOpen) drawerInputRef.current?.focus();
      else setDrawerOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ready, lookupShown, drawerOpen]);

  // Esc closes the drawer from anywhere (the field handles its own first, to
  // clear a highlight).
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeDrawer();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, closeDrawer]);

  // The drawer belongs to record pages; switching to the field in the card
  // puts it away.
  useEffect(() => {
    if (lookupShown && drawerOpen) setDrawerOpen(false);
  }, [lookupShown, drawerOpen]);

  async function navigateTo(url: string, tabId: number | null, openInNewTab: boolean) {
    if (!openInNewTab && tabId != null) {
      try {
        await browser.tabs.update(tabId, { url });
        return;
      } catch (err) {
        console.warn('[aturi:popup] tab update failed, falling back to new tab', err);
      }
    }
    await browser.tabs.create({ url });
  }

  // Open a destination the user explicitly chose in the popup. We hand it to
  // the background so it can suppress auto-redirect for this one navigation —
  // otherwise a standing redirect rule could rewrite the chosen URL and send
  // the user to their default client instead of the one they just picked. If
  // the background can't handle it (older browser, messaging hiccup, redirect
  // disabled), fall back to opening the tab directly from here.
  async function openDestination(url: string, tabId: number | null, prefs: Prefs) {
    try {
      const res = (await browser.runtime.sendMessage({
        type: 'aturi:open-waypoint',
        url,
        tabId,
        openInNewTab: prefs.openInNewTab,
        autoRedirect: prefs.autoRedirect,
      })) as { ok?: boolean } | undefined;
      if (res?.ok) return;
    } catch (err) {
      console.warn('[aturi:popup] background open failed, opening directly', err);
    }
    await navigateTo(url, tabId, prefs.openInNewTab);
  }

  // Resolve a waypoint's URL for the open record, resolving the handle to a
  // DID first when the waypoint needs one.
  async function waypointUrl(waypoint: WaypointData, match: ReverseMatch, prefs: Prefs) {
    const { parsed } = match;
    let did = parsed.did;
    if (requiresDid(waypoint.id, prefs.customWaypoints) && !did) {
      const resolved = await resolveHandleToDid(parsed.handle);
      if (!resolved) {
        alert(`Couldn't resolve ${parsed.handle} to a DID.`);
        return null;
      }
      did = resolved;
    }
    return waypoint.getUrl(parsed.handle, parsed.collection, parsed.rkey, did);
  }

  async function openWaypoint(waypoint: WaypointData) {
    if (!ready || !openMatch) return;
    setPendingId(waypoint.id);

    // try/finally so any thrown error (resolveHandleToDid, openDestination,
    // a rejected tabs API) still clears the pending state — otherwise the row
    // stays spinner-locked and unclickable for the life of the popup.
    try {
      const url = await waypointUrl(waypoint, openMatch, ready.prefs);
      if (!url) return;
      await bumpRecent(waypoint.id);
      await openDestination(url, ready.tabId, ready.prefs);
      window.close();
    } catch (err) {
      console.error('[aturi] failed to open waypoint', err);
    } finally {
      setPendingId(null);
    }
  }

  async function openHomeShortcut(waypoint: WaypointData) {
    if (!ready) return;
    const home = getWaypointHomePageUrl(waypoint, ready.prefs.customWaypoints);
    if (!home) return;

    setPendingId(waypoint.id);
    await bumpRecent(waypoint.id);
    await openDestination(home, ready.tabId, ready.prefs);
    setPendingId(null);
    window.close();
  }

  // Copy a waypoint's link for the open record without navigating to it.
  async function copyWaypoint(waypoint: WaypointData) {
    if (!ready || !openMatch) return;
    const url = await waypointUrl(waypoint, openMatch, ready.prefs);
    if (!url) return;
    await writeToClipboard(url);
    flashCopied(waypoint.id);
  }

  async function copyHomeShortcut(waypoint: WaypointData) {
    if (!ready) return;
    const home = getWaypointHomePageUrl(waypoint, ready.prefs.customWaypoints);
    if (!home) return;
    await writeToClipboard(home);
    flashCopied(waypoint.id);
  }

  function flashCopied(id: string) {
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId(prev => (prev === id ? null : prev));
    }, 1400);
  }

  const bar = (
    <TopBar
      prefs={prefs}
      searchOpen={drawerOpen}
      searchExpands={!lookupShown}
      onSearch={onSearchGlyph}
      searchBtnRef={searchBtnRef}
    >
      {drawerOpen && (
        <SearchDrawer seen={seen} inputRef={drawerInputRef} onClose={closeDrawer} />
      )}
    </TopBar>
  );

  // The chrome paints on the first frame: the bar with a blank slot where
  // the switch will sit, so nothing jumps when prefs land.
  if (!ready || !prefs || !pageEntry || !openEntry) {
    return (
      <div className="popup-shell">
        {bar}
        <main className="popup-body">
          <div className="popup-empty" aria-busy="true">
            Loading...
          </div>
        </main>
      </div>
    );
  }

  const notice =
    refEntries.length > 0
      ? 'This page has no record of its own.'
      : ready.isKnownHost
        ? 'No record on this page.'
        : 'No Atmosphere data on this page.';

  return (
    <div className={`popup-shell ${prefs.compactMode ? 'is-compact' : ''}`}>
      {bar}
      <main className="popup-body">
        <div className={`popup-root ${prefs.compactMode ? 'is-compact' : ''}`}>
          <RecordCard
            page={pageEntry}
            refs={refEntries}
            openKey={openEntry.key}
            onOpen={selectRecord}
            drawerOpen={drawerOpen}
            band={
              prefs.autoRedirect ? <PageBand tabId={ready.tabId} /> : null
            }
            lookup={
              <>
                <p className="popup-nodata">
                  <Compass size={16} aria-hidden />
                  <span>{notice}</span>
                </p>
                <LookupField inputRef={lookupInputRef} autoFocus={!tabsTouched} />
              </>
            }
          />

          <NewWaypointsNotice prefs={prefs} />

          {openMatch ? (
            <WaypointLists
              key={openEntry.key}
              match={openMatch}
              prefs={prefs}
              pendingId={pendingId}
              copiedId={copiedId}
              onOpen={openWaypoint}
              onCopy={copyWaypoint}
            />
          ) : (
            <>
              <SeenLatelySheet seen={seen} />
              <AppShortcuts
                prefs={prefs}
                pendingId={pendingId}
                copiedId={copiedId}
                onOpenHome={openHomeShortcut}
                onCopyHome={copyHomeShortcut}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * The bar is the one region about the extension rather than this page, so
 * the global auto-redirect switch lives here, beside the search glyph and
 * settings. The sticky wrapper holds the bar, its search drawer and the
 * scrim; the inner box is the positioned one, so the drawer hangs from the
 * bar's bottom edge.
 */
function TopBar({
  prefs,
  searchOpen,
  searchExpands,
  onSearch,
  searchBtnRef,
  children,
}: {
  /** null while prefs load: the switch keeps its room, unseen. */
  prefs: Prefs | null;
  searchOpen: boolean;
  /** False where the glyph only focuses the field already on the page. */
  searchExpands: boolean;
  onSearch: () => void;
  searchBtnRef: React.RefObject<HTMLButtonElement | null>;
  children?: ReactNode;
}) {
  return (
    <div className="popup-bar">
      <div className="popup-bar-inner">
        <header className="popup-topbar">
          <div className="popup-title">
            <AturiMark />
            <span>aturi</span>
          </div>
          <div className="popup-topbar-actions">
            <RedirectSwitch prefs={prefs} />
            <button
              ref={searchBtnRef}
              type="button"
              className={`popup-icon-btn${searchOpen ? ' is-pressed' : ''}`}
              onClick={onSearch}
              aria-label={GO_TO_LABEL}
              title={`${GO_TO_LABEL} (/)`}
              {...(searchExpands
                ? { 'aria-expanded': searchOpen, 'aria-controls': 'popup-search' }
                : {})}
            >
              <Search size={17} aria-hidden />
            </button>
            <button
              type="button"
              className="popup-icon-btn"
              onClick={() => void openOptionsPage()}
              title="Open settings"
              aria-label="Open extension settings"
            >
              <SettingsIcon />
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

/**
 * The global `autoRedirect` pref, the same one the options page owns:
 * flipping it here stays off until you turn it back on. Pausing for one page
 * is the band on the card.
 */
function RedirectSwitch({ prefs }: { prefs: Prefs | null }) {
  const on = prefs?.autoRedirect ?? false;
  return (
    <button
      type="button"
      role="switch"
      className={`aturi-switch aturi-switch-sm popup-redirect-switch${on ? ' on' : ''}`}
      onClick={() => prefs && void savePrefs({ autoRedirect: !on })}
      aria-checked={on}
      disabled={!prefs}
      aria-hidden={prefs ? undefined : true}
      style={prefs ? undefined : { visibility: 'hidden' }}
      title={
        on
          ? 'Turn auto-redirect off everywhere'
          : 'Send Atmosphere links straight to your favorite client'
      }
    >
      <Shuffle size={14} className="popup-redirect-icon" aria-hidden />
      <span className="popup-redirect-label">Auto-redirect</span>
      <span className="aturi-switch-box" aria-hidden />
    </button>
  );
}

/** What the background reports about auto-redirect for one tab. */
type RedirectScope = { supported: boolean; paused: boolean };

/**
 * The card's bottom edge while auto-redirect is on. "Pause for this page" is
 * the narrow escape hatch: it exempts only the tab you're looking at, lasts
 * until you resume it or close the tab, and never touches your settings.
 * Paused, the band turns amber and offers Resume.
 */
function PageBand({ tabId }: { tabId: number | null }) {
  const [scope, setScope] = useState<RedirectScope | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tabId == null) {
      setScope({ supported: false, paused: false });
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = (await browser.runtime.sendMessage({
          type: 'aturi:redirect-scope',
          tabId,
        })) as RedirectScope | undefined;
        if (!cancelled) setScope(res ?? { supported: false, paused: false });
      } catch (err) {
        debugLog('redirect-scope query failed', err);
        if (!cancelled) setScope({ supported: false, paused: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tabId]);

  const paused = scope?.paused === true;
  // Only offer the pause once we know the background can actually scope a
  // rule to this tab — otherwise the button would toggle nothing.
  const canPause = tabId != null && scope?.supported === true;

  async function togglePause() {
    if (!canPause || busy) return;
    setBusy(true);
    try {
      const res = (await browser.runtime.sendMessage({
        type: 'aturi:set-tab-pause',
        tabId,
        paused: !paused,
      })) as RedirectScope | undefined;
      if (res) setScope(res);
    } catch (err) {
      console.warn('[aturi:popup] failed to toggle tab pause', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`popup-band${paused ? ' is-paused' : ''}`}>
      {paused ? <Pause size={14} aria-hidden /> : <Shuffle size={14} aria-hidden />}
      <span
        className="popup-band-text"
        title={paused ? 'Auto-redirect still works in your other tabs' : undefined}
      >
        {paused ? 'Paused for this page' : 'Auto-redirect is on'}
      </span>
      {canPause && (
        <button
          type="button"
          className="popup-band-action"
          onClick={() => void togglePause()}
          disabled={busy}
          title={
            paused
              ? 'Redirect links in this tab again'
              : 'Leave this tab alone until you resume it or close the tab'
          }
        >
          {paused ? 'Resume' : 'Pause for this page'}
        </button>
      )}
    </div>
  );
}

function AturiMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </svg>
  );
}

/**
 * On a page with no record to act on: each app's home page, as rows in the
 * user's groups.
 */
function AppShortcuts({
  prefs,
  pendingId,
  copiedId,
  onOpenHome,
  onCopyHome,
}: {
  prefs: Prefs;
  pendingId: string | null;
  copiedId: string | null;
  onOpenHome: (waypoint: WaypointData) => void;
  onCopyHome: (waypoint: WaypointData) => void;
}) {
  const shortcutGroups = useMemo(() => {
    return categorizedVisibleAll(prefs)
      .map(group => ({
        ...group,
        waypoints: group.waypoints.filter(
          w => getWaypointHomePageUrl(w, prefs.customWaypoints) !== null
        ),
      }))
      .filter(g => g.waypoints.length > 0);
  }, [prefs]);

  if (shortcutGroups.length === 0) {
    return (
      <div className="popup-empty">
        No destinations are visible. Add waypoints to a group in Settings.
        <div style={{ marginTop: 12 }}>
          <button className="aturi-btn" type="button" onClick={() => void openOptionsPage()}>
            Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="popup-jump-head">
        <h2 className="popup-jump-title">Jump to an app</h2>
        <span className="popup-jump-note">Shortcuts open each app&apos;s home page</span>
      </div>
      {shortcutGroups.map(group => (
        <section className="popup-section is-sheet" key={group.category.id}>
          <h3 className="popup-section-label">{group.category.name}</h3>
          <div className="popup-waypoints">
            {group.waypoints.map(w => {
              const subtitle = homePageSubtitle(w, prefs.customWaypoints);
              return (
                <div key={w.id} className="popup-waypoint">
                  <button
                    type="button"
                    className="popup-waypoint-main"
                    onClick={() => onOpenHome(w)}
                    disabled={pendingId === w.id}
                    title={`${w.name} · ${subtitle}`}
                  >
                    <WaypointIcon id={w.id} name={w.name} />
                    <span className="popup-waypoint-name">{w.name}</span>
                    <span className="popup-waypoint-desc">{subtitle}</span>
                  </button>
                  <CopyWaypointButton
                    copied={copiedId === w.id}
                    onClick={() => onCopyHome(w)}
                    label={`Copy link to ${w.name}`}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

type WaypointListsProps = {
  match: ReverseMatch;
  prefs: Prefs;
  pendingId: string | null;
  copiedId: string | null;
  onOpen: (waypoint: WaypointData) => void;
  onCopy: (waypoint: WaypointData) => void;
};

/**
 * The waypoint drawers under the card, for the open record: Recents, the
 * recommendations, then the user's groups.
 */
function WaypointLists({ match, prefs, pendingId, copiedId, onOpen, onCopy }: WaypointListsProps) {
  const { parsed, source } = match;
  const type: WaypointType = parsed.type === 'unknown' ? 'profile' : parsed.type;

  // describeRepo scan against the target DID. Result feeds the per-waypoint
  // 'present' | 'absent' | 'unknown' badge and re-orders recommendations so
  // confirmed-active waypoints win the top slot. Gated on the prefs toggle
  // and on the target having a DID we can resolve.
  const [repoCollections, setRepoCollections] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!prefs.pdsRecordScan) {
      setRepoCollections(null);
      return undefined;
    }
    let cancelled = false;

    async function run() {
      // We need a DID to scan. Profiles often arrive with just the handle;
      // resolve to DID up-front so the scan can proceed.
      let did = parsed.did;
      if (!did && parsed.handle) {
        const resolved = await resolveHandleToDid(parsed.handle);
        if (resolved) did = resolved;
      }
      if (!did) return;

      // Show whatever's cached immediately, then live-refresh in the
      // background so the badges don't flicker on a warm cache.
      const cached = await cachedRepoCollections(did);
      if (!cancelled && cached) setRepoCollections(cached);

      const live = await scanRepoCollections(did);
      if (!cancelled && live) setRepoCollections(live);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [prefs.pdsRecordScan, parsed.did, parsed.handle]);

  const categorized = useMemo(
    () => categorizedForType(prefs, type),
    [prefs, type]
  );

  const recommended = useMemo(
    () => recommendedForType(prefs, type, parsed.collection, repoCollections),
    [prefs, type, parsed.collection, repoCollections]
  );

  const recents = useMemo(() => {
    const visible = visibleWaypointIds(prefs);
    return prefs.recents
      .map(r => {
        const w = findWaypoint(prefs, r.waypointId);
        if (!w) return null;
        if (!visible.has(w.id)) return null;
        if (!w.supportedTypes.includes(type)) return null;
        if (w.id === source) return null;
        if (!waypointHandlesContent(w, parsed.handle, parsed.collection, parsed.rkey, parsed.did)) {
          return null;
        }
        return w;
      })
      .filter((w): w is WaypointData => !!w)
      .slice(0, 5);
  }, [prefs, type, source, parsed.handle, parsed.collection, parsed.rkey, parsed.did]);

  const recommendedIds = useMemo(() => {
    if (!prefs.smartRecommendations) return new Set<string>();
    return new Set(
      recommended.waypoints.filter(w => w.id !== source).map(w => w.id)
    );
  }, [prefs.smartRecommendations, recommended.waypoints, source]);

  return (
    <>
      {prefs.historyEnabled && recents.length > 0 && (
        <section className="popup-section is-sheet">
          <h2 className="popup-section-label">Recents</h2>
          <div className="popup-recents-row">
            {recents.map(w => (
              <button
                key={w.id}
                className="popup-recent"
                onClick={() => onOpen(w)}
                disabled={pendingId === w.id}
                aria-label={w.name}
              >
                <WaypointIcon id={w.id} name={w.name} />
                <span className="popup-recent-name">{w.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {prefs.smartRecommendations && recommended.waypoints.length > 0 && (
        <section className="popup-section is-sheet">
          <h2 className="popup-section-label is-highlighted">{recommended.label}</h2>
          <div className="popup-waypoints">
            {recommended.waypoints
              .filter(w => w.id !== source)
              .map(w => (
                <WaypointButton
                  key={`rec-${w.id}`}
                  waypoint={w}
                  collection={parsed.collection}
                  type={type}
                  pending={pendingId === w.id}
                  copied={copiedId === w.id}
                  activity={waypointActivity(w, repoCollections)}
                  onClick={onOpen}
                  onCopy={onCopy}
                />
              ))}
          </div>
        </section>
      )}

      {categorized.map(group => {
        const waypoints = group.waypoints.filter(
          w => w.id !== source && !recommendedIds.has(w.id)
        );
        if (waypoints.length === 0) return null;
        return (
          <section className="popup-section is-sheet" key={group.category.id}>
            <h2 className="popup-section-label">{group.category.name}</h2>
            <div className="popup-waypoints">
              {waypoints.map(w => (
                <WaypointButton
                  key={w.id}
                  waypoint={w}
                  collection={parsed.collection}
                  type={type}
                  pending={pendingId === w.id}
                  copied={copiedId === w.id}
                  activity={waypointActivity(w, repoCollections)}
                  onClick={onOpen}
                  onCopy={onCopy}
                />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

// Dismissable "new waypoints" notice, shown when the catalog has grown since
// the user last opened the popup.
function NewWaypointsNotice({ prefs }: { prefs: Prefs }) {
  const newWaypoints = useMemo(() => newBuiltinWaypoints(prefs), [prefs]);

  useEffect(() => {
    if (newWaypoints.length > 0) {
      debugLog('banner: rendered', { ids: newWaypoints.map(w => w.id) });
    }
  }, [newWaypoints]);

  if (newWaypoints.length === 0) return null;
  return (
    <NewWaypointsBanner
      waypoints={newWaypoints}
      onAdd={() => {
        debugLog('banner: Add clicked', { ids: newWaypoints.map(w => w.id) });
        void adoptWaypoints(newWaypoints.map(w => w.id));
      }}
      onReview={() => {
        debugLog('banner: review clicked', { ids: newWaypoints.map(w => w.id) });
        void openOptionsPage('waypoints');
      }}
      onDismiss={() => {
        debugLog('banner: dismissed', { ids: newWaypoints.map(w => w.id) });
        void markWaypointsKnown(newWaypoints.map(w => w.id));
      }}
    />
  );
}

function NewWaypointsBanner({
  waypoints,
  onAdd,
  onReview,
  onDismiss,
}: {
  waypoints: WaypointData[];
  /** Places every listed waypoint into its category group, in one click. */
  onAdd: () => void;
  /** Escape hatch to Settings → Waypoints for per-waypoint choices. */
  onReview: () => void;
  onDismiss: () => void;
}) {
  const names = waypoints.map(w => w.name);
  // Keep it short: list up to 3 by name, summarize the rest.
  let summary: string;
  if (names.length === 1) summary = `New waypoint: ${names[0]}`;
  else if (names.length <= 3) summary = `New waypoints: ${names.join(', ')}`;
  else summary = `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;

  return (
    <div className="popup-update-banner" role="status">
      <span className="popup-update-banner-icon" aria-hidden="true">
        {waypoints.slice(0, 2).map(w => (
          <span key={w.id} className="popup-update-banner-mark">
            <WaypointIcon id={w.id} name={w.name} />
          </span>
        ))}
      </span>
      <button
        type="button"
        className="popup-update-banner-text"
        onClick={onReview}
        title="Review in Settings → Waypoints"
      >
        {summary}
      </button>
      <button
        type="button"
        className="popup-update-banner-action"
        onClick={onAdd}
        title={
          waypoints.length === 1
            ? `Add ${names[0]} to your waypoints`
            : `Add all ${waypoints.length} to your waypoints`
        }
      >
        Add
      </button>
      <button
        type="button"
        className="popup-icon-btn popup-update-banner-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss new waypoints notification"
        title="Dismiss"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

function WaypointButton({
  waypoint,
  collection,
  type,
  pending,
  copied,
  activity,
  onClick,
  onCopy,
}: {
  waypoint: WaypointData;
  collection?: string;
  type: WaypointType;
  pending: boolean;
  copied: boolean;
  /**
   * 'absent' dims the row and replaces the description with a "no records
   * found" caption. 'present' / 'unknown' render as normal. Set to
   * 'unknown' (or omitted) when the PDS-scan toggle is off so the badge
   * stays out of the way.
   */
  activity?: WaypointActivity;
  onClick: (w: WaypointData) => void;
  onCopy: (w: WaypointData) => void;
}) {
  const isAbsent = activity === 'absent';
  const desc = isAbsent
    ? 'No records found on this repo'
    : describeWaypoint(waypoint, collection, type);
  return (
    <div className={`popup-waypoint ${isAbsent ? 'is-absent' : ''}`}>
      <button
        type="button"
        className="popup-waypoint-main"
        onClick={() => onClick(waypoint)}
        disabled={pending}
        title={
          isAbsent
            ? `No records under ${(waypoint.expectedCollections ?? []).join(' / ')} on this repo`
            : desc
        }
      >
        <WaypointIcon id={waypoint.id} name={waypoint.name} />
        <span className="popup-waypoint-name">{waypoint.name}</span>
        <span className="popup-waypoint-desc">{desc}</span>
      </button>
      <CopyWaypointButton
        copied={copied}
        onClick={() => onCopy(waypoint)}
        label={`Copy link to ${waypoint.name}`}
      />
    </div>
  );
}

/** Sliders glyph for the settings button. */
function SettingsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 7h-9" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </svg>
  );
}

function CopyWaypointButton({
  copied,
  onClick,
  label,
}: {
  copied: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`popup-waypoint-copy ${copied ? 'is-copied' : ''}`}
      onClick={onClick}
      title={copied ? 'Copied!' : 'Copy link'}
      aria-label={copied ? 'Copied to clipboard' : label}
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
}

async function queryHeadForAtUri(tab: AnyTab): Promise<ReverseMatch | null> {
  const tabId = tab.id as number | undefined;
  if (!tabId) return null;

  try {
    const response = await browser.tabs.sendMessage(tabId, { type: 'aturi:query-head' });
    if (response?.atUri) {
      return parseAtUri(response.atUri);
    }
  } catch (err) {
    console.log('[aturi:popup] head detection unavailable for tab', err);
  }
  return null;
}

type AnyTab = { url?: string; id?: number; active?: boolean; [k: string]: unknown };

async function getActiveTab(): Promise<AnyTab | null> {
  const tryQuery = async (
    query: Parameters<typeof browser.tabs.query>[0]
  ): Promise<AnyTab[]> => {
    try {
      const tabs = (await browser.tabs.query(query)) as unknown as AnyTab[] | undefined;
      return tabs ?? [];
    } catch {
      return [];
    }
  };

  // Prefer the window the popup is attached to. Querying a bare {active:true}
  // first returns the active tab of EVERY window (with the 'tabs' permission
  // every tab has a url), so with 2+ windows it can resolve to — and navigate —
  // the wrong window's tab. currentWindow/lastFocusedWindow pin us to the user's
  // actual foreground window; the broad queries stay only as a last resort.
  const currentWin = await tryQuery({ active: true, currentWindow: true });
  if (currentWin.length) {
    const withUrl = currentWin.find(t => !!t.url);
    if (withUrl) return withUrl;
  }

  const lastFocused = await tryQuery({
    active: true,
    lastFocusedWindow: true,
  });
  if (lastFocused.length) {
    const withUrl = lastFocused.find(t => !!t.url);
    if (withUrl) return withUrl;
  }

  const allNormal = await tryQuery({
    active: true,
    windowType: 'normal',
  });
  if (allNormal.length) {
    const withUrl = allNormal.find(t => !!t.url);
    if (withUrl) return withUrl;
  }

  const allActive = await tryQuery({ active: true });
  if (allActive.length) {
    const withUrl = allActive.find(t => !!t.url);
    if (withUrl) return withUrl;
  }

  try {
    const win = (await browser.windows.getLastFocused({
      populate: true,
      windowTypes: ['normal'],
    })) as { tabs?: AnyTab[] } | undefined;
    const candidate =
      win?.tabs?.find(t => t.active && !!t.url) ?? win?.tabs?.find(t => !!t.active);
    if (candidate) return candidate;
  } catch {
    /* ignore */
  }

  try {
    const all = (await browser.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    })) as { tabs?: AnyTab[] }[] | undefined;
    for (const w of all ?? []) {
      const candidate =
        w.tabs?.find(t => t.active && !!t.url) ?? w.tabs?.find(t => !!t.active);
      if (candidate) return candidate;
    }
  } catch {
    /* ignore */
  }

  return currentWin[0] ?? lastFocused[0] ?? allNormal[0] ?? allActive[0] ?? null;
}
