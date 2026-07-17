'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import {
  applyFontScale,
  getStoredFontScale,
  isFontScale,
  setStoredFontScale,
  FONT_SCALE_OPTIONS,
  FONT_SCALE_STORAGE_KEY,
  type FontScale,
  DEFAULT_FONT_SCALE,
} from '@/lib/fontScale';
import {
  applyHighContrast,
  applyReduceMotion,
  getHighContrastServerSnapshot,
  getHighContrastSnapshot,
  getReduceMotionServerSnapshot,
  getReduceMotionSnapshot,
  HIGH_CONTRAST_STORAGE_KEY,
  REDUCE_MOTION_STORAGE_KEY,
  setStoredHighContrast,
  setStoredReduceMotion,
  subscribeHighContrast,
  subscribeReduceMotion,
} from '@/lib/a11y';
import { usePreferences } from '@/components/PreferencesProvider';
import { useMyCollections } from '@/components/explore/useRepoCollections';
import Toggle from '../Toggle';
import {
  addPinnedLexicon,
  isLikelyPinEntry,
  isPinGroup,
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
      <AppearanceCard />
      <ExplorerCard />
    </>
  );
}

function AppearanceCard() {
  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="settings-card-title">Appearance</h2>
        <p className="settings-card-sub">
          Switch between dark and light themes, tune the text size, and dial
          in accessibility options. The page chrome and accent palette flip
          together; explorer panels, embeds, and the home strip all follow.
          Choose which explorer sections appear — and in what order — under
          the <strong>Sections</strong> tab.
        </p>
      </div>
      <ThemePicker />
      <FontScalePicker />
      <ReduceMotionToggle />
      <HighContrastToggle />
    </section>
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
          Pin lexicons — or entire NSID groups like <code>app.bsky.feed.*</code> —
          from any repo&apos;s collections tab to surface them at the top of the
          list. Useful for jumping straight to the records you touch most.
        </p>
      </div>

      <div className="settings-toggle-row">
        <div className="settings-toggle-label">
          <span className="settings-toggle-label-text">
            Show pinned section on
          </span>
          <span className="settings-toggle-label-sub">
            <em>My repo</em> shows the Pinned section only on your own account
            page. <em>Every repo</em> bubbles a single shared list up on
            every page that has a match. <em>Separate</em> lets you keep
            two different lists — one for your repo, another for everyone
            else&apos;s.
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

      <Toggle
        id="collections-collapse-default"
        label="Start lexicon groups collapsed"
        description="When on, every group on the explorer's Collections tab starts folded. Use the toggle next to the filter bar to flip everything at once."
        checked={prefs.collectionGroupsCollapsedByDefault}
        onChange={(next) =>
          update((p) => ({ ...p, collectionGroupsCollapsedByDefault: next }))
        }
      />

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

const SUGGESTION_LIMIT = 8;

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
  const [focused, setFocused] = useState(false);
  // Active suggestion index, keyed by the (draft, list-length) shape it was
  // set against. When the filtered suggestions change the derived index
  // resets to 0 on its own — replaces the old reset-on-change effect that
  // tripped react-hooks/set-state-in-effect.
  const [activeEntry, setActiveEntry] = useState<{ key: string; idx: number } | null>(null);
  const containerRef = useRef<HTMLFormElement>(null);

  // Source for autocomplete: NSIDs on the signed-in user's own repo.
  // null when signed out or still loading — in that case we fall back
  // to a pure free-text input.
  const myCollections = useMyCollections();
  const pinnedSet = useMemo(() => new Set(list), [list]);
  // Suggestion pool: every NSID on the user's own repo, plus group
  // wildcards (`prefix.*`) for any major/sub prefix shared by two or more
  // collections — a one-member group isn't worth offering.
  const candidatePool = useMemo(() => {
    if (!myCollections) return [] as string[];
    const nsids = Array.from(myCollections);
    const counts = new Map<string, number>();
    for (const n of nsids) {
      const segs = n.split('.');
      if (segs.length >= 2) {
        const major = `${segs[0]}.${segs[1]}`;
        counts.set(major, (counts.get(major) ?? 0) + 1);
      }
      if (segs.length >= 4) {
        const sub = `${segs[0]}.${segs[1]}.${segs[2]}`;
        counts.set(sub, (counts.get(sub) ?? 0) + 1);
      }
    }
    const groups = Array.from(counts.entries())
      .filter(([, c]) => c >= 2)
      .map(([p]) => `${p}.*`);
    return [...nsids, ...groups];
  }, [myCollections]);
  const suggestions = useMemo(() => {
    if (candidatePool.length === 0) return [] as string[];
    const q = draft.trim().toLowerCase();
    const candidates = candidatePool.filter((n) => !pinnedSet.has(n));
    candidates.sort();
    if (!q) return candidates.slice(0, SUGGESTION_LIMIT);
    // Rank: prefix match first, then any substring match.
    const lc = candidates.map((n) => [n, n.toLowerCase()] as const);
    const prefix = lc.filter(([, l]) => l.startsWith(q)).map(([n]) => n);
    const contains = lc
      .filter(([, l]) => !l.startsWith(q) && l.includes(q))
      .map(([n]) => n);
    return [...prefix, ...contains].slice(0, SUGGESTION_LIMIT);
  }, [candidatePool, draft, pinnedSet]);

  // Close suggestions on outside click.
  useEffect(() => {
    if (!focused) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [focused]);

  const suggestionsOpen = focused && suggestions.length > 0;

  // Derived: whenever the filtered set changes shape the key changes and the
  // index falls back to 0 without a reset effect.
  const activeKey = `${draft}|${suggestions.length}`;
  const activeIdx = activeEntry && activeEntry.key === activeKey ? activeEntry.idx : 0;
  function setActiveIdx(next: number | ((i: number) => number)) {
    setActiveEntry({ key: activeKey, idx: typeof next === 'function' ? next(activeIdx) : next });
  }

  function pin(value: string) {
    const v = value.trim().toLowerCase();
    if (!v) return;
    if (!isLikelyPinEntry(v)) {
      setErr(
        'That doesn’t look like a valid NSID. Expected lowercase, dotted (e.g. app.bsky.feed.post), or a group wildcard (e.g. app.bsky.feed.*).',
      );
      return;
    }
    if (list.includes(v)) {
      setErr('Already pinned.');
      return;
    }
    update((p) => addPinnedLexicon(p, v, target));
    setDraft('');
    setErr(null);
  }

  function submit() {
    if (suggestionsOpen && suggestions[activeIdx]) {
      pin(suggestions[activeIdx]);
      return;
    }
    pin(draft);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestionsOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setFocused(false);
    } else if (e.key === 'Tab' && suggestions[activeIdx]) {
      // Tab autofills the input without submitting, so the user can
      // tweak the NSID before pinning.
      e.preventDefault();
      setDraft(suggestions[activeIdx]);
    }
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
        ref={containerRef}
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '0.5rem',
          position: 'relative',
        }}
      >
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
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
            onFocus={() => setFocused(true)}
            onKeyDown={onKeyDown}
            placeholder={
              myCollections
                ? 'Search, or type an NSID / group (app.bsky.feed.*)…'
                : 'app.bsky.feed.post or app.bsky.feed.*'
            }
            aria-label={`Add lexicon to ${title}`}
            aria-autocomplete="list"
            aria-expanded={suggestionsOpen}
            aria-controls={`pinned-suggestions-${target}`}
            aria-activedescendant={
              suggestionsOpen ? `pinned-suggestion-${target}-${activeIdx}` : undefined
            }
            role="combobox"
            style={{
              width: '100%',
              padding: '0.45rem 0.65rem',
              background: 'var(--bg-tertiary)',
              border: `1px solid ${err ? 'var(--danger)' : 'var(--border-medium)'}`,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />
          {suggestionsOpen && (
            <ul
              id={`pinned-suggestions-${target}`}
              role="listbox"
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                position: 'absolute',
                top: 'calc(100% + 2px)',
                left: 0,
                right: 0,
                zIndex: 5,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                maxHeight: '16rem',
                overflowY: 'auto',
                boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
              }}
            >
              {suggestions.map((nsid, i) => (
                <li
                  key={nsid}
                  id={`pinned-suggestion-${target}-${i}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pin(nsid);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  style={{
                    padding: '0.4rem 0.65rem',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8rem',
                    background:
                      i === activeIdx ? 'var(--bg-tertiary)' : 'transparent',
                    color:
                      i === activeIdx
                        ? 'var(--text-accent)'
                        : 'var(--text-primary)',
                    cursor: 'pointer',
                    wordBreak: 'break-all',
                  }}
                >
                  {highlightMatch(nsid, draft)}
                </li>
              ))}
            </ul>
          )}
        </div>
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
            color: 'var(--danger)',
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
          Nothing pinned yet. Add an NSID or a group wildcard (e.g.
          app.bsky.feed.*) above, or use the pin button on rows and group
          headers in any repo&apos;s Collections tab.
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
              {isPinGroup(nsid) && (
                <span
                  style={{
                    flexShrink: 0,
                    fontFamily: 'var(--font-serif)',
                    fontSize: '0.65rem',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--text-accent)',
                    border: '1px solid var(--text-accent)',
                    padding: '0.05rem 0.35rem',
                  }}
                >
                  group
                </span>
              )}
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

/**
 * Render `nsid` with the substring matching `query` underlined. Falls
 * back to plain text when there's no match or no query.
 */
function highlightMatch(nsid: string, query: string): React.ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return nsid;
  const lc = nsid.toLowerCase();
  const idx = lc.indexOf(q);
  if (idx < 0) return nsid;
  return (
    <>
      {nsid.slice(0, idx)}
      <strong style={{ color: 'var(--text-accent)', fontWeight: 600 }}>
        {nsid.slice(idx, idx + q.length)}
      </strong>
      {nsid.slice(idx + q.length)}
    </>
  );
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

function subscribeFontScale(onChange: () => void): () => void {
  function handler(event: StorageEvent) {
    if (event.key === FONT_SCALE_STORAGE_KEY) onChange();
  }
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

function getFontScaleSnapshot(): FontScale {
  const attr = document.documentElement.dataset.fontScale;
  if (isFontScale(attr)) return attr;
  return getStoredFontScale();
}

function getFontScaleServerSnapshot(): FontScale {
  return DEFAULT_FONT_SCALE;
}

function FontScalePicker() {
  const scale = useSyncExternalStore(
    subscribeFontScale,
    getFontScaleSnapshot,
    getFontScaleServerSnapshot,
  );

  function pick(next: FontScale) {
    setStoredFontScale(next);
    applyFontScale(next);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: FONT_SCALE_STORAGE_KEY,
        newValue: next,
      }),
    );
  }

  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-label">
        <span className="settings-toggle-label-text">Font size</span>
        <span className="settings-toggle-label-sub">
          Adjusts text size across the app. Saved in this browser.
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label="Font size"
        style={{
          display: 'inline-flex',
          border: '1px solid var(--border-medium)',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {FONT_SCALE_OPTIONS.map(({ value, label }) => {
          const active = scale === value;
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
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReduceMotionToggle() {
  const on = useSyncExternalStore(
    subscribeReduceMotion,
    getReduceMotionSnapshot,
    getReduceMotionServerSnapshot,
  );

  function set(next: boolean) {
    setStoredReduceMotion(next);
    applyReduceMotion(next);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: REDUCE_MOTION_STORAGE_KEY,
        newValue: next ? 'true' : 'false',
      }),
    );
  }

  return (
    <Toggle
      id="reduce-motion"
      label="Reduce motion"
      description="Stops the drifting background glow and pauses page, hover, and loading animations across the site. Defaults to your system setting."
      checked={on}
      onChange={set}
    />
  );
}

function HighContrastToggle() {
  const on = useSyncExternalStore(
    subscribeHighContrast,
    getHighContrastSnapshot,
    getHighContrastServerSnapshot,
  );

  function set(next: boolean) {
    setStoredHighContrast(next);
    applyHighContrast(next);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: HIGH_CONTRAST_STORAGE_KEY,
        newValue: next ? 'true' : 'false',
      }),
    );
  }

  return (
    <Toggle
      id="high-contrast"
      label="High contrast"
      description="Boosts text and border contrast and removes the ambient glow and grain overlays for a sharper, more legible interface. Defaults to your system setting."
      checked={on}
      onChange={set}
    />
  );
}
