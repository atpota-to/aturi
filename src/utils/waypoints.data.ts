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
  | 'blento'
  | 'atproto-explorer';

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
  /**
   * NSID prefixes that signal this waypoint is meaningfully usable for the
   * target repo. When set, the extension can call describeRepo on the target
   * DID and check whether any of the user's collections start with one of
   * these prefixes — if none do, the waypoint is flagged as "no records
   * found" in the popup and demoted in smart recommendations.
   *
   * Use trailing-dot prefixes for whole namespaces (e.g. `'sh.tangled.'`)
   * or full NSIDs for single-collection apps. Atmosphere apps typically
   * declare a reversed-domain prefix (`semble.so` → `so.semble.`) so the
   * popup can flag accounts that haven't published any of that app's
   * records. Omit the field entirely for generic explorers (PDSls,
   * atp.tools, Aturi) — those stay in the "unknown" / no-opinion state.
   */
  expectedCollections?: string[];
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
  'atproto-explorer': {
    id: 'atproto-explorer',
    name: 'Record explorers',
    description:
      'Raw AT Protocol record explorers (pdsls, atp.tools, Aturi Explore) that render any record by its AT URI.',
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
  'atproto-explorer',
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
  aturi: {
    id: 'aturi',
    name: 'Aturi',
    description: (collection) => {
      if (collection === 'app.bsky.feed.post') return 'View post on aturi.to';
      if (collection === 'app.bsky.graph.list') return 'View list on aturi.to';
      if (collection?.startsWith('site.standard.') || collection?.startsWith('pub.leaflet.')) {
        return 'View document on aturi.to';
      }
      if (collection) return 'View record on aturi.to';
      return 'View profile on aturi.to';
    },
    getUrl: (handle, collection, rkey, did) => {
      if (collection && rkey) {
        if (collection === 'app.bsky.feed.post') {
          return `https://aturi.to/profile/${handle}/post/${rkey}`;
        }
        if (collection === 'app.bsky.graph.list') {
          return `https://aturi.to/profile/${handle}/lists/${rkey}`;
        }
        // Generic AT-record viewer; prefer the DID (stable across handle changes)
        // when one is available, falling back to the handle otherwise.
        const identifier = did || handle;
        return `https://aturi.to/profile/${identifier}/${collection}/${rkey}`;
      }
      return `https://aturi.to/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'atmosphereApps',
    redirectCompat: ['bluesky-social', 'standard-site'],
  },

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
    expectedCollections: ['app.bsky.', 'net.anisota.'],
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
    expectedCollections: ['app.bsky.'],
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
    expectedCollections: ['app.bsky.'],
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
    category: 'blueskyClients',
    redirectCompat: ['bluesky-social'],
    expectedCollections: ['app.bsky.'],
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
    expectedCollections: ['pub.leaflet.', 'site.standard.'],
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
    redirectCompat: ['atproto-explorer'],
  },

  aturiExplore: {
    id: 'aturiExplore',
    name: 'Aturi Explore',
    description: (collection) => {
      if (collection) return 'Inspect record on aturi.to/explore';
      return 'Browse repo on aturi.to/explore';
    },
    getUrl: (handle, collection, rkey, did) => {
      // The explorer keys URLs by DID when available so handle changes don't
      // break shared links. Falls back to the handle when no DID was passed.
      const identifier = did || handle;
      if (collection && rkey) {
        return `https://aturi.to/explore/${identifier}/${collection}/${encodeURIComponent(rkey)}`;
      }
      if (collection) {
        return `https://aturi.to/explore/${identifier}/${collection}`;
      }
      return `https://aturi.to/explore/${identifier}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'devTools',
    redirectCompat: ['atproto-explorer'],
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
    redirectCompat: ['atproto-explorer'],
  },

  bluepy: {
    id: 'bluepy',
    name: 'Bluepy',
    description: (collection) => {
      if (collection === 'app.bsky.feed.post') return 'View post on bluepy.social';
      if (collection === 'app.bsky.graph.list') return 'View list on bluepy.social';
      if (collection) return 'View record on bluepy.social';
      return 'View profile on bluepy.social';
    },
    getUrl: (handle, collection, rkey, did) => {
      const identifier = did || handle;
      if (collection && rkey) {
        return `https://bluepy.social/at://${identifier}/${collection}/${rkey}`;
      }
      return `https://bluepy.social/at://${identifier}/app.bsky.actor.profile/self`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'blueskyClients',
    redirectCompat: ['bluesky-social'],
    expectedCollections: ['app.bsky.'],
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
    expectedCollections: ['app.bsky.'],
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
    expectedCollections: ['app.bsky.'],
  },

  mu: {
    id: 'mu',
    name: 'Mu',
    description: (collection) => {
      if (collection === 'app.bsky.feed.post') return 'View post on mu.social';
      if (collection === 'app.bsky.graph.list') return 'View list on mu.social';
      return 'View profile on mu.social';
    },
    getUrl: (handle, collection, rkey) => {
      if (collection && rkey) {
        if (collection === 'app.bsky.feed.post') {
          return `https://mu.social/profile/${handle}/post/${rkey}`;
        }
        return `https://mu.social/profile/${handle}`;
      }
      return `https://mu.social/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'blueskyForks',
    redirectCompat: ['bluesky-social'],
    expectedCollections: ['app.bsky.'],
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
    expectedCollections: ['sh.tangled.'],
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
    expectedCollections: ['app.bsky.'],
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
    expectedCollections: ['at.margin.'],
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
    expectedCollections: ['so.semble.'],
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
    expectedCollections: ['place.stream.'],
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
    expectedCollections: ['social.grain.'],
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
    expectedCollections: ['social.popfeed.'],
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
    expectedCollections: ['id.sifa.'],
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
    expectedCollections: ['app.blento.'],
  },

  anisotaReader: {
    id: 'anisotaReader',
    name: 'Anisota Reader',
    description: (collection) => {
      if (collection?.startsWith('site.standard.') || collection?.startsWith('pub.leaflet.')) {
        return 'Read document on anisota.net';
      }
      return 'View publications on anisota.net';
    },
    getUrl: (handle, collection, rkey, did) => {
      if (collection && rkey) {
        if (collection.startsWith('site.standard.') || collection.startsWith('pub.leaflet.')) {
          const identifier = did || handle;
          return `https://anisota.net/profile/${identifier}/document/${rkey}`;
        }
      }
      return `https://anisota.net/profile/${handle}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'publications',
    redirectCompat: ['standard-site'],
    expectedCollections: ['pub.leaflet.', 'site.standard.'],
  },

  offprint: {
    id: 'offprint',
    name: 'Offprint',
    description: (collection) => {
      if (collection?.startsWith('site.standard.') || collection?.startsWith('pub.leaflet.')) {
        return 'Read document on offprint.app';
      }
      return 'View on offprint.app';
    },
    getUrl: (handle, collection, rkey, did) => {
      // offprint only has record-level URLs; without a collection+rkey there's
      // no meaningful destination, so hide the waypoint in profile-only views.
      if (!collection || !rkey) return null;
      const identifier = did || handle;
      return `https://offprint.app/${identifier}/${collection}/${rkey}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'publications',
    redirectCompat: ['standard-site'],
    expectedCollections: ['pub.leaflet.', 'site.standard.'],
  },

  pckt: {
    id: 'pckt',
    name: 'pckt',
    description: (collection) => {
      if (collection?.startsWith('site.standard.') || collection?.startsWith('pub.leaflet.')) {
        return 'Read document on pckt.blog';
      }
      return 'View on pckt.blog';
    },
    getUrl: (handle, collection, rkey, did) => {
      // pckt only has record-level URLs; without a collection+rkey there's no
      // meaningful destination, so hide the waypoint in profile-only views.
      if (!collection || !rkey) return null;
      const identifier = did || handle;
      return `https://pckt.blog/${identifier}/${collection}/${rkey}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'publications',
    redirectCompat: ['standard-site'],
    expectedCollections: ['pub.leaflet.', 'site.standard.'],
  },

  standardReader: {
    id: 'standardReader',
    name: 'Standard Reader',
    description: (collection) => {
      if (collection?.startsWith('site.standard.') || collection?.startsWith('pub.leaflet.')) {
        return 'Read document on standard-reader.app';
      }
      return 'View documents on standard-reader.app';
    },
    getUrl: (handle, collection, rkey, did) => {
      const identifier = did || handle;
      if (
        collection &&
        rkey &&
        (collection.startsWith('site.standard.') || collection.startsWith('pub.leaflet.'))
      ) {
        return `https://standard-reader.app/a/${identifier}/${rkey}`;
      }
      return `https://standard-reader.app/u/${identifier}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'publications',
    redirectCompat: ['standard-site'],
    expectedCollections: ['pub.leaflet.', 'site.standard.'],
  },

  taproot: {
    id: 'taproot',
    name: 'Taproot',
    description: (collection) => {
      if (collection) return 'Inspect record on atproto.at';
      return 'Browse repo on atproto.at';
    },
    getUrl: (handle, collection, rkey, did) => {
      const identifier = did || handle;
      if (collection && rkey) {
        return `https://atproto.at/uri/at://${identifier}/${collection}/${rkey}`;
      }
      return `https://atproto.at/uri/at://${identifier}`;
    },
    supportedTypes: ['post', 'profile', 'list', 'record'],
    category: 'devTools',
    redirectCompat: [],
  },
};

