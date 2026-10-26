'use client';

import { X } from 'lucide-react';
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
    <div role="status" className="new-waypoints-banner">
      <span aria-hidden className="new-waypoints-banner-icons">
        {waypoints.slice(0, 3).map((w) => (
          <span key={w.id} className="new-waypoints-banner-icon">
            {w.icon}
          </span>
        ))}
      </span>

      <span className="new-waypoints-banner-text">{summary}</span>

      <div className="new-waypoints-banner-actions">
        <button type="button" onClick={onAdd} className="new-waypoints-banner-add">
          {addLabel}
        </button>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss new waypoints notification"
          title="Dismiss"
          className="new-waypoints-banner-dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
