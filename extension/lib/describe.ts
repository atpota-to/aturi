import type { WaypointData, WaypointType } from '@aturi/waypoints.data';

export function describeWaypoint(
  waypoint: WaypointData,
  collection?: string,
  type?: WaypointType
): string {
  const d = waypoint.description;
  if (typeof d === 'function') return d(collection, type);
  return d;
}
