/**
 * Apply user preferences to the built-in waypoint catalog.
 *
 * Personalization now flows through `waypointGroups`: each group is its
 * own category in the picker output, ordered as the user arranged them.
 * Waypoints not in any group are hidden (the picker only renders ids
 * referenced by some group).
 *
 * Custom waypoints live in groups too — they can be moved into any group
 * the user wants, not pinned to a "Custom" bucket. New customs that
 * haven't been added to a group yet (e.g. just created from the Custom
 * tab) get appended to a default `custom` group automatically by the
 * preferences provider.
 */

import { Globe } from 'lucide-react';
import {
  expandTemplate,
  type CustomWaypoint,
  type Preferences,
} from './preferences';
import {
  WAYPOINT_DESTINATIONS,
  type Waypoint,
  type WaypointCategory,
  type CategorizedWaypoints,
} from './waypoints';
import type { WaypointType, RedirectCompatFamily } from './waypoints.data';

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
    category: 'custom',
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
 * Resolve a waypoint id to a renderable Waypoint, scoped to `type`.
 * Returns null when the id is unknown or the waypoint doesn't support
 * the requested record type.
 */
function resolveWaypoint(
  id: string,
  customById: Map<string, CustomWaypoint>,
  type: WaypointType,
): Waypoint | null {
  const custom = customById.get(id);
  if (custom) {
    if (!custom.supportedTypes.includes(type)) return null;
    return customToWaypoint(custom);
  }
  const builtin = WAYPOINT_DESTINATIONS[id];
  if (!builtin) return null;
  if (!builtin.supportedTypes.includes(type)) return null;
  return builtin;
}

/**
 * Build the picker's category list straight from the user's groups.
 * The `_categorized` parameter is ignored — kept for API stability with
 * the previous version so existing callers don't need refactoring on
 * this commit.
 */
export function personalizeCategorized(
  _categorized: CategorizedWaypoints[],
  prefs: Preferences,
  type: WaypointType,
): CategorizedWaypoints[] {
  const customById = new Map(prefs.customWaypoints.map((c) => [c.id, c]));
  const result: CategorizedWaypoints[] = [];
  for (const group of prefs.waypointGroups) {
    const waypoints: Waypoint[] = [];
    for (const id of group.waypointIds) {
      const w = resolveWaypoint(id, customById, type);
      if (w) waypoints.push(w);
    }
    if (waypoints.length === 0) continue;
    const category: WaypointCategory = {
      id: group.id,
      name: group.name,
      defaultWaypointId: waypoints[0].id,
    };
    result.push({ category, waypoints });
  }
  return result;
}

/**
 * Strip waypoints not surfaced by any group from a recommendation bundle.
 * Recommendations are still ordered by the source — we just drop ids the
 * user has banished (i.e. not in any group).
 */
export function personalizeRecommended(
  waypoints: Waypoint[],
  prefs: Preferences,
): Waypoint[] {
  const visible = new Set<string>();
  for (const group of prefs.waypointGroups) {
    for (const id of group.waypointIds) visible.add(id);
  }
  if (visible.size === 0) return [];
  return waypoints.filter((w) => visible.has(w.id));
}
