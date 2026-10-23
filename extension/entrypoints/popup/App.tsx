import { useEffect, useMemo, useState } from 'react';
import { browser } from '#imports';
import { Check, Compass, Copy, Link2, Moon, Pause, Shuffle, Sun, X } from 'lucide-react';
import type { ReverseMatch } from '@aturi/reverseParsers';
import type { WaypointActivity, WaypointData, WaypointType } from '@aturi/waypoints.data';
import { matchSupportedUrl, parseAtUri, isSupportedHost } from '@aturi/reverseParsers';
import { waypointActivity } from '@aturi/waypoints.data';
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
import InspectView from './InspectView';

type PopupMode = 'waypoints' | 'inspect';

const POPUP_MODE_REMEMBER_MIN_MINUTES = 5;
const POPUP_MODE_REMEMBER_MAX_MINUTES = 1440;

/**
 * Decide which tab the popup should open to. When the user has enabled
 * the remember-last-mode behavior and clicked a tab within the TTL
 * window, honor that choice; otherwise fall back to the configured
 * default. Out-of-range minute values are clamped so a corrupt pref
 * payload can never crash the popup or strand the user on an unwanted
 * tab forever.
 */
function resolveInitialMode(prefs: Prefs): PopupMode {
  const fallback: PopupMode = prefs.popupModeDefault ?? 'waypoints';
  if (!prefs.popupModeRemember) return fallback;
  if (!prefs.popupMode) return fallback;
  const rawMinutes = prefs.popupModeRememberMinutes ?? 30;
  const minutes = Math.min(
    POPUP_MODE_REMEMBER_MAX_MINUTES,
    Math.max(POPUP_MODE_REMEMBER_MIN_MINUTES, rawMinutes),
  );
  const stamp = prefs.popupModeLastUsedAt ?? 0;
  if (stamp <= 0) return fallback;
  if (Date.now() - stamp > minutes * 60_000) return fallback;
  return prefs.popupMode;
}

type PopupState =
  | { phase: 'loading' }
  | { phase: 'unsupported'; prefs: Prefs; tabId: number | null; isKnownHost: boolean }
  | { phase: 'ready'; match: ReverseMatch; prefs: Prefs; tabId: number | null };

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

