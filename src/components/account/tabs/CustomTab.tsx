'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesProvider';
import {
  CUSTOM_GROUP_ID,
  CUSTOM_GROUP_NAME,
  addWaypointGroup,
  addWaypointToGroup,
  type CustomWaypoint,
} from '@/utils/preferences';
import CustomWaypointForm from '../CustomWaypointForm';

/**
 * Custom tab — manage the user's hand-written waypoints (URL templates
 * with placeholders). New customs auto-join a "My Waypoints" group on
 * save so they show up in the picker immediately; the user can move
 * them to other groups from the Waypoints tab.
 */
export default function CustomTab() {
  const { prefs, update } = usePreferences();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  const editing =
    editingId !== null
      ? prefs.customWaypoints.find((c) => c.id === editingId)
      : undefined;

  function save(w: CustomWaypoint) {
    update((prev) => {
      const exists = prev.customWaypoints.some((c) => c.id === w.id);
      const customWaypoints = exists
        ? prev.customWaypoints.map((c) => (c.id === w.id ? w : c))
        : [...prev.customWaypoints, w];

      // For brand-new customs, ensure they land in a group so the user
      // can actually see them in the picker. Reuses an existing "custom"
      // group if there is one, otherwise creates one.
      if (!exists) {
        const hasCustomGroup = prev.waypointGroups.some(
          (g) => g.id === CUSTOM_GROUP_ID,
        );
        let next = { ...prev, customWaypoints };
        if (!hasCustomGroup) {
          next = addWaypointGroup(next, CUSTOM_GROUP_NAME);
          // Match the canonical custom-group id so it's stable across rebuilds.
          next = {
            ...next,
            waypointGroups: next.waypointGroups.map((g, i) =>
              i === next.waypointGroups.length - 1
                ? { ...g, id: CUSTOM_GROUP_ID }
                : g,
            ),
          };
        }
        return addWaypointToGroup(next, CUSTOM_GROUP_ID, w.id);
      }
      return { ...prev, customWaypoints };
    });
    setEditingId(null);
    setAddingNew(false);
  }

  function remove(id: string) {
    if (!confirm('Delete this custom waypoint? It will be removed from any groups it’s in.')) return;
    update((prev) => ({
      ...prev,
      customWaypoints: prev.customWaypoints.filter((c) => c.id !== id),
      waypointGroups: prev.waypointGroups.map((g) =>
        g.waypointIds.includes(id)
          ? { ...g, waypointIds: g.waypointIds.filter((wid) => wid !== id) }
          : g,
      ),
    }));
  }

  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="settings-card-title">Custom waypoints</h2>
        <p className="settings-card-sub">
          Add your own jump destinations using URL templates. Placeholders:{' '}
          <code>{'{handle}'}</code>, <code>{'{did}'}</code>,{' '}
          <code>{'{actor}'}</code>, <code>{'{collection}'}</code>,{' '}
          <code>{'{rkey}'}</code>. New custom waypoints land in your{' '}
          <em>{CUSTOM_GROUP_NAME}</em> group.
        </p>
      </div>

      {(addingNew || editing) && (
        <CustomWaypointForm
          initial={editing}
          onSave={save}
          onCancel={() => {
            setAddingNew(false);
            setEditingId(null);
          }}
        />
      )}

      {!addingNew && !editing && (
        <button
          type="button"
          onClick={() => setAddingNew(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            alignSelf: 'flex-start',
            padding: '0.55rem 0.875rem',
            background: 'var(--accent-moss)',
            color: 'var(--text-on-accent)',
            border: '1px solid var(--accent-moss)',
            fontFamily: 'var(--font-serif)',
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          <Plus size={14} /> Add custom waypoint
        </button>
      )}

      {prefs.customWaypoints.length === 0 ? (
        <p
          style={{
            margin: 0,
            color: 'var(--text-tertiary)',
            fontSize: '0.85rem',
            fontStyle: 'italic',
          }}
        >
          No custom waypoints yet.
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
          }}
        >
          {prefs.customWaypoints.map((c) => (
            <li
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.625rem',
                padding: '0.625rem 0.875rem',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: '0.95rem',
                    color: 'var(--text-primary)',
                  }}
                >
                  {c.name}
                </div>
                {c.domain && (
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.75rem',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    {c.domain}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setEditingId(c.id)}
                title="Edit"
                aria-label={`Edit ${c.name}`}
                style={iconBtn()}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={() => remove(c.id)}
                title="Delete"
                aria-label={`Delete ${c.name}`}
                style={iconBtn({ danger: true })}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function iconBtn({ danger }: { danger?: boolean } = {}): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    background: 'transparent',
    border: '1px solid var(--border-subtle)',
    color: danger ? 'var(--danger)' : 'var(--text-secondary)',
    cursor: 'pointer',
  };
}
