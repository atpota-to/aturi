/**
 * Bluesky app-layer tools over the keyless public AppView. These answer the
 * social-layer questions (profiles, threads, search); the repo/graph tools
 * answer the protocol-layer ones.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  getAuthorFeed,
  getPostEngagement,
  getPostThread,
  getProfiles,
  getSocialGraph,
  getTrends,
  searchActors,
  searchPosts,
  type AppViewPostView,
  type AppViewProfile,
  type AppViewThreadNode,
} from '@/utils/atproto/appview';
import { resolveHandle } from '@/utils/atproto/identity';
import { matchSupportedUrl } from '@/utils/reverseParsers';
import { parseAtUri, toAtUri } from '@/utils/atproto/urls';
import { McpToolError } from '@/lib/mcp/errors';
import { toolHandler, profileLink, recordLink, READ_ONLY } from '@/lib/mcp/respond';

const POST_COLLECTION = 'app.bsky.feed.post';
/** Total posts a simplified thread may carry, ancestors included. */
const MAX_THREAD_POSTS = 80;

function bskyAppUrl(actor: string, rkey?: string): string {
  return rkey
    ? `https://bsky.app/profile/${actor}/post/${rkey}`
    : `https://bsky.app/profile/${actor}`;
}

function profileCard(p: AppViewProfile) {
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

function postCard(post: AppViewPostView) {
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

/**
 * Accept a post address in any of the shapes agents actually hold: an at://
 * URI, or a URL from bsky.app and the other Bluesky-family clients the
 * reverse parsers know. Returns a DID-based at:// URI.
 */
async function normalizePostUri(input: string): Promise<string> {
  const trimmed = input.trim();
  let repo: string;
  let rkey: string;

  if (trimmed.startsWith('at://')) {
    const parsed = parseAtUri(trimmed);
    if (!parsed?.collection || !parsed.rkey || parsed.space) {
      throw new McpToolError(
        'invalid_parameter',
        `"${trimmed}" is not a full record URI`,
        'Expected at://<did-or-handle>/app.bsky.feed.post/<rkey>.',
      );
    }
    if (parsed.collection !== POST_COLLECTION) {
      throw new McpToolError(
        'invalid_parameter',
        `get_thread reads ${POST_COLLECTION} records; "${parsed.collection}" is not one`,
        'Use get_record for other lexicons.',
      );
    }
    repo = parsed.repo;
    rkey = parsed.rkey;
  } else if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new McpToolError('invalid_parameter', 'The uri parameter is not a valid URL');
    }
    const match = matchSupportedUrl(url);
    if (!match || match.parsed.type !== 'post' || !match.parsed.rkey) {
      throw new McpToolError(
        'invalid_parameter',
        'This URL does not map to a Bluesky post',
        'Pass a post URL from a Bluesky-family client, or the at:// URI. resolve_link handles every other page shape.',
      );
    }
    repo = match.parsed.did ?? match.parsed.handle;
    rkey = match.parsed.rkey;
  } else {
    throw new McpToolError(
      'invalid_parameter',
      'Pass an at:// URI or a post URL',
      'Expected at://<repo>/app.bsky.feed.post/<rkey> or https://bsky.app/profile/<actor>/post/<rkey>.',
    );
  }

  if (!repo.startsWith('did:')) {
    const did = await resolveHandle(repo);
    if (!did) throw new McpToolError('not_found', `Could not resolve the handle "${repo}"`);
    repo = did;
  }
  return toAtUri({ did: repo, collection: POST_COLLECTION, rkey });
}

type UnavailablePost = { unavailable: true; reason: string };
type SimplifiedPost = ReturnType<typeof postCard> & {
  replies?: Array<SimplifiedPost | UnavailablePost>;
};

/**
 * Walk the AppView thread tree depth-first under a shared post budget so a
 * viral thread can't produce an unbounded payload. Blocked and not-found
 * nodes become explicit placeholders instead of disappearing.
 */
function simplifyThread(
  node: AppViewThreadNode | undefined,
  budget: { remaining: number; truncated: boolean },
): SimplifiedPost | UnavailablePost | null {
  if (!node) return null;
  if (!node.post) {
    const reason = node.$type?.includes('blocked')
      ? 'blocked'
      : node.$type?.includes('notFound')
        ? 'not found'
        : 'unavailable';
    return { unavailable: true, reason };
  }
  if (budget.remaining <= 0) {
    budget.truncated = true;
    return null;
  }
  budget.remaining -= 1;

  const simplified: SimplifiedPost = postCard(node.post as AppViewPostView);
  const replies: Array<SimplifiedPost | UnavailablePost> = [];
  for (const reply of node.replies ?? []) {
    const child = simplifyThread(reply, budget);
    if (child) replies.push(child);
  }
  if (replies.length) simplified.replies = replies;
  return simplified;
}

