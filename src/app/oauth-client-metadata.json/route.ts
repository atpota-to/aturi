/**
 * Dynamic OAuth client metadata.
 *
 * The OAuth spec ties `client_id` to the URL the metadata JSON is served
 * from, so we generate the metadata per-request from the incoming Host
 * header rather than baking in a single origin. Localhost dev uses the
 * loopback shortcut in `src/lib/oauth/client.ts` instead of this route.
 *
 * Allowed hosts:
 *   - aturi.to / www.aturi.to (production)
 *   - testing.aturi.to (staging)
 */

import { NextResponse } from 'next/server';
import { METADATA_SCOPE } from '@/lib/oauth/scopes';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const REDIRECT_PATH = '/oauth/callback';

function isAllowedHost(hostname: string): boolean {
  return (
    hostname === 'aturi.to' ||
    hostname === 'www.aturi.to' ||
    hostname === 'testing.aturi.to'
  );
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const host = request.headers.get('host') || url.host;
  const hostname = host.split(':')[0];
  if (!isAllowedHost(hostname)) {
    return new NextResponse('Unknown host', { status: 400 });
  }

  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  const origin = `${proto}://${host}`;

  const metadata = {
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: 'aturi.to',
    client_uri: origin,
    logo_uri: `${origin}/icon.svg`,
    tos_uri: `${origin}/terms`,
    policy_uri: `${origin}/terms`,
    redirect_uris: [`${origin}${REDIRECT_PATH}`],
    scope: METADATA_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  };

  return NextResponse.json(metadata, {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
