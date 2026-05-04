import {
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  getRecommendedWaypointsData,
  type WaypointData,
  type WaypointType,
  type WaypointCategoryData,
} from '@aturi/waypoints.data';
import { customWaypointToData } from './template';
import type { CustomWaypoint, Prefs, WaypointGroup } from './prefs';

export type CategorizedWaypointDataList = {
  category: WaypointCategoryData;
  waypoints: WaypointData[];
};

/**
 * Effective category id for a waypoint, accounting for user overrides.
 * Falls back to the waypoint's metadata category, or 'custom' for user-defined
 * waypoints.
 *
 * @deprecated Group membership is now expressed via `prefs.waypointGroups`. A
 * waypoint can belong to multiple groups; this helper only returns the
 * waypoint's natural metadata category and is kept around for backwards
 * compatibility with the legacy migration code.
 */
export function effectiveCategory(
  prefs: Pick<Prefs, 'categoryOverrides'>,
  waypoint: WaypointData
): string {
  return prefs.categoryOverrides[waypoint.id] ?? waypoint.category;
}

/**
 * Default waypoint order combining built-ins and custom waypoints (customs
 * appended at the end). Used as a fallback when groups are empty.
 */
export function defaultWaypointOrder(customWaypoints: CustomWaypoint[]): string[] {
  return [...WAYPOINT_ORDER, ...customWaypoints.map(c => c.id)];
}

/**
 * Effective waypoint order, derived by flattening user groups (deduplicated,
 * preserving first-seen order). Falls back to the default order if no groups
 * exist.
 */
export function effectiveWaypointOrder(prefs: Prefs): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of prefs.waypointGroups) {
    for (const id of group.waypointIds) {
      if (!seen.has(id)) {
        out.push(id);
        seen.add(id);
      }
    }
  }
  if (out.length > 0) return out;
  return defaultWaypointOrder(prefs.customWaypoints);
}

function buildOrderIndex(order: string[]): Map<string, number> {
  const m = new Map<string, number>();
  order.forEach((id, i) => m.set(id, i));
  return m;
}

export function allWaypoints(customWaypoints: CustomWaypoint[]): WaypointData[] {
  const builtins = WAYPOINT_ORDER.map(id => WAYPOINT_DESTINATIONS_DATA[id]).filter(Boolean);
  return [...builtins, ...customWaypoints.map(customWaypointToData)];
}

function lookupForPrefs(prefs: Prefs): Map<string, WaypointData> {
  const lookup = new Map<string, WaypointData>();
  for (const w of allWaypoints(prefs.customWaypoints)) {
    lookup.set(w.id, w);
  }
  return lookup;
}

/**
 * All waypoints that appear in at least one group, ordered as they appear
 * across groups (deduplicated).
 */
export function orderedWaypoints(prefs: Prefs): WaypointData[] {
  const order = effectiveWaypointOrder(prefs);
  const lookup = lookupForPrefs(prefs);
  const out: WaypointData[] = [];
  for (const id of order) {
    const w = lookup.get(id);
    if (w) out.push(w);
  }
  return out;
}

/**
 * Set of waypoint ids that are visible: the union of all `waypointIds`
 * across `prefs.waypointGroups`. A waypoint not in any group is hidden
 * from the popup, redirect rules, and defaults.
 */
export function visibleWaypointIds(prefs: Prefs): Set<string> {
  const out = new Set<string>();
  for (const group of prefs.waypointGroups) {
    for (const id of group.waypointIds) out.add(id);
  }
  return out;
}

export function isWaypointVisible(prefs: Prefs, waypointId: string): boolean {
  for (const group of prefs.waypointGroups) {
    if (group.waypointIds.includes(waypointId)) return true;
  }
  return false;
}

/**
 * Visible waypoints: the union (deduplicated) of all waypoints that appear
 * in at least one group. A waypoint not present in any group is hidden.
 */
