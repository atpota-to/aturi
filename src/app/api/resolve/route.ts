import { NextRequest, NextResponse } from 'next/server';
import {
  matchSupportedUrl,
  parseAtUri,
  SUPPORTED_HOSTS,
  type ReverseMatch,
} from '@/utils/reverseParsers';
import {
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  getRecommendedWaypointsData,
  type WaypointType,
} from '@/utils/waypoints.data';
import { resolveHandle } from '@/utils/uriParser';

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
 *  2. Head-link probing: fetch the page (capped to ~256KB and a short timeout)
 *     and look for `<link href="at://...">` in the document head. Optional;
 *     callers can suppress with `?headDetect=false`.
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
// Stop reading well before most pages finish. The head almost always lives in
// the first ~64KB; 256KB is generous overhead for sites that ship enormous
// inline JSON/JS before </head>.
const HEAD_FETCH_MAX_BYTES = 256 * 1024;

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
  let detectedVia: 'atUri' | 'urlPattern' | 'headLink' | null = null;

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

    const host = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
    isKnownHost = SUPPORTED_HOSTS.includes(host);

    match = matchSupportedUrl(parsedUrl);
    if (match) {
      detectedVia = 'urlPattern';
    } else if (!skipHead) {
      const headAtUri = await detectAtUriInHead(parsedUrl.toString());
      if (headAtUri) {
        match = parseAtUri(headAtUri);
        if (match) detectedVia = 'headLink';
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
          "Couldn't find a supported AT URI for this page (no URL pattern match and no <link href=\"at://...\"> in <head>).",
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
 * Stream-fetch the page and look for `<link href="at://...">` in the document
 * head. Bails out as soon as `</head>` is seen or we cross the byte cap, so
 * the worst case is bounded even on very large pages.
 *
 * Returns the first AT URI found, or null if none/unreadable/timeout.
 */
async function detectAtUriInHead(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEAD_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Some atmosphere apps (Leaflet, Offprint, pckt) gate on UA; identify
        // ourselves clearly and request HTML.
        'User-Agent':
          'Mozilla/5.0 (compatible; AturiResolver/1.0; +https://aturi.to)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
      },
    });
    if (!response.ok || !response.body) return null;

    const ct = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) return null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let bytesRead = 0;
    try {
      while (bytesRead < HEAD_FETCH_MAX_BYTES) {
        const { value, done } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        buffer += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(buffer)) break;
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }

    const headMatch = buffer.match(/<head[\s\S]*?<\/head>/i);
    const haystack = headMatch ? headMatch[0] : buffer;
    const linkRe = /<link\b[^>]*\bhref\s*=\s*["'](at:\/\/[^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(haystack)) !== null) {
      const href = m[1];
      if (href.startsWith('at://')) return href;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
