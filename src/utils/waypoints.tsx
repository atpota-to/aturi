import { ReactNode } from 'react';
import {
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_CATEGORIES_DATA,
  WAYPOINT_ORDER as WAYPOINT_ORDER_DATA,
  CATEGORY_ORDER as CATEGORY_ORDER_DATA,
  getCategorizedWaypointsData,
  getRecommendedWaypointsData,
  getWaypointDataForType,
  getWaypointCountData,
  type WaypointType,
  type WaypointData,
  type WaypointCategoryData,
} from './waypoints.data';
import { WAYPOINT_ICONS } from './waypointIcons';

export {
  BlueskySVG,
  BlackskySVG,
  PdslsSVG,
  LeafletSVG,
  RedDwarfSVG,
  CatskySVG,
  WitchskySVG,
  DeerSVG,
  TangledSVG,
  PinskySVG,
  MarginSVG,
  SembleSVG,
  StreamplaceSVG,
  GrainSVG,
  PopfeedSVG,
  SifaSVG,
  BlentoSVG,
  OffprintSVG,
  PcktSVG,
} from './waypointIcons';

export type { WaypointType } from './waypoints.data';

export type Waypoint = WaypointData & {
  icon: ReactNode;
};

export type WaypointCategory = WaypointCategoryData;

export type CategorizedWaypoints = {
  category: WaypointCategory;
  waypoints: Waypoint[];
};

function withIcon(data: WaypointData): Waypoint {
  return { ...data, icon: WAYPOINT_ICONS[data.id] ?? null };
}

export const WAYPOINT_DESTINATIONS: Record<string, Waypoint> = Object.fromEntries(
  Object.entries(WAYPOINT_DESTINATIONS_DATA).map(([id, data]) => [id, withIcon(data)])
);

export const WAYPOINT_ORDER = WAYPOINT_ORDER_DATA;
export const WAYPOINT_CATEGORIES = WAYPOINT_CATEGORIES_DATA;
export const CATEGORY_ORDER = CATEGORY_ORDER_DATA;

export function getWaypointsForType(type: WaypointType): Waypoint[] {
  return getWaypointDataForType(type).map(withIcon);
}

export function getWaypointCount(): number {
  return getWaypointCountData();
}

export function getCategorizedWaypoints(type: WaypointType): CategorizedWaypoints[] {
  return getCategorizedWaypointsData(type).map(({ category, waypoints }) => ({
    category,
    waypoints: waypoints.map(withIcon),
  }));
}

export function getRecommendedWaypoints(
  type: WaypointType,
  collection?: string
): { waypoints: Waypoint[]; label: string } {
  const { waypoints, label } = getRecommendedWaypointsData(type, collection);
  return { waypoints: waypoints.map(withIcon), label };
}

/**
 * @deprecated Use getRecommendedWaypoints instead
 */
export function getFeaturedWaypoint(
  type: WaypointType,
  collection?: string
): Waypoint | null {
  const { waypoints } = getRecommendedWaypoints(type, collection);
  return waypoints[0] || null;
}
