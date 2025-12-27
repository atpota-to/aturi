import { ReactNode } from 'react';
import { MoonStar, Wrench } from 'lucide-react';

export type WaypointType = 'post' | 'profile' | 'list' | 'unknown';

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
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="24" height="24">
    <path fill="currentColor" d="M111.8 62.2C170.2 105.9 233 194.7 256 242.4c23-47.6 85.8-136.4 144.2-180.2c42.1-31.6 110.3-56 110.3 21.8c0 15.5-8.9 130.5-14.1 149.2C478.2 298 412 314.6 353.1 304.5c102.9 17.5 129.1 75.5 72.5 133.5c-107.4 110.2-154.3-27.6-166.3-62.9l0 0c-1.7-4.9-2.6-7.8-3.3-7.8s-1.6 3-3.3 7.8l0 0c-12 35.3-59 173.1-166.3 62.9c-56.5-58-30.4-116 72.5-133.5C100 314.6 33.8 298 15.7 233.1C10.4 214.4 1.5 99.4 1.5 83.9c0-77.8 68.2-53.4 110.3-21.8z"/>
  </svg>
);

export const BlackskySVG = () => (
  <svg width="24" height="24" viewBox="0 0 285 243" fill="none" xmlns="http://www.w3.org/2000/svg">
    <g clipPath="url(#clip0_1011_989)">
      <path d="M148.846 144.562C148.846 159.75 161.158 172.062 176.346 172.062H207.012V185.865H176.346C161.158 185.865 148.846 198.177 148.846 213.365V243.045H136.029V213.365C136.029 198.177 123.717 185.865 108.529 185.865H77.8633V172.062H108.529C123.717 172.062 136.029 159.75 136.029 144.562V113.896H148.846V144.562Z" fill="currentColor"/>
      <path d="M170.946 31.8766C160.207 42.616 160.207 60.0281 170.946 70.7675L192.631 92.4516L182.871 102.212L161.186 80.5275C150.447 69.7881 133.035 69.7881 122.296 80.5275L101.309 101.514L92.2456 92.4509L113.232 71.4642C123.972 60.7248 123.972 43.3128 113.232 32.5733L91.5488 10.8899L101.309 1.12988L122.993 22.814C133.732 33.5533 151.144 33.5534 161.884 22.814L183.568 1.12988L192.631 10.1925L170.946 31.8766Z" fill="currentColor"/>
      <path d="M79.0525 75.3259C75.1216 89.9962 83.8276 105.076 98.498 109.006L128.119 116.943L124.547 130.275L94.9267 122.338C80.2564 118.407 65.1772 127.113 61.2463 141.784L53.5643 170.453L41.1837 167.136L48.8654 138.467C52.7963 123.797 44.0902 108.718 29.4199 104.787L-0.201172 96.8497L3.37124 83.5173L32.9923 91.4542C47.6626 95.3851 62.7419 86.679 66.6728 72.0088L74.6098 42.3877L86.9895 45.7048L79.0525 75.3259Z" fill="currentColor"/>
      <path d="M218.413 71.4229C222.344 86.093 237.423 94.7992 252.094 90.8683L281.715 82.9313L285.287 96.2628L255.666 104.2C240.995 108.131 232.29 123.21 236.22 137.88L243.902 166.55L231.522 169.867L223.841 141.198C219.91 126.528 204.831 117.822 190.16 121.753L160.539 129.69L156.967 116.357L186.588 108.42C201.258 104.49 209.964 89.4103 206.033 74.74L198.096 45.1189L210.476 41.8018L218.413 71.4229Z" fill="currentColor"/>
    </g>
    <defs>
      <clipPath id="clip0_1011_989">
        <rect width="285" height="243" fill="white"/>
      </clipPath>
    </defs>
  </svg>
);

export const PdslsSVG = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <path fill="currentColor" d="M14 1a3 3 0 0 1 2.348 4.868l2 3.203Q18.665 9 19 9a3 3 0 1 1-2.347 1.132l-2-3.203a3 3 0 0 1-1.304 0l-2.001 3.203c.408.513.652 1.162.652 1.868s-.244 1.356-.653 1.868l2.002 3.203Q13.664 17 14 17a3 3 0 1 1-2.347 1.132L9.65 14.929a3 3 0 0 1-1.302 0l-2.002 3.203a3 3 0 1 1-1.696-1.06l2.002-3.204A3 3 0 0 1 9.65 9.07l2.002-3.202A3 3 0 0 1 14 1" />
  </svg>
);

