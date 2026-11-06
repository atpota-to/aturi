import { WAYPOINT_DESTINATIONS, getWaypointsForType, type Waypoint } from '@/utils/waypoints';
import { customToWaypoint } from '@/utils/personalizeWaypoints';
import type { WaypointType } from '@/utils/waypoints.data';
import type { Preferences } from '@/utils/preferences';
import { isLinkable, type PageSubject } from './pageContext';

/**
 * The apps that can open a profile or record, worked out the way the waypoint
 * picker does. Shared by the command palette's "Open in…" (for the page on
 * screen) and the phone search sheet (for a link typed or pasted into it), so
 * the two never offer different apps for the same thing.
 */

/**
 * Waypoints that point back at aturi.to itself. Their URLs are absolute and
 * production-pinned, so from here they'd only reload this site (or leave a
 * staging deploy for production); "Open in explorer" covers the one useful
 * case.
 */
const SELF_WAYPOINTS = new Set(['aturi', 'aturiExplore']);

export function waypointTypeFor(collection?: string, rkey?: string): WaypointType {
  if (!collection || !rkey) return 'profile';
  if (collection === 'app.bsky.feed.post') return 'post';
  if (collection === 'app.bsky.graph.list') return 'list';
  return 'record';
}

/** How a sentence names what a waypoint type addresses ("Open this post in"). */
export function waypointNoun(type: WaypointType | null): string {
  if (type === 'profile' || type === 'post' || type === 'list') return type;
  return 'record';
}

export type OpenInHit = { waypoint: Waypoint; url: string };

export type OpenInApps = {
  /** What the subject is, as the waypoints see it; null when nothing opens it. */
  type: WaypointType | null;
  /** The reader's own waypoint groups, in their order, custom waypoints included. */
  mine: OpenInHit[];
  /** The rest of the catalog, so no app the picker would show is missing. */
  more: OpenInHit[];
};

export function openInApps(
  subject: PageSubject | null,
  prefs: Pick<Preferences, 'customWaypoints' | 'waypointGroups'>,
): OpenInApps {
  if (!isLinkable(subject)) return { type: null, mine: [], more: [] };
  const type = waypointTypeFor(subject.collection, subject.rkey);
  const handle = subject.repo;
  const did = handle.startsWith('did:') ? handle : undefined;
  const collection = subject.rkey ? subject.collection : undefined;
  const rkey = subject.rkey;

  const seen = new Set<string>();
  const resolve = (w: Waypoint | null | undefined): OpenInHit | null => {
    if (!w || seen.has(w.id) || SELF_WAYPOINTS.has(w.id)) return null;
    if (!w.supportedTypes.includes(type)) return null;
    const url = w.getUrl(handle, collection, rkey, did);
    if (!url) return null;
    seen.add(w.id);
    return { waypoint: w, url };
  };

  const customById = new Map(prefs.customWaypoints.map((c) => [c.id, c]));
  const mine: OpenInHit[] = [];
  for (const group of prefs.waypointGroups) {
    for (const id of group.waypointIds) {
      const custom = customById.get(id);
      const hit = resolve(custom ? customToWaypoint(custom) : WAYPOINT_DESTINATIONS[id]);
      if (hit) mine.push(hit);
    }
  }
  const more: OpenInHit[] = [];
  for (const w of getWaypointsForType(type)) {
    const hit = resolve(w);
    if (hit) more.push(hit);
  }
  return { type, mine, more };
}
