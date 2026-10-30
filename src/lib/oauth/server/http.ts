/**
 * Shared HTTP plumbing for the BFF routes. SERVER ONLY.
 */

import { NextResponse } from 'next/server';
import { allowedClientHosts, BffNotConfiguredError } from './env';

/**
 * The origin this request was addressed to, validated against the hosts
 * allowed to act as a `client_id`.
 *
 * Returns null for anything else, and the caller answers 400. Preview
 * deployments land here on purpose: `client_id` must equal the URL the
 * metadata is served from, so each preview hash would be a distinct OAuth
 * client, and allowlisting the pattern would hand a live session to any
 * preview build — including a fork's pull-request preview.
 */
export function resolveOrigin(request: Request): string | null {
  const url = new URL(request.url);
  const host = (request.headers.get('host') || url.host).toLowerCase();
  const hostname = host.split(':')[0];
  if (!allowedClientHosts().includes(hostname)) return null;
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

/**
 * CORS for /api/oauth/*.
 *
 * The wildcard is safe here precisely because credentials are never allowed
 * with it: the cookie path is same-origin and never reaches this, while the
 * extension presents a bearer, which CORS does not gate. Extension origins
 * cannot be allowlisted anyway — Firefox background scripts send `Origin:
 * null`, and a Chrome extension's id is unstable until it is published.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, atproto-proxy, atproto-accept-labelers, accept-language',
  // Without this, a burst of proxied XRPC calls re-preflights constantly and
  // each preflight is a billed invocation.
  'Access-Control-Max-Age': '86400',
};

export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function json(
  body: unknown,
  status = 200,
  extra?: Record<string, string>,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store', ...extra },
  });
}

/**
 * Header naming the failure as ours.
 *
 * The client has to tell "your session is gone" from "the PDS answered 401
 * about that particular record", and both arrive as a 401. Without this the
 * shim signs the user out on any 401 the proxy relays — so a permission error
 * on one read would log them out of the whole app.
 */
export const ERROR_CODE_HEADER = 'x-aturi-oauth-error';

export function fail(status: number, code: string, error: string, hint?: string) {
  return json(hint ? { ok: false, code, error, hint } : { ok: false, code, error }, status, {
    [ERROR_CODE_HEADER]: code,
  });
}

/**
 * Wrap a handler so an unconfigured deployment answers 503 rather than 500,
 * and so no internal error message reaches a caller.
 *
 * 503 is the honest status: sign-in on this deployment lives somewhere else
 * (the public browser client), which is exactly the state a fork is in.
 */
export async function guarded(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BffNotConfiguredError) {
      return fail(
        503,
        'BFF_NOT_CONFIGURED',
        'Backend OAuth is not configured on this deployment',
        'Sign in with the browser OAuth client instead.',
      );
    }
    console.error('[oauth] unhandled', err instanceof Error ? err.message : err);
    return fail(500, 'INTERNAL_ERROR', 'Something went wrong');
  }
}
