import {
  DID_REQUIRED_WAYPOINTS,
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  getRecommendedWaypointsData,
  type WaypointType,
} from './waypoints.data';
import {
  matchSupportedUrl,
  parseAtUri,
  type SourceApp,
} from './reverseParsers';
import type { ParsedURI } from './uriParser';
import {
  fetchPreferredClients,
  orderIdsByPreference,
  preferredWaypointFor,
  type FetchPreferredClientsOptions,
  type PreferredClientMatch,
  type PreferredClientsRecord,
} from './preferredClients';

export type ResolvedWaypoint = {
  id: string;
  name: string;
  category: string;
  url: string;
};

export type ResolvedRecommendation = {
  ids: string[];
  label: string;
};

export type ResolveResult = {
  parsed: ParsedURI;
  source: SourceApp;
  did: string | null;
  didResolved: boolean;
  waypoints: ResolvedWaypoint[];
  recommended: ResolvedRecommendation;
  /**
   * The destination an account has publicly declared it prefers for this
   * record, when one was applied. Only set by the actor-aware resolvers —
   * see `applyPreferredClients` and `resolveAtUriForActor`.
   */
  preferred?: PreferredClientMatch | null;
};

// `DID_REQUIRED_WAYPOINTS` moved to the catalog module (it's a property of the
// catalog, and three copies had to be kept in step). Re-exported through the
// package root either way, so importers see no change.

export type BuildWaypointsOptions = {
  /** DID to pass to each waypoint's getUrl. Falls back to `parsed.did`. */
  did?: string;
  /** Waypoint id to omit (e.g. the source app the user is already on). */
  excludeSourceId?: string;
};

/**
 * Turn a parsed AT URI into the list of waypoints that can render it plus the
 * recommended set, applying the DID-required filter and dropping waypoints
 * whose getUrl returns null. This is the framework-agnostic core of the
 * hosted resolve endpoint.
 */
export function buildWaypointsForParsed(
  parsed: ParsedURI,
  options: BuildWaypointsOptions = {},
): { waypoints: ResolvedWaypoint[]; recommended: ResolvedRecommendation } {
  const did = options.did ?? parsed.did;
  const exclude = options.excludeSourceId;
  const type: WaypointType = parsed.type === 'unknown' ? 'profile' : parsed.type;

  const waypoints = WAYPOINT_ORDER.map((id) => WAYPOINT_DESTINATIONS_DATA[id])
    .filter((w): w is NonNullable<typeof w> => !!w)
    .filter((w) => w.id !== exclude)
    .filter((w) => w.supportedTypes.includes(type))
    .map((w): ResolvedWaypoint | null => {
      if (DID_REQUIRED_WAYPOINTS.has(w.id) && !did) return null;
      const url = w.getUrl(parsed.handle, parsed.collection, parsed.rkey, did);
      if (!url) return null;
      return { id: w.id, name: w.name, category: w.category, url };
    })
    .filter((w): w is ResolvedWaypoint => !!w);

  const recommendedRaw = getRecommendedWaypointsData(type, parsed.collection);
  const availableIds = new Set(waypoints.map((w) => w.id));
  const ids = recommendedRaw.waypoints
    .map((w) => w.id)
    .filter((id) => id !== exclude && availableIds.has(id));

  return { waypoints, recommended: { ids, label: recommendedRaw.label } };
}

/**
 * Resolve an AT URI string (e.g. "at://did:plc:abc/app.bsky.feed.post/rkey")
 * directly into its waypoints. Returns null if the string isn't a valid AT URI.
 */
export function resolveAtUri(uri: string): ResolveResult | null {
  const match = parseAtUri(uri);
  if (!match) return null;
  const { parsed, source } = match;
  const { waypoints, recommended } = buildWaypointsForParsed(parsed);
  return {
    parsed,
    source,
    did: parsed.did ?? null,
    didResolved: false,
    waypoints,
    recommended,
  };
}

/**
 * Apply an account's published `to.aturi.actor.preferredClients` record to a
 * resolve result: lift the clients they declared for this record type to the
 * front of `recommended.ids`, and attach the winning destination as
 * `preferred`.
 *
 * Pure — pass a record you already have. `resolveAtUriForActor` does the fetch
 * for you.
 */
