'use client';

/**
 * Explore-page layout manager for /account#sections. Lets the user show /
 * hide and drag-to-reorder the sections on both explorer page types (record
 * pages and repo/profile pages). On each page at least one "data view" must
 * stay visible (field table / raw JSON on record pages; profile / identity on
 * repo pages) — the toggle of the last visible one is disabled. Reuses the
 * same @dnd-kit scaffolding as the waypoint groups manager.
 */

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
import { GripVertical } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesProvider';
import Toggle from '../Toggle';
import {
  countVisibleGuaranteed,
  isGuaranteedDataView,
  sectionMetaFor,
  type ExplorePage,
} from '@/utils/exploreSections';
import { resetSections, setSectionHidden, setSections } from '@/utils/preferences';

export default function SectionsTab() {
  const { prefs, update } = usePreferences();

  return (
    <>
      <section className="settings-card">
        <div className="settings-card-head">
          <h2 className="settings-card-title">Record pages</h2>
          <p className="settings-card-sub">
            Choose which sections appear on a record / Bluesky-post explorer
            page, and drag to reorder them. The rich JSON preview and raw JSON
            are the two data views; at least one always stays on so the
            record is never blank.
          </p>
        </div>
        <SectionList page="record" />
      </section>

      <section className="settings-card">
        <div className="settings-card-head">
          <h2 className="settings-card-title">Repo &amp; profile pages</h2>
          <p className="settings-card-sub">
            Choose which sections appear on a repo / profile explorer page,
            and drag to reorder. The breadcrumb and the collections tabs stay
            fixed.
          </p>
        </div>
        <SectionList page="repo" />
        <Toggle
          id="repo-glance-collapsed"
          label="Start “Repo at a glance” collapsed"
          description="When shown, the stats section starts folded; click its header to expand. No effect when hidden above."
          checked={prefs.repoGlanceCollapsedByDefault}
          onChange={(next) =>
            update((p) => ({ ...p, repoGlanceCollapsedByDefault: next }))
          }
        />
      </section>
    </>
  );
}

function SectionList({ page }: { page: ExplorePage }) {
  const { prefs, update } = usePreferences();
  const sections = page === 'record' ? prefs.recordSections : prefs.repoSections;
  const meta = sectionMetaFor(page);
  const visibleGuaranteed = countVisibleGuaranteed(sections, page);
  const visibleCount = sections.filter((s) => !s.hidden).length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = sections.map((s) => s.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    update((prev) => setSections(prev, page, arrayMove(sections, oldIndex, newIndex)));
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          marginBottom: 12,
        }}
      >
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
          {visibleCount} of {sections.length} shown
        </p>
        <button
          type="button"
          onClick={() => {
            if (!confirm('Reset these sections to their default order and visibility?')) return;
            update((prev) => resetSections(prev, page));
          }}
          style={{
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
            flexShrink: 0,
          }}
        >
          Reset
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={sections.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div style={{ border: '1px solid var(--border-medium)' }}>
            {sections.map((s) => {
              const m = meta.find((mm) => mm.id === s.id);
              if (!m) return null;
              const isLastGuaranteed =
                isGuaranteedDataView(page, s.id) && !s.hidden && visibleGuaranteed <= 1;
              return (
                <SectionRow
                  key={s.id}
                  id={s.id}
                  label={m.label}
                  description={m.description}
                  kind={m.kind}
                  hidden={s.hidden}
                  toggleDisabled={isLastGuaranteed}
                  onToggle={(nextHidden) =>
                    update((prev) => setSectionHidden(prev, page, s.id, nextHidden))
                  }
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SectionRow({
  id,
  label,
  description,
  kind,
  hidden,
  toggleDisabled,
  onToggle,
}: {
  id: string;
  label: string;
  description: string;
  kind: 'record-data' | 'helper';
  hidden: boolean;
  toggleDisabled: boolean;
  onToggle: (nextHidden: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 2 : undefined,
  };
  const switchId = `section-toggle-${id}`;
  return (
    <div ref={setNodeRef} style={style} className={`group-row ${isDragging ? 'is-dragging' : ''}`}>
      <span
        className="group-row-handle"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </span>
      <label htmlFor={switchId} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>{label}</span>
          <span className="reorder-tag">{kind === 'record-data' ? 'content' : 'helper'}</span>
        </span>
        <span
          style={{
            display: 'block',
            fontSize: '0.8rem',
            color: 'var(--text-tertiary)',
            lineHeight: 1.45,
            marginTop: 2,
          }}
        >
          {description}
        </span>
      </label>
      <span
        className="settings-switch"
        title={toggleDisabled ? 'At least one data view must stay visible' : undefined}
      >
        <input
          id={switchId}
          type="checkbox"
          role="switch"
          checked={!hidden}
          disabled={toggleDisabled}
          onChange={(e) => onToggle(!e.target.checked)}
          aria-label={`Show ${label}`}
        />
        <span className="settings-switch-box" aria-hidden="true" />
      </span>
    </div>
  );
}
