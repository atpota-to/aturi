import type { ParsedURI } from './uriParser';

export type SourceApp =
  | 'aturi'
  | 'aturiExplore'
  | 'bluesky'
  | 'bluepy'
  | 'blacksky'
  | 'reddwarf'
  | 'impro'
  | 'lea'
  | 'witchsky'
  | 'deer'
  | 'northsky'
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
  | 'kimbia'
  | 'standardReader'
  | 'taproot'
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
  /**
   * When true, any subdomain of the listed hosts is treated as this source
   * too (e.g. Anisota gives each publication its own `*.anisota.net` host).
   */
  matchSubdomains?: boolean;
};

/**
 * Hosts that share the Bluesky-style `/profile/:handle[/(post|lists)/:rkey]` layout.
 */
const BLUESKY_FAMILY: HostConfig[] = [
  { source: 'bluesky', hosts: ['bsky.app'] },
  { source: 'blacksky', hosts: ['blacksky.community'] },
  { source: 'reddwarf', hosts: ['reddwarf.app'] },
  { source: 'impro', hosts: ['impro.social'] },
  { source: 'lea', hosts: ['lea.ac'] },
  { source: 'witchsky', hosts: ['witchsky.app'] },
  { source: 'deer', hosts: ['deer.social'] },
  { source: 'northsky', hosts: ['northsky.app'] },
  { source: 'mu', hosts: ['mu.social'] },
  { source: 'anisota', hosts: ['anisota.net'], matchSubdomains: true },
];

/**
 * Base hosts whose subdomains are also recognized (e.g. `*.anisota.net`).
 * Derived from the `matchSubdomains` opt-in so there's one source of truth.
 */
const SUBDOMAIN_HOSTS: string[] = BLUESKY_FAMILY.filter(f => f.matchSubdomains).flatMap(
  f => f.hosts,
);

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** True when `host` is a subdomain of `base` (a real dotted-label boundary). */
function isSubdomainOf(host: string, base: string): boolean {
  return host.endsWith(`.${base}`);
}

/** Exact host match, or a subdomain match when the config opts in. */
function hostMatchesConfig(host: string, config: HostConfig): boolean {
  if (config.hosts.includes(host)) return true;
  if (!config.matchSubdomains) return false;
  return config.hosts.some(h => isSubdomainOf(host, h));
}

