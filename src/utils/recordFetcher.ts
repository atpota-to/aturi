/**
 * Record Fetching Utilities
 * Fetches ATProto records and post threads from the appropriate endpoints.
 *
 * Internally delegates the PDS hop to `utils/atproto/pdsClient` so the
 * universal link pages, the explorer, and the extension all hit one shared
 * code path. The public API of this module is unchanged.
 */

import { resolvePdsEndpoint } from './didResolver';
import { getRecord as pdsGetRecord } from './atproto/pdsClient';
import { upstreamFetch, logUpstreamHttpError } from './upstreamFetch';

/**
 * Arbitrary record JSON from any lexicon. Unchecked field access is the
 * point: preview components render whatever shape the record actually has,
 * so a structural type here would just be a lie that forces casts at every
 * call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UnknownRecordValue = Record<string, any>;

export type BskyPost = {
  uri: string;
  cid: string;
  author: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
    pronouns?: string;
  };
  record: {
    $type: string;
    text: string;
    createdAt: string;
    reply?: {
      parent: {
        uri: string;
        cid: string;
      };
      root: {
        uri: string;
        cid: string;
      };
    };
    embed?: {
      $type: string;
      images?: Array<{
        alt: string;
        image: unknown;
        aspectRatio?: { width: number; height: number };
      }>;
      external?: {
        uri: string;
        title: string;
        description: string;
        thumb?: unknown;
      };
    };
    facets?: Array<{
      index: { byteStart: number; byteEnd: number };
      features: Array<{
        $type: string;
        uri?: string;
        did?: string;
        tag?: string;
      }>;
    }>;
  };
  embed?: {
    $type: string;
    images?: Array<{
      thumb: string;
      fullsize: string;
      alt: string;
      aspectRatio?: { width: number; height: number };
    }>;
    // app.bsky.embed.gallery#view (5+ images) — `items` with `thumbnail`.
    items?: Array<{
      thumbnail: string;
      fullsize: string;
      alt: string;
      aspectRatio?: { width: number; height: number };
    }>;
    external?: {
      uri: string;
      title: string;
      description: string;
      thumb?: string;
    };
    playlist?: string;
    thumbnail?: string;
    alt?: string;
    aspectRatio?: { width: number; height: number };
    cid?: string;
    record?: {
      $type: string;
      author?: {
        did: string;
        handle: string;
        displayName?: string;
        avatar?: string;
      };
      value?: UnknownRecordValue;
      record?: UnknownRecordValue;
      embeds?: UnknownRecordValue[];
      notFound?: boolean;
      blocked?: boolean;
    };
    media?: {
      $type: string;
      images?: Array<{
        thumb: string;
        fullsize: string;
        alt: string;
        aspectRatio?: { width: number; height: number };
      }>;
      // app.bsky.embed.gallery#view used as recordWithMedia media.
      items?: Array<{
        thumbnail: string;
        fullsize: string;
        alt: string;
        aspectRatio?: { width: number; height: number };
      }>;
      external?: {
        uri: string;
        title: string;
        description: string;
        thumb?: string;
      };
      playlist?: string;
      thumbnail?: string;
      alt?: string;
      aspectRatio?: { width: number; height: number };
      cid?: string;
    };
  };
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt: string;
};

export type PostThread = {
  thread: Array<{
    uri: string;
    depth: number;
    value: {
      $type: string;
      post: BskyPost;
    };
  }>;
  parent?: BskyPost;
};

export type GenericRecord = {
  uri: string;
  cid?: string;
  value: UnknownRecordValue;
};

/**
 * Fetches a generic ATProto record using com.atproto.repo.getRecord.
 *
 * Tries the user's PDS first (via DID-resolved endpoint). Falls back to the
 * public Bluesky API if PDS resolution fails so universal link pages still
 * render for repos whose DID can't be resolved (cold caches, etc).
 */
export async function fetchRecord(
  repo: string,
  collection: string,
  rkey: string
): Promise<GenericRecord | null> {
  try {
    const resolved = await resolvePdsEndpoint(repo);
    if (resolved) {
      try {
        const record = await pdsGetRecord(resolved.pdsEndpoint.replace(/\/$/, ''), {
          repo: resolved.did,
          collection,
          rkey,
        });
        return record as GenericRecord;
      } catch (err) {
        console.warn(`PDS getRecord failed for ${repo}, falling back to public API`, err);
      }
    }

    // Public-API fallback (handles get out-of-band).
    const publicUrl = `https://public.api.bsky.app/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(
      repo
    )}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;
    const response = await upstreamFetch(publicUrl);
    if (!response.ok) {
      logUpstreamHttpError('Failed to fetch record', response);
      return null;
    }
    return (await response.json()) as GenericRecord;
  } catch (error) {
    console.error('Error fetching record:', error);
    return null;
  }
}

/**
 * Fetches a Bluesky post thread using app.bsky.feed.getPostThread
 * This provides richer data for posts including author info, engagement metrics, etc.
 */
export async function fetchPostThread(postUri: string): Promise<PostThread | null> {
  try {
    // Use the public API for getPostThread with depth=1 to get parent posts
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(
      postUri
    )}&depth=0&parentHeight=1`;

    const response = await upstreamFetch(url);
    if (!response.ok) {
      logUpstreamHttpError('Failed to fetch post thread', response);
      return null;
    }

    const data = await response.json();
    
    // Transform the response to match our expected format
    // The actual API returns { thread: { post, parent, replies, ... } }
    // We want to normalize it into an array format
    if (data.thread && data.thread.post) {
      const result: PostThread = {
        thread: [
          {
            uri: data.thread.post.uri,
            depth: 0,
            value: {
              $type: 'app.bsky.feed.defs#threadViewPost',
              post: data.thread.post,
            },
          },
        ],
      };

      // Include parent post if it exists
      if (data.thread.parent && data.thread.parent.post) {
        result.parent = data.thread.parent.post;
      }

      return result;
    }

    return null;
  } catch (error) {
    console.error('Error fetching post thread:', error);
    return null;
  }
}

/**
 * Determines if a record is a Bluesky post
 */
export function isBskyPost(collection: string): boolean {
  return collection === 'app.bsky.feed.post';
}

/**
 * Determines if a record is a Bluesky list
 */
export function isBskyList(collection: string): boolean {
  return collection === 'app.bsky.graph.list';
}

/**
 * Fetches the appropriate data for a record based on its type
 */
export async function fetchRecordData(
  repo: string,
  collection: string,
  rkey: string
): Promise<{ type: 'post'; data: PostThread } | { type: 'record'; data: GenericRecord } | null> {
  // For Bluesky posts, use the richer getPostThread API
  if (isBskyPost(collection)) {
    const atUri = `at://${repo}/${collection}/${rkey}`;
    const thread = await fetchPostThread(atUri);
    if (thread) {
      return { type: 'post', data: thread };
    }
  }

  // For all other records, use the generic getRecord API
  const record = await fetchRecord(repo, collection, rkey);
  if (record) {
    return { type: 'record', data: record };
  }

  return null;
}

