'use client';

/**
 * The client-side face of a backend session.
 *
 * The whole migration rests on this being small. `@atproto/api`'s Agent
 * constructor accepts a bare fetch handler — verified in the SDK's own
 * `agent.ts`, whose first argument is `SessionManager | FetchHandler |
 * FetchHandlerOptions` — so one object that answers `fetchHandler` satisfies
 * `new Agent(...)`, the space layer's `oauthTransport()`, and the
 * `OwnPdsFetch` type all at once.
 *
 * The alternative, which the reference frontend took because its backend
 * proxies by method name rather than by path, is to hand-mimic the Agent
 * surface method by method. That file is 2,175 lines. This one is under a
 * hundred, and every existing call site in the app keeps working untouched.
 */

import type { AtSession } from './session';

/** What `/api/oauth/session` answers with. */
export type BffSessionInfo = {
  did: string;
  client: 'web' | 'extension';
  scope: string | null;
  pds: string | null;
  grantMissing: boolean;
};

export type BffSessionOptions = {
  /**
   * Present only where a cookie cannot be used: the extension, and local
   * development pointed at a deployed backend. On aturi.to itself the session
   * is a same-origin HttpOnly cookie and is never readable from script.
   */
  bearer?: string;
  /** Called when the backend reports the session is definitively gone. */
  onInvalid?: () => void;
};

/** Where the backend lives. Same origin in the app; absolute for the extension. */
export function bffOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_BFF_ORIGIN;
  if (configured) return configured.replace(/\/+$/, '');
  return typeof window === 'undefined' ? '' : window.location.origin;
}

function authHeaders(bearer?: string): Record<string, string> {
  return bearer ? { authorization: `Bearer ${bearer}` } : {};
}

/**
 * Headers worth forwarding from an SDK-issued request.
 *
 * `atproto-proxy` matters more than it looks: `agent.withProxy(...)` sets it,
 * and it is what makes the AppView return viewer state. Dropping it yields a
 * clean 200 with an empty `viewer`, so the relationship strip renders and
 * silently never shows mutual-follow state — a failure with no error anywhere.
 */
const FORWARD_HEADERS = ['content-type', 'accept', 'accept-language', 'atproto-proxy', 'atproto-accept-labelers'];

/**
 * Header the backend stamps on its own error bodies, naming the failure code.
 * Kept in step with ERROR_CODE_HEADER in src/lib/oauth/server/http.ts.
 */
const ERROR_CODE_HEADER = 'x-aturi-oauth-error';

/** Codes that mean this session is over. `SESSION_TRANSIENT` deliberately is not. */
const SESSION_ENDED = new Set(['SESSION_INVALID', 'GRANT_MISSING']);

function reportIfSessionEnded(res: Response, onInvalid?: () => void): void {
  if (!onInvalid) return;
  const code = res.headers.get(ERROR_CODE_HEADER);
  if (code && SESSION_ENDED.has(code)) onInvalid();
}

function pickHeaders(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init?.headers) return out;
  const h = new Headers(init.headers as HeadersInit);
  for (const name of FORWARD_HEADERS) {
    const v = h.get(name);
    if (v) out[name] = v;
  }
  return out;
}

/**
 * Build a session object the rest of the app can treat as an OAuthSession.
 */
