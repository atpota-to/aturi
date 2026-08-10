'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesProvider';
import { addWaypointsToDefaultGroups } from '@/utils/preferences';
import { WAYPOINT_DESTINATIONS } from '@/utils/waypoints';
import type { Release } from '@/utils/releaseNotes';

/**
 * The body of a "What's new" surface — shared verbatim by the modal and the
 * header badge's panel so the two can never drift.
 *
 * An entry that names built-in waypoints grows an "Add to my waypoints"
 * button. Ids are resolved against the live catalog rather than trusted, so a
 * waypoint that was renamed or dropped after its release note shipped
 * degrades to plain prose instead of rendering a button that adds nothing.
 */
export default function WhatsNewContent({ releases }: { releases: Release[] }) {
  return (
    <div className="whats-new-body">
      {releases.map((release) => (
        <section key={release.id} className="whats-new-release">
          {releases.length > 1 && (
            <p className="whats-new-release-label">{release.label}</p>
          )}
          <ul className="whats-new-list">
            {release.entries.map((entry) => (
              <li key={`${release.id}:${entry.id}`} className="whats-new-item">
                <Entry
                  title={entry.title}
                  body={entry.body}
                  waypointIds={entry.waypointIds}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Entry({
  title,
  body,
  waypointIds,
}: {
  title: string;
  body: string;
  waypointIds?: string[];
}) {
  const { prefs, update } = usePreferences();
  const [added, setAdded] = useState(false);

  const waypoints = useMemo(
    () => (waypointIds ?? []).map((id) => WAYPOINT_DESTINATIONS[id]).filter(Boolean),
    [waypointIds],
  );

  // A waypoint already sitting in one of the user's groups needs no button —
  // they may have added it from the picker banner before opening this.
  const missingIds = useMemo(() => {
    const inAGroup = new Set(prefs.waypointGroups.flatMap((g) => g.waypointIds));
    return waypoints.map((w) => w.id).filter((id) => !inAGroup.has(id));
  }, [waypoints, prefs.waypointGroups]);

  const icon = waypoints[0]?.icon ?? null;
  const showAdd = missingIds.length > 0 && !added;

  return (
    <>
      <h3 className="whats-new-item-title">
        {icon && (
          <span className="whats-new-item-icon" aria-hidden>
            {icon}
          </span>
        )}
        <span>{title}</span>
        {waypoints.length > 0 && <span className="whats-new-chip">waypoint</span>}
      </h3>
      <p className="whats-new-item-body">{body}</p>

      {showAdd && (
        <div className="whats-new-item-action">
          <button
            type="button"
            className="whats-new-btn"
            onClick={() => {
              update((p) => addWaypointsToDefaultGroups(p, missingIds));
              setAdded(true);
            }}
          >
            {missingIds.length === 1
              ? 'Add to my waypoints'
              : `Add ${missingIds.length} to my waypoints`}
          </button>
        </div>
      )}

      {added && (
        <p className="whats-new-item-added" role="status">
          <Check size={14} aria-hidden />
          Added to your waypoints
        </p>
      )}
    </>
  );
}
