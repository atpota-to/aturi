import { NextRequest, NextResponse } from 'next/server';
import { apiErrorBody, type ApiErrorCode } from '@/lib/apiError';
import {
  buildWaypointCatalog,
  WAYPOINT_CAPABILITIES,
  WAYPOINT_TYPES,
  type WaypointCapability,
} from '@/lib/waypointCatalog';
import type { WaypointType } from '@/utils/waypoints.data';

export const runtime = 'edge';

/**
 * The waypoint catalog and what each client can do, without needing a record to
 * resolve first. `/api/resolve` answers "where can I open *this*?"; this answers
 * "what's in the catalog, and which of them support X?".
 *
 * The catalog-shaping logic lives in src/lib/waypointCatalog.ts, shared with
 * the MCP list_waypoints tool; this route owns only the HTTP surface.
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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
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

  const rawCapability = searchParams.get('capability');
  if (rawCapability && !WAYPOINT_CAPABILITIES.includes(rawCapability as WaypointCapability)) {
    return jsonError(400, 'invalid_parameter',
      `Unknown capability. Expected one of: ${WAYPOINT_CAPABILITIES.join(', ')}`,
      'Omit ?capability to skip capability filtering.');
  }

  const body = buildWaypointCatalog({
    type: (rawType as WaypointType) || null,
    capability: (rawCapability as WaypointCapability) || null,
    composeText: searchParams.get('text') || undefined,
  });

  return NextResponse.json(body, { status: 200, headers: corsAndCache(3600) });
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
