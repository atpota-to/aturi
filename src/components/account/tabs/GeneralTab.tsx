'use client';

import { useSyncExternalStore } from 'react';
import {
  applyTheme,
  getStoredTheme,
  isTheme,
  setStoredTheme,
  THEME_STORAGE_KEY,
  type Theme,
  DEFAULT_THEME,
} from '@/lib/theme';

/**
 * General settings — appearance and other app-wide toggles. The schema
 * for non-theme feature toggles lives in `src/utils/preferences.ts`;
 * extend it (and surface a <Toggle> row here) when adding new ones.
 */
export default function GeneralTab() {
  return (
    <>
      <section className="settings-card">
        <div className="settings-card-head">
          <h2 className="settings-card-title">Appearance</h2>
          <p className="settings-card-sub">
            Switch between dark and light themes. The page chrome and accent
            palette flip together; explorer panels, embeds, and the home strip
            all follow.
          </p>
        </div>
        <ThemePicker />
      </section>
    </>
  );
}

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

function ThemePicker() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function pick(next: Theme) {
    setStoredTheme(next);
    applyTheme(next);
    window.dispatchEvent(
      new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: next }),
    );
  }

  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-label">
        <span className="settings-toggle-label-text">Theme</span>
        <span className="settings-toggle-label-sub">
          Choose dark or light. Saved in this browser.
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label="Color theme"
        style={{
          display: 'inline-flex',
          border: '1px solid var(--border-medium)',
          overflow: 'hidden',
          flexShrink: 0,
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
                padding: '0.4rem 0.875rem',
                fontSize: '0.85rem',
                background: active ? 'var(--accent-forest)' : 'transparent',
                color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                border: 'none',
                cursor: 'pointer',
                transition: 'background 0.2s ease, color 0.2s ease',
                textTransform: 'lowercase',
                letterSpacing: '0.02em',
                fontFamily: 'var(--font-serif)',
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
