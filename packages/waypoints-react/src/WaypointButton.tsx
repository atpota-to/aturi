import { useId, type MouseEvent } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import type { WaypointEntry } from './useWaypoints';
import { slotClass, type WaypointClassNames } from './styling';

export type WaypointButtonProps = {
  waypoint: WaypointEntry;
  /**
   * Called when the row's primary action is activated. When omitted, the
   * primary action is a plain link to the destination.
   */
  onSelect?: (waypoint: WaypointEntry, event: MouseEvent) => void;
  onCopy?: (waypoint: WaypointEntry) => void;
  copied?: boolean;
  showCopy?: boolean;
  unstyled?: boolean;
  classNames?: WaypointClassNames;
};

/**
 * The default waypoint row: icon, name, description, copy control.
 *
 * The row's primary action is a real element — an `<a href>` normally, a
 * `<button>` when `onSelect` is supplied — rather than a click handler on the
 * container. That is what makes Tab, Enter, middle-click, "open in new tab" and
 * the context menu work without reimplementing any of them, and it keeps the
 * accessible name down to the destination itself.
 *
 * The whole card stays clickable: the opt-in stylesheet stretches the primary
 * action over the row with an `::after` overlay, and lifts the copy control back
 * above it. Consumers styling this themselves get the same behavior by copying
 * those three rules, or nothing worse than a normally-sized link if they don't.
 */
export function WaypointButton({
  waypoint,
  onSelect,
  onCopy,
  copied = false,
  showCopy = true,
  unstyled,
  classNames,
}: WaypointButtonProps) {
  const descriptionId = useId();
  const hasDescription = !!waypoint.description;

  // Described-by rather than nested: putting the description inside the named
  // element is what produced "BlueskyView profile on bsky.appOpen in Bluesky".
  const describedBy = hasDescription ? descriptionId : undefined;

  return (
    <div
      data-aturi-wp="button"
      data-category={waypoint.category}
      data-recommended={waypoint.isRecommended || undefined}
      className={slotClass('button', unstyled, classNames)}
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
        {onSelect ? (
          <button
            type="button"
            data-aturi-wp="row-action"
            aria-describedby={describedBy}
            className={slotClass('rowAction', unstyled, classNames)}
            onClick={(event) => onSelect(waypoint, event)}
          >
            <span
              data-aturi-wp="name"
              className={slotClass('name', unstyled, classNames)}
            >
              {waypoint.name}
            </span>
          </button>
        ) : (
          <a
            data-aturi-wp="row-action"
            href={waypoint.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={describedBy}
            className={slotClass('rowAction', unstyled, classNames)}
          >
            <span
              data-aturi-wp="name"
              className={slotClass('name', unstyled, classNames)}
            >
              {waypoint.name}
            </span>
          </a>
        )}
        {hasDescription ? (
          <span
            id={descriptionId}
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
            aria-label={`Copy link to ${waypoint.name}`}
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
        {/*
          Decorative, not interactive. A second anchor to the same URL was a
          duplicate stop in the tab order announcing the same destination twice;
          the affordance it signalled now belongs to the row-wide overlay.
        */}
        <span
          data-aturi-wp="open"
          aria-hidden
          className={slotClass('open', unstyled, classNames)}
        >
          <ExternalLink size={18} />
        </span>
      </span>
    </div>
  );
}
