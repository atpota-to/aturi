'use client';

import { useEffect } from 'react';
import {
  applyFontScale,
  getStoredFontScale,
  FONT_SCALE_STORAGE_KEY,
} from '@/lib/fontScale';

/**
 * Re-applies the saved font scale to <html style="font-size"> after React
 * hydrates. The inline FONT_SCALE_INIT_SCRIPT already sets it before first
 * paint to avoid a reflow, but React 19's hydration can wipe inline styles
 * on <html> when there's any other mismatch elsewhere in the tree. This
 * effect runs once on mount to ensure the user's choice sticks, and listens
 * for `storage` events so a change in another tab re-applies here.
 */
export default function FontScaleSync() {
  useEffect(() => {
    applyFontScale(getStoredFontScale());
    function handler(e: StorageEvent) {
      if (e.key === FONT_SCALE_STORAGE_KEY) {
        applyFontScale(getStoredFontScale());
      }
    }
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
  return null;
}
