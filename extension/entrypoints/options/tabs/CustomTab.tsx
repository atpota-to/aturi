import { useMemo, useState } from 'react';
import type { WaypointType } from '@aturi/waypoints.data';
import {
  addWaypointGroup,
  addWaypointToGroup,
  type CustomWaypoint,
  type Prefs,
} from '../../../lib/prefs';
import { customWaypointToData, matchCustomUrl } from '../../../lib/template';
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect';

type Props = {
  prefs: Prefs;
  onChange: (partial: Partial<Prefs>) => void;
};

const TYPES: WaypointType[] = ['post', 'profile', 'list', 'record'];

type Draft = {
  id: string;
  name: string;
  domain: string;
  category: string;
  supportedTypes: WaypointType[];
  templates: Partial<Record<WaypointType, string>>;
};

const NEW_GROUP_VALUE = '__new__';

function emptyDraft(defaultGroupId: string = 'custom'): Draft {
  return {
    id: `custom:${crypto.randomUUID()}`,
    name: '',
    domain: '',
    category: defaultGroupId,
    supportedTypes: ['profile'],
    templates: { profile: '/profile/{handle}' },
  };
}

function draftFromExisting(cw: CustomWaypoint): Draft {
  return { ...cw, templates: { ...cw.templates } };
}

function validate(draft: Draft, existing: CustomWaypoint[]): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push('Give it a name.');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(draft.domain.trim())) {
    errors.push('Domain should look like example.com (no protocol, no path).');
  }
  if (draft.supportedTypes.length === 0) errors.push('Pick at least one content type.');
  for (const type of draft.supportedTypes) {
    const t = draft.templates[type]?.trim();
    if (!t) errors.push(`Template for "${type}" is required.`);
    else if (!t.includes('{handle}') && !t.includes('{did}')) {
      errors.push(`Template for "${type}" should include {handle} or {did}.`);
    }
  }
  const dup = existing.find(e => e.id !== draft.id && e.domain.toLowerCase() === draft.domain.toLowerCase());
  if (dup) errors.push(`A custom waypoint for ${draft.domain} already exists.`);
  return errors;
}

