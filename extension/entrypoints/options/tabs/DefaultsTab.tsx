import { useMemo } from 'react';
import {
  COMPAT_FAMILIES,
  COMPAT_FAMILY_ORDER,
  type RedirectCompatFamily,
} from '@aturi/waypoints.data';
import {
  clearRecents,
  getRedirectCompatFor,
  setFavoriteForFamily,
  type Prefs,
} from '../../../lib/prefs';
import { allWaypoints, DID_REQUIRED_WAYPOINTS, visibleWaypointIds } from '../../../lib/catalog';
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect';

type Props = {
  prefs: Prefs;
  onChange: (partial: Partial<Prefs>) => void;
};

export default function DefaultsTab({ prefs, onChange }: Props) {
  const waypoints = useMemo(
    () => allWaypoints(prefs.customWaypoints),
    [prefs.customWaypoints]
  );
  const visible = useMemo(() => visibleWaypointIds(prefs), [prefs.waypointGroups]);

  // Build per-family candidate lists: visible, redirect-capable waypoints
  // that belong to that family. DID-required waypoints (pdsls, atp.tools, …)
  // are excluded because they can't be a *destination* of a static DNR rule.
  const familyCandidates = useMemo(() => {
    const map = new Map<RedirectCompatFamily, typeof waypoints>();
    for (const family of COMPAT_FAMILY_ORDER) {
      const candidates = waypoints.filter(w => {
        if (!visible.has(w.id)) return false;
        if (DID_REQUIRED_WAYPOINTS.has(w.id)) return false;
        const compat = getRedirectCompatFor(w.id, prefs.customWaypoints);
        return compat.includes(family);
      });
      if (candidates.length > 0) map.set(family, candidates);
    }
    return map;
  }, [waypoints, visible, prefs.customWaypoints]);

  // Total visible members of each family, *including* DID-required ones. Those
  // can't be redirect destinations but are still valid redirect sources, so
  // they count toward whether a family has anything worth configuring.
  const familyMemberCounts = useMemo(() => {
    const map = new Map<RedirectCompatFamily, number>();
    for (const family of COMPAT_FAMILY_ORDER) {
      const count = waypoints.filter(w => {
        if (!visible.has(w.id)) return false;
        return getRedirectCompatFor(w.id, prefs.customWaypoints).includes(family);
      }).length;
      map.set(family, count);
    }
    return map;
  }, [waypoints, visible, prefs.customWaypoints]);

  // Surface a family's favorite selector when a redirect could actually happen:
  // at least one non-DID destination to land on, and at least two members
  // overall so there's a source distinct from that destination. This is what
  // reveals the explorer family (pdsls / atp.tools → Aturi Explore), whose only
  // valid destination is Aturi Explore even though the DID-only explorers are
  // still redirect sources. Single-member families stay hidden as clutter.
  const activeFamilies = useMemo(
    () =>
      COMPAT_FAMILY_ORDER.filter(f => {
        const candidateCount = familyCandidates.get(f)?.length ?? 0;
        const memberCount = familyMemberCounts.get(f) ?? 0;
        return candidateCount >= 1 && memberCount >= 2;
      }),
    [familyCandidates, familyMemberCounts]
  );

  function setFamilyFavorite(family: RedirectCompatFamily, id: string) {
    const next = setFavoriteForFamily(prefs, family, id || null);
    onChange({ favoriteByFamily: next.favoriteByFamily });
  }

  async function handleClearRecents() {
    if (!confirm('Clear your Recents list? This only affects the Recents row in the popup.')) {
      return;
    }
    await clearRecents();
  }

  return (
    <div>
      <h1 className="options-h1">General</h1>
      <p className="options-lede">
        Tune how the popup behaves and, when auto-redirect is on, pick a favorite reader
        for each family of records. Redirects only apply between clients that share the
        same underlying data.
      </p>

      <div className="options-card">
        <div className="options-card-title">Appearance</div>
        <div className="options-card-sub">
          Pick a color theme and text size. Changes apply immediately to the popup
          and this settings page.
        </div>

        <div className="appearance-row">
          <div className="appearance-row-label">Theme</div>
          <div
            className="appearance-segmented"
            role="radiogroup"
            aria-label="Color theme"
          >
            {(['dark', 'light'] as const).map(value => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={prefs.theme === value}
                className={`appearance-segment ${prefs.theme === value ? 'is-active' : ''}`}
                onClick={() => onChange({ theme: value })}
              >
                {value === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
          </div>
        </div>

        <div className="appearance-row">
          <div className="appearance-row-label">Text size</div>
          <div
            className="appearance-segmented"
            role="radiogroup"
            aria-label="Text size"
          >
            {(
              [
                { value: 'small', label: 'Small' },
                { value: 'medium', label: 'Medium' },
                { value: 'large', label: 'Large' },
                { value: 'xlarge', label: 'X-Large' },
              ] as const
            ).map(opt => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={prefs.fontSize === opt.value}
                className={`appearance-segment ${prefs.fontSize === opt.value ? 'is-active' : ''}`}
                onClick={() => onChange({ fontSize: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="options-card">
        <div className="options-card-title">Popup</div>
        <div className="options-card-sub">
          Choose which view the popup opens to by default. The Waypoints view
          jumps between Atmosphere apps for the current page; the Inspect view
          surfaces the AT URIs detected on the page.
        </div>

        <div className="appearance-row">
          <div className="appearance-row-label">Default view</div>
          <div
            className="appearance-segmented"
            role="radiogroup"
            aria-label="Default popup view"
          >
            {(
              [
                { value: 'waypoints', label: 'Waypoints' },
                { value: 'inspect', label: 'Inspect' },
              ] as const
            ).map(opt => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={prefs.popupModeDefault === opt.value}
                className={`appearance-segment ${prefs.popupModeDefault === opt.value ? 'is-active' : ''}`}
                onClick={() => onChange({ popupModeDefault: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="aturi-hr" />

        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">Remember last-used view</div>
            <div className="options-card-sub">
              {prefs.popupModeRemember
                ? `On — after you switch between the Waypoints and Inspect views, the popup reopens to whichever you used last for the next ${prefs.popupModeRememberMinutes} minutes, then reverts to the default.`
                : 'Off — every popup launch starts on the default view above.'}
            </div>
          </div>
          <button
            className={`aturi-switch ${prefs.popupModeRemember ? 'on' : ''}`}
            onClick={() => onChange({ popupModeRemember: !prefs.popupModeRemember })}
            aria-pressed={prefs.popupModeRemember}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.popupModeRemember ? 'On' : 'Off'}</span>
          </button>
        </div>

        {prefs.popupModeRemember && (
          <div className="appearance-row">
            <div className="appearance-row-label">Remember for</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                className="aturi-input"
                min={5}
                max={1440}
                step={5}
                value={prefs.popupModeRememberMinutes}
                style={{ width: 90 }}
                onChange={e => {
                  const raw = Number(e.currentTarget.value);
                  if (!Number.isFinite(raw)) return;
                  const next = Math.min(1440, Math.max(5, Math.round(raw)));
                  onChange({ popupModeRememberMinutes: next });
                }}
              />
              <span className="aturi-subtle" style={{ fontSize: 12 }}>minutes (5–1440)</span>
            </div>
          </div>
        )}
      </div>

      <div className="options-card">
        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">Auto-redirect</div>
            <div className="options-card-sub">
              {prefs.autoRedirect
                ? 'On — pick a favorite reader for each record family below.'
                : 'Off — the popup still works, but nothing is redirected automatically.'}
            </div>
          </div>
          <button
            className={`aturi-switch ${prefs.autoRedirect ? 'on' : ''}`}
            onClick={() => onChange({ autoRedirect: !prefs.autoRedirect })}
            aria-pressed={prefs.autoRedirect}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.autoRedirect ? 'On' : 'Off'}</span>
          </button>
        </div>

        {prefs.autoRedirect && (
          <div className="defaults-favorites-block">
            <div className="aturi-hr" />
            <div className="defaults-favorites-intro">
              <div className="aturi-label" style={{ marginBottom: 4 }}>
                Favorites by compatibility group
              </div>
              <div className="aturi-subtle" style={{ fontSize: 12 }}>
                Each group holds apps that render the same underlying records, so
                redirects between them make sense. Pick a favorite (or leave blank) for
                each.
              </div>
            </div>

            {activeFamilies.length === 0 ? (
              <div className="aturi-subtle" style={{ marginTop: 6 }}>
                Add more waypoints to your groups in the Waypoints tab to configure
                favorites here.
              </div>
            ) : (
              <div className="defaults-family-list">
                {activeFamilies.map(family => {
                  const meta = COMPAT_FAMILIES[family];
                  const candidates = familyCandidates.get(family) ?? [];
                  const current = prefs.favoriteByFamily?.[family] ?? '';
                  const options: SearchSelectOption[] = [
                    { value: '', label: '(none)', fixed: true },
                    ...candidates.map(w => ({ value: w.id, label: w.name })),
                  ];
                  return (
                    <div className="defaults-family-row" key={family}>
                      <div className="defaults-family-meta">
                        <div className="defaults-family-name">{meta.name}</div>
                        <div className="defaults-family-desc">{meta.description}</div>
                      </div>
                      <SearchSelect
                        id={`favorite-${family}`}
                        options={options}
                        value={current}
                        onChange={val => setFamilyFavorite(family, val)}
                        placeholder="(none)"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="aturi-hr" />

        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">Smart recommendations</div>
            <div className="options-card-sub">
              {prefs.smartRecommendations
                ? 'The popup highlights a "Recommended" row tailored to the current record (e.g. Standard Site pages suggest Leaflet, Offprint, pckt).'
                : 'Off — the popup only shows your defined groups in the order you set, with no extra recommendation row.'}
            </div>
          </div>
          <button
            className={`aturi-switch ${prefs.smartRecommendations ? 'on' : ''}`}
            onClick={() => onChange({ smartRecommendations: !prefs.smartRecommendations })}
            aria-pressed={prefs.smartRecommendations}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.smartRecommendations ? 'On' : 'Off'}</span>
          </button>
        </div>

        <div className="aturi-hr" />

        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">Detect active apps</div>
            <div className="options-card-sub">
              {prefs.pdsRecordScan
                ? "On — the popup quickly scans the target repo's collections and dims waypoints with no records found there (e.g. Tangled gets dimmed on a profile with no sh.tangled.* records). Active apps also rank higher in recommendations."
                : 'Off — every waypoint renders the same way regardless of whether the target user has any records in its lexicons.'}
            </div>
          </div>
          <button
            className={`aturi-switch ${prefs.pdsRecordScan ? 'on' : ''}`}
            onClick={() => onChange({ pdsRecordScan: !prefs.pdsRecordScan })}
            aria-pressed={prefs.pdsRecordScan}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.pdsRecordScan ? 'On' : 'Off'}</span>
          </button>
        </div>

        <div className="aturi-hr" />

        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">Auto-scan pages for AT URIs</div>
            <div className="options-card-sub">
              {prefs.passiveScanEnabled
                ? 'On — every page you visit is checked for AT URIs (in meta tags, head links, and anchors), and a count badge appears on the toolbar icon when any are found.'
                : "Off — the toolbar icon stays neutral. The popup's Inspect tab still scans on demand when you open it."}
            </div>
          </div>
          <button
            className={`aturi-switch ${prefs.passiveScanEnabled ? 'on' : ''}`}
            onClick={() => onChange({ passiveScanEnabled: !prefs.passiveScanEnabled })}
            aria-pressed={prefs.passiveScanEnabled}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.passiveScanEnabled ? 'On' : 'Off'}</span>
          </button>
        </div>

        <div className="aturi-hr" />

        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">Open in new tab</div>
            <div className="options-card-sub">
              {prefs.openInNewTab
                ? 'Picking a waypoint opens it in a new browser tab.'
                : 'Off — picking a waypoint navigates the current tab instead of opening a new one.'}
            </div>
          </div>
          <button
            className={`aturi-switch ${prefs.openInNewTab ? 'on' : ''}`}
            onClick={() => onChange({ openInNewTab: !prefs.openInNewTab })}
            aria-pressed={prefs.openInNewTab}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.openInNewTab ? 'On' : 'Off'}</span>
          </button>
        </div>

        <div className="aturi-hr" />

        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">Compact mode</div>
            <div className="options-card-sub">
              {prefs.compactMode
                ? 'On — the popup uses a denser layout with smaller icons and no description line, so more waypoints fit at once.'
                : 'Off — the popup shows each waypoint with a larger icon and a secondary description line.'}
            </div>
          </div>
          <button
            className={`aturi-switch ${prefs.compactMode ? 'on' : ''}`}
            onClick={() => onChange({ compactMode: !prefs.compactMode })}
            aria-pressed={prefs.compactMode}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.compactMode ? 'On' : 'Off'}</span>
          </button>
        </div>

        <div className="aturi-hr" />

        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">Recents</div>
            <div className="options-card-sub">
              {prefs.historyEnabled
                ? 'On — the popup shows a Recents row at the top with the waypoints you reach for most often.'
                : 'Off — the popup hides the Recents row and stops recording new picks.'}
            </div>
            {prefs.historyEnabled && prefs.recents.length > 0 && (
              <button
                type="button"
                className="aturi-btn aturi-btn-ghost defaults-clear-recents"
                onClick={handleClearRecents}
              >
                Clear Recents ({prefs.recents.length})
              </button>
            )}
          </div>
          <button
            className={`aturi-switch ${prefs.historyEnabled ? 'on' : ''}`}
            onClick={() => onChange({ historyEnabled: !prefs.historyEnabled })}
            aria-pressed={prefs.historyEnabled}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.historyEnabled ? 'On' : 'Off'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
