/**
 * Confidential OAuth login — initiates the flow and redirects to the user's PDS.
 *
 * GET /api/oauth/login?handle=<handle>&scope=<scope>&redirect_uri=<frontend>
 *
 * `scope` is the runtime-selected subset from the sign-in scope picker; it must
 * be a subset of the metadata superset (defaults to the full superset). The
 * `redirect_uri` is the FRONTEND page we'll send the user back to after the
 * callback (validated against allowed frontends); it is distinct from the OAuth
 * redirect_uri the Authorization Server uses (which is /api/oauth/callback).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { oauthClient } from '@/lib/oauth/server/oauthClient';
import { isAllowedFrontend, defaultFrontendCallback } from '@/lib/oauth/server/config';
import { METADATA_SCOPE } from '@/lib/oauth/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const handle = params.get('handle');
  const redirectUri = params.get('redirect_uri') || params.get('redirect_url');
  // Never send an empty or wider-than-metadata scope, or the AS returns
  // invalid_scope. buildScopeString() on the client guarantees a valid subset.
  const scope = params.get('scope') || METADATA_SCOPE;

  if (!handle) {
    return NextResponse.json({ success: false, error: 'Handle is required for OAuth flow' }, { status: 400 });
  }
  if (redirectUri && !isAllowedFrontend(redirectUri)) {
    return NextResponse.json(
      { success: false, error: 'Invalid redirect_uri. Must be an allowed frontend URL.' },
      { status: 400 },
    );
  }

  try {
    const state = JSON.stringify({
      redirect_uri: redirectUri || defaultFrontendCallback,
      timestamp: Date.now(),
    });
    const authUrl = await oauthClient.generateLoginUrl(handle, { scope, state });
    return NextResponse.redirect(authUrl, 302);
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
