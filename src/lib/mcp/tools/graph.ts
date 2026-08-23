/**
 * Network-graph tools: who references a record or an account, anywhere on
 * the network, via microcosm's Constellation backlink index.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  getBacklinkSources,
  getBacklinks,
  flattenSources,
  backlinksFromPage,
} from '@/utils/atproto/constellation';
import { resolveHandle } from '@/utils/atproto/identity';
import { parseAtUri, toAtUri, explorePathFromAtUri } from '@/utils/atproto/urls';
import { McpToolError } from '@/lib/mcp/errors';
import { toolHandler, recordLink, siteLink, READ_ONLY } from '@/lib/mcp/respond';

/** Constellation caps every paginated endpoint at 100. */
const MAX_RECORDS_PAGE = 100;
/** Counts mode lists distinct (collection, path) sources; 100 covers real repos. */
const MAX_SOURCES = 100;

/**
 * Constellation indexes by DID, so handle-shaped input (a bare handle, or an
 * at:// URI whose repo segment is a handle) is resolved before querying.
 */
async function normalizeTarget(input: string): Promise<string> {
  const trimmed = input.trim();

  if (trimmed.startsWith('at://')) {
    const parsed = parseAtUri(trimmed);
    if (!parsed || parsed.space) {
      throw new McpToolError(
        'invalid_parameter',
        `"${trimmed}" is not a public at:// URI`,
        'Expected at://<did-or-handle>[/<collection>/<rkey>].',
      );
    }
    let did = parsed.repo;
    if (!did.startsWith('did:')) {
      const resolved = await resolveHandle(did);
      if (!resolved) {
        throw new McpToolError('not_found', `Could not resolve the handle "${parsed.repo}"`);
      }
      did = resolved;
    }
    // Constellation indexes account-level links under the bare DID, not the
    // repo-only at:// form, so a URI with no collection collapses to the DID.
    return parsed.collection
      ? toAtUri({ did, collection: parsed.collection, rkey: parsed.rkey })
      : did;
  }

  if (trimmed.startsWith('did:')) return trimmed;

  const did = await resolveHandle(trimmed.replace(/^@/, ''));
  if (!did) {
    throw new McpToolError(
      'not_found',
      `Could not resolve "${trimmed}" to a DID`,
      'Pass an at:// URI, a DID, or a registered handle.',
    );
  }
  return did;
}

export function registerGraphTools(server: McpServer): void {
  server.registerTool(
    'get_backlinks',
    {
      title: 'Who links to this, network-wide',
      description:
        'You have a record (at:// URI) or an account (DID/handle) and want to know what references ' +
        'it anywhere on the network: likes, replies, follows, mentions in other apps’ lexicons. ' +
        'Mode "counts" lists every (collection, path) source with totals — call it first. Mode ' +
        '"records" pages through one source’s linking records; fetch any of them with get_record.',
      inputSchema: z.object({
        target: z
          .string()
          .min(1)
          .max(2048)
          .describe('An at:// URI, a DID, or a handle. Handles are resolved to DIDs first.'),
        mode: z
          .enum(['counts', 'records'])
          .describe('"counts" summarizes every source; "records" pages one source.'),
        source_collection: z
          .string()
          .min(1)
          .max(512)
          .optional()
          .describe('records mode: the linking collection NSID (from a counts call).'),
        source_path: z
          .string()
          .min(1)
          .max(256)
          .optional()
          .describe('records mode: the link path within the source record, e.g. ".subject.uri".'),
        cursor: z.string().min(1).max(512).optional(),
        limit: z.number().int().min(1).max(MAX_RECORDS_PAGE).optional(),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ target, mode, source_collection, source_path, cursor, limit }) => {
      const normalized = await normalizeTarget(target);
      const explorePath = explorePathFromAtUri(normalized);
      const links = explorePath ? { explore: siteLink(explorePath) } : {};

      if (mode === 'counts') {
        const sources = flattenSources(await getBacklinkSources(normalized));
        if (!sources) {
          throw new McpToolError(
            'upstream_error',
            'The Constellation backlink index is unavailable',
            'Safe to retry; if it persists, constellation.microcosm.blue is down.',
          );
        }
        return {
          target: normalized,
          mode,
          totalSources: sources.length,
          totalLinks: sources.reduce((sum, s) => sum + s.count, 0),
          truncated: sources.length > MAX_SOURCES,
          sources: sources.slice(0, MAX_SOURCES),
          links,
        };
      }

      if (!source_collection || !source_path) {
        throw new McpToolError(
          'missing_parameter',
          'records mode needs source_collection and source_path',
          'Call with mode "counts" first; each source row carries the collection and path to pass here.',
        );
      }
      // /links/all reports paths with a leading dot; getBacklinks wants the
      // bare form in its source param. Accept either from the caller.
      const source = `${source_collection}:${source_path.replace(/^\./, '')}`;
      const page = await getBacklinks(normalized, source, { limit: limit ?? 25, cursor });
      if (!page) {
        throw new McpToolError(
          'upstream_error',
          'The Constellation backlink index is unavailable',
          'Safe to retry; if it persists, constellation.microcosm.blue is down.',
        );
      }
      const records = backlinksFromPage(page).map((r) => ({
        uri: toAtUri({ did: r.did, collection: r.collection, rkey: r.rkey }),
        did: r.did,
        collection: r.collection,
        rkey: r.rkey,
        link: recordLink(r.did, r.collection, r.rkey),
      }));

      return {
        target: normalized,
        mode,
        source,
        count: records.length,
        cursor: page.cursor ?? null,
        records,
        links,
      };
    }),
  );
}
