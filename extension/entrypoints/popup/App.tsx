import { useEffect, useMemo, useState } from 'react';
import { browser } from '#imports';
import { MousePointer2, Telescope } from 'lucide-react';
import type { ReverseMatch } from '@aturi/reverseParsers';
import type { WaypointActivity, WaypointData, WaypointType } from '@aturi/waypoints.data';
import { matchSupportedUrl, parseAtUri, SUPPORTED_HOSTS } from '@aturi/reverseParsers';
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
    void savePrefs({ popupMode: next });
  }

  async function init() {
    const prefs = await loadPrefs();
    applyAppearance(prefs);
    if (prefs.popupMode === 'inspect') setMode('inspect');
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

    const isKnownHost = SUPPORTED_HOSTS.includes(url.hostname.replace(/^www\./, ''));

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

  async function openWaypoint(waypoint: WaypointData) {
    if (state.phase !== 'ready') return;
    const { parsed } = state.match;

    setPendingId(waypoint.id);

    let did = parsed.did;
    if (requiresDid(waypoint.id, state.prefs.customWaypoints) && !did) {
      const resolved = await resolveHandleToDid(parsed.handle);
      if (!resolved) {
        setPendingId(null);
        alert(`Couldn't resolve ${parsed.handle} to a DID.`);
        return;
      }
      did = resolved;
    }

    const url = waypoint.getUrl(parsed.handle, parsed.collection, parsed.rkey, did);
    if (!url) {
      setPendingId(null);
      return;
    }

    await bumpRecent(waypoint.id);
    await navigateTo(url, state.tabId, state.prefs.openInNewTab);
    setPendingId(null);
    window.close();
  }

  async function openHomeShortcut(waypoint: WaypointData) {
    if (state.phase !== 'unsupported') return;
    const home = getWaypointHomePageUrl(waypoint, state.prefs.customWaypoints);
    if (!home) return;

    setPendingId(waypoint.id);
    await bumpRecent(waypoint.id);
    await navigateTo(home, state.tabId, state.prefs.openInNewTab);
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
      <PopupModeTabs
        mode={mode}
        onSelect={selectMode}
        inspectCount={inspectScan.hits.length}
        inspectScanning={inspectScan.scanning}
      />
      {inner}
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
        <MousePointer2 size={12} aria-hidden />
        Waypoints
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'inspect'}
        className={`popup-mode-tab ${mode === 'inspect' ? 'is-active' : ''}`}
        onClick={() => onSelect('inspect')}
      >
        <Telescope size={12} aria-hidden />
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
      strokeWidth="2"
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
      <div className="popup-header">
        <div className="popup-title">
          <AturiMark />
          <span>Aturi</span>
        </div>
        <div className="popup-source">
          <div className="popup-header-actions">
            <span className="popup-tagline">Tour the Atmosphere</span>
            <HeaderSettingsButton />
          </div>
        </div>
      </div>

      {!isKnownHost && (
        <div className="popup-notice">
          <div className="popup-notice-title">No Atmosphere data on this page</div>
          <div>
            We couldn&apos;t find a supported AT URI for this tab (from the address or an{' '}
            <code style={{ fontSize: 12 }}>at://</code> link in the page head). Your destinations
            below open each app&apos;s home page. On a supported profile or post, this popup will
            offer context-aware links instead.
          </div>
        </div>
      )}

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
          {shortcutGroups.map(group => (
            <div className="popup-section" key={group.category.id}>
              <div className="popup-section-label">{group.category.name}</div>
              <div className="popup-waypoints">
                {group.waypoints.map(w => (
                  <div key={w.id} className="popup-waypoint">
                    <button
                      type="button"
                      className="popup-waypoint-main"
                      onClick={() => onOpenHome(w)}
                      disabled={pendingId === w.id}
                    >
                      <WaypointIcon id={w.id} name={w.name} />
                      <div className="popup-waypoint-text">
                        <div className="popup-waypoint-name">{w.name}</div>
                        {!prefs.compactMode && (
                          <div className="popup-waypoint-desc">
                            {homePageSubtitle(w, prefs.customWaypoints)}
                          </div>
                        )}
                      </div>
                    </button>
                    <CopyWaypointButton
                      copied={copiedId === w.id}
                      onClick={() => onCopyHome(w)}
                      label={`Copy link to ${w.name}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <PopupFooter
            prefs={prefs}
            leading={
              <span className="aturi-subtle" style={{ fontSize: 11 }}>
                Shortcuts open each app&apos;s home page
              </span>
            }
          />
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

  // Aturi universal link for the current AT URI. We always look up the aturi
  // waypoint directly (independent of group visibility) so the header copy
  // button works even if the user has hidden Aturi from their popup groups.
  const aturiLink = useMemo(() => {
    const aturi = findWaypoint(prefs, 'aturi');
    if (!aturi) return null;
    return (
      aturi.getUrl(parsed.handle, parsed.collection, parsed.rkey, parsed.did) ?? null
    );
  }, [prefs, parsed.handle, parsed.collection, parsed.rkey, parsed.did]);

  return (
    <div className={`popup-root ${prefs.compactMode ? 'is-compact' : ''}`}>
      <div className="popup-header">
        <div className="popup-title">
          <AturiMark />
          <span>Aturi</span>
        </div>
        <div className="popup-source">
          <div className="popup-header-actions">
            {aturiLink && <HeaderCopyLinkButton url={aturiLink} />}
            <HeaderSettingsButton />
          </div>
          <div className="popup-source-collection" title={parsed.uri}>
            {parsed.collection ?? type}
          </div>
        </div>
      </div>

      {prefs.historyEnabled && recents.length > 0 && (
        <div className="popup-section">
          <div className="popup-section-label">Recents</div>
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
                <div className="popup-recent-name">{w.name}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {prefs.smartRecommendations && recommended.waypoints.length > 0 && (
        <div className="popup-section">
          <div className="popup-section-label">{recommended.label}</div>
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
        </div>
      )}

      {categorized.map(group => {
        const waypoints = group.waypoints.filter(
          w => w.id !== source && !recommendedIds.has(w.id)
        );
        if (waypoints.length === 0) return null;
        return (
          <div className="popup-section" key={group.category.id}>
            <div className="popup-section-label">{group.category.name}</div>
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
          </div>
        );
      })}

      <PopupFooter prefs={prefs} leading={<CopyUriButton uri={parsed.uri} />} />
    </div>
  );
}

// Footer renders the per-view leading content (URI button or shortcuts note)
// alongside the appearance toggle, and stacks a dismissable "new waypoints"
// banner above when the catalog has grown since the user last opened the
// popup. The Settings button moved to the header gear long ago — this is
// where the theme toggle lives now.
function PopupFooter({ prefs, leading }: { prefs: Prefs; leading: React.ReactNode }) {
  const newWaypoints = useMemo(() => newBuiltinWaypoints(prefs), [prefs]);

  useEffect(() => {
    if (newWaypoints.length > 0) {
      debugLog('banner: rendered', { ids: newWaypoints.map(w => w.id) });
    }
  }, [newWaypoints]);

  return (
    <div className="popup-footer">
      {newWaypoints.length > 0 && (
        <NewWaypointsBanner
          waypoints={newWaypoints}
          onOpenSettings={() => {
            debugLog('banner: Add clicked', { ids: newWaypoints.map(w => w.id) });
            void openOptionsPage('waypoints');
          }}
          onDismiss={() => {
            debugLog('banner: dismissed', { ids: newWaypoints.map(w => w.id) });
            void markWaypointsKnown(newWaypoints.map(w => w.id));
          }}
        />
      )}
      <div className="popup-footer-row">
        {leading}
        <ThemeToggle theme={prefs.theme} />
      </div>
    </div>
  );
}

function NewWaypointsBanner({
  waypoints,
  onOpenSettings,
  onDismiss,
}: {
  waypoints: WaypointData[];
  onOpenSettings: () => void;
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
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4" />
          <path d="M12 18v4" />
          <path d="m4.93 4.93 2.83 2.83" />
          <path d="m16.24 16.24 2.83 2.83" />
          <path d="M2 12h4" />
          <path d="M18 12h4" />
          <path d="m4.93 19.07 2.83-2.83" />
          <path d="m16.24 7.76 2.83-2.83" />
        </svg>
      </span>
      <span className="popup-update-banner-text">{summary}</span>
      <button
        type="button"
        className="popup-update-banner-action"
        onClick={onOpenSettings}
      >
        Add
      </button>
      <button
        type="button"
        className="popup-update-banner-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss new waypoints notification"
        title="Dismiss"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>
  );
}

function ThemeToggle({ theme }: { theme: Prefs['theme'] }) {
  const isDark = theme !== 'light';
  return (
    <button
      type="button"
      className="popup-theme-toggle"
      onClick={() => void savePrefs({ theme: isDark ? 'light' : 'dark' })}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? (
        // Sun – we're in dark mode, click to go light.
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      ) : (
        // Moon – we're in light mode, click to go dark.
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
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
      className={`popup-uri ${copied ? 'is-copied' : ''}`}
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Click to copy'}
      aria-label={copied ? 'Copied to clipboard' : 'Copy Atmosphere URI to clipboard'}
    >
      <span className="popup-uri-icon" aria-hidden="true">
        {copied ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="0" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
      <span className="popup-uri-text">{copied ? 'Copied!' : uri}</span>
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
            : undefined
        }
      >
        <WaypointIcon id={waypoint.id} name={waypoint.name} />
        <div className="popup-waypoint-text">
          <div className="popup-waypoint-name">{waypoint.name}</div>
          <div className="popup-waypoint-desc">
            {isAbsent
              ? 'No records found on this repo'
              : describeWaypoint(waypoint, collection, type)}
          </div>
        </div>
      </button>
      <CopyWaypointButton
        copied={copied}
        onClick={() => onCopy(waypoint)}
        label={`Copy link to ${waypoint.name}`}
      />
    </div>
  );
}

function HeaderSettingsButton() {
  return (
    <button
      type="button"
      className="popup-header-settings"
      onClick={() => void openOptionsPage()}
      title="Open settings"
      aria-label="Open extension settings"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
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
      className={`popup-header-copy ${copied ? 'is-copied' : ''}`}
      onClick={handleCopy}
      title={copied ? 'Copied!' : `Copy aturi.to link\n${url}`}
      aria-label={copied ? 'Copied aturi.to link to clipboard' : 'Copy aturi.to universal link'}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="0" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      <span>{copied ? 'Copied!' : 'Copy universal link'}</span>
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
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="0" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
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

  const allActive = await tryQuery({ active: true });
  if (allActive.length) {
    const withUrl = allActive.find(t => !!t.url);
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

  const lastFocused = await tryQuery({
    active: true,
    lastFocusedWindow: true,
  });
  if (lastFocused.length) {
    const withUrl = lastFocused.find(t => !!t.url);
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

  return allActive[0] ?? allNormal[0] ?? lastFocused[0] ?? null;
}
