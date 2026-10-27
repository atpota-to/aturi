/**
 * Shared result shapes for the Bluesky-layer tools.
 *
 * Several tool groups return the same three things — an account, a post, a
 * feed or list — and an agent should see identical field names whichever
 * tool produced them. These builders are the one place those shapes are
 * defined, so a rename can't apply to half the catalog.
 *
 * Every card ends in a links block: the aturi.to universal link (which opens
 * in whatever client the reader prefers) plus the bsky.app URL, so an agent
 * can always hand a person something to click.
 */

import { profileLink, recordLink } from '@/lib/mcp/respond';
import type {
  AppViewPostView,
  AppViewProfile,
  FeedGeneratorView,
  ListView,
} from '@/utils/atproto/appview';

export const POST_COLLECTION = 'app.bsky.feed.post';

export function bskyAppUrl(actor: string, rkey?: string): string {
  return rkey
    ? `https://bsky.app/profile/${actor}/post/${rkey}`
    : `https://bsky.app/profile/${actor}`;
}

export function profileCard(p: AppViewProfile) {
  return {
    did: p.did,
    handle: p.handle ?? null,
    displayName: p.displayName ?? null,
    description: p.description ?? null,
    avatar: p.avatar ?? null,
    followersCount: p.followersCount ?? null,
    followsCount: p.followsCount ?? null,
    postsCount: p.postsCount ?? null,
    createdAt: p.createdAt ?? null,
    links: {
      profile: profileLink(p.handle ?? p.did),
      bsky: bskyAppUrl(p.handle ?? p.did),
    },
  };
}

export function postCard(post: AppViewPostView) {
  const rkey = post.uri.split('/').pop() ?? '';
  const actor = post.author?.handle ?? post.author?.did ?? '';
  return {
    uri: post.uri,
    cid: post.cid,
    author: {
      did: post.author?.did ?? null,
      handle: post.author?.handle ?? null,
      displayName: post.author?.displayName ?? null,
    },
    text: (post.record as { text?: string } | undefined)?.text ?? null,
    createdAt: (post.record as { createdAt?: string } | undefined)?.createdAt ?? null,
    likeCount: post.likeCount ?? 0,
    repostCount: post.repostCount ?? 0,
    replyCount: post.replyCount ?? 0,
    quoteCount: post.quoteCount ?? 0,
    indexedAt: post.indexedAt ?? null,
    links: actor
      ? { aturi: recordLink(actor, POST_COLLECTION, rkey), bsky: bskyAppUrl(actor, rkey) }
      : {},
  };
}

/** A custom feed generator. `did` is the service that computes the feed. */
export function feedCard(feed: FeedGeneratorView) {
  const rkey = feed.uri.split('/').pop() ?? '';
  const creator = feed.creator?.handle ?? feed.creator?.did ?? '';
  return {
    uri: feed.uri,
    displayName: feed.displayName ?? null,
    description: feed.description ?? null,
    likeCount: feed.likeCount ?? 0,
    serviceDid: feed.did,
    creator: feed.creator
      ? { did: feed.creator.did, handle: feed.creator.handle ?? null, displayName: feed.creator.displayName ?? null }
      : null,
    links: creator
      ? {
          aturi: recordLink(creator, 'app.bsky.feed.generator', rkey),
          bsky: `https://bsky.app/profile/${creator}/feed/${rkey}`,
        }
      : {},
  };
}

/**
 * A curation or moderation list. `purpose` is the lexicon value
 * (app.bsky.graph.defs#curatelist / #modlist), which is what tells a reader
 * whether a list is a feed source or a mute/block list.
 */
export function listCard(list: ListView) {
  const rkey = list.uri.split('/').pop() ?? '';
  const creator = list.creator?.handle ?? list.creator?.did ?? '';
  return {
    uri: list.uri,
    name: list.name ?? null,
    purpose: list.purpose ?? null,
    description: list.description ?? null,
    memberCount: list.listItemCount ?? null,
    creator: list.creator
      ? { did: list.creator.did, handle: list.creator.handle ?? null, displayName: list.creator.displayName ?? null }
      : null,
    links: creator
      ? {
          aturi: recordLink(creator, 'app.bsky.graph.list', rkey),
          bsky: `https://bsky.app/profile/${creator}/lists/${rkey}`,
        }
      : {},
  };
}
