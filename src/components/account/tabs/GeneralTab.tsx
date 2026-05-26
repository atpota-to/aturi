'use client';

import { useState, useSyncExternalStore } from 'react';
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
import {
  addPinnedLexicon,
  isLikelyNsid,
  removePinnedLexicon,
  setPinScope,
  type PinTarget,
  type Preferences,
} from '@/utils/preferences';

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

  function pickScope(scope: Preferences['pinScope']) {
    update((p) => setPinScope(p, scope));
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
            <em>My repo</em> keeps the Pinned section private to your own
            account page. <em>Every repo</em> bubbles a single shared list up
            on every page that has a match. <em>Separate</em> lets you keep
            two different lists — one for your repo, another for everyone
            else's.
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
              { value: 'split', label: 'separate' },
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

      <PinnedList
        target="mine"
        title={
          prefs.pinScope === 'split'
            ? 'Pinned on my repo'
            : prefs.pinScope === 'all'
              ? 'Pinned everywhere'
              : 'Pinned lexicons'
        }
      />
      {prefs.pinScope === 'split' && (
        <PinnedList target="others" title="Pinned on others' repos" />
      )}
    </section>
  );
}

function PinnedList({
  target,
  title,
}: {
  target: PinTarget;
  title: string;
}) {
  const { prefs, update } = usePreferences();
  const list =
    target === 'others' ? prefs.pinnedLexiconsOthers : prefs.pinnedLexicons;
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (!isLikelyNsid(value)) {
      setErr('That doesn’t look like a valid NSID. Expected lowercase, dotted (e.g. app.bsky.feed.post).');
      return;
    }
    if (list.includes(value)) {
      setErr('Already pinned.');
      return;
    }
    update((p) => addPinnedLexicon(p, value, target));
    setDraft('');
    setErr(null);
  }

  function unpin(nsid: string) {
    update((p) => removePinnedLexicon(p, nsid, target));
  }

  return (
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
        {title}
        <span style={{ marginLeft: 'auto', letterSpacing: '0.04em' }}>
          {list.length}
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '0.5rem',
        }}
      >
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (err) setErr(null);
          }}
          placeholder="app.bsky.feed.post"
          aria-label={`Add lexicon to ${title}`}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '0.45rem 0.65rem',
            background: 'var(--bg-tertiary)',
            border: `1px solid ${err ? 'var(--text-error, #b94a4a)' : 'var(--border-medium)'}`,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.85rem',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={draft.trim().length === 0}
          style={{
            padding: '0.45rem 0.9rem',
            background: 'var(--accent-forest)',
            color: 'var(--text-on-accent)',
            border: 0,
            cursor: draft.trim() ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-serif)',
            fontSize: '0.85rem',
            opacity: draft.trim() ? 1 : 0.5,
          }}
        >
          Pin
        </button>
      </form>
      {err && (
        <p
          style={{
            margin: '0 0 0.5rem 0',
            fontSize: '0.75rem',
            color: 'var(--text-error, #b94a4a)',
          }}
        >
          {err}
        </p>
      )}

      {list.length === 0 ? (
        <p
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-tertiary)',
            fontStyle: 'italic',
            margin: 0,
          }}
        >
          Nothing pinned yet. Add an NSID above, or use the pin button on rows
          in any repo's Collections tab.
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
          {list.map((nsid, i) => (
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