export function visibleWaypoints(prefs: Prefs): WaypointData[] {
  const visibleIds = new Set<string>();
  for (const group of prefs.waypointGroups) {
    for (const id of group.waypointIds) visibleIds.add(id);
  }
  if (visibleIds.size === 0) return [];
  const lookup = lookupForPrefs(prefs);
  const out: WaypointData[] = [];
  const order = effectiveWaypointOrder(prefs);
  for (const id of order) {
    if (!visibleIds.has(id)) continue;
    const w = lookup.get(id);
    if (w) out.push(w);
  }
  return out;
}

export function waypointsForType(
  prefs: Prefs,
  type: WaypointType
): WaypointData[] {
  return visibleWaypoints(prefs).filter(w => w.supportedTypes.includes(type));
}

function groupToCategory(group: WaypointGroup): WaypointCategoryData {
  return {
    id: group.id,
    name: group.name,
    description: '',
    defaultWaypointId: group.waypointIds[0] ?? '',
  };
}

/**
 * Visible waypoints grouped by `waypointGroups`, without filtering by content
 * type. Used when there is no AT context (home shortcuts).
 */
export function categorizedVisibleAll(prefs: Prefs): CategorizedWaypointDataList[] {
  const lookup = lookupForPrefs(prefs);
  const out: CategorizedWaypointDataList[] = [];

  for (const group of prefs.waypointGroups) {
    const seen = new Set<string>();
    const waypoints: WaypointData[] = [];
    for (const id of group.waypointIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const w = lookup.get(id);
      if (w) waypoints.push(w);
    }
    if (waypoints.length === 0) continue;
    out.push({ category: groupToCategory(group), waypoints });
  }

  return out;
}

/**
 * Returns waypoints compatible with the given content type, grouped by the
 * user's `waypointGroups`. The same waypoint can appear in multiple groups
 * (intentional: groups are now sections, not partitions). Empty groups are
 * omitted.
 */
export function categorizedForType(
  prefs: Prefs,
  type: WaypointType
): CategorizedWaypointDataList[] {
  const lookup = lookupForPrefs(prefs);
  const out: CategorizedWaypointDataList[] = [];

  for (const group of prefs.waypointGroups) {
    const seen = new Set<string>();
    const waypoints: WaypointData[] = [];
    for (const id of group.waypointIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const w = lookup.get(id);
      if (!w) continue;
      if (!w.supportedTypes.includes(type)) continue;
      waypoints.push(w);
    }
    if (waypoints.length === 0) continue;
    out.push({ category: groupToCategory(group), waypoints });
  }

  return out;
}

export function recommendedForType(
  prefs: Prefs,
  type: WaypointType,
  collection?: string
): { waypoints: WaypointData[]; label: string } {
  const { waypoints, label } = getRecommendedWaypointsData(type, collection);
  const visibleIds = new Set(visibleWaypoints(prefs).map(w => w.id));
  const orderIdx = buildOrderIndex(effectiveWaypointOrder(prefs));
  const filtered = waypoints
    .filter(w => visibleIds.has(w.id))
    .sort((a, b) => (orderIdx.get(a.id) ?? 0) - (orderIdx.get(b.id) ?? 0));
  return { waypoints: filtered, label };
}

export function findWaypoint(
  prefs: Prefs,
  waypointId: string
): WaypointData | null {
  if (waypointId.startsWith('custom:')) {
    const cw = prefs.customWaypoints.find(c => c.id === waypointId);
    return cw ? customWaypointToData(cw) : null;
  }
  return WAYPOINT_DESTINATIONS_DATA[waypointId] ?? null;
}

/**
 * Destinations whose getUrl requires a DID (not just a handle). These can't
 * be expressed as static DNR rewrites from a handle-only source.
 */
export const DID_REQUIRED_WAYPOINTS = new Set<string>([
  'pdsls',
  'atptools',
  'margin',
  'grain',
  'popfeed',
]);

export function requiresDid(waypointId: string, customWaypoints: CustomWaypoint[]): boolean {
  if (DID_REQUIRED_WAYPOINTS.has(waypointId)) return true;
  if (waypointId.startsWith('custom:')) {
    const cw = customWaypoints.find(c => c.id === waypointId);
    if (!cw) return false;
    return Object.values(cw.templates).some(t => typeof t === 'string' && t.includes('{did}'));
  }
  return false;
}
