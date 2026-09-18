'use client';

import { useEffect, useState } from 'react';
import type { Lexicon, LexiconField } from '@/utils/atproto/lexicons';

/**
 * The controls a record form is built from, shared by the two places records
 * are written: <RecordEditor>, which edits one that exists, and
 * <NewRecordDialog>, which composes one that doesn't.
 *
 * They were <RecordEditor>'s own until the composer needed the same set. Kept
 * together here for the reason `recordBackend.ts` gives for its interface:
 * these are the parts a user can see, and two copies of them would drift.
 */

export function FormEditor({
  lex,
  value,
  onChange,
}: {
  lex: Lexicon;
  value: Record<string, unknown>;
  onChange: (key: string, v: unknown) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {lex.fields.map((f) => (
        <Field key={f.key} field={f} value={value[f.key]} onChange={(v) => onChange(f.key, v)} />
      ))}
    </div>
  );
}

export function Field({
  field,
  value,
  onChange,
}: {
  field: LexiconField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  let control: React.ReactNode;
  switch (field.type) {
    case 'textarea':
      control = (
        <textarea
          className="explore-input explore-textarea"
          rows={4}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
          maxLength={field.maxLength}
        />
      );
      break;
    case 'markdown':
      control = (
        <textarea
          className="explore-input explore-textarea explore-mono"
          rows={14}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'datetime':
      control = <DatetimeField value={value as string} onChange={(v) => onChange(v)} />;
      break;
    case 'select':
      control = (
        <SelectField
          options={field.options || []}
          open={Boolean(field.openOptions)}
          required={Boolean(field.required)}
          value={(value as string) ?? ''}
          onChange={(v) => onChange(v)}
        />
      );
      break;
    case 'tags':
      control = (
        <input
          className="explore-input"
          type="text"
          value={Array.isArray(value) ? value.join(', ') : ''}
          onChange={(e) => {
            const parts = e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            onChange(parts);
          }}
          placeholder="comma, separated"
        />
      );
      break;
    case 'number':
      control = (
        <input
          className="explore-input"
          type="number"
          value={(value as number | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
      break;
    case 'boolean':
      control = (
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.875rem',
          }}
        >
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );
      break;
    case 'json':
      control = <JsonField value={value} onChange={onChange} />;
      break;
    case 'text':
    default:
      control = (
        <input
          className="explore-input"
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
          maxLength={field.maxLength}
        />
      );
  }

  return (
    <FieldShell
      label={field.type === 'boolean' ? '' : field.label}
      required={field.required}
      hint={field.hint}
      charCount={
        field.maxLength && typeof value === 'string'
          ? `${value.length} / ${field.maxLength}`
          : null
      }
    >
      {control}
    </FieldShell>
  );
}

export function FieldShell({
  label,
  required,
  hint,
  charCount,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  charCount?: string | null;
  children: React.ReactNode;
}) {
  // The whole field is a <label> wrapping its control, so every input in the
  // editor gets an implicit programmatic label (previously the caption was a
  // bare <label> with no htmlFor, leaving each control announced as unlabeled).
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {label && (
        <span
          className="explore-small-caps"
          style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}
        >
          {label}
          {required && <span style={{ color: 'var(--danger)' }}> *</span>}
        </span>
      )}
      {children}
      {(hint || charCount) && (
        <span
          style={{
            display: 'block',
            margin: 0,
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
          }}
        >
          {hint}
          {hint && charCount ? ' · ' : ''}
          {charCount}
        </span>
      )}
    </label>
  );
}

export function DatetimeField({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const local = isoToLocalInput(value);
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        className="explore-input"
        type="datetime-local"
        step={1}
        value={local}
        onChange={(e) => onChange(localInputToIso(e.target.value))}
      />
      <button
        type="button"
        onClick={() => onChange(new Date().toISOString())}
        style={{
          background: 'transparent',
          border: 0,
          color: 'var(--text-accent)',
          fontFamily: 'var(--font-serif)',
          fontSize: '0.8125rem',
          cursor: 'pointer',
        }}
      >
        now
      </button>
    </div>
  );
}

/**
 * A field whose schema named its values.
 *
 * A closed `enum` is a plain `<select>`. An open `knownValues` list is the
 * same select plus a free-text escape, because the spec defines those as
 * suggestions — a client that refused anything else would be wrong about the
 * lexicon, and the value a user needs is often the one published after this
 * page loaded. A value already in the record that isn't in the list is offered
 * back rather than silently dropped.
 */
export function SelectField({
  options,
  open,
  required,
  value,
  onChange,
}: {
  options: string[];
  open: boolean;
  required: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const OTHER = '\u0000other';
  const known = options.includes(value);
  const [custom, setCustom] = useState(!known && value !== '');

  const showCustom = open && custom;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      <select
        className="explore-input"
        value={showCustom ? OTHER : known ? value : ''}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(e.target.value);
        }}
      >
        <option value="">{required ? 'Choose one…' : '(not set)'}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {open && <option value={OTHER}>Other…</option>}
      </select>
      {showCustom && (
        <input
          className="explore-input explore-mono"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Any other value this lexicon accepts"
        />
      )}
    </div>
  );
}

