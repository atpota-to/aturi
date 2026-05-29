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

type Variant = 'inline' | 'row';

interface ThemeToggleProps {
  /**
   * `inline` is a small icon-only button for use inside the regular nav row.
   * `row` is a labeled segmented control sized for the compact-mode nav
   * expansion drawer.
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

  if (variant === 'row') {
    // Match the other compact-menu rows exactly: an icon + label button using
    // the shared .compact-nav-link styling. Clicking toggles dark/light; the
    // moon/sun icon reflects the current theme.
    const rowNext: Theme = theme === 'dark' ? 'light' : 'dark';
    return (
      <button
        type="button"
        onClick={() => pick(rowNext)}
        aria-label={`Switch to ${rowNext} mode`}
        className="compact-nav-link"
        style={{ font: 'inherit', textAlign: 'left', width: '100%' }}
      >
        {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
        <span>theme</span>
      </button>
    );
  }

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => pick(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="nav-link"
      style={{
        padding: '0.5rem',
      }}
    >
      {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
