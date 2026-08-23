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
 * Where the user lands after the callback. Web returns take a root-relative
 * path only; extension returns must match an exact entry in
 * ATURI_EXTENSION_RETURN_ORIGINS.
 *
 * A backslash is rejected alongside a second slash: some URL parsers normalise
 * `/\evil.example` into a protocol-relative URL, which would make this an open
 * redirect carrying a live session.
 */
function validateReturn(
  raw: string | null,
  client: 'web' | 'extension',
  allowedOrigins: readonly string[],
): string | null {
  if (client === 'extension') {
    if (!raw) return null;
    return allowedOrigins.includes(raw) ? raw : null;
  }
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  if (raw.startsWith('/oauth') || raw.startsWith('/api/oauth')) return '/';
  return raw;
}

export async function GET(request: Request) {
  return guarded(async () => {
    const origin = resolveOrigin(request);
    if (!origin) return fail(400, 'UNKNOWN_HOST', 'Unknown host');
    const cfg = requireBffConfig();

    const params = new URL(request.url).searchParams;

    if (!(await allow(`login:${sha256Hex(callerKey(request))}`, RATE_LIMITS.login))) {
      return fail(429, 'RATE_LIMITED', 'Too many sign-in attempts', 'Wait a few minutes.');
    }

    const handle = params.get('handle')?.trim();
    if (!handle) {
      return fail(400, 'MISSING_PARAMETER', 'Missing handle', 'Pass ?handle=<handle|did|pds-url>.');
    }
    // An https identifier makes the library perform discovery against that host,
    // so it goes through the same guard the rest of the app uses for outbound
    // server-side fetches before it gets there.
    if (/^https?:\/\//i.test(handle) && !toPublicHttpUrl(handle)) {
      return fail(400, 'INVALID_PARAMETER', 'That server address is not reachable');
    }

    const clientParam = params.get('client') ?? 'web';
    if (!isOAuthClientKind(clientParam)) {
      return fail(400, 'INVALID_PARAMETER', 'client must be "web" or "extension"');
    }

    const rawIds = (params.get('scopes') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const validIds = rawIds.filter((id): id is ScopeId => ALL_SCOPE_IDS.has(id as ScopeId));
    if (validIds.length !== rawIds.length) {
      return fail(
        400,
        'INVALID_PARAMETER',
        'Unknown permission requested',
        'Every entry in ?scopes= must be a known permission id.',
      );
    }
    const scope = buildScopeString(new Set(validIds));

    const returnTo = validateReturn(params.get('return'), clientParam, cfg.extensionReturnOrigins);
    if (returnTo === null) {
      return fail(400, 'INVALID_PARAMETER', 'Invalid return target');
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
    const authUrl = await client.authorize(handle, {
      scope,
      prompt: 'consent',
      state: JSON.stringify(appState),
    });

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
