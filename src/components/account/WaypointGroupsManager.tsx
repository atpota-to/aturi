'use client';

/**
 * Group-based waypoint organizer for /account#waypoints. Mirrors the
 * extension's VisibilityTab 1:1:
 *
 *   - User-defined groups with drag-to-reorder.
 *   - Drag waypoints between rows of the same group to reorder; remove
 *     via the trailing × button.
 *   - "+" button on a group header opens a search popover for adding
 *     any waypoint (custom or built-in); the same waypoint may live in
 *     multiple groups.
 *   - Rename a group inline; collapse via the chevron; delete via the
 *     trash icon.
 *   - "Reset" rebuilds the default category-based groups; "New" appends
 *     an empty "New group" the user can rename + populate.
 *
 * Waypoints not in any group are hidden from the picker.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, GripVertical, Plus, Trash2, X } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesProvider';
import {
  addWaypointGroup,
  addWaypointToGroup,
  defaultWaypointGroups,
  removeWaypointFromGroup,
  removeWaypointGroup,
  renameWaypointGroup,
  setGroupCollapsed,
  setGroupWaypointOrder,
  setWaypointGroups,
  type WaypointGroup,
} from '@/utils/preferences';
import {
  WAYPOINT_DESTINATIONS_DATA,
  type WaypointData,
} from '@/utils/waypoints.data';

type DisplayWaypoint = {
  id: string;
  name: string;
  isCustom: boolean;
  /** Original built-in category — used to flag "moved" rows. */
  originalCategory?: string;
};

