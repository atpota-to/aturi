/**
 * Bluesky AppView (`public.api.bsky.app`) client for the explorer's
 * engagement overlay (likes / reposts / replies / follower counts).
 */

import { APPVIEW } from './config';

export type AppViewPostThread = {
  thread?: {
    post?: {
      uri: string;
      cid: string;
      author?: {
        did: string;
        handle?: string;
        displayName?: string;
        avatar?: string;
      };
      replyCount?: number;
      repostCount?: number;
      likeCount?: number;
      quoteCount?: number;
      indexedAt?: string;
      record?: Record<string, unknown>;
    };
  };
};

export type AppViewProfile = {
  did: string;
  handle?: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  banner?: string;
  pronouns?: string;
  followsCount?: number;
  followersCount?: number;
  postsCount?: number;
  createdAt?: string;
};

async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getProfile(actor: string): Promise<AppViewProfile | null> {
  if (!actor) return null;
  return fetchJsonOrNull<AppViewProfile>(
    `${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`,
  );
}

export async function getPostThread(
  uri: string,
  opts: { depth?: number; parentHeight?: number } = {},
): Promise<AppViewPostThread | null> {
  if (!uri) return null;
  const { depth = 0, parentHeight = 0 } = opts;
  const params = new URLSearchParams({
    uri,
    depth: String(depth),
    parentHeight: String(parentHeight),
  });
  return fetchJsonOrNull<AppViewPostThread>(
    `${APPVIEW}/xrpc/app.bsky.feed.getPostThread?${params}`,
  );
}
