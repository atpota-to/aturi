'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  backlinkDetailsVersion,
  cachedProfile,
  loadProfiles,
  subscribeBacklinkDetails,
  type LinkerProfile,
} from '@/utils/atproto/backlinkDetails';
import { resolveMiniDoc } from '@/utils/atproto/slingshot';
import { shortDid } from '@/utils/atproto/urls';

/**
 * Accounts named the way the rest of the explorer names them: from the
 * profile cache the backlinks lists fill (one AppView request per batch), so
 * a records list and the record opened beside it never ask twice.
 */
export function useProfiles(dids: readonly string[]): (did: string) => LinkerProfile | null | undefined {
  useSyncExternalStore(subscribeBacklinkDetails, backlinkDetailsVersion, () => 0);
  const joined = Array.from(new Set(dids)).join(' ');
  useEffect(() => {
    if (joined) void loadProfiles(joined.split(' '));
  }, [joined]);
  return cachedProfile;
}

const handles = new Map<string, string | null>();
const listeners = new Set<() => void>();
let version = 0;

/**
 * A DID as a handle. A lexicon's authority is often an account with no
 * Bluesky profile (Bluesky's own lexicons are published by one), so the
 * profile cache is tried first and the DID document after it.
 */
export function useDidLabel(did: string): string {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
  const profiles = useProfiles([did]);
  const profile = profiles(did);
  useEffect(() => {
    if (profile !== null || handles.has(did)) return;
    handles.set(did, null);
    resolveMiniDoc(did).then((doc) => {
      handles.set(did, doc?.handle && doc.handle !== 'handle.invalid' ? doc.handle : null);
      version++;
      listeners.forEach((l) => l());
    });
  }, [did, profile]);
  const handle = profile?.handle || handles.get(did);
  return handle ? `@${handle}` : shortDid(did);
}