export default function WaypointGroupsManager() {
  const { prefs, update } = usePreferences();
  const groups = prefs.waypointGroups;

  // Lookup every known waypoint (custom + built-in) → display info.
  const allWaypoints = useMemo<DisplayWaypoint[]>(() => {
    const customs: DisplayWaypoint[] = prefs.customWaypoints.map((c) => ({
      id: c.id,
      name: c.name,
      isCustom: true,
    }));
    const builtins: DisplayWaypoint[] = Object.values(WAYPOINT_DESTINATIONS_DATA).map(
      (w: WaypointData) => ({
        id: w.id,
        name: w.name,
        isCustom: false,
        originalCategory: w.category,
      }),
    );
    return [...customs, ...builtins];
  }, [prefs.customWaypoints]);

  const lookup = useMemo(() => {
    const m = new Map<string, DisplayWaypoint>();
    for (const w of allWaypoints) m.set(w.id, w);
    return m;
  }, [allWaypoints]);

  const groupSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleGroupDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = groups.map((g) => g.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(groups, oldIndex, newIndex);
    update((prev) => setWaypointGroups(prev, reordered));
  }

  const totalVisible = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groups) for (const id of g.waypointIds) ids.add(id);
    return ids.size;
  }, [groups]);
  const totalAvailable = allWaypoints.length;
  const hiddenCount = Math.max(0, totalAvailable - totalVisible);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          marginBottom: 12,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: '0.8rem',
            color: 'var(--text-tertiary)',
          }}
        >
          {groups.length === 0
            ? 'No groups yet — create one to start surfacing waypoints.'
            : `${groups.length} ${groups.length === 1 ? 'group' : 'groups'} · ${totalVisible} visible${
                hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''
              }`}
        </p>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => {
              if (
                !confirm(
                  'Reset to the default groups? This will discard any custom groups you have created.',
                )
              )
                return;
              update((prev) =>
                setWaypointGroups(prev, defaultWaypointGroups(prev.customWaypoints)),
              );
            }}
            style={ghostBtn()}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => update((prev) => addWaypointGroup(prev, 'New group'))}
            style={primaryBtn()}
          >
            <Plus size={13} /> New group
          </button>
        </div>
      </div>

      <DndContext
        sensors={groupSensors}
        collisionDetection={closestCenter}
        onDragEnd={handleGroupDragEnd}
      >
        <SortableContext
          items={groups.map((g) => g.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="group-list">
            {groups.map((group) => (
              <SortableGroup
                key={group.id}
                group={group}
                lookup={lookup}
                allWaypoints={allWaypoints}
                onRename={(name) =>
                  update((prev) => renameWaypointGroup(prev, group.id, name))
                }
                onRemove={() => {
                  if (
                    !confirm(
                      'Delete this group? Waypoints inside will remain available in any other groups they belong to.',
                    )
                  )
                    return;
                  update((prev) => removeWaypointGroup(prev, group.id));
                }}
                onToggleCollapsed={(collapsed) =>
                  update((prev) => setGroupCollapsed(prev, group.id, collapsed))
                }
                onAddWaypoint={(waypointId) =>
                  update((prev) => addWaypointToGroup(prev, group.id, waypointId))
                }
                onRemoveWaypoint={(waypointId) =>
                  update((prev) => removeWaypointFromGroup(prev, group.id, waypointId))
                }
                onReorder={(ids) =>
                  update((prev) => setGroupWaypointOrder(prev, group.id, ids))
                }
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {groups.length === 0 && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => update((prev) => addWaypointGroup(prev, 'New group'))}
            style={primaryBtn()}
          >
            <Plus size={13} /> Create your first group
          </button>
        </div>
      )}
    </div>
  );
}

// --- Group ----------------------------------------------------------------

type SortableGroupProps = {
  group: WaypointGroup;
  lookup: Map<string, DisplayWaypoint>;
  allWaypoints: DisplayWaypoint[];
  onRename: (name: string) => void;
  onRemove: () => void;
  onToggleCollapsed: (collapsed: boolean) => void;
  onAddWaypoint: (waypointId: string) => void;
  onRemoveWaypoint: (waypointId: string) => void;
  onReorder: (ids: string[]) => void;
};

function SortableGroup({
  group,
  lookup,
  allWaypoints,
  onRename,
  onRemove,
  onToggleCollapsed,
  onAddWaypoint,
  onRemoveWaypoint,
  onReorder,
}: SortableGroupProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(group.name);

  useEffect(() => {
    // Sync local draft when the group's canonical name changes (e.g. via
    // PDS sync from another device). Lint disabled — this is exactly the
    // external-to-internal sync the rule's exception is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftName(group.name);
  }, [group.name]);

  const collapsed = !!group.collapsed;

  const rowSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleRowDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = [...group.waypointIds];
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  function commitName() {
    setEditingName(false);
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== group.name) {
      onRename(trimmed);
    } else {
      setDraftName(group.name);
    }
  }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 3 : undefined,
    position: 'relative',
  };

  const memberIds = new Set(group.waypointIds);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group-card ${isDragging ? 'is-dragging' : ''} ${collapsed ? 'is-collapsed' : ''}`}
    >
      <div className="group-header">
        <span
          className="group-handle"
          aria-label="Drag to reorder group"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </span>
        <button
          className="group-chevron"
          aria-label={collapsed ? 'Expand group' : 'Collapse group'}
          aria-expanded={!collapsed}
          onClick={() => onToggleCollapsed(!collapsed)}
          type="button"
          style={{
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 120ms ease',
          }}
        >
          <ChevronDown size={14} />
        </button>

        {editingName ? (
          <input
            className="group-name-input"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') {
                setDraftName(group.name);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <button
            className="group-name"
            type="button"
            onClick={() => setEditingName(true)}
            title="Rename group"
          >
            {group.name}
          </button>
        )}

        <span className="group-count" aria-hidden="true">
          {group.waypointIds.length}
        </span>

        <div className="group-actions">
          <button
            className="group-action group-action-add"
            type="button"
            aria-label="Add waypoint to group"
            onClick={() => setPickerOpen(true)}
            title="Add waypoint"
          >
            <Plus size={14} />
          </button>
          <button
            className="group-action group-action-delete"
            type="button"
            aria-label="Delete group"
            onClick={onRemove}
            title="Delete group"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="group-body">
          {group.waypointIds.length === 0 ? (
            <div className="group-empty">
              No waypoints yet. Use the + button on the header to add some.
            </div>
          ) : (
            <DndContext
              sensors={rowSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleRowDragEnd}
            >
              <SortableContext
                items={group.waypointIds}
                strategy={verticalListSortingStrategy}
              >
                <div className="group-rows">
                  {group.waypointIds.map((id) => {
                    const w = lookup.get(id);
                    if (!w) return null;
                    const isMoved =
                      !w.isCustom && w.originalCategory && w.originalCategory !== group.id;
                    return (
                      <SortableRow
                        key={id}
                        id={id}
                        name={w.name}
                        isCustom={w.isCustom}
                        isMoved={!!isMoved}
                        onRemove={() => onRemoveWaypoint(id)}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}

      {pickerOpen && (
        <WaypointPickerPopover
          candidates={allWaypoints}
          memberIds={memberIds}
          onPick={(id) => onAddWaypoint(id)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// --- Row -------------------------------------------------------------------

function SortableRow({
  id,
  name,
  isCustom,
  isMoved,
  onRemove,
}: {
  id: string;
  name: string;
  isCustom: boolean;
  isMoved: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 2 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group-row ${isDragging ? 'is-dragging' : ''}`}
    >
      <span
        className="group-row-handle"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </span>
      <span className="group-row-name">
        {name}
        {isCustom && <span className="reorder-tag">custom</span>}
        {isMoved && !isCustom && (
          <span className="reorder-tag reorder-tag-moved">moved</span>
        )}
      </span>
      <button
        className="group-row-remove"
        type="button"
        aria-label={`Remove ${name} from group`}
        onClick={onRemove}
        title="Remove from group"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// --- Picker ----------------------------------------------------------------

