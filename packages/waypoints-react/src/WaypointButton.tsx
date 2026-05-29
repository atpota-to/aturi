import type { MouseEvent } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import type { WaypointEntry } from './useWaypoints';
import { slotClass, type WaypointClassNames } from './styling';

export type WaypointButtonProps = {
  waypoint: WaypointEntry;
  /**
   * Called when the row (not the copy/open controls) is activated. When
   * omitted, the row opens the destination in a new tab.
   */
  onSelect?: (waypoint: WaypointEntry, event: MouseEvent) => void;
  onCopy?: (waypoint: WaypointEntry) => void;
  copied?: boolean;
  showCopy?: boolean;
  unstyled?: boolean;
  classNames?: WaypointClassNames;
};

/** The default waypoint row: icon, name, description, copy + open controls. */
export function WaypointButton({
  waypoint,
  onSelect,
  onCopy,
  copied = false,
  showCopy = true,
  unstyled,
  classNames,
}: WaypointButtonProps) {
  const handleRootClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('a')) return;
    if (onSelect) {
      onSelect(waypoint, event);
      return;
    }
    if (typeof window !== 'undefined') {
      window.open(waypoint.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      data-aturi-wp="button"
      data-category={waypoint.category}
      data-recommended={waypoint.isRecommended || undefined}
      className={slotClass('button', unstyled, classNames)}
      onClick={handleRootClick}
      role="button"
    >
      <span
        data-aturi-wp="icon"
        className={slotClass('icon', unstyled, classNames)}
        aria-hidden
      >
        {waypoint.icon}
      </span>
      <span
        data-aturi-wp="content"
        className={slotClass('content', unstyled, classNames)}
      >
        <span
          data-aturi-wp="name"
          className={slotClass('name', unstyled, classNames)}
        >
          {waypoint.name}
        </span>
        {waypoint.description ? (
          <span
            data-aturi-wp="description"
            className={slotClass('description', unstyled, classNames)}
          >
            {waypoint.description}
          </span>
        ) : null}
      </span>
      <span
        data-aturi-wp="actions"
        className={slotClass('actions', unstyled, classNames)}
      >
        {showCopy ? (
          <button
            type="button"
            data-aturi-wp="copy"
            aria-label="Copy link"
            className={slotClass('copy', unstyled, classNames)}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCopy?.(waypoint);
            }}
          >
            {copied ? (
              <Check size={18} aria-hidden />
            ) : (
              <Copy size={18} aria-hidden />
            )}
          </button>
        ) : null}
        <a
          data-aturi-wp="open"
          href={waypoint.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open in ${waypoint.name}`}
          className={slotClass('open', unstyled, classNames)}
        >
          <ExternalLink size={18} aria-hidden />
        </a>
      </span>
    </div>
  );
}
