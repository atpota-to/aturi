import { ReactNode } from 'react';

export type WaypointType = 'post' | 'profile' | 'list';

export type Waypoint = {
  id: string;
  name: string;
  description: string;
  icon: ReactNode;
  getUrl: (handle: string, collection?: string, rkey?: string) => string | null;
  supportedTypes: WaypointType[];
};

// SVG Icons for each platform
export const BlueskySVG = () => (
  <svg viewBox="0 0 360 320" fill="currentColor" width="24" height="24">
    <path d="M180 142c-16.3-35.1-39.7-63.9-57.1-78.6-24.8-20.9-44.1-28.9-56.8-28.9-6.8 0-12 1.2-15.4 2.4-5.7 2-10.2 6.3-13.1 12-4.7 9.2-6 22.6-6 38.1 0 14.5 1.1 29 2.4 40.9 1.4 12.8 3.3 23.4 5.6 30.3 2.5 7.4 5.7 11.8 9.5 13.9 3.8 2.1 8.4 2.8 14.1 1.9 9.1-1.5 20.9-6.2 34.8-13.2 21.3-10.7 45.4-26.3 68-43.5 0 19.7-.1 39.4-.1 59.1 0 17.4 0 34.7.1 51.9-22.6-17.2-46.7-32.8-68-43.5-13.9-7-25.7-11.7-34.8-13.2-5.7-.9-10.3-.2-14.1 1.9-3.8 2.1-7 6.5-9.5 13.9-2.3 6.9-4.2 17.5-5.6 30.3-1.3 11.9-2.4 26.4-2.4 40.9 0 15.5 1.3 28.9 6 38.1 2.9 5.7 7.4 10 13.1 12 3.4 1.2 8.6 2.4 15.4 2.4 12.7 0 32-8 56.8-28.9 17.4-14.7 40.8-43.5 57.1-78.6 16.3 35.1 39.7 63.9 57.1 78.6 24.8 20.9 44.1 28.9 56.8 28.9 6.8 0 12-1.2 15.4-2.4 5.7-2 10.2-6.3 13.1-12 4.7-9.2 6-22.6 6-38.1 0-14.5-1.1-29-2.4-40.9-1.4-12.8-3.3-23.4-5.6-30.3-2.5-7.4-5.7-11.8-9.5-13.9-3.8-2.1-8.4-2.8-14.1-1.9-9.1 1.5-20.9 6.2-34.8 13.2-21.3 10.7-45.4 26.3-68 43.5 0-17.2.1-34.5.1-51.9 0-19.7.1-39.4.1-59.1 22.6 17.2 46.7 32.8 68 43.5 13.9 7 25.7 11.7 34.8 13.2 5.7.9 10.3.2 14.1-1.9 3.8-2.1 7-6.5 9.5-13.9 2.3-6.9 4.2-17.5 5.6-30.3 1.3-11.9 2.4-26.4 2.4-40.9 0-15.5-1.3-28.9-6-38.1-2.9-5.7-7.4-10-13.1-12-3.4-1.2-8.6-2.4-15.4-2.4-12.7 0-32 8-56.8 28.9-17.4 14.7-40.8 43.5-57.1 78.6z"/>
  </svg>
);

export const BlackskySVG = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
    <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 2.18L19 7.3v9.7c0 4.52-3.05 8.84-7 10-3.95-1.16-7-5.48-7-10v-9.7l7-3.12z"/>
  </svg>
);

export const PdslsSVG = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
    <rect x="3" y="3" width="7" height="7"/>
    <rect x="14" y="3" width="7" height="7"/>
    <rect x="3" y="14" width="7" height="7"/>
    <rect x="14" y="14" width="7" height="7"/>
  </svg>
);

export const AtpToolsSVG = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
    <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>
  </svg>
);

export const LeafletSVG = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
    <path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.77C7.5 17.5 9 14 16 12.5c.37 3.5 1.5 6.5 3 10l1.89-.77C18.16 15.5 17 8 17 8z"/>
  </svg>
);

export const RedDwarfSVG = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
    <circle cx="12" cy="12" r="10"/>
    <path fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="2" d="M12 2c-5.5 0-10 4.5-10 10s4.5 10 10 10"/>
  </svg>
);

export const WAYPOINT_DESTINATIONS: Record<string, Waypoint> = {
  bluesky: {
    id: 'bluesky',
    name: 'Bluesky',
    description: 'The original ATProto client',
    icon: <BlueskySVG />,
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        return `https://bsky.app/profile/${handle}/post/${rkey.replace('app.bsky.feed.post/', '')}`;
      }
      return `https://bsky.app/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list'],
  },
  
  blacksky: {
    id: 'blacksky',
    name: 'Blacksky',
    description: 'Alternative ATProto viewer',
    icon: <BlackskySVG />,
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        return `https://blacksky.app/profile/${handle}/post/${rkey}`;
      }
      return `https://blacksky.app/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile'],
  },

  pdsls: {
    id: 'pdsls',
    name: 'pdsls',
    description: 'PDS listing and explorer',
    icon: <PdslsSVG />,
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        return `https://pdsls.dev/at/${handle}/${collection}/${rkey}`;
      }
      return `https://pdsls.dev/at/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list'],
  },

  atptools: {
    id: 'atptools',
    name: 'atp.tools',
    description: 'Developer tools for ATProto',
    icon: <AtpToolsSVG />,
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        return `https://atp.tools/record/${handle}/${collection}/${rkey}`;
      }
      return `https://atp.tools/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list'],
  },

  leaflet: {
    id: 'leaflet',
    name: 'Leaflet',
    description: 'Minimalist ATProto reader',
    icon: <LeafletSVG />,
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey && collection === 'app.bsky.feed.post') {
        return `https://leaflet.social/${handle}/${rkey}`;
      }
      return `https://leaflet.social/${handle}`;
    },
    supportedTypes: ['post', 'profile'],
  },

  reddwarf: {
    id: 'reddwarf',
    name: 'Red Dwarf',
    description: 'Compact ATProto browser',
    icon: <RedDwarfSVG />,
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        return `https://reddwarf.app/@${handle}/${rkey}`;
      }
      return `https://reddwarf.app/@${handle}`;
    },
    supportedTypes: ['post', 'profile'],
  },
};

export const WAYPOINT_ORDER = [
  'bluesky',
  'blacksky',
  'leaflet',
  'reddwarf',
  'pdsls',
  'atptools',
];

/**
 * Get waypoints available for a specific content type
 */
export function getWaypointsForType(type: WaypointType): Waypoint[] {
  return WAYPOINT_ORDER
    .map(id => WAYPOINT_DESTINATIONS[id])
    .filter(waypoint => waypoint.supportedTypes.includes(type));
}


