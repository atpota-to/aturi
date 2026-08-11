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
import {
  applyColorScheme,
  COLOR_SCHEMES,
  type ColorScheme,
} from '@/lib/colorScheme';
import { usePreferences } from '@/components/PreferencesProvider';

/**
 * The two appearance controls the guided setup and the General settings tab
 * both render. They live here rather than inside GeneralTab so the two
 * surfaces can't drift — a scheme added to `COLOR_SCHEMES` shows up in both,
 * and the "palette syncs / dark-light doesn't" split is explained once.
 */

function subscribeTheme(onChange: () => void): () => void {
  function handler(event: StorageEvent) {
    if (event.key === THEME_STORAGE_KEY) onChange();
  }
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

function getThemeSnapshot(): Theme {
  const attr = document.documentElement.dataset.theme;
  if (isTheme(attr)) return attr;
  return getStoredTheme();
}

function getThemeServerSnapshot(): Theme {
  return DEFAULT_THEME;
}

/**
 * Palette picker. Unlike the dark/light switch, the scheme lives in the
 * synced preferences record rather than localStorage, so it travels with the
 * account. `applyColorScheme` runs here for instant feedback;
 * `ColorSchemeSync` re-applies from prefs and updates the pre-paint cache.
 */
export function ColorSchemePicker({
  description,
  hideLabel = false,
}: {
  description?: string;
  /**
   * Drop the "Color scheme" row label and description, for callers whose own
   * heading already says it. The guided setup gives this control a whole step
   * titled "Pick a palette"; repeating that above the swatches turns a tray
   * of colours into a form.
   */
  hideLabel?: boolean;
}) {
  const { prefs, update } = usePreferences();

  function pick(next: ColorScheme) {
    applyColorScheme(next);
    update((p) => ({ ...p, colorScheme: next }));
  }

  return (
    <div className={`settings-toggle-row is-stacked ${hideLabel ? 'is-bare' : ''}`}>
      {!hideLabel && (
        <div className="settings-toggle-label">
          <span className="settings-toggle-label-text">Color scheme</span>
          <span className="settings-toggle-label-sub">
            {description ??
              'The palette the whole app is painted in. Every scheme has a dark and a light variant — the row below picks which one you see. Saved with the rest of your settings, so it follows you to other devices when you’re signed in.'}
          </span>
        </div>
      )}
      <div role="radiogroup" aria-label="Color scheme" className="scheme-picker">
        {COLOR_SCHEMES.map(({ value, label, hint }) => {
          const active = prefs.colorScheme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(value)}
              className={`scheme-option ${active ? 'is-active' : ''}`}
            >
              {/* Two-tone chip: dark variant on the left, light on the
                  right, so both are visible whichever one is active. */}
              <span className="scheme-swatch" data-scheme={value} aria-hidden>
                <span />
                <span />
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="scheme-option-name">{label}</span>
                <span className="scheme-option-hint">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Dark/light switch. Browser-local — a per-device choice, not a synced one. */
export function ThemePicker({ description }: { description?: string }) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );

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
        <span className="settings-toggle-label-text">Dark or light</span>
        <span className="settings-toggle-label-sub">
          {description ??
            'Which variant of the scheme above to show. Saved in this browser, so you can run light here and dark on your phone.'}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label="Dark or light"
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