export function registerBskyTools(server: McpServer): void {
  server.registerTool(
    'get_profile',
    {
      title: 'Bluesky profiles',
      description:
        'You have 1-25 account identifiers and want their Bluesky-layer profile cards: display ' +
        'name, bio, follower/post counts. Accounts the AppView has never indexed come back in a ' +
        'notFound list rather than failing the batch — resolve those with resolve_identity instead.',
      inputSchema: z.object({
        identifiers: z
          .array(z.string().min(1).max(253))
          .min(1)
          .max(25)
          .describe('Handles or DIDs, up to 25 per call.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ identifiers }) => {
      const cleaned = identifiers.map((i) => i.trim().replace(/^@/, ''));
      const found = await getProfiles(cleaned);
      // getProfiles keys by DID; inputs may be handles, and handles compare
      // case-insensitively (the AppView returns them lowercased).
      const byInput = cleaned.map((input) => {
        const needle = input.startsWith('did:') ? input : input.toLowerCase();
        for (const profile of found.values()) {
          if (profile.did === needle || profile.handle?.toLowerCase() === needle) {
            return { input, profile };
          }
        }
        return { input, profile: null };
      });
      return {
        profiles: byInput.filter((m) => m.profile).map((m) => profileCard(m.profile!)),
        notFound: byInput.filter((m) => !m.profile).map((m) => m.input),
      };
    }),
  );

  server.registerTool(
    'get_thread',
    {
      title: 'Read a post thread',
      description:
        'You have a Bluesky post (at:// URI or a bsky.app-style URL) and want the conversation: ' +
        'the post, its ancestors, and replies as a simplified tree with text, authors, and counts. ' +
        'Depth-capped; blocked or deleted posts appear as explicit placeholders.',
      inputSchema: z.object({
        uri: z
          .string()
          .min(1)
          .max(2048)
          .describe('at://<repo>/app.bsky.feed.post/<rkey> or a Bluesky-family post URL.'),
        depth: z.number().int().min(1).max(10).optional().describe('Reply depth, default 6.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ uri, depth }) => {
      const postUri = await normalizePostUri(uri);
      const data = (await getPostThread(postUri, {
        depth: depth ?? 6,
        parentHeight: 3,
      })) as { thread?: AppViewThreadNode } | null;
      if (!data?.thread) {
        throw new McpToolError(
          'not_found',
          `The AppView has no thread for ${postUri}`,
          'The post may be deleted, or its author may be on a PDS the AppView does not index; try get_record for the raw record.',
        );
      }

      const budget = { remaining: MAX_THREAD_POSTS, truncated: false };
      // Ancestors, root-first, so the reply chain reads top to bottom.
      const ancestors: Array<SimplifiedPost | { unavailable: true; reason: string }> = [];
      let parent = data.thread.parent;
      while (parent) {
        const simplified = simplifyThread({ ...parent, parent: undefined, replies: [] }, budget);
        if (simplified) ancestors.unshift(simplified);
        parent = parent.parent;
      }
      const thread = simplifyThread({ ...data.thread, parent: undefined }, budget);

      const parsed = parseAtUri(postUri)!;
      return {
        uri: postUri,
        ancestors,
        thread,
        truncated: budget.truncated,
        links: {
          aturi: recordLink(parsed.repo, POST_COLLECTION, parsed.rkey ?? ''),
          bsky: bskyAppUrl(parsed.repo, parsed.rkey),
        },
      };
    }),
  );

  server.registerTool(
    'search_posts',
    {
      title: 'Search Bluesky posts',
      description:
        'You need posts matching a query: full-text search over the Bluesky network, filterable ' +
        'by author, language, and time range. Returns post cards with counts and links; page with ' +
        'the cursor. This searches the Bluesky index only, not other Atmosphere apps.',
      inputSchema: z.object({
        query: z.string().min(1).max(300).describe('Search terms; supports quoted phrases and from:handle.'),
        sort: z.enum(['top', 'latest']).optional(),
        author: z.string().min(1).max(253).optional().describe('Limit to one author (handle or DID).'),
        since: z.string().min(4).max(40).optional().describe('ISO 8601 lower bound, e.g. 2026-08-01.'),
        until: z.string().min(4).max(40).optional().describe('ISO 8601 upper bound.'),
        lang: z.string().min(2).max(10).optional().describe('BCP-47 language, e.g. en, pt-BR.'),
        limit: z.number().int().min(1).max(50).optional().describe('Default 25.'),
        cursor: z.string().min(1).max(512).optional(),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ query, sort, author, since, until, lang, limit, cursor }) => {
      const page = await searchPosts({
        q: query,
        sort,
        author: author?.trim().replace(/^@/, ''),
        since,
        until,
        lang,
        limit: limit ?? 25,
        cursor,
      });
      if (!page) {
        throw new McpToolError(
          'upstream_error',
          'Bluesky post search is unavailable',
          'The public search endpoint rate-limits aggressively and refuses some networks outright. ' +
            'Retrying may not help; get_backlinks and sample_recent_records can often find related content instead.',
        );
      }
      return {
        query,
        hitsTotal: page.hitsTotal ?? null,
        count: page.posts?.length ?? 0,
        cursor: page.cursor ?? null,
        posts: (page.posts ?? []).map(postCard),
      };
    }),
  );

  server.registerTool(
    'search_actors',
    {
      title: 'Search Bluesky accounts',
      description:
        'You need to find accounts by name or topic: full search over Bluesky profiles (handles, ' +
        'display names, bios). For exact handle-to-DID conversion use resolve_identity instead — ' +
        'it also covers accounts the Bluesky index has never seen.',
      inputSchema: z.object({
        query: z.string().min(1).max(100),
        limit: z.number().int().min(1).max(25).optional().describe('Default 10.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ query, limit }) => {
      const page = await searchActors(query, { limit: limit ?? 10 });
      if (!page) {
        throw new McpToolError(
          'upstream_error',
          'Bluesky actor search is unavailable',
          'Safe to retry once; if it persists the public AppView is down or rate-limiting.',
        );
      }
      return {
        query,
        count: page.actors?.length ?? 0,
        actors: (page.actors ?? []).map(profileCard),
      };
    }),
  );

  server.registerTool(
    'get_author_feed',
    {
      title: 'What an account has been posting',
      description:
        'You want an account\'s recent posts in reverse chronological order, each with its like, ' +
        'repost, reply, and quote counts — so you can summarize what someone has been posting about ' +
        'or find their most-engaged posts (sort the results by likeCount). Page with the cursor to ' +
        'go further back. This is the keyless way to read a timeline; search_posts (by content) is ' +
        'often blocked.',
      inputSchema: z.object({
        actor: z.string().min(1).max(253).describe('Handle or DID of the account.'),
        filter: z
          .enum(['posts_with_replies', 'posts_no_replies', 'posts_with_media', 'posts_and_author_threads'])
          .optional()
          .describe('Narrow the feed; default includes reposts and top-level posts.'),
        limit: z.number().int().min(1).max(100).optional().describe('Default 30.'),
        cursor: z.string().min(1).max(1024).optional(),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ actor, filter, limit, cursor }) => {
      const page = await getAuthorFeed({ actor: actor.trim().replace(/^@/, ''), filter, limit: limit ?? 30, cursor });
      if (!page) {
        throw new McpToolError(
          'upstream_error',
          `Could not load the author feed for "${actor}"`,
          'Check the handle/DID; if it is right, the AppView may be rate-limiting — retry shortly.',
        );
      }
      const items = (page.feed ?? []).map((item) => {
        const card = postCard(item.post);
        const repostedBy = item.reason?.$type?.includes('reasonRepost') ? item.reason?.by : undefined;
        return {
          ...card,
          isRepost: !!repostedBy,
          ...(repostedBy
            ? { repostedBy: { did: repostedBy.did, handle: repostedBy.handle ?? null, displayName: repostedBy.displayName ?? null } }
            : {}),
          isReply: !!item.reply,
        };
      });
      return {
        actor,
        count: items.length,
        cursor: page.cursor ?? null,
        posts: items,
      };
    }),
  );

  server.registerTool(
    'get_trends',
    {
      title: 'Trending on Bluesky right now',
      description:
        'You want what is trending on Bluesky at this moment: topics with their post volume, a ' +
        'category, and a few accounts driving each one. Backed by Bluesky\'s unspecced trends ' +
        'endpoint, so the shape can change and it covers the Bluesky network specifically, not the ' +
        'whole Atmosphere — for network-wide lexicon activity use list_trending_lexicons.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(25).optional().describe('Default 10.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ limit }) => {
      const page = await getTrends({ limit: limit ?? 10 });
      if (!page) {
        throw new McpToolError(
          'upstream_error',
          'Bluesky trends are unavailable',
          'This is an unspecced endpoint Bluesky may have changed or disabled; retry shortly.',
        );
      }
      const trends = (page.trends ?? []).map((t) => ({
        topic: t.topic,
        displayName: t.displayName ?? null,
        description: t.description ?? null,
        category: t.category ?? null,
        status: t.status ?? null,
        postCount: t.postCount ?? null,
        startedAt: t.startedAt ?? null,
        actors: (t.actors ?? []).slice(0, 5).map((a) => ({
          did: a.did,
          handle: a.handle ?? null,
          displayName: a.displayName ?? null,
        })),
        link: t.link ? `https://bsky.app${t.link}` : null,
      }));
      return { count: trends.length, trends };
    }),
  );

  for (const direction of ['follows', 'followers'] as const) {
    server.registerTool(
      direction === 'follows' ? 'get_follows' : 'get_followers',
      {
        title: direction === 'follows' ? 'Who an account follows' : "An account's followers",
        description:
          direction === 'follows'
            ? 'You want the accounts an actor follows: one page of profile cards, with a cursor for ' +
              'more. The keyless outbound half of the Bluesky social graph. For who follows them, use ' +
              'get_followers; for network-wide references of any kind, use get_backlinks.'
            : 'You want the accounts that follow an actor: one page of profile cards, with a cursor for ' +
              'more. The keyless inbound half of the Bluesky social graph. For who they follow, use ' +
              'get_follows.',
        inputSchema: z.object({
          actor: z.string().min(1).max(253).describe('Handle or DID of the account.'),
          limit: z.number().int().min(1).max(100).optional().describe('Default 50.'),
          cursor: z.string().min(1).max(1024).optional(),
        }),
        annotations: READ_ONLY,
      },
      toolHandler(async ({ actor, limit, cursor }) => {
        const page = await getSocialGraph({ actor: actor.trim().replace(/^@/, ''), direction, limit: limit ?? 50, cursor });
        if (!page) {
          throw new McpToolError(
            'upstream_error',
            `Could not load ${direction} for "${actor}"`,
            'Check the handle/DID; the account may also have this list hidden.',
          );
        }
        const list = (direction === 'follows' ? page.follows : page.followers) ?? [];
        return {
          actor,
          direction,
          count: list.length,
          cursor: page.cursor ?? null,
          accounts: list.map(profileCard),
        };
      }),
    );
  }

  server.registerTool(
    'get_post_engagement',
    {
      title: 'Who engaged with a post',
      description:
        'You have a Bluesky post and want the accounts that engaged with it: who liked it, who ' +
        'reposted it, or who quoted it (pick one with "kind"). Quote mode returns the quoting posts ' +
        'themselves. Page with the cursor. For the counts alone, get_author_feed and get_thread ' +
        'already carry them.',
      inputSchema: z.object({
        uri: z.string().min(1).max(2048).describe('at:// URI of the post (from any post-returning tool).'),
        kind: z.enum(['likes', 'reposts', 'quotes']).describe('Which engagement to list.'),
        limit: z.number().int().min(1).max(100).optional().describe('Default 25.'),
        cursor: z.string().min(1).max(1024).optional(),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ uri, kind, limit, cursor }) => {
      const trimmed = uri.trim();
      if (!trimmed.startsWith('at://')) {
        throw new McpToolError(
          'invalid_parameter',
          'get_post_engagement needs an at:// post URI',
          'Resolve a bsky.app URL with resolve_link first, then pass parsed.uri.',
        );
      }
      const page = await getPostEngagement({ uri: trimmed, kind, limit: limit ?? 25, cursor });
      if (!page) {
        throw new McpToolError('upstream_error', `Could not load ${kind} for the post`, 'Safe to retry shortly.');
      }
      if (kind === 'quotes') {
        return {
          uri: trimmed,
          kind,
          count: page.posts?.length ?? 0,
          cursor: page.cursor ?? null,
          posts: (page.posts ?? []).map(postCard),
        };
      }
      const accounts =
        kind === 'likes'
          ? (page.likes ?? []).map((l) => profileCard(l.actor))
          : (page.repostedBy ?? []).map(profileCard);
      return { uri: trimmed, kind, count: accounts.length, cursor: page.cursor ?? null, accounts };
    }),
  );
}