function matchBlueskyFamily(host: string, parts: string[]): ReverseMatch | null {
  const entry = BLUESKY_FAMILY.find(f => hostMatchesConfig(host, f));
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

  // Anisota's reader addresses Standard Site / Leaflet documents at
  // `/profile/:handle/document/:rkey` without the collection NSID in the URL.
  // Mirror Standard Reader's convention and reconstruct the canonical
  // `site.standard.document` collection so the record still resolves.
  if (parts[2] === 'document' && parts[3]) {
    return {
      source: entry.source,
      parsed: {
        type: 'record',
        uri: `at://${handle}/site.standard.document/${parts[3]}`,
        handle,
        did,
        collection: 'site.standard.document',
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
  // Permissioned space addresses must never be handed to a public explorer;
  // see the note in matchAturi. The literal is duplicated because this file is
  // copied verbatim into @aturi.to/waypoints.
  if (segments[1] === 'space') return null;
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
 * Kimbia: `/<handle>` is an athlete's page, and `/<handle>/activity/<rkey>` /
 * `/<handle>/adventure/<rkey>` are records. The app routes a first segment as a
 * handle only when it carries a dot, which is what keeps its own pages (`/join`,
 * `/pricing`) off the handle route, so the same test guards this parser. A DID
 * never carries one, hence no `did` here.
 */
function matchKimbia(host: string, parts: string[]): ReverseMatch | null {
  if (host !== 'kimbia.app') return null;
  const handle = parts[0];
  if (!handle || !handle.includes('.')) return null;

  if ((parts[1] === 'activity' || parts[1] === 'adventure') && parts[2]) {
    const collection = `app.kimbia.${parts[1]}`;
    return {
      source: 'kimbia',
      parsed: {
        type: 'record',
        uri: `at://${handle}/${collection}/${parts[2]}`,
        handle,
        collection,
        rkey: parts[2],
      },
    };
  }

  return {
    source: 'kimbia',
    parsed: { type: 'profile', uri: `at://${handle}`, handle },
  };
}

/**
 * Standard Reader: `/u/<identifier>` is a profile (document list) and
 * `/a/<identifier>/<rkey>` is a document. The document route omits the
 * collection NSID, but every `/a/` link is a Standard Site document, so we
 * reconstruct the full `site.standard.document/<rkey>` AT URI.
 */
function matchStandardReader(host: string, parts: string[]): ReverseMatch | null {
  if (host !== 'standard-reader.app') return null;

  if (parts[0] === 'a' && parts[1] && parts[2]) {
    const handle = parts[1];
    const did = handle.startsWith('did:') ? handle : undefined;
    const rkey = parts[2];
    return {
      source: 'standardReader',
      parsed: {
        type: 'record',
        uri: `at://${handle}/site.standard.document/${rkey}`,
        handle,
        did,
        collection: 'site.standard.document',
        rkey,
      },
    };
  }

  if (parts[0] === 'u' && parts[1]) {
    const handle = parts[1];
    const did = handle.startsWith('did:') ? handle : undefined;
    return {
      source: 'standardReader',
      parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
    };
  }

  return null;
}

/**
 * Offprint (offprint.app) and pckt (pckt.blog) address publications at the
 * flat path `/<identifier>/<collection>/<rkey>` — the collection NSID sits in
 * the path verbatim, so we can round-trip it straight back. Both only expose
 * record-level URLs, so a profile-only path has no meaningful match.
 */
function matchFlatRecordHost(
  host: string,
  parts: string[],
  target: { host: string; source: SourceApp },
): ReverseMatch | null {
  if (host !== target.host) return null;
  const [handle, collection, rkey] = parts;
  if (!handle || !collection || !rkey) return null;
  // Guard against non-record pages (settings, landing, …): a real record path
  // always carries an NSID collection segment.
  if (!collection.includes('.')) return null;
  const did = handle.startsWith('did:') ? handle : undefined;
  return {
    source: target.source,
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

/**
 * Taproot (atproto.at): a generic AT-URI explorer addressed at
 * `/uri/at://<identifier>[/<collection>/<rkey>]`.
 */
function matchTaproot(host: string, pathname: string): ReverseMatch | null {
  if (host !== 'atproto.at') return null;
  const m = pathname.replace(/^\/+/, '').match(/^uri\/at:\/{1,2}(.+)$/);
  if (!m) return null;
  const segments = m[1].split('/').filter(Boolean);
  if (segments.length === 0) return null;
  // Permissioned space addresses must never be handed to a public explorer;
  // see the note in matchAturi. The literal is duplicated because this file is
  // copied verbatim into @aturi.to/waypoints.
  if (segments[1] === 'space') return null;
  const handle = segments[0];
  const collection = segments[1];
  const rkey = segments[2];
  const did = handle.startsWith('did:') ? handle : undefined;

  if (collection && rkey) {
    return {
      source: 'taproot',
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
    source: 'taproot',
    parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
  };
}

/**
 * Aturi's own pages. Two URL spaces share the aturi.to host:
 *   - `/explore/<identifier>[/<collection>[/<rkey>]]` — the raw record explorer
 *     (source id `aturiExplore`).
 *   - `/profile/<identifier>[/post/<rkey> | /lists/<rkey> | /<collection>/<rkey>]`
 *     — the universal-link view (source id `aturi`).
 *
 * Detecting these lets the popup offer jumps to other clients and explorers
 * while you're already on Aturi. Reporting the source id as the matching
 * waypoint (`aturiExplore` vs `aturi`) also keeps the page you're on out of the
 * suggestion list.
 */
function matchAturi(host: string, parts: string[]): ReverseMatch | null {
  if (host !== 'aturi.to') return null;

  // A repo identifier is always a DID (`did:…`) or a dotted handle. This rules
  // out the explorer's own sub-tools — `/explore/lexicons`, `/explore/pds` —
  // whose first segment is a bare word, not an account.
  const isIdentifier = (seg: string | undefined): boolean =>
    !!seg && (seg.startsWith('did:') || seg.includes('.'));

  // Explorer: /explore/<identifier>[/<collection>[/<rkey>]]
  if (parts[0] === 'explore' && isIdentifier(parts[1])) {
    // `/explore/<did>/space/…` addresses permissioned data. A match here would
    // be handed to the popup as a record other explorers can open, leaking the
    // address of private data to public tools, so the tab reads as
    // unrecognized instead. The marker is a local literal because this file is
    // copied verbatim into @aturi.to/waypoints, which cannot resolve
    // src/utils/atproto/*. A real NSID never equals `space` — it needs dots.
    if (parts[2] === 'space') return null;
    const handle = parts[1];
    const did = handle.startsWith('did:') ? handle : undefined;
    const collection = parts[2];
    const rkey = parts[3];
    if (collection && rkey) {
      return {
        source: 'aturiExplore',
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
    // Repo browse or a collection listing (no rkey): treat as profile-level so
    // the popup offers profile waypoints for the identifier.
    return {
      source: 'aturiExplore',
      parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
    };
  }

  // Universal-link view: /profile/<identifier>[/post|/lists|/<collection>/<rkey>]
  if (parts[0] === 'profile' && isIdentifier(parts[1])) {
    const handle = parts[1];
    const did = handle.startsWith('did:') ? handle : undefined;

    if (parts[2] === 'post' && parts[3]) {
      return {
        source: 'aturi',
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

    if (parts[2] === 'lists' && parts[3]) {
      return {
        source: 'aturi',
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

    // Generic record view: /profile/<identifier>/<collection>/<rkey>. Guard on
    // the dot so non-record profile subpages don't masquerade as records.
    if (parts[2] && parts[2].includes('.') && parts[3]) {
      return {
        source: 'aturi',
        parsed: {
          type: inferType(parts[2]),
          uri: `at://${handle}/${parts[2]}/${parts[3]}`,
          handle,
          did,
          collection: parts[2],
          rkey: parts[3],
        },
      };
    }

    return {
      source: 'aturi',
      parsed: { type: 'profile', uri: `at://${handle}`, handle, did },
    };
  }

  return null;
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
    matchAturi(host, parts) ||
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
    matchBlento(host, parts) ||
    matchKimbia(host, parts) ||
    matchStandardReader(host, parts) ||
    matchFlatRecordHost(host, parts, { host: 'offprint.app', source: 'offprint' }) ||
    matchFlatRecordHost(host, parts, { host: 'pckt.blog', source: 'pckt' }) ||
    matchTaproot(host, url.pathname)
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
  // Permissioned space addresses must never be handed to a public explorer;
  // see the note in matchAturi. The literal is duplicated because this file is
  // copied verbatim into @aturi.to/waypoints.
  if (segments[1] === 'space') return null;

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
  'aturi.to',
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
  'kimbia.app',
  'standard-reader.app',
  'offprint.app',
  'pckt.blog',
  'atproto.at',
];

/**
 * Whether a hostname belongs to a supported waypoint. Prefer this over a raw
 * `SUPPORTED_HOSTS.includes(...)` check: it strips a leading `www.` and also
 * recognizes subdomains of hosts that opt in (e.g. `eclose.anisota.net`), so
 * the extension popup and resolve API treat those tabs as known.
 */
export function isSupportedHost(host: string): boolean {
  const h = normalizeHost(host);
  if (SUPPORTED_HOSTS.includes(h)) return true;
  return SUBDOMAIN_HOSTS.some(base => isSubdomainOf(h, base));
}