export const WAYPOINT_ORDER = [
  'anisota',
  'bluesky',
  'bluepy',
  'reddwarf',
  'blacksky',
  'leaflet',
  'aturi',
  'pinksky',
  'margin',
  'semble',
  'streamplace',
  'grain',
  'popfeed',
  'sifa',
  'blento',
  'anisotaReader',
  'offprint',
  'pckt',
  'standardReader',
  'aturiExplore',
  'pdsls',
  'tangled',
  'atptools',
  'taproot',
  'witchsky',
  'mu',
  'deer',
];

/**
 * Waypoints whose `getUrl` only produces a useful destination when a DID is
 * known. Their URLs key on `did || handle`, so passing a handle yields a link
 * that looks valid but resolves to nothing. Callers filter these out when no
 * DID is available.
 */
export const DID_REQUIRED_WAYPOINTS: ReadonlySet<string> = new Set([
  'pdsls',
  'atptools',
  'margin',
  'grain',
  'popfeed',
]);

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
    defaultWaypointId: 'aturiExplore',
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

  // Categories that are declared as subcategories of another category should
  // not also appear as standalone top-level categories. Their waypoints will
  // be rendered nested under their parent by the picker.
  const subcategoryIds = new Set<string>();
  for (const category of Object.values(WAYPOINT_CATEGORIES_DATA)) {
    for (const subcat of category.subcategories ?? []) {
      subcategoryIds.add(subcat.id);
    }
  }

  for (const categoryId of CATEGORY_ORDER) {
    if (subcategoryIds.has(categoryId)) continue;

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
    waypointIds: ['aturiExplore', 'pdsls', 'atptools'],
    label: 'Recommended for Events',
  },
  'sh.tangled.repo': {
    waypointIds: ['tangled'],
    label: 'Recommended for Repos',
  },
  'record': {
    waypointIds: ['aturiExplore', 'pdsls', 'atptools', 'taproot'],
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
    waypointIds: ['leaflet', 'standardReader', 'anisotaReader', 'offprint', 'pckt', 'pdsls'],
    label: 'Recommended for Publications',
  },
  'pub.leaflet': {
    waypointIds: ['leaflet', 'anisotaReader', 'offprint', 'pckt', 'pdsls'],
    label: 'Recommended for Publications',
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

/**
 * Result of comparing a waypoint's `expectedCollections` against the set of
 * NSIDs found in the target repo.
 *
 *   - 'present'  — the user has at least one record under a matching prefix.
 *   - 'absent'   — the waypoint declared collections but none are in the repo.
 *   - 'unknown'  — the waypoint didn't declare any expectations, or we
 *                  haven't scanned the repo yet (e.g. scan disabled, no DID).
 */
export type WaypointActivity = 'present' | 'absent' | 'unknown';

/**
 * Classify a waypoint against the set of collection NSIDs known to exist on
 * the target repo. Prefix-matches each entry in `expectedCollections` against
 * `repoCollections`. Returns 'unknown' when the waypoint has no declared
 * expectations or the caller passed `null` for `repoCollections` (i.e. scan
 * disabled or still in flight).
 */
export function waypointActivity(
  waypoint: Pick<WaypointData, 'expectedCollections'>,
  repoCollections: ReadonlySet<string> | null,
): WaypointActivity {
  if (!repoCollections) return 'unknown';
  const expected = waypoint.expectedCollections;
  if (!expected || expected.length === 0) return 'unknown';
  for (const c of repoCollections) {
    for (const prefix of expected) {
      if (c === prefix || c.startsWith(prefix)) return 'present';
    }
  }
  return 'absent';
}
