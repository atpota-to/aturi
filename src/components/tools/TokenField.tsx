'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

export type FieldToken = {
  value: string;
  /** Shown after the value, e.g. "resolving…". */
  note?: string;
  state?: 'ok' | 'pending' | 'error';
  title?: string;
};

export type Suggestion = {
  value: string;
  title: string;
  detail?: string;
  avatar?: string;
  /** Anything the picker wants back, e.g. an account's DID. */
  did?: string;
};

type Props = {
  /** Accessible name; the field shows `placeholder` and `icon` instead of a label. */
  label: string;
  icon: ReactNode;
  /** How the field reads its input. Tooltip, and the field's description. */
  hint: string;
  placeholder: string;
  tokens: FieldToken[];
  /** Read one typed entry: the value to add, or why it was refused. */
  parse: (raw: string) => { value: string } | { error: string };
  onChange: (values: string[]) => void;
  max: number;
  /** Optional suggestions for what's being typed. */
  suggest?: (query: string, signal: AbortSignal) => Promise<Suggestion[]>;
  /** Runs when a suggestion is chosen. Defaults to adding its value. */
  onPick?: (suggestion: Suggestion) => void;
  className?: string;
};

const SUGGEST_DEBOUNCE_MS = 200;

/**
 * A text field that turns what you type into removable chips. Enter, a
 * comma, a space or leaving the field adds what's there; a paste of several
 * entries adds them all. Entries the parser refuses stay in the field with
 * the reason under it, so a typo can be fixed rather than retyped.
 *
 * Suggestions, when offered, only ever add to what typing can do: Enter on
 * typed text still adds the text, and a suggestion is taken only when one is
 * highlighted or clicked, as in the sign-in field's handle typeahead.
 */
export default function TokenField({
  label,
  icon,
  hint,
  placeholder,
  tokens,
  parse,
  onChange,
  max,
  suggest,
  onPick,
  className,
}: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<{ query: string; items: Suggestion[] }>({
    query: '',
    items: [],
  });
  const [highlight, setHighlight] = useState(-1);
  const values = tokens.map((t) => t.value);

  // Derived rather than cleared from the effect, so editing the text hides a
  // stale list at once instead of after a second render.
  const query = text.trim();
  const visible =
    open && query && suggestions.query === query
      ? suggestions.items.filter((s) => !values.includes(s.value))
      : [];
  const active = highlight < visible.length ? highlight : -1;

  useEffect(() => {
    if (!suggest || !query) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const items = await suggest(query, controller.signal).catch(() => []);
      if (controller.signal.aborted) return;
      setSuggestions({ query, items });
      setHighlight(-1);
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [suggest, query]);

  function commit(input: string): void {
    const pieces = input.split(/[\s,]+/).filter(Boolean);
    if (!pieces.length) {
      setText('');
      setError(null);
      return;
    }
    const added: string[] = [];
    const refused: string[] = [];
    let reason: string | null = null;
    for (const piece of pieces) {
      const result = parse(piece);
      if ('error' in result) {
        refused.push(piece);
        reason ??= result.error;
      } else if (!values.includes(result.value) && !added.includes(result.value)) {
        added.push(result.value);
      }
    }
    const room = Math.max(0, max - values.length);
    if (added.length > room) reason ??= `Up to ${max} at a time.`;
    if (added.length && room) onChange([...values, ...added.slice(0, room)]);
    setText(refused.join(' '));
    setError(reason);
  }

  function pick(suggestion: Suggestion): void {
    if (values.length >= max) {
      setError(`Up to ${max} at a time.`);
      return;
    }
    if (onPick) onPick(suggestion);
    else onChange([...values, suggestion.value]);
    setText('');
    setError(null);
    setHighlight(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape' && visible.length) {
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' && visible.length) {
      e.preventDefault();
      setHighlight((i) => (i + 1) % visible.length);
    } else if (e.key === 'ArrowUp' && visible.length) {
      e.preventDefault();
      setHighlight((i) => (i <= 0 ? visible.length - 1 : i - 1));
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (e.key === 'Enter' && active >= 0) pick(visible[active]);
      else commit(text);
    } else if (e.key === 'Backspace' && !text && values.length) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className={`fn-sm-field${className ? ` ${className}` : ''}`}>
      <div
        className="fn-tokens"
        title={hint}
        onClick={(e) => {
          if (e.target === e.currentTarget) inputRef.current?.focus();
        }}
      >
        <span className="fn-tokens-icon" aria-hidden>
          {icon}
        </span>
        {tokens.map((t) => (
          <span key={t.value} className="fn-token" data-state={t.state ?? 'ok'} title={t.title}>
            <span className="fn-token-text">{t.value}</span>
            {t.note && <span className="fn-token-note">{t.note}</span>}
            <button
              type="button"
              className="fn-token-remove"
              aria-label={`Remove ${t.value}`}
              onClick={() => onChange(values.filter((v) => v !== t.value))}
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="text"
          className="fn-tokens-input"
          value={text}
          placeholder={tokens.length ? '' : placeholder}
          aria-label={label}
          aria-describedby={hintId}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-invalid={error ? true : undefined}
          role={suggest ? 'combobox' : undefined}
          aria-expanded={suggest ? visible.length > 0 : undefined}
          aria-autocomplete={suggest ? 'list' : undefined}
          aria-controls={suggest && visible.length ? listId : undefined}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            const next = e.target.value;
            setOpen(true);
            // A space or comma typed (or pasted) ends an entry.
            if (/[\s,]/.test(next)) commit(next);
            else {
              setText(next);
              setError(null);
            }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setOpen(false);
            commit(text);
          }}
        />
        {visible.length > 0 && (
          <ul id={listId} role="listbox" aria-label={`${label} suggestions`} className="oauth-typeahead">
            {visible.map((s, i) => (
              <li
                key={s.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown beats the input's blur, so the row is still
                // mounted when the click resolves.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`oauth-typeahead-item${i === active ? ' is-active' : ''}`}
              >
                {s.avatar !== undefined &&
                  (s.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.avatar} alt="" width={24} height={24} className="oauth-typeahead-avatar" />
                  ) : (
                    <span className="oauth-typeahead-avatar" />
                  ))}
                <div className="oauth-typeahead-text">
                  <div className="oauth-typeahead-name">{s.title}</div>
                  {s.detail && <div className="oauth-typeahead-handle">{s.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <span id={hintId} className="fn-sr-only">
        {hint}
      </span>
      {error && (
        <p className="fn-sm-hint" data-error="" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
