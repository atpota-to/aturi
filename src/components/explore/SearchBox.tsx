'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Search } from 'lucide-react';
import { encodeRepo } from '@/utils/atproto/urls';
import { resolveSearchPath } from '@/utils/atproto/searchRouting';
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
import SearchRecommendations from './SearchRecommendations';

const TYPEAHEAD_DEBOUNCE_MS = 180;
const RECENTS_LIMIT = 6;
const FREQUENT_LIMIT = 4;

export default function SearchBox({ initial }: { initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial || '');
  const [suggestions, setSuggestions] = useState<ActorTypeaheadResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setValue(initial || '');
  }, [initial]);

  // Load locally-stored history once on mount so recommendations are ready
  // the first time the input is focused. Refreshed again on each focus.
  useEffect(() => {
    setHistory(readSearchHistory());
  }, []);

  // Debounced typeahead lookup. Skips DIDs and at:// URIs since the
  // appview typeahead is handle/display-name oriented.
  useEffect(() => {
    const trimmed = value.trim();
    if (
      !trimmed ||
      trimmed.startsWith('did:') ||
      trimmed.startsWith('at://') ||
      trimmed.length < 2
    ) {
      setSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      const results = await searchActorsTypeahead(trimmed, {
        limit: 8,
        signal: controller.signal,
      });
      setSuggestions(results);
      setHighlightIndex(-1);
    }, TYPEAHEAD_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [value]);

  // Close suggestions on outside click.
  useEffect(() => {
    if (!showSuggestions) return undefined;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showSuggestions]);

  const goToActor = useCallback(
    (actor: ActorTypeaheadResult) => {
      recordActorVisit(actor);
      router.push(`/explore/${encodeRepo(actor.handle)}`);
      setShowSuggestions(false);
    },
    [router],
  );

  const goToEntry = useCallback(
    (entry: SearchHistoryEntry) => {
      // Re-picking bumps the count; merge logic keeps the stored avatar/handle.
      recordQueryVisit(entry.label, entry.path);
      router.push(entry.path);
      setShowSuggestions(false);
    },
    [router],
  );

  const reloadHistory = useCallback(() => setHistory(readSearchHistory()), []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShowSuggestions(false);
    // If the user has a suggestion highlighted, jump to that — otherwise
    // fall through to the existing free-text routing.
    if (highlightIndex >= 0 && suggestions[highlightIndex]) {
      goToActor(suggestions[highlightIndex]);
      return;
    }
    const path = resolveSearchPath(value);
    if (!path) return;
    recordQueryVisit(value, path);
    router.push(path);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  }

  const showList = showSuggestions && suggestions.length > 0;
  const recents = getRecents(history, RECENTS_LIMIT);
  const frequent = getFrequent(history, FREQUENT_LIMIT);
  // Recommendations only show on an empty, focused input — once the user types,
  // the typeahead list takes over.
  const showRecommendations =
    showSuggestions &&
    !showList &&
    value.trim() === '' &&
    (recents.length > 0 || frequent.length > 0);

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: '0.5rem',
        marginBottom: '2rem',
        position: 'relative',
      }}
    >
      <div
        ref={wrapRef}
        style={{
          flex: 1,
          minWidth: 0,
          position: 'relative',
        }}
      >
        <Search
          size={16}
          style={{
            position: 'absolute',
            top: '50%',
            transform: 'translateY(-50%)',
            left: '0.875rem',
            color: 'var(--text-tertiary)',
            pointerEvents: 'none',
          }}
        />
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="handle, DID, at:// URI, or URL"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={(e) => {
            setShowSuggestions(true);
            // Refresh so visits recorded since mount (this tab or another)
            // show up.
            setHistory(readSearchHistory());
            e.currentTarget.style.borderColor = 'var(--text-accent)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-medium)';
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
          aria-controls="search-typeahead-list"
          aria-activedescendant={
            highlightIndex >= 0 ? `search-typeahead-${highlightIndex}` : undefined
          }
          style={{
            width: '100%',
            padding: '0.75rem 0.875rem 0.75rem 2.5rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            outline: 'none',
            transition: 'border-color 0.2s ease',
          }}
        />

        {showList && (
          <ul
            id="search-typeahead-list"
            role="listbox"
            style={{
              position: 'absolute',
              top: 'calc(100% + 0.25rem)',
              left: 0,
              right: 0,
              listStyle: 'none',
              margin: 0,
              padding: 0,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              boxShadow: 'var(--shadow-overlay)',
              zIndex: 30,
              maxHeight: '22rem',
              overflowY: 'auto',
            }}
          >
            {suggestions.map((actor, i) => {
              const active = i === highlightIndex;
              return (
                <li
                  key={actor.did}
                  id={`search-typeahead-${i}`}
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    // mousedown beats the input's blur so the click registers
                    // before the suggestion list unmounts.
                    e.preventDefault();
                    goToActor(actor);
                  }}
                  onMouseEnter={() => setHighlightIndex(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.625rem',
                    padding: '0.5rem 0.75rem',
                    background: active ? 'var(--bg-tertiary)' : 'transparent',
                    borderBottom:
                      i < suggestions.length - 1
                        ? '1px solid var(--border-subtle)'
                        : 'none',
                    cursor: 'pointer',
                    transition: 'background 0.12s ease',
                  }}
                >
                  {actor.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={actor.avatar}
                      alt=""
                      width={26}
                      height={26}
                      style={{
                        width: 26,
                        height: 26,
                        objectFit: 'cover',
                        background: 'var(--bg-tertiary)',
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        background: 'var(--bg-tertiary)',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                    {actor.displayName?.trim() && (
                      <div
                        style={{
                          fontSize: '0.875rem',
                          color: 'var(--text-primary)',
                          fontFamily: 'var(--font-serif)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {actor.displayName}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-tertiary)',
                        fontFamily: 'var(--font-mono)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      @{actor.handle}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {showRecommendations && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 0.25rem)',
              left: 0,
              right: 0,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              boxShadow: 'var(--shadow-overlay)',
              zIndex: 30,
              maxHeight: '22rem',
              overflowY: 'auto',
            }}
          >
            <SearchRecommendations
              recents={recents}
              frequent={frequent}
              onPick={goToEntry}
              onEnriched={reloadHistory}
            />
          </div>
        )}
      </div>

      <button
        type="submit"
        style={{
          padding: '0.75rem 1.25rem',
          background: 'var(--accent-moss)',
          color: 'var(--text-on-accent)',
          border: '1px solid var(--accent-moss)',
          fontFamily: 'var(--font-serif)',
          fontSize: '0.95rem',
          cursor: 'pointer',
          transition: 'background 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--accent-forest)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--accent-moss)';
        }}
      >
        Look up
      </button>
    </form>
  );
}