export const LeafletSVG = () => (
  <svg width="24" height="24" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fillRule="evenodd" clipRule="evenodd" d="M6.19354 43.7615C4.02326 47.9529 2.3971 50.6787 0.825968 54.5903C-0.40065 57.6442 1.08066 61.1142 4.13453 62.3408C7.18841 63.5675 10.6584 62.0862 11.8851 59.0323C12.1956 58.2591 12.4949 57.4976 12.784 56.7619L12.7867 56.755C13.8877 53.9534 14.8372 51.5562 15.9859 49.3971C17.2796 49.3269 18.7589 49.3161 20.4268 49.3067L20.6365 49.3056C23.6784 49.2888 27.3433 49.2687 30.5036 48.629C33.6657 47.989 37.5791 46.476 39.3089 42.4233C39.7772 41.3263 40.2521 39.7069 39.8363 38.0619C39.9611 38.0618 40.0889 38.0618 40.2201 38.0618C40.2903 38.0618 40.3619 38.0618 40.4348 38.0619C42.1036 38.063 44.452 38.0645 46.5513 37.4934C49.0009 36.8271 51.5766 35.2492 52.7066 31.9254C53.115 30.7244 53.1906 29.4632 52.8381 28.2712C52.9461 28.2521 53.0569 28.2327 53.1706 28.2127C53.2252 28.2032 53.2807 28.1935 53.3369 28.1837C54.7713 27.933 56.6912 27.5974 58.3315 26.9838C59.9271 26.3869 62.5489 25.0534 63.3345 21.9971C63.7822 20.2552 63.7353 18.411 62.7294 16.7456C62.3111 16.0531 61.779 15.5078 61.3069 15.1057C61.7466 14.5555 62.3058 13.79 62.6909 12.9455C63.3591 11.4803 63.7036 9.32754 62.3369 7.22123C60.7856 4.83067 58.1256 4.41306 56.8098 4.30487C55.4415 4.19236 53.9707 4.31254 52.9137 4.40806C52.7702 4.05645 52.5725 3.68669 52.2993 3.32178C50.832 1.36219 48.5559 1.19749 47.2748 1.23194C44.6865 1.30155 42.6621 2.45002 41.1987 3.64119C40.4307 4.26635 38.6031 6.82233 38.0052 7.48715C38.0052 5.10325 35.7086 3.89003 34.0939 3.64119C30.959 3.15806 29.0173 5.17673 27.2122 7.48715C24.962 10.3672 23.22 14.0741 21.1617 16.8593C20.4523 16.3978 19.6125 15.3179 18.2694 15.3803C16.0564 15.4831 14.5863 16.9832 13.6351 18.0097C11.9797 19.796 10.9264 23.0413 10.2095 25.4575C9.43004 28.9535 8.89843 30.4276 8.26688 34.2604C7.8913 36.5398 7.70089 38.3385 7.70089 40.8839C7.27002 41.7282 6.77687 42.635 6.19354 43.7615Z" fill="currentColor"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M18.9944 18.4871C19.6421 19.0561 20.4012 19.7231 22.0388 19.1533C23.1095 18.7808 24.4933 16.3538 26.0373 13.6458C28.2942 9.68748 30.8934 5.12877 33.3576 5.50855C36.3301 5.96665 36.1471 7.6122 36.0064 8.87787C35.9077 9.76563 35.8298 10.4665 36.8761 10.4396C37.9419 10.4122 38.9792 9.15957 40.1829 7.70596C41.8456 5.69807 43.826 3.30666 46.6379 3.23104C48.6204 3.17772 48.5891 4.03205 48.5574 4.89842C48.5371 5.45219 48.5166 6.01088 49.0218 6.34062C49.5194 6.66547 50.7707 6.55195 52.2092 6.42146C54.5154 6.21226 57.3027 5.95942 58.2369 7.39914C59.0583 8.66485 58.0119 9.92284 57.0089 11.1286C56.1594 12.1499 55.341 13.1337 55.7152 14.0531C56.0204 14.8031 56.647 15.2257 57.2613 15.64C58.2659 16.3175 59.2375 16.9727 58.7159 19.0019C58.1644 21.1475 54.8463 21.7286 51.7361 22.2733C49.1306 22.7296 46.6709 23.1603 46.106 24.4639C45.7516 25.2816 46.3394 25.6623 46.9979 26.0889C47.7849 26.5986 48.673 27.1739 48.1751 28.6384C47.011 32.0622 43.1238 32.0622 39.4756 32.0623C36.3442 32.0623 33.3888 32.0624 32.4827 34.2275C31.9596 35.4776 32.7514 35.6982 33.6201 35.9404C34.6836 36.2368 35.8623 36.5653 34.8856 38.8535C33.0165 43.2324 26.0433 43.2715 19.6599 43.3073C17.3193 43.3205 15.058 43.3332 13.1567 43.5592C12.9396 43.585 12.7471 43.7095 12.6334 43.8962C10.8838 46.767 9.64296 49.9245 8.31937 53.2926C8.0286 54.0325 7.73384 54.7825 7.42881 55.542C7.02558 56.5459 5.88485 57.0328 4.88093 56.6296C3.877 56.2264 3.39005 55.0857 3.79328 54.0817C5.29513 50.3426 7.02775 46.9042 8.92229 43.7479C12.0142 38.0542 18.109 31.0686 24.5542 25.8207C30.2889 21.0461 35.7654 17.4724 42.1392 14.7607C42.9371 14.4212 42.7002 13.4882 41.8673 13.7289C36.2143 15.3625 31.2171 18.6029 26.0373 21.8684C20.4035 25.4201 15.6824 30.2231 12.7771 33.7151C12.2649 34.3308 11.1447 33.8245 11.306 33.04C12.5677 26.9025 13.87 21.27 15.7789 19.2101C17.5913 17.2543 18.2114 17.7992 18.9944 18.4871Z" fill="var(--bg-primary)"/>
  </svg>
);

