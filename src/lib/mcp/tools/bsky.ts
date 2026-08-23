/**
 * Bluesky app-layer tools over the keyless public AppView. These answer the
 * social-layer questions (profiles, threads, search); the repo/graph tools
 * answer the protocol-layer ones.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  getActorStarterPacks,
  getAuthorFeed,
  getFollowSuggestions,
  getLabelerServices,
  getPostEngagement,
  getPostThread,
  getPosts,
  getProfiles,
  getSocialGraph,
  getTrends,
  searchActors,
  searchPosts,
  type AppViewPostView,
  type AppViewThreadNode,
} from '@/utils/atproto/appview';
import { POST_COLLECTION, bskyAppUrl, postCard, profileCard } from '@/lib/mcp/cards';
import { normalizeRecordUri, normalizeRecordUris } from '@/lib/mcp/atUri';
import { resolveHandle } from '@/utils/atproto/identity';
import { matchSupportedUrl } from '@/utils/reverseParsers';
import { parseAtUri, toAtUri } from '@/utils/atproto/urls';
import { McpToolError } from '@/lib/mcp/errors';
import { toolHandler, profileLink, recordLink, READ_ONLY } from '@/lib/mcp/respond';

/** Total posts a simplified thread may carry, ancestors included. */
const MAX_THREAD_POSTS = 80;

