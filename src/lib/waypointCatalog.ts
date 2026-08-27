/**
 * The waypoint catalog as JSON: which clients exist, what each renders,
 * and which can be handed a compose-intent link. Shared by
 * GET /api/waypoints (HTTP surface) and the MCP list_waypoints tool, so
 * the two answers cannot drift.
 */

import {
  WAYPOINT_CATEGORIES_DATA,
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  describeComposeIntent,
  getWaypointDataForType,
  supportsComposeIntent,
  type ComposeIntentDescriptor,
  type WaypointData,
  type WaypointType,
} from '@/utils/waypoints.data';

export const WAYPOINT_TYPES: WaypointType[] = ['post', 'profile', 'list', 'record', 'unknown'];
export const WAYPOINT_CAPABILITIES = ['compose'] as const;
export type WaypointCapability = (typeof WAYPOINT_CAPABILITIES)[number];

export type WaypointJson = {
  id: string;
  name: string;
  description: string;
  category: string;
  categoryName: string;
  supportedTypes: WaypointType[];
  expectedCollections?: string[];
  composeIntent: ComposeIntentDescriptor | null;
};

export type WaypointCatalogJson = {
  ok: true;
  filters: { type: WaypointType | null; capability: WaypointCapability | null };
  count: number;
  waypoints: WaypointJson[];
};

export function buildWaypointCatalog(opts: {
  type?: WaypointType | null;
  capability?: WaypointCapability | null;
  composeText?: string;
}): WaypointCatalogJson {
  const { type = null, capability = null, composeText } = opts;

  const catalog = type
    ? getWaypointDataForType(type)
    : WAYPOINT_ORDER.map(id => WAYPOINT_DESTINATIONS_DATA[id]).filter(Boolean);

  const waypoints = catalog
    .filter(w => (capability === 'compose' ? supportsComposeIntent(w) : true))
    .map(w => toJson(w, composeText));

  return {
    ok: true,
    filters: { type, capability },
    count: waypoints.length,
    waypoints,
  };
}

function toJson(waypoint: WaypointData, composeText?: string): WaypointJson {
  const category = WAYPOINT_CATEGORIES_DATA[waypoint.category];
  const json: WaypointJson = {
    id: waypoint.id,
    name: waypoint.name,
    // The catalog's descriptions vary by record type; with no record in hand,
    // resolve the profile-level wording.
    description:
      typeof waypoint.description === 'function'
        ? waypoint.description()
        : waypoint.description,
    category: waypoint.category,
    categoryName: category?.name ?? waypoint.category,
    supportedTypes: waypoint.supportedTypes,
    composeIntent: describeComposeIntent(waypoint, composeText),
  };
  if (waypoint.expectedCollections?.length) {
    json.expectedCollections = waypoint.expectedCollections;
  }
  return json;
}
