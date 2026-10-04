/**
 * Apple App Site Association for the iOS app's universal links.
 *
 * Served at `/.well-known/apple-app-site-association` through a rewrite in
 * `next.config.ts`, because the App Router does not route a folder whose
 * name begins with a dot. Apple's CDN fetches the file when the app is
 * installed and requires a JSON content type with no redirect, which is why
 * this is a route handler rather than a static file: it can also refuse to
 * publish anything until `IOS_APP_TEAM_ID` is configured, since an
 * association naming the wrong Team ID is worse than none.
 */

import { NextResponse } from 'next/server';
import { buildAppleAppSiteAssociation } from '@/lib/iosApp';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const body = buildAppleAppSiteAssociation(process.env.IOS_APP_TEAM_ID);
  if (!body) {
    return new NextResponse('Not configured', { status: 404 });
  }
  return NextResponse.json(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
