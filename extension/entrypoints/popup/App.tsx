import { useEffect, useMemo, useState } from 'react';
import { browser } from '#imports';
import type { ReverseMatch } from '@aturi/reverseParsers';
import type { WaypointData, WaypointType } from '@aturi/waypoints.data';
import { matchSupportedUrl, parseAtUri, SUPPORTED_HOSTS } from '@aturi/reverseParsers';
import { matchCustomUrl } from '../../lib/template';
import {
  categorizedForType,
  categorizedVisibleAll,
  findWaypoint,
  recommendedForType,
  requiresDid,
  visibleWaypointIds,
  waypointHandlesContent,
} from '../../lib/catalog';
import { bumpRecent, loadPrefs, type Prefs } from '../../lib/prefs';
import { resolveHandleToDid } from '../../lib/handleResolver';
import { describeWaypoint } from '../../lib/describe';
import { getWaypointHomePageUrl, homePageSubtitle } from '../../lib/homePage';
import { WaypointIcon } from '../../lib/Icons';

type PopupState =
  | { phase: 'loading' }
  | { phase: 'unsupported'; prefs: Prefs; tabId: number | null; isKnownHost: boolean }
  | { phase: 'ready'; match: ReverseMatch; prefs: Prefs; tabId: number | null };

// Open the extension's options page. We prefer browser.runtime.openOptionsPage()
// because it focuses an existing options tab when one is already open. Some
// Chromium-derived browsers (notably Arc) do not implement the chrome://extensions
// surface that hosts embedded options, so the call can silently no-op. If it
// throws or never resolves, fall back to opening options.html in a new tab.
async function openOptionsPage() {
  const fallbackUrl = browser.runtime.getURL('/options.html');
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

  useEffect(() => {
    void init();
  }, []);

  async function init() {
    const prefs = await loadPrefs();
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

  if (state.phase === 'unsupported') {
    return (
      <NoAtmosphereView
        prefs={state.prefs}
        pendingId={pendingId}
        copiedId={copiedId}
        onOpenHome={openHomeShortcut}
        onCopyHome={copyHomeShortcut}
        isKnownHost={state.isKnownHost}
      />
    );
  }

  return (
    <Ready
      match={state.match}
      prefs={state.prefs}
      pendingId={pendingId}
      copiedId={copiedId}
      onOpen={openWaypoint}
      onCopy={copyWaypoint}
    />
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
      stroke="#8a9a7f"
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
            <span className="popup-tagline">Atmosphere Fast Travel</span>
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
          <div className="popup-footer">
            <span className="aturi-subtle" style={{ fontSize: 11 }}>
              Shortcuts open each app&apos;s home page
            </span>
            <button
              className="aturi-btn-ghost aturi-btn"
              type="button"
              onClick={() => void openOptionsPage()}
            >
              Settings
            </button>
          </div>
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

  const categorized = useMemo(
    () => categorizedForType(prefs, type),
    [prefs, type]
  );

  const recommended = useMemo(
    () => recommendedForType(prefs, type, parsed.collection),
    [prefs, type, parsed.collection]
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
                  onClick={onOpen}
                  onCopy={onCopy}
                />
              ))}
            </div>
          </div>
        );
      })}

      <div className="popup-footer">
        <CopyUriButton uri={parsed.uri} />
        <button className="aturi-btn-ghost aturi-btn" onClick={() => void openOptionsPage()}>
          Settings
        </button>
      </div>
    </div>
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
  onClick,
  onCopy,
}: {
  waypoint: WaypointData;
  collection?: string;
  type: WaypointType;
  pending: boolean;
  copied: boolean;
  onClick: (w: WaypointData) => void;
  onCopy: (w: WaypointData) => void;
}) {
  return (
    <div className="popup-waypoint">
      <button
        type="button"
        className="popup-waypoint-main"
        onClick={() => onClick(waypoint)}
        disabled={pending}
      >
        <WaypointIcon id={waypoint.id} name={waypoint.name} />
        <div className="popup-waypoint-text">
          <div className="popup-waypoint-name">{waypoint.name}</div>
          <div className="popup-waypoint-desc">
            {describeWaypoint(waypoint, collection, type)}
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
