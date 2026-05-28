'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { encodeRepo } from '@/utils/atproto/urls';
import { resolveSearchPath } from '@/utils/atproto/searchRouting';
import {
  searchActorsTypeahead,
  type ActorTypeaheadResult,
} from '@/utils/atproto/appview';

const TYPEAHEAD_DEBOUNCE_MS = 180;

type Props = {
  /** When the header opens this panel, set to true to focus the input. */
  active: boolean;
  /** Called after a navigation/submit so the parent can close the panel. */
  onDone: () => void;
};

/**
 * Lightweight search box for the compact header's expanding panel. Mirrors
 * the explorer's SearchBox typeahead + at:// shortcuts but is styled to
 * fit inside the slim header card and intentionally omits the standalone
 * "Look up" button (the input alone is the UI).
 */
export default function CompactSearchPanel({ active, onDone }: Props) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<ActorTypeaheadResult[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select existing text whenever the panel becomes active. Using
  // a microtask so the input is mounted and visible before we focus it
  // (the parent panel animates in via transform/opacity).
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => {
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
      setSuggestions(results);
      setHighlightIndex(-1);
    }, TYPEAHEAD_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [value]);

  const goTo = useCallback(
    (handleOrDid: string) => {
      router.push(`/explore/${encodeRepo(handleOrDid)}`);
      setValue('');
      setSuggestions([]);
      onDone();
    },
    [router, onDone],
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (highlightIndex >= 0 && suggestions[highlightIndex]) {
      goTo(suggestions[highlightIndex].handle);
      return;
    }
    const path = resolveSearchPath(value);
    if (!path) return;
    router.push(path);
    setValue('');
    setSuggestions([]);
    onDone();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
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

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ position: 'relative' }}>
        <Search
          size={16}
          style={{
            position: 'absolute',
            top: '50%',
            transform: 'translateY(-50%)',
            left: '0.75rem',
            color: 'var(--text-tertiary)',
            pointerEvents: 'none',
          }}
        />
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="handle, DID, at:// URI, or PDS URL"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
          aria-controls="compact-search-typeahead-list"
          aria-activedescendant={
            highlightIndex >= 0 ? `compact-search-typeahead-${highlightIndex}` : undefined
          }
          style={{
            width: '100%',
            padding: '0.55rem 0.75rem 0.55rem 2.25rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.78rem',
            outline: 'none',
          }}
        />
      </div>

      {showList && (
        <ul
          id="compact-search-typeahead-list"
          role="listbox"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            maxHeight: '18rem',
            overflowY: 'auto',
          }}
        >
          {suggestions.map((actor, i) => {
            const active = i === highlightIndex;
            return (
              <li
                key={actor.did}
                id={`compact-search-typeahead-${i}`}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  // mousedown beats the input's blur so the click registers
                  // before any focus-related state change unmounts us.
                  e.preventDefault();
                  goTo(actor.handle);
                }}
                onMouseEnter={() => setHighlightIndex(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.4rem 0.6rem',
                  background: active ? 'var(--bg-elevated)' : 'transparent',
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
                    width={24}
                    height={24}
                    style={{
                      width: 24,
                      height: 24,
                      objectFit: 'cover',
                      background: 'var(--bg-secondary)',
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      background: 'var(--bg-secondary)',
                      flexShrink: 0,
                    }}
                  />
                )}
                <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                  {actor.displayName?.trim() && (
                    <div
                      style={{
                        fontSize: '0.8125rem',
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
                      fontSize: '0.7rem',
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
    </form>
  );
}
