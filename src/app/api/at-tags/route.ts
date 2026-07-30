import { NextRequest, NextResponse } from 'next/server';
import { toPublicHttpUrl } from '@/utils/ssrfGuard';
import { fetchPageHtml } from '@/utils/fetchPageHtml';
import {
  parseAtTagsFromHtml,
  primaryRecordFromAtTags,
  type AtTagsResult,
} from '@/utils/atproto/atTags';

export const runtime = 'edge';

/**
 * Reads the AT Tags a web page declares about itself and returns them as
 * structured JSON. See https://tangled.org/chrisshank.com/at-tags/.
 *
 * This is the read side of the proposal: aturi.to already *emits* `at:` meta
 * tags on its record and profile pages, and this endpoint *consumes* them from
 * anywhere else. It's what lets a pasted link to some random blog resolve into
 * the atproto record that blog post actually is.
 *
 *   GET /api/at-tags?url=https://example.com/post
 *
 * Returns `{ ok: true, tags: { canonical, alternate, author, me, namespaces },
 * primary }` where `primary` is the single record the page is about (canonical
 * first, then alternate) or null. A page with no AT Tags is still `ok: true`
 * with empty arrays — "no tags" is an answer, not an error.
 *
 * Safety: the URL is SSRF-guarded to public http(s) hosts, the response must
 * be HTML, and the read is bounded by both a timeout and a byte cap — so a
 * hostile or enormous page can't tie up the worker. See `fetchPageHtml` for
 * why the scan deliberately reads past `</head>`.
 */

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
  const rawUrl = searchParams.get('url');

  if (!rawUrl) {
    return jsonError(400, 'Missing url parameter');
  }

  // Rejects non-http(s) schemes and loopback/private/link-local hosts so this
  // endpoint can't be used to probe the deployment's internal network.
  const target = toPublicHttpUrl(rawUrl);
  if (!target) {
    return jsonError(400, 'Invalid or disallowed url');
  }

  const html = await fetchPageHtml(target.toString());
  if (html === null) {
    return NextResponse.json(
      {
        ok: false,
        url: target.toString(),
        reason: 'fetch-failed',
        message: "Couldn't fetch that page as HTML (blocked, timed out, or not a web page).",
      },
      { status: 200, headers: corsAndCache(60) },
    );
  }

  const tags = parseAtTagsFromHtml(html);

  return NextResponse.json(
    {
      ok: true,
      url: target.toString(),
      primary: primaryRecordFromAtTags(tags),
      tags: serializeTags(tags),
      count: tags.tags.length,
    },
    { status: 200, headers: corsAndCache(tags.tags.length > 0 ? 300 : 60) },
  );
}

/** Drop the internal flat `tags` list; callers get the grouped shape. */
function serializeTags(result: AtTagsResult) {
  return {
    canonical: result.canonical,
    alternate: result.alternate,
    author: result.author,
    me: result.me,
    namespaces: result.namespaces,
  };
}

function corsAndCache(seconds: number) {
  return {
    ...CORS_HEADERS,
    'Cache-Control': `public, max-age=${seconds}, s-maxage=${seconds}, stale-while-revalidate=${seconds * 6}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: CORS_HEADERS });
}
