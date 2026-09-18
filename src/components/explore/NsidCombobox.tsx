'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { searchLexicons } from '@/utils/ufos/client';

/**
 * The collection field of the record composer: type an NSID, or find one.
 *
 * Two sources, in the order they are useful. Your own collections come first
 * and match locally, because the common case is adding another record of a
 * kind you already have, and that answer should arrive without a network trip.
 * Behind them, the same network-wide lexicon search the lexicons explorer uses,
 * so the other common case — "I saw a lexicon and want one of my own" — doesn't
 * require having memorised the NSID.
 *
 * Suggestions never stand between a typed NSID and the write. The composer is
 * for writing records of any type, including one whose lexicon has never been
 * published and which therefore appears in neither list; someone typing such an
 * NSID should not be able to tell this from a plain input. So: nothing is
 * auto-selected, nothing is filled in on blur, and an empty result is not an
 * error.
 *
 * Built on the same combobox pattern as <HandleTypeaheadInput> — the roles, the
 * activedescendant, the mousedown-before-blur — rather than sharing code with
 * it, because the two differ in almost everything but that pattern: two result
 * sources, local matching, and a grouped list.
 */

const SEARCH_DEBOUNCE_MS = 220;
const OWN_LIMIT = 6;
const NETWORK_LIMIT = 6;

type Suggestion = {
  nsid: string;
  /** Where it came from, which the row shows so the two are told apart. */
  origin: 'yours' | 'network';
  /** Records seen network-wide, for the network rows. */
  count?: number;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** The signed-in account's own collection NSIDs, or null while unknown. */
  ownCollections: Set<string> | null;
  id?: string;
  describedBy?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  inputStyle?: CSSProperties;
};

export default function NsidCombobox({
  value,
  onChange,
  ownCollections,
  id,
  describedBy,
  disabled,
  autoFocus,
  inputStyle,
}: Props) {
  const [network, setNetwork] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const query = value.trim().toLowerCase();

  /**
   * Your own collections, narrowed by what's typed. An exact match is dropped:
   * offering the value already in the field is a row that can only be a no-op.
   */
  const own = useMemo<Suggestion[]>(() => {
    if (!ownCollections) return [];
    return [...ownCollections]
      .filter((nsid) => nsid.toLowerCase() !== query)
      .filter((nsid) => !query || nsid.toLowerCase().includes(query))
      .sort()
      .slice(0, OWN_LIMIT)
      .map((nsid) => ({ nsid, origin: 'yours' as const }));
  }, [ownCollections, query]);

  // Debounced network search, aborted on every new keystroke so only the
  // newest can land. Failures are silent — the local list is still there, and
  // an outage in a third-party index is not this field's news to report.
  useEffect(() => {
    if (query.length < 2) {
      setNetwork([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const matches = await searchLexicons(query, controller.signal);
        if (controller.signal.aborted) return;
        setNetwork(
          matches
            .slice(0, NETWORK_LIMIT)
            .map((m) => ({ nsid: m.nsid, origin: 'network' as const, count: m.dids_estimate })),
        );
        setHighlightIndex(-1);
      } catch {
        if (!controller.signal.aborted) setNetwork([]);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const visible = useMemo<Suggestion[]>(() => {
    const seen = new Set(own.map((s) => s.nsid));
    const fromNetwork = network.filter(
      (s) => !seen.has(s.nsid) && s.nsid.toLowerCase() !== query,
    );
    return [...own, ...fromNetwork];
  }, [own, network, query]);

  // A shrinking list can strand the highlight past its end.
  const activeIndex = highlightIndex < visible.length ? highlightIndex : -1;
  const showList = open && visible.length > 0;

  useEffect(() => {
    if (!open) return undefined;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const pick = useCallback(
    (suggestion: Suggestion) => {
      onChange(suggestion.nsid);
      setOpen(false);
      setHighlightIndex(-1);
      inputRef.current?.focus();
    },
    [onChange],
  );

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      setHighlightIndex(-1);
      return;
    }
    if (!showList) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % visible.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? visible.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0 && visible[activeIndex]) {
      // Only swallows Enter when a row is genuinely highlighted, so Enter on
      // typed text still does whatever the surrounding form does with it.
      e.preventDefault();
      pick(visible[activeIndex]);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', minWidth: 0 }}>
      <input
        ref={inputRef}
        id={id}
        aria-describedby={describedBy}
        className="explore-input explore-mono"
        type="text"
        spellCheck={false}
        autoCapitalize="none"
        autoComplete="off"
        placeholder="com.example.record"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        aria-controls={showList ? listId : undefined}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        style={inputStyle}
      />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching collections"
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
            maxHeight: '18rem',
            overflowY: 'auto',
          }}
        >
          {visible.map((suggestion, i) => {
            const active = i === activeIndex;
            return (
              <li
                key={`${suggestion.origin}:${suggestion.nsid}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  // mousedown beats the input's blur, so the row is still
                  // mounted when the click resolves.
                  e.preventDefault();
                  pick(suggestion);
                }}
                onMouseEnter={() => setHighlightIndex(i)}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '0.5rem',
                  padding: '0.4rem 0.625rem',
                  background: active ? 'var(--bg-tertiary)' : 'transparent',
                  borderBottom:
                    i < visible.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  cursor: 'pointer',
                  transition: 'background 0.12s ease',
                }}
              >
                <code
                  style={{
                    background: 'transparent',
                    padding: 0,
                    fontSize: '0.8rem',
                    color: 'var(--text-primary)',
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {suggestion.nsid}
                </code>
                <span
                  style={{
                    fontSize: '0.7rem',
                    letterSpacing: '0.04em',
                    color:
                      suggestion.origin === 'yours'
                        ? 'var(--text-accent)'
                        : 'var(--text-tertiary)',
                    flexShrink: 0,
                    fontFamily: 'var(--font-serif)',
                  }}
                >
                  {suggestion.origin === 'yours'
                    ? 'in your repo'
                    : suggestion.count
                      ? `${formatAccounts(suggestion.count)} accounts`
                      : 'network'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Account counts run to seven figures; the row has room for three characters. */
function formatAccounts(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
