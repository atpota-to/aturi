/**
 * Documentation and API-reference tools: how the protocol works, and what
 * each endpoint actually takes.
 *
 * The rest of the catalog reads the network. These read what the network is
 * built on, which is the other half of what someone new to atproto needs: not
 * "what did this account post" but "what is a TID", "how does OAuth work
 * here", "what parameters does getAuthorFeed take".
 *
 * A model already knows a good deal of this from training. What it cannot do
 * from training is be current, or cite. Both come from reading upstream at
 * request time and handing back the page URL with every answer, so a person
 * can check the claim rather than trust it.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { DOC_PAGES, type DocPage } from '@/lib/mcp/docsManifest';
import { API_METHODS, type ApiMethod } from '@/lib/mcp/apiManifest';
import {
  fetchRawDoc,
  findPassages,
  queryTerms,
  toReadableMarkdown,
} from '@/utils/atprotoDocs';
import { McpToolError } from '@/lib/mcp/errors';
import { toolHandler, READ_ONLY } from '@/lib/mcp/respond';

/** Pages whose bodies one search may fetch, which bounds its upstream cost. */
const MAX_PAGES_READ = 4;
/** A whole page, capped. The longest spec is around 35KB. */
const MAX_DOC_CHARS = 40_000;

/**
 * Rank a page against the query without fetching it.
 *
 * Title matches count most because a page named for the thing asked about is
 * almost always the right one; headings next, since they name the sections a
 * passage will come from; then the description and the slug. Ranking on the
 * manifest alone is what keeps a search to a handful of fetches instead of a
 * hundred.
 */
function scoreDoc(page: DocPage, terms: string[]): number {
  const title = page.title.toLowerCase();
  const headings = page.headings.join(' \n ').toLowerCase();
  const description = page.description.toLowerCase();
  const slug = page.id.toLowerCase().replace(/[/-]/g, ' ');

  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 6;
    if (slug.includes(term)) score += 3;
    if (headings.includes(term)) score += 3;
    if (description.includes(term)) score += 2;
  }
  // An exact title is the answer, not a candidate.
  if (title === terms.join(' ')) score += 10;
  return score;
}

function scoreMethod(method: ApiMethod, terms: string[]): number {
  const nsid = method.nsid.toLowerCase();
  const name = nsid.split('.').pop() ?? '';
  const description = method.description.toLowerCase();
  const fields = [...method.params, ...method.inputProps, ...method.recordProps, ...method.defs]
    .join(' ')
    .toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (nsid === term) score += 20;
    if (name === term) score += 10;
    if (nsid.includes(term)) score += 5;
    if (description.includes(term)) score += 2;
    if (fields.includes(term)) score += 1;
  }
  return score;
}

