'use client';

import { Sparkles, X } from 'lucide-react';
import type { Waypoint } from '@/utils/waypoints';

type Props = {
  waypoints: Waypoint[];
  /** Add every new waypoint to its default group and mark them seen. */
  onAdd: () => void;
  /** Mark the new waypoints seen without adding them. */
  onDismiss: () => void;
};

/**
 * Dismissable "new waypoints" notice. Surfaces built-in waypoints that have
 * shipped since the user last acknowledged the catalog, with a one-click
 * "Add" that drops them into their default groups. Rendered on the
 * universal-link picker and in account settings. Mirrors the extension's
 * popup banner.
 */
export default function NewWaypointsBanner({ waypoints, onAdd, onDismiss }: Props) {
  if (waypoints.length === 0) return null;

  const names = waypoints.map((w) => w.name);
  let summary: string;
  if (names.length === 1) summary = `${names[0]} is a new waypoint`;
  else if (names.length <= 3) summary = `New waypoints: ${names.join(', ')}`;
  else summary = `${names.slice(0, 2).join(', ')} and ${names.length - 2} more new waypoints`;

  const addLabel = waypoints.length === 1 ? 'Add it' : 'Add all';

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.875rem',
        padding: '0.75rem 1rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--text-accent)',
        marginBottom: '1.5rem',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          color: 'var(--text-accent)',
          flexShrink: 0,
        }}
      >
        <Sparkles size={16} />
        {waypoints.slice(0, 3).map((w) => (
          <span
            key={w.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
            }}
          >
            {w.icon}
          </span>
        ))}
      </span>

      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: '0.9rem',
          color: 'var(--text-primary)',
          lineHeight: 1.3,
        }}
      >
        {summary}
      </span>

      <button
        type="button"
        onClick={onAdd}
        style={{
          flexShrink: 0,
          padding: '0.4rem 0.85rem',
          background: 'var(--accent-moss)',
          color: 'var(--text-on-accent)',
          border: '1px solid var(--accent-forest)',
          fontSize: '0.85rem',
          fontFamily: 'var(--font-serif)',
          cursor: 'pointer',
        }}
      >
        {addLabel}
      </button>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss new waypoints notification"
        title="Dismiss"
        style={{
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.25rem',
          background: 'none',
          border: 'none',
          color: 'var(--text-tertiary)',
          cursor: 'pointer',
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
