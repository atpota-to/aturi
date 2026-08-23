'use client';

/**
 * Which OAuth client a NEW sign-in uses.
 *
 *   auto (default) — the backend client when the deployment has one,
 *                    the public browser client otherwise
 *   bff            — force the backend client
 *   browser        — force the public browser client
 *
 * `auto` is the whole migration guarantee, and the important half is what it
 * does NOT do: it never touches an existing browser-client session. Someone
 * signed in today keeps running against the public `client_id` until they sign
 * out of their own accord, and is never logged out or forced to re-authorize.
 * That only works because both clients live in one deployment and one provider
 * can dispatch between them.
 *
 * Rollback is this one variable. Already-minted backend sessions stay valid, so
 * flipping back and forth is safe.
 */

export type AuthMode = 'browser' | 'bff';

/**
 * Whether the deployment has a backend at all.
 *
 * This is a public flag, not a secret: it says only that the capability exists.
 * Vercel inlines NEXT_PUBLIC_* at build time, so it must be read as a whole
 * property access rather than through a computed key.
 */
function bffAvailable(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_MODE !== undefined
    ? process.env.NEXT_PUBLIC_AUTH_MODE !== 'browser'
    : false;
}

export function resolveAuthMode(): AuthMode {
  const raw = process.env.NEXT_PUBLIC_AUTH_MODE;
  if (raw === 'browser') return 'browser';
  if (raw === 'bff') return 'bff';
  return bffAvailable() ? 'bff' : 'browser';
}

/**
 * A non-HttpOnly companion to the session cookie, carrying no secret.
 *
 * Without it, every visitor — including every anonymous one — would pay a
 * serverless round trip on every page load before the UI could decide whether
 * anyone is signed in.
 */
export const SIGNED_IN_HINT_COOKIE = 'aturi_signed_in';

export function hasSignedInHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${SIGNED_IN_HINT_COOKIE}=`));
}
