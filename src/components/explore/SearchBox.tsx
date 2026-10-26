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
import SearchRecommendations from './SearchRecommendations';

const TYPEAHEAD_DEBOUNCE_MS = 180;
const RECENTS_LIMIT = 6;
const FREQUENT_LIMIT = 4;

const DEFAULT_PLACEHOLDER = 'Handle, DID, at:// URI or URL';

type Props = {
  initial?: string;
  /**
   * Extra class on the <form>, so a host can restyle the field from its own
   * sheet (the shape lives in globals.css under `.fn-searchbox`, with no inline
   * styles to fight).
   */
  className?: string;
  /** Visible placeholder; the accessible name stays the full description. */
  placeholder?: string;
};

export default function SearchBox({ initial, className, placeholder }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(initial || '');
  const [suggestions, setSuggestions] = useState<ActorTypeaheadResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  // Submitting an unrecognized URL costs a round trip to /api/at-tags, so the
  // input reflects that instead of appearing to swallow the Enter key.
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShowSuggestions(false);
    // If the user has a suggestion highlighted, jump to that — otherwise
    // fall through to the existing free-text routing.
    if (highlightIndex >= 0 && suggestions[highlightIndex]) {
      goToActor(suggestions[highlightIndex]);
      return;
    }
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setResolving(true);
    try {
      // Async so an unrecognized URL gets a chance to tell us, via its AT
      // Tags, which record it's actually about.
      const path = await resolveSearchPathAsync(value);
      if (!path) return;
      recordQueryVisit(value, path);
      router.push(path);
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
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
      className={className ? `fn-searchbox ${className}` : 'fn-searchbox'}
    >
      <div ref={wrapRef} className="fn-searchbox-field">
        <Search size={17} aria-hidden className="fn-searchbox-icon" />
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          className="fn-searchbox-input"
          placeholder={placeholder ?? DEFAULT_PLACEHOLDER}
          aria-label={DEFAULT_PLACEHOLDER}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => {
            setShowSuggestions(true);
            // Refresh so visits recorded since mount (this tab or another)
            // show up.
            setHistory(readSearchHistory());
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
          aria-controls="search-typeahead-list"
          aria-activedescendant={
            highlightIndex >= 0 ? `search-typeahead-${highlightIndex}` : undefined
          }
        />

        {showList && (
          <ul
            id="search-typeahead-list"
            role="listbox"
            className="fn-searchbox-pop"
            style={{ listStyle: 'none', margin: 0, padding: 0 }}
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
                        borderRadius: '50%',
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
                        borderRadius: '50%',
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
                          fontWeight: 600,
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
          <div className="fn-searchbox-pop">
            <SearchRecommendations
              recents={recents}
              frequent={frequent}
              onPick={goToEntry}
              onEnriched={reloadHistory}
            />
          </div>
        )}
      </div>

      <button type="submit" disabled={resolving} className="fn-searchbox-submit">
        {resolving ? 'Looking…' : 'Look up'}
      </button>
    </form>
  );
}
