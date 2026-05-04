export type WaypointType = 'post' | 'profile' | 'list' | 'record' | 'unknown';

/**
 * Keys identifying which "data family" a waypoint belongs to for auto-redirect
 * purposes. Two waypoints can only be the endpoints of an auto-redirect when
 * they share at least one family key (i.e. they render the same underlying
 * atproto collections). Display groupings live in `WAYPOINT_CATEGORIES_DATA`
 * and are independent of this.
 */
export type RedirectCompatFamily =
  | 'bluesky-social'
  | 'standard-site'
  | 'tangled'
  | 'margin'
  | 'grain'
  | 'pinksky'
  | 'semble'
  | 'streamplace'
  | 'popfeed'
  | 'sifa'
  | 'blento';

export type WaypointData = {
  id: string;
  name: string;
  description: string | ((collection?: string, type?: WaypointType) => string);
  getUrl: (handle: string, collection?: string, rkey?: string, did?: string) => string | null;
  supportedTypes: WaypointType[];
  category: string;
  /**
   * Data families this waypoint participates in. Auto-redirect rules are only
   * emitted between waypoints that share at least one family. An empty array
   * means the waypoint can never be an auto-redirect source *or* destination
   * (dev tools / generic record viewers land here by design).
   */
  redirectCompat: RedirectCompatFamily[];
};

export type CompatFamilyMeta = {
  id: RedirectCompatFamily;
  name: string;
  description: string;
};

/**
 * Registry of compat families. `description` is shown in the options UI so the
 * user understands what each "Favorite for X" controls.
 */
export const COMPAT_FAMILIES: Record<RedirectCompatFamily, CompatFamilyMeta> = {
  'bluesky-social': {
    id: 'bluesky-social',
    name: 'Bluesky clients',
    description: 'Apps that render bsky posts, profiles, and lists at /profile/:handle.',
  },
  'standard-site': {
    id: 'standard-site',
    name: 'Publications',
    description: 'Readers for Standard Site and Leaflet publications.',
  },
  tangled: {
    id: 'tangled',
    name: 'Tangled',
    description: 'Tangled repositories and related records.',
  },
  margin: {
    id: 'margin',
    name: 'Margin',
    description: 'Annotations, highlights, and bookmarks on margin.at.',
  },
  grain: {
    id: 'grain',
    name: 'Grain',
    description: 'Photo galleries on grain.social.',
  },
  pinksky: {
    id: 'pinksky',
    name: 'Pinkleap',
    description: 'Pinkleap browsing experience.',
  },
  semble: {
    id: 'semble',
    name: 'Semble',
    description: 'Semble profiles.',
  },
  streamplace: {
    id: 'streamplace',
    name: 'Streamplace',
    description: 'Streamplace profiles.',
  },
  popfeed: {
    id: 'popfeed',
    name: 'Popfeed',
    description: 'Popfeed profiles.',
  },
  sifa: {
    id: 'sifa',
    name: 'Sifa',
    description: 'Sifa profiles.',
  },
  blento: {
    id: 'blento',
    name: 'Blento',
    description: 'Blento profiles.',
  },
};

export const COMPAT_FAMILY_ORDER: RedirectCompatFamily[] = [
  'bluesky-social',
  'standard-site',
  'pinksky',
  'tangled',
  'margin',
  'grain',
  'semble',
  'streamplace',
  'popfeed',
  'sifa',
  'blento',
];

export type WaypointCategoryData = {
  id: string;
  name: string;
  description?: string;
  defaultWaypointId: string;
  subcategories?: WaypointCategoryData[];
};

export type CategorizedWaypointsData = {
  category: WaypointCategoryData;
  waypoints: WaypointData[];
};

