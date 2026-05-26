'use client';

import { useEffect, useState } from 'react';
import { describeRepo } from '@/utils/atproto/pdsClient';
import { resolveIdentifier } from '@/utils/atproto/identity';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';

/**
 * Module-level cache of collection-NSID sets keyed by DID. Reuses across
 * mounts so flipping between repos in a single session is instant.
 */
const cache = new Map<string, Set<string>>();

/**
 * Fetch + cache the set of collection NSIDs on a given repo. Returns null
 * until the lookup resolves. Failures are swallowed (the cache stays
 * empty for that DID); callers should treat null as "still loading or
 * unavailable" and fall back gracefully.
 *
 * Resolves the repo's PDS via resolveIdentifier if a `pds` isn't passed
 * — the explorer often already has the resolved bundle and can skip the
 * extra round-trip.
 */
export function useRepoCollections(
  did: string | null,
  pds?: string,
): Set<string> | null {
  const [set, setSet] = useState<Set<string> | null>(() =>
    did ? cache.get(did) ?? null : null,
  );

  useEffect(() => {
    if (!did) {
      setSet(null);
      return undefined;
    }
    const cached = cache.get(did);
    if (cached) {
      setSet(cached);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const endpoint =
          pds ?? (await resolveIdentifier(did).then((id) => id.pds));
        if (!endpoint) return;
        const desc = await describeRepo(endpoint, did);
        const next = new Set(
          Array.isArray(desc.collections) ? desc.collections : [],
        );
        cache.set(did, next);
        if (!cancelled) setSet(next);
      } catch {
        // Non-fatal: caller renders the "loading" / null state instead.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [did, pds]);

  return set;
}

/**
 * Convenience wrapper: the signed-in user's own collection set, or null
 * when signed out / matching the repo being viewed (in which case
 * "collections in common" UI doesn't apply).
 */
export function useMyCollections(viewingDid?: string): Set<string> | null {
  const { did: myDid } = useAtprotoSession();
  const skip = !myDid || (viewingDid && myDid === viewingDid);
  return useRepoCollections(skip ? null : myDid);
}
