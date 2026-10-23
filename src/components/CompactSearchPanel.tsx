'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { encodeRepo } from '@/utils/atproto/urls';
import { resolveSearchPathAsync } from '@/utils/atproto/searchRouting';
import {
  searchActorsTypeahead,
  type ActorTypeaheadResult,
} from '@/utils/atproto/appview';
import {
  getFrequent,
  getRecents,
  readSearchHistory,
  recordActorVisit,
  recordQueryVisit,
  type SearchHistoryEntry,
} from '@/utils/searchHistory';
import SearchRecommendations from './explore/SearchRecommendations';
import { useKeyboardShortcuts } from './KeyboardShortcutsProvider';
import { bindingTokens } from '@/lib/keybindings';

const TYPEAHEAD_DEBOUNCE_MS = 180;
const RECENTS_LIMIT = 6;
const FREQUENT_LIMIT = 4;

type Props = {
  /** When the header opens this panel, set to true to focus the input. */
  active: boolean;
  /** Called after a navigation/submit so the parent can close the panel. */
  onDone: () => void;
  /**
   * `panel` (default) fills the header's drop-down search card. `bar` is the
   * always-visible field in the header row on explorer pages: its
   * suggestions drop down only while it has focus.
   */
  variant?: 'panel' | 'bar';
};

/**
 * Lightweight search box for the compact header's expanding panel. Mirrors
 * the explorer's SearchBox typeahead + at:// shortcuts but is styled to
 * fit inside the slim header card and intentionally omits the standalone
 * "Look up" button (the input alone is the UI). When the input is empty it
 * surfaces locally-stored "recent" and "frequent" recommendations.
 */
