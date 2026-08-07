'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { usePreferences } from '@/components/PreferencesProvider';
import { setPublishPreferredClients } from '@/utils/preferences';
import {
  deletePreferredClientsFromPds,
  readPreferredClientsFromPds,
  writePreferredClientsToPds,
} from '@/utils/atproto/preferredClientsPds';
import type { PreferredClientsRecord } from '@/utils/preferredClients';

export type PublishState =
  | 'anonymous' // not signed in — nothing to publish to
  | 'off' // signed in, publishing not enabled
  | 'checking' // reading the current record
  | 'empty' // publishing on, but no rules to declare
  | 'publishing'
  | 'published'
  | 'removing'
  | 'error';

export type PreferredClientsPublisher = {
  state: PublishState;
  error: string | null;
  /** The record currently on the PDS, once we've looked. */
  remote: PreferredClientsRecord | null;
  /** Turn publishing on (writes the record) or off (deletes it). */
  setPublishing: (next: boolean) => void;
};

const PUBLISH_DEBOUNCE_MS = 1200;

/**
 * Keeps the public `to.aturi.actor.preferredClients/self` record in step with
 * the user's local rules, but only while they've asked for it.
 *
 * Publishing is treated differently from the rest of settings sync on purpose:
 * this record is read by other people's software, so turning it on and off is
 * an explicit act, and turning it off *withdraws* the record rather than
 * leaving a stale declaration behind. Deleting every rule does the same — an
 * empty declaration and no declaration mean the same thing to a reader, and
 * the honest one is to not be there.
 */
export function usePreferredClientsPublisher(): PreferredClientsPublisher {
  const { agent, did } = useAtprotoSession();
  const { prefs, update } = usePreferences();
  const [state, setState] = useState<PublishState>('anonymous');
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<PreferredClientsRecord | null>(null);

  const publishing = prefs.publishPreferredClients;
  const rules = prefs.preferredClients;
  // Serialized rules drive the sync effect, so a re-render with an
  // equal-but-new array doesn't schedule a redundant write.
  const rulesKey = JSON.stringify(rules);

  const lastWritten = useRef<string | null>(null);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Look up what's already on the PDS once per session: it tells us the real
  // published state (which beats the synced flag — the user may have published
  // from a device this one hasn't heard from) and gives us the original
  // `createdAt` to preserve on update.
  useEffect(() => {
    if (!agent || !did) {
      setState('anonymous');
      setRemote(null);
      lastWritten.current = null;
      return;
    }
    let cancelled = false;
    setState('checking');
    (async () => {
      const result = await readPreferredClientsFromPds(agent, did);
      if (cancelled) return;
      if (result.status === 'ok') {
        setRemote(result.record);
        setState('published');
        // A live record is the truth; make the toggle agree with it.
        if (!publishing) update((p) => setPublishPreferredClients(p, true));
      } else if (result.status === 'missing') {
        setRemote(null);
        // If publishing is on, the mirror effect below will create it.
        setState(publishing ? (rules.length > 0 ? 'publishing' : 'empty') : 'off');
      } else {
        setError(result.error);
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on identity only. `publishing`/`rules` are read for
    // the initial state; re-running on every edit would re-read the record we
    // just wrote. `update` is stable for a given session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, did]);

  // Mirror local rule edits up while publishing is on.
  useEffect(() => {
    if (!agent || !did || !publishing) return;
    if (lastWritten.current === rulesKey) return;
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(async () => {
      setError(null);
      try {
        if (rules.length === 0) {
          // Nothing left to declare — withdraw rather than publish an empty one.
          if (remote) {
            setState('removing');
            await deletePreferredClientsFromPds(agent, did);
            setRemote(null);
          }
          setState('empty');
        } else {
          setState('publishing');
          await writePreferredClientsToPds(agent, did, rules, remote);
          setRemote((prev) => ({
            preferences: rules,
            createdAt: prev?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }));
          setState('published');
        }
        lastWritten.current = rulesKey;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      }
    }, PUBLISH_DEBOUNCE_MS);
    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
    };
  }, [agent, did, publishing, rulesKey, rules, remote]);

  const setPublishing = useCallback(
    (next: boolean) => {
      update((p) => setPublishPreferredClients(p, next));
      if (!agent || !did) return;
      setError(null);
      // Force the mirror effect to act even when the rules themselves haven't
      // changed since a previous session.
      lastWritten.current = null;
      if (next) return;

      if (writeTimer.current) clearTimeout(writeTimer.current);
      setState('removing');
      (async () => {
        try {
          await deletePreferredClientsFromPds(agent, did);
          setRemote(null);
          setState('off');
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setState('error');
        }
      })();
    },
    [agent, did, update],
  );

  return { state, error, remote, setPublishing };
}
