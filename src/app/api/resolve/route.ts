import { NextRequest, NextResponse } from 'next/server';
import {
  matchSupportedUrl,
  parseAtUri,
  isSupportedHost,
  type ReverseMatch,
} from '@/utils/reverseParsers';
import {
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  getRecommendedWaypointsData,
  type WaypointType,
} from '@/utils/waypoints.data';
import { resolveHandle } from '@/utils/uriParser';
import { isBlockedFetchHost } from '@/utils/ssrfGuard';
import { parseAtTagsFromHtml, primaryRecordFromAtTags } from '@/utils/atproto/atTags';
import { fetchPageHtml } from '@/utils/fetchPageHtml';

export const runtime = 'edge';

/**
 * Resolves a page URL (from a share sheet, an Apple Shortcut, etc.) into the
 * AT URI it represents and the list of Aturi waypoints that can render it.
 *
 * Mirrors the in-popup logic of the browser extension so that a single call
 * gives a client (Shortcut, bookmarklet, third-party app) everything it needs
 * to present a "open in..." picker without re-implementing the catalog.
 *
 * Detection has two phases, in order:
 *  1. URL-pattern matching via `matchSupportedUrl` (covers bsky.app, leaflet,
 *     pdsls, atp.tools, the Bluesky-fork family, and friends).
 *  2. Page probing: fetch the page (capped to ~256KB and a short timeout) and
 *     look for the AT Tags it declares about itself
 *     (`<meta name="at:canonical">`, then `at:alternate`), falling back to a
 *     legacy `<link href="at://...">`. Optional; callers can suppress with
 *     `?headDetect=false`.
 *
 * Inputs:
 *  - `url=<encoded-page-url>` (preferred from share sheets)
 *  - `atUri=at://...`         (skips detection entirely)
 *
 * Either is accepted; `atUri` wins when both are supplied.
 */

const DID_REQUIRED_WAYPOINTS = new Set([
  'pdsls',
  'atptools',
  'margin',
  'grain',
  'popfeed',
]);

const HEAD_FETCH_TIMEOUT_MS = 4000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawAtUri = searchParams.get('atUri') || searchParams.get('aturi');
  const rawUrl = searchParams.get('url');
  const skipHead = searchParams.get('headDetect') === 'false';

  if (!rawAtUri && !rawUrl) {
    return jsonError(400, 'Missing url or atUri parameter');
  }

  let match: ReverseMatch | null = null;
  let isKnownHost = false;
  let inputKind: 'atUri' | 'url' = 'url';
  let detectedVia: 'atUri' | 'urlPattern' | 'atTags' | 'headLink' | null = null;

  if (rawAtUri) {
    inputKind = 'atUri';
    match = parseAtUri(rawAtUri.trim());
    if (!match) return jsonError(400, 'Invalid atUri');
    detectedVia = 'atUri';
  } else if (rawUrl) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return jsonError(400, 'Invalid url');
    }

    if (!/^https?:$/.test(parsedUrl.protocol)) {
      return jsonError(400, 'Only http(s) URLs are supported');
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
    return NextResponse.json(
      {
        ok: false,
        input: rawAtUri ?? rawUrl,
        inputKind,
        isKnownHost,
        reason: 'no-atmosphere-data',
        message:
          "Couldn't find a supported AT URI for this page (no URL pattern match, no at:canonical meta tag, and no <link href=\"at://...\"> in <head>).",
      },
      { status: 200, headers: corsAndCache(60) }
    );
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
      };
    })
    .filter((w): w is { id: string; name: string; category: string; url: string } => !!w);

  const recommendedRaw = getRecommendedWaypointsData(type, parsed.collection);
  const availableIds = new Set(waypoints.map(w => w.id));
  const recommendedIds = recommendedRaw.waypoints
    .map(w => w.id)
    .filter(id => id !== source && availableIds.has(id));

  return NextResponse.json(
    {
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
    { status: 200, headers: corsAndCache(300) }
  );
}

function corsAndCache(seconds: number) {
  return {
    ...CORS_HEADERS,
    'Cache-Control': `public, max-age=${seconds}, s-maxage=${seconds}, stale-while-revalidate=${seconds * 6}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function jsonError(status: number, message: string) {
  return NextResponse.json(
    { ok: false, error: message },
    { status, headers: CORS_HEADERS }
  );
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
