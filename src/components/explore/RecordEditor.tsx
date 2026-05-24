'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Agent } from '@atproto/api';
import {
  blankRecordFor,
  lexiconFor,
  type Lexicon,
  type LexiconField,
} from '@/utils/atproto/lexicons';
import { rkeyFromAtUri } from '@/utils/atproto/urls';

type Props = {
  agent: Agent;
  did: string;
  collection: string;
  rkey?: string;
  initialMode?: 'form' | 'raw';
  onSaved?: (record: Record<string, unknown>) => void;
  onDeleted?: () => void;
  onCreated?: (info: { rkey: string | null; record: Record<string, unknown>; uri?: string }) => void;
};

export default function RecordEditor({
  agent,
  did,
  collection,
  rkey,
  initialMode = 'form',
  onSaved,
  onDeleted,
  onCreated,
}: Props) {
  const lex = lexiconFor(collection);
  const isNew = !rkey;

  const [value, setValue] = useState<Record<string, unknown> | null>(null);
  const [rkeyDraft, setRkeyDraft] = useState(
    lex?.rkeyMode === 'fixed' ? lex.rkeyDefault || '' : '',
  );
  const [rawMode, setRawMode] = useState(initialMode === 'raw' || !lex);
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (isNew) {
      const draft = blankRecordFor(collection);
      setValue(draft);
      setRawText(JSON.stringify(draft, null, 2));
      if (!lex) setRawMode(true);
      return undefined;
    }

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await agent.com.atproto.repo.getRecord({
          repo: did,
          collection,
          rkey: rkey!,
        });
        const fetched = ((res?.data || res) as { value?: Record<string, unknown> })?.value || {};
        if (cancelled) return;
        setValue(structuredClone(fetched));
        setRawText(JSON.stringify(fetched, null, 2));
        if (!lex) setRawMode(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, did, collection, rkey, isNew, lex]);

  const updateField = useCallback((key: string, next: unknown) => {
    setValue((prev) => ({ ...(prev || {}), [key]: next }));
  }, []);

  const buildRecordPayload = useCallback((): Record<string, unknown> => {
    if (rawMode) {
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      if (lex?.typeFieldValue && !parsed.$type) parsed.$type = lex.typeFieldValue;
      return parsed;
    }
    const next: Record<string, unknown> = { ...(value || {}) };
    if (lex?.typeFieldValue) next.$type = lex.typeFieldValue;
    if (lex?.fields) {
      for (const f of lex.fields) {
        if (f.autoOnEdit && !isNew) {
          next[f.key] = new Date().toISOString();
        }
      }
      for (const f of lex.fields) {
        const v = next[f.key];
        if (!f.required && (v === '' || v === undefined || v === null)) {
          delete next[f.key];
        }
        if (f.type === 'tags' && Array.isArray(v) && v.length === 0 && !f.required) {
          delete next[f.key];
        }
      }
    }
    return next;
  }, [value, lex, rawMode, rawText, isNew]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    try {
      const record = buildRecordPayload();
      if (isNew) {
        if (lex?.rkeyMode === 'fixed') {
          const chosen = rkeyDraft.trim();
          if (!chosen) throw new Error('Pick an rkey for this record.');
          await agent.com.atproto.repo.putRecord({
            repo: did,
            collection,
            rkey: chosen,
            record,
          });
          onCreated?.({ rkey: chosen, record });
          return;
        }
        const res = await agent.com.atproto.repo.createRecord({
          repo: did,
          collection,
          record,
        });
        const data = (res?.data || res) as { uri?: string };
        const newRkey = rkeyFromAtUri(data?.uri || '');
        onCreated?.({ rkey: newRkey, record, uri: data?.uri });
        return;
      }
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection,
        rkey: rkey!,
        record,
      });
      setValue(record);
      setRawText(JSON.stringify(record, null, 2));
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2400);
      onSaved?.(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (isNew || !rkey) return;
    setDeleting(true);
    setError(null);
    try {
      await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
      onDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  function toggleRawMode() {
    if (!lex) return;
    if (!rawMode) {
      setRawText(JSON.stringify(buildRecordPayload(), null, 2));
    } else {
      try {
        const parsed = JSON.parse(rawText) as Record<string, unknown>;
        setValue(parsed);
      } catch {
        return;
      }
    }
    setRawMode((m) => !m);
  }

  if (loading) {
    return <p className="explore-placeholder">Loading record…</p>;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        padding: '1rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        {lex && (
          <button
            type="button"
            onClick={toggleRawMode}
            style={{
              background: 'transparent',
              border: 0,
              color: 'var(--text-accent)',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.875rem',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {rawMode ? 'Use form' : 'Edit JSON'}
          </button>
        )}
        {lex && (
          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8125rem' }}>
            {lex.label}
          </span>
        )}
      </div>

      {isNew && lex?.rkeyMode === 'fixed' && (
        <FieldShell label="Record key (rkey)">
          <input
            type="text"
            value={rkeyDraft}
            onChange={(e) => setRkeyDraft(e.target.value)}
            placeholder={lex.rkeyPlaceholder || 'rkey'}
            className="explore-input"
          />
        </FieldShell>
      )}

      {rawMode || !lex ? (
        <RawJsonEditor value={rawText} onChange={setRawText} />
      ) : (
        <FormEditor lex={lex} value={value || {}} onChange={updateField} />
      )}

      {error && <p className="explore-error">{error}</p>}
      {savedFlash && (
        <p style={{ color: 'var(--text-accent)', margin: 0, fontStyle: 'italic' }}>Saved.</p>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || deleting}
          style={{
            padding: '0.55rem 1rem',
            background: 'var(--accent-moss)',
            color: 'var(--text-on-accent)',
            border: '1px solid var(--accent-moss)',
            fontFamily: 'var(--font-serif)',
            fontSize: '0.875rem',
            cursor: saving || deleting ? 'wait' : 'pointer',
            opacity: saving || deleting ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
        </button>
        {!isNew && !confirmingDelete && (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={saving || deleting}
            style={{
              padding: '0.55rem 1rem',
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              border: '1px solid var(--danger-border)',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
        )}
        {confirmingDelete && (
          <>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Delete {collection}/{rkey}? This cannot be undone.
            </span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              style={{
                padding: '0.4rem 0.75rem',
                background: 'var(--danger)',
                color: 'var(--text-on-accent)',
                border: '1px solid var(--danger)',
                fontFamily: 'var(--font-serif)',
                fontSize: '0.8125rem',
                cursor: deleting ? 'wait' : 'pointer',
              }}
            >
              {deleting ? 'Deleting…' : 'Confirm delete'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
              style={{
                padding: '0.4rem 0.75rem',
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-medium)',
                fontFamily: 'var(--font-serif)',
                fontSize: '0.8125rem',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function FormEditor({
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

function Field({
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

function FieldShell({
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {label && (
        <label
          className="explore-small-caps"
          style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}
        >
          {label}
          {required && <span style={{ color: 'var(--danger)' }}> *</span>}
        </label>
      )}
      {children}
      {(hint || charCount) && (
        <p
          style={{
            margin: 0,
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
          }}
        >
          {hint}
          {hint && charCount ? ' · ' : ''}
          {charCount}
        </p>
      )}
    </div>
  );
}

function DatetimeField({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
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

function JsonField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
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

function RawJsonEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [parseError, setParseError] = useState<string | null>(null);
  return (
    <FieldShell label="Raw record JSON">
      <textarea
        className="explore-input explore-textarea explore-mono"
        rows={20}
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
      {parseError && (
        <p style={{ margin: '0.25rem 0 0', color: 'var(--danger)', fontSize: '0.75rem' }}>
          JSON error: {parseError}
        </p>
      )}
    </FieldShell>
  );
}

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function localInputToIso(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function stringifyJson(v: unknown): string {
  if (v === undefined || v === null) return '';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return '';
  }
}
