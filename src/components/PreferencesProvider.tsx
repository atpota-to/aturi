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

type PreferencesContextValue = {
  prefs: Preferences;
  /**
   * Replace the prefs with a new value. Always writes localStorage
   * synchronously; debounces a PDS write when signed in.
   */
  update: (updater: (prev: Preferences) => Preferences) => void;
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

  // Step 1: hydrate from localStorage on mount.
  useEffect(() => {
    setPrefs(readLocalPreferences());
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
          local.customWaypoints.length > 0 ||
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
    () => ({ prefs, update, reset, loading, pdsSync }),
    [prefs, update, reset, loading, pdsSync],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return v;
}
