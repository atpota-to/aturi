import type { WaypointData } from '@aturi/waypoints.data';
import type { CustomWaypoint } from './prefs';

/**
 * Canonical front door for each built-in waypoint. Used when the popup has no
 * page-specific Atmosphere URI to open (shortcuts only).
 */
const BUILTIN_HOME: Record<string, string> = {
  aturi: 'https://aturi.to/',
  anisota: 'https://anisota.net/',
  bluesky: 'https://bsky.app/',
  blacksky: 'https://blacksky.community/',
  reddwarf: 'https://reddwarf.app/',
  leaflet: 'https://leaflet.pub/',
  pdsls: 'https://pdsls.dev/',
  anisotaReader: 'https://anisota.net/',
  anisotaExplorer: 'https://anisota.net/explorer',
  atptools: 'https://atp.tools/',
  witchsky: 'https://witchsky.app/',
  catsky: 'https://catsky.social/',
  deer: 'https://deer.social/',
  tangled: 'https://tangled.org/',
  pinksky: 'https://pinkleap.app/',
  margin: 'https://margin.at/',
  semble: 'https://semble.so/',
  streamplace: 'https://stream.place/',
  grain: 'https://grain.social/',
  popfeed: 'https://popfeed.social/',
  sifa: 'https://sifa.id/',
  blento: 'https://blento.app/',
  offprint: 'https://offprint.app/',
  pckt: 'https://pckt.blog/',
};

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Home / landing URL for a waypoint when there is no record context.
 */
export function getWaypointHomePageUrl(
  waypoint: WaypointData,
  customWaypoints: CustomWaypoint[]
): string | null {
  if (waypoint.id.startsWith('custom:')) {
    const cw = customWaypoints.find(c => c.id === waypoint.id);
    if (!cw?.domain) return null;
    const host = cw.domain.replace(/^www\./, '');
    return `https://${host}/`;
  }
  return BUILTIN_HOME[waypoint.id] ?? null;
}

export function homePageSubtitle(waypoint: WaypointData, customWaypoints: CustomWaypoint[]): string {
  const url = getWaypointHomePageUrl(waypoint, customWaypoints);
  if (!url) return 'Open site';
  return hostLabel(url);
}
