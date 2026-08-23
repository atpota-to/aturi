'use client';

import { useMemo, useState } from 'react';
import { Save, X } from 'lucide-react';
import {
  newCustomWaypointId,
  type CustomWaypoint,
} from '@/utils/preferences';
import {
  COMPAT_FAMILIES,
  COMPAT_FAMILY_ORDER,
  type RedirectCompatFamily,
  type WaypointType,
} from '@/utils/waypoints.data';

const TYPE_OPTIONS: { id: WaypointType; label: string; hint: string }[] = [
  { id: 'profile', label: 'Profile', hint: 'Opens the user’s profile page' },
  { id: 'post', label: 'Post', hint: 'Opens an app.bsky.feed.post record' },
  { id: 'list', label: 'List', hint: 'Opens an app.bsky.graph.list record' },
  { id: 'record', label: 'Any record', hint: 'Opens any AT-URI record (fallback)' },
];

type Props = {
  initial?: CustomWaypoint;
  onSave: (waypoint: CustomWaypoint) => void;
  onCancel: () => void;
};

const EXAMPLE_TEMPLATES: Record<WaypointType, string> = {
  profile: 'https://example.com/{handle}',
  post: 'https://example.com/{handle}/post/{rkey}',
  list: 'https://example.com/{handle}/lists/{rkey}',
  record: 'https://example.com/{actor}/{collection}/{rkey}',
  unknown: '',
};

/**
 * Inline form for creating or editing a custom waypoint. Templates support
 * `{handle}`, `{did}`, `{actor}` (DID with handle fallback), `{collection}`,
 * and `{rkey}` placeholders.
 */
export default function CustomWaypointForm({ initial, onSave, onCancel }: Props) {
  const isEditing = Boolean(initial);
  const [name, setName] = useState(initial?.name || '');
  const [domain, setDomain] = useState(initial?.domain || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [types, setTypes] = useState<Set<WaypointType>>(
    new Set(initial?.supportedTypes || ['profile', 'post']),
  );
  const [templates, setTemplates] = useState<Partial<Record<WaypointType, string>>>(
    initial?.templates || {},
  );
  const [families, setFamilies] = useState<Set<RedirectCompatFamily>>(
    new Set(initial?.redirectCompat || []),
  );
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    if (!name.trim()) return false;
    if (types.size === 0) return false;
    // At least one template must be filled.
    for (const t of types) {
      if ((templates[t] || '').trim()) return true;
    }
    return false;
  }, [name, types, templates]);

  function toggleType(t: WaypointType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function toggleFamily(f: RedirectCompatFamily) {
    setFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Give the waypoint a name.');
      return;
    }

    const enabledTypes = Array.from(types);
    if (enabledTypes.length === 0) {
      setError('Pick at least one type of content this waypoint handles.');
      return;
    }

    const filledTemplates: Partial<Record<WaypointType, string>> = {};
    for (const t of enabledTypes) {
      const tpl = (templates[t] || '').trim();
      if (tpl) filledTemplates[t] = tpl;
    }
    if (Object.keys(filledTemplates).length === 0) {
      setError('Fill in at least one URL template.');
      return;
    }

    const waypoint: CustomWaypoint = {
      id: initial?.id || newCustomWaypointId(),
      name: trimmedName,
      domain: domain.trim() || undefined,
      description: description.trim() || undefined,
      supportedTypes: enabledTypes,
      templates: filledTemplates,
      redirectCompat: families.size > 0 ? Array.from(families) : undefined,
    };
    onSave(waypoint);
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
        padding: '1rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>
          {isEditing ? 'Edit waypoint' : 'New custom waypoint'}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          style={{
            background: 'transparent',
            border: 0,
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
            padding: '0.25rem',
          }}
        >
          <X size={14} />
        </button>
      </div>

      <Field label="Name" required>
        <input
          className="explore-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Atmosphere App"
          maxLength={64}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <Field label="Domain" hint="Display only">
          <input
            className="explore-input"
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="example.com"
          />
        </Field>
        <Field label="Description" hint="Shown under the name">
          <input
            className="explore-input"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="View on example.com"
          />
        </Field>
      </div>

      <Field label="Handles" required hint="Which kinds of links this waypoint understands">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {TYPE_OPTIONS.map((t) => {
            const active = types.has(t.id);
            return (
              <label
                key={t.id}
                title={t.hint}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  padding: '0.4rem 0.75rem',
                  background: active ? 'var(--accent-moss)' : 'var(--bg-tertiary)',
                  color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                  border: `1px solid ${active ? 'var(--accent-moss)' : 'var(--border-medium)'}`,
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleType(t.id)}
                  style={{ display: 'none' }}
                />
                {t.label}
              </label>
            );
          })}
        </div>
      </Field>

      {Array.from(types).map((t) => (
        <Field
          key={t}
          label={`URL template: ${TYPE_OPTIONS.find((o) => o.id === t)?.label}`}
          hint={`Placeholders: {handle} · {did} · {actor} · {collection} · {rkey}`}
        >
          <input
            className="explore-input explore-mono"
            type="text"
            value={templates[t] || ''}
            onChange={(e) => setTemplates((prev) => ({ ...prev, [t]: e.target.value }))}
            placeholder={EXAMPLE_TEMPLATES[t] || 'https://example.com/{handle}'}
          />
        </Field>
      ))}

      {/* Optional, and empty is the normal case: a personal bookmark isn't
          usually something you want links rewritten to. Ticking a family here
          is what makes this waypoint selectable under Settings → Redirects. */}
      <Field
        label="Auto-redirect families"
        hint="Optional — lets this waypoint be picked as a redirect destination"
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {COMPAT_FAMILY_ORDER.map((f) => {
            const active = families.has(f);
            return (
              <label
                key={f}
                title={COMPAT_FAMILIES[f]?.description}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  padding: '0.35rem 0.65rem',
                  background: active ? 'var(--accent-moss)' : 'var(--bg-tertiary)',
                  color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                  border: `1px solid ${active ? 'var(--accent-moss)' : 'var(--border-medium)'}`,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleFamily(f)}
                  style={{ display: 'none' }}
                />
                {COMPAT_FAMILIES[f]?.name ?? f}
              </label>
            );
          })}
        </div>
      </Field>

      {error && (
        <p style={{ color: 'var(--danger)', fontSize: '0.8125rem', margin: 0 }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '0.5rem 0.875rem',
            background: 'transparent',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-serif)',
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            padding: '0.5rem 0.875rem',
            background: 'var(--accent-moss)',
            color: 'var(--text-on-accent)',
            border: '1px solid var(--accent-moss)',
            fontFamily: 'var(--font-serif)',
            fontSize: '0.875rem',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity: canSubmit ? 1 : 0.5,
          }}
        >
          <Save size={13} />
          {isEditing ? 'Save changes' : 'Add waypoint'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <label
        className="explore-small-caps"
        style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}
      >
        {label}
        {required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      {children}
      {hint && (
        <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{hint}</p>
      )}
    </div>
  );
}
