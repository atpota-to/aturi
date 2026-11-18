/**
 * The feed inspector's server-side reads (src/app/api/tools/feed).
 *
 * Given a feed generator record's address, this follows the chain the
 * AppView follows: the record names a service DID, the service's DID
 * document names an endpoint, and the endpoint is asked two things,
 * `app.bsky.feed.describeFeedGenerator` and `app.bsky.feed.getFeedSkeleton`.
 *
 * The endpoint is never taken from the caller. It is derived here from the
 * record and the DID document, both of which anyone can author, so every
 * host on the way is cleared before it is dialled: the record's PDS and a
 * did:web host by the MCP server's own resolver and guard, and the generator
 * by guardedFetch on each request. Only those two XRPC methods are called,
 * each to a byte cap, and what comes back is narrowed to the fields the
 * lexicons define rather than passed through.
 */

import { McpToolError } from '@/lib/mcp/errors';
import { resolveGuardedIdentity } from '@/lib/mcp/identityResolve';
import { getRecord } from '@/utils/atproto/pdsClient';
import { getPlcDocument } from '@/utils/atproto/plc';
import { getRecordByUri } from '@/utils/atproto/slingshot';
import {
  FEED_COLLECTION,
  feedUri,
  type FeedDescribeProbe,
  type FeedProbe,
  type FeedRecordProbe,
  type FeedServiceProbe,
  type FeedSkeletonProbe,
  type SkeletonItem,
} from '@/lib/tools/feed';
import { GuardedFetchError, guardedFetch, type GuardedResponse } from './guardedFetch';

const DID_DOCUMENT_MAX_BYTES = 256 * 1024;
/**
 * A hosted feed builder lists every feed it serves here, and the largest
 * seen while writing this answered with 830KB. Past the cap the answer is
 * reported as too long to read rather than parsed in part.
 */
const DESCRIBE_MAX_BYTES = 2 * 1024 * 1024;
const SKELETON_MAX_BYTES = 512 * 1024;
const GENERATOR_TIMEOUT_MS = 8000;

/** Longest opaque string (a cursor, a feedContext) passed back to the page. */
const MAX_OPAQUE = 2000;

const FETCH_FAILURE: Record<GuardedFetchError['kind'], string> = {
  blocked: 'the address is not a public https host',
  unresolved: 'the host has no DNS record',
  timeout: 'the host did not answer in time',
  network: 'the connection failed (refused, reset, or a certificate problem)',
  redirects: 'the address redirects too many times',
};

function failure(err: unknown): string {
  if (err instanceof GuardedFetchError) return FETCH_FAILURE[err.kind];
  if (err instanceof McpToolError) return err.message;
  return 'the request failed';
}

function hasStatus(err: unknown, status: number): boolean {
  return (err as { status?: number } | null)?.status === status;
}

/**
 * The record, the way the MCP server's get_record reads one: the Slingshot
 * cache first, then the repository's own PDS, which is what can say the
 * record is not there.
 */
async function readRecord(did: string, rkey: string): Promise<FeedRecordProbe> {
  const cached = await getRecordByUri(feedUri(did, rkey));
  if (cached) return { status: 'found', cid: cached.cid, value: cached.value };
  try {
    const identity = await resolveGuardedIdentity(did);
    const record = await getRecord(identity.pds, { repo: identity.did, collection: FEED_COLLECTION, rkey });
    return { status: 'found', cid: record.cid, value: record.value };
  } catch (err) {
    if (hasStatus(err, 400) || hasStatus(err, 404)) return { status: 'missing' };
    return {
      status: 'error',
      error: err instanceof McpToolError ? err.message : 'the repository did not answer',
    };
  }
}

type RawService = { id?: unknown; type?: unknown; serviceEndpoint?: unknown };

function readServices(doc: unknown): FeedServiceProbe['services'] {
  const list = (doc as { service?: unknown } | null)?.service;
  if (!Array.isArray(list)) return [];
  return (list as RawService[])
    .filter((entry) => typeof entry?.id === 'string')
    .slice(0, 20)
    .map((entry) => ({
      id: String(entry.id).slice(0, 200),
      type: typeof entry.type === 'string' ? entry.type.slice(0, 200) : undefined,
      serviceEndpoint: typeof entry.serviceEndpoint === 'string' ? entry.serviceEndpoint.slice(0, 500) : undefined,
    }));
}

/**
 * Resolve the service the record names. Only the two DID methods atproto
 * uses, and a did:web only on a bare hostname: atproto allows no path and no
 * port in one, and refusing them here keeps the document URL to one shape.
 */
async function readService(did: string): Promise<FeedServiceProbe> {
  const base = { did, services: [], endpoint: null };
  let doc: unknown;
  try {
    if (/^did:plc:[a-z2-7]{24}$/.test(did)) {
      doc = await getPlcDocument(did);
    } else if (/^did:web:([a-z0-9-]+\.)+[a-z0-9-]+$/i.test(did)) {
      const res = await guardedFetch(`https://${did.slice('did:web:'.length)}/.well-known/did.json`, {
        maxBytes: DID_DOCUMENT_MAX_BYTES,
        httpsOnly: true,
        accept: 'application/did+ld+json, application/json',
      });
      if (res.status !== 200) return { ...base, status: 'error', error: `its DID document answered HTTP ${res.status}` };
      if (res.truncated) return { ...base, status: 'error', error: 'its DID document is too large to read' };
      doc = JSON.parse(res.text);
    } else {
      return { ...base, status: 'unsupported' };
    }
  } catch (err) {
    return {
      ...base,
      status: 'error',
      error: err instanceof SyntaxError ? 'its DID document is not JSON' : failure(err),
    };
  }

  const services = readServices(doc);
  const entry = services.find((service) => service.id === '#bsky_fg' || service.id.endsWith('#bsky_fg'));
  const endpoint = entry?.serviceEndpoint?.replace(/\/+$/, '') ?? null;
  return { did, status: 'resolved', services, endpoint };
}

