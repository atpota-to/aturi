/**
 * Dynamic OAuth client metadata.
 *
 * The OAuth spec ties `client_id` to the URL the metadata JSON is served
 * from. Aturi runs on multiple origins (aturi.to, *.vercel.app previews,
 * localhost for dev) so we generate the metadata per-request using the
 * incoming Host header rather than statically baking in a single origin.
 *
 * Allowed hosts:
 *   - aturi.to
 *   - any *.vercel.app subdomain
 *   - localhost / 127.0.0.1 (development)
 *
 * Requests from any other host are rejected so a typo can't leak
 * functionally-valid metadata under a wrong origin.
 */

import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const OAUTH_SCOPE = 'atproto transition:generic';
const REDIRECT_PATH = '/oauth/callback';

function isAllowedHost(hostname: string): boolean {
  return (
    hostname === 'aturi.to' ||
    hostname === 'www.aturi.to' ||
    hostname.endsWith('.vercel.app') ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1'
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
    scope: OAUTH_SCOPE,
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