export default function CompactSearchPanel({ active, onDone, variant = 'panel' }: Props) {
  const router = useRouter();
  const isBar = variant === 'bar';
  const [focused, setFocused] = useState(false);
  // Two copies can be mounted at once (the bar and the drop-down panel), so
  // the listbox ids are per-instance.
  const listId = `compact-search-typeahead-${useId().replace(/:/g, '')}`;
  // The bar shows the command palette's shortcut as a hint: the palette jumps
  // to a handle or at:// URI from anywhere, the same job this field does.
  const { commands, platform, state: keyState } = useKeyboardShortcuts();
  const paletteBinding = commands.find((c) => c.meta.id === 'command-palette')?.bindings[0];
  const hint =
    keyState.enabled && paletteBinding
      ? bindingTokens(paletteBinding, platform)
          .map((step) => step.join(platform === 'mac' ? '' : '+'))
          .join(' ')
      : null;
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<ActorTypeaheadResult[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against a second Enter while an unrecognized URL is being resolved
  // through /api/at-tags.
  const resolvingRef = useRef(false);

  // Focus + select existing text whenever the panel becomes active. Using
  // a microtask so the input is mounted and visible before we focus it
  // (the parent panel animates in via transform/opacity). Reload history
  // here too so freshly-recorded visits show up next time it opens.
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => {
      setHistory(readSearchHistory());
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [active]);

  // Debounced typeahead. Skip DIDs and at:// URIs since the appview
  // typeahead is handle/display-name oriented. Clearing happens in the
  // timer callback (not synchronously in the effect body) so this stays
  // compatible with react-hooks/set-state-in-effect.
  useEffect(() => {
    const trimmed = value.trim();
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      if (
        !trimmed ||
        trimmed.startsWith('did:') ||
        trimmed.startsWith('at://') ||
        trimmed.length < 2
      ) {
        setSuggestions([]);
        setHighlightIndex(-1);
        return;
      }
      const results = await searchActorsTypeahead(trimmed, {
        limit: 6,
        signal: controller.signal,
      });
      setSuggestions(rankByHandle(results, trimmed));
      setHighlightIndex(-1);
    }, TYPEAHEAD_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [value]);

  const finish = useCallback(
    (path: string) => {
      router.push(path);
      setValue('');
      setSuggestions([]);
      if (isBar) inputRef.current?.blur();
      onDone();
    },
    [router, onDone, isBar],
  );

  const goToActor = useCallback(
    (actor: ActorTypeaheadResult) => {
      recordActorVisit(actor);
      finish(`/explore/${encodeRepo(actor.handle)}`);
    },
    [finish],
  );

  const goToEntry = useCallback(
    (entry: SearchHistoryEntry) => {
      // Re-picking bumps the count; merge logic keeps the stored avatar/handle.
      recordQueryVisit(entry.label, entry.path);
      finish(entry.path);
    },
    [finish],
  );

  const reloadHistory = useCallback(() => setHistory(readSearchHistory()), []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (highlightIndex >= 0 && suggestions[highlightIndex]) {
      goToActor(suggestions[highlightIndex]);
      return;
    }
    // A bare word ("dame") can't be a handle, DID, at:// URI or URL, all of
    // which carry a dot, colon or slash, so resolving it only ever ended on
    // "That handle didn't resolve." Take the best suggestion instead.
    if (!/[.:/]/.test(value.trim()) && suggestions.length > 0) {
      goToActor(suggestions[0]);
      return;
    }
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    try {
      // Async so an unrecognized URL can be resolved through its AT Tags.
      const path = await resolveSearchPathAsync(value);
      if (!path) return;
      recordQueryVisit(value, path);
      finish(path);
    } finally {
      resolvingRef.current = false;
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      if (isBar) inputRef.current?.blur();
      onDone();
      return;
    }
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    }
  }

  const showList = suggestions.length > 0;
  const recents = getRecents(history, RECENTS_LIMIT);
  const frequent = getFrequent(history, FREQUENT_LIMIT);
  // Recommendations only show on an empty input (typeahead takes over once
  // the user starts typing).
  const showRecommendations =
    !showList && value.trim() === '' && (recents.length > 0 || frequent.length > 0);
  // The bar variant is always on screen, so its suggestions only drop down
  // while the input has focus; the panel variant is only mounted-and-visible
  // while open, so it shows them whenever there are any.
  const dropdownOpen = isBar ? focused : true;

  return (
    <form
      onSubmit={onSubmit}
      role={isBar ? 'search' : undefined}
      className={isBar ? 'fn-search fn-search-bar' : 'fn-search fn-search-panel'}
    >
      <label className="fn-search-field">
        <Search size={15} aria-hidden className="fn-search-icon" />
        <span className="fn-sr-only">Go to a handle, DID or at:// URI</span>
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={isBar ? 'Go to a handle, DID or at:// URI' : 'handle, DID, or URL'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (!isBar) return;
            setFocused(true);
            setHistory(readSearchHistory());
          }}
          onBlur={() => setFocused(false)}
          role="combobox"
          aria-expanded={showList && dropdownOpen}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={
            highlightIndex >= 0 ? `${listId}-${highlightIndex}` : undefined
          }
          className="fn-search-input"
        />
        {isBar && hint && !focused && value === '' && (
          <kbd className="fn-kbd" title="Command palette: jump anywhere">
            {hint}
          </kbd>
        )}
      </label>

      {dropdownOpen && (showList || showRecommendations) && (
        <div
          className="fn-search-dropdown"
          // In the bar variant the list sits under a focused input; keep a
          // click inside it from blurring that input (which would close the
          // dropdown before the click lands).
          onMouseDown={isBar ? (e) => e.preventDefault() : undefined}
        >
          {showList && (
            <ul id={listId} role="listbox" className="fn-search-list">
              {suggestions.map((actor, i) => {
                const isActive = i === highlightIndex;
                return (
                  <li
                    key={actor.did}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(e) => {
                      // mousedown beats the input's blur so the click registers
                      // before any focus-related state change unmounts us.
                      e.preventDefault();
                      goToActor(actor);
                    }}
                    onMouseEnter={() => setHighlightIndex(i)}
                    className="fn-search-option"
                    data-active={isActive || undefined}
                  >
                    {actor.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={actor.avatar}
                        alt=""
                        width={24}
                        height={24}
                        className="fn-search-avatar"
                      />
                    ) : (
                      <span className="fn-search-avatar" />
                    )}
                    <div style={{ minWidth: 0, lineHeight: 1.25 }}>
                      {actor.displayName?.trim() && (
                        <div className="fn-search-name">{actor.displayName}</div>
                      )}
                      <div className="fn-search-handle">@{actor.handle}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {showRecommendations && (
            <div className="fn-search-recs">
              <SearchRecommendations
                recents={recents}
                frequent={frequent}
                onPick={goToEntry}
                onEnriched={reloadHistory}
              />
            </div>
          )}
        </div>
      )}
    </form>
  );
}

/**
 * Typeahead results with the handles that match what was typed moved to the
 * front: an exact handle, then handles whose first label is the query
 * ("dame" → dame.is), then other prefixes, then the search's own order.
 * The search ranks by its own relevance, which put @dame.is third for
 * "dame". The sort is stable, so ties keep that order.
 */
function rankByHandle(results: ActorTypeaheadResult[], query: string): ActorTypeaheadResult[] {
  const q = query.toLowerCase().replace(/^@/, '');
  const rank = (actor: ActorTypeaheadResult) => {
    const handle = actor.handle.toLowerCase();
    if (handle === q) return 0;
    if (handle.startsWith(`${q}.`)) return 1;
    if (handle.startsWith(q)) return 2;
    return 3;
  };
  return [...results].sort((a, b) => rank(a) - rank(b));
}
