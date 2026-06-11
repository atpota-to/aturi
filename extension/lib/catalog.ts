import {
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  getRecommendedWaypointsData,
  waypointActivity,
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
  collection?: string,
  /**
   * Set of NSIDs known to exist on the target repo (from describeRepo).
   * When provided, confirmed-present waypoints sort to the front of the
   * recommendation list — they win the "Recommended" slot over candidates
   * with no matching records.
   */
  repoCollections?: ReadonlySet<string> | null,
): { waypoints: WaypointData[]; label: string } {
  const { waypoints, label } = getRecommendedWaypointsData(type, collection);
  const visibleIds = new Set(visibleWaypoints(prefs).map(w => w.id));
  const orderIdx = buildOrderIndex(effectiveWaypointOrder(prefs));
  const activeSet = repoCollections ?? null;
  const filtered = waypoints
    .filter(w => visibleIds.has(w.id))
    .sort((a, b) => {
      // Confirmed-present waypoints sort to the front; absent waypoints sort
      // to the back; unknown rides the catalog order. Within each bucket we
      // preserve the user's chosen order so a manual reordering still wins.
      const aRank = activityRank(waypointActivity(a, activeSet));
      const bRank = activityRank(waypointActivity(b, activeSet));
      if (aRank !== bRank) return aRank - bRank;
      return (orderIdx.get(a.id) ?? 0) - (orderIdx.get(b.id) ?? 0);
    });
  return { waypoints: filtered, label };
}

function activityRank(status: 'present' | 'absent' | 'unknown'): number {
  if (status === 'present') return 0;
  if (status === 'unknown') return 1;
  return 2; // 'absent'
}

/**
 * Returns true if `waypoint` actually targets the given collection/rkey rather
 * than silently falling back to its profile/home URL. When there is no
 * collection or rkey (e.g. profile-only contexts), every waypoint is
 * considered applicable.
 *
 * This catches waypoints whose `supportedTypes` advertise `post`/`list`/etc.
 * but whose `getUrl` only handles a narrow slice of collections (e.g. Anisota
 * Reader handles `site.standard.*` / `pub.leaflet.*` documents and falls back
 * to the profile URL for `app.bsky.feed.post`). Use this to filter "recently
 * used" entries down to the ones that meaningfully apply to the current page.
 */
export function waypointHandlesContent(
  waypoint: WaypointData,
  handle: string,
  collection?: string,
  rkey?: string,
  did?: string
): boolean {
  if (!collection || !rkey) return true;
  const specific = waypoint.getUrl(handle, collection, rkey, did);
  if (!specific) return false;
  const fallback = waypoint.getUrl(handle, undefined, undefined, did);
  if (!fallback) return true;
  return specific !== fallback;
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
  'taproot',
  'standardReader',
]);

/**
 * Built-in waypoints added since the user was last notified (i.e. not present
 * in `prefs.knownWaypointIds`). Order matches `WAYPOINT_ORDER` so the popup
 * banner reads them in a stable order. Custom waypoints are never returned.
 */
export function newBuiltinWaypoints(prefs: Prefs): WaypointData[] {
  const known = new Set(prefs.knownWaypointIds ?? []);
  const out: WaypointData[] = [];
  for (const id of WAYPOINT_ORDER) {
    if (known.has(id)) continue;
    const w = WAYPOINT_DESTINATIONS_DATA[id];
    if (w) out.push(w);
  }
  return out;
}

export function requiresDid(waypointId: string, customWaypoints: CustomWaypoint[]): boolean {
  if (DID_REQUIRED_WAYPOINTS.has(waypointId)) return true;
  if (waypointId.startsWith('custom:')) {
    const cw = customWaypoints.find(c => c.id === waypointId);
    if (!cw) return false;
    return Object.values(cw.templates).some(t => typeof t === 'string' && t.includes('{did}'));
  }
  return false;
}