/** did:<method>:<id> or a dotted handle. The AppView 400s anything else. */
const AT_DID = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/;
const AT_HANDLE = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
function looksLikeAtIdentifier(id: string): boolean {
  return AT_DID.test(id) || AT_HANDLE.test(id);
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
      // getProfiles 400s the WHOLE batch if any one identifier is malformed,
      // which would drop every valid sibling into notFound. Send only the
      // syntactically valid ones; route the rest straight to notFound so one
      // bad identifier can't poison the batch (the tool's documented promise).
      const valid = cleaned.filter(looksLikeAtIdentifier);
      const malformed = cleaned.filter((i) => !looksLikeAtIdentifier(i));
      const found = valid.length ? await getProfiles(valid) : new Map();
      // getProfiles keys by DID; inputs may be handles, and handles compare
      // case-insensitively (the AppView returns them lowercased).
      const byInput = valid.map((input) => {
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
        notFound: [...byInput.filter((m) => !m.profile).map((m) => m.input), ...malformed],
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
        'already carry them; for references from outside Bluesky, use get_backlinks.',
      inputSchema: z.object({
        uri: z.string().min(1).max(2048).describe('at:// URI of the post (from any post-returning tool).'),
        kind: z.enum(['likes', 'reposts', 'quotes']).describe('Which engagement to list.'),
        limit: z.number().int().min(1).max(100).optional().describe('Default 25.'),
        cursor: z.string().min(1).max(1024).optional(),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ uri, kind, limit, cursor }) => {
      // The AppView answers 200-with-nothing for a handle-form URI, so a
      // caller passing resolve_link's output verbatim would be told the post
      // has no likers rather than that the identifier needs resolving.
      const trimmed = await normalizeRecordUri(uri, 'uri');
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

  server.registerTool(
    'get_posts',
    {
      title: 'Hydrate posts by URI',
      description:
        'You already have post at:// URIs — from get_backlinks, sample_firehose, list_records, ' +
        'anywhere — and want them as readable posts with text, author, and engagement counts, up to ' +
        '25 in one call. This is the Bluesky-layer counterpart to get_record: same posts, but with ' +
        'the AppView aggregates attached. URIs the AppView has not indexed are simply absent.',
      inputSchema: z.object({
        uris: z
          .array(z.string().min(1).max(2048))
          .min(1)
          .max(25)
          .describe('Post at:// URIs, up to 25 per call.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ uris }) => {
      // Normalize authorities to DIDs first: the AppView omits handle-form
      // URIs from its response, which would look like "not indexed" here.
      const { normalized } = await normalizeRecordUris(uris, 'uris');
      const page = await getPosts(normalized);
      if (!page) {
        throw new McpToolError('upstream_error', 'Could not hydrate those posts', 'Safe to retry shortly.');
      }
      const posts = (page.posts ?? []).map(postCard);
      const returned = new Set(posts.map((p) => p.uri));
      return {
        count: posts.length,
        posts,
        notFound: normalized.filter((u) => !returned.has(u)),
      };
    }),
  );

  server.registerTool(
    'get_suggested_follows',
    {
      title: 'Accounts similar to this one',
      description:
        'You have an account and want others like it: the "more like this" list Bluesky computes ' +
        'from the graph, which is a fast way to map a community around someone. Bluesky\'s ' +
        'network-wide suggestion list needs a signed-in viewer, so it is not offered here; this ' +
        'tool always answers relative to an actor.',
      inputSchema: z.object({
        actor: z
          .string()
          .min(1)
          .max(253)
          .describe('Handle or DID to find similar accounts to.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ actor }) => {
      const page = await getFollowSuggestions({ actor: actor.trim().replace(/^@/, '') });
      if (!page) {
        throw new McpToolError(
          'upstream_error',
          `Could not load accounts similar to "${actor}"`,
          'Check the handle/DID, then retry.',
        );
      }
      const accounts = page.suggestions ?? page.actors ?? [];
      return { similarTo: actor, count: accounts.length, accounts: accounts.map(profileCard) };
    }),
  );

  server.registerTool(
    'get_starter_packs',
    {
      title: "An account's starter packs",
      description:
        'You want the starter packs an account has published: curated bundles of accounts and feeds ' +
        'that new people can follow in one action. Each carries its member list URI, which get_list ' +
        'expands into the actual accounts.',
      inputSchema: z.object({
        actor: z.string().min(1).max(253).describe('Handle or DID of the pack author.'),
        limit: z.number().int().min(1).max(50).optional().describe('Default 25.'),
        cursor: z.string().min(1).max(1024).optional(),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ actor, limit, cursor }) => {
      const page = await getActorStarterPacks({
        actor: actor.trim().replace(/^@/, ''),
        limit: limit ?? 25,
        cursor,
      });
      if (!page) {
        throw new McpToolError(
          'upstream_error',
          `Could not load starter packs for "${actor}"`,
          'Check the handle/DID, then retry.',
        );
      }
      const packs = (page.starterPacks ?? []).map((pack) => {
        const record = (pack.record ?? {}) as { name?: string; description?: string; list?: string };
        const rkey = pack.uri.split('/').pop() ?? '';
        const creator = pack.creator?.handle ?? pack.creator?.did ?? '';
        return {
          uri: pack.uri,
          name: record.name ?? null,
          description: record.description ?? null,
          listUri: record.list ?? null,
          memberCount: pack.listItemCount ?? null,
          joinedAllTimeCount: pack.joinedAllTimeCount ?? null,
          creator: pack.creator
            ? { did: pack.creator.did, handle: pack.creator.handle ?? null }
            : null,
          links: creator
            ? {
                aturi: recordLink(creator, 'app.bsky.graph.starterpack', rkey),
                bsky: `https://bsky.app/starter-pack/${creator}/${rkey}`,
              }
            : {},
        };
      });
      return { actor, count: packs.length, cursor: page.cursor ?? null, starterPacks: packs };
    }),
  );

  server.registerTool(
    'get_labeler_services',
    {
      title: 'Moderation labelers',
      description:
        'You have labeler DIDs and want what those moderation services actually do: the label values ' +
        'each one publishes and who runs it. Labelers are ordinary atproto accounts, so their DIDs ' +
        'come from labels on a record or from resolve_identity like any other.',
      inputSchema: z.object({
        dids: z
          .array(z.string().min(1).max(256))
          .min(1)
          .max(10)
          .describe('Labeler DIDs, e.g. did:plc:ar7c4by46qjdydhdevvrndac (Bluesky Moderation).'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ dids }) => {
      const cleaned = dids.map((d) => d.trim());
      const bad = cleaned.filter((d) => !d.startsWith('did:'));
      if (bad.length) {
        throw new McpToolError(
          'invalid_parameter',
          `Not DIDs: ${bad.slice(0, 3).join(', ')}`,
          'Labelers are addressed by DID; resolve a handle with resolve_identity first.',
        );
      }
      const page = await getLabelerServices({ dids: cleaned, detailed: true });
      if (!page) {
        throw new McpToolError('upstream_error', 'Could not load those labeler services', 'Safe to retry shortly.');
      }
      const services = (page.views ?? []).map((view) => ({
        uri: view.uri,
        did: view.creator?.did ?? null,
        handle: view.creator?.handle ?? null,
        displayName: view.creator?.displayName ?? null,
        description: view.creator?.description ?? null,
        likeCount: view.likeCount ?? 0,
        labelValues: view.policies?.labelValues ?? [],
        links: view.creator
          ? { profile: profileLink(view.creator.handle ?? view.creator.did) }
          : {},
      }));
      return { count: services.length, services };
    }),
  );
}
