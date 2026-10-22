'use client';

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  searchActorsTypeahead,
  shouldQueryHandleTypeahead,
  type ActorTypeaheadResult,
} from '@/utils/atproto/appview';

/**
 * The handle field of the OAuth sign-in flow, with AppView typeahead.
 *
 * Three surfaces render the sign-in step — <SessionMenu>, <SessionPanel> and
 * <SignInPanel> — each with its own placeholder and input styling, so the
 * look comes in from the caller and only the behaviour lives here.
 *
 * Suggestions are strictly additive. The AppView typeahead only knows accounts
 * it indexes, which means a handle on a self-hosted PDS — or on the spaces
 * alpha PDS — will never appear in the list. So nothing here may stand between
 * a typed handle and the submit: no auto-selecting the first result, no
 * autofill on blur, no disabling submit until something matches, and no error
 * just because the lookup came back empty. Someone whose handle the AppView has
 * never heard of should not be able to tell this component from a plain input.
 *
 * Picking a suggestion fills the field and stops there rather than submitting.
 * The next step redirects off-site to an OAuth provider, and a keypress that
 * meant "use this name" shouldn't also mean "send me to my PDS" — the field
 * always shows exactly what will be submitted before it is.
 */

// Slightly longer than the explorer's 180ms: this field fires against a
// third-party AppView before the user has authenticated, so it waits for a
// real pause in typing rather than tracking the keystrokes closely.
const TYPEAHEAD_DEBOUNCE_MS = 250;
const TYPEAHEAD_LIMIT = 6;

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** The surface's own input styling; applied verbatim. */
  inputStyle: CSSProperties;
  /**
   * Applied to the positioning wrapper. Surfaces that make the input a flex
   * item pass the sizing here, since the wrapper becomes the flex item.
   */
  wrapperStyle?: CSSProperties;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Accessible name for the suggestion list, e.g. "Handle suggestions". */
  listLabel?: string;
  /**
   * Id for the input itself, so a surface with a real `<label htmlFor>` binds
   * to it. The sign-in surfaces label their field by surrounding copy and pass
   * nothing; a form field with its own label needs this.
   */
  id?: string;
  /** Id of the hint that describes the field, for `aria-describedby`. */
  describedBy?: string;
};

export default function HandleTypeaheadInput({
  value,
  onChange,
  placeholder,
  inputStyle,
  wrapperStyle,
  id,
  describedBy,
  disabled,
  autoFocus,
  listLabel = 'Matching accounts',
}: Props) {
  const [suggestions, setSuggestions] = useState<ActorTypeaheadResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Unique per mounted instance: SessionMenu and SessionPanel can both be in
  // the DOM at once, and duplicate option ids would point
  // aria-activedescendant at whichever happened to render first.
  const listId = useId();

  // Whether the current value is worth suggesting against. Results are
  // *derived* through this rather than cleared from the effect: editing back
  // down to two characters has to hide the list immediately, and doing that
  // with a setState inside the effect would cost a second render pass on
  // every keystroke.
  const queryable = shouldQueryHandleTypeahead(value);
  const visible = queryable ? suggestions : [];
  // A shrinking result set can strand the highlight past the end of the list.
  const activeIndex = highlightIndex < visible.length ? highlightIndex : -1;

  // Debounced lookup. The cleanup aborts the in-flight request and drops the
  // pending timer, so only the newest keystroke can ever land in state.
  useEffect(() => {
    if (!shouldQueryHandleTypeahead(value)) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const results = await searchActorsTypeahead(value.trim(), {
        limit: TYPEAHEAD_LIMIT,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setSuggestions(results);
      setHighlightIndex(-1);
    }, TYPEAHEAD_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const showList = open && visible.length > 0;

  const pick = useCallback(
    (actor: ActorTypeaheadResult) => {
      onChange(actor.handle);
      setOpen(false);
      setHighlightIndex(-1);
      inputRef.current?.focus();
    },
    [onChange],
  );

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Escape closes the list even when it's empty-but-open; it never reaches
    // an enclosing popover, which would otherwise dismiss the whole form.
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
      // Only swallows the submit when a row is genuinely highlighted, so the
      // default path — Enter on typed text — always reaches the form.
      e.preventDefault();
      pick(visible[activeIndex]);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', minWidth: 0, ...wrapperStyle }}>
      <input
        ref={inputRef}
        id={id}
        aria-describedby={describedBy}
        type="text"
        autoComplete="username"
        spellCheck={false}
        placeholder={placeholder}
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
        aria-activedescendant={
          activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
        }
        style={inputStyle}
      />

      {showList && (
        <ul id={listId} role="listbox" aria-label={listLabel} className="oauth-typeahead">
          {visible.map((actor, i) => {
            const active = i === activeIndex;
            return (
              <li
                key={actor.did}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  // mousedown beats the input's blur, so the row is still
                  // mounted when the click resolves.
                  e.preventDefault();
                  pick(actor);
                }}
                onMouseEnter={() => setHighlightIndex(i)}
                className={`oauth-typeahead-item ${active ? 'is-active' : ''}`}
              >
                {actor.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={actor.avatar}
                    alt=""
                    width={24}
                    height={24}
                    className="oauth-typeahead-avatar"
                  />
                ) : (
                  <span className="oauth-typeahead-avatar" />
                )}
                <div className="oauth-typeahead-text">
                  {actor.displayName?.trim() && (
                    <div className="oauth-typeahead-name">{actor.displayName}</div>
                  )}
                  <div className="oauth-typeahead-handle">{actor.handle}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
