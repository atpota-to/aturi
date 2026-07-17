// Group-based waypoint organizer. Users build their own groups, drop the
// same waypoint into multiple groups, reorder groups + rows, collapse
// groups, etc. Waypoints not in any group are hidden from the popup.
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
import {
  WAYPOINT_DESTINATIONS_DATA,
  type WaypointData,
} from '@aturi/waypoints.data';
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
  type Prefs,
  type WaypointGroup,
} from '../../../lib/prefs';
import { allWaypoints, newBuiltinWaypoints } from '../../../lib/catalog';

type Props = {
  prefs: Prefs;
  onChange: (partial: Partial<Prefs>) => void;
};

export default function VisibilityTab({ prefs, onChange }: Props) {
  const groups = prefs.waypointGroups;

  const allWps = useMemo(() => allWaypoints(prefs.customWaypoints), [prefs.customWaypoints]);
  const lookup = useMemo(() => {
    const m = new Map<string, WaypointData>();
    for (const w of allWps) m.set(w.id, w);
    return m;
  }, [allWps]);

  const newIds = useMemo(
    () => new Set(newBuiltinWaypoints(prefs).map(w => w.id)),
    [prefs.knownWaypointIds]
  );

  const groupSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function commit(next: Prefs) {
    onChange({ waypointGroups: next.waypointGroups });
  }

  function handleGroupDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = groups.map(g => g.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(groups, oldIndex, newIndex);
    commit(setWaypointGroups(prefs, reordered));
  }

  function handleAddGroup() {
    commit(addWaypointGroup(prefs, 'New group'));
  }

  function handleResetGroups() {
    if (!confirm('Reset to the default groups? This will discard any custom groups you have created.')) return;
    commit(setWaypointGroups(prefs, defaultWaypointGroups(prefs.customWaypoints)));
  }

  function handleRenameGroup(groupId: string, name: string) {
    commit(renameWaypointGroup(prefs, groupId, name));
  }

  function handleRemoveGroup(groupId: string) {
    if (!confirm('Delete this group? Waypoints inside will remain available in any other groups they belong to.')) return;
    commit(removeWaypointGroup(prefs, groupId));
  }

  function handleToggleCollapsed(groupId: string, collapsed: boolean) {
    commit(setGroupCollapsed(prefs, groupId, collapsed));
  }

  function handleAddWaypointToGroup(groupId: string, waypointId: string) {
    commit(addWaypointToGroup(prefs, groupId, waypointId));
  }

  function handleRemoveWaypointFromGroup(groupId: string, waypointId: string) {
    commit(removeWaypointFromGroup(prefs, groupId, waypointId));
  }

  function handleReorderInGroup(groupId: string, ids: string[]) {
    commit(setGroupWaypointOrder(prefs, groupId, ids));
  }

  const totalVisible = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groups) for (const id of g.waypointIds) ids.add(id);
    return ids.size;
  }, [groups]);
  const totalAvailable = allWps.length;
  const hiddenCount = Math.max(0, totalAvailable - totalVisible);

  return (
    <div>
      <h1 className="options-h1">Waypoints</h1>
      <p className="options-lede">
        Build your own groups of waypoints. Drag to reorder groups or rows, and use the
        plus button on a group header to add waypoints. The same waypoint can live in
        multiple groups. Waypoints not in any group are hidden from the popup.
      </p>

      <div className="options-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 16,
            marginBottom: 8,
          }}
        >
          <div>
            <div className="options-card-title">Your groups</div>
            <div className="options-card-sub">
              {groups.length === 0
                ? 'No groups yet. Create one below.'
                : `${groups.length} ${groups.length === 1 ? 'group' : 'groups'} · ${totalVisible} visible${hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="aturi-btn" onClick={handleResetGroups}>
              Reset
            </button>
            <button className="aturi-btn aturi-btn-primary" onClick={handleAddGroup}>
              New
            </button>
          </div>
        </div>

        <DndContext
          sensors={groupSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleGroupDragEnd}
        >
          <SortableContext items={groups.map(g => g.id)} strategy={verticalListSortingStrategy}>
            <div className="group-list">
              {groups.map(group => (
                <SortableGroup
                  key={group.id}
                  group={group}
                  lookup={lookup}
                  allWaypoints={allWps}
                  newIds={newIds}
                  onRename={name => handleRenameGroup(group.id, name)}
                  onRemove={() => handleRemoveGroup(group.id)}
                  onToggleCollapsed={collapsed => handleToggleCollapsed(group.id, collapsed)}
                  onAddWaypoint={waypointId => handleAddWaypointToGroup(group.id, waypointId)}
                  onRemoveWaypoint={waypointId =>
                    handleRemoveWaypointFromGroup(group.id, waypointId)
                  }
                  onReorder={ids => handleReorderInGroup(group.id, ids)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {groups.length === 0 && (
          <div style={{ marginTop: 12 }}>
            <button className="aturi-btn aturi-btn-primary" onClick={handleAddGroup}>
              Create your first group
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Group ------------------------------------------------------------------

type SortableGroupProps = {
  group: WaypointGroup;
  lookup: Map<string, WaypointData>;
  allWaypoints: WaypointData[];
  newIds: Set<string>;
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
  newIds,
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
    setDraftName(group.name);
  }, [group.name]);

  const collapsed = !!group.collapsed;

  const rowSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
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
  };

  const memberIds = new Set(group.waypointIds);
  const pickerCandidates = allWaypoints; // intentionally not filtered – same waypoint can appear in multiple groups

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
          <DragHandleIcon />
        </span>
        <button
          className="group-chevron"
          aria-label={collapsed ? 'Expand group' : 'Collapse group'}
          aria-expanded={!collapsed}
          onClick={() => onToggleCollapsed(!collapsed)}
          type="button"
        >
          <ChevronIcon down={!collapsed} />
        </button>

        {editingName ? (
          <input
            className="group-name-input"
            autoFocus
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
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
            <PlusIcon />
          </button>
          <button
            className="group-action group-action-delete"
            type="button"
            aria-label="Delete group"
            onClick={onRemove}
            title="Delete group"
          >
            <TrashIcon />
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
                  {group.waypointIds.map(id => {
                    const w = lookup.get(id);
                    if (!w) return null;
                    const isCustom = id.startsWith('custom:');
                    const isMoved =
                      !isCustom &&
                      WAYPOINT_DESTINATIONS_DATA[id]?.category !== group.id;
                    return (
                      <SortableRow
                        key={id}
                        id={id}
                        name={w.name}
                        isCustom={isCustom}
                        isMoved={isMoved}
                        isNew={newIds.has(id)}
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
        <WaypointPicker
          candidates={pickerCandidates}
          memberIds={memberIds}
          newIds={newIds}
          onPick={id => onAddWaypoint(id)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// --- Row --------------------------------------------------------------------

type SortableRowProps = {
  id: string;
  name: string;
  isCustom: boolean;
  isMoved: boolean;
  isNew: boolean;
  onRemove: () => void;
};

function SortableRow({ id, name, isCustom, isMoved, isNew, onRemove }: SortableRowProps) {
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
        <DragHandleIcon />
      </span>
      <span className="group-row-name">
        {name}
        {isCustom && <span className="reorder-tag">custom</span>}
        {isMoved && !isCustom && (
          <span className="reorder-tag reorder-tag-moved">moved</span>
        )}
        {isNew && !isCustom && (
          <span className="reorder-tag reorder-tag-new">new</span>
        )}
      </span>
      <button
        className="group-row-remove"
        type="button"
        aria-label={`Remove ${name} from group`}
        onClick={onRemove}
        title="Remove from group"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

// --- Picker -----------------------------------------------------------------

type PickerProps = {
  candidates: WaypointData[];
  memberIds: Set<string>;
  newIds: Set<string>;
  onPick: (id: string) => void;
  onClose: () => void;
};

function WaypointPicker({ candidates, memberIds, newIds, onPick, onClose }: PickerProps) {
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
      candidates.filter(w =>
        q ? w.name.toLowerCase().includes(q) || w.id.toLowerCase().includes(q) : true
      ),
    [candidates, q]
  );

  return (
    <div ref={containerRef} className="waypoint-picker" role="dialog" aria-label="Add waypoint">
      <div className="waypoint-picker-head">
        <input
          autoFocus
          className="waypoint-picker-input"
          placeholder="Search waypoints…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button
          className="aturi-btn aturi-btn-ghost"
          type="button"
          onClick={onClose}
          aria-label="Close"
        >
          Done
        </button>
      </div>
      <div className="waypoint-picker-list">
        {filtered.length === 0 ? (
          <div className="waypoint-picker-empty">No matches.</div>
        ) : (
          filtered.map(w => {
            const isMember = memberIds.has(w.id);
            const isCustom = w.id.startsWith('custom:');
            const isNew = !isCustom && newIds.has(w.id);
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
                  {isCustom && <span className="reorder-tag">custom</span>}
                  {isNew && <span className="reorder-tag reorder-tag-new">new</span>}
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

// --- Icons ------------------------------------------------------------------

function DragHandleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

function ChevronIcon({ down }: { down: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        transform: down ? 'rotate(0deg)' : 'rotate(-90deg)',
        transition: 'transform 120ms ease',
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
