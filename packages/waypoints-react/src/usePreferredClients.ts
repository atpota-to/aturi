import { useEffect, useMemo, useState } from 'react';
import {
  fetchPreferredClients,
  preferredWaypointFor,
  type PreferredClientMatch,
  type PreferredClientsRecord,
  type PreferredClientTarget,
} from '@aturi.to/waypoints';

export type UsePreferredClientsParams = {
  /**
   * Handle or DID of the person about to open the link — usually your own
   * signed-in user. Pass null/undefined to skip the lookup entirely.
   */
  actor?: string | null;
  /** Skip the network read by supplying a record you already hold. */
  record?: PreferredClientsRecord | null;
};

export type UsePreferredClientsResult = {
  /** The account's declaration, or null if they haven't published one. */
  record: PreferredClientsRecord | null;
  loading: boolean;
  /** Resolve the declaration against a specific record you're linking to. */
  preferredFor: (target: PreferredClientTarget) => PreferredClientMatch | null;
};

/**
 * Read an account's public `to.aturi.actor.preferredClients` record.
 *
 * Most accounts have never published one, so `record` being null is the normal
 * case and never an error — carry on with whatever you did before. The fetch is
 * a plain public read: no auth, no API key.
 *
 * ```tsx
 * const { preferredFor } = usePreferredClients({ actor: viewerDid });
 * const choice = preferredFor({ type: 'post', handle, collection, rkey, did });
 * const href = choice?.url ?? myDefaultLink;
 * ```
 */
export function usePreferredClients(
  params: UsePreferredClientsParams = {},
): UsePreferredClientsResult {
  const { actor, record: provided } = params;
  const [fetched, setFetched] = useState<PreferredClientsRecord | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // A caller-supplied record wins; there's nothing to look up.
    if (provided !== undefined || !actor) {
      setFetched(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchPreferredClients(actor).then((result) => {
      if (cancelled) return;
      setFetched(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [actor, provided]);

  const record = provided !== undefined ? provided : fetched;

  return useMemo(
    () => ({
      record,
      loading,
      preferredFor: (target: PreferredClientTarget) =>
        preferredWaypointFor(record, target),
    }),
    [record, loading],
  );
}
