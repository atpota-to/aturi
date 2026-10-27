'use client';

import { cloneElement, isValidElement, useId, useMemo, useState } from 'react';
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
      className="cw-form"
    >
      <div className="cw-form-head">
        <h3 className="cw-form-title">
          {isEditing ? 'Edit waypoint' : 'New custom waypoint'}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="settings-icon-btn"
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

      <div className="cw-form-grid">
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

      <Field group label="Handles" required hint="Which kinds of links this waypoint understands">
        <div className="cw-chips">
          {TYPE_OPTIONS.map((t) => {
            const active = types.has(t.id);
            return (
              <label
                key={t.id}
                title={t.hint}
                className={`cw-chip ${active ? 'is-active' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleType(t.id)}
                  className="fn-sr-only"
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
        group
        label="Auto-redirect families"
        hint="Optional — lets this waypoint be picked as a redirect destination"
      >
        <div className="cw-chips">
          {COMPAT_FAMILY_ORDER.map((f) => {
            const active = families.has(f);
            return (
              <label
                key={f}
                title={COMPAT_FAMILIES[f]?.description}
                className={`cw-chip ${active ? 'is-active' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleFamily(f)}
                  className="fn-sr-only"
                />
                {COMPAT_FAMILIES[f]?.name ?? f}
              </label>
            );
          })}
        </div>
      </Field>

      {error && (
        <p className="settings-error">{error}</p>
      )}

      <div className="cw-form-actions">
        <button
          type="button"
          onClick={onCancel}
          className="settings-btn"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="settings-btn is-primary"
        >
          <Save size={13} />
          {isEditing ? 'Save changes' : 'Add waypoint'}
        </button>
      </div>
    </form>
  );
}

/**
 * A labelled form row. A single input is tied to its label (`htmlFor` and an
 * id handed to the input) and described by the hint; a set of chips is
 * labelled as a group instead, since one <label> can only name one control.
 * The label used to sit beside its input unattached, so screen readers
 * announced every field here as a bare "edit text".
 */
function Field({
  label,
  hint,
  required,
  group,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  /** The children are several controls (chips), not one input. */
  group?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = hint ? `${id}-hint` : undefined;
  const text = (
    <>
      {label}
      {required && <span className="cw-field-required"> *</span>}
    </>
  );
  return (
    <div className="cw-field">
      {group ? (
        <span id={labelId} className="cw-field-label">
          {text}
        </span>
      ) : (
        <label htmlFor={id} className="cw-field-label">
          {text}
        </label>
      )}
      {group ? (
        <div role="group" aria-labelledby={labelId} aria-describedby={hintId}>
          {children}
        </div>
      ) : isValidElement<{ id?: string; 'aria-describedby'?: string }>(children) ? (
        cloneElement(children, { id, 'aria-describedby': hintId })
      ) : (
        children
      )}
      {hint && (
        <p id={hintId} className="cw-field-hint">
          {hint}
        </p>
      )}
    </div>
  );
}
