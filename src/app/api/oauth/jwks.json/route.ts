/**
 * JWKS for the confidential OAuth client (public keys only).
 *
 * Served at /api/oauth/jwks.json — referenced as `jwks_uri` in the confidential
 * client metadata. The Authorization Server fetches this to verify the
 * private_key_jwt client assertions, hence the permissive CORS header.
 */

import { NextResponse } from 'next/server';
import { oauthClient } from '@/lib/oauth/server/oauthClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const jwks = await oauthClient.getJWKS();
  return NextResponse.json(jwks, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
