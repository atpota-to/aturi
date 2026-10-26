import { NextRequest, NextResponse } from 'next/server';
import { apiErrorBody, type ApiErrorCode } from '@/lib/apiError';
import { resolveAtmosphereLink } from '@/lib/resolveLink';

export const runtime = 'edge';

/**
 * Resolves a page URL (from a share sheet, an Apple Shortcut, etc.) into the
 * AT URI it represents and the list of Aturi waypoints that can render it.
 *
 * Mirrors the in-popup logic of the browser extension so that a single call
 * gives a client (Shortcut, bookmarklet, third-party app) everything it needs
 * to present a "open in..." picker without re-implementing the catalog.
 *
 * The detection and catalog logic lives in src/lib/resolveLink.ts, shared
 * with the MCP resolve_link tool; this route owns only the HTTP surface —
 * parameter names, status codes, CORS, and cache headers.
 *
 * Inputs:
 *  - `url=<encoded-page-url>` (preferred from share sheets)
 *  - `atUri=at://...`         (skips detection entirely)
 *  - `composeText=<text>`     (optional; pre-fills the compose intent links)
 *
 * Either of the first two is accepted; `atUri` wins when both are supplied.
 * `headDetect=false` suppresses the page-probing phase.
 *
 * Every waypoint carries a `composeIntent` describing whether that client can
 * be handed a link that opens its composer
 * (https://docs.bsky.app/docs/advanced-guides/intent-links), null when it
 * can't. Pass `composeText` to get the links back pre-filled.
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

  const result = await resolveAtmosphereLink({
    atUri: searchParams.get('atUri') || searchParams.get('aturi'),
    url: searchParams.get('url'),
    headDetect: searchParams.get('headDetect') !== 'false',
    composeText: searchParams.get('composeText') || undefined,
  });

  switch (result.kind) {
    case 'invalid':
      return jsonError(400, result.code, result.message, result.hint);
    case 'no-data':
      return NextResponse.json(result.body, { status: 200, headers: corsAndCache(60) });
    case 'resolved':
      return NextResponse.json(result.body, { status: 200, headers: corsAndCache(300) });
  }
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