export default function App() {
  const [state, setState] = useState<PopupState>({ phase: 'loading' });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [mode, setMode] = useState<PopupMode>('waypoints');
  // Lift the inspect-tab scan up to the popup root so the tab badge can
  // show a hit count even while the user is still on the Waypoints tab.
  // Re-running and rendering still happen inside <InspectView />.
  const inspectScan = useInspectScan();

  useEffect(() => {
    void init();
    // Listen for prefs changes (e.g. user toggled theme in the options page
    // while the popup was open) and re-apply appearance immediately.
    const unsub = onPrefsChanged(next => {
      applyAppearance(next);
      setState(prev =>
        prev.phase === 'ready' || prev.phase === 'unsupported'
          ? { ...prev, prefs: next }
          : prev
      );
    });
    return unsub;
  }, []);

  function selectMode(next: PopupMode) {
    setMode(next);
    // Stamp the click time alongside the mode so the next popup launch
    // can decide whether the remembered tab is still fresh enough.
    void savePrefs({ popupMode: next, popupModeLastUsedAt: Date.now() });
  }

  async function init() {
    const prefs = await loadPrefs();
    applyAppearance(prefs);
    setMode(resolveInitialMode(prefs));
    const tab = await getActiveTab();
    const tabId = (tab?.id as number | undefined) ?? null;
    if (!tab?.url) {
      setState({ phase: 'unsupported', prefs, tabId, isKnownHost: false });
      return;
    }

    let url: URL;
    try {
      url = new URL(tab.url);
    } catch {
      setState({ phase: 'unsupported', prefs, tabId, isKnownHost: false });
      return;
    }

    const isKnownHost = isSupportedHost(url.hostname);

    let match = matchSupportedUrl(url) ?? matchCustomUrl(url, prefs.customWaypoints);

    if (!match) {
      const headMatch = await queryHeadForAtUri(tab);
      if (headMatch) {
        match = headMatch;
      }
    }

    if (!match) {
      setState({ phase: 'unsupported', prefs, tabId, isKnownHost });
      return;
    }

    setState({ phase: 'ready', match, prefs, tabId });
  }

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

  async function openWaypoint(waypoint: WaypointData) {
    if (state.phase !== 'ready') return;
    const { parsed } = state.match;

    setPendingId(waypoint.id);

    // try/finally so any thrown error (resolveHandleToDid, openDestination,
    // a rejected tabs API) still clears the pending state — otherwise the row
    // stays spinner-locked and unclickable for the life of the popup.
    try {
      let did = parsed.did;
      if (requiresDid(waypoint.id, state.prefs.customWaypoints) && !did) {
        const resolved = await resolveHandleToDid(parsed.handle);
        if (!resolved) {
          alert(`Couldn't resolve ${parsed.handle} to a DID.`);
          return;
        }
        did = resolved;
      }

      const url = waypoint.getUrl(parsed.handle, parsed.collection, parsed.rkey, did);
      if (!url) return;

      await bumpRecent(waypoint.id);
      await openDestination(url, state.tabId, state.prefs);
      window.close();
    } catch (err) {
      console.error('[aturi] failed to open waypoint', err);
    } finally {
      setPendingId(null);
    }
  }

  async function openHomeShortcut(waypoint: WaypointData) {
    if (state.phase !== 'unsupported') return;
    const home = getWaypointHomePageUrl(waypoint, state.prefs.customWaypoints);
    if (!home) return;

    setPendingId(waypoint.id);
    await bumpRecent(waypoint.id);
    await openDestination(home, state.tabId, state.prefs);
    setPendingId(null);
    window.close();
  }

  // Resolve the waypoint URL (resolving the handle to a DID if required) and
  // copy it to the clipboard. Used by the per-row copy buttons so users can
  // grab a link to a waypoint without navigating to it.
  async function copyWaypoint(waypoint: WaypointData) {
    if (state.phase !== 'ready') return;
    const { parsed } = state.match;

    let did = parsed.did;
    if (requiresDid(waypoint.id, state.prefs.customWaypoints) && !did) {
      const resolved = await resolveHandleToDid(parsed.handle);
      if (!resolved) {
        alert(`Couldn't resolve ${parsed.handle} to a DID.`);
        return;
      }
      did = resolved;
    }

    const url = waypoint.getUrl(parsed.handle, parsed.collection, parsed.rkey, did);
    if (!url) return;

    await writeToClipboard(url);
    flashCopied(waypoint.id);
  }

  async function copyHomeShortcut(waypoint: WaypointData) {
    if (state.phase !== 'unsupported') return;
    const home = getWaypointHomePageUrl(waypoint, state.prefs.customWaypoints);
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

  if (state.phase === 'loading') {
    return <div className="popup-empty">Loading...</div>;
  }

  const prefs = state.prefs;

  const inner =
    mode === 'inspect' ? (
      <InspectView prefs={prefs} scan={inspectScan} />
    ) : state.phase === 'unsupported' ? (
      <NoAtmosphereView
        prefs={prefs}
        pendingId={pendingId}
        copiedId={copiedId}
        onOpenHome={openHomeShortcut}
        onCopyHome={copyHomeShortcut}
        isKnownHost={state.isKnownHost}
      />
    ) : (
      <Ready
        match={state.match}
        prefs={prefs}
        pendingId={pendingId}
        copiedId={copiedId}
        onOpen={openWaypoint}
        onCopy={copyWaypoint}
      />
    );

  return (
    <div className={`popup-shell ${prefs.compactMode ? 'is-compact' : ''}`}>
      <header className="popup-topbar">
        <div className="popup-title">
          <AturiMark />
          <span>aturi</span>
        </div>
        <PopupModeTabs
          mode={mode}
          onSelect={selectMode}
          inspectCount={inspectScan.hits.length}
          inspectScanning={inspectScan.scanning}
        />
        <div className="popup-topbar-actions">
          <ThemeToggle theme={prefs.theme} />
          <button
            type="button"
            className="popup-icon-btn popup-mode-tab-settings"
            onClick={() => void openOptionsPage()}
            title="Open settings"
            aria-label="Open extension settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>
      <main className="popup-body">{inner}</main>
      <RedirectControl prefs={prefs} tabId={state.tabId} />
    </div>
  );
}

function PopupModeTabs({
  mode,
  onSelect,
  inspectCount,
  inspectScanning,
}: {
  mode: PopupMode;
  onSelect: (next: PopupMode) => void;
  /** Number of AT URIs detected on the active tab. Drives the badge. */
  inspectCount: number;
  /** While the scan is in flight we hide the badge to avoid flicker. */
  inspectScanning: boolean;
}) {
  const showInspectBadge = !inspectScanning && inspectCount > 0;
  return (
    <div className="popup-mode-tabs" role="tablist" aria-label="Popup mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'waypoints'}
        className={`popup-mode-tab ${mode === 'waypoints' ? 'is-active' : ''}`}
        onClick={() => onSelect('waypoints')}
      >
        Waypoints
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'inspect'}
        className={`popup-mode-tab ${mode === 'inspect' ? 'is-active' : ''}`}
        onClick={() => onSelect('inspect')}
      >
        Inspect
        {showInspectBadge && (
          <span
            className="popup-mode-tab-badge"
            aria-label={`${inspectCount} detected URI${inspectCount === 1 ? '' : 's'}`}
          >
            {inspectCount > 99 ? '99+' : inspectCount}
          </span>
        )}
      </button>
    </div>
  );
}

