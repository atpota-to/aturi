'use client';

import { useEffect } from 'react';
import { autoRedirectCacheFor, writeAutoRedirectCache } from '@/utils/autoRedirect';
import { usePreferences } from './PreferencesProvider';

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
 */
export default function AutoRedirectSync() {
  const { prefs, loading } = usePreferences();
  const enabled = prefs.autoRedirect;
  const favorites = prefs.favoriteByFamily;

  useEffect(() => {
    if (loading) return;
    writeAutoRedirectCache(autoRedirectCacheFor(prefs));
    // `prefs` is a new object on every edit, so depending on it directly would
    // rewrite the cache for unrelated preference changes. These two are the
    // only inputs `autoRedirectCacheFor` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, favorites, loading]);

  return null;
}
