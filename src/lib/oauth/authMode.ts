'use client';

/**
 * Which OAuth client a NEW sign-in uses.
 *
 *   browser (default) — the public browser client, as it always was
 *   bff               — the confidential backend client
 *
 * There is deliberately no "auto". A browser cannot see whether the server has
 * a signing key and a database, so an auto mode could only guess — and guessing
 * "backend" on a deployment that has none sends every sign-in to a route that
 * answers 503. Whoever sets the server variables sets this one in the same
 * change.
 *
 * `mode` governs NEW sign-ins ONLY. An existing session of either kind is
 * always honoured, in both directions:
 *
 *   - Someone signed in through the browser client today keeps that session
 *     when the backend is switched on. Nobody is logged out by the migration.
 *   - Someone signed in through the backend keeps that session when the flag
 *     is switched back to `browser`. That is what makes the rollback safe
 *     rather than a mass sign-out.
 */

import { SIGNED_IN_HINT_COOKIE } from './cookies';

export type AuthMode = 'browser' | 'bff';

export function resolveAuthMode(): AuthMode {
  // Read as a whole property access: Next inlines NEXT_PUBLIC_* at build time
  // and cannot substitute a computed key.
  return process.env.NEXT_PUBLIC_AUTH_MODE === 'bff' ? 'bff' : 'browser';
}

export function hasSignedInHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${SIGNED_IN_HINT_COOKIE}=`));
}
