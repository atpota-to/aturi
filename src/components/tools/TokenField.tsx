'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

export type FieldToken = {
  value: string;
  /** Shown after the value, e.g. "resolving…". */
  note?: string;
  state?: 'ok' | 'pending' | 'error';
  title?: string;
};

type Props = {
  label: string;
  hint?: ReactNode;
  placeholder: string;
  tokens: FieldToken[];
  /** Read one typed entry: the value to add, or why it was refused. */
  parse: (raw: string) => { value: string } | { error: string };
  onChange: (values: string[]) => void;
  max: number;
};

/**
 * A text field that turns what you type into removable chips. Enter, a
 * comma, a space or leaving the field adds what's there; a paste of several
 * entries adds them all. Entries the parser refuses stay in the field with
 * the reason under it, so a typo can be fixed rather than retyped.
 */
export default function TokenField({ label, hint, placeholder, tokens, parse, onChange, max }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const values = tokens.map((t) => t.value);

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

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(text);
    } else if (e.key === 'Backspace' && !text && values.length) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="fn-sm-field">
      <label htmlFor={id} className="explore-small-caps">
        {label}
      </label>
      <div
        className="fn-tokens"
        onClick={(e) => {
          if (e.target === e.currentTarget) inputRef.current?.focus();
        }}
      >
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
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            const next = e.target.value;
            // A space or comma typed (or pasted) ends an entry.
            if (/[\s,]/.test(next)) commit(next);
            else {
              setText(next);
              setError(null);
            }
          }}
          onKeyDown={onKeyDown}
          onBlur={() => commit(text)}
        />
      </div>
      {error ? (
        <p className="fn-sm-hint" data-error="" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="fn-sm-hint">{hint}</p>
      )}
    </div>
  );
}
