/**
 * Start an authorization.
 *
 * Four things here are security-load-bearing and each exists because the
 * obvious version is wrong:
 *
 * 1. EXACTLY the parameters below reach `authorize()`. The reference backend
 *    spreads the remaining query string into its options, which forwards a
 *    caller-controlled `prompt`, `max_age` and `authorization_details` — and
 *    `prompt=none` on a confidential client is a silent-authorization path.
 *
 * 2. Scopes arrive as a closed set of ids, never as a scope string, and are
 *    rebuilt canonically with the same `buildScopeString` the picker uses. An
 *    unknown id is a 400, never a silent narrowing.
 *
 * 3. `prompt: 'consent'` is always sent. A confidential client loses the
 *    authorization server's own forced consent screen — with a login hint
 *    matching an active device session and the scopes already accumulated, an
 *    authorization can complete with no user-visible step at all. Sending it
 *    explicitly preserves exactly what the public client does today.
 *
 * 4. A short-lived flow cookie binds the authorization to THIS browser. The
 *    library keys its state store on a random nonce and mints a session for
 *    whoever presents a matching code; that is safe when the store is the
 *    visitor's own IndexedDB and unsafe the moment it becomes a shared table.
 *    Without this, an attacker completes an authorization for their own
 *    account and then causes a victim's browser to hit the callback, leaving
 *    the victim signed in as the attacker and writing into the attacker's repo.
 */

import { NextResponse } from 'next/server';
import { ALL_SCOPE_IDS, buildScopeString, type ScopeId } from '@/lib/oauth/scopes';
import { toPublicHttpUrl } from '@/utils/ssrfGuard';
import { getOAuthClient } from '@/lib/oauth/server/client';
import { randomToken, sha256Hex } from '@/lib/oauth/server/crypto';
import { isOAuthClientKind, requireBffConfig } from '@/lib/oauth/server/env';
import { corsPreflight, fail, guarded, resolveOrigin } from '@/lib/oauth/server/http';
import type { AppState } from '@/lib/oauth/server/oauthStores';
import { allow, callerKey, RATE_LIMITS } from '@/lib/oauth/server/rateLimit';
import { flowCookieName, isSecureOrigin, serializeCookie } from '@/lib/oauth/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return corsPreflight();
}

/**
 * Whether this navigation was started by our own pages.
 *
 * `Sec-Fetch-Site: same-origin` is what a browser sends on a same-site
 * top-level navigation; `none` means the user typed the URL or used a
 * bookmark, which is also not a cross-site attack but is not a real sign-in
 * either, so it is refused with a message rather than allowed. Referer is the
 * fallback for a browser too old to send Sec-Fetch-Site; Origin is not sent on
 * navigations and is no use here.
 */
function startedHere(request: Request, origin: string): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    return new URL(referer).origin === origin;
  } catch {
    return false;
  }
}

/**
 * The redirect hosts browsers reserve for `identity.launchWebAuthFlow`.
 *
 * These are patterns, not exact origins, and that is forced rather than lax:
 * Firefox derives its host from an internal UUID randomised PER INSTALL, so
 * there is no value to put in an allowlist — an exact-match list means Firefox
 * sign-in can never succeed at all. Chrome's id is stable only after store
 * publication, so every developer's unpacked build differs too.
 *
 * What makes a pattern safe here is that the redirect is not what authenticates
 * the extension: the code delivered to it is worthless without the PKCE
 * verifier, which never leaves the extension that generated it. Widening this
 * to any real host, as opposed to these browser-internal ones, would not be
 * safe on the same reasoning — those resolve to somebody's server.
 *
 * Neither host resolves on the network at all; the browser intercepts them.
 */
const BROWSER_REDIRECT_HOSTS = [
  /^https:\/\/[a-z0-9-]+\.chromiumapp\.org\/?$/i,
  /^https:\/\/[a-z0-9-]+\.extensions\.allizom\.org\/?$/i,
  // Firefox 86+ also accepts this loopback form.
  /^http:\/\/127\.0\.0\.1\/mozoauth2\/[a-z0-9-]+\/?$/i,
];

/**
 * Where the user lands after the callback.
 *
 * Web returns take a root-relative path only. A backslash is rejected
 * alongside a second slash: some URL parsers normalise `/\evil.example` into a
 * protocol-relative URL, which would make every failure path an open redirect
 * carrying a live session.
 */
function validateReturn(
  raw: string | null,
  client: 'web' | 'extension',
  allowedOrigins: readonly string[],
): string | null {
  if (client === 'extension') {
    if (!raw) return null;
    if (BROWSER_REDIRECT_HOSTS.some((re) => re.test(raw))) return raw;
    // Anything else must be named explicitly — a Safari build, say, which has
    // no identity API and needs the nonce-and-claim flow instead.
    return allowedOrigins.includes(raw) ? raw : null;
  }
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  if (raw.startsWith('/oauth') || raw.startsWith('/api/oauth')) return '/';
  return raw;
}