export function JsonField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [text, setText] = useState(() => stringifyJson(value));
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setText(stringifyJson(value));
  }, [value]);

  return (
    <div>
      <textarea
        className="explore-input explore-textarea explore-mono"
        rows={6}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (!next.trim()) {
            setParseError(null);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(next));
            setParseError(null);
          } catch (err) {
            setParseError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
      {parseError && (
        <p style={{ margin: '0.25rem 0 0', color: 'var(--danger)', fontSize: '0.75rem' }}>
          JSON error: {parseError}
        </p>
      )}
    </div>
  );
}

export function RawJsonEditor({
  value,
  onChange,
  rows = 20,
  label = 'Raw record JSON',
  textareaRef,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  /** Empty hides the caption, for a dialog whose header already says this. */
  label?: string;
  /** So a caller can insert text at the caret. */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
}) {
  const [parseError, setParseError] = useState<string | null>(null);
  const textarea = (
    <textarea
      ref={textareaRef}
      className="explore-input explore-textarea explore-mono"
      rows={rows}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        try {
          JSON.parse(e.target.value);
          setParseError(null);
        } catch (err) {
          setParseError(err instanceof Error ? err.message : String(err));
        }
      }}
    />
  );
  const error = parseError && (
    <p style={{ margin: '0.25rem 0 0', color: 'var(--danger)', fontSize: '0.75rem' }}>
      JSON error: {parseError}
    </p>
  );
  if (!label) {
    return (
      <div>
        {textarea}
        {error}
      </div>
    );
  }
  return (
    <FieldShell label={label}>
      {textarea}
      {error}
    </FieldShell>
  );
}

export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function localInputToIso(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

export function stringifyJson(v: unknown): string {
  if (v === undefined || v === null) return '';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return '';
  }
}

/**
 * Segmented Form / JSON switch used at the top of the editor. Two button
 * cells side-by-side with the active one filled — same visual idiom as
 * the dark/light theme toggle in the nav, so the affordance reads as a
 * "pick one" control instead of a hidden text link.
 */
export function ModeToggle({
  mode,
  onChange,
  formDisabled,
  formTitle,
}: {
  mode: 'form' | 'json';
  onChange: () => void;
  /** Greys out Form where no schema could be turned into one. */
  formDisabled?: boolean;
  formTitle?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Editor mode"
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-tertiary)',
        padding: '2px',
      }}
    >
      <ModeToggleButton
        active={mode === 'form'}
        disabled={formDisabled}
        title={formTitle}
        onClick={() => mode !== 'form' && onChange()}
      >
        Form
      </ModeToggleButton>
      <ModeToggleButton active={mode === 'json'} onClick={() => mode !== 'json' && onChange()}>
        JSON
      </ModeToggleButton>
    </div>
  );
}

function ModeToggleButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      style={{
        padding: '0.35rem 0.75rem',
        background: active ? 'var(--accent-moss)' : 'transparent',
        color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
        border: 0,
        fontFamily: 'var(--font-serif)',
        fontSize: '0.8125rem',
        cursor: disabled ? 'not-allowed' : active ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background 0.15s ease, color 0.15s ease',
      }}
    >
      {children}
    </button>
  );
}