export function applyPreferredClients(
  result: ResolveResult,
  record: PreferredClientsRecord | null | undefined,
): ResolveResult {
  if (!record) return { ...result, preferred: null };
  const { parsed } = result;
  const type: WaypointType = parsed.type === 'unknown' ? 'profile' : parsed.type;
  const query = { collection: parsed.collection, type };
  const preferred = preferredWaypointFor(record, {
    type,
    handle: parsed.handle,
    did: result.did ?? undefined,
    collection: parsed.collection,
    rkey: parsed.rkey,
  });
  return {
    ...result,
    preferred,
    recommended: {
      ...result.recommended,
      ids: orderIdsByPreference(result.recommended.ids, record, query),
    },
  };
}

export type ResolveForActorOptions = FetchPreferredClientsOptions & {
  /**
   * Skip the network read by passing a record you already hold (from a cache,
   * or from the account's own session).
   */
  preferredClients?: PreferredClientsRecord | null;
};

/**
 * Resolve an AT URI *for a particular reader*: same as `resolveAtUri`, then the
 * reader's own published client preferences applied on top.
 *
 * `actor` is whoever is about to click the link — a handle or DID. If they've
 * published nothing, this degrades exactly to `resolveAtUri`.
 */
export async function resolveAtUriForActor(
  uri: string,
  actor: string,
  options: ResolveForActorOptions = {},
): Promise<ResolveResult | null> {
  const base = resolveAtUri(uri);
  if (!base) return null;
  const record =
    options.preferredClients !== undefined
      ? options.preferredClients
      : await fetchPreferredClients(actor, options);
  return applyPreferredClients(base, record);
}

export type ResolveUrlOptions = {
  /**
   * When the URL pattern isn't recognized, fetch the page and look for a
   * `<link href="at://…">` in <head>. Off by default to keep the resolver
   * isomorphic (no network unless explicitly requested).
   */
  fetchHead?: boolean;
  /** Timeout for the optional head probe. Defaults to 4000ms. */
  fetchHeadTimeoutMs?: number;
  /**
   * Resolve a handle to a DID so DID-only waypoints (pdsls, atptools, margin,
   * grain, popfeed) are included. Pass `resolveHandle` from this package, or
   * your own implementation.
   */
  resolveHandle?: (handle: string) => Promise<string | null>;
};

/**
 * Resolve a pasted/shared page URL back into the AT URI it represents and the
 * waypoints that can render it. Uses local URL-pattern matching by default;
 * optionally falls back to a `<head>` link probe and/or handle→DID resolution.
 *
 * The source app's own waypoint is omitted from the result (you're already
 * there), mirroring the extension popup and hosted endpoint.
 */
export async function resolveUrl(
  url: string | URL,
  options: ResolveUrlOptions = {},
): Promise<ResolveResult | null> {
  let target: URL;
  try {
    target = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return null;
  }
  if (!/^https?:$/.test(target.protocol)) return null;

  let match = matchSupportedUrl(target);
  if (!match && options.fetchHead) {
    const headUri = await detectAtUriInHead(
      target.toString(),
      options.fetchHeadTimeoutMs ?? 4000,
    );
    if (headUri) match = parseAtUri(headUri);
  }
  if (!match) return null;

  const { parsed, source } = match;
  let did = parsed.did;
  let didResolved = false;
  if (!did && options.resolveHandle) {
    try {
      const resolved = await options.resolveHandle(parsed.handle);
      if (resolved) {
        did = resolved;
        didResolved = true;
      }
    } catch {
      // Swallow; DID-required waypoints will simply be omitted from the result.
    }
  }

  const { waypoints, recommended } = buildWaypointsForParsed(parsed, {
    did,
    excludeSourceId: source,
  });
  return {
    parsed: { ...parsed, did },
    source,
    did: did ?? null,
    didResolved,
    waypoints,
    recommended,
  };
}

/**
 * `resolveUrl` with a reader's published client preferences applied. See
 * `resolveAtUriForActor`.
 */
