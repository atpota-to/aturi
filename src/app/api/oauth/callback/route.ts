/**
 * The registered redirect_uri — the only one the authorization server knows.
 *
 * Extension sign-in does not add a redirect_uri here. The extension's return
 * target is an application-level hand-off this route performs after the code
 * exchange, which is why an unstable extension redirect host (Firefox
 * randomises it per install) never has to be registered anywhere.
 *
 * Order matters. The application state is read from our own store BEFORE the
 * code is exchanged, because that is where the browser-binding check lives:
 * rejecting afterwards would already have refreshed the grant. Reading it
 * first is also how the failure path recovers the right return target — the
 * reference backend instead JSON-parses the wire `state` parameter, which is
 * the library's opaque store key and always throws, silently sending every
 * failed staging sign-in to production.
 */

import { NextResponse } from 'next/server';
import { getOAuthClient, getStateStore } from '@/lib/oauth/server/client';
import { randomToken, sha256Hex } from '@/lib/oauth/server/crypto';
import { requireBffConfig } from '@/lib/oauth/server/env';
import { fail, guarded, resolveOrigin } from '@/lib/oauth/server/http';
import type { AppState } from '@/lib/oauth/server/oauthStores';
import { getStore, TABLE } from '@/lib/oauth/server/store';
import {
  clearCookie,
  flowCookieName,
  isSecureOrigin,
  mintAppSession,
  readCookie,
  serializeCookie,
  sessionCookieName,
  SIGNED_IN_HINT_COOKIE,
} from '@/lib/oauth/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pages that are somewhere to start rather than somewhere you were.
 *
 * Ported from the browser callback page so the two paths land users in the
 * same place. Signing in from a record or a profile should return you to it;
 * signing in from the home page or the nav has no such destination, so those
 * go to the visitor's own repo — which is what they now have that they didn't
 * before.
 */
const GENERIC_ORIGINS = new Set([
  '/', '/account', '/explore', '/explore/spaces', '/explore/lexicons',
  '/docs', '/links', '/extension', '/feedback', '/fork', '/terms',
]);

function landingFor(returnTo: string, did: string): string {
  const path = returnTo.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return GENERIC_ORIGINS.has(path) ? `/explore/${did}` : returnTo;
}

function redirectWithError(target: string, message: string): NextResponse {
  // Built with URL rather than by appending: a return path may carry a
  // fragment (`/explore/did:plc:x#records`), and a hand-rolled `?`/`&` would
  // put the parameter after the `#`, where it is never sent to the server and
  // never parsed as a query — so the message would silently vanish on exactly
  // the deep links most worth returning to. Both call sites pass an absolute
  // target already.
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    const res = NextResponse.redirect(target, 302);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }
  url.searchParams.set('oauth_error', message);
  const res = NextResponse.redirect(url.toString(), 302);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function GET(request: Request) {
  return guarded(async () => {
    const origin = resolveOrigin(request);
    if (!origin) return fail(400, 'UNKNOWN_HOST', 'Unknown host');
    const cfg = requireBffConfig();
    const secure = isSecureOrigin(origin);

    const url = new URL(request.url);
    const params = url.searchParams;
    const stateKey = params.get('state');

    // Recover the app state first — it carries both the browser binding and
    // the return target, and both are needed before anything else happens.
    let appState: AppState | null = null;
    if (stateKey) {
      appState = await getStateStore()
        .peekAppState(stateKey)
        .catch(() => null);
    }

    const fallbackReturn = `${origin}/`;
    const returnBase =
      appState?.client === 'extension'
        ? appState.return
        : `${origin}${appState?.return ?? '/'}`;

    const oauthError = params.get('error');
    if (oauthError) {
      const description = params.get('error_description') || oauthError;
      return redirectWithError(returnBase || fallbackReturn, description);
    }

    if (!appState) {
      // Not necessarily an attack, and in fact usually not: a user who spends
      // more than ten minutes on their authorization server lands here. A JSON
      // body would render as raw JSON on a blank page, so send them home with
      // the message like every other failure on this route.
      return redirectWithError(
        fallbackReturn,
        'That sign-in took too long. Please try again.',
      );
    }

    // The browser binding. Web flows carry a flow cookie set at /login;
    // extension flows are bound by the PKCE verifier at /exchange instead,
    // because launchWebAuthFlow does not reliably share the cookie jar.
    if (appState.client === 'web') {
      const cookie = readCookie(request, flowCookieName(origin));
      if (!cookie || cookie !== appState.flow) {
        return redirectWithError(
          returnBase || fallbackReturn,
          'That sign-in did not start in this browser. Please try again.',
        );
      }
    }

    const { client } = await getOAuthClient(origin, appState.client);

    let session;
    try {
      ({ session } = await client.callback(params));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authorization failed';
      return redirectWithError(returnBase || fallbackReturn, message);
    }

    const did = session.sub;
    const clearFlow = clearCookie(flowCookieName(origin), secure);

    if (appState.client === 'extension') {
      // Hand back a one-time code, never a token — the return URL is visible
      // to whatever opened the auth window. The session is minted at
      // redemption, so this table never holds a credential at all, which is
      // the same rule app_sessions follows by storing only a hash. The code is
      // worthless without the verifier whose hash was stored at /login.
      const code = randomToken();
      await getStore().insert(TABLE.exchangeCodes, {
        code_sha256: sha256Hex(code),
        challenge_b64: appState.challenge ?? '',
        user_did: did,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      const target = new URL(appState.return);
      target.hash = new URLSearchParams({ code }).toString();
      const res = NextResponse.redirect(target.toString(), 302);
      res.headers.append('set-cookie', clearFlow);
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }

    // Web: the cookie is set here, same-origin, so the token never enters a
    // URL, a Location header, an access log, browser history, or a Referer.
    const appSession = await mintAppSession(did, 'web', 'Browser');
    const maxAge = cfg.appSessionTtlDays * 86_400;
    const res = NextResponse.redirect(`${origin}${landingFor(appState.return, did)}`, 302);
    res.headers.append('set-cookie', clearFlow);
    res.headers.append(
      'set-cookie',
      serializeCookie(sessionCookieName(origin), appSession.token, { maxAge, secure }),
    );
    // Readable by scripts on purpose and carries no secret: it is what lets an
    // anonymous visitor skip the session round trip on every page load.
    res.headers.append(
      'set-cookie',
      serializeCookie(SIGNED_IN_HINT_COOKIE, '1', { maxAge, secure, httpOnly: false }),
    );
    res.headers.set('Cache-Control', 'no-store');
    return res;
  });
}
