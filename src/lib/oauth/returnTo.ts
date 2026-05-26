'use client';

/**
 * Persist the page a user was on when they triggered an OAuth sign-in,
 * so the callback can drop them back there instead of always landing on
 * /account. Lives in sessionStorage because OAuth keeps the user in the
 * same tab and we want the value to die with it.
 */

const KEY = 'aturi.oauth.returnTo';

function isSafeReturnPath(path: string): boolean {
  // Only allow same-origin, root-relative paths. Block anything that could
  // be coerced into an external URL (//evil.example, https://…) or a
  // protocol-relative redirect.
  return path.startsWith('/') && !path.startsWith('//');
}

export function rememberCurrentPathForReturn(): void {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname + window.location.search + window.location.hash;
  // Don't loop back into /oauth/* — if the user is already on the callback
  // page something is wrong; let it fall through to the default.
  if (path.startsWith('/oauth')) return;
  try {
    window.sessionStorage.setItem(KEY, path);
  } catch {
    // sessionStorage can throw in private modes / quota errors. Non-fatal.
  }
}

export function takeReturnPath(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (!v || !isSafeReturnPath(v)) return null;
    return v;
  } catch {
    return null;
  }
}
