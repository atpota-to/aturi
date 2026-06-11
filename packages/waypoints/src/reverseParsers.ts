import type { ParsedURI } from './uriParser';

export type SourceApp =
  | 'bluesky'
  | 'bluepy'
  | 'blacksky'
  | 'reddwarf'
  | 'witchsky'
  | 'catsky'
  | 'deer'
  | 'mu'
  | 'anisota'
  | 'pinksky'
  | 'leaflet'
  | 'tangled'
  | 'margin'
  | 'pdsls'
  | 'atptools'
  | 'semble'
  | 'streamplace'
  | 'grain'
  | 'popfeed'
  | 'sifa'
  | 'blento'
  | 'offprint'
  | 'pckt'
  | 'headDetected';

export type ReverseMatch = {
  source: SourceApp;
  parsed: ParsedURI;
};

type HostConfig = {
  source: SourceApp;
  hosts: string[];
};

/**
 * Hosts that share the Bluesky-style `/profile/:handle[/(post|lists)/:rkey]` layout.
 */
const BLUESKY_FAMILY: HostConfig[] = [
  { source: 'bluesky', hosts: ['bsky.app'] },
  { source: 'blacksky', hosts: ['blacksky.community'] },
  { source: 'reddwarf', hosts: ['reddwarf.app'] },
  { source: 'witchsky', hosts: ['witchsky.app'] },
  { source: 'catsky', hosts: ['catsky.social'] },
  { source: 'deer', hosts: ['deer.social'] },
  { source: 'mu', hosts: ['mu.social'] },
  { source: 'anisota', hosts: ['anisota.net'] },
];

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

function matchBlueskyFamily(host: string, parts: string[]): ReverseMatch | null {
  const entry = BLUESKY_FAMILY.find(f => f.hosts.includes(host));
  if (!entry) return null;

  if (parts[0] !== 'profile' || !parts[1]) return null;
  const handle = parts[1];
  const did = handle.startsWith('did:') ? handle : undefined;

  if (!parts[2]) {
    return {
      source: entry.source,
      parsed: {
        type: 'profile',
        uri: `at://${handle}`,
        handle,
        did,
      },
    };
  }

  if (parts[2] === 'post' && parts[3]) {
    return {
      source: entry.source,
      parsed: {
        type: 'post',
        uri: `at://${handle}/app.bsky.feed.post/${parts[3]}`,
        handle,
        did,
        collection: 'app.bsky.feed.post',
        rkey: parts[3],
      },
    };
  }

  if ((parts[2] === 'lists' || parts[2] === 'list') && parts[3]) {
    return {
      source: entry.source,
      parsed: {
        type: 'list',
        uri: `at://${handle}/app.bsky.graph.list/${parts[3]}`,
        handle,
        did,
        collection: 'app.bsky.graph.list',
        rkey: parts[3],
      },
    };
  }

  return {
    source: entry.source,
    parsed: {
      type: 'profile',
      uri: `at://${handle}`,
      handle,
      did,
    },
  };
}

function inferType(collection: string): 'post' | 'list' | 'record' {
  if (collection === 'app.bsky.feed.post') return 'post';
  if (collection === 'app.bsky.graph.list') return 'list';
  return 'record';
}

function matchPinksky(host: string, parts: string[], search: URLSearchParams): ReverseMatch | null {
  if (host !== 'pinkleap.app') return null;

  if (parts[0] === 'feed') {
    const uri = search.get('uri');
    if (uri && uri.startsWith('at://')) {
      const stripped = uri.slice('at://'.length);
      const [handle, collection, rkey] = stripped.split('/');
      if (handle) {
        const did = handle.startsWith('did:') ? handle : undefined;
        if (collection && rkey) {
          return {
            source: 'pinksky',
            parsed: {
              type: inferType(collection),
              uri,
              handle,
              did,
              collection,
              rkey,
            },
          };
        }
        return {
          source: 'pinksky',
          parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
        };
      }
    }
  }

  if (parts[0] === 'profile' && parts[1]) {
    const handle = parts[1];
    const did = handle.startsWith('did:') ? handle : undefined;
    return {
      source: 'pinksky',
      parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
    };
  }

  return null;
}

function matchLeaflet(host: string, parts: string[]): ReverseMatch | null {
  if (host !== 'leaflet.pub') return null;
  if (parts[0] !== 'p' || !parts[1]) return null;
  const handle = parts[1];
  const did = handle.startsWith('did:') ? handle : undefined;
  return {
    source: 'leaflet',
    parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
  };
}

