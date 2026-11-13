import { browser } from '#imports';
import { ATURI_BASE } from './aturiUrl';

/**
 * Signing in to aturi.to from the extension.
 *
 * Signing in is entirely optional. Everything the extension did before it
 * existed — waypoints, auto-redirect, the Inspect tab — still works signed
 * out and makes no request to any Aturi-operated server. This module is the
 * only thing in the extension that talks to aturi.to at all.
 *
 * WHY A ONE-TIME CODE AND A VERIFIER, rather than just receiving the token.
 *
 * `identity.launchWebAuthFlow` hands back the final redirect URL, and the
 * obvious design is to put the session token in it. That would be safe only
 * if the redirect URL identified this extension — and it cannot. Firefox
 * derives the host from an internal UUID randomised per install, and a Chrome
 * extension's id is unstable until it is published to the store, so the
 * server cannot hold an exact allowlist of legitimate return targets.
 *
 * So the flow is bound the way PKCE binds an authorization code. We generate a
 * random verifier, send only its SHA-256 to the server, and receive a
 * short-lived one-time code in the redirect. Redeeming that code requires the
 * verifier, which never leaves this extension. Whoever else might observe the
 * redirect gets something worthless.
 *
 * Note also that none of this is an atproto redirect_uri. The authorization
 * server only ever knows aturi.to's own callback; the hand-off to the
 * extension happens afterwards, at the application layer.
 */

/**
 * Deliberately NOT stored in the prefs object.
 *
 * `lib/prefs.ts` serialises the whole `Prefs` object to `browser.storage.sync`,
 * which uploads it to Google's or Mozilla's servers. A session token added to
 * that type would be synced off-device with no error and no sign that it had
 * happened. This is `storage.local`, which never syncs, under its own key.
 */
const SESSION_KEY = 'aturi.session.v1';

export type StoredSession = {
  token: string;
  did: string;
  /** Epoch ms. Advisory: the server is the authority on whether it still works. */
  expiresAt: number;
};

type StorageArea = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

function localArea(): StorageArea | null {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    return browser.storage.local as unknown as StorageArea;
  }
  return null;
}

/**
 * Read the stored session.
 *
 * Reads storage EVERY time rather than caching in a module variable. An MV3
 * background worker is suspended and restarted freely, so a module-level cache
 * is populated in one lifetime and empty in the next — which surfaces as
 * intermittent, unreproducible sign-outs. `entrypoints/background.ts` already
 * follows the same rule for its bypass-rule counter.
 */
export async function getSession(): Promise<StoredSession | null> {
  const area = localArea();
  if (!area) return null;
  try {
    const raw = (await area.get(SESSION_KEY))[SESSION_KEY];
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as Partial<StoredSession>;
    if (typeof s.token !== 'string' || typeof s.did !== 'string') return null;
    return { token: s.token, did: s.did, expiresAt: Number(s.expiresAt) || 0 };
  } catch {
    return null;
  }
}

async function putSession(session: StoredSession): Promise<void> {
  await localArea()?.set({ [SESSION_KEY]: session });
}

export async function clearSession(): Promise<void> {
  await localArea()?.remove(SESSION_KEY);
}

/** Subscribe to sign-in / sign-out. Returns the unsubscribe. */
export function onSessionChanged(listener: (s: StoredSession | null) => void): () => void {
  // prefs.ts's own change listener filters on the prefs key and will never see
  // this one, so it needs its own.
  const handler = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !(SESSION_KEY in changes)) return;
    void getSession().then(listener);
  };
  try {
    browser.storage.onChanged.addListener(handler);
  } catch {
    return () => {};
  }
  return () => {
    try {
      browser.storage.onChanged.removeListener(handler);
    } catch {
      /* ignore */
    }
  };
}

/* ------------------------------------------------------------------ crypto */

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(digest);
}

/* ------------------------------------------------------------------- flow */

type IdentityApi = {
  getRedirectURL?: (path?: string) => string;
  launchWebAuthFlow?: (details: { url: string; interactive: boolean }) => Promise<string>;
};

function identityApi(): IdentityApi | null {
  const b = browser as unknown as { identity?: IdentityApi };
  if (b.identity?.launchWebAuthFlow) return b.identity;
  const c = typeof chrome !== 'undefined' ? (chrome as unknown as { identity?: IdentityApi }) : null;
  return c?.identity?.launchWebAuthFlow ? c.identity : null;
}