export function createBffSession(info: BffSessionInfo, opts: BffSessionOptions = {}): AtSession {
  const origin = bffOrigin();

  const fetchHandler = async (path: string, init?: RequestInit): Promise<Response> => {
    // The SDK hands us `/xrpc/<nsid>?<query>`. Split it and rebuild against
    // our own route, so the NSID travels as a path segment the server owns
    // rather than as a string it concatenates.
    const [rawPath, query = ''] = path.split('?');
    const nsid = rawPath.replace(/^\/*(xrpc\/)?/, '');

    // The one special case, and it is deliberate: minting a space delegation
    // token is consent-gated and cannot sit in the generic proxy's allowlist
    // (see the route's own note). Routing it here is what keeps
    // spaceCredential.ts, spaceDpop.ts and spaceClient.ts at zero diff.
    if (nsid === 'com.atproto.space.getDelegationToken') {
      const space = new URLSearchParams(query).get('space') ?? '';
      const minted = await fetch(`${origin}/api/oauth/space/delegation-token`, {
        method: 'POST',
        credentials: opts.bearer ? 'omit' : 'same-origin',
        headers: { 'content-type': 'application/json', ...authHeaders(opts.bearer) },
        body: JSON.stringify({ space }),
      });
      reportIfSessionEnded(minted, opts.onInvalid);
      return minted;
    }

    const url = `${origin}/api/oauth/xrpc/${encodeURIComponent(nsid)}${query ? `?${query}` : ''}`;
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      credentials: opts.bearer ? 'omit' : 'same-origin',
      headers: { ...pickHeaders(init), ...authHeaders(opts.bearer) },
      body: init?.body,
      signal: init?.signal,
    });

    // Only OUR OWN auth failures end the session. A bare 401 here could just
    // as easily be the PDS answering about one record; signing the user out of
    // the whole app for that would be a permission error turning into a
    // logout. The header is set by the backend's `fail()` and never appears on
    // a relayed upstream response.
    reportIfSessionEnded(res, opts.onInvalid);

    return res;
  };

  return {
    sub: info.did,
    did: info.did,
    fetchHandler,
    // Answered from what the backend already read off the grant row, so
    // nothing here costs a token refresh or a PDS round trip. The browser
    // client's equivalent reads the cached token and can surface a refresh
    // failure just to answer a question about capabilities.
    getTokenInfo: async () => ({ scope: info.scope ?? undefined, aud: info.pds ?? undefined }),
    signOut: async () => {
      await fetch(`${origin}/api/oauth/logout`, {
        method: 'POST',
        credentials: opts.bearer ? 'omit' : 'same-origin',
        headers: authHeaders(opts.bearer),
      }).catch(() => {});
    },
  };
}

/** Read the current backend session, if any. */
export async function fetchBffSession(
  bearer?: string,
): Promise<
  | { status: 'ok'; info: BffSessionInfo }
  | { status: 'signed-out' }
  | { status: 'unavailable' }
> {
  try {
    const res = await fetch(`${bffOrigin()}/api/oauth/session`, {
      credentials: bearer ? 'omit' : 'same-origin',
      headers: authHeaders(bearer),
    });
    if (res.status === 401) return { status: 'signed-out' };
    if (!res.ok) return { status: 'unavailable' };
    const body = (await res.json()) as BffSessionInfo & { ok?: boolean };
    if (!body.did) return { status: 'signed-out' };
    return { status: 'ok', info: body };
  } catch {
    // A network failure is not a sign-out. Saying otherwise here is how a
    // flaky connection turns into an unexpected logout.
    return { status: 'unavailable' };
  }
}

/**
 * Tell the backend the user agreed to contact a space authority.
 *
 * The browser keeps its own set of unlocked authorities and always has — that
 * set is what drives the UI. This is the enforcement half: once minting a
 * delegation token is an endpoint rather than an in-page call, anything
 * holding a session token can reach it, and an in-memory set in one tab bounds
 * nothing. So the click is recorded server-side and the mint endpoint checks
 * there.
 *
 * Awaited by its caller before the in-memory unlock lands, because the unlock
 * is what re-runs the effect that mints — record it second and the mint can
 * arrive first and be refused. Failures are swallowed: on a deployment with no
 * backend this 404s, and the browser-only flow is correct as it stands.
 */
export async function recordSpaceConsent(authority: string, bearer?: string): Promise<void> {
  await fetch(`${bffOrigin()}/api/oauth/space/consent`, {
    method: 'POST',
    credentials: bearer ? 'omit' : 'same-origin',
    headers: { 'content-type': 'application/json', ...authHeaders(bearer) },
    body: JSON.stringify({ authority }),
  }).catch(() => {});
}

/**
 * Start a backend sign-in by navigating to it. Returns nothing: on success the
 * browser leaves this page.
 */
export function startBffSignIn(handle: string, ids: string[], returnTo: string): void {
  const params = new URLSearchParams({
    handle,
    client: 'web',
    scopes: ids.join(','),
    return: returnTo,
  });
  window.location.href = `${bffOrigin()}/api/oauth/login?${params.toString()}`;
}
