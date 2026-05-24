'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Eye, EyeOff, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { WAYPOINT_ICONS } from '@/utils/waypointIcons';

type Props = {
  id: string;
  name: string;
  description?: string;
  hidden: boolean;
  isCustom: boolean;
  onToggleHidden: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
};

/**
 * Single draggable row in the WaypointsManager list. Renders the icon,
 * name, hide/show toggle, and (for customs) edit/delete buttons.
 */
export default function SortableWaypointRow({
  id,
  name,
  description,
  hidden,
  isCustom,
  onToggleHidden,
  onEdit,
  onDelete,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
    padding: '0.625rem 0.75rem',
    background: isDragging ? 'var(--bg-elevated)' : 'var(--bg-secondary)',
    border: '1px solid var(--border-medium)',
    opacity: hidden ? 0.5 : 1,
    boxShadow: isDragging ? '0 6px 22px rgba(0, 0, 0, 0.25)' : undefined,
    zIndex: isDragging ? 5 : 'auto',
  };

  return (
    <div ref={setNodeRef} style={style}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.25rem',
          background: 'transparent',
          border: 0,
          color: 'var(--text-tertiary)',
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
      >
        <GripVertical size={14} />
      </button>

      <span
        style={{
          width: 24,
          height: 24,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-accent)',
          flexShrink: 0,
        }}
      >
        {WAYPOINT_ICONS[id] || (
          <span
            style={{
              width: 18,
              height: 18,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.6875rem',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-serif)',
            }}
          >
            {name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '0.875rem',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-serif)',
            lineHeight: 1.3,
          }}
        >
          {name}
          {isCustom && (
            <span
              style={{
                marginLeft: '0.5rem',
                padding: '0.05rem 0.4rem',
                fontSize: '0.65rem',
                color: 'var(--text-accent)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              custom
            </span>
          )}
        </div>
        {description && (
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              marginTop: '0.15rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {description}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onToggleHidden}
        title={hidden ? 'Show in pickers' : 'Hide from pickers'}
        aria-label={hidden ? `Show ${name}` : `Hide ${name}`}
        style={iconBtnStyle()}
      >
        {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>

      {isCustom && onEdit && (
        <button
          type="button"
          onClick={onEdit}
          title="Edit waypoint"
          aria-label={`Edit ${name}`}
          style={iconBtnStyle()}
        >
          <Pencil size={14} />
        </button>
      )}

      {isCustom && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title="Delete waypoint"
          aria-label={`Delete ${name}`}
          style={iconBtnStyle({ danger: true })}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

// Local style helper. WaypointIcon needs a wrapper element type — use a span.
function iconBtnStyle({ danger }: { danger?: boolean } = {}): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.35rem',
    background: 'transparent',
    border: '1px solid var(--border-subtle)',
    color: danger ? 'var(--danger)' : 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'border-color 0.2s ease, color 0.2s ease',
  };
}
