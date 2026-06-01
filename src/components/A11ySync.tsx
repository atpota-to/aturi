'use client';

import { useEffect } from 'react';
import {
  applyHighContrast,
  applyReduceMotion,
  getStoredHighContrast,
  getStoredReduceMotion,
  hasStoredHighContrast,
  hasStoredReduceMotion,
  HIGH_CONTRAST_STORAGE_KEY,
  REDUCE_MOTION_STORAGE_KEY,
} from '@/lib/a11y';

/**
 * Re-applies the saved reduce-motion / high-contrast choices to <html> after
 * React hydrates. The inline A11Y_INIT_SCRIPT already sets the attributes
 * before first paint, but React 19's hydration can wipe attributes on <html>
 * when there's any other mismatch elsewhere in the tree. This effect runs
 * once on mount to ensure the user's choices stick, listens for `storage`
 * events so changes in another tab re-apply here, and follows OS-level
 * preference changes while the user hasn't set an explicit override.
 */
export default function A11ySync() {
  useEffect(() => {
    applyReduceMotion(getStoredReduceMotion());
    applyHighContrast(getStoredHighContrast());

    function onStorage(e: StorageEvent) {
      if (e.key === REDUCE_MOTION_STORAGE_KEY) {
        applyReduceMotion(getStoredReduceMotion());
      } else if (e.key === HIGH_CONTRAST_STORAGE_KEY) {
        applyHighContrast(getStoredHighContrast());
      }
    }
    window.addEventListener('storage', onStorage);

    // Track OS preference changes, but only while the user is still on the
    // default (no explicit override stored). Once they pick a value here it
    // wins until they change it.
    const motionMql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const contrastMql = window.matchMedia('(prefers-contrast: more)');
    function onMotion() {
      if (!hasStoredReduceMotion()) applyReduceMotion(getStoredReduceMotion());
    }
    function onContrast() {
      if (!hasStoredHighContrast()) applyHighContrast(getStoredHighContrast());
    }
    motionMql.addEventListener('change', onMotion);
    contrastMql.addEventListener('change', onContrast);

    return () => {
      window.removeEventListener('storage', onStorage);
      motionMql.removeEventListener('change', onMotion);
      contrastMql.removeEventListener('change', onContrast);
    };
  }, []);
  return null;
}
