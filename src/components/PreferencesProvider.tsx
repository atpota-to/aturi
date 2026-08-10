'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_PREFERENCES,
  preferencesAreEqual,
  readLocalPreferences,
  writeLocalPreferences,
  type Preferences,
} from '@/utils/preferences';
import {
  pickNewer,
  readPreferencesFromPds,
  writePreferencesToPds,
} from '@/utils/atproto/preferencesPds';
import { useAtprotoSession } from './AtprotoSessionProvider';

/**
 * Outcome of an explicit `flush()`:
 *   - `saved`: the PDS write landed.
 *   - `local`: nobody's signed in, so localStorage is the only home for now.
 *   - `error`: the write was attempted and failed.
 */
export type FlushResult = 'saved' | 'local' | 'error';

type PreferencesContextValue = {
  prefs: Preferences;
  /**
   * Replace the prefs with a new value. Always writes localStorage
   * synchronously; debounces a PDS write when signed in.
   */
  update: (updater: (prev: Preferences) => Preferences) => void;
  /**
   * Write pending changes to the PDS *now*, skipping the debounce, and
   * resolve once the write settles. For flows that want to tell the user
   * their choices are saved (the guided setup's closing step) rather than
   * leaving a write in flight as they navigate away.
   */
  flush: () => Promise<FlushResult>;
  /** Drop user prefs back to defaults (local only — does NOT delete the PDS record). */
  reset: () => void;
  /** True until the first read (local + PDS if signed in) has settled. */
  loading: boolean;
  /** PDS sync state. `null` for anonymous users. */
  pdsSync: 'idle' | 'syncing' | 'error' | null;
};

const Ctx = createContext<PreferencesContextValue | null>(null);

const PDS_WRITE_DEBOUNCE_MS = 1500;

/**
 * Local-first preferences with PDS mirror when signed in.
 *
 * Lifecycle:
 *
 *   - Mount: read localStorage into state. `loading = true` only during a
 *     PDS read (anonymous users settle in one tick).
 *   - Sign in: read PDS prefs. Merge with local (newer wins). If local was
 *     newer (or PDS was missing), write back to PDS so the cross-device
 *     copy catches up.
 *   - Sign out: drop the agent — keep local prefs in place so anonymous
 *     customization persists.
 *   - Every update(): write local immediately, schedule a debounced PDS
 *     write if signed in.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { agent, did, loading: sessionLoading } = useAtprotoSession();
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [pdsSync, setPdsSync] = useState<PreferencesContextValue['pdsSync']>(null);
  const pdsWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedDid = useRef<string | null>(null);
  // Newest prefs, readable synchronously. `flush()` is typically called in the
  // same tick as the `update()` whose result it means to save, and React state
  // hasn't re-rendered by then.
  const latestPrefs = useRef<Preferences>(DEFAULT_PREFERENCES);

  // Step 1: hydrate from localStorage on mount.
  useEffect(() => {
    const local = readLocalPreferences();
    latestPrefs.current = local;
    setPrefs(local);
    setLoading(false);
  }, []);

  // Step 2: when the session resolves, reconcile with PDS prefs.
  useEffect(() => {
    if (sessionLoading) return;
    if (!agent || !did) {
      // Anonymous (or signed out) — no PDS sync, local prefs stand.
      setPdsSync(null);
      lastSyncedDid.current = null;
      return;
    }
    // Avoid re-running for the same DID (session reload shouldn't reset prefs).
    if (lastSyncedDid.current === did) return;
    lastSyncedDid.current = did;

    let cancelled = false;
    setPdsSync('syncing');
    setLoading(true);

    (async () => {
      const local = readLocalPreferences();
      const result = await readPreferencesFromPds(agent, did);
      if (cancelled) return;

      if (result.status === 'error') {
        setPdsSync('error');
        // Local prefs stand for now; we'll retry on the next session change.
      } else if (result.status === 'missing') {
        // Nothing in the PDS yet — push the local copy up so the user's
        // anonymous customization carries over to other devices. Only
        // bother if they've actually customized something locally; an
        // unmodified default doesn't need to land on the PDS yet.
        const hasLocalCustomization =
          local.colorScheme !== DEFAULT_PREFERENCES.colorScheme ||
          local.customWaypoints.length > 0 ||
          local.preferredClients.length > 0 ||
          local.onboarding.completedVersion > 0 ||
          local.hiddenWaypoints.length > 0 ||
          local.waypointOrder.length > 0 ||
          JSON.stringify(local.waypointGroups) !==
            JSON.stringify(DEFAULT_PREFERENCES.waypointGroups);
        if (hasLocalCustomization) {
          try {
            await writePreferencesToPds(agent, did, local);
            if (!cancelled) setPdsSync('idle');
          } catch {
            if (!cancelled) setPdsSync('error');
          }
        } else {
          setPdsSync('idle');
        }
        // Local already matches state, so no state update needed.
      } else {
        // Both exist — pick the newer copy.
        const winning = pickNewer(local, result.prefs);
        latestPrefs.current = winning;
        if (!preferencesAreEqual(prefs, winning)) {
          setPrefs(winning);
          writeLocalPreferences(winning);
        }
        // If local won, push back up to PDS.
        if (winning === local && !preferencesAreEqual(local, result.prefs)) {
          try {
            await writePreferencesToPds(agent, did, local);
          } catch {
            if (!cancelled) setPdsSync('error');
            return;
          }
        }
        if (!cancelled) setPdsSync('idle');
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // We don't depend on `prefs` here — that would re-sync on every local edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, did, sessionLoading]);

  const update = useCallback(
    (updater: (prev: Preferences) => Preferences) => {
      setPrefs((prev) => {
        const next = { ...updater(prev), updatedAt: new Date().toISOString() };
        latestPrefs.current = next;
        writeLocalPreferences(next);
        // Debounce PDS write — burst edits (DnD reorder, typing) collapse
        // into a single network call.
        if (agent && did) {
          if (pdsWriteTimer.current) clearTimeout(pdsWriteTimer.current);
          pdsWriteTimer.current = setTimeout(async () => {
            setPdsSync('syncing');
            try {
              await writePreferencesToPds(agent, did, next);
              setPdsSync('idle');
            } catch {
              setPdsSync('error');
            }
          }, PDS_WRITE_DEBOUNCE_MS);
        }
        return next;
      });
    },
    [agent, did],
  );

  const flush = useCallback(async (): Promise<FlushResult> => {
    if (pdsWriteTimer.current) {
      clearTimeout(pdsWriteTimer.current);
      pdsWriteTimer.current = null;
    }
    if (!agent || !did) return 'local';
    setPdsSync('syncing');
    try {
      await writePreferencesToPds(agent, did, latestPrefs.current);
      setPdsSync('idle');
      return 'saved';
    } catch {
      setPdsSync('error');
      return 'error';
    }
  }, [agent, did]);

  const reset = useCallback(() => {
    update(() => ({ ...DEFAULT_PREFERENCES, updatedAt: new Date().toISOString() }));
  }, [update]);

  // Flush pending PDS write on unmount.
  useEffect(() => {
    return () => {
      if (pdsWriteTimer.current) clearTimeout(pdsWriteTimer.current);
    };
  }, []);

  const value = useMemo<PreferencesContextValue>(
    () => ({ prefs, update, flush, reset, loading, pdsSync }),
    [prefs, update, flush, reset, loading, pdsSync],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return v;
}
