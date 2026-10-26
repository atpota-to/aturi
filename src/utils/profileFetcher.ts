/**
 * Profile fetching utilities
 * Fetches Bluesky actor profiles
 */

export type BskyProfile = {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  banner?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  createdAt?: string;
  labels?: Array<{
    val: string;
    [key: string]: unknown;
  }>;
  verification?: {
    verifications?: Array<{
      issuer: string;
      uri: string;
      isValid: boolean;
      createdAt: string;
    }>;
    verifiedStatus?: string;
    trustedVerifierStatus?: string;
  };
  associated?: {
    lists?: number;
    feedgens?: number;
    starterPacks?: number;
    labeler?: boolean;
  };
  pinnedPost?: {
    cid: string;
    uri: string;
  };
};

import { upstreamFetch, logUpstreamHttpError } from './upstreamFetch';

/**
 * Fetches a Bluesky profile using app.bsky.actor.getProfile
 */
export async function fetchProfile(actor: string): Promise<BskyProfile | null> {
  try {
    // Use the public API for getProfile
    const url = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(
      actor
    )}`;

    const response = await upstreamFetch(url);
    if (!response.ok) {
      logUpstreamHttpError('Failed to fetch profile', response);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
}





