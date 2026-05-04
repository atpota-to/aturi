import { WAYPOINT_ICONS } from '@aturi/waypointIcons';

const GenericDot = ({ label }: { label: string }) => (
  <span className="popup-icon-letter" aria-hidden="true">
    {label.charAt(0).toUpperCase()}
  </span>
);

export function WaypointIcon({ id, name }: { id: string; name: string }) {
  const icon = WAYPOINT_ICONS[id];
  if (icon) return <span className="popup-waypoint-icon">{icon}</span>;
  return (
    <span className="popup-waypoint-icon">
      <GenericDot label={name} />
    </span>
  );
}