function WaypointPickerPopover({
  candidates,
  memberIds,
  onPick,
  onClose,
}: {
  candidates: DisplayWaypoint[];
  memberIds: Set<string>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      candidates.filter((w) =>
        q ? w.name.toLowerCase().includes(q) || w.id.toLowerCase().includes(q) : true,
      ),
    [candidates, q],
  );

  return (
    <div
      ref={containerRef}
      className="waypoint-picker"
      role="dialog"
      aria-label="Add waypoint"
    >
      <div className="waypoint-picker-head">
        <input
          autoFocus
          className="waypoint-picker-input"
          placeholder="Search waypoints…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" onClick={onClose} aria-label="Close" style={ghostBtn()}>
          Done
        </button>
      </div>
      <div className="waypoint-picker-list">
        {filtered.length === 0 ? (
          <div className="waypoint-picker-empty">No matches.</div>
        ) : (
          filtered.map((w) => {
            const isMember = memberIds.has(w.id);
            return (
              <button
                key={w.id}
                type="button"
                className={`waypoint-picker-item ${isMember ? 'is-member' : ''}`}
                onClick={() => {
                  if (!isMember) onPick(w.id);
                }}
                disabled={isMember}
              >
                <span className="waypoint-picker-name">
                  {w.name}
                  {w.isCustom && <span className="reorder-tag">custom</span>}
                </span>
                <span className="waypoint-picker-status">
                  {isMember ? 'Added' : 'Add'}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// --- Styles ---------------------------------------------------------------

function ghostBtn(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.35rem 0.75rem',
    background: 'transparent',
    border: '1px solid var(--border-medium)',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-serif)',
    fontSize: '0.8rem',
    cursor: 'pointer',
  };
}

function primaryBtn(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.4rem 0.75rem',
    background: 'var(--accent-moss)',
    color: 'var(--text-on-accent)',
    border: '1px solid var(--accent-moss)',
    fontFamily: 'var(--font-serif)',
    fontSize: '0.85rem',
    cursor: 'pointer',
  };
}