function matchTangled(host: string, parts: string[]): ReverseMatch | null {
  if (host !== 'tangled.org') return null;
  if (!parts[0]) return null;
  const handle = parts[0];
  const did = handle.startsWith('did:') ? handle : undefined;
  return {
    source: 'tangled',
    parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
  };
}

function matchMargin(host: string, parts: string[]): ReverseMatch | null {
  if (host !== 'margin.at') return null;

  if (parts[0] === 'profile' && parts[1]) {
    const handle = parts[1];
    const did = handle.startsWith('did:') ? handle : undefined;
    return {
      source: 'margin',
      parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
    };
  }

  if (parts[0] && parts[1] && parts[2]) {
    const recordType = parts[1];
    if (recordType === 'annotation' || recordType === 'highlight' || recordType === 'bookmark') {
      const handle = parts[0];
      const did = handle.startsWith('did:') ? handle : undefined;
      const collection = `at.margin.${recordType}`;
      const rkey = parts[2];
      return {
        source: 'margin',
        parsed: {
          type: 'record',
          uri: `at://${handle}/${collection}/${rkey}`,
          handle,
          did,
          collection,
          rkey,
        },
      };
    }
  }

  return null;
}

/**
 * Parse a path segment of the form `at://identifier[/collection/rkey]` or
 * `at:/identifier[/collection/rkey]` used by pdsls.dev and atp.tools.
 *
 * The leading `at://` or `at:/` is collapsed by the URL parser so the raw
 * `pathname` exposes it as `/at:/identifier/...`. We accept both forms.
 */
function parseAtUriPath(pathname: string): {
  handle: string;
  collection?: string;
  rkey?: string;
} | null {
  const cleaned = pathname.replace(/^\/+/, '');
  const match = cleaned.match(/^at:\/{1,2}(.+)$/);
  if (!match) return null;
  const rest = match[1];
  const segments = rest.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  return {
    handle: segments[0],
    collection: segments[1],
    rkey: segments[2],
  };
}

function matchPdsls(host: string, pathname: string): ReverseMatch | null {
  if (host !== 'pdsls.dev') return null;
  const atUri = parseAtUriPath(pathname);
  if (!atUri) return null;
  const { handle, collection, rkey } = atUri;
  const did = handle.startsWith('did:') ? handle : undefined;

  if (collection && rkey) {
    return {
      source: 'pdsls',
      parsed: {
        type: inferType(collection),
        uri: `at://${handle}/${collection}/${rkey}`,
        handle,
        did,
        collection,
        rkey,
      },
    };
  }

  return {
    source: 'pdsls',
    parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
  };
}

function matchAtpTools(host: string, pathname: string): ReverseMatch | null {
  if (host !== 'atp.tools') return null;
  const atUri = parseAtUriPath(pathname);
  if (!atUri) return null;
  const { handle, collection, rkey } = atUri;
  const did = handle.startsWith('did:') ? handle : undefined;

  if (collection && rkey) {
    return {
      source: 'atptools',
      parsed: {
        type: inferType(collection),
        uri: `at://${handle}/${collection}/${rkey}`,
        handle,
        did,
        collection,
        rkey,
      },
    };
  }

  return {
    source: 'atptools',
    parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
  };
}

function matchBluepy(host: string, pathname: string): ReverseMatch | null {
  if (host !== 'bluepy.social') return null;
  const atUri = parseAtUriPath(pathname);
  if (!atUri) return null;
  const { handle, collection, rkey } = atUri;
  const did = handle.startsWith('did:') ? handle : undefined;

  if (collection === 'app.bsky.actor.profile') {
    return {
      source: 'bluepy',
      parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
    };
  }

  if (collection && rkey) {
    return {
      source: 'bluepy',
      parsed: {
        type: inferType(collection),
        uri: `at://${handle}/${collection}/${rkey}`,
        handle,
        did,
        collection,
        rkey,
      },
    };
  }

  return {
    source: 'bluepy',
    parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
  };
}

function matchSemble(host: string, parts: string[]): ReverseMatch | null {
  if (host !== 'semble.so') return null;
  if (parts[0] !== 'profile' || !parts[1]) return null;
  const handle = parts[1];
  const did = handle.startsWith('did:') ? handle : undefined;
  return {
    source: 'semble',
    parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
  };
}

