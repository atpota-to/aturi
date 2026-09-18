'use client';

import { useCallback, useEffect, useState } from 'react';
import { blankRecordFor, lexiconFor } from '@/utils/atproto/lexicons';
import { FieldShell, FormEditor, ModeToggle, RawJsonEditor } from './recordFields';
import { RecordEditorSkeleton } from './skeletons/pages';
import type { RecordBackend } from './recordBackend';

type Props = {
  /**
   * Where the record is read from and written back to. `repoRecordBackend`
   * for a public repo, `spaceRecordBackend` for a permissioned one; the
   * editor itself is the same either way.
   */
  backend: RecordBackend;
  collection: string;
  rkey?: string;
  initialMode?: 'form' | 'raw';
  onSaved?: (record: Record<string, unknown>) => void;
  onDeleted?: () => void;
  onCreated?: (info: { rkey: string | null; record: Record<string, unknown>; uri?: string }) => void;
  /** Dismiss the editor without saving. */
  onCancel?: () => void;
  /**
   * Hide the delete button. For a grant that authorizes editing but not
   * deleting — possible on a space, where the two are separate actions — so
   * the editor doesn't offer a button whose call would be refused.
   */
  canDelete?: boolean;
};

export default function RecordEditor({
  backend,
  collection,
  rkey,
  initialMode = 'form',
  onSaved,
  onDeleted,
  onCreated,
  onCancel,
  canDelete = true,
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
        const fetched = await backend.read(collection, rkey!);
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
  }, [backend, collection, rkey, isNew, lex]);

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
          const created = await backend.create(collection, record, chosen);
          onCreated?.({ rkey: created.rkey ?? chosen, record, uri: created.uri });
          return;
        }
        const created = await backend.create(collection, record);
        onCreated?.({ rkey: created.rkey, record, uri: created.uri });
        return;
      }
      await backend.put(collection, rkey!, record);
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
      await backend.remove(collection, rkey);
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
    return <RecordEditorSkeleton />;
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        }}
      >
        {lex ? (
          <ModeToggle mode={rawMode ? 'json' : 'form'} onChange={toggleRawMode} />
        ) : (
          // No registered lexicon means there's no form to switch to —
          // editor stays in JSON mode and we just label the row.
          <span
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '0.8125rem',
              color: 'var(--text-tertiary)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Edit JSON
          </span>
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
        {onCancel && !confirmingDelete && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving || deleting}
            style={{
              padding: '0.55rem 1rem',
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-medium)',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.875rem',
              cursor: saving || deleting ? 'not-allowed' : 'pointer',
              opacity: saving || deleting ? 0.6 : 1,
            }}
          >
            Cancel
          </button>
        )}
        {!isNew && canDelete && !confirmingDelete && (
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
                color: 'var(--text-on-danger)',
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
