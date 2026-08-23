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
import { getOauthClient, getOauthEvents } from '@/lib/oauth/client';
import { resolveAuthMode, hasSignedInHint } from '@/lib/oauth/authMode';
import { createBffSession, fetchBffSession, startBffSignIn } from '@/lib/oauth/bffSession';
import type { AtSession } from '@/lib/oauth/session';
import {
  DEFAULT_SCOPE_IDS,
  buildScopeString,
  scopeIdsFromString,
  spaceGrantLevel,
} from '@/lib/oauth/scopes';
import { clearSpaceCredentials } from '@/utils/atproto/spaceCredential';

type SessionContextValue = {
  session: AtSession | null;
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
 *
 * Two OAuth clients live behind this one interface: the original public
 * browser client, and — when the deployment is configured for it — a
 * confidential backend client whose tokens never reach the browser. Bootstrap
 * prefers an existing browser session over starting a backend one, so nobody
 * signed in today is logged out or forced to re-authorize by the migration.
 * Which client a NEW sign-in uses is `NEXT_PUBLIC_AUTH_MODE`; see authMode.ts.
 */
export function AtprotoSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AtSession | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [grantedScope, setGrantedScope] = useState<string | null>(null);
  const [pds, setPds] = useState<string | null>(null);
  const [mode] = useState(resolveAuthMode);

  useEffect(() => {
    let cancelled = false;

    const dropSession = (sub?: string) => {
      // Space credentials are minted against a delegation token from one
      // account's PDS, so they must never outlive that account's session —
      // including when it goes away underneath us (revoked elsewhere, account
      // switch). They live in memory only, so this is the whole cleanup.
      clearSpaceCredentials();
      setSession((current) => (!sub || (current && current.sub === sub) ? null : current));
    };

    (async () => {
      try {
        // Backend session first, but only when there is a hint that one
        // exists. The hint carries no secret; without it every anonymous
        // visitor would pay a serverless round trip on every page load before
        // the UI could decide anyone is signed out.
        if (mode === 'bff' && hasSignedInHint()) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const result = await fetchBffSession();
            if (cancelled) return;
            if (result.status === 'ok') {
              setSession(
                createBffSession(result.info, { onInvalid: () => dropSession() }),
              );
              setGrantedScope(result.info.scope);
              setPds(result.info.pds);
              return;
            }
            if (result.status === 'signed-out') break;
            // `unavailable` is a cold start or a database hiccup, NOT a
            // sign-out. Retrying rather than clearing is what stops a
            // momentary blip becoming a mass logout.
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          }
          if (cancelled) return;
        }

        const client = await getOauthClient();
        const result = await client.init();
        if (cancelled) return;
        if (result && 'session' in result && result.session) {
          setSession(result.session as unknown as AtSession);
        }
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const events = getOauthEvents();
    const onDeleted = (event: Event) => {
      dropSession((event as CustomEvent<{ sub?: string }>).detail?.sub);
    };
    events.addEventListener('deleted', onDeleted);
    return () => {
      cancelled = true;
      events.removeEventListener('deleted', onDeleted);
    };
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setAgent(null);
      return undefined;
    }
    import('@atproto/api')
      .then(({ Agent }) => {
        if (cancelled) return;
        // Both session shapes are structurally SessionManagers — an object
        // carrying `did` and `fetchHandler` — which is exactly what the Agent
        // constructor accepts.
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
   * `aud`) off the current session.
   *
   * `getTokenInfo(false)` is deliberate for the browser client: `false` reads
   * whatever is cached and never refreshes. Passing `undefined` or `'auto'`
   * would let a page load spend a refresh round trip — and, worse, surface a
   * refresh failure — just to answer a question about capabilities. The
   * backend client already answered both at bootstrap, from a stored row.
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

  /**
   * Dispatching here rather than in the sign-in hook is what makes the
   * migration one file instead of several: three surfaces call this directly
   * (the hook, the account tab, and the spaces landing page), and patching the
   * hook alone would leave two of them still minting legacy sessions.
   *
   * The backend takes a closed set of permission ids, never a scope string —
   * an open string reaching `authorize()` is a privilege-escalation surface.
   * Callers keep passing the string they always did and it is inverted here;
   * see `scopeIdsFromString`.
   */
  const signIn = useCallback(
    async (input: string, scope?: string) => {
      // The fallback is the picker's default set, not METADATA_SCOPE: the
      // metadata string is the declared superset and now carries both `space:`
      // tokens, so defaulting to it would send a caller that omitted the
      // argument to a consent screen asking for whole-space read of every
      // space, with no box having been ticked.
      const scopeString = scope ?? buildScopeString(DEFAULT_SCOPE_IDS);

      if (mode === 'bff') {
        const ids = scope ? scopeIdsFromString(scope) : DEFAULT_SCOPE_IDS;
        const returnTo =
          window.location.pathname + window.location.search + window.location.hash;
        startBffSignIn(input, [...ids], returnTo);
        // The browser navigates away; nothing after this runs.
        return;
      }

      const client = await getOauthClient();
      await client.signIn(input, { scope: scopeString });
    },
    [mode],
  );

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
