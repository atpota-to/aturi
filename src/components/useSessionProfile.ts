'use client';

import { useEffect, useState } from 'react';
import { getProfile, type AppViewProfile } from '@/utils/atproto/appview';

/**
 * Lazily load the AppView profile for the signed-in DID so the session UI can
 * show an avatar + display name. Shared by <SessionMenu> and <SessionPanel>.
 *
 * The result is keyed by DID so switching accounts derives back to null on its
 * own — no reset-setState in the effect, and no stale avatar flash from the
 * previous account while the new profile loads. Returns null until the profile
 * for the current DID has resolved.
 */
export function useSessionProfile(did: string | null): AppViewProfile | null {
  const [profileEntry, setProfileEntry] = useState<{
    did: string;
    profile: AppViewProfile | null;
  } | null>(null);
  const profile = did && profileEntry && profileEntry.did === did ? profileEntry.profile : null;

  useEffect(() => {
    if (!did) return undefined;
    let cancelled = false;
    getProfile(did).then((p) => {
      if (!cancelled) setProfileEntry({ did, profile: p });
    });
    return () => {
      cancelled = true;
    };
  }, [did]);

  return profile;
}
