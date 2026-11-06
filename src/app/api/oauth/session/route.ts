/**
 * Who is signed in.
 *
 * Answered entirely from two row reads: the app session, and the denormalised
 * `granted_scope`/`pds` on the grant. No session restore, no token refresh, no
 * round trip to the PDS. This runs on every page load for every signed-in
 * visitor, so anything more expensive would be paid constantly.
 *
 * The three statuses are load-bearing and clients branch on them:
 *
 *   200 — signed in
 *   401 SESSION_INVALID   — definitively signed out; clear local state
 *   503 SESSION_TRANSIENT — the database could not answer; retry, do NOT
 *                           clear local state
 *
 * Collapsing the last two turns a momentary database hiccup into a mass
 * sign-out, which is the failure the reference implementation's status split
 * was added to stop.
 *
 * `?lite=1` skips the grant lookup entirely and answers only whether a grant
 * row still exists — a side-effect-free probe for checking accounts the user
 * is not actively using.
 */

import { getStore, TABLE } from '@/lib/oauth/server/store';
import { corsPreflight, fail, guarded, json, resolveOrigin } from '@/lib/oauth/server/http';
import {
  isSecureOrigin,
  resolveActor,
  serializeCookie,
  sessionCookieName,
  SIGNED_IN_HINT_COOKIE,
  touchAppSession,
} from '@/lib/oauth/server/session';

import { readCookie } from '@/lib/oauth/server/session';

/** The raw cookie value, so a slid expiry can be re-issued unchanged. */
function readSessionCookie(request: Request, origin: string): string {
  return readCookie(request, sessionCookieName(origin)) ?? '';
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: Request) {
  return guarded(async () => {
    const origin = resolveOrigin(request);
    if (!origin) return fail(400, 'UNKNOWN_HOST', 'Unknown host');

    const actor = await resolveActor(request, origin);
    if (!actor.ok) {
      return fail(
        actor.status,
        actor.code,
        actor.status === 503 ? 'Session check unavailable, retry' : 'Not signed in',
      );
    }

    const lite = new URL(request.url).searchParams.get('lite');
    const grant = await getStore().selectOne(
      TABLE.oauthSessions,
      { sub: actor.userDid, client: actor.client },
      lite === '1' || lite === 'true' ? 'sub' : 'granted_scope,pds',
    );

    if (lite === '1' || lite === 'true') {
      return json({
        ok: true,
        lite: true,
        did: actor.userDid,
        client: actor.client,
        grantMissing: !grant,
      });
    }

    const res = json({
      ok: true,
      did: actor.userDid,
      client: actor.client,
      grantMissing: !grant,
      scope: (grant?.granted_scope as string | null) ?? null,
      pds: (grant?.pds as string | null) ?? null,
    });

    // Sliding expiry, at most hourly — and the cookie has to slide with the
    // row, or the session still dies on the original schedule no matter how
    // actively it is used. Cookie callers only: a bearer holder keeps its own
    // token and has no cookie to refresh.
    const slid = await touchAppSession(actor.tokenHash);
    if (slid && !request.headers.get('authorization')) {
      const secure = isSecureOrigin(origin);
      const maxAge = Math.max(0, Math.floor((slid.getTime() - Date.now()) / 1000));
      res.headers.append(
        'set-cookie',
        serializeCookie(sessionCookieName(origin), readSessionCookie(request, origin), {
          maxAge,
          secure,
        }),
      );
      res.headers.append(
        'set-cookie',
        serializeCookie(SIGNED_IN_HINT_COOKIE, '1', { maxAge, secure, httpOnly: false }),
      );
    }

    return res;
  });
}
