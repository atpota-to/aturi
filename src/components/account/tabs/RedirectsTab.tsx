'use client';

import { useMemo, useState } from 'react';
import {
  COMPAT_FAMILIES,
  COMPAT_FAMILY_ORDER,
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  type RedirectCompatFamily,
} from '@/utils/waypoints.data';
import { waypointHost } from '@/utils/autoRedirect';
import {
  getRedirectCompatFor,
  setAutoRedirect,
  setFavoriteForFamily,
} from '@/utils/preferences';
import { usePreferences } from '@/components/PreferencesProvider';
import Toggle from '../Toggle';

/**
 * Auto-redirect settings: the master switch, and one preferred client per
 * compat family. Mirrors the extension's Defaults tab
 * (`extension/entrypoints/options/tabs/DefaultsTab.tsx`) — same preference
 * shape, same rule for which families are worth showing — in the web app's
 * own idiom.
 */
type FamilyRow = {
  family: RedirectCompatFamily;
  destinations: { id: string; name: string }[];
};

export default function RedirectsTab() {
  const { prefs, update } = usePreferences();
  const enabled = prefs.autoRedirect;

  // Which waypoints are unusable as destinations depends on the host actually
  // serving the app, which differs between production and a preview
  // deployment — so it can only be read in the browser. Same lazy-initializer
  // shape `SettingsShell` uses to read the URL hash.
  const [selfHost] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : window.location.host,
  );

  const rows = useMemo(
    () => buildFamilyRows(prefs, selfHost),
    [prefs, selfHost],
  );

  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="settings-card-title">Auto-redirect</h2>
        <p className="settings-card-sub">
          Pick a client per kind of record and Aturi will open links in it
          directly, instead of showing you the list. This skips Aturi&rsquo;s own
          page — the preview, the picker, the explorer links — for the kinds you
          configure. To see the page for one link, add <code>?stay=1</code> to
          its URL; going back from a client never sends you out again.
        </p>
      </div>

      <Toggle
        id="auto-redirect"
        label="Open links in my preferred client"
        description="Off by default. Nothing is redirected until you choose a client below."
        checked={enabled}
        onChange={(next) => update((p) => setAutoRedirect(p, next))}
      />

      {rows.length === 0 ? (
        <p className="settings-card-sub">
          No client families to configure yet. Waypoints are only offered here
          once they&rsquo;re visible in your picker — check the{' '}
          <strong>Waypoints</strong> tab.
        </p>
      ) : (
        rows.map(({ family, destinations }) => {
          const meta = COMPAT_FAMILIES[family];
          const current = prefs.favoriteByFamily?.[family] ?? '';
          return (
            <div className="settings-toggle-row" key={family}>
              <label className="settings-toggle-label" htmlFor={`redirect-${family}`}>
                <span className="settings-toggle-label-text">{meta?.name ?? family}</span>
                {meta?.description && (
                  <span className="settings-toggle-label-sub">{meta.description}</span>
                )}
              </label>
              <select
                id={`redirect-${family}`}
                value={current}
                disabled={!enabled}
                onChange={(e) =>
                  update((p) => setFavoriteForFamily(p, family, e.target.value || null))
                }
                style={{
                  flexShrink: 0,
                  padding: '0.4rem 0.5rem',
                  fontSize: '0.85rem',
                  fontFamily: 'var(--font-serif)',
                  color: 'var(--text-primary)',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-medium)',
                  opacity: enabled ? 1 : 0.5,
                  cursor: enabled ? 'pointer' : 'not-allowed',
                }}
              >
                <option value="">Don&rsquo;t redirect</option>
                {destinations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          );
        })
      )}
    </section>
  );
}

/**
 * Which families are worth a row, and what can be chosen in each.
 *
 * A family earns a row when it has somewhere to send you and something to send
 * — at least one destination, and at least two members overall, so there is a
 * choice to make rather than a single client redirecting to itself. Same rule
 * the extension applies, and it is what keeps single-client families out of
 * the list as clutter.
 *
 * Only waypoints the user has kept in a group are offered: the picker treats
 * "not in any group" as hidden, and a redirect to something they removed would
 * be a surprise.
 */
function buildFamilyRows(
  prefs: ReturnType<typeof usePreferences>['prefs'],
  selfHost: string | null,
): FamilyRow[] {
  const visible = new Set<string>();
  for (const group of prefs.waypointGroups) {
    for (const id of group.waypointIds) visible.add(id);
  }

  const nameFor = (id: string): string =>
    WAYPOINT_DESTINATIONS_DATA[id]?.name ??
    prefs.customWaypoints.find((c) => c.id === id)?.name ??
    id;

  const allIds = [...WAYPOINT_ORDER, ...prefs.customWaypoints.map((c) => c.id)];
  const rows: FamilyRow[] = [];

  for (const family of COMPAT_FAMILY_ORDER) {
    const members = allIds.filter(
      (id) => visible.has(id) && getRedirectCompatFor(id, prefs.customWaypoints).includes(family),
    );
    const destinations = members
      .filter((id) => {
        if (!selfHost) return true;
        const host = waypointHost(id);
        return host === null || host.toLowerCase() !== selfHost.toLowerCase();
      })
      .map((id) => ({ id, name: nameFor(id) }));

    if (destinations.length >= 1 && members.length >= 2) {
      rows.push({ family, destinations });
    }
  }

  return rows;
}
