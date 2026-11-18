'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import {
  applyTheme,
  DEFAULT_THEME,
  getStoredTheme,
  isTheme,
  setStoredTheme,
  THEME_STORAGE_KEY,
  type Theme,
} from '@/lib/theme';

function subscribe(onChange: () => void): () => void {
  function handler(event: StorageEvent) {
    if (event.key === THEME_STORAGE_KEY) onChange();
  }
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

function getSnapshot(): Theme {
  const attr = document.documentElement.dataset.theme;
  if (isTheme(attr)) return attr;
  return getStoredTheme();
}

function getServerSnapshot(): Theme {
  return DEFAULT_THEME;
}

type Variant = 'inline' | 'chip';

interface ThemeToggleProps {
  /**
   * `inline` is a small icon-only button for use inside the regular nav row.
   * `chip` is the same button as a square tile, for the end of the phone
   * menu's Home row.
   */
  variant?: Variant;
}

export default function ThemeToggle({ variant = 'inline' }: ThemeToggleProps) {
  // Read the live `data-theme` attribute (set by THEME_INIT_SCRIPT before
  // first paint) so the button reflects the saved theme without a hydration
  // mismatch — useSyncExternalStore returns the server value during SSR
  // and swaps to the client value after mount in one pass.
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function pick(next: Theme) {
    setStoredTheme(next);
    applyTheme(next);
    // Storage events don't fire in the same tab, so nudge subscribers
    // manually by dispatching a synthetic one.
    window.dispatchEvent(
      new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: next })
    );
  }

  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  if (variant === 'chip') {
    // In the menu's tile styling, and the same button otherwise: the icon
    // is the theme a tap switches to, as it is in the bar.
    return (
      <button
        type="button"
        onClick={() => pick(next)}
        aria-label={`Switch to ${next} mode`}
        title={`Switch to ${next} mode`}
        className="compact-nav-link fn-menu-chip"
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => pick(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="nav-link fn-theme-btn"
    >
      {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
