/**
 * Confidential OAuth callback — the Authorization Server redirects here with
 * ?code=&state= (this URL is the OAuth redirect_uri registered in the
 * confidential client metadata).
 *
 * We exchange the code for a session (tokens stored server-side in
 * aturi_oauth_sessions), mint a long-lived opaque frontend token
 * (aturi_frontend_sessions), and redirect the user back to the frontend page
 * with ?session=&did= for the BackendOAuthClient to pick up.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { oauthClient } from '@/lib/oauth/server/oauthClient';
import { frontendSessionStore } from '@/lib/oauth/server/storage';
import { isAllowedFrontend, defaultFrontendCallback } from '@/lib/oauth/server/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function landingFromState(stateRaw: string | null): string {
  if (!stateRaw) return defaultFrontendCallback;
  try {
    const parsed = JSON.parse(stateRaw) as { redirect_uri?: string };
    if (parsed.redirect_uri && isAllowedFrontend(parsed.redirect_uri)) {
      return parsed.redirect_uri;
    }
  } catch {
    // ignore malformed state — fall back to the default landing
  }
  return defaultFrontendCallback;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const oauthError = params.get('error');
  if (oauthError) {
    const description = params.get('error_description') || oauthError;
    const landing = landingFromState(params.get('state'));
    return NextResponse.redirect(`${landing}?error=${encodeURIComponent(description)}`, 302);
  }

  try {
    const { userDID, state } = await oauthClient.handleCallback(params);
    const landing = landingFromState(state);
    const token = await frontendSessionStore.create(userDID);

    const url = new URL(landing);
    url.searchParams.set('session', token);
    url.searchParams.set('did', userDID);
    return NextResponse.redirect(url.toString(), 302);
  } catch (err) {
    return NextResponse.redirect(
      `${defaultFrontendCallback}?error=${encodeURIComponent((err as Error).message)}`,
      302,
    );
  }
}
