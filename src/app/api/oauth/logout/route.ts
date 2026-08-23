/**
 * Sign out.
 *
 * `?scope=client` (the default) ends this device's session and nothing else.
 * `?scope=all` ends every session for the account and revokes the grant at the
 * PDS.
 *
 * The reference implementation conflates the two: signing out of one tab
 * revokes the PDS grant for every device and forces a full re-authorization.
 * That is bad on its own and much worse once an extension holds a long-lived
 * session — closing a browser tab would silently sign the extension out too.
 *
 * The grant is force-deleted only when this was the last session using it. The
 * store's ordinary `del()` is a deliberate no-op for library-initiated deletes
 * (see oauthStores.ts), so this is the one path that really removes a grant.
 */

import { getOAuthClient } from '@/lib/oauth/server/client';
import { OAUTH_CLIENT_KINDS, type OAuthClientKind } from '@/lib/oauth/server/env';
import { corsPreflight, fail, guarded, json, resolveOrigin } from '@/lib/oauth/server/http';
import { getStore, TABLE } from '@/lib/oauth/server/store';
import {
  clearCookie,
  deleteAppSession,
  deleteAppSessionsFor,
  isSecureOrigin,
  resolveActor,
  sessionCookieName,
  SIGNED_IN_HINT_COOKIE,
} from '@/lib/oauth/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return corsPreflight();
}

async function revokeGrant(origin: string, did: string, kind: OAuthClientKind): Promise<void> {
  try {
    const { client, sessionStore } = await getOAuthClient(origin, kind);
    // Revoking at the PDS can fail (network, an already-dead grant) and must
    // not stop the local row from going.
    await client.revoke(did).catch(() => {});
    await sessionStore.forceDelete(did);
  } catch {
    // An unconfigured or unreachable backend still gets the local cleanup that
    // the caller of this function performs.
  }
}

export async function POST(request: Request) {
  return guarded(async () => {
    const origin = resolveOrigin(request);
    if (!origin) return fail(400, 'UNKNOWN_HOST', 'Unknown host');
    const secure = isSecureOrigin(origin);

    const clearCookies = (res: ReturnType<typeof json>) => {
      res.headers.append('set-cookie', clearCookie(sessionCookieName(origin), secure));
      res.headers.append('set-cookie', clearCookie(SIGNED_IN_HINT_COOKIE, secure));
      return res;
    };

    // A cross-site form POST reaches this route (no preflight, no body read),
    // and clearing a visitor's cookies on someone else's say-so is a nuisance
    // logout. Bearer callers — the extension, and local dev — are exempt:
    // they hold a credential no other site can send.
    const usingCookie = !request.headers.get('authorization');
    const site = request.headers.get('sec-fetch-site');
    if (usingCookie && site && site !== 'same-origin') {
      return fail(403, 'CROSS_SITE', 'Sign out from the site itself.');
    }

    const actor = await resolveActor(request, origin);
    // No resolvable session is not an error: the caller wanted to end up
    // signed out, and it is.
    if (!actor.ok) return clearCookies(json({ ok: true, signedOut: true }));

    const all = new URL(request.url).searchParams.get('scope') === 'all';

    if (all) {
      await deleteAppSessionsFor(actor.userDid);
      for (const kind of OAUTH_CLIENT_KINDS) {
        await revokeGrant(origin, actor.userDid, kind);
      }
      return clearCookies(json({ ok: true, signedOut: true, revoked: true }));
    }

    await deleteAppSession(actor.tokenHash);

    // Only drop the grant when nothing else is using it. Another browser, or
    // the extension, may still hold a session against the same client.
    const remaining = await getStore()
      .select(TABLE.appSessions, { user_did: actor.userDid, client: actor.client }, 'token_sha256')
      .catch(() => null);
    if (remaining && remaining.length === 0) {
      await revokeGrant(origin, actor.userDid, actor.client);
    }

    return clearCookies(json({ ok: true, signedOut: true }));
  });
}
