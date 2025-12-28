/**
 * Record Fetching Utilities
 * Fetches ATProto records and post threads from the appropriate endpoints
 */

import { resolvePdsEndpoint } from './didResolver';

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
    embed?: {
      $type: string;
      images?: Array<{
        alt: string;
        image: any;
        aspectRatio?: { width: number; height: number };
      }>;
      external?: {
        uri: string;
        title: string;
        description: string;
        thumb?: any;
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
      value?: any;
      record?: any;
      embeds?: any[];
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
};

export type GenericRecord = {
  uri: string;
  cid?: string;
  value: Record<string, any>;
};

/**
 * Fetches a generic ATProto record using com.atproto.repo.getRecord
 */
export async function fetchRecord(
  repo: string,
  collection: string,
  rkey: string
): Promise<GenericRecord | null> {
  try {
    // Resolve the PDS endpoint for the repo
    const resolved = await resolvePdsEndpoint(repo);
    if (!resolved) {
      console.error(`Could not resolve PDS endpoint for ${repo}`);
      // Fallback to public API
      const publicUrl = `https://public.api.bsky.app/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(
        repo
      )}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;

      const response = await fetch(publicUrl);
      if (!response.ok) {
        console.error(`Failed to fetch record: HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();
      return data;
    }

    // Fetch from the user's PDS
    const url = `${resolved.pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(
      resolved.did
    )}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch record from PDS: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data;
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
    // Use the public API for getPostThread (which actually uses the unspecced v2 endpoint)
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(
      postUri
    )}&depth=0`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch post thread: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    // Transform the response to match our expected format
    // The actual API returns { thread: { post, replies, ... } }
    // We want to normalize it into an array format
    if (data.thread && data.thread.post) {
      return {
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

