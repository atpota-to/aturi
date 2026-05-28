/**
 * Confidential OAuth session check.
 *
 * GET /api/oauth/session  (Authorization: Bearer <frontend token>)
 *
 * Validates the frontend token, restores the server-side OAuth session, and
 * returns the user's profile. `oauthSessionMissing: true` tells the frontend
 * the frontend token is valid but the backend tokens were lost (cold-start
 * race) so it can trigger a re-auth.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { Agent } from '@atproto/api';
import { oauthClient } from '@/lib/oauth/server/oauthClient';
import { frontendSessionStore } from '@/lib/oauth/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { success: false, authenticated: false, error: 'Missing or invalid authorization header' },
      { status: 401 },
    );
  }
  const token = authHeader.slice(7);

  const validation = await frontendSessionStore.validateWithDetails(token);
  if (!validation.userDid) {
    if (validation.error) {
      return NextResponse.json(
        {
          success: false,
          authenticated: false,
          code: 'VALIDATION_TRANSIENT_ERROR',
          error: 'Session validation temporarily unavailable, please retry',
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        authenticated: false,
        code: 'FRONTEND_SESSION_INVALID',
        error: 'Invalid or expired session',
      },
      { status: 401 },
    );
  }
  const userDid = validation.userDid;

  // Restore with retry — concurrent instances racing on refresh-token rotation
  // can briefly return null; a short backoff lets us read the winner's tokens.
  let oauthSession = await oauthClient.restoreSession(userDid);
  for (let attempt = 1; attempt < 3 && !oauthSession; attempt++) {
    await new Promise((r) => setTimeout(r, 800 * attempt));
    oauthSession = await oauthClient.restoreSession(userDid);
  }

  let profile: Record<string, unknown> | null = null;
  if (oauthSession) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const agent = new Agent(oauthSession);
        const res = await agent.app.bsky.actor.getProfile({ actor: userDid });
        profile = {
          did: res.data.did,
          handle: res.data.handle,
          displayName: res.data.displayName,
          avatar: res.data.avatar,
          description: res.data.description,
          followersCount: res.data.followersCount,
          followsCount: res.data.followsCount,
          postsCount: res.data.postsCount,
          banner: res.data.banner,
        };
        break;
      } catch (err) {
        const isInvalidToken = (err as Error).message?.includes('Invalid token');
        if (isInvalidToken && attempt < 1) {
          await new Promise((r) => setTimeout(r, 1200));
          const fresh = await oauthClient.restoreSession(userDid);
          if (fresh) {
            oauthSession = fresh;
            continue;
          }
        }
        break;
      }
    }
  }

  return NextResponse.json({
    success: true,
    authenticated: true,
    oauthSessionMissing: !oauthSession,
    user: { did: userDid, ...(profile ?? {}) },
  });
}
