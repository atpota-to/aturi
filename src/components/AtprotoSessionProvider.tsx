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
import { getOauthClient, getOauthEvents } from '@/lib/oauth/client';
import { DEFAULT_SCOPE_IDS, buildScopeString, spaceGrantLevel } from '@/lib/oauth/scopes';
import { clearSpaceCredentials } from '@/utils/atproto/spaceCredential';

type SessionContextValue = {
  session: OAuthSession | null;
  agent: Agent | null;
  did: string | null;
  loading: boolean;
  error: Error | null;
  /**
   * Kick off the OAuth flow. `scope` is the runtime-requested scope string
   * (must be a subset of METADATA_SCOPE); defaults to the picker's own
   * defaults if the caller doesn't pass one (e.g. legacy entry points).
   */
  signIn: (input: string, scope?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * The scope the authorization server actually granted, space-separated.
   * Null while it hasn't been read yet, or when reading it failed.
   */
  grantedScope: string | null;
  /**
   * Strongest permissioned-data grant that survived authorization. Null means
   * the server stripped or refused the `space:` token — there is no
   * pre-flight capability signal in atproto OAuth, so this is the only way to
   * know, and every space affordance is gated on it.
   */
  spaceGrant: 'read' | 'read_self' | null;
  /** The user's PDS, taken from the access token's `aud`. */
  pds: string | null;
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
  const [grantedScope, setGrantedScope] = useState<string | null>(null);
  const [pds, setPds] = useState<string | null>(null);

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
      // Space credentials are minted against a delegation token from one
      // account's PDS, so they must never outlive that account's session —
      // including when it goes away underneath us (revoked elsewhere, account
      // switch). They live in memory only, so this is the whole cleanup.
      clearSpaceCredentials();
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

  /**
   * Read the granted scope (and the PDS, which rides along as the token's
   * `aud`) off the current token.
   *
   * `getTokenInfo(false)` is deliberate: `false` reads whatever is cached and
   * never refreshes. Passing `undefined` or `'auto'` would let a page load
   * spend a refresh round trip — and, worse, surface a refresh failure — just
   * to answer a question about capabilities.
   */
  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setGrantedScope(null);
      setPds(null);
      return undefined;
    }
    session
      .getTokenInfo(false)
      .then((info) => {
        if (cancelled) return;
        setGrantedScope(info.scope || null);
        setPds(info.aud || null);
      })
      .catch(() => {
        // An unreadable token tells us nothing about what was granted, and
        // "unknown" and "not granted" get the same treatment downstream.
        if (cancelled) return;
        setGrantedScope(null);
        setPds(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const signIn = useCallback(async (input: string, scope?: string) => {
    const client = await getOauthClient();
    // The fallback is the picker's default set, not METADATA_SCOPE: the
    // metadata string is the declared superset and now carries both `space:`
    // tokens, so defaulting to it would send a caller that omitted the argument
    // to a consent screen asking for whole-space read of every space, with no
    // box having been ticked. This string is byte-identical to what the app
    // requested before spaces existed.
    await client.signIn(input, { scope: scope ?? buildScopeString(DEFAULT_SCOPE_IDS) });
  }, []);

  const signOut = useCallback(async () => {
    if (!session) return;
    // Drop space credentials first: they authorize reads of other members'
    // private records and are only ever held in memory, so signing out has to
    // take them with it even if the revoke call below fails.
    clearSpaceCredentials();
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
      grantedScope,
      spaceGrant: spaceGrantLevel(grantedScope),
      pds,
    }),
    [session, agent, loading, error, signIn, signOut, grantedScope, pds],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAtprotoSession(): SessionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAtprotoSession must be used inside <AtprotoSessionProvider>');
  return v;
}
