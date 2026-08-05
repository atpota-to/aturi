'use client';

import { useEffect } from 'react';
import { applyColorScheme, setStoredColorScheme } from '@/lib/colorScheme';
import { usePreferences } from './PreferencesProvider';

/**
 * Bridges the synced `colorScheme` preference to <html data-scheme>.
 *
 * The inline COLOR_SCHEME_INIT_SCRIPT already applies the cached scheme
 * before first paint; this keeps the page in step with preferences after
 * that — including the moment a signed-in user's PDS record lands and
 * overrides whatever this browser had locally. Every applied value is also
 * written back to the localStorage cache so the *next* cold load paints the
 * right palette immediately instead of waiting on the network.
 *
 * Applying is gated on `loading`: while a read is in flight `prefs` is still
 * the default, and applying it would flash moss over the cached scheme.
 * Other preferences don't sync across open tabs either, so neither does
 * this — a second tab keeps its palette until it reloads, at which point the
 * cache (and the PDS) have the newer choice.
 */
export default function ColorSchemeSync() {
  const { prefs, loading } = usePreferences();
  const scheme = prefs.colorScheme;

  useEffect(() => {
    if (loading) return;
    applyColorScheme(scheme);
    setStoredColorScheme(scheme);
  }, [scheme, loading]);

  return null;
}
