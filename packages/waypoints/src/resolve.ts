import {
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  describeComposeIntent,
  getRecommendedWaypointsData,
  type ComposeIntentDescriptor,
  type WaypointData,
  type WaypointType,
} from './waypoints.data';
import {
  matchSupportedUrl,
  parseAtUri,
  type SourceApp,
} from './reverseParsers';
import type { ParsedURI } from './uriParser';

export type ResolvedWaypoint = {
  id: string;
  name: string;
  category: string;
  url: string;
  /**
   * Whether this client can be handed a link that opens its composer, and how
   * to build one. Null when it has no confirmed compose intent route. Supply
   * `composeText` to get the links back pre-filled.
   */
  composeIntent: ComposeIntentDescriptor | null;
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
};

/**
 * Waypoints whose `getUrl` only produces a useful destination when a DID is
 * available. These are filtered out unless a DID is known. Mirrors the hosted
 * aturi.to/api/resolve route exactly.
 */
export const DID_REQUIRED_WAYPOINTS: ReadonlySet<string> = new Set([
  'pdsls',
  'atptools',
  'margin',
  'grain',
  'popfeed',
]);

/** Stand-in DID used only to detect whether a waypoint's URL depends on one. */
const DID_PROBE = 'did:plc:probe';

/** The coordinates a waypoint URL is built from. */
export type WaypointTarget = {
  handle: string;
  collection?: string;
  rkey?: string;
};

/**
 * Whether this waypoint has to be dropped for this target because it needs a
 * DID and none is known.
 *
 * Membership in `DID_REQUIRED_WAYPOINTS` is not the whole answer: a waypoint can
 * be DID-shaped for most records and still build a perfectly good URL from a
 * handle for its own. Margin is the live case — `at.margin.*` records resolve to
 * `margin.at/<handle>/<type>/<rkey>` — so gating on the id alone hid Margin from
 * exactly the records it owns. Building the URL both ways and comparing asks the
 * question directly: if substituting a DID changes nothing, none was needed.
 *
 * Exported so `@aturi.to/waypoints-react` applies the identical rule. The two
 * packages previously disagreed about which waypoints exist for a handle-only
 * target, and only the core's answer was documented.
 */
export function requiresDid(
  waypoint: WaypointData,
  target: WaypointTarget,
  did?: string,
): boolean {
  if (did) return false;
  if (!DID_REQUIRED_WAYPOINTS.has(waypoint.id)) return false;
  const withoutDid = waypoint.getUrl(
    target.handle,
    target.collection,
    target.rkey,
    undefined,
  );
  const withDid = waypoint.getUrl(
    target.handle,
    target.collection,
    target.rkey,
    DID_PROBE,
  );
  return withoutDid !== withDid;
}