export async function GET(request: Request) {
  const origin = resolveOrigin(request);
  const params = new URL(request.url).searchParams;

  /**
   * This route is reached by a top-level navigation, not by fetch, so a JSON
   * error body would be rendered to the user as raw JSON on a blank page. Send
   * them back where they came from with the message instead, and let the app
   * show it. Extension callers ask for JSON and get it.
   *
   * The return target is re-validated here rather than trusted: it is the same
   * caller-supplied value, and an unvalidated one would make every failure
   * path an open redirect.
   */
  const wantsJson = request.headers.get('accept')?.includes('application/json');
  const bail = (status: number, code: string, message: string, hint?: string) => {
    if (wantsJson || !origin) return fail(status, code, message, hint);
    const back = validateReturn(params.get('return'), 'web', []) ?? '/';
    const url = new URL(`${origin}${back}`);
    url.searchParams.set('oauth_error', message);
    const res = NextResponse.redirect(url.toString(), 302);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  };

  return guarded(async () => {
    if (!origin) return fail(400, 'UNKNOWN_HOST', 'Unknown host');
    const cfg = requireBffConfig();

    const clientParam = params.get('client') ?? 'web';
    if (!isOAuthClientKind(clientParam)) {
      return bail(400, 'INVALID_PARAMETER', 'Unknown sign-in client.');
    }

    if (!(await allow(`login:${sha256Hex(callerKey(request))}`, RATE_LIMITS.login))) {
      return bail(429, 'RATE_LIMITED', 'Too many sign-in attempts', 'Wait a few minutes.');
    }

    // A sign-in must be started BY THIS SITE. Without that, a hostile page can
    // navigate a visitor to this route with a `handle` naming an authorization
    // server it controls: the visitor sees an aturi-branded consent screen on
    // that server, and authorising leaves them signed in to an account the
    // attacker owns, writing what they believe is their own content into the
    // attacker's repo. The flow cookie cannot catch this — it proves the flow
    // started in this browser, not that the user asked for it.
    //
    // Sec-Fetch-Site is the reliable signal on a top-level navigation and is
    // sent by every current browser; Origin is not sent on navigations at all,
    // so Referer is the only fallback worth having. Extension flows are
    // exempt because launchWebAuthFlow is cross-site by construction — they
    // are bound by the PKCE verifier at /exchange instead.
    if (clientParam === 'web' && !startedHere(request, origin)) {
      return bail(403, 'CROSS_SITE_SIGN_IN', 'Start sign-in from the sign-in button.');
    }

    const handle = params.get('handle')?.trim();
    if (!handle) {
      return bail(400, 'MISSING_PARAMETER', 'Enter a handle to sign in.');
    }
    // An https identifier makes the library perform discovery against that host,
    // so it goes through the same guard the rest of the app uses for outbound
    // server-side fetches before it gets there.
    if (/^https?:\/\//i.test(handle) && !toPublicHttpUrl(handle)) {
      return bail(400, 'INVALID_PARAMETER', 'That server address is not reachable.');
    }


    const rawIds = (params.get('scopes') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const validIds = rawIds.filter((id): id is ScopeId => ALL_SCOPE_IDS.has(id as ScopeId));
    if (validIds.length !== rawIds.length) {
      return bail(400, 'INVALID_PARAMETER', 'Unknown permission requested.');
    }
    // The extension's read-only grant is enforced HERE rather than by the
    // extension choosing to send no scopes.
    //
    // This is defence in depth, not a hole being closed: grants are keyed
    // (sub, client), so an extension session can only ever restore tokens
    // minted by an extension flow, and anyone who ran that flow themselves
    // would be authorizing their own account. What it buys is that the claim
    // does not depend on the client. Both privacy documents state plainly
    // that the extension cannot write, and this is the line that keeps that
    // true no matter what a future caller of this route sends.
    const scope = buildScopeString(
      clientParam === 'extension' ? new Set<ScopeId>() : new Set(validIds),
    );

    const returnTo = validateReturn(params.get('return'), clientParam, cfg.extensionReturnOrigins);
    if (returnTo === null) {
      return bail(400, 'INVALID_PARAMETER', 'Invalid return target.');
    }

    const challenge = params.get('challenge')?.trim() || undefined;
    if (clientParam === 'extension' && !challenge) {
      return fail(
        400,
        'MISSING_PARAMETER',
        'Missing challenge',
        'Extension sign-in must send base64url(SHA-256(verifier)).',
      );
    }

    const flow = randomToken();
    const appState: AppState = {
      flow,
      client: clientParam,
      return: returnTo,
      ids: validIds,
      challenge,
    };

    const { client } = await getOAuthClient(origin, clientParam);
    let authUrl: URL;
    try {
      authUrl = await client.authorize(handle, {
        scope,
        prompt: 'consent',
        state: JSON.stringify(appState),
      });
    } catch (err) {
      // The commonest failure by far, and the one a user can act on: an
      // unresolvable handle, or a server refusing a scope it has not
      // re-fetched yet. Surfaced verbatim — describeSignInError() on the
      // client rewrites the one case it can place.
      return bail(
        400,
        'AUTHORIZE_FAILED',
        err instanceof Error ? err.message : 'Could not start sign-in',
      );
    }

    const secure = isSecureOrigin(origin);
    const res = NextResponse.redirect(authUrl.toString(), 302);
    res.headers.set(
      'set-cookie',
      serializeCookie(flowCookieName(origin), flow, { maxAge: 600, secure }),
    );
    res.headers.set('Cache-Control', 'no-store');
    return res;
  });
}
