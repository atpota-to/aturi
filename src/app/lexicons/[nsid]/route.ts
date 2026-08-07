import { NextResponse } from 'next/server';
import preferredClients from '../../../../lexicons/to/aturi/actor/preferredClients.json';

/**
 * Serves Aturi's published lexicon schemas at a stable, linkable URL:
 *
 *   GET /lexicons/to.aturi.actor.preferredClients.json
 *
 * The `.json` suffix is optional. Schemas live in the repo's top-level
 * `lexicons/` directory (the conventional home for them) and are imported here
 * so the served copy can never drift from the source of truth.
 */

const LEXICONS: Record<string, unknown> = {
  'to.aturi.actor.preferredClients': preferredClients,
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ nsid: string }> },
) {
  const { nsid } = await params;
  const key = nsid.replace(/\.json$/i, '');
  const lexicon = LEXICONS[key];

  if (!lexicon) {
    return NextResponse.json(
      { error: 'Unknown lexicon', available: Object.keys(LEXICONS) },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  return NextResponse.json(lexicon, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}
