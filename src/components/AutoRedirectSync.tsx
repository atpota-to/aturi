'use client';

import { useEffect } from 'react';
import {
  autoRedirectCacheFor,
  currentClientPlatform,
  writeAutoRedirectCache,
} from '@/utils/autoRedirect';
import { usePreferences } from './PreferencesProvider';
import { usePreferredClients } from './PreferredClientsProvider';

/**
 * Mirrors the auto-redirect preference into a localStorage cache.
 *
 * Same job as `ColorSchemeSync`, for the same reason: preferences are the
 * source of truth and sync to the PDS, but they aren't readable until React
 * mounts — far too late to beat the first paint of a waypoint page. This keeps
 * a small denormalized copy current so the next cold load can decide before
 * anything renders.
 *
 * The disabled state is written too, not just skipped. A stale "enabled" cache
 * would keep redirecting after the switch was turned off, and the switch has
 * to take effect on the very next link.
 *
 * Gated on `loading` for the reason `ColorSchemeSync` documents: while a read
 * is in flight `prefs` is still the default, and writing that would clobber
 * this browser's cache with "off" moments before the real value arrives.
 *
 * The cached favorites are the effective ones, with the account's declared
 * clients filled in for this device, so a declaration redirects before paint
 * too. The declaration provider hands over its own cached copy while the
 * session restores, which is what keeps this from writing the declared
 * families out of the cache on every cold load.
 */
export default function AutoRedirectSync() {
  const { prefs, loading } = usePreferences();
  const { record } = usePreferredClients();
  const enabled = prefs.autoRedirect;
  const favorites = prefs.favoriteByFamily;
  const follow = prefs.followDeclaredClients;

  useEffect(() => {
    if (loading) return;
    const declared = record ? { record, platform: currentClientPlatform() } : null;
    writeAutoRedirectCache(autoRedirectCacheFor(prefs, declared));
    // `prefs` is a new object on every edit, so depending on it directly would
    // rewrite the cache for unrelated preference changes. These three are the
    // only preferences `autoRedirectCacheFor` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, favorites, follow, record, loading]);

  return null;
}
