'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus, RotateCcw } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesProvider';
import { type CustomWaypoint } from '@/utils/preferences';
import {
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
} from '@/utils/waypoints.data';
import SortableWaypointRow from './SortableWaypointRow';
import CustomWaypointForm from './CustomWaypointForm';

/**
 * Account-page UI for personalizing the waypoint catalog. Three operations:
 *
 *   1. Reorder built-in + custom waypoints (drag-and-drop).
 *   2. Hide built-in waypoints from the picker (eye toggle).
 *   3. Add / edit / delete custom waypoints (templates with placeholders).
 *
 * State lives in PreferencesProvider — local-first, mirrored to PDS when
 * signed in.
 */
export default function WaypointsManager() {
  const { prefs, update } = usePreferences();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  // Compose the visible list: ordered union of custom + built-in ids.
  const orderedIds = useMemo(() => {
    const customIds = prefs.customWaypoints.map((c) => c.id);
    const builtinIds = [...WAYPOINT_ORDER];
    const allIds = [...customIds, ...builtinIds];
    const userOrder = prefs.waypointOrder.length > 0 ? prefs.waypointOrder : [];
    if (userOrder.length === 0) return allIds;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of userOrder) {
      if (allIds.includes(id) && !seen.has(id)) {
        out.push(id);
        seen.add(id);
      }
    }
    for (const id of allIds) {
      if (!seen.has(id)) out.push(id);
    }
    return out;
  }, [prefs.customWaypoints, prefs.waypointOrder]);

  const customById = useMemo(
    () => new Map(prefs.customWaypoints.map((c) => [c.id, c])),
    [prefs.customWaypoints],
  );

  const hiddenSet = useMemo(() => new Set(prefs.hiddenWaypoints), [prefs.hiddenWaypoints]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedIds.indexOf(String(active.id));
    const newIndex = orderedIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextOrder = arrayMove(orderedIds, oldIndex, newIndex);
    update((prev) => ({ ...prev, waypointOrder: nextOrder }));
  }

  function toggleHidden(id: string) {
    update((prev) => {
      const next = new Set(prev.hiddenWaypoints);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, hiddenWaypoints: Array.from(next) };
    });
  }

  function saveCustom(w: CustomWaypoint) {
    update((prev) => {
      const exists = prev.customWaypoints.some((c) => c.id === w.id);
      const customWaypoints = exists
        ? prev.customWaypoints.map((c) => (c.id === w.id ? w : c))
        : [...prev.customWaypoints, w];
      return { ...prev, customWaypoints };
    });
    setEditingId(null);
    setAddingNew(false);
  }

  function deleteCustom(id: string) {
    update((prev) => ({
      ...prev,
      customWaypoints: prev.customWaypoints.filter((c) => c.id !== id),
      hiddenWaypoints: prev.hiddenWaypoints.filter((h) => h !== id),
      waypointOrder: prev.waypointOrder.filter((o) => o !== id),
    }));
  }

  function resetOrder() {
    update((prev) => ({ ...prev, waypointOrder: [] }));
  }

  const visibleCount = orderedIds.length - prefs.hiddenWaypoints.length;
  const total = orderedIds.length;
  const editingWaypoint = editingId ? customById.get(editingId) : undefined;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          paddingBottom: '0.5rem',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 400 }}>
            Waypoints
          </h2>
          <p
            style={{
              margin: '0.25rem 0 0',
              fontSize: '0.85rem',
              color: 'var(--text-tertiary)',
            }}
          >
            Reorder, hide, or add your own. Affects every universal link page on the
            site.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
            {visibleCount} of {total} visible
          </span>
          {prefs.waypointOrder.length > 0 && (
            <button
              type="button"
              onClick={resetOrder}
              title="Restore default order"
              style={ghostBtnStyle()}
            >
              <RotateCcw size={12} /> Reset order
            </button>
          )}
        </div>
      </header>

      {(addingNew || editingWaypoint) && (
        <CustomWaypointForm
          initial={editingWaypoint}
          onSave={saveCustom}
          onCancel={() => {
            setAddingNew(false);
            setEditingId(null);
          }}
        />
      )}

      {!addingNew && !editingWaypoint && (
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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      >
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {orderedIds.map((id) => {
              const custom = customById.get(id);
              const builtin = !custom ? WAYPOINT_DESTINATIONS_DATA[id] : undefined;
              if (!custom && !builtin) return null;
              const name = custom?.name || builtin?.name || id;
              const description = custom?.description
                || (builtin && typeof builtin.description === 'string' ? builtin.description : undefined);
              return (
                <SortableWaypointRow
                  key={id}
                  id={id}
                  name={name}
                  description={description}
                  hidden={hiddenSet.has(id)}
                  isCustom={Boolean(custom)}
                  onToggleHidden={() => toggleHidden(id)}
                  onEdit={custom ? () => setEditingId(id) : undefined}
                  onDelete={custom ? () => deleteCustom(id) : undefined}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}

function ghostBtnStyle(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.3rem 0.625rem',
    background: 'transparent',
    border: '1px solid var(--border-medium)',
    color: 'var(--text-tertiary)',
    fontFamily: 'var(--font-serif)',
    fontSize: '0.75rem',
    cursor: 'pointer',
  };
}