export default function CustomTab({ prefs, onChange }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);

  const groupOptions = useMemo(
    () => prefs.waypointGroups.map(g => ({ id: g.id, name: g.name })),
    [prefs.waypointGroups]
  );

  function defaultGroupForNew(): string {
    const fallback = prefs.waypointGroups.find(g => g.id === 'custom');
    if (fallback) return fallback.id;
    return prefs.waypointGroups[0]?.id ?? NEW_GROUP_VALUE;
  }

  function startNew() {
    setDraft(emptyDraft(defaultGroupForNew()));
  }

  function edit(cw: CustomWaypoint) {
    setDraft(draftFromExisting(cw));
  }

  function remove(id: string) {
    if (!confirm('Remove this custom waypoint?')) return;
    const customWaypoints = prefs.customWaypoints.filter(c => c.id !== id);
    const hiddenWaypoints = prefs.hiddenWaypoints.filter(h => h !== id);
    const waypointGroups = prefs.waypointGroups.map(g => ({
      ...g,
      waypointIds: g.waypointIds.filter(wid => wid !== id),
    }));
    const defaults = { ...prefs.defaults };
    for (const key of Object.keys(defaults)) {
      const slot = { ...defaults[key] };
      let touched = false;
      for (const t of TYPES) {
        if (slot[t] === id) {
          delete slot[t];
          touched = true;
        }
      }
      if (touched) {
        if (Object.keys(slot).length === 0) delete defaults[key];
        else defaults[key] = slot;
      }
    }
    onChange({ customWaypoints, hiddenWaypoints, defaults, waypointGroups });
  }

  function save() {
    if (!draft) return;
    const errors = validate(draft, prefs.customWaypoints);
    if (errors.length > 0) return;

    const isNew = !prefs.customWaypoints.find(c => c.id === draft.id);

    let targetGroupId = draft.category;
    let nextPrefs = prefs;
    if (targetGroupId === NEW_GROUP_VALUE) {
      const before = nextPrefs.waypointGroups.length;
      nextPrefs = addWaypointGroup(nextPrefs, 'Custom');
      const created = nextPrefs.waypointGroups[before];
      targetGroupId = created?.id ?? 'custom';
    }

    const cleaned: CustomWaypoint = {
      id: draft.id,
      name: draft.name.trim(),
      domain: draft.domain.trim().toLowerCase(),
      category: targetGroupId,
      supportedTypes: draft.supportedTypes,
      templates: Object.fromEntries(
        draft.supportedTypes
          .filter(t => draft.templates[t])
          .map(t => [t, draft.templates[t]!.trim()])
      ) as Draft['templates'],
    };

    const others = nextPrefs.customWaypoints.filter(c => c.id !== cleaned.id);
    let withGroups = { ...nextPrefs, customWaypoints: [...others, cleaned] };

    // Make sure the waypoint actually shows up in the chosen group; this also
    // takes care of new waypoints automatically being visible in the popup.
    const inTargetGroup = withGroups.waypointGroups.some(
      g => g.id === targetGroupId && g.waypointIds.includes(cleaned.id)
    );
    if (!inTargetGroup) {
      const exists = withGroups.waypointGroups.some(g => g.id === targetGroupId);
      if (exists) {
        withGroups = addWaypointToGroup(withGroups, targetGroupId, cleaned.id);
      } else if (isNew) {
        withGroups = addWaypointGroup(withGroups, 'Custom');
        const created = withGroups.waypointGroups[withGroups.waypointGroups.length - 1];
        if (created) {
          withGroups = addWaypointToGroup(withGroups, created.id, cleaned.id);
        }
      }
    }

    onChange({
      customWaypoints: withGroups.customWaypoints,
      waypointGroups: withGroups.waypointGroups,
    });
    setDraft(null);
  }

  return (
    <div className="options-page">
      <div className="options-page-head">
        <h1 className="options-h1">Custom waypoints</h1>
        <p className="options-lede">
          Wire up any site that follows a consistent URL structure. Use{' '}
          <span className="token-hint">{'{handle}'}</span>
          <span className="token-hint">{'{did}'}</span>
          <span className="token-hint">{'{collection}'}</span>
          <span className="token-hint">{'{rkey}'}</span>{' '}
          as placeholders in your templates.
        </p>
      </div>

      <section className="options-card is-rows custom-card" aria-labelledby="custom-list-title">
        <div className="options-card-head custom-card-head">
          <h2 className="options-card-title" id="custom-list-title">Your custom waypoints</h2>
          <span className="options-card-sub">
            {prefs.customWaypoints.length === 0
              ? 'None yet.'
              : `${prefs.customWaypoints.length} saved`}
          </span>
        </div>

        {prefs.customWaypoints.length > 0 && (
          <div className="custom-list">
            {prefs.customWaypoints.map(cw => (
              <div key={cw.id} className="custom-item">
                <span className="custom-item-initial" aria-hidden="true">
                  {(cw.name.trim()[0] ?? '?').toUpperCase()}
                </span>
                <div className="custom-item-info">
                  <div className="custom-item-name">
                    {cw.name}
                    {draft?.id === cw.id && <span className="custom-item-editing">Editing</span>}
                  </div>
                  <div className="custom-item-domain">
                    {cw.domain} &middot; {cw.supportedTypes.join(', ')}
                  </div>
                </div>
                <div className="custom-item-actions">
                  <button className="aturi-btn" onClick={() => edit(cw)}>Edit</button>
                  <button
                    className="aturi-btn aturi-btn-ghost custom-item-remove"
                    onClick={() => remove(cw.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button type="button" className="custom-add" onClick={startNew}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          {prefs.customWaypoints.length === 0 ? 'Add waypoint' : 'Add another waypoint'}
        </button>
      </section>

      {draft && (
        <DraftEditor
          draft={draft}
          existing={prefs.customWaypoints}
          groupOptions={groupOptions}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

type DraftEditorProps = {
  draft: Draft;
  existing: CustomWaypoint[];
  groupOptions: Array<{ id: string; name: string }>;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
};

function DraftEditor({ draft, existing, groupOptions, onChange, onCancel, onSave }: DraftEditorProps) {
  const [sampleUrl, setSampleUrl] = useState('');

  const errors = useMemo(() => validate(draft, existing), [draft, existing]);

  function toggleType(type: WaypointType, enabled: boolean) {
    const supportedTypes = enabled
      ? Array.from(new Set([...draft.supportedTypes, type]))
      : draft.supportedTypes.filter(t => t !== type);
    const templates = { ...draft.templates };
    if (!enabled) delete templates[type];
    else if (!templates[type]) templates[type] = defaultTemplateFor(type);
    onChange({ ...draft, supportedTypes, templates });
  }

  function setTemplate(type: WaypointType, value: string) {
    onChange({ ...draft, templates: { ...draft.templates, [type]: value } });
  }

  const forwardPreview = useMemo(() => {
    const asCw: CustomWaypoint = {
      id: draft.id,
      name: draft.name || 'Draft',
      domain: draft.domain || 'example.com',
      category: draft.category,
      supportedTypes: draft.supportedTypes,
      templates: draft.templates,
    };
    const data = customWaypointToData(asCw);
    const rows: Array<{ type: WaypointType; url: string | null }> = [];
    for (const type of draft.supportedTypes) {
      let url: string | null = null;
      if (type === 'profile') {
        url = data.getUrl('alice.bsky.social');
      } else if (type === 'post') {
        url = data.getUrl('alice.bsky.social', 'app.bsky.feed.post', '3k7abc');
      } else if (type === 'list') {
        url = data.getUrl('alice.bsky.social', 'app.bsky.graph.list', 'listkey');
      } else {
        url = data.getUrl('alice.bsky.social', 'com.example.thing', 'rkey123');
      }
      rows.push({ type, url });
    }
    return rows;
  }, [draft]);

  const reversePreview = useMemo(() => {
    if (!sampleUrl) return null;
    try {
      const url = new URL(sampleUrl);
      const asCw: CustomWaypoint = {
        id: draft.id,
        name: draft.name || 'Draft',
        domain: draft.domain || url.hostname,
        category: draft.category,
        supportedTypes: draft.supportedTypes,
        templates: draft.templates,
      };
      return matchCustomUrl(url, [asCw]);
    } catch {
      return null;
    }
  }, [sampleUrl, draft]);

  const isEditing = !!existing.find(e => e.id === draft.id);

  const host = draft.domain.trim() || 'example.com';

  return (
    <section className="options-card is-rows custom-form-card" aria-labelledby="custom-draft-title">
      <div className="options-card-head">
        <h2 className="options-card-title" id="custom-draft-title">
          {isEditing ? `Edit ${draft.name.trim() || 'waypoint'}` : 'New waypoint'}
        </h2>
      </div>

      <div className="custom-form">
        <div className="custom-form-row">
          <div>
            <label className="aturi-label" htmlFor="custom-name">Name</label>
            <input
              id="custom-name"
              className="aturi-input"
              value={draft.name}
              placeholder="My App"
              onChange={e => onChange({ ...draft, name: e.target.value })}
            />
          </div>
          <div>
            <label className="aturi-label" htmlFor="custom-domain">Domain</label>
            <input
              id="custom-domain"
              className="aturi-input is-mono"
              value={draft.domain}
              placeholder="myapp.com"
              onChange={e => onChange({ ...draft, domain: e.target.value })}
            />
          </div>
          <div>
            <label className="aturi-label">
              {isEditing ? 'Add to group' : 'Group'}
            </label>
            <SearchSelect
              options={[
                ...(groupOptions.length === 0
                  ? [{ value: NEW_GROUP_VALUE, label: 'Create a new "Custom" group', fixed: true } satisfies SearchSelectOption]
                  : []),
                ...groupOptions.map(g => ({ value: g.id, label: g.name })),
                ...(groupOptions.length > 0
                  ? [{ value: NEW_GROUP_VALUE, label: '+ New "Custom" group', fixed: true } satisfies SearchSelectOption]
                  : []),
              ]}
              value={draft.category}
              onChange={val => onChange({ ...draft, category: val })}
              placeholder="Choose a group…"
            />
          </div>
        </div>
        <div className="aturi-subtle custom-form-note">
          {isEditing
            ? 'Saving will ensure this waypoint is in the chosen group. You can manage all group memberships in the Waypoints tab.'
            : 'New waypoints need to live in at least one group to show up in the popup.'}
        </div>
      </div>

      <fieldset className="custom-templates">
        <legend className="custom-templates-legend">Supported content types</legend>
        <p className="custom-templates-help">
          Turn on the kinds of pages this app has, then write each path. Start each
          template with <code>/</code>. We&apos;ll prefix <code>https://{'{domain}'}</code>{' '}
          automatically.
        </p>
        <div className="custom-template-list">
          {TYPES.map(type => {
            const enabled = draft.supportedTypes.includes(type);
            return (
              <div key={type} className={`custom-template-row ${enabled ? 'is-on' : ''}`}>
                <label className="custom-template-label">
                  <input
                    type="checkbox"
                    className="visibility-checkbox"
                    checked={enabled}
                    onChange={e => toggleType(type, e.target.checked)}
                  />
                  <span>{type}</span>
                </label>
                {enabled ? (
                  <span className="custom-template-field">
                    <span className="custom-template-prefix" aria-hidden="true">
                      https://{host}
                    </span>
                    <input
                      className="custom-template-input"
                      aria-label={`${type} template`}
                      value={draft.templates[type] ?? ''}
                      placeholder={defaultTemplateFor(type)}
                      onChange={e => setTemplate(type, e.target.value)}
                    />
                  </span>
                ) : (
                  <span className="custom-template-off">This app has no {type} pages</span>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className="custom-previews">
        <section className="custom-preview-box" aria-labelledby="custom-forward-title">
          <h3 className="custom-preview-label" id="custom-forward-title">Preview (forward fill)</h3>
          <div className="custom-preview">
            {forwardPreview.length === 0
              ? '(pick a content type)'
              : forwardPreview.map(row => (
                  <div key={row.type}>
                    <strong>{row.type}:</strong> {row.url ?? '(template missing)'}
                  </div>
                ))}
          </div>
        </section>

        <section className="custom-preview-box" aria-labelledby="custom-reverse-title">
          <h3 className="custom-preview-label" id="custom-reverse-title">
            Reverse test (paste a URL to see if it matches)
          </h3>
          <input
            className="aturi-input is-mono"
            aria-label="URL to test"
            placeholder={`https://${draft.domain || 'example.com'}${defaultTemplateFor('profile').replace('{handle}', 'alice.bsky.social')}`}
            value={sampleUrl}
            onChange={e => setSampleUrl(e.target.value)}
          />
          <div className={`custom-preview-result ${reversePreview ? 'is-match' : ''}`}>
            {reversePreview
              ? `Match -> type: ${reversePreview.parsed.type}, handle: ${reversePreview.parsed.handle}${reversePreview.parsed.rkey ? `, rkey: ${reversePreview.parsed.rkey}` : ''}`
              : sampleUrl
              ? 'No match against your templates.'
              : '(enter a URL above)'}
          </div>
        </section>
      </div>

      {errors.length > 0 && (
        <div className="validation-error">
          {errors.map((e, i) => (
            <div key={i}>- {e}</div>
          ))}
        </div>
      )}

      <div className="custom-form-actions">
        <button className="aturi-btn" onClick={onCancel}>Cancel</button>
        <button
          className="aturi-btn aturi-btn-primary"
          onClick={onSave}
          disabled={errors.length > 0}
        >
          Save waypoint
        </button>
      </div>
    </section>
  );
}

function defaultTemplateFor(type: WaypointType): string {
  switch (type) {
    case 'post':
      return '/profile/{handle}/post/{rkey}';
    case 'list':
      return '/profile/{handle}/lists/{rkey}';
    case 'record':
      return '/at/{handle}/{collection}/{rkey}';
    case 'profile':
    default:
      return '/profile/{handle}';
  }
}
