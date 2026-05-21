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
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          padding: '0.625rem 0.875rem',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            color: 'var(--text-secondary)',
            fontSize: '0.85rem',
            letterSpacing: '0.02em',
          }}
        >
          {theme === 'light' ? <Sun size={14} /> : <Moon size={14} />}
          <span>theme</span>
        </span>
        <div
          role="radiogroup"
          aria-label="Color theme"
          style={{
            display: 'inline-flex',
            border: '1px solid var(--border-medium)',
            overflow: 'hidden',
          }}
        >
          {(['dark', 'light'] as const).map((value) => {
            const active = theme === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pick(value)}
                style={{
                  padding: '0.3rem 0.75rem',
                  fontSize: '0.8rem',
                  background: active ? 'var(--accent-forest)' : 'transparent',
                  color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease, color 0.2s ease',
                  textTransform: 'lowercase',
                  letterSpacing: '0.02em',
                }}
              >
                {value}
              </button>
            );
          })}
        </div>
      </div>
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
