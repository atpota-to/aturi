'use client';

import WaypointGroupsManager from '../WaypointGroupsManager';

/**
 * Waypoints tab — user-defined groups of waypoints. Drag groups to
 * reorder them in the picker; drag rows within a group to reorder
 * waypoints inside it. The same waypoint may appear in multiple groups;
 * any waypoint not in any group is hidden from the picker.
 */
export default function WaypointsTab() {
  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="settings-card-title">Waypoint groups</h2>
        <p className="settings-card-sub">
          Build your own groups for the universal-link picker. Drag groups
          (or rows within a group) to reorder. Use <strong>+</strong> on a
          group header to add waypoints from the catalog. The same waypoint
          can live in multiple groups; anything not in a group is hidden.
        </p>
      </div>
      <WaypointGroupsManager />
    </section>
  );
}
