/**
 * The confidential client's public JWKS.
 *
 * Node runtime: deriving public keys from the private JWK needs node:crypto.
 * The cache is deliberately short. The authorization server keeps its own
 * in-process copy for roughly ten minutes, so a long CDN cache in front of it
 * makes the effective rotation delay the sum of the two.
 */

import { NextResponse } from 'next/server';
import { getPublicJwks } from '@/lib/oauth/server/client';
import { isBffConfigured } from '@/lib/oauth/server/env';
import { resolveOrigin } from '@/lib/oauth/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const origin = resolveOrigin(request);
  if (!origin) return new NextResponse('Unknown host', { status: 400 });
  if (!isBffConfigured()) {
    return new NextResponse('Backend OAuth is not configured on this deployment', {
      status: 404,
    });
  }

  try {
    return NextResponse.json(await getPublicJwks(origin), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (err) {
    console.error('[oauth] jwks', err instanceof Error ? err.message : err);
    return new NextResponse('Key material unavailable', { status: 500 });
  }
}