export async function resolveUrlForActor(
  url: string | URL,
  actor: string,
  options: ResolveUrlOptions & ResolveForActorOptions = {},
): Promise<ResolveResult | null> {
  const [base, record] = await Promise.all([
    resolveUrl(url, options),
    options.preferredClients !== undefined
      ? Promise.resolve(options.preferredClients)
      : fetchPreferredClients(actor, options),
  ]);
  if (!base) return null;
  return applyPreferredClients(base, record);
}

export type ResolveApiInput = {
  url?: string;
  atUri?: string;
  /** Set false to skip the server-side <head> probe. */
  headDetect?: boolean;
  /**
   * Handle or DID of the reader. When set, the endpoint reads that account's
   * published `to.aturi.actor.preferredClients` record and applies it, so you
   * get their preferred destination back without fetching it yourself.
   */
  actor?: string;
};

export type ResolveApiParsed = {
  type: WaypointType;
  uri: string;
  handle: string;
  did: string | null;
  collection: string | null;
  rkey: string | null;
};

export type ResolveApiSuccess = {
  ok: true;
  inputKind: 'atUri' | 'url';
  detectedVia: 'atUri' | 'urlPattern' | 'headLink' | null;
  source: SourceApp;
  isKnownHost: boolean;
  parsed: ResolveApiParsed;
  didResolved: boolean;
  recommended: ResolvedRecommendation;
  waypoints: ResolvedWaypoint[];
  /**
   * Present when `actor` was supplied: the destination that account declared
   * it prefers for this record, or null if it has declared nothing applicable.
   */
  preferred?: PreferredClientMatch | null;
};

export type ResolveApiFailure = {
  ok: false;
  input?: string | null;
  inputKind?: 'atUri' | 'url';
  isKnownHost?: boolean;
  reason?: string;
  message?: string;
  error?: string;
};

export type ResolveApiResponse = ResolveApiSuccess | ResolveApiFailure;

export type ResolveViaApiOptions = {
  /** Defaults to the hosted endpoint, https://aturi.to/api/resolve. */
  endpoint?: string;
  /** Custom fetch implementation (e.g. a polyfill or instrumented client). */
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

/**
 * Typed client for the hosted resolve endpoint. Use this when you want the
 * server to do the work — notably the <head> link probe, which needs to fetch
 * the target page (something you may not want to do from the browser for CORS
 * reasons). Returns the same response shape the route emits.
 */
export async function resolveViaApi(
  input: ResolveApiInput,
  options: ResolveViaApiOptions = {},
): Promise<ResolveApiResponse> {
  const endpoint = options.endpoint ?? 'https://aturi.to/api/resolve';
  const fetchImpl = options.fetch ?? fetch;
  const params = new URLSearchParams();
  if (input.atUri) {
    params.set('atUri', input.atUri);
  } else if (input.url) {
    params.set('url', input.url);
  } else {
    throw new Error('resolveViaApi requires either `url` or `atUri`');
  }
  if (input.headDetect === false) params.set('headDetect', 'false');
  if (input.actor) params.set('actor', input.actor);

  const res = await fetchImpl(`${endpoint}?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options.signal,
  });
  return (await res.json()) as ResolveApiResponse;
}

/**
 * Best-effort <head> probe for a `<link href="at://…">`. Reads the response as
 * text, scans the document head, and returns the first AT URI found. Returns
 * null on any error, non-HTML content, or timeout.
 */
async function detectAtUriInHead(
  url: string,
  timeoutMs: number,
): Promise<string | null> {
  if (typeof fetch === 'undefined') return null;
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    const response = await fetch(url, {
      signal: controller?.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; AturiResolver/1.0; +https://aturi.to)',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
      },
    });
    if (!response.ok) return null;

    const ct = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) return null;

    const html = await response.text();
    const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
    const haystack = headMatch ? headMatch[0] : html.slice(0, 256 * 1024);
    const linkRe =
      /<link\b[^>]*\bhref\s*=\s*["'](at:\/\/[^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(haystack)) !== null) {
      if (m[1].startsWith('at://')) return m[1];
    }
    return null;
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
