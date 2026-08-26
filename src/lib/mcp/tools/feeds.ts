/**
 * Custom feeds and lists — the parts of Bluesky people build for each other.
 *
 * A feed generator is a service that returns a post ordering; a list is a
 * curated set of accounts that can be read as a feed or used for moderation.
 * Both are ordinary atproto records, so get_record reads them raw; these
 * tools return the hydrated views the AppView computes, which is what a
 * reader actually wants.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  getFeed,
  getFeedGenerators,
  getList,
  getListFeed,
  getLists,
  listFeedGenerators,
} from '@/utils/atproto/appview';
import { McpToolError } from '@/lib/mcp/errors';
import { normalizeRecordUri, normalizeRecordUris } from '@/lib/mcp/atUri';
import { feedCard, listCard, postCard, profileCard } from '@/lib/mcp/cards';
import { toolHandler, READ_ONLY } from '@/lib/mcp/respond';

const feedUriSchema = z
  .string()
  .min(1)
  .max(2048)
  .describe('at://<repo>/app.bsky.feed.generator/<rkey> — from list_feeds or resolve_link.');

const listUriSchema = z
  .string()
  .min(1)
  .max(2048)
  .describe('at://<repo>/app.bsky.graph.list/<rkey> — from list_lists or resolve_link.');

export function registerFeedTools(server: McpServer): void {
  server.registerTool(
    'list_feeds',
    {
      title: 'Find custom feeds',
      description:
        'You want custom feeds (algorithmic timelines people publish): "actor" lists the ones an ' +
        'account created, "popular" ranks the network\'s most-liked and takes an optional query, ' +
        '"suggested" returns Bluesky\'s editorial picks. Read any of them with get_feed. The ' +
        'popular and suggested sources are unspecced endpoints Bluesky may change.',
      inputSchema: z.object({
        source: z.enum(['actor', 'popular', 'suggested']).describe('Where to look for feeds.'),
        actor: z.string().min(1).max(253).optional().describe('Required when source is "actor".'),
        query: z.string().min(1).max(100).optional().describe('Search terms; "popular" only.'),
        limit: z.number().int().min(1).max(50).optional().describe('Default 25.'),
        cursor: z.string().min(1).max(1024).optional(),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ source, actor, query, limit, cursor }) => {
      if (source === 'actor' && !actor) {
        throw new McpToolError(
          'missing_parameter',
          'source "actor" needs an actor',
          'Pass a handle or DID, or use source "popular" to browse the network.',
        );
      }
      const page = await listFeedGenerators({
        source,
        actor: actor?.trim().replace(/^@/, ''),
        query,
        limit: limit ?? 25,
        cursor,
      });
      if (!page) {
        throw new McpToolError(
          'upstream_error',
          `Could not list ${source} feeds`,
          source === 'actor' ? 'Check the handle/DID, then retry.' : 'Safe to retry shortly.',
        );
      }
      return {
        source,
        ...(actor ? { actor } : {}),
        count: page.feeds?.length ?? 0,
        cursor: page.cursor ?? null,
        feeds: (page.feeds ?? []).map(feedCard),
      };
    }),
  );

  server.registerTool(
    'get_feed_info',
    {
      title: 'Describe custom feeds',
      description:
        'You have feed at:// URIs and want what each feed is: its name, description, creator, and ' +
        'like count, up to 25 at once. Use this when a record or a link points at a feed and you ' +
        'need to know what it does before reading it with get_feed.',
      inputSchema: z.object({
        uris: z.array(feedUriSchema).min(1).max(25).describe('Feed generator at:// URIs.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ uris }) => {
      // A feed URI's authority may be a handle; the AppView indexes by DID.
      const { normalized: cleaned } = await normalizeRecordUris(uris, 'uris');
      const page = await getFeedGenerators(cleaned);
      if (!page) {
        throw new McpToolError('upstream_error', 'Could not describe those feeds', 'Safe to retry shortly.');
      }
      const feeds = (page.feeds ?? []).map(feedCard);
      const returned = new Set(feeds.map((f) => f.uri));
      return {
        count: feeds.length,
        feeds,
        notFound: cleaned.filter((u) => !returned.has(u)),
      };
    }),
  );

  server.registerTool(
    'get_feed',
    {
      title: 'Read a custom feed',
      description:
        'You have a feed generator URI and want the posts it is serving right now, with engagement ' +
        'counts, newest page first. This is how to read what an algorithm someone published is ' +
        'actually surfacing. A feed whose generator is offline or private answers upstream_error.',
      inputSchema: z.object({
        feed: feedUriSchema,
        limit: z.number().int().min(1).max(100).optional().describe('Default 25.'),
        cursor: z.string().min(1).max(2048).optional(),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ feed, limit, cursor }) => {
      const uri = await normalizeRecordUri(feed, 'feed');
      const page = await getFeed({ feed: uri, limit: limit ?? 25, cursor });
      if (!page) {
        throw new McpToolError(
          'upstream_error',
          'That feed did not answer',
          'The generator service may be offline, or the feed may require sign-in. get_feed_info says who runs it.',
        );
      }
      return {
        feed: uri,
        count: page.feed?.length ?? 0,
        cursor: page.cursor ?? null,
        posts: (page.feed ?? []).map((item) => postCard(item.post)),
      };
    }),
  );

  server.registerTool(
    'list_lists',
    {
      title: "An account's lists",
      description:
        'You want the lists an account has published: curation lists that can be read as a feed, and ' +
        'moderation lists used for muting or blocking. Each carries its purpose, so you can tell the ' +
        'two apart. Expand members with get_list, or read their posts with get_list_feed.',
      inputSchema: z.object({
        actor: z.string().min(1).max(253).describe('Handle or DID of the list author.'),
        limit: z.number().int().min(1).max(50).optional().describe('Default 25.'),
        cursor: z.string().min(1).max(1024).optional(),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ actor, limit, cursor }) => {
      const page = await getLists({
        actor: actor.trim().replace(/^@/, ''),
        limit: limit ?? 25,
        cursor,
      });
      if (!page) {
        throw new McpToolError(
          'upstream_error',
          `Could not load lists for "${actor}"`,
          'Check the handle/DID, then retry.',
        );
      }
      return {
        actor,
        count: page.lists?.length ?? 0,
        cursor: page.cursor ?? null,
        lists: (page.lists ?? []).map(listCard),
      };
    }),
  );

  server.registerTool(
    'get_list',
    {
      title: 'Who is on a list',
      description:
        'You have a list URI and want the list itself plus a page of its members as profile cards. ' +
        'Works for curation lists and moderation lists alike — the purpose field says which. For the ' +
        "members' posts rather than the members, use get_list_feed.",
      inputSchema: z.object({
        list: listUriSchema,
        limit: z.number().int().min(1).max(100).optional().describe('Members per page, default 50.'),
        cursor: z.string().min(1).max(1024).optional(),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ list, limit, cursor }) => {
      const uri = await normalizeRecordUri(list, 'list');
      const page = await getList({ list: uri, limit: limit ?? 50, cursor });
      if (!page?.list) {
        throw new McpToolError(
          'not_found',
          'No list at that URI',
          'list_lists shows an account\'s lists with their URIs.',
        );
      }
      return {
        list: listCard(page.list),
        count: page.items?.length ?? 0,
        cursor: page.cursor ?? null,
        members: (page.items ?? []).map((item) => profileCard(item.subject)),
      };
    }),
  );

  server.registerTool(
    'get_list_feed',
    {
      title: 'Posts from a list',
      description:
        'You have a curation list and want what its members are posting, as one combined feed with ' +
        'engagement counts. The read-side of a list: get_list gives you who is on it, this gives you ' +
        'what they said.',
      inputSchema: z.object({
        list: listUriSchema,
        limit: z.number().int().min(1).max(100).optional().describe('Default 25.'),
        cursor: z.string().min(1).max(2048).optional(),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ list, limit, cursor }) => {
      const uri = await normalizeRecordUri(list, 'list');
      const page = await getListFeed({ list: uri, limit: limit ?? 25, cursor });
      if (!page) {
        throw new McpToolError(
          'upstream_error',
          'That list feed did not answer',
          'Check the list URI with get_list; moderation lists have no readable feed.',
        );
      }
      return {
        list: uri,
        count: page.feed?.length ?? 0,
        cursor: page.cursor ?? null,
        posts: (page.feed ?? []).map((item) => postCard(item.post)),
      };
    }),
  );
}