export const WAYPOINT_DESTINATIONS_DATA: Record<string, WaypointData> = {
  anisota: {
    id: 'anisota',
    name: 'Anisota',
    description: (collection) => {
      if (collection === 'app.bsky.feed.post') return 'View post on anisota.net';
      if (collection === 'app.bsky.graph.list') return 'View list on anisota.net';
      if (collection?.startsWith('site.standard.') || collection?.startsWith('pub.leaflet.')) {
        return 'View document on anisota.net';
      }
      return 'View profile on anisota.net';
    },
    getUrl: (handle, collection, rkey, did) => {
      if (collection && rkey) {
        if (collection === 'app.bsky.feed.post') {
          return `https://anisota.net/profile/${handle}/post/${rkey}`;
        }
        if (collection === 'app.bsky.graph.list') {
          return `https://anisota.net/profile/${handle}/lists/${rkey}`;
        }
        if (collection.startsWith('site.standard.') || collection.startsWith('pub.leaflet.')) {
          // Anisota's document viewer addresses records by DID when available.
          const identifier = did || handle;
          return `https://anisota.net/profile/${identifier}/document/${rkey}`;
        }
        return `https://anisota.net/profile/${handle}`;
      }
      return `https://anisota.net/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'blueskyClients',
    redirectCompat: ['bluesky-social', 'standard-site'],
  },

  bluesky: {
    id: 'bluesky',
    name: 'Bluesky',
    description: (collection) => {
      if (collection === 'app.bsky.feed.post') return 'View post on bsky.app';
      if (collection === 'app.bsky.graph.list') return 'View list on bsky.app';
      return 'View profile on bsky.app';
    },
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        if (collection === 'app.bsky.feed.post') {
          return `https://bsky.app/profile/${handle}/post/${rkey}`;
        }
        return `https://bsky.app/profile/${handle}`;
      }
      return `https://bsky.app/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'blueskyClients',
    redirectCompat: ['bluesky-social'],
  },

  blacksky: {
    id: 'blacksky',
    name: 'Blacksky',
    description: (collection) => {
      if (collection === 'app.bsky.feed.post') return 'View post on blacksky.community';
      if (collection === 'app.bsky.graph.list') return 'View list on blacksky.community';
      return 'View profile on blacksky.community';
    },
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        if (collection === 'app.bsky.feed.post') {
          return `https://blacksky.community/profile/${handle}/post/${rkey}`;
        }
        return `https://blacksky.community/profile/${handle}`;
      }
      return `https://blacksky.community/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'blueskyForks',
    redirectCompat: ['bluesky-social'],
  },

  reddwarf: {
    id: 'reddwarf',
    name: 'Red Dwarf',
    description: (collection) => {
      if (collection === 'app.bsky.feed.post') return 'View post on reddwarf.app';
      if (collection === 'app.bsky.graph.list') return 'View list on reddwarf.app';
      return 'View profile on reddwarf.app';
    },
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        if (collection === 'app.bsky.feed.post') {
          return `https://reddwarf.app/profile/${handle}/post/${rkey}`;
        }
        return `https://reddwarf.app/profile/${handle}`;
      }
      return `https://reddwarf.app/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'blueskyForks',
    redirectCompat: ['bluesky-social'],
  },

  leaflet: {
    id: 'leaflet',
    name: 'Leaflet',
    description: 'View profile on leaflet.pub',
    getUrl: (handle) => {
      return `https://leaflet.pub/p/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'publications',
    redirectCompat: ['standard-site'],
  },

  pdsls: {
    id: 'pdsls',
    name: 'PDSls',
    description: 'View raw record on pdsls.dev',
    getUrl: (handle, collection, rkey, did) => {
      const identifier = did || handle;
      if (collection && rkey) {
        return `https://pdsls.dev/at://${identifier}/${collection}/${rkey}`;
      }
      return `https://pdsls.dev/at://${identifier}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'devTools',
    redirectCompat: [],
  },

  anisotaExplorer: {
    id: 'anisotaExplorer',
    name: 'Anisota Explorer',
    description: 'View raw record on anisota.net',
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        return `https://anisota.net/explorer/${handle}/${collection}/${rkey}`;
      }
      return `https://anisota.net/explorer/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'devTools',
    redirectCompat: [],
  },

  atptools: {
    id: 'atptools',
    name: 'atp.tools',
    description: 'View raw record on atp.tools',
    getUrl: (handle, collection, rkey, did) => {
      const identifier = did || handle;
      if (collection && rkey) {
        return `https://atp.tools/at:/${identifier}/${collection}/${rkey}`;
      }
      return `https://atp.tools/at:/${identifier}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'devTools',
    redirectCompat: [],
  },

  witchsky: {
    id: 'witchsky',
    name: 'Witchsky',
    description: (collection) => {
      if (collection === 'app.bsky.feed.post') return 'View post on witchsky.app';
      if (collection === 'app.bsky.graph.list') return 'View list on witchsky.app';
      return 'View profile on witchsky.app';
    },
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        if (collection === 'app.bsky.feed.post') {
          return `https://witchsky.app/profile/${handle}/post/${rkey}`;
        }
        return `https://witchsky.app/profile/${handle}`;
      }
      return `https://witchsky.app/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'blueskyForks',
    redirectCompat: ['bluesky-social'],
  },

  catsky: {
    id: 'catsky',
    name: 'Catsky',
    description: (collection) => {
      if (collection === 'app.bsky.feed.post') return 'View post on catsky.social';
      if (collection === 'app.bsky.graph.list') return 'View list on catsky.social';
      return 'View profile on catsky.social';
    },
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        if (collection === 'app.bsky.feed.post') {
          return `https://catsky.social/profile/${handle}/post/${rkey}`;
        }
        return `https://catsky.social/profile/${handle}`;
      }
      return `https://catsky.social/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'blueskyForks',
    redirectCompat: ['bluesky-social'],
  },

  deer: {
    id: 'deer',
    name: 'Deer',
    description: (collection) => {
      if (collection === 'app.bsky.feed.post') return 'View post on deer.social';
      if (collection === 'app.bsky.graph.list') return 'View list on deer.social';
      return 'View profile on deer.social';
    },
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        if (collection === 'app.bsky.feed.post') {
          return `https://deer.social/profile/${handle}/post/${rkey}`;
        }
        return `https://deer.social/profile/${handle}`;
      }
      return `https://deer.social/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'blueskyForks',
    redirectCompat: ['bluesky-social'],
  },

  tangled: {
    id: 'tangled',
    name: 'Tangled',
    description: 'View profile on tangled.org',
    getUrl: (handle) => {
      return `https://tangled.org/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'atmosphereApps',
    redirectCompat: ['tangled'],
  },


  pinksky: {
    id: 'pinksky',
    name: 'Pinkleap',
    description: (collection) => {
      if (collection === 'app.bsky.feed.post') return 'View post on pinkleap.app';
      return 'View profile on pinkleap.app';
    },
    getUrl: (handle, collection, rkey, did) => {
      if (collection && rkey) {
        if (collection === 'app.bsky.feed.post') {
          const identifier = did || handle;
          const atUri = `at://${identifier}/${collection}/${rkey}`;
          const encodedUri = encodeURIComponent(atUri);
          const encodedDid = encodeURIComponent(identifier);
          return `https://pinkleap.app/feed?uri=${encodedUri}&src=profile&index=1&did=${encodedDid}&showThreads=${encodedDid}`;
        }
        return `https://pinkleap.app/profile/${handle}`;
      }
      return `https://pinkleap.app/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'atmosphereApps',
    redirectCompat: ['pinksky'],
  },

  margin: {
    id: 'margin',
    name: 'Margin',
    description: (collection) => {
      if (collection === 'at.margin.annotation') return 'View annotation on margin.at';
      if (collection === 'at.margin.highlight') return 'View highlight on margin.at';
      if (collection === 'at.margin.bookmark') return 'View bookmark on margin.at';
      if (collection?.startsWith('at.margin.')) return 'View on margin.at';
      return 'View profile on margin.at';
    },
    getUrl: (handle, collection, rkey, did) => {
      if (collection && rkey && collection.startsWith('at.margin.')) {
        const recordType = collection.replace('at.margin.', '');
        const identifier = did || handle;

        if (recordType === 'annotation' || recordType === 'highlight' || recordType === 'bookmark') {
          const handleLooksLikeDomain = handle.includes('.') && !handle.startsWith('did:');
          const domain = handleLooksLikeDomain ? handle : identifier;

          return `https://margin.at/${domain}/${recordType}/${rkey}`;
        }

        return `https://margin.at/profile/${identifier}`;
      }

      const identifier = did || handle;
      return `https://margin.at/profile/${identifier}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'atmosphereApps',
    redirectCompat: ['margin'],
  },

  semble: {
    id: 'semble',
    name: 'Semble',
    description: 'View profile on semble.so',
    getUrl: (handle) => {
      return `https://semble.so/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'atmosphereApps',
    redirectCompat: ['semble'],
  },

  streamplace: {
    id: 'streamplace',
    name: 'Streamplace',
    description: 'View profile on stream.place',
    getUrl: (handle) => {
      return `https://stream.place/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'atmosphereApps',
    redirectCompat: ['streamplace'],
  },

  grain: {
    id: 'grain',
    name: 'Grain',
    description: (collection) => {
      if (collection === 'social.grain.gallery') return 'View gallery on grain.social';
      return 'View profile on grain.social';
    },
    getUrl: (handle, collection, rkey, did) => {
      const identifier = did || handle;
      if (collection === 'social.grain.gallery' && rkey) {
        return `https://grain.social/profile/${identifier}/gallery/${rkey}`;
      }
      return `https://grain.social/profile/${identifier}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'atmosphereApps',
    redirectCompat: ['grain'],
  },

  popfeed: {
    id: 'popfeed',
    name: 'Popfeed',
    description: 'View profile on popfeed.social',
    getUrl: (handle, collection, rkey, did) => {
      const identifier = did || handle;
      return `https://popfeed.social/profile/${identifier}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'atmosphereApps',
    redirectCompat: ['popfeed'],
  },

  sifa: {
    id: 'sifa',
    name: 'Sifa',
    description: 'View profile on sifa.id',
    getUrl: (handle) => {
      return `https://sifa.id/p/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'atmosphereApps',
    redirectCompat: ['sifa'],
  },

  blento: {
    id: 'blento',
    name: 'Blento',
    description: 'View profile on blento.app',
    getUrl: (handle) => {
      return `https://blento.app/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'atmosphereApps',
    redirectCompat: ['blento'],
  },

  offprint: {
    id: 'offprint',
    name: 'Offprint',
    description: 'View on offprint.app',
    getUrl: (handle, collection, rkey, did) => {
      const identifier = did || handle;
      if (collection && rkey) {
        return `https://pdsls.dev/at://${identifier}/${collection}/${rkey}`;
      }
      return `https://pdsls.dev/at://${identifier}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'publications',
    redirectCompat: ['standard-site'],
  },

  pckt: {
    id: 'pckt',
    name: 'pckt',
    description: 'View on pckt.blog',
    getUrl: (handle, collection, rkey, did) => {
      const identifier = did || handle;
      if (collection && rkey) {
        return `https://pdsls.dev/at://${identifier}/${collection}/${rkey}`;
      }
      return `https://pdsls.dev/at://${identifier}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'publications',
    redirectCompat: ['standard-site'],
  },
};

export const WAYPOINT_ORDER = [
  'anisota',
  'bluesky',
  'blacksky',
  'reddwarf',
  'leaflet',
  'pinksky',
  'margin',
  'semble',
  'streamplace',
  'grain',
  'popfeed',
  'sifa',
  'blento',
  'offprint',
  'pckt',
  'pdsls',
  'anisotaExplorer',
  'tangled',
  'atptools',
  'witchsky',
  'catsky',
  'deer',
];

export function getWaypointDataForType(type: WaypointType): WaypointData[] {
  return WAYPOINT_ORDER
    .map(id => WAYPOINT_DESTINATIONS_DATA[id])
    .filter(waypoint => waypoint.supportedTypes.includes(type));
}

export function getWaypointCountData(): number {
  return WAYPOINT_ORDER.length;
}

export const WAYPOINT_CATEGORIES_DATA: Record<string, WaypointCategoryData> = {
  blueskyClients: {
    id: 'blueskyClients',
    name: 'Bluesky Clients',
    description: 'Official and alternative Bluesky clients',
    defaultWaypointId: 'bluesky',
    subcategories: [{
      id: 'blueskyForks',
      name: 'Bluesky Forks',
      description: 'Community-built Bluesky variants',
      defaultWaypointId: 'blacksky',
    }],
  },
  blueskyForks: {
    id: 'blueskyForks',
    name: 'Bluesky Forks',
    description: 'Community-built Bluesky variants',
    defaultWaypointId: 'blacksky',
  },
  publications: {
    id: 'publications',
    name: 'Publications',
    description: 'Readers for Standard Site and Leaflet publications',
    defaultWaypointId: 'leaflet',
  },
  atmosphereApps: {
    id: 'atmosphereApps',
    name: 'Atmosphere',
    description: 'Apps built on the AT Protocol',
    defaultWaypointId: 'tangled',
  },
  devTools: {
    id: 'devTools',
    name: 'Dev Tools',
    description: 'Tools for developers and debugging',
    defaultWaypointId: 'pdsls',
  },
};

export const CATEGORY_ORDER = [
  'blueskyClients',
  'blueskyForks',
  'publications',
  'atmosphereApps',
  'devTools',
];

export function getCategorizedWaypointsData(type: WaypointType): CategorizedWaypointsData[] {
  const availableWaypoints = getWaypointDataForType(type);
  const categorized: CategorizedWaypointsData[] = [];

  for (const categoryId of CATEGORY_ORDER) {
    const category = WAYPOINT_CATEGORIES_DATA[categoryId];
    const waypoints = availableWaypoints.filter(w => w.category === categoryId);

    if (waypoints.length > 0) {
      categorized.push({ category, waypoints });
    }
  }

  return categorized;
}

type RecommendedConfig = {
  waypointIds: string[];
  label?: string;
};

const RECOMMENDED_WAYPOINTS: Record<string, RecommendedConfig> = {
  'app.bsky.feed.post': {
    waypointIds: ['bluesky', 'anisota', 'blacksky'],
    label: 'Recommended for Posts',
  },
  'profile': {
    waypointIds: ['bluesky', 'anisota'],
    label: 'Recommended for Profiles',
  },
  'app.bsky.graph.list': {
    waypointIds: ['bluesky', 'anisota'],
    label: 'Recommended for Lists',
  },
  'community.lexicon.calendar.event': {
    waypointIds: ['pdsls', 'atptools'],
    label: 'Recommended for Events',
  },
  'sh.tangled.repo': {
    waypointIds: ['tangled'],
    label: 'Recommended for Repos',
  },
  'record': {
    waypointIds: ['pdsls', 'atptools', 'anisotaExplorer'],
    label: 'Recommended for Records',
  },
};

/**
 * Recommendations keyed by collection NSID prefix. When a collection is checked,
 * we walk its dotted segments from longest to shortest looking for a registered
 * prefix (e.g. `standard.site.blog.entry` matches `standard.site`). Use this for
 * apps/lexicons that own a whole namespace and have a consistent set of compatible
 * waypoints across all of their record types.
 */
const RECOMMENDED_NAMESPACE_PREFIXES: Record<string, RecommendedConfig> = {
  'site.standard': {
    waypointIds: ['leaflet', 'offprint', 'pckt', 'anisota', 'pdsls'],
    label: 'Recommended for Standard Site',
  },
  'pub.leaflet': {
    waypointIds: ['leaflet', 'offprint', 'pckt', 'anisota', 'pdsls'],
    label: 'Recommended for Leaflet',
  },
  'sh.tangled': {
    waypointIds: ['tangled', 'pdsls', 'atptools'],
    label: 'Recommended for Tangled',
  },
  'at.margin': {
    waypointIds: ['margin', 'pdsls', 'atptools'],
    label: 'Recommended for Margin',
  },
  'social.grain': {
    waypointIds: ['grain', 'pdsls', 'atptools'],
    label: 'Recommended for Grain',
  },
};

function findNamespacePrefixMatch(collection: string): RecommendedConfig | undefined {
  const segments = collection.split('.');
  for (let i = segments.length - 1; i >= 2; i--) {
    const prefix = segments.slice(0, i).join('.');
    if (RECOMMENDED_NAMESPACE_PREFIXES[prefix]) {
      return RECOMMENDED_NAMESPACE_PREFIXES[prefix];
    }
  }
  return undefined;
}

export function getRecommendedWaypointsData(
  type: WaypointType,
  collection?: string
): { waypoints: WaypointData[]; label: string } {
  let config: RecommendedConfig | undefined;

  if (collection && RECOMMENDED_WAYPOINTS[collection]) {
    config = RECOMMENDED_WAYPOINTS[collection];
  } else if (collection) {
    config = findNamespacePrefixMatch(collection);
  }

  if (!config && RECOMMENDED_WAYPOINTS[type]) {
    config = RECOMMENDED_WAYPOINTS[type];
  }

  if (!config) {
    config = {
      waypointIds: ['bluesky'],
      label: 'Recommended',
    };
  }

  const waypoints = config.waypointIds
    .map(id => WAYPOINT_DESTINATIONS_DATA[id])
    .filter(Boolean);

  return {
    waypoints,
    label: config.label || 'Recommended',
  };
}

export function getFeaturedWaypointData(
  type: WaypointType,
  collection?: string
): WaypointData | null {
  const { waypoints } = getRecommendedWaypointsData(type, collection);
  return waypoints[0] || null;
}
