'use client';

import { useEffect } from 'react';
import { applyTheme, getStoredTheme } from '@/lib/theme';

/**
 * Re-applies the saved theme to <html data-theme> after React hydrates.
 * The inline THEME_INIT_SCRIPT already sets the attribute before first
 * paint to avoid a flash, but React 19's hydration can wipe attributes
 * on <html> when there's any other mismatch elsewhere in the tree. This
 * effect runs once on mount to ensure the user's choice sticks.
 */
export default function ThemeSync() {
  useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);
  return null;
}
