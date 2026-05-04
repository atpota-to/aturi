import { useEffect, useMemo, useState } from 'react';
import { browser } from '#imports';
import type { ReverseMatch } from '@aturi/reverseParsers';
import type { WaypointData, WaypointType } from '@aturi/waypoints.data';
import { matchSupportedUrl, parseAtUri } from '@aturi/reverseParsers';
import { matchCustomUrl } from '../../lib/template';
import {
  categorizedForType,
  categorizedVisibleAll,
  findWaypoint,
  recommendedForType,
  requiresDid,
  visibleWaypointIds,
} from '../../lib/catalog';
import { bumpRecent, loadPrefs, type Prefs } from '../../lib/prefs';
import { resolveHandleToDid } from '../../lib/handleResolver';
import { describeWaypoint } from '../../lib/describe';
import { getWaypointHomePageUrl, homePageSubtitle } from '../../lib/homePage';
import { WaypointIcon } from '../../lib/Icons';

type PopupState =
  | { phase: 'loading' }
  | { phase: 'unsupported'; prefs: Prefs }
  | { phase: 'ready'; match: ReverseMatch; prefs: Prefs };

export default function App() {
  const [state, setState] = useState<PopupState>({ phase: 'loading' });
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, []);

  async function init() {
    const prefs = await loadPrefs();
    const tab = await getActiveTab();
    if (!tab?.url) {
      setState({ phase: 'unsupported', prefs });
      return;
    }

    let url: URL;
    try {
      url = new URL(tab.url);
    } catch {
      setState({ phase: 'unsupported', prefs });
      return;
    }

    let match = matchSupportedUrl(url) ?? matchCustomUrl(url, prefs.customWaypoints);

    if (!match) {
      const headMatch = await queryHeadForAtUri(tab);
      if (headMatch) {
        match = headMatch;
      }
    }

    if (!match) {
      setState({ phase: 'unsupported', prefs });
      return;
    }

    setState({ phase: 'ready', match, prefs });
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
    await browser.tabs.create({ url });
    setPendingId(null);
    window.close();
  }

  async function openHomeShortcut(waypoint: WaypointData) {
    if (state.phase !== 'unsupported') return;
    const home = getWaypointHomePageUrl(waypoint, state.prefs.customWaypoints);
    if (!home) return;

    setPendingId(waypoint.id);
    await bumpRecent(waypoint.id);
    await browser.tabs.create({ url: home });
    setPendingId(null);
    window.close();
  }

  if (state.phase === 'loading') {
    return <div className="popup-empty">Loading...</div>;
  }

  if (state.phase === 'unsupported') {
    return (
      <NoAtmosphereView
        prefs={state.prefs}
        pendingId={pendingId}
        onOpenHome={openHomeShortcut}
      />
    );
  }

  return (
    <Ready
      match={state.match}
      prefs={state.prefs}
      pendingId={pendingId}
      onOpen={openWaypoint}
    />
  );
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
  onOpenHome: (waypoint: WaypointData) => void;
};

function NoAtmosphereView({ prefs, pendingId, onOpenHome }: NoAtmosphereViewProps) {
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
    <div className="popup-root">
      <div className="popup-header">
        <div className="popup-title">
          <AturiMark />
          <span>Aturi</span>
        </div>
      </div>

      <div className="popup-notice">
        <div className="popup-notice-title">No Atmosphere data on this page</div>
        <div>
          We couldn&apos;t find a supported AT URI for this tab (from the address or an{' '}
          <code style={{ fontSize: 12 }}>at://</code> link in the page head). Your destinations
          below open each app&apos;s home page. On a supported profile or post, this popup will
          offer context-aware links instead.
        </div>
      </div>

      {shortcutGroups.length === 0 ? (
        <div className="popup-empty">
          No destinations are visible. Add waypoints to a group in Settings.
          <div style={{ marginTop: 12 }}>
            <button className="aturi-btn" type="button" onClick={() => browser.runtime.openOptionsPage()}>
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
                  <button
                    key={w.id}
                    type="button"
                    className="popup-waypoint"
                    onClick={() => onOpenHome(w)}
                    disabled={pendingId === w.id}
                  >
                    <WaypointIcon id={w.id} name={w.name} />
                    <div className="popup-waypoint-text">
                      <div className="popup-waypoint-name">{w.name}</div>
                      <div className="popup-waypoint-desc">
                        {homePageSubtitle(w, prefs.customWaypoints)}
                      </div>
                    </div>
                  </button>
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
              onClick={() => browser.runtime.openOptionsPage()}
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
  onOpen: (waypoint: WaypointData) => void;
};

function Ready({ match, prefs, pendingId, onOpen }: ReadyProps) {
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
        return w && visible.has(w.id) && w.supportedTypes.includes(type) && w.id !== source
          ? w
          : null;
      })
      .filter((w): w is WaypointData => !!w)
      .slice(0, 5);
  }, [prefs, type, source]);

  return (
    <div className="popup-root">
      <div className="popup-header">
        <div className="popup-title">
          <AturiMark />
          <span>Aturi</span>
        </div>
        <div className="popup-source">
          <div className="popup-source-handle">{parsed.handle}</div>
          <div>
            {source} &middot; {type}
          </div>
        </div>
      </div>

      {prefs.showRecents && recents.length > 0 && (
        <div className="popup-section">
          <div className="popup-section-label">Recently used</div>
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
                  onClick={onOpen}
                />
              ))}
          </div>
        </div>
      )}

      {categorized.map(group => {
        const waypoints = group.waypoints.filter(w => w.id !== source);
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
                  onClick={onOpen}
                />
              ))}
            </div>
          </div>
        );
      })}

      <div className="popup-footer">
        <CopyUriButton uri={parsed.uri} />
        <button className="aturi-btn-ghost aturi-btn" onClick={() => browser.runtime.openOptionsPage()}>
          Settings
        </button>
      </div>
    </div>
  );
}

function CopyUriButton({ uri }: { uri: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(uri);
    } catch (err) {
      console.warn('[aturi:popup] clipboard write failed, falling back', err);
      const ta = document.createElement('textarea');
      ta.value = uri;
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
  onClick,
}: {
  waypoint: WaypointData;
  collection?: string;
  type: WaypointType;
  pending: boolean;
  onClick: (w: WaypointData) => void;
}) {
  return (
    <button
      className="popup-waypoint"
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