export type BuildWaypointsOptions = {
  /** DID to pass to each waypoint's getUrl. Falls back to `parsed.did`. */
  did?: string;
  /** Waypoint id to omit (e.g. the source app the user is already on). */
  excludeSourceId?: string;
  /** Text to pre-fill into each waypoint's compose intent link, if it has one. */
  composeText?: string;
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
  // `error` means the other fields describe input we failed to make sense of,
  // so building links from them yields a menu of confident-looking dead ends.
  // An empty handle is the same situation one step earlier.
  if (parsed.error || !parsed.handle) {
    return { waypoints: [], recommended: { ids: [], label: '' } };
  }

  const did = options.did ?? parsed.did;
  const exclude = options.excludeSourceId;
  const type: WaypointType = parsed.type === 'unknown' ? 'profile' : parsed.type;

  const waypoints = WAYPOINT_ORDER.map((id) => WAYPOINT_DESTINATIONS_DATA[id])
    .filter((w): w is NonNullable<typeof w> => !!w)
    .filter((w) => w.id !== exclude)
    .filter((w) => w.supportedTypes.includes(type))
    .map((w): ResolvedWaypoint | null => {
      const url = w.getUrl(parsed.handle, parsed.collection, parsed.rkey, did);
      if (!url) return null;
      if (requiresDid(w, parsed, did)) return null;
      return {
        id: w.id,
        name: w.name,
        category: w.category,
        url,
        composeIntent: describeComposeIntent(w, options.composeText),
      };
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
 *
 * Unlike {@link resolveUrl}, there is no source app to infer from an AT URI, so
 * nothing is excluded from the result by default — pass `excludeSourceId` if
 * you know where the user already is. Pass `did` when you have resolved the
 * handle yourself, to include the DID-dependent waypoints.
 *
 * @example
 * const result = resolveAtUri('at://alice.bsky.social/app.bsky.feed.post/3k7', {
 *   did: 'did:plc:abc',
 *   excludeSourceId: 'bluesky',
 * });
 * result?.waypoints.map((w) => w.url);
 */
export function resolveAtUri(
  uri: string,
  options: Pick<
    BuildWaypointsOptions,
    'composeText' | 'did' | 'excludeSourceId'
  > = {},
): ResolveResult | null {
  const match = parseAtUri(uri);
  if (!match) return null;
  const { parsed, source } = match;
  const did = options.did ?? parsed.did;
  const { waypoints, recommended } = buildWaypointsForParsed(parsed, options);
  return {
    parsed: { ...parsed, did },
    source,
    did: did ?? null,
    didResolved: false,
    waypoints,
    recommended,
  };
}

export type ResolveUrlOptions = {
  /**
   * When the URL pattern isn't recognized, fetch the page and look for a
   * `<link href="at://…">` in <head>. Off by default to keep the resolver
   * isomorphic (no network unless explicitly requested).
   *
   * SECURITY: this fetches a URL you were handed. If that URL comes from a
   * user — which is the whole point of a "paste a link" feature — you are
   * making a request on their behalf from wherever this runs. Private and
   * link-local addresses are refused by default (see `allowPrivateHosts`),
   * redirects are followed manually with the same check applied to every hop,
   * and the response body is capped. Treat those as a floor, not a substitute
   * for your own allowlist on a server route.
   */
  fetchHead?: boolean;
  /** Timeout for the optional head probe. Defaults to 4000ms. */
  fetchHeadTimeoutMs?: number;
  /**
   * Permit the head probe to reach loopback, private, link-local and
   * internal-suffix hosts. Off by default. Turning this on in a service that
   * probes user-supplied URLs re-opens the SSRF hole the default closes; it
   * exists for local development against a dev server.
   */
  allowPrivateHosts?: boolean;
  /**
   * Final say on whether a URL may be fetched, applied to the initial target
   * and to every redirect hop. Return false to refuse. Runs in addition to the
   * private-address check, so it can only narrow what is reachable.
   */
  isAllowedFetchHost?: (url: URL) => boolean;
  /**
   * Resolve a handle to a DID so DID-only waypoints (pdsls, atptools, margin,
   * grain, popfeed) are included. Pass `resolveHandle` from this package, or
   * your own implementation.
   */
  resolveHandle?: (handle: string) => Promise<string | null>;
  /** Text to pre-fill into each waypoint's compose intent link, if it has one. */
  composeText?: string;
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
      options,
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
    composeText: options.composeText,
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

export type ResolveApiInput = {
  url?: string;
  atUri?: string;
  /** Set false to skip the server-side <head> probe. */
  headDetect?: boolean;
  /** Text to pre-fill into the returned compose intent links. */
  composeText?: string;
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
  /**
   * How the endpoint found the AT URI. `atTags` means the page declared it
   * itself via `<meta name="at:canonical">` (or `at:alternate`); `headLink` is
   * the older `<link href="at://…">` the same probe falls back to.
   */
  detectedVia: 'atUri' | 'urlPattern' | 'atTags' | 'headLink' | null;
  source: SourceApp;
  isKnownHost: boolean;
  parsed: ResolveApiParsed;
  didResolved: boolean;
  recommended: ResolvedRecommendation;
  waypoints: ResolvedWaypoint[];
};

/**
 * Failure reasons `resolveViaApi` itself produces. The hosted endpoint may send
 * others, so the field stays open — this union exists to make the client-side
 * ones discoverable and spell-checkable, not to close the set.
 */
export type ResolveApiFailureReason =
  /** The endpoint answered with a non-2xx status. */
  | 'http_error'
  /** The response was not JSON (an HTML error page, a captive portal). */
  | 'invalid_response'
  /** The request never completed (offline, DNS, connection refused). */
  | 'network_error';

export type ResolveApiFailure = {
  ok: false;
  input?: string | null;
  inputKind?: 'atUri' | 'url';
  isKnownHost?: boolean;
  reason?: ResolveApiFailureReason | (string & {});
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
  if (input.composeText) params.set('composeText', input.composeText);

  const inputKind: 'atUri' | 'url' = input.atUri ? 'atUri' : 'url';
  const echo = input.atUri ?? input.url ?? null;

  let res: Response;
  try {
    res = await fetchImpl(`${endpoint}?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
  } catch (error) {
    // An abort is the caller asking to stop, so it propagates. Everything else
    // is the endpoint being unreachable, which is a result, not an exception:
    // the declared return type is a union whose whole point is this arm.
    if (options.signal?.aborted) throw error;
    return {
      ok: false,
      input: echo,
      inputKind,
      reason: 'network_error',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      input: echo,
      inputKind,
      reason: 'http_error',
      message: `HTTP ${res.status}`,
    };
  }

  try {
    return (await res.json()) as ResolveApiResponse;
  } catch (error) {
    // A 200 carrying HTML — a captive portal, a proxy error page — used to
    // throw a raw SyntaxError straight through the union.
    return {
      ok: false,
      input: echo,
      inputKind,
      reason: 'invalid_response',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Hostnames the head probe refuses by default. This is a string/regex check on
 * the literal hostname, not a DNS resolution — a name that resolves to a
 * private address still gets through, which is why a server handling untrusted
 * URLs wants `isAllowedFetchHost` on top of this. What it does buy is that the
 * obvious targets (loopback, RFC1918, the cloud metadata endpoint, and the
 * `.internal`/`.local` suffixes) cost an attacker nothing to try and are
 * blocked without a request being made.
 *
 * Written from scratch rather than shared with the app's `src/utils/ssrfGuard`
 * — that file is GPL-3.0 and this package is MIT.
 */
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/,
  /\.localhost$/,
  /\.local$/,
  /\.internal$/,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

/**
 * True when the hostname is safe to fetch by default. IPv6 arrives from
 * `URL.hostname` wrapped in brackets, so it is unwrapped before the loopback,
 * unique-local (fc00::/7) and link-local (fe80::/10) checks.
 */
export function isPublicFetchHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;

  if (host.startsWith('[') && host.endsWith(']')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::1' || v6 === '::') return false;
    return !/^f[cd]/.test(v6) && !/^fe[89ab]/.test(v6);
  }

  return !PRIVATE_HOST_PATTERNS.some((re) => re.test(host));
}

/** Applies both the default address check and any caller-supplied predicate. */
function mayFetch(target: URL, options: ResolveUrlOptions): boolean {
  if (!options.allowPrivateHosts && !isPublicFetchHost(target.hostname)) {
    return false;
  }
  if (options.isAllowedFetchHost && !options.isAllowedFetchHost(target)) {
    return false;
  }
  return true;
}

/** Hops followed manually so the host guard can be re-applied to each one. */
const MAX_REDIRECTS = 3;

/**
 * Largest response the probe will read. Metadata can legitimately land deep in
 * a streamed document, so this is well past the head of any real page, while
 * still bounding what a hostile server can make the caller allocate.
 */
const MAX_HTML_BYTES = 1024 * 1024;

/**
 * Read at most `MAX_HTML_BYTES` of the response, then stop pulling and let go
 * of the stream. `response.text()` would buffer whatever the server chose to
 * send — a 611 KB gzip response was measured inflating to 1.24 GB — so the
 * stream path is the one that matters; the `text()` fallback is only for
 * environments that expose no body.
 */
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    return (await response.text()).slice(0, MAX_HTML_BYTES);
  }

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let out = '';
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      read += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (read >= MAX_HTML_BYTES) break;
    }
    out += decoder.decode();
  } finally {
    // Tell the server we are done; without this the connection stays open
    // for the remainder of a body we have already decided not to read.
    try {
      await reader.cancel();
    } catch {
      // Already closed or errored; nothing left to release.
    }
  }
  return out.slice(0, MAX_HTML_BYTES);
}

/**
 * Locate the document head by scanning rather than matching. The obvious
 * regex, `/<head[\s\S]*?<\/head>/i`, is quadratic: every `<head` in the input
 * is a fresh start position from which the lazy body scans to end of input, so
 * a page of repeated unclosed `<head` openers blocked the event loop for ~9.8
 * seconds at 300 KB. indexOf is linear and cannot backtrack.
 */
function headSlice(html: string): string {
  const lower = html.toLowerCase();
  const start = lower.indexOf('<head');
  if (start === -1) return html;
  const end = lower.indexOf('</head>', start);
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

/**
 * Bounded so it cannot backtrack: the attribute run is capped and excludes
 * `<`/`>` (so a match cannot span a tag boundary), and the captured URI
 * excludes quotes and whitespace. The unbounded original took 5.4s on crafted
 * input that this scans in single-digit milliseconds.
 */
const AT_URI_LINK_RE =
  /<link\b[^<>]{0,1000}?\bhref\s*=\s*["'](at:\/\/[^"'\s<>]{1,512})["']/gi;

/**
 * Best-effort <head> probe for a `<link href="at://…">`. Follows redirects
 * manually so every hop is re-checked against the caller's fetch policy, reads
 * a bounded prefix of the body, and returns the first AT URI found. Returns
 * null on any error, refused host, non-HTML content, or timeout.
 */
async function detectAtUriInHead(
  url: string,
  timeoutMs: number,
  options: ResolveUrlOptions,
): Promise<string | null> {
  if (typeof fetch === 'undefined') return null;
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    let current: URL;
    try {
      current = new URL(url);
    } catch {
      return null;
    }

    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!/^https?:$/.test(current.protocol)) return null;
      if (!mayFetch(current, options)) return null;

      const hopResponse = await fetch(current.toString(), {
        signal: controller?.signal,
        redirect: 'manual',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; AturiResolver/1.0; +https://aturi.to)',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
        },
      });

      const location =
        hopResponse.status >= 300 && hopResponse.status < 400
          ? hopResponse.headers.get('location')
          : null;
      if (!location) {
        response = hopResponse;
        break;
      }
      try {
        current = new URL(location, current);
      } catch {
        return null;
      }
    }

    if (!response || !response.ok) return null;

    const ct = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) return null;

    const html = await readCapped(response);
    const haystack = headSlice(html);
    AT_URI_LINK_RE.lastIndex = 0;
    const match = AT_URI_LINK_RE.exec(haystack);
    return match ? match[1] : null;
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
