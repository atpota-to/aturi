// Re-export the full core so a React consumer needs only one install.
export * from '@aturi.to/waypoints';

export { useWaypoints } from './useWaypoints';
export type {
  WaypointEntry,
  WaypointCategoryEntry,
  CustomWaypoint,
  UseWaypointsParams,
  UseWaypointsResult,
} from './useWaypoints';

export { WaypointButton } from './WaypointButton';
export type { WaypointButtonProps } from './WaypointButton';

export { WaypointList } from './WaypointList';
export type {
  WaypointListProps,
  RenderWaypoint,
  RenderWaypointArgs,
} from './WaypointList';

export { WaypointPicker } from './WaypointPicker';
export type { WaypointPickerProps } from './WaypointPicker';

export { useUniversalLink } from './useUniversalLink';
export type {
  ShareOutcome,
  UseUniversalLinkParams,
  UseUniversalLinkResult,
} from './useUniversalLink';

export { UniversalLinkButton } from './UniversalLinkButton';
export type { UniversalLinkButtonProps } from './UniversalLinkButton';

export { cx } from './styling';
export type { WaypointClassNames, WaypointSlot } from './styling';

export * from './waypointIcons';
