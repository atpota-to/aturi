import { Fragment, type MouseEvent, type ReactNode } from 'react';
import type { WaypointEntry } from './useWaypoints';
import { WaypointButton } from './WaypointButton';
import { slotClass, type WaypointClassNames } from './styling';

export type RenderWaypointArgs = {
  waypoint: WaypointEntry;
  copied: boolean;
  onCopy?: (waypoint: WaypointEntry) => void;
  onSelect?: (waypoint: WaypointEntry, event: MouseEvent) => void;
};

/**
 * Render-prop to replace the default row entirely while keeping the data.
 *
 * This is **called**, not rendered as a component, so it has no fiber of its
 * own: React hooks inside the function body will throw. Put any state in a
 * component that the prop returns —
 * `renderWaypoint={(args) => <MyRow {...args} />}` — and hooks work normally.
 *
 * The call is deliberate. Rendering it as a component would give the inline
 * arrow in that example a new component type on every parent render, remounting
 * every row and discarding their state.
 */
export type RenderWaypoint = (args: RenderWaypointArgs) => ReactNode;

export type WaypointListProps = {
  waypoints: WaypointEntry[];
  copiedId?: string | null;
  onCopy?: (waypoint: WaypointEntry) => void;
  onSelect?: (waypoint: WaypointEntry, event: MouseEvent) => void;
  showCopy?: boolean;
  unstyled?: boolean;
  classNames?: WaypointClassNames;
  renderWaypoint?: RenderWaypoint;
};

/** Renders a flat list of waypoint rows (default `WaypointButton` or a render-prop). */
export function WaypointList({
  waypoints,
  copiedId,
  onCopy,
  onSelect,
  showCopy = true,
  unstyled,
  classNames,
  renderWaypoint,
}: WaypointListProps) {
  return (
    <div
      data-aturi-wp="list"
      className={slotClass('list', unstyled, classNames)}
    >
      {waypoints.map((waypoint) =>
        renderWaypoint ? (
          <Fragment key={waypoint.id}>
            {renderWaypoint({
              waypoint,
              copied: copiedId === waypoint.id,
              onCopy,
              onSelect,
            })}
          </Fragment>
        ) : (
          <WaypointButton
            key={waypoint.id}
            waypoint={waypoint}
            copied={copiedId === waypoint.id}
            onCopy={onCopy}
            onSelect={onSelect}
            showCopy={showCopy}
            unstyled={unstyled}
            classNames={classNames}
          />
        ),
      )}
    </div>
  );
}
