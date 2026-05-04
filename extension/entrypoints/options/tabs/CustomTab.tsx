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
    <div>
      <h1 className="options-h1">Custom waypoints</h1>
      <p className="options-lede">
        Wire up any site that follows a consistent URL structure. Use{' '}
        <span className="token-hint">{'{handle}'}</span>
        <span className="token-hint">{'{did}'}</span>
        <span className="token-hint">{'{collection}'}</span>
        <span className="token-hint">{'{rkey}'}</span>{' '}
        as placeholders in your templates.
      </p>

      <div className="options-card">
        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">Your custom waypoints</div>
            <div className="options-card-sub">
              {prefs.customWaypoints.length === 0
                ? 'None yet.'
                : `${prefs.customWaypoints.length} saved`}
            </div>
          </div>
          <button className="aturi-btn aturi-btn-primary" onClick={startNew}>
            Add waypoint
          </button>
        </div>

        {prefs.customWaypoints.length > 0 && (
          <div className="custom-list" style={{ marginTop: 14 }}>
            {prefs.customWaypoints.map(cw => (
              <div key={cw.id} className="custom-item">
                <div className="custom-item-info">
                  <div className="custom-item-name">{cw.name}</div>
                  <div className="custom-item-domain">
                    {cw.domain} &middot; {cw.supportedTypes.join(', ')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="aturi-btn" onClick={() => edit(cw)}>Edit</button>
                  <button className="aturi-btn aturi-btn-danger" onClick={() => remove(cw.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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

  return (
    <div className="options-card">
      <div className="options-card-title">
        {isEditing ? 'Edit waypoint' : 'New waypoint'}
      </div>

      <div className="custom-form">
        <div className="custom-form-row">
          <div>
            <label className="aturi-label">Name</label>
            <input
              className="aturi-input"
              value={draft.name}
              placeholder="My App"
              onChange={e => onChange({ ...draft, name: e.target.value })}
            />
          </div>
          <div>
            <label className="aturi-label">Domain</label>
            <input
              className="aturi-input"
              value={draft.domain}
              placeholder="myapp.com"
              onChange={e => onChange({ ...draft, domain: e.target.value })}
            />
          </div>
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
          <div className="aturi-subtle" style={{ marginTop: 4 }}>
            {isEditing
              ? 'Saving will ensure this waypoint is in the chosen group. You can manage all group memberships in the Waypoints tab.'
              : 'New waypoints need to live in at least one group to show up in the popup.'}
          </div>
        </div>

        <div>
          <label className="aturi-label">Supported content types</label>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {TYPES.map(type => (
              <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  className="visibility-checkbox"
                  checked={draft.supportedTypes.includes(type)}
                  onChange={e => toggleType(type, e.target.checked)}
                />
                <span>{type}</span>
              </label>
            ))}
          </div>
        </div>

        {draft.supportedTypes.length > 0 && (
          <div className="custom-templates">
            <div className="aturi-subtle">
              Start each template with <code>/</code>. We&apos;ll prefix <code>https://{'{domain}'}</code>{' '}
              automatically.
            </div>
            {draft.supportedTypes.map(type => (
              <div key={type} className="custom-template-row">
                <div className="custom-template-label">{type}</div>
                <input
                  className="aturi-input"
                  value={draft.templates[type] ?? ''}
                  placeholder={defaultTemplateFor(type)}
                  onChange={e => setTemplate(type, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="custom-preview-label">Preview (forward fill)</div>
          <div className="custom-preview">
            {forwardPreview.length === 0
              ? '(pick a content type)'
              : forwardPreview.map(row => (
                  <div key={row.type}>
                    <strong>{row.type}:</strong> {row.url ?? '(template missing)'}
                  </div>
                ))}
          </div>
        </div>

        <div>
          <label className="aturi-label">Reverse test (paste a URL to see if it matches)</label>
          <input
            className="aturi-input"
            placeholder={`https://${draft.domain || 'example.com'}${defaultTemplateFor('profile').replace('{handle}', 'alice.bsky.social')}`}
            value={sampleUrl}
            onChange={e => setSampleUrl(e.target.value)}
          />
          <div className="custom-preview" style={{ marginTop: 6 }}>
            {reversePreview
              ? `Match -> type: ${reversePreview.parsed.type}, handle: ${reversePreview.parsed.handle}${reversePreview.parsed.rkey ? `, rkey: ${reversePreview.parsed.rkey}` : ''}`
              : sampleUrl
              ? 'No match against your templates.'
              : '(enter a URL above)'}
          </div>
        </div>

        {errors.length > 0 && (
          <div className="validation-error">
            {errors.map((e, i) => (
              <div key={i}>- {e}</div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="aturi-btn" onClick={onCancel}>Cancel</button>
          <button
            className="aturi-btn aturi-btn-primary"
            onClick={onSave}
            disabled={errors.length > 0}
          >
            Save waypoint
          </button>
        </div>
      </div>
    </div>
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
