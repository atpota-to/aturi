'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FolderTree, Search } from 'lucide-react';
import { searchLexicons } from '@/utils/ufos/client';
import { type NsidCount } from '@/utils/ufos/config';
import { formatCount } from '@/utils/ufos/format';
import { groupPathFor, lexiconPathFor } from '@/utils/ufos/nsid';

const TYPEAHEAD_DEBOUNCE_MS = 180;
const SUGGESTION_LIMIT = 12;

/** Count of alphanumeric/hyphen chars — the UFOs /search minimum is 2. */
function alnumLen(s: string): number {
  return (s.match(/[a-z0-9-]/gi) || []).length;
}

/**
 * Debounced lexicon search box for the lexicons explorer. Hits the UFOs
 * `/search` endpoint and routes the chosen NSID to its detail page.
 * Modeled on the explore SearchBox (debounce, keyboard nav, click-outside)
 * but without the actor/history machinery.
 */
export default function LexiconSearchBox() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<NsidCount[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = value.trim();
    if (alnumLen(trimmed) < 2) {
      setSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      const results = await searchLexicons(trimmed, controller.signal);
      // The API returns matches roughly alphabetically; sort by creates so
      // well-known lexicons surface above obscure same-prefix ones, and cap
      // the dropdown to a manageable length.
      const ranked = [...results].sort((a, b) => b.creates - a.creates).slice(0, SUGGESTION_LIMIT);
      setSuggestions(ranked);
      setHighlightIndex(-1);
    }, TYPEAHEAD_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [value]);

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

  function go(nsid: string) {
    setShowSuggestions(false);
    router.push(lexiconPathFor(nsid));
  }

  function goGroup(term: string) {
    setShowSuggestions(false);
    router.push(groupPathFor(term));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (highlightIndex >= 0 && suggestions[highlightIndex]) {
      go(suggestions[highlightIndex].nsid);
      return;
    }
    const trimmed = value.trim();
    if (alnumLen(trimmed) < 2) return;
    // An exact match to a known collection opens its detail page;
    // otherwise treat the input as a namespace / search term and route to
    // the group page (which lists the namespace via /prefix, or falls back
    // to /search for single-segment terms).
    if (suggestions.some((s) => s.nsid === trimmed)) go(trimmed);
    else goGroup(trimmed);
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

  const trimmed = value.trim();
  // Offer "browse this namespace" when the query reads like a dotted
  // prefix (e.g. net.anisota) — that's what /prefix can enumerate.
  const showNsRow = trimmed.includes('.') && alnumLen(trimmed) >= 2;
  const showList = showSuggestions && suggestions.length > 0;
  const showDropdown = showSuggestions && (showList || showNsRow);

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', alignItems: 'stretch', gap: '0.5rem', position: 'relative' }}>
      <div ref={wrapRef} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
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
          placeholder="search lexicons — e.g. app.bsky.feed.post, grain, smokesignal"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={(e) => {
            setShowSuggestions(true);
            e.currentTarget.style.borderColor = 'var(--text-accent)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-medium)';
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls="lexicon-typeahead-list"
          aria-activedescendant={
            highlightIndex >= 0 ? `lexicon-typeahead-${highlightIndex}` : undefined
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

        {showDropdown && (
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
              maxHeight: '24rem',
              overflowY: 'auto',
            }}
          >
            {showNsRow && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  goGroup(trimmed);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  border: 0,
                  borderBottom: showList ? '1px solid var(--border-subtle)' : 'none',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-serif)',
                  fontSize: '0.8rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-tertiary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <FolderTree size={14} aria-hidden style={{ color: 'var(--text-accent)', flexShrink: 0 }} />
                <span>
                  Browse all of{' '}
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                    {trimmed}
                  </span>
                </span>
              </button>
            )}
            {showList && (
              <ul
                id="lexicon-typeahead-list"
                role="listbox"
                style={{ listStyle: 'none', margin: 0, padding: 0 }}
              >
                {suggestions.map((m, i) => {
              const active = i === highlightIndex;
              return (
                <li
                  key={m.nsid}
                  id={`lexicon-typeahead-${i}`}
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(m.nsid);
                  }}
                  onMouseEnter={() => setHighlightIndex(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    padding: '0.5rem 0.75rem',
                    background: active ? 'var(--bg-tertiary)' : 'transparent',
                    borderBottom:
                      i < suggestions.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    cursor: 'pointer',
                    transition: 'background 0.12s ease',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.8rem',
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.nsid}
                  </span>
                  <span
                    title={`${m.creates.toLocaleString()} creates`}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.72rem',
                      color: 'var(--text-tertiary)',
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatCount(m.creates)}
                  </span>
                </li>
              );
                })}
              </ul>
            )}
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
        Search
      </button>
    </form>
  );
}
