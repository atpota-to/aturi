/**
 * Confidential OAuth client metadata document.
 *
 * Served at /api/oauth/backend-client-metadata.json — this URL IS the
 * confidential client_id. Distinct from the public browser client's
 * /oauth-client-metadata.json because a single document can't advertise both
 * `none` and `private_key_jwt`.
 *
 * Returns the canonical metadata (built from OAUTH_BASE_URL, matching what the
 * NodeOAuthClient singleton was constructed with) so the AS sees a consistent
 * client_id. The Authorization Server fetches this cross-origin, hence the
 * permissive CORS header.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { oauthClient } from '@/lib/oauth/server/oauthClient';
import { isAllowedHost } from '@/lib/oauth/server/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const host = (request.headers.get('host') || request.nextUrl.host).split(':')[0];
  if (!isAllowedHost(host)) {
    return new NextResponse('Unknown host', { status: 400 });
  }

  return NextResponse.json(oauthClient.getClientMetadata(), {
    headers: {
      // The AS refetches on each authorize to validate scopes — avoid stale CDN copies.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