/** What the background reports about auto-redirect for one tab. */
type RedirectScope = { supported: boolean; paused: boolean };

/**
 * Auto-redirect controls, pinned to the bottom of the popup.
 *
 * The switch is the global `autoRedirect` pref, the same one the options page
 * owns — flipping it here stays off until you turn it back on. "Pause on this
 * tab" is the narrower escape hatch: it exempts only the tab you're looking
 * at, lasts until you resume it or close the tab, and never touches your
 * settings. Use it when you want to stay put on one page rather than change
 * how redirects work everywhere.
 */
function RedirectControl({ prefs, tabId }: { prefs: Prefs; tabId: number | null }) {
  const [scope, setScope] = useState<RedirectScope | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tabId == null) {
      setScope({ supported: false, paused: false });
      return;
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
  // Only offer the per-tab pause once we know the background can actually
  // scope a rule to this tab — otherwise the button would toggle nothing.
  const canPause = prefs.autoRedirect && tabId != null && scope?.supported === true;

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

  const showPaused = paused && prefs.autoRedirect;
  const rowClass = [
    'popup-redirect',
    prefs.autoRedirect ? 'is-on' : '',
    showPaused ? 'is-paused' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <footer className={rowClass}>
      {showPaused ? (
        <Pause size={15} className="popup-redirect-icon" aria-hidden />
      ) : (
        <Shuffle size={15} className="popup-redirect-icon" aria-hidden />
      )}
      <span className="popup-redirect-label">
        <span className="popup-redirect-title">
          {showPaused ? 'Paused on this tab' : 'Auto-redirect'}
        </span>
        {showPaused && (
          <span className="popup-redirect-sub">Auto-redirect still works in your other tabs</span>
        )}
      </span>
      {canPause && (
        <button
          type="button"
          className="popup-redirect-pause"
          onClick={() => void togglePause()}
          disabled={busy}
          title={
            paused
              ? 'Redirect links in this tab again'
              : 'Leave this tab alone until you resume it or close the tab'
          }
        >
          {paused ? 'Resume' : 'Pause on this tab'}
        </button>
      )}
      <button
        type="button"
        className={`aturi-switch aturi-switch-sm ${prefs.autoRedirect ? 'on' : ''}`}
        onClick={() => void savePrefs({ autoRedirect: !prefs.autoRedirect })}
        aria-pressed={prefs.autoRedirect}
        aria-label="Auto-redirect"
        title={
          prefs.autoRedirect
            ? 'Turn auto-redirect off everywhere'
            : 'Turn auto-redirect on'
        }
      >
        <span className="popup-redirect-state">{prefs.autoRedirect ? 'On' : 'Off'}</span>
        <span className="aturi-switch-box" aria-hidden />
      </button>
    </footer>
  );
}

