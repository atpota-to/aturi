'use client';

import { useMemo } from 'react';
import WaypointGroupsManager from '../WaypointGroupsManager';
import NewWaypointsBanner from '@/components/NewWaypointsBanner';
import WaypointLayoutToggle from '@/components/WaypointLayoutToggle';
import { usePreferences } from '@/components/PreferencesProvider';
import {
  newBuiltinWaypointIds,
  addWaypointsToDefaultGroups,
  markWaypointsKnown,
} from '@/utils/preferences';
import { WAYPOINT_DESTINATIONS } from '@/utils/waypoints';

/**
 * Waypoints tab — user-defined groups of waypoints. Drag groups to
 * reorder them in the picker; drag rows within a group to reorder
 * waypoints inside it. The same waypoint may appear in multiple groups;
 * any waypoint not in any group is hidden from the picker.
 */
export default function WaypointsTab() {
  const { prefs, update } = usePreferences();

  const newWaypointIds = useMemo(() => newBuiltinWaypointIds(prefs), [prefs]);
  const newWaypoints = useMemo(
    () => newWaypointIds.map((id) => WAYPOINT_DESTINATIONS[id]).filter(Boolean),
    [newWaypointIds],
  );

  return (
    <>
      <section className="settings-card">
        <div className="settings-card-head">
          <h2 className="settings-card-title">Picker layout</h2>
        </div>

        <div className="settings-toggle-row">
          <div className="settings-toggle-label">
            <span className="settings-toggle-label-text">Layout</span>
            <span className="settings-toggle-label-sub">
              <em>Compact</em>: one line per waypoint. <em>Grid</em>: icon
              tiles, names only. <em>Cards</em>: full cards with descriptions.
            </span>
          </div>
          <WaypointLayoutToggle variant="labels" />
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-head">
          <h2 className="settings-card-title">Waypoint groups</h2>
          <p className="settings-card-sub">
            Drag to reorder. Waypoints in no group are hidden from the picker.
          </p>
        </div>
        {newWaypoints.length > 0 && (
          <NewWaypointsBanner
            waypoints={newWaypoints}
            onAdd={() => update((p) => addWaypointsToDefaultGroups(p, newWaypointIds))}
            onDismiss={() => update((p) => markWaypointsKnown(p, newWaypointIds))}
          />
        )}
        <WaypointGroupsManager />
      </section>
    </>
  );
}