function matchStreamplace(host: string, parts: string[]): ReverseMatch | null {
  if (host !== 'stream.place') return null;
  if (!parts[0]) return null;
  const handle = parts[0];
  const did = handle.startsWith('did:') ? handle : undefined;
  return {
    source: 'streamplace',
    parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
  };
}

function matchGrain(host: string, parts: string[]): ReverseMatch | null {
  if (host !== 'grain.social') return null;
  if (parts[0] !== 'profile' || !parts[1]) return null;
  const handle = parts[1];
  const did = handle.startsWith('did:') ? handle : undefined;

  if (parts[2] === 'gallery' && parts[3]) {
    return {
      source: 'grain',
      parsed: {
        type: 'record',
        uri: `at://${handle}/social.grain.gallery/${parts[3]}`,
        handle,
        did,
        collection: 'social.grain.gallery',
        rkey: parts[3],
      },
    };
  }

  return {
    source: 'grain',
    parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
  };
}

function matchPopfeed(host: string, parts: string[]): ReverseMatch | null {
  if (host !== 'popfeed.social') return null;
  if (parts[0] !== 'profile' || !parts[1]) return null;
  const handle = parts[1];
  const did = handle.startsWith('did:') ? handle : undefined;
  return {
    source: 'popfeed',
    parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
  };
}

function matchSifa(host: string, parts: string[]): ReverseMatch | null {
  if (host !== 'sifa.id') return null;
  if (parts[0] !== 'p' || !parts[1]) return null;
  const handle = parts[1];
  const did = handle.startsWith('did:') ? handle : undefined;
  return {
    source: 'sifa',
    parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
  };
}

function matchBlento(host: string, parts: string[]): ReverseMatch | null {
  if (host !== 'blento.app') return null;
  if (!parts[0]) return null;
  const handle = parts[0];
  const did = handle.startsWith('did:') ? handle : undefined;
  return {
    source: 'blento',
    parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
  };
}

/**
 * Reverse-match any supported Aturi waypoint site URL back into a structured
 * ParsedURI (handle/collection/rkey). Returns `null` if the URL isn't on a
 * supported site or isn't a shape we recognize.
 */
export function matchSupportedUrl(url: URL): ReverseMatch | null {
  const host = normalizeHost(url.hostname);
  const parts = url.pathname.split('/').filter(Boolean);
  const search = url.searchParams;

  return (
    matchBlueskyFamily(host, parts) ||
    matchPinksky(host, parts, search) ||
    matchLeaflet(host, parts) ||
    matchTangled(host, parts) ||
    matchMargin(host, parts) ||
    matchPdsls(host, url.pathname) ||
    matchAtpTools(host, url.pathname) ||
    matchBluepy(host, url.pathname) ||
    matchSemble(host, parts) ||
    matchStreamplace(host, parts) ||
    matchGrain(host, parts) ||
    matchPopfeed(host, parts) ||
    matchSifa(host, parts) ||
    matchBlento(host, parts)
  );
}

/**
 * Parse an AT URI string (e.g. "at://did:plc:abc123/collection/rkey") into
 * its components. Used by head-based detection when an AT URI is found in
 * a <link> tag's href attribute.
 */
export function parseAtUri(uri: string): ReverseMatch | null {
  if (!uri.startsWith('at://')) return null;
  const rest = uri.slice('at://'.length);
  const segments = rest.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const handle = segments[0];
  const did = handle.startsWith('did:') ? handle : undefined;
  const collection = segments[1];
  const rkey = segments[2];

  if (collection && rkey) {
    return {
      source: 'headDetected' as SourceApp,
      parsed: {
        type: inferType(collection),
        uri,
        handle,
        did,
        collection,
        rkey,
      },
    };
  }

  return {
    source: 'headDetected' as SourceApp,
    parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
  };
}

/**
 * All host names we know how to reverse-parse. Used by the popup + background
 * worker to decide if a tab is "relevant" before doing more expensive work.
 */
export const SUPPORTED_HOSTS: string[] = [
  ...BLUESKY_FAMILY.flatMap(e => e.hosts),
  'pinkleap.app',
  'leaflet.pub',
  'tangled.org',
  'margin.at',
  'pdsls.dev',
  'atp.tools',
  'bluepy.social',
  'semble.so',
  'stream.place',
  'grain.social',
  'popfeed.social',
  'sifa.id',
  'blento.app',
];
