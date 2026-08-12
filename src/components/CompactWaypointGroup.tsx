'use client';

import { Copy, Check } from 'lucide-react';
import type { Waypoint } from '@/utils/waypoints';
import type { WaypointType } from '@/utils/waypoints.data';

type CompactWaypointGroupProps = {
  /** Group heading — a user group's name, or the recommended label. */
  label: string;
  waypoints: Waypoint[];
  /** `classic` is drawn by CategoryCard instead, so only these two land here. */
  layout: 'dense' | 'grid';
  type: WaypointType;
  handle: string;
  collection?: string;
  rkey?: string;
  did?: string;
  copiedId: string | null;
  onCopy: (url: string, waypointId: string, e: React.MouseEvent) => void;
  /** Marks the recommended block so its label reads as the accent. */
  highlighted?: boolean;
};

/**
 * Host a waypoint URL lands on, minus a leading `www.` — the right-hand
 * column of the dense list, standing in for the description. Custom
 * waypoints expand a user-supplied template, so an unparseable URL is
 * possible; fall back to no host rather than throwing inside the picker.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * One group of waypoints in either compact layout.
 *
 * Both layouts drop the description line the classic cards carry — `dense`
 * trades it for the host, `grid` for nothing at all — so the full text is
 * kept on `title` for a hover/long-press. Rows are real anchors here rather
 * than the classic card's `role="button"` div, which is what makes
 * cmd-click, middle-click, and keyboard activation work without handlers.
 */
export default function CompactWaypointGroup({
  label,
  waypoints,
  layout,
  type,
  handle,
  collection,
  rkey,
  did,
  copiedId,
  onCopy,
  highlighted = false,
}: CompactWaypointGroupProps) {
  const entries = waypoints
    .map((waypoint) => ({
      waypoint,
      url: waypoint.getUrl(handle, collection, rkey, did),
    }))
    .filter((e): e is { waypoint: Waypoint; url: string } => e.url !== null);

  if (entries.length === 0) return null;

  const describe = (waypoint: Waypoint) =>
    typeof waypoint.description === 'function'
      ? waypoint.description(collection, type)
      : waypoint.description;

  return (
    <div className="waypoint-group">
      <div className={`waypoint-group-label${highlighted ? ' is-highlighted' : ''}`}>
        <span>{label}</span>
        <i aria-hidden="true" />
        <em>{entries.length}</em>
      </div>

      {layout === 'grid' ? (
        <div className="waypoint-tiles">
          {entries.map(({ waypoint, url }) => (
            <a
              key={waypoint.id}
              className="waypoint-tile"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={describe(waypoint)}
            >
              <span className="waypoint-compact-icon">{waypoint.icon}</span>
              <span className="waypoint-tile-name">{waypoint.name}</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="waypoint-rows">
          {entries.map(({ waypoint, url }) => {
            const isCopied = copiedId === waypoint.id;
            return (
              <div key={waypoint.id} className="waypoint-row">
                <a
                  className="waypoint-row-link"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={describe(waypoint)}
                >
                  <span className="waypoint-compact-icon">{waypoint.icon}</span>
                  <span className="waypoint-row-name">{waypoint.name}</span>
                  <span className="waypoint-row-host">{hostOf(url)}</span>
                </a>
                <button
                  type="button"
                  className="waypoint-row-copy"
                  aria-label={`Copy ${waypoint.name} link`}
                  onClick={(e) => onCopy(url, waypoint.id, e)}
                >
                  {isCopied ? (
                    <Check size={16} style={{ color: 'var(--text-accent)' }} />
                  ) : (
                    <Copy size={16} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
