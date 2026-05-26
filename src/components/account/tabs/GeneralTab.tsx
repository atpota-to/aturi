'use client';

import { useSyncExternalStore } from 'react';
import { Pin, X } from 'lucide-react';
import {
  applyTheme,
  getStoredTheme,
  isTheme,
  setStoredTheme,
  THEME_STORAGE_KEY,
  type Theme,
  DEFAULT_THEME,
} from '@/lib/theme';
import { usePreferences } from '@/components/PreferencesProvider';
import { setPinScope, togglePinnedLexicon } from '@/utils/preferences';

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

      <ExplorerCard />
    </>
  );
}

function ExplorerCard() {
  const { prefs, update } = usePreferences();
  const pinned = prefs.pinnedLexicons;

  function pickScope(scope: 'own' | 'all') {
    update((p) => setPinScope(p, scope));
  }

  function unpin(nsid: string) {
    update((p) => togglePinnedLexicon(p, nsid));
  }

  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="settings-card-title">Explorer</h2>
        <p className="settings-card-sub">
          Pin lexicons from any repo's collections tab to surface them at the
          top of the list. Useful for jumping straight to the records you
          touch most.
        </p>
      </div>

      <div className="settings-toggle-row">
        <div className="settings-toggle-label">
          <span className="settings-toggle-label-text">
            Show pinned section on
          </span>
          <span className="settings-toggle-label-sub">
            <em>My repo only</em> keeps the Pinned section private to your own
            account page. <em>Every repo</em> also bubbles your pins up on
            other people's pages whenever they have one of your pinned
            collections.
          </span>
        </div>
        <div
          role="radiogroup"
          aria-label="Pin scope"
          style={{
            display: 'inline-flex',
            border: '1px solid var(--border-medium)',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {(
            [
              { value: 'own', label: 'my repo' },
              { value: 'all', label: 'every repo' },
            ] as const
          ).map(({ value, label }) => {
            const active = prefs.pinScope === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pickScope(value)}
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
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontFamily: 'var(--font-serif)',
            fontSize: '0.75rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            marginBottom: '0.5rem',
          }}
        >
          <Pin size={12} aria-hidden />
          Pinned lexicons
          <span style={{ marginLeft: 'auto', letterSpacing: '0.04em' }}>
            {pinned.length}
          </span>
        </div>
        {pinned.length === 0 ? (
          <p
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-tertiary)',
              fontStyle: 'italic',
              margin: 0,
            }}
          >
            Nothing pinned yet. Use the pin button on rows in any repo's
            Collections tab to add lexicons here.
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              border: '1px solid var(--border-medium)',
            }}
          >
            {pinned.map((nsid, i) => (
              <li
                key={nsid}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.45rem 0.75rem',
                  background: i % 2 === 0 ? 'var(--bg-primary)' : 'transparent',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  wordBreak: 'break-all',
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{nsid}</span>
                <button
                  type="button"
                  onClick={() => unpin(nsid)}
                  aria-label={`Unpin ${nsid}`}
                  title="Remove pin"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0.25rem',
                    background: 'transparent',
                    border: 0,
                    color: 'var(--text-tertiary)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--text-accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-tertiary)';
                  }}
                >
                  <X size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
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
