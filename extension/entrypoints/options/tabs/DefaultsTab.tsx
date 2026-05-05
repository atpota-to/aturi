import { useMemo } from 'react';
import {
  COMPAT_FAMILIES,
  COMPAT_FAMILY_ORDER,
  type RedirectCompatFamily,
} from '@aturi/waypoints.data';
import {
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
  // that belong to that family.
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

  // Only surface families with >1 member - there's nothing to "choose" if the
  // family has exactly one waypoint, and it'd only add clutter.
  const activeFamilies = useMemo(
    () => COMPAT_FAMILY_ORDER.filter(f => (familyCandidates.get(f)?.length ?? 0) > 1),
    [familyCandidates]
  );

  function setFamilyFavorite(family: RedirectCompatFamily, id: string) {
    const next = setFavoriteForFamily(prefs, family, id || null);
    onChange({ favoriteByFamily: next.favoriteByFamily });
  }

  return (
    <div>
      <h1 className="options-h1">General</h1>
      <p className="options-lede">
        Tune how the popup behaves and, when auto-redirect is on, pick a favorite reader
        for each family of records. Redirects only apply between apps that share the
        same underlying data.
      </p>

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
            <div className="options-card-title">Show recently used</div>
            <div className="options-card-sub">
              {prefs.showRecents
                ? 'A "Recently used" row appears at the top of the popup with your most recent picks.'
                : 'Off — the popup skips the recents row and jumps straight into your groups.'}
            </div>
          </div>
          <button
            className={`aturi-switch ${prefs.showRecents ? 'on' : ''}`}
            onClick={() => onChange({ showRecents: !prefs.showRecents })}
            aria-pressed={prefs.showRecents}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.showRecents ? 'On' : 'Off'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
