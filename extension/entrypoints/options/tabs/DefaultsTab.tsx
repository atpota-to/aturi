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
    <div className="options-page">
      <div className="options-page-head">
        <h1 className="options-h1">General</h1>
        <p className="options-lede">
          Tune how the popup behaves and, when auto-redirect is on, pick a favorite reader
          for each family of records. Redirects only apply between clients that share the
          same underlying data.
        </p>
      </div>

      <section className="options-card is-rows" aria-labelledby="general-redirect">
        <ToggleRow
          id="general-redirect"
          title="Auto-redirect"
          heading
          on={prefs.autoRedirect}
          onToggle={() => onChange({ autoRedirect: !prefs.autoRedirect })}
        >
          {prefs.autoRedirect
            ? 'On: pick a favorite reader for each record family below.'
            : 'Off: the popup still works, but nothing is redirected automatically.'}
        </ToggleRow>

        {prefs.autoRedirect && (
          <>
            <div className="options-card-subhead defaults-favorites-intro">
              <h3>Favorites by compatibility group</h3>
              <p>
                Each group holds apps that render the same underlying records, so
                redirects between them make sense. Pick a favorite (or leave blank) for
                each.
              </p>
            </div>

            {activeFamilies.length === 0 ? (
              <div className="options-row aturi-subtle">
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
                    <div className="options-row defaults-family-row" key={family}>
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

            <div className="options-card-subhead">
              <h3>When to leave a link alone</h3>
            </div>
            <ToggleRow
              title="Stay put on the app you're using"
              on={prefs.redirectStayOnCurrentApp}
              onToggle={() =>
                onChange({ redirectStayOnCurrentApp: !prefs.redirectStayOnCurrentApp })
              }
            >
              Don't redirect inside a tab that's already showing one of the
              apps involved. Retyping bsky.app after being sent to your
              reader takes you to bsky.app, instead of bouncing straight
              back. Off: every matching link is redirected, wherever the
              tab already is.
            </ToggleRow>
            <ToggleRow
              title="Skip the first URL in a new tab"
              on={prefs.redirectSkipNewTab}
              onToggle={() => onChange({ redirectSkipNewTab: !prefs.redirectSkipNewTab })}
            >
              A URL you type or paste into a tab you just opened is left
              alone. Links opened in a new tab, and links handed over by
              other apps, still redirect.
            </ToggleRow>
          </>
        )}
      </section>

      <section className="options-card is-rows" aria-labelledby="general-popup">
        <div className="options-card-head">
          <h2 className="options-card-title" id="general-popup">Popup</h2>
        </div>

        <div className="options-row appearance-row">
          <div className="options-row-text">
            <div className="options-row-title">Default view</div>
            <div className="options-row-desc">
              The Waypoints view jumps between Atmosphere apps for the current page; the
              Inspect view surfaces the AT URIs detected on the page.
            </div>
          </div>
          <Segmented
            label="Default popup view"
            value={prefs.popupModeDefault}
            options={[
              { value: 'waypoints', label: 'Waypoints' },
              { value: 'inspect', label: 'Inspect' },
            ]}
            onSelect={value => onChange({ popupModeDefault: value })}
          />
        </div>

        <ToggleRow
          title="Remember last-used view"
          on={prefs.popupModeRemember}
          onToggle={() => onChange({ popupModeRemember: !prefs.popupModeRemember })}
        >
          {prefs.popupModeRemember
            ? `On: after you switch between the Waypoints and Inspect views, the popup reopens to whichever you used last for the next ${prefs.popupModeRememberMinutes} minutes, then reverts to the default.`
            : 'Off: every popup launch starts on the default view above.'}
        </ToggleRow>

        {prefs.popupModeRemember && (
          <div className="options-row appearance-row">
            <div className="options-row-title">Remember for</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                className="aturi-input"
                min={5}
                max={1440}
                step={5}
                value={prefs.popupModeRememberMinutes}
                style={{ width: 90 }}
                aria-label="Remember for, in minutes"
                onChange={e => {
                  const raw = Number(e.currentTarget.value);
                  if (!Number.isFinite(raw)) return;
                  const next = Math.min(1440, Math.max(5, Math.round(raw)));
                  onChange({ popupModeRememberMinutes: next });
                }}
              />
              <span className="aturi-subtle">minutes (5–1440)</span>
            </div>
          </div>
        )}

        <ToggleRow
          title="Smart recommendations"
          on={prefs.smartRecommendations}
          onToggle={() => onChange({ smartRecommendations: !prefs.smartRecommendations })}
        >
          {prefs.smartRecommendations
            ? 'The popup highlights a "Recommended" row tailored to the current record (e.g. Standard Site pages suggest Leaflet, Offprint, pckt).'
            : 'Off: the popup only shows your defined groups in the order you set, with no extra recommendation row.'}
        </ToggleRow>

        <ToggleRow
          title="Detect active apps"
          on={prefs.pdsRecordScan}
          onToggle={() => onChange({ pdsRecordScan: !prefs.pdsRecordScan })}
        >
          {prefs.pdsRecordScan
            ? "On: the popup quickly scans the target repo's collections and dims waypoints with no records found there (e.g. Tangled gets dimmed on a profile with no sh.tangled.* records). Active apps also rank higher in recommendations."
            : 'Off: every waypoint renders the same way regardless of whether the target user has any records in its lexicons.'}
        </ToggleRow>

        <ToggleRow
          title="Auto-scan pages for AT URIs"
          on={prefs.passiveScanEnabled}
          onToggle={() => onChange({ passiveScanEnabled: !prefs.passiveScanEnabled })}
        >
          {prefs.passiveScanEnabled
            ? 'On: every page you visit is checked for AT URIs (in meta tags, head links, and anchors), and a count badge appears on the toolbar icon when any are found.'
            : "Off: the toolbar icon stays neutral. The popup's Inspect tab still scans on demand when you open it."}
        </ToggleRow>

        <ToggleRow
          title="Open in new tab"
          on={prefs.openInNewTab}
          onToggle={() => onChange({ openInNewTab: !prefs.openInNewTab })}
        >
          {prefs.openInNewTab
            ? 'Picking a waypoint opens it in a new browser tab.'
            : 'Off: picking a waypoint navigates the current tab instead of opening a new one.'}
        </ToggleRow>

        <ToggleRow
          title="Recents"
          on={prefs.historyEnabled}
          onToggle={() => onChange({ historyEnabled: !prefs.historyEnabled })}
          action={
            prefs.historyEnabled && prefs.recents.length > 0 ? (
              <button
                type="button"
                className="aturi-btn defaults-clear-recents"
                onClick={handleClearRecents}
              >
                Clear Recents ({prefs.recents.length})
              </button>
            ) : null
          }
        >
          {prefs.historyEnabled
            ? 'On: the popup shows a Recents row at the top with the waypoints you reach for most often.'
            : 'Off: the popup hides the Recents row and stops recording new picks.'}
        </ToggleRow>

        <ToggleRow
          title="Compact mode"
          on={prefs.compactMode}
          onToggle={() => onChange({ compactMode: !prefs.compactMode })}
        >
          {prefs.compactMode
            ? 'On: the popup uses shorter rows and no description line, so more waypoints fit at once.'
            : 'Off: the popup shows each waypoint with its description.'}
        </ToggleRow>
      </section>

      <section className="options-card is-rows" aria-labelledby="general-appearance">
        <div className="options-card-head">
          <h2 className="options-card-title" id="general-appearance">Appearance</h2>
          <p className="options-card-sub">
            Pick a color theme and text size. Changes apply immediately to the popup
            and this settings page.
          </p>
        </div>

        <div className="options-row appearance-row">
          <div className="options-row-title">Theme</div>
          <Segmented
            label="Color theme"
            value={prefs.theme}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onSelect={value => onChange({ theme: value })}
          />
        </div>

        <div className="options-row appearance-row">
          <div className="options-row-title">Text size</div>
          <Segmented
            label="Text size"
            value={prefs.fontSize}
            options={[
              { value: 'small', label: 'Small' },
              { value: 'medium', label: 'Medium' },
              { value: 'large', label: 'Large' },
              { value: 'xlarge', label: 'X-Large' },
            ]}
            onSelect={value => onChange({ fontSize: value })}
          />
        </div>
      </section>
    </div>
  );
}

/**
 * One setting with a title, a description and an on/off switch on the right.
 * `heading` renders the title as the card's h2 (the Auto-redirect card leads
 * with its own switch).
 */
function ToggleRow({
  id,
  title,
  heading,
  on,
  onToggle,
  action,
  children,
}: {
  id?: string;
  title: string;
  heading?: boolean;
  on: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`options-row options-toggle-row ${heading ? 'is-heading' : ''}`}>
      <div className="options-row-text">
        {heading ? (
          <h2 className="options-card-title" id={id}>
            {title}
          </h2>
        ) : (
          <div className="options-row-title">{title}</div>
        )}
        <div className="options-row-desc">{children}</div>
      </div>
      {action}
      <button
        type="button"
        className={`aturi-switch ${on ? 'on' : ''}`}
        onClick={onToggle}
        aria-pressed={on}
        aria-label={title}
      >
        <span className="aturi-switch-box" />
        <span className="options-switch-state">{on ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="appearance-segmented" role="radiogroup" aria-label={label}>
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`appearance-segment ${value === opt.value ? 'is-active' : ''}`}
          onClick={() => onSelect(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
