import { NextRequest, NextResponse } from 'next/server';
import { apiErrorBody, type ApiErrorCode } from '@/lib/apiError';
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

export const runtime = 'edge';

/**
 * The waypoint catalog and what each client can do, without needing a record to
 * resolve first. `/api/resolve` answers "where can I open *this*?"; this answers
 * "what's in the catalog, and which of them support X?".
 *
 * Inputs (all optional):
 *  - `type=post|profile|list|record`  only clients that render that type
 *  - `capability=compose`             only clients with a compose intent route
 *  - `text=<text>`                    pre-fill the returned compose intent links
 *
 * The compose intent describes whether a client can be handed a link that opens
 * its composer (https://docs.bsky.app/docs/advanced-guides/intent-links). It's
 * null for clients with no confirmed route — which means "not known to support
 * it", not a proof of absence. `prefillsText` is false for the one client that
 * routes the intent but ignores the text, so a share link would open an empty
 * composer.
 */

const WAYPOINT_TYPES: WaypointType[] = ['post', 'profile', 'list', 'record', 'unknown'];
const CAPABILITIES = ['compose'] as const;
type Capability = (typeof CAPABILITIES)[number];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

type WaypointJson = {
  id: string;
  name: string;
  description: string;
  category: string;
  categoryName: string;
  supportedTypes: WaypointType[];
  expectedCollections?: string[];
  composeIntent: ComposeIntentDescriptor | null;
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const rawType = searchParams.get('type');
  if (rawType && !WAYPOINT_TYPES.includes(rawType as WaypointType)) {
    return jsonError(400, 'invalid_parameter',
      `Unknown type. Expected one of: ${WAYPOINT_TYPES.join(', ')}`,
      'Omit ?type to get the whole catalog.');
  }
  const type = (rawType as WaypointType) || null;

  const rawCapability = searchParams.get('capability');
  if (rawCapability && !CAPABILITIES.includes(rawCapability as Capability)) {
    return jsonError(400, 'invalid_parameter',
      `Unknown capability. Expected one of: ${CAPABILITIES.join(', ')}`,
      'Omit ?capability to skip capability filtering.');
  }
  const capability = (rawCapability as Capability) || null;

  const composeText = searchParams.get('text') || undefined;

  const catalog = type
    ? getWaypointDataForType(type)
    : WAYPOINT_ORDER.map(id => WAYPOINT_DESTINATIONS_DATA[id]).filter(Boolean);

  const waypoints = catalog
    .filter(w => (capability === 'compose' ? supportsComposeIntent(w) : true))
    .map(w => toJson(w, composeText));

  return NextResponse.json(
    {
      ok: true,
      filters: { type, capability },
      count: waypoints.length,
      waypoints,
    },
    { status: 200, headers: corsAndCache(3600) }
  );
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

function corsAndCache(seconds: number) {
  return {
    ...CORS_HEADERS,
    'Cache-Control': `public, max-age=${seconds}, s-maxage=${seconds}, stale-while-revalidate=${seconds * 6}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function jsonError(
  status: number,
  code: ApiErrorCode,
  message: string,
  hint?: string,
) {
  return NextResponse.json(apiErrorBody(code, message, hint), {
    status,
    headers: CORS_HEADERS,
  });
}