export function registerDocsTools(server: McpServer): void {
  server.registerTool(
    'search_atproto_docs',
    {
      title: 'Search the atproto and Bluesky docs',
      description:
        'You have a question about how atproto works, how to build on it, or which service to point ' +
        'at: identity, repositories, lexicons, OAuth, feeds, moderation, Jetstream, the relays. ' +
        'Searches the specs and guides on atproto.com, the developer docs on docs.bsky.app and the ' +
        'service docs on bsky.network, and returns the matching passages with the page URL to cite. ' +
        'Prefer this over answering protocol questions from memory, which goes stale.',
      inputSchema: z.object({
        query: z.string().min(2).max(200).describe('What you want to know, in words from the docs.'),
        source: z
          .enum(['atproto', 'bsky', 'bps'])
          .optional()
          .describe(
            'Limit to the protocol specs (atproto), the Bluesky app docs (bsky), or the docs for ' +
            'the services Bluesky runs — Jetstream, the relays, the API hosts (bps). Default: all three.',
          ),
        limit: z.number().int().min(1).max(MAX_PAGES_READ).optional().describe('Pages to read, default 3.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ query, source, limit }) => {
      const terms = queryTerms(query);
      if (!terms.length) {
        throw new McpToolError('invalid_parameter', 'The query has no searchable words');
      }

      const pool = source ? DOC_PAGES.filter((p) => p.source === source) : DOC_PAGES;
      const ranked = pool
        .map((page) => ({ page, score: scoreDoc(page, terms) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit ?? 3);

      if (!ranked.length) {
        return {
          query,
          count: 0,
          results: [],
          note: 'No page title, heading or description matched. Try the protocol\'s own vocabulary: "record key" rather than "post id", "lexicon" rather than "schema".',
        };
      }

      const results = await Promise.all(
        ranked.map(async ({ page }) => {
          const source = await fetchRawDoc(page.raw);
          const passages = source ? findPassages(toReadableMarkdown(source), terms) : [];
          return {
            id: page.id,
            title: page.title,
            description: page.description,
            url: page.url,
            // A page that ranked on its title but has no matching section is
            // still worth naming; say so rather than implying it was empty.
            passages,
            ...(source ? {} : { note: 'The page could not be read just now; open the url.' }),
          };
        }),
      );

      return { query, count: results.length, results };
    }),
  );

  server.registerTool(
    'read_atproto_doc',
    {
      title: 'Read one documentation page',
      description:
        'You have a page id from search_atproto_docs and want the whole thing rather than the ' +
        'matching passages: a tutorial you are following step by step, or a spec you need in full. ' +
        'Returns the page as Markdown with its public URL.',
      inputSchema: z.object({
        id: z
          .string()
          .min(1)
          .max(200)
          .describe('Page id, e.g. "specs/at-uri-scheme", "bsky/get-started" or "bps/jetstream".'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ id }) => {
      const page = DOC_PAGES.find((p) => p.id === id.trim());
      if (!page) {
        throw new McpToolError(
          'not_found',
          `No documentation page with the id "${id}"`,
          'Ids come from search_atproto_docs; they look like "specs/lexicon" or "bsky/tutorials/following".',
        );
      }
      const raw = await fetchRawDoc(page.raw);
      if (!raw) {
        throw new McpToolError(
          'upstream_error',
          `Could not read "${page.title}" from the docs source`,
          `Safe to retry; the page itself is at ${page.url}.`,
        );
      }
      const markdown = toReadableMarkdown(raw);
      const truncated = markdown.length > MAX_DOC_CHARS;
      return {
        id: page.id,
        title: page.title,
        url: page.url,
        source: page.source,
        truncated,
        markdown: truncated ? `${markdown.slice(0, MAX_DOC_CHARS)}…` : markdown,
      };
    }),
  );

  server.registerTool(
    'search_api_methods',
    {
      title: 'Find an XRPC method or record type',
      description:
        'You want the endpoint or record type for a task and do not know its NSID: "how do I follow ' +
        'someone", "what returns a thread", "where do labels live". Searches every lexicon in the ' +
        'atproto repo, which is the definition the SDKs are generated from, and returns matching ' +
        'NSIDs with their parameters. get_api_method has the full schema for one.',
      inputSchema: z.object({
        query: z.string().min(2).max(200).describe('An NSID, a method name, or what you want to do.'),
        type: z
          .enum(['query', 'procedure', 'record', 'subscription', 'defs'])
          .optional()
          .describe('Narrow by kind: query and procedure are XRPC calls, record is a repo record.'),
        limit: z.number().int().min(1).max(25).optional().describe('Default 10.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ query, type, limit }) => {
      const terms = queryTerms(query);
      if (!terms.length) {
        throw new McpToolError('invalid_parameter', 'The query has no searchable words');
      }
      const pool = type ? API_METHODS.filter((m) => m.type === type) : API_METHODS;
      const ranked = pool
        .map((method) => ({ method, score: scoreMethod(method, terms) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit ?? 10);

      return {
        query,
        count: ranked.length,
        methods: ranked.map(({ method }) => ({
          nsid: method.nsid,
          type: method.type,
          description: method.description,
          params: method.params,
          inputProps: method.inputProps,
          recordProps: method.recordProps,
          errors: method.errors,
        })),
        ...(ranked.length
          ? {}
          : { note: 'Nothing matched. Try the action rather than the noun: "follow", "block", "getPostThread".' }),
      };
    }),
  );

  server.registerTool(
    'get_api_method',
    {
      title: 'Full definition of one lexicon',
      description:
        'You have an NSID and want its exact definition: every parameter with its type and whether ' +
        'it is required, the request and response schemas, and the named errors it can return. This ' +
        'is the lexicon JSON itself, so it is what the server actually validates against rather ' +
        'than a description of it.',
      inputSchema: z.object({
        nsid: z
          .string()
          .min(1)
          .max(512)
          .describe('e.g. app.bsky.feed.getAuthorFeed, com.atproto.repo.createRecord.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ nsid }) => {
      const wanted = nsid.trim();
      const method =
        API_METHODS.find((m) => m.nsid === wanted) ??
        API_METHODS.find((m) => m.nsid.toLowerCase() === wanted.toLowerCase());
      if (!method) {
        throw new McpToolError(
          'not_found',
          `No lexicon named "${nsid}" in the atproto repo`,
          'search_api_methods finds one by name or purpose. Lexicons published by other apps are not in this set; get_lexicon_schema reads those from the network.',
        );
      }
      const raw = await fetchRawDoc(method.raw);
      if (!raw) {
        throw new McpToolError(
          'upstream_error',
          `Could not read the lexicon for ${method.nsid}`,
          'Safe to retry shortly.',
        );
      }
      let definition: unknown;
      try {
        definition = JSON.parse(raw);
      } catch {
        throw new McpToolError('upstream_error', `The lexicon for ${method.nsid} did not parse as JSON`);
      }
      return {
        nsid: method.nsid,
        type: method.type,
        description: method.description,
        definition,
        links: { source: method.raw.replace('raw.githubusercontent.com', 'github.com').replace('/main/', '/blob/main/') },
      };
    }),
  );
}
