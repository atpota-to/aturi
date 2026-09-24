/**
 * OAuth client metadata for the iOS app. See `src/lib/iosApp.ts` for why the
 * native app cannot reuse `/oauth-client-metadata.json`, and that file's
 * sibling route for the host rules, which are the same here.
 */

import { NextResponse } from 'next/server';
import { buildIosClientMetadata } from '@/lib/iosApp';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

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

  return NextResponse.json(buildIosClientMetadata(origin), {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
