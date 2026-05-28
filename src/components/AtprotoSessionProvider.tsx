'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Agent } from '@atproto/api';
import type { OAuthSession } from '@atproto/oauth-client-browser';
import type { BackendSession } from '@/lib/oauth/backendClient';
import { getOauthClient, getOauthEvents } from '@/lib/oauth/client';
import { METADATA_SCOPE } from '@/lib/oauth/scopes';

/**
 * Selects the confidential backend OAuth flow (long-lived sessions via the BFF
 * at /api/oauth/*) over the client-side BrowserOAuthClient. Build-time constant
 * so the unused path is tree-shaken. Defaults to the browser flow.
 */
const USE_BACKEND_OAUTH = process.env.NEXT_PUBLIC_USE_BACKEND_OAUTH === 'true';

/**
 * Either OAuth flow yields a "session" object the rest of the app treats as an
 * opaque truthy value and reads `sub` from. The backend flow's object is a thin
 * `{ did, sub }`; the browser flow's is a full OAuthSession.
 */
type SessionLike = OAuthSession | BackendSession;

type SessionContextValue = {
  session: SessionLike | null;
  agent: Agent | null;
  did: string | null;
  loading: boolean;
  error: Error | null;
  /**
   * Kick off the OAuth flow. `scope` is the runtime-requested scope string
   * (must be a subset of METADATA_SCOPE); defaults to the full superset
   * if the caller doesn't pass one (e.g. legacy entry points).
   */
  signIn: (input: string, scope?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<SessionContextValue | null>(null);

/**
 * Provides ATProto OAuth session state to the explorer subtree.
 *
 *   const { session, agent, did, signIn, signOut, loading } = useAtprotoSession();
 *
 * Two interchangeable backends select on `NEXT_PUBLIC_USE_BACKEND_OAUTH`:
 *
 *   - Browser (default): `@atproto/oauth-client-browser`, tokens in IndexedDB,
 *     `agent` is a lazily-imported `@atproto/api` Agent wrapping the session.
 *   - Backend: a long-lived opaque token in localStorage; `agent` is a proxy
 *     that routes calls through the same-origin /api/oauth/proxy BFF.
 *
 * Both expose the identical context shape, so consumers don't care which is
 * active.
 */
export function AtprotoSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionLike | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Backend (confidential) flow: restore from the opaque token / OAuth
    // callback params, and build the proxy agent up front.
    if (USE_BACKEND_OAUTH) {
      (async () => {
        try {
          const { getBackendClient } = await import('@/lib/oauth/backendClient');
          const client = getBackendClient();
          const result = await client.initialize();
          if (cancelled) return;
          if (result) {
            setSession(result);
            setAgent(client.createProxyAgent());
          }
        } catch (err) {
          if (!cancelled) setError(err as Error);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    // Browser (public) flow.
    (async () => {
      try {
        const client = await getOauthClient();
        const result = await client.init();
        if (cancelled) return;
        if (result && 'session' in result && result.session) {
          setSession(result.session);
        }
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const events = getOauthEvents();
    const onDeleted = (event: Event) => {
      const detail = (event as CustomEvent<{ sub?: string }>).detail;
      const sub = detail?.sub;
      setSession((current) => (current && current.sub === sub ? null : current));
    };
    events.addEventListener('deleted', onDeleted);
    return () => {
      cancelled = true;
      events.removeEventListener('deleted', onDeleted);
    };
  }, []);

  useEffect(() => {
    // In backend mode the proxy agent is created during init() and never needs
    // the @atproto/api Agent, so this effect is a no-op.
    if (USE_BACKEND_OAUTH) return undefined;

    let cancelled = false;
    if (!session) {
      setAgent(null);
      return undefined;
    }
    import('@atproto/api')
      .then(({ Agent }) => {
        if (cancelled) return;
        // OAuthSession is shaped like an XRPC client; @atproto/api's Agent
        // accepts it directly.
        setAgent(new Agent(session as unknown as ConstructorParameters<typeof Agent>[0]));
      })
      .catch((err) => {
        if (!cancelled) setError(err as Error);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const signIn = useCallback(async (input: string, scope?: string) => {
    if (USE_BACKEND_OAUTH) {
      const { getBackendClient } = await import('@/lib/oauth/backendClient');
      await getBackendClient().signIn(input, scope ?? METADATA_SCOPE);
      return;
    }
    const client = await getOauthClient();
    await client.signIn(input, { scope: scope ?? METADATA_SCOPE });
  }, []);

  const signOut = useCallback(async () => {
    if (USE_BACKEND_OAUTH) {
      try {
        const { getBackendClient } = await import('@/lib/oauth/backendClient');
        await getBackendClient().signOut();
      } catch {
        // ignore — we still drop local state
      }
      setSession(null);
      setAgent(null);
      return;
    }

    if (!session) return;
    try {
      await (session as OAuthSession).signOut();
    } catch {
      // ignore network errors on revoke; we still drop local state
    }
    setSession(null);
  }, [session]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      agent,
      did: session?.sub || null,
      loading: loading || (Boolean(session) && !agent),
      error,
      signIn,
      signOut,
    }),
    [session, agent, loading, error, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAtprotoSession(): SessionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAtprotoSession must be used inside <AtprotoSessionProvider>');
  return v;
}