/** The error name and message of an XRPC error body, if that is what this is. */
function xrpcError(text: string): { xrpcError?: string; message?: string } {
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    return {
      xrpcError: typeof body.error === 'string' ? body.error.slice(0, 100) : undefined,
      message: typeof body.message === 'string' ? body.message.slice(0, 300) : undefined,
    };
  } catch {
    return {};
  }
}

async function ask(
  url: string,
  maxBytes: number,
): Promise<{ answer: GuardedResponse } | { error: string }> {
  try {
    const answer = await guardedFetch(url, {
      maxBytes,
      httpsOnly: true,
      accept: 'application/json',
      timeoutMs: GENERATOR_TIMEOUT_MS,
    });
    return { answer };
  } catch (err) {
    return { error: failure(err) };
  }
}

async function describe(endpoint: string, feed: string): Promise<FeedDescribeProbe> {
  const url = `${endpoint}/xrpc/app.bsky.feed.describeFeedGenerator`;
  const result = await ask(url, DESCRIBE_MAX_BYTES);
  if ('error' in result) return { url, status: 'error', error: result.error };
  const { answer } = result;
  const base = { url, status: 'answered' as const, httpStatus: answer.status };
  if (answer.status !== 200) return { ...base, ...xrpcError(answer.text) };
  if (answer.truncated) return { ...base, unreadable: true };
  try {
    const body = JSON.parse(answer.text) as { did?: unknown; feeds?: unknown };
    if (!Array.isArray(body.feeds)) return { ...base, unreadable: true };
    return {
      ...base,
      did: typeof body.did === 'string' ? body.did.slice(0, 300) : undefined,
      feedCount: body.feeds.length,
      listsFeed: body.feeds.some((entry) => (entry as { uri?: unknown } | null)?.uri === feed),
    };
  } catch {
    return { ...base, unreadable: true };
  }
}

function readItems(feed: unknown[], limit: number): SkeletonItem[] {
  const items: SkeletonItem[] = [];
  for (const entry of feed.slice(0, limit)) {
    const row = entry as { post?: unknown; reason?: unknown; feedContext?: unknown } | null;
    if (typeof row?.post !== 'string') continue;
    const reason = row.reason as { $type?: unknown; repost?: unknown } | undefined;
    items.push({
      post: row.post.slice(0, 600),
      reason:
        reason && typeof reason.$type === 'string'
          ? {
              type: reason.$type.slice(0, 200),
              repost: typeof reason.repost === 'string' ? reason.repost.slice(0, 600) : undefined,
            }
          : undefined,
      feedContext: typeof row.feedContext === 'string' ? row.feedContext.slice(0, MAX_OPAQUE) : undefined,
    });
  }
  return items;
}

async function skeleton(
  endpoint: string,
  feed: string,
  limit: number,
  cursor: string | undefined,
): Promise<FeedSkeletonProbe> {
  const params = new URLSearchParams({ feed, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const url = `${endpoint}/xrpc/app.bsky.feed.getFeedSkeleton?${params}`;
  const result = await ask(url, SKELETON_MAX_BYTES);
  if ('error' in result) return { url, status: 'error', error: result.error };
  const { answer } = result;
  const base = { url, status: 'answered' as const, httpStatus: answer.status };
  if (answer.status !== 200) return { ...base, ...xrpcError(answer.text) };
  if (answer.truncated) return { ...base, unreadable: true };
  try {
    const body = JSON.parse(answer.text) as { feed?: unknown; cursor?: unknown; reqId?: unknown };
    if (!Array.isArray(body.feed)) return { ...base, unreadable: true };
    return {
      ...base,
      items: readItems(body.feed, limit),
      // An empty cursor is how some generators say there is no next page.
      cursor: typeof body.cursor === 'string' && body.cursor ? body.cursor.slice(0, MAX_OPAQUE) : undefined,
      reqId: typeof body.reqId === 'string' ? body.reqId.slice(0, 100) : undefined,
    };
  } catch {
    return { ...base, unreadable: true };
  }
}

export async function probeFeed(
  target: { did: string; rkey: string },
  options: { limit: number; cursor?: string },
): Promise<FeedProbe> {
  const feed = feedUri(target.did, target.rkey);
  const record = await readRecord(target.did, target.rkey);
  if (record.status !== 'found' || typeof record.value.did !== 'string') return { feed, record };

  const service = await readService(record.value.did);
  if (!service.endpoint) return { feed, record, service };

  const [described, skeletal] = await Promise.all([
    describe(service.endpoint, feed),
    skeleton(service.endpoint, feed, options.limit, options.cursor),
  ]);
  return { feed, record, service, describe: described, skeleton: skeletal };
}
