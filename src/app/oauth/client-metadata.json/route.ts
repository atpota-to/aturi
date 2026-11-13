/**
 * Confidential OAuth client metadata.
 *
 * This is a SECOND client, alongside the public one at
 * /oauth-client-metadata.json — which is deliberately untouched. `client_id` is
 * the URL the document is served from, so flipping the existing document to
 * `private_key_jwt` in place would break every live session at its next
 * refresh with no way back. Two documents run in parallel instead, and
 * NEXT_PUBLIC_AUTH_MODE decides which one new sign-ins use.
 *
 * Host-keyed, so testing.aturi.to keeps its own client identity and its own
 * consent records exactly as it does today.
 */

import { NextResponse } from 'next/server';
import { buildClientMetadata } from '@/lib/oauth/clientMetadata';
import { isBffConfigured } from '@/lib/oauth/server/env';
import { resolveOrigin } from '@/lib/oauth/server/http';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const origin = resolveOrigin(request);
  if (!origin) return new NextResponse('Unknown host', { status: 400 });

  // Publishing a confidential client_id whose JWKS cannot be served would let
  // an authorization server cache a client it can never authenticate. Fail
  // closed instead — and never fall back to a public document at this URL,
  // which is the silent confidential→public downgrade the keyset loader also
  // refuses.
  if (!isBffConfigured()) {
    return new NextResponse('Backend OAuth is not configured on this deployment', {
      status: 404,
    });
  }

  return NextResponse.json(buildClientMetadata(origin), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // The authorization server re-fetches this to validate every requested
      // scope and already caches it for about ten minutes. A CDN copy on top
      // only adds a second cache that can mask a deploy.
      'Cache-Control': 'no-store',
    },
  });
}
