/**
 * Confidential OAuth logout.
 *
 * POST /api/oauth/logout  (Authorization: Bearer <frontend token>)
 *
 * Revokes the OAuth tokens with the PDS, force-deletes the server-side session
 * (forceDelete, since the library del() is a no-op), and deletes every frontend
 * token for the user.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { oauthClient } from '@/lib/oauth/server/oauthClient';
import { frontendSessionStore, sessionStore } from '@/lib/oauth/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: true, message: 'No session to logout' });
  }
  const token = authHeader.slice(7);

  try {
    const userDid = await frontendSessionStore.validate(token);
    if (userDid) {
      try {
        await oauthClient.revokeSession(userDid);
      } catch {
        // best effort — continue cleanup even if PDS revoke fails
      }
      try {
        await sessionStore.forceDelete(userDid);
      } catch {
        // best effort
      }
      await frontendSessionStore.deleteAllForUser(userDid);
    } else {
      await frontendSessionStore.delete(token);
    }
    return NextResponse.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    // Always report success so the frontend clears its local state.
    return NextResponse.json({ success: true, message: 'Logged out (with errors)', error: (err as Error).message });
  }
}