export const RedDwarfSVG = () => (
  <svg fill="none" viewBox="0 0 24 24" width="24" height="24">
    <path fill="currentColor" d="M12.001 0A12 12 0 1 0 24 11.999A12.01 12.01 0 0 0 12.001 0m0 2.464a9.53 9.53 0 0 1 9.514 8.889a9.5 9.5 0 0 1-.863 4.649H3.35a9.53 9.53 0 0 1 .616-9.14a9.53 9.53 0 0 1 8.036-4.398"/>
  </svg>
);

export const WAYPOINT_DESTINATIONS: Record<string, Waypoint> = {
  anisota: {
    id: 'anisota',
    name: 'Anisota',
    description: 'View on anisota.net',
    icon: <MoonStar size={24} strokeWidth={2} />,
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        return `https://anisota.net/profile/${handle}/post/${rkey}`;
      }
      return `https://anisota.net/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list'],
  },
  
  bluesky: {
    id: 'bluesky',
    name: 'Bluesky',
    description: 'View on bsky.app',
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
    description: 'View on blacksky.community',
    icon: <BlackskySVG />,
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        return `https://blacksky.community/profile/${handle}/post/${rkey}`;
      }
      return `https://blacksky.community/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list'],
  },

  reddwarf: {
    id: 'reddwarf',
    name: 'Red Dwarf',
    description: 'Open on reddwarf.app',
    icon: <RedDwarfSVG />,
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        return `https://reddwarf.app/profile/${handle}/post/${rkey}`;
      }
      return `https://reddwarf.app/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list'],
  },

  leaflet: {
    id: 'leaflet',
    name: 'Leaflet',
    description: 'Minimalist ATProto reader',
    icon: <LeafletSVG />,
    getUrl: (handle) => {
      // Leaflet doesn't have post pages yet, always go to profile
      return `https://leaflet.pub/p/${handle}`;
    },
    supportedTypes: ['profile'],
  },

  pdsls: {
    id: 'pdsls',
    name: 'pdsls',
    description: 'View raw record on pdsls.dev',
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
    description: 'View on atp.tools',
    icon: <Wrench size={24} strokeWidth={2} />,
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        return `https://atp.tools/record/${handle}/${collection}/${rkey}`;
      }
      return `https://atp.tools/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list'],
  },
};

export const WAYPOINT_ORDER = [
  'anisota',
  'bluesky',
  'blacksky',
  'reddwarf',
  'leaflet',
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

