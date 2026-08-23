/**
 * Core of the Atmosphere link resolver: a page URL or at:// URI in, the
 * parsed record plus every waypoint that can render it out. Shared by
 * GET /api/resolve (which owns HTTP status codes, CORS, and caching) and
 * the MCP resolve_link tool (which owns the tool-result envelope), so the
 * two surfaces cannot drift.
 *
 * Edge-safe by construction — the /api/resolve route runs on the edge
 * runtime, so nothing here may import Node-only APIs.
 *
 * Detection has two phases, in order:
 *  1. URL-pattern matching via `matchSupportedUrl` (covers bsky.app, leaflet,
 *     pdsls, atp.tools, the Bluesky-fork family, and friends).
 *  2. Page probing: fetch the page (capped to ~256KB and a short timeout) and
 *     look for the AT Tags it declares about itself
 *     (`<meta name="at:canonical">`, then `at:alternate`), falling back to a
 *     legacy `<link href="at://...">`. Optional; callers can suppress it.
 */

import type { ApiErrorCode } from '@/lib/apiError';
import {
  matchSupportedUrl,
  parseAtUri,
  isSupportedHost,
  type ReverseMatch,
} from '@/utils/reverseParsers';
import {
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  describeComposeIntent,
  getRecommendedWaypointsData,
  type ComposeIntentDescriptor,
  type WaypointType,
} from '@/utils/waypoints.data';
import { resolveHandle } from '@/utils/uriParser';
import { isBlockedFetchHost } from '@/utils/ssrfGuard';
import { parseAtTagsFromHtml, primaryRecordFromAtTags } from '@/utils/atproto/atTags';
import { fetchPageHtml } from '@/utils/fetchPageHtml';

export type ResolvedWaypointJson = {
  id: string;
  name: string;
  category: string;
  url: string;
  composeIntent: ComposeIntentDescriptor | null;
};

const DID_REQUIRED_WAYPOINTS = new Set([
  'pdsls',
  'atptools',
  'margin',
  'grain',
  'popfeed',
]);

const HEAD_FETCH_TIMEOUT_MS = 4000;

export type ResolveLinkInput = {
  url?: string | null;
  atUri?: string | null;
  composeText?: string;
  /** When false, skip the page-probing phase for unmatched URLs. */
  headDetect?: boolean;
};

export type ResolveLinkNoData = {
  ok: false;
  input: string | null;
  inputKind: 'atUri' | 'url';
  isKnownHost: boolean;
  reason: 'no-atmosphere-data';
  message: string;
};

export type ResolveLinkData = {
  ok: true;
  inputKind: 'atUri' | 'url';
  detectedVia: 'atUri' | 'urlPattern' | 'atTags' | 'headLink' | null;
  source: string;
  isKnownHost: boolean;
  parsed: {
    type: WaypointType;
    uri: string;
    handle: string;
    did: string | null;
    collection: string | null;
    rkey: string | null;
  };
  didResolved: boolean;
  recommended: { ids: string[]; label: string };
  waypoints: ResolvedWaypointJson[];
};

export type ResolveLinkResult =
  | { kind: 'invalid'; code: ApiErrorCode; message: string; hint?: string }
  | { kind: 'no-data'; body: ResolveLinkNoData }
  | { kind: 'resolved'; body: ResolveLinkData };

