/**
 * Apply user preferences (hide, reorder, custom additions) to the built-in
 * waypoint catalog. Consumed by WaypointPicker and the account page.
 *
 * Keeps the data layer (`waypoints.data.ts` / `waypoints.tsx`) pure — those
 * exports stay as the default unmodified catalog. Personalization happens
 * at the call site.
 */

import { Globe } from 'lucide-react';
import {
  expandTemplate,
  type CustomWaypoint,
  type Preferences,
} from './preferences';
import type {
  Waypoint,
  WaypointCategory,
  CategorizedWaypoints,
} from './waypoints';
import type { WaypointType, RedirectCompatFamily } from './waypoints.data';

export const CUSTOM_CATEGORY: WaypointCategory = {
  id: 'custom',
  name: 'My Waypoints',
  description: 'Personal waypoints you added on the account page',
  defaultWaypointId: '',
};

/**
 * Promote a CustomWaypoint into a Waypoint-shaped object that the
 * WaypointPicker / catalog UIs can render directly. The synthetic `getUrl`
 * expands the template; returns null when the inputs don't satisfy the
 * template's placeholders.
 */
export function customToWaypoint(c: CustomWaypoint): Waypoint {
  return {
    id: c.id,
    name: c.name,
    description: c.description || (c.domain ? `Open on ${c.domain}` : 'Custom waypoint'),
    supportedTypes: c.supportedTypes,
    category: CUSTOM_CATEGORY.id,
    redirectCompat: [] as RedirectCompatFamily[],
    getUrl: (handle, collection, rkey, did) => {
      const tplKey: WaypointType =
        collection && rkey
          ? c.supportedTypes.includes('post' as WaypointType) && collection === 'app.bsky.feed.post'
            ? ('post' as WaypointType)
            : c.supportedTypes.includes('list' as WaypointType) && collection === 'app.bsky.graph.list'
              ? ('list' as WaypointType)
              : c.supportedTypes.includes('record' as WaypointType)
                ? ('record' as WaypointType)
                : ('post' as WaypointType)
          : ('profile' as WaypointType);
      const template = c.templates[tplKey] || c.templates.record || c.templates.profile;
      if (!template) return null;
      return expandTemplate(template, { handle, did, collection, rkey });
    },
    icon: (
      <Globe
        size={20}
        style={{ color: 'var(--text-accent)' }}
        aria-hidden
      />
    ),
  };
}

/**
 * Filter a flat waypoint array against user prefs (hide built-ins).
 * Custom waypoints are NOT injected here — callers do that explicitly
 * because the injection point differs (recommended vs categorized).
 */
export function applyHidden(waypoints: Waypoint[], prefs: Preferences): Waypoint[] {
  if (prefs.hiddenWaypoints.length === 0) return waypoints;
  const hidden = new Set(prefs.hiddenWaypoints);
  return waypoints.filter((w) => !hidden.has(w.id));
}

/**
 * Apply a user-defined ordering to a waypoint list. Items in `order` come
 * first in that order; everything else preserves the catalog's default
 * sequence at the end.
 */
export function applyOrder(waypoints: Waypoint[], prefs: Preferences): Waypoint[] {
  if (prefs.waypointOrder.length === 0) return waypoints;
  const byId = new Map(waypoints.map((w) => [w.id, w]));
  const used = new Set<string>();
  const ordered: Waypoint[] = [];
  for (const id of prefs.waypointOrder) {
    const w = byId.get(id);
    if (w) {
      ordered.push(w);
      used.add(id);
    }
  }
  for (const w of waypoints) {
    if (!used.has(w.id)) ordered.push(w);
  }
  return ordered;
}

/**
 * Personalize a categorized list. Built-ins respecting hidden/order;
 * customs added as a top-of-list group when present.
 */
export function personalizeCategorized(
  categorized: CategorizedWaypoints[],
  prefs: Preferences,
  type: WaypointType,
): CategorizedWaypoints[] {
  // First, filter + reorder built-in groups.
  const cleaned = categorized
    .map(({ category, waypoints }) => ({
      category,
      waypoints: applyOrder(applyHidden(waypoints, prefs), prefs),
    }))
    .filter((g) => g.waypoints.length > 0);

  // Then, prepend the user's custom waypoints (if any apply to this type).
  const customs = prefs.customWaypoints
    .filter((c) => c.supportedTypes.includes(type))
    .map(customToWaypoint);

  if (customs.length === 0) return cleaned;
  return [{ category: CUSTOM_CATEGORY, waypoints: customs }, ...cleaned];
}

/**
 * Personalize a recommended waypoints bundle — drop hidden ids, preserve
 * the recommendation's original order otherwise. Customs are NOT recommended
 * (we have no signal for that yet).
 */
export function personalizeRecommended(
  waypoints: Waypoint[],
  prefs: Preferences,
): Waypoint[] {
  return applyHidden(waypoints, prefs);
}