async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (err) {
    console.warn('[aturi:popup] clipboard write failed, falling back', err);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

function AturiMark() {
  return (
    <svg
      width="16"
      height="16"
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

type NoAtmosphereViewProps = {
  prefs: Prefs;
  pendingId: string | null;
  copiedId: string | null;
  onOpenHome: (waypoint: WaypointData) => void;
  onCopyHome: (waypoint: WaypointData) => void;
  isKnownHost: boolean;
};

function NoAtmosphereView({
  prefs,
  pendingId,
  copiedId,
  onOpenHome,
  onCopyHome,
  isKnownHost,
}: NoAtmosphereViewProps) {
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

  return (
    <div className={`popup-root ${prefs.compactMode ? 'is-compact' : ''}`}>
      {!isKnownHost && (
        <section className="popup-notice" aria-labelledby="popup-notice-title">
          <span className="popup-notice-icon" aria-hidden="true">
            <Compass size={21} />
          </span>
          <h1 className="popup-notice-title" id="popup-notice-title">
            No Atmosphere data on this page
          </h1>
          <p className="popup-notice-body">
            We couldn&apos;t find a supported AT URI for this tab (from the address or an{' '}
            <code>at://</code> link in the page head). On a supported profile or post, this
            popup offers context-aware links instead.
          </p>
        </section>
      )}

      <NewWaypointsNotice prefs={prefs} />

      {shortcutGroups.length === 0 ? (
        <div className="popup-empty">
          No destinations are visible. Add waypoints to a group in Settings.
          <div style={{ marginTop: 12 }}>
            <button className="aturi-btn" type="button" onClick={() => void openOptionsPage()}>
              Settings
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="popup-jump-head">
            <h2 className="popup-jump-title">Jump to an app</h2>
            <span className="popup-jump-note">Shortcuts open each app&apos;s home page</span>
          </div>
          {shortcutGroups.map(group => (
            <section className="popup-section" key={group.category.id}>
              <h3 className="popup-section-label">{group.category.name}</h3>
              <div className="popup-tiles">
                {group.waypoints.map(w => (
                  <div key={w.id} className="popup-tile">
                    <button
                      type="button"
                      className="popup-tile-main"
                      onClick={() => onOpenHome(w)}
                      disabled={pendingId === w.id}
                      title={homePageSubtitle(w, prefs.customWaypoints)}
                    >
                      <WaypointIcon id={w.id} name={w.name} />
                      <span className="popup-tile-name">{w.name}</span>
                      <span className="popup-tile-desc">{homePageSubtitle(w, prefs.customWaypoints)}</span>
                    </button>
                    <CopyWaypointButton
                      copied={copiedId === w.id}
                      onClick={() => onCopyHome(w)}
                      label={`Copy link to ${w.name}`}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

type ReadyProps = {
  match: ReverseMatch;
  prefs: Prefs;
  pendingId: string | null;
  copiedId: string | null;
  onOpen: (waypoint: WaypointData) => void;
  onCopy: (waypoint: WaypointData) => void;
};

function Ready({ match, prefs, pendingId, copiedId, onOpen, onCopy }: ReadyProps) {
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
    <div className={`popup-root ${prefs.compactMode ? 'is-compact' : ''}`}>
      <PageCard match={match} prefs={prefs} />

      <NewWaypointsNotice prefs={prefs} />

      {prefs.historyEnabled && recents.length > 0 && (
        <section className="popup-section">
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
        <section className="popup-section">
          <h2 className="popup-section-label">{recommended.label}</h2>
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
          <section className="popup-section" key={group.category.id}>
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
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  post: 'Post',
  profile: 'Profile',
  list: 'List',
  record: 'Record',
};

/**
 * Summary of what the current tab shows: the record kind, whose it is and
 * which app it is open in, plus the two copy actions (the aturi.to universal
 * link and the raw at:// URI).
 */
function PageCard({ match, prefs }: { match: ReverseMatch; prefs: Prefs }) {
  const { parsed, source } = match;
  const aturiLink = useMemo(() => {
    const aturi = findWaypoint(prefs, 'aturi');
    if (!aturi) return null;
    return aturi.getUrl(parsed.handle, parsed.collection, parsed.rkey, parsed.did) ?? null;
  }, [prefs, parsed.handle, parsed.collection, parsed.rkey, parsed.did]);

  const kind = parsed.type === 'unknown' ? 'profile' : parsed.type;
  const who = parsed.handle || parsed.did || '';
  const title = kind === 'profile' ? who : `${TYPE_LABEL[kind] ?? 'Record'} by ${who}`;
  const sourceName = findWaypoint(prefs, source)?.name ?? null;
  const initial = (who.replace(/^did:[a-z]+:/, '')[0] ?? '?').toUpperCase();

  return (
    <section className="popup-page" aria-label="This page">
      <div className="popup-page-head">
        <span className="popup-page-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="popup-page-text">
          <span className="popup-page-title">{title}</span>
          <span className="popup-page-meta" title={parsed.uri}>
            <span className="popup-source-collection">
              {parsed.collection ?? (parsed.type === 'unknown' ? 'profile' : parsed.type)}
            </span>
            {sourceName && <> · on {sourceName}</>}
          </span>
        </span>
      </div>
      <div className="popup-page-actions">
        {aturiLink && <HeaderCopyLinkButton url={aturiLink} />}
        <CopyUriButton uri={parsed.uri} />
      </div>
    </section>
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

function ThemeToggle({ theme }: { theme: Prefs['theme'] }) {
  const isDark = theme !== 'light';
  return (
    <button
      type="button"
      className="popup-icon-btn popup-theme-toggle"
      onClick={() => void savePrefs({ theme: isDark ? 'light' : 'dark' })}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {/* Sun in dark mode (click to go light), moon in light mode. */}
      {isDark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
    </button>
  );
}

function CopyUriButton({ uri }: { uri: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await writeToClipboard(uri);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      className={`popup-page-btn popup-uri ${copied ? 'is-copied' : ''}`}
      onClick={handleCopy}
      title={copied ? 'Copied!' : `Click to copy\n${uri}`}
      aria-label={copied ? 'Copied to clipboard' : 'Copy Atmosphere URI to clipboard'}
    >
      {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      <span>{copied ? 'Copied!' : 'Copy at:// URI'}</span>
    </button>
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

function HeaderCopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await writeToClipboard(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      className={`popup-page-btn popup-header-copy ${copied ? 'is-copied' : ''}`}
      onClick={handleCopy}
      title={copied ? 'Copied!' : `Copy aturi.to link\n${url}`}
      aria-label={copied ? 'Copied aturi.to link to clipboard' : 'Copy aturi.to universal link'}
    >
      {copied ? <Check size={13} aria-hidden /> : <Link2 size={13} aria-hidden />}
      <span>{copied ? 'Copied!' : 'Copy aturi.to link'}</span>
    </button>
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
      {copied ? <Check size={14} aria-hidden /> : <Link2 size={14} aria-hidden />}
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
