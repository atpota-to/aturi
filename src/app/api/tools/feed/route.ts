import { NextRequest } from 'next/server';
import { FEED_COLLECTION, FEED_PAGE_SIZE } from '@/lib/tools/feed';
import { probeFeed } from '@/lib/tools/server/feed';
import { toolError, toolJson } from '@/lib/tools/server/respond';

// Node runtime: the guard in guardedFetch resolves DNS before it dials.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The record, the DID document and the generator's two answers, each with
// its own deadline; this is the ceiling on their sum.
export const maxDuration = 30;

/**
 * The reads the feed inspector cannot make from a browser.
 *
 *   GET /api/tools/feed?feed=at://<did>/app.bsky.feed.generator/<rkey>
 *                      [&cursor=<from the last page>]
 *
 * A feed generator is a service on an arbitrary host, and most send no CORS
 * headers, so a page cannot ask one what it serves. This reads the feed's
 * record, resolves the service the record names, and asks that service for
 * its description and one page of its skeleton. What each step returned is
 * reported as found; what it means is decided by the page
 * (src/lib/tools/feed.ts).
 *
 * The input is a record address and nothing else: the host that ends up
 * being asked is the one the record and the DID document name, never one the
 * caller supplies (src/lib/tools/server/feed.ts). The account must already be
 * a DID, which the page resolves first, so no handle is looked up here.
 */

const FEED_URI = new RegExp(
  `^at://(did:plc:[a-z2-7]{24}|did:web:[A-Za-z0-9.-]+)/${FEED_COLLECTION.replace(/\./g, '\\.')}/([A-Za-z0-9._:~-]{1,512})$`,
);
const MAX_CURSOR = 2000;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const feed = searchParams.get('feed');
  if (!feed) {
    return toolError(
      400,
      'missing_parameter',
      'Missing feed parameter',
      `Pass ?feed=at://<did>/${FEED_COLLECTION}/<rkey>.`,
    );
  }
  const match = feed.match(FEED_URI);
  if (!match || match[2] === '.' || match[2] === '..') {
    return toolError(
      400,
      'invalid_parameter',
      'Not a feed generator record URI',
      `Expected at://<did>/${FEED_COLLECTION}/<rkey>, with the account given as a DID.`,
    );
  }
  const cursor = searchParams.get('cursor') ?? undefined;
  if (cursor && cursor.length > MAX_CURSOR) {
    return toolError(400, 'invalid_parameter', 'The cursor is too long');
  }

  const probe = await probeFeed({ did: match[1], rkey: match[2] }, { limit: FEED_PAGE_SIZE, cursor });
  // Short: a feed moves, and someone fixing a generator reloads to see it.
  return toolJson({ ok: true, ...probe }, 30);
}
