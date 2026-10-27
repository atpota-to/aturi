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
import { useAtprotoSession } from './AtprotoSessionProvider';
import {
  readPreferredClientsFromPds,
  type PreferredClientsReadResult,
} from '@/utils/atproto/preferredClientsPds';
import {
  parsePreferredClients,
  type PreferredClientsRecord,
} from '@/utils/preferredClients';

/**
 * The signed-in account's `to.aturi.actor.preferredClients` declaration,
 * shared by the Clients tab, which edits it, and auto-redirect, which follows
 * it. One read per session, and a publish from the tab reaches the redirect
 * without a second one.
 *
 * A copy is kept in localStorage, tagged with the DID it belongs to, for the
 * same reason `AutoRedirectSync` keeps its cache: the OAuth session restores
 * from IndexedDB long after a waypoint page has painted, and a declaration
 * that only exists once the PDS answers would make every cold load miss it.
 * The copy stands in until the read lands and is dropped on sign-out, so a
 * shared browser never redirects the next person by someone else's record.
 */

const CACHE_KEY = 'aturi.preferredClients.v1';

type CachedDeclaration = { did: string; record: PreferredClientsRecord };

export type PreferredClientsLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | PreferredClientsReadResult;

type PreferredClientsContextValue = {
  /**
   * The declaration to act on: the PDS copy once it has been read, the cached
   * copy until then. Null when signed out or nothing is declared.
   */
  record: PreferredClientsRecord | null;
  /**
   * The PDS read itself. Something that edits the declaration waits for this
   * rather than trusting `record`, which may still be the cached copy.
   */
  load: PreferredClientsLoad;
  /** Record a publish (or, with null, a removal) without reading it back. */
  setPublished: (record: PreferredClientsRecord | null) => void;
};

const Ctx = createContext<PreferredClientsContextValue | null>(null);

function readCache(): CachedDeclaration | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { did?: unknown; record?: unknown } | null;
    if (typeof parsed?.did !== 'string') return null;
    const record = parsePreferredClients(parsed.record);
    return record ? { did: parsed.did, record } : null;
  } catch {
    return null;
  }
}

function writeCache(value: CachedDeclaration | null): void {
  try {
    if (value) window.localStorage.setItem(CACHE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // Storage disabled or full: the PDS read still works, it just can't help
    // the next cold load.
  }
}

export function PreferredClientsProvider({ children }: { children: ReactNode }) {
  const { agent, did, loading: sessionLoading } = useAtprotoSession();
  // Read during the first client render rather than in an effect: nothing
  // that consumes this renders on the server, and the whole point of the copy
  // is to be there before the session is.
  const [cached, setCached] = useState<CachedDeclaration | null>(() =>
    typeof window === 'undefined' ? null : readCache(),
  );
  // Tagged with the account it answers for, so the load state below is
  // derived from the session rather than reset by hand when it changes.
  const [fetched, setFetched] = useState<{
    did: string;
    result: PreferredClientsReadResult;
  } | null>(null);

  useEffect(() => {
    if (sessionLoading) return undefined;
    if (!agent || !did) {
      writeCache(null);
      return undefined;
    }
    let cancelled = false;
    readPreferredClientsFromPds(agent, did).then((result) => {
      if (cancelled) return;
      setFetched({ did, result });
      if (result.status === 'ok') {
        const next = { did, record: result.record };
        setCached(next);
        writeCache(next);
      } else if (result.status === 'missing' || result.status === 'invalid') {
        setCached(null);
        writeCache(null);
      }
      // On a transport error the cached copy, if it is this account's, stands.
    });
    return () => {
      cancelled = true;
    };
  }, [agent, did, sessionLoading]);

  const load = useMemo<PreferredClientsLoad>(() => {
    if (!did) return { status: 'idle' };
    return fetched && fetched.did === did ? fetched.result : { status: 'loading' };
  }, [did, fetched]);

  const setPublished = useCallback(
    (record: PreferredClientsRecord | null) => {
      if (!did) return;
      setFetched({ did, result: record ? { status: 'ok', record } : { status: 'missing' } });
      const next = record ? { did, record } : null;
      setCached(next);
      writeCache(next);
    },
    [did],
  );

  const record = useMemo(() => {
    if (load.status === 'ok') return load.record;
    if (load.status === 'missing' || load.status === 'invalid') return null;
    if (!cached) return null;
    // While the session is still restoring there is no DID to check against;
    // the cache is cleared on sign-out, so what it holds is the last account
    // signed in on this browser.
    if (did) return cached.did === did ? cached.record : null;
    return sessionLoading ? cached.record : null;
  }, [load, cached, did, sessionLoading]);

  const value = useMemo<PreferredClientsContextValue>(
    () => ({ record, load, setPublished }),
    [record, load, setPublished],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferredClients(): PreferredClientsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePreferredClients must be used inside <PreferredClientsProvider>');
  return v;
}