export class SignInUnavailableError extends Error {
  constructor() {
    super(
      'This browser does not support extension sign-in. Sign in at aturi.to instead — ' +
        'everything else in the extension works signed out.',
    );
    this.name = 'SignInUnavailableError';
  }
}

/**
 * Run the sign-in flow.
 *
 * MUST be called from the options page, never from the popup.
 * `launchWebAuthFlow` opens a separate window; the popup loses focus, is
 * destroyed, and the pending promise is collected along with it. The symptom
 * is a flow that works in development — where the popup is often pinned open
 * by devtools — and hangs forever in a real install.
 *
 * v1 requests no scopes at all beyond the base: `?scopes=` empty yields
 * `atproto` plus the AppView read token, and nothing that can write. The
 * extension only reads, and a read-only grant is both a smaller thing to ask
 * of someone and a much easier thing to explain to a store reviewer.
 */
export async function signIn(handle: string): Promise<StoredSession> {
  // Enforced, not merely documented. The failure this prevents is silent and
  // environment-dependent: a popup often survives long enough in development
  // (devtools keeps it open) and never does in a real install, so a wiring
  // mistake here would ship looking fine.
  if (typeof location !== 'undefined' && /popup\.html$/.test(location.pathname)) {
    throw new Error(
      'Sign-in cannot run from the popup — the auth window closes it. ' +
        'Open Settings and use the Account tab.',
    );
  }

  const identity = identityApi();
  if (!identity?.launchWebAuthFlow || !identity.getRedirectURL) {
    throw new SignInUnavailableError();
  }

  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = await challengeFor(verifier);
  const redirectUri = identity.getRedirectURL();

  const params = new URLSearchParams({
    handle: handle.trim(),
    client: 'extension',
    scopes: '',
    challenge,
    return: redirectUri,
  });

  const finalUrl = await identity.launchWebAuthFlow({
    url: `${ATURI_BASE}/api/oauth/login?${params.toString()}`,
    interactive: true,
  });

  // The code comes back in the fragment, which is never sent to a server.
  const hash = finalUrl.includes('#') ? finalUrl.slice(finalUrl.indexOf('#') + 1) : '';
  const returned = new URLSearchParams(hash);
  const code = returned.get('code');
  if (!code) {
    const queryError = new URL(finalUrl).searchParams.get('oauth_error');
    throw new Error(queryError || 'Sign-in was cancelled.');
  }

  const res = await fetch(`${ATURI_BASE}/api/oauth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, verifier }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || 'Could not complete sign-in.');
  }
  const body = (await res.json()) as { token: string; did: string; expiresAt?: string };

  const session: StoredSession = {
    token: body.token,
    did: body.did,
    expiresAt: body.expiresAt ? Date.parse(body.expiresAt) : 0,
  };
  await putSession(session);
  return session;
}

/** End this extension's session. Leaves any browser session on aturi.to alone. */
export async function signOut(): Promise<void> {
  const session = await getSession();
  if (session) {
    await fetch(`${ATURI_BASE}/api/oauth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}` },
    }).catch(() => {
      // The local token is what this browser uses; drop it either way.
    });
  }
  await clearSession();
}

/* ------------------------------------------------------------- authed reads */

export class SessionExpiredError extends Error {
  constructor() {
    super('Your aturi.to sign-in has expired. Sign in again.');
    this.name = 'SessionExpiredError';
  }
}

/**
 * One authenticated XRPC read, through aturi.to's proxy.
 *
 * A definitive rejection clears the stored token so the UI stops claiming to
 * be signed in. A transient failure deliberately does not — reporting a
 * network blip as a sign-out is how a flaky connection becomes a support
 * ticket.
 */
export async function xrpcGet<T>(
  nsid: string,
  params: Record<string, string>,
): Promise<T> {
  const session = await getSession();
  if (!session) throw new SessionExpiredError();

  const query = new URLSearchParams(params).toString();
  const res = await fetch(
    `${ATURI_BASE}/api/oauth/xrpc/${encodeURIComponent(nsid)}${query ? `?${query}` : ''}`,
    { headers: { authorization: `Bearer ${session.token}` } },
  );

  if (res.status === 401) {
    // Only the proxy's own auth failures mean the session is over; a 401 it
    // relayed from the PDS is about the record, not the session.
    const code = res.headers.get('x-aturi-oauth-error');
    if (code === 'SESSION_INVALID' || code === 'GRANT_MISSING') {
      await clearSession();
      throw new SessionExpiredError();
    }
  }
  if (!res.ok) throw new Error(`${nsid} failed (${res.status})`);
  return (await res.json()) as T;
}
