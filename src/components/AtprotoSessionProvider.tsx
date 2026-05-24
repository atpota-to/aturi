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
import { getOauthClient, getOauthEvents, OAUTH_SCOPE } from '@/lib/oauth/client';

type SessionContextValue = {
  session: OAuthSession | null;
  agent: Agent | null;
  did: string | null;
  loading: boolean;
  error: Error | null;
  signIn: (input: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<SessionContextValue | null>(null);

/**
 * Provides ATProto OAuth session state to the explorer subtree.
 *
 *   const { session, agent, did, signIn, signOut, loading } = useAtprotoSession();
 *
 * `agent` is lazy-loaded from `@atproto/api` only when a session exists, so
 * the SDK (~200KB gzipped) is never on the cold-visit critical path.
 */
export function AtprotoSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<OAuthSession | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

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

  const signIn = useCallback(async (input: string) => {
    const client = await getOauthClient();
    await client.signIn(input, { scope: OAUTH_SCOPE });
  }, []);

  const signOut = useCallback(async () => {
    if (!session) return;
    try {
      await session.signOut();
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
