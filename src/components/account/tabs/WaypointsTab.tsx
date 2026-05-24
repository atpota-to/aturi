'use client';

import WaypointsManager from '../WaypointsManager';

/**
 * Waypoints tab — reorder, hide, and define custom waypoints. Groups
 * (naming + multi-waypoint membership) are planned next; for now the
 * tab wraps the existing single-list manager so the schema stays
 * unchanged while we ship the rest of the settings shell.
 */
export default function WaypointsTab() {
  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="settings-card-title">Waypoints</h2>
        <p className="settings-card-sub">
          Personalize the catalog used on every universal-link page. Drag to
          reorder, toggle the eye to hide a built-in from the picker, or add
          your own with a URL template.
        </p>
      </div>
      <WaypointsManager />
    </section>
  );
}