export async function resolveAtmosphereLink(
  input: ResolveLinkInput,
): Promise<ResolveLinkResult> {
  const rawAtUri = input.atUri ?? null;
  const rawUrl = input.url ?? null;
  const skipHead = input.headDetect === false;
  const composeText = input.composeText;

  if (!rawAtUri && !rawUrl) {
    return {
      kind: 'invalid',
      code: 'missing_parameter',
      message: 'Missing url or atUri parameter',
      hint: 'Pass ?url=<encoded-page-url> or ?atUri=at://<did>/<collection>/<rkey>.',
    };
  }

  let match: ReverseMatch | null = null;
  let isKnownHost = false;
  let inputKind: 'atUri' | 'url' = 'url';
  let detectedVia: 'atUri' | 'urlPattern' | 'atTags' | 'headLink' | null = null;

  if (rawAtUri) {
    inputKind = 'atUri';
    match = parseAtUri(rawAtUri.trim());
    if (!match) {
      return {
        kind: 'invalid',
        code: 'invalid_parameter',
        message: 'Invalid atUri',
        hint: 'Expected at://<did-or-handle>/<collection>/<rkey>.',
      };
    }
    detectedVia = 'atUri';
  } else if (rawUrl) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return {
        kind: 'invalid',
        code: 'invalid_parameter',
        message: 'Invalid url',
        hint: 'Pass a fully-qualified absolute URL, percent-encoded.',
      };
    }

    if (!/^https?:$/.test(parsedUrl.protocol)) {
      return {
        kind: 'invalid',
        code: 'invalid_parameter',
        message: 'Only http(s) URLs are supported',
        hint: 'Strip non-web schemes; use ?atUri= for at:// input.',
      };
    }

    isKnownHost = isSupportedHost(parsedUrl.hostname);

    match = matchSupportedUrl(parsedUrl);
    if (match) {
      detectedVia = 'urlPattern';
    } else if (!skipHead && !isBlockedFetchHost(parsedUrl.hostname)) {
      // Only fetch the page for head-link detection when it's a public host;
      // never let this endpoint probe loopback/private/internal addresses.
      const detected = await detectAtUriInHead(parsedUrl.toString());
      if (detected) {
        match = parseAtUri(detected.uri);
        if (match) detectedVia = detected.via;
      }
    }
  }

  if (!match) {
    return {
      kind: 'no-data',
      body: {
        ok: false,
        input: rawAtUri ?? rawUrl,
        inputKind,
        isKnownHost,
        reason: 'no-atmosphere-data',
        message:
          "Couldn't find a supported AT URI for this page (no URL pattern match, no at:canonical meta tag, and no <link href=\"at://...\"> in <head>).",
      },
    };
  }

  const { source, parsed } = match;

  // Resolve handle -> DID when we don't already have one. Required for the
  // DID-only destinations (pdsls, atptools, margin, grain, popfeed); harmless
  // for the rest.
  let did = parsed.did;
  let didResolved = false;
  if (!did) {
    try {
      const resolved = await resolveHandle(parsed.handle);
      if (resolved) {
        did = resolved;
        didResolved = true;
      }
    } catch {
      // Swallow; DID-required waypoints will simply be omitted from the result.
    }
  }

  const type: WaypointType = parsed.type === 'unknown' ? 'profile' : parsed.type;

  const waypoints = WAYPOINT_ORDER
    .map(id => WAYPOINT_DESTINATIONS_DATA[id])
    .filter((w): w is NonNullable<typeof w> => !!w)
    // Skip the page the user is already on, mirroring the extension popup.
    // For head-detected matches `source === 'headDetected'`, which won't match
    // any real waypoint id so this is a no-op there.
    .filter(w => w.id !== source)
    .filter(w => w.supportedTypes.includes(type))
    .map(w => {
      const needsDid = DID_REQUIRED_WAYPOINTS.has(w.id);
      if (needsDid && !did) return null;
      const url = w.getUrl(parsed.handle, parsed.collection, parsed.rkey, did);
      if (!url) return null;
      return {
        id: w.id,
        name: w.name,
        category: w.category,
        url,
        // Null for every client without a confirmed compose intent route, so a
        // caller can branch on it without having to know the catalog.
        composeIntent: describeComposeIntent(w, composeText),
      };
    })
    .filter((w): w is ResolvedWaypointJson => !!w);

  const recommendedRaw = getRecommendedWaypointsData(type, parsed.collection);
  const availableIds = new Set(waypoints.map(w => w.id));
  const recommendedIds = recommendedRaw.waypoints
    .map(w => w.id)
    .filter(id => id !== source && availableIds.has(id));

  return {
    kind: 'resolved',
    body: {
      ok: true,
      inputKind,
      detectedVia,
      source,
      isKnownHost,
      parsed: {
        type,
        uri: parsed.uri,
        handle: parsed.handle,
        did: did ?? null,
        collection: parsed.collection ?? null,
        rkey: parsed.rkey ?? null,
      },
      didResolved,
      recommended: { ids: recommendedIds, label: recommendedRaw.label },
      waypoints,
    },
  };
}

/**
 * Stream-fetch the page and look for an AT URI in the document head. Bails out
 * as soon as `</head>` is seen or we cross the byte cap, so the worst case is
 * bounded even on very large pages.
 *
 * Two signals, in priority order:
 *   1. AT Tags (https://tangled.org/chrisshank.com/at-tags/) — the page's own
 *      `<meta name="at:canonical">` (or `at:alternate`) declaration.
 *   2. The legacy `<link href="at://...">`, as used by Offprint, pckt, and
 *      Leaflet/standard.site pages predating the proposal.
 *
 * Returns the URI and which mechanism found it, or null if none/unreadable.
 */
async function detectAtUriInHead(
  url: string,
): Promise<{ uri: string; via: 'atTags' | 'headLink' } | null> {
  const haystack = await fetchPageHtml(url, { timeoutMs: HEAD_FETCH_TIMEOUT_MS });
  if (!haystack) return null;

  // 1. AT Tags — an explicit declaration by the page, so it wins.
  const declared = primaryRecordFromAtTags(parseAtTagsFromHtml(haystack));
  if (declared) return { uri: declared, via: 'atTags' };

  // 2. Legacy <link href="at://...">.
  const linkRe = /<link\b[^>]*\bhref\s*=\s*["'](at:\/\/[^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(haystack)) !== null) {
    const href = m[1];
    if (href.startsWith('at://')) return { uri: href, via: 'headLink' };
  }
  return null;
}
