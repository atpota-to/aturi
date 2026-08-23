/**
 * Repository tools: what is in an account's repo, page through a collection,
 * fetch one record, and describe a PDS host.
 *
 * Every PDS base fetched here is either caller-supplied (describe_pds, guarded
 * inline) or resolved from a DID document via resolveGuardedIdentity, which
 * clears the endpoint through the SSRF guard before returning it — so no
 * attacker-declared host reaches a fetch.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  describeRepo,
  getLatestCommit,
  getRecord as getPdsRecord,
  getRecordUrl,
  listRecordsPage,
} from '@/utils/atproto/pdsClient';
import {
  describeServer,
  getServerHealth,
  listRepos,
  pdsHostname,
} from '@/utils/atproto/pdsServer';
import { getRecordByUri } from '@/utils/atproto/slingshot';
import { getProfile } from '@/utils/atproto/appview';
import { parseAtUri, toAtUri, explorePathFromAtUri } from '@/utils/atproto/urls';
import { isValidNsid, isValidRecordKey } from '@/utils/atproto/spaceUri';
import { tidToDate } from '@/utils/atproto/tid';
import { McpToolError } from '@/lib/mcp/errors';
import { assertPublicServiceBase } from '@/lib/mcp/guard';
import { resolveGuardedIdentity } from '@/lib/mcp/identityResolve';
import {
  toolHandler,
  profileLink,
  recordLink,
  exploreLink,
  siteLink,
  READ_ONLY,
} from '@/lib/mcp/respond';

const identifierSchema = z
  .string()
  .min(1)
  .max(2048)
  .describe('A handle (alice.bsky.social), a DID, or an at:// URI whose repo segment is used.');

const collectionSchema = z
  .string()
  .min(1)
  .max(512)
  .describe('A collection NSID, e.g. app.bsky.feed.post or com.whtwnd.blog.entry.');

function hasStatus(err: unknown, status: number): boolean {
  return err instanceof Error && (err as Error & { status?: number }).status === status;
}

export function registerRepoTools(server: McpServer): void {
  server.registerTool(
    'describe_repo',
    {
      title: 'What is in this repo',
      description:
        'You have an account and want the shape of its repository: which collections (lexicons) it ' +
        'actually holds, its PDS, when it last wrote, and its Bluesky-layer profile if one exists. ' +
        'The collections list is how you discover which apps an account uses; page through any of ' +
        'them with list_records.',
      inputSchema: z.object({ identifier: identifierSchema }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ identifier }) => {
      const bundle = await resolveGuardedIdentity(identifier);

      let collections: string[] = [];
      try {
        const desc = await describeRepo(bundle.pds, bundle.did);
        collections = Array.isArray(desc.collections) ? desc.collections : [];
      } catch (err) {
        if (hasStatus(err, 400) || hasStatus(err, 404)) {
          throw new McpToolError(
            'not_found',
            `${bundle.did} resolved, but its PDS has no repo for it`,
            'The account may be deactivated or mid-migration.',
          );
        }
        throw err;
      }

      // Enrichment beyond the repo description is best-effort: a repo with an
      // unreachable sync endpoint or no Bluesky profile is still a full answer.
      let latestCommit: Record<string, unknown> | null = null;
      try {
        const commit = await getLatestCommit(bundle.pds, bundle.did);
        latestCommit = {
          cid: commit.cid,
          rev: commit.rev,
          lastWriteAt: tidToDate(commit.rev)?.toISOString() ?? null,
        };
      } catch {
        // getLatestCommit is optional context.
      }

      let profile: Record<string, unknown> | null = null;
      try {
        const p = await getProfile(bundle.did);
        if (p) {
          profile = {
            displayName: p.displayName ?? null,
            description: p.description ?? null,
            followersCount: p.followersCount ?? null,
            followsCount: p.followsCount ?? null,
            postsCount: p.postsCount ?? null,
          };
        }
      } catch {
        // Not every atproto account exists at the Bluesky layer.
      }

      return {
        did: bundle.did,
        handle: bundle.handle,
        pds: bundle.pds,
        collections,
        latestCommit,
        profile,
        links: {
          profile: profileLink(bundle.handle ?? bundle.did),
          explore: exploreLink(`/${bundle.handle ?? bundle.did}`),
        },
      };
    }),
  );

  server.registerTool(
    'list_records',
    {
      title: 'Page through a collection',
      description:
        'You know which repo and which collection (from describe_repo) and want the records ' +
        'themselves: one page of full record values with their at:// URIs, plus a cursor for the ' +
        'next page. Works for any lexicon on any PDS, not just Bluesky.',
      inputSchema: z.object({
        identifier: identifierSchema,
        collection: collectionSchema,
        limit: z.number().int().min(1).max(100).optional().describe('Records per page, default 50.'),
        cursor: z.string().min(1).max(512).optional(),
        reverse: z.boolean().optional().describe('true lists oldest first.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ identifier, collection, limit, cursor, reverse }) => {
      if (!isValidNsid(collection)) {
        throw new McpToolError(
          'invalid_parameter',
          `"${collection}" is not a valid collection NSID`,
          'Expected a reverse-domain name like app.bsky.feed.post.',
        );
      }
      const bundle = await resolveGuardedIdentity(identifier);

      let page;
      try {
        page = await listRecordsPage(bundle.pds, {
          repo: bundle.did,
          collection,
          limit: limit ?? 50,
          cursor,
          reverse: reverse ?? false,
        });
      } catch (err) {
        if (hasStatus(err, 400) || hasStatus(err, 404)) {
          throw new McpToolError(
            'not_found',
            `The PDS has no repo for ${bundle.did}`,
            'The account may be deactivated; an existing repo with an empty collection returns an empty page instead of this error.',
          );
        }
        throw err;
      }

      return {
        did: bundle.did,
        handle: bundle.handle,
        collection,
        count: page.records.length,
        cursor: page.cursor ?? null,
        records: page.records,
        links: {
          explore: exploreLink(`/${bundle.handle ?? bundle.did}/${collection}`),
        },
      };
    }),
  );

  server.registerTool(
    'get_record',
    {
      title: 'Fetch one record',
      description:
        'You have a record address — an at:// URI, or repo + collection + rkey — and want the ' +
        'record JSON. Served from the Slingshot edge cache with a direct-PDS fallback, so it works ' +
        'for any lexicon on any host. Use resolve_link instead when what you have is a web page URL.',
      inputSchema: z.object({
        uri: z.string().min(1).max(2048).optional().describe('Full at://<repo>/<collection>/<rkey> URI.'),
        identifier: identifierSchema.optional(),
        collection: collectionSchema.optional(),
        rkey: z.string().min(1).max(512).optional().describe('The record key.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ uri, identifier, collection, rkey }) => {
      let repo: string;
      let coll: string;
      let key: string;

      if (uri) {
        const parsed = parseAtUri(uri.trim());
        if (!parsed || parsed.space || !parsed.collection || !parsed.rkey) {
          throw new McpToolError(
            'invalid_parameter',
            `"${uri}" is not a full public record URI`,
            'Expected at://<did-or-handle>/<collection>/<rkey>.',
          );
        }
        repo = parsed.repo;
        coll = parsed.collection;
        key = parsed.rkey;
      } else if (identifier && collection && rkey) {
        repo = identifier.trim();
        coll = collection;
        key = rkey;
      } else {
        throw new McpToolError(
          'missing_parameter',
          'Pass uri, or identifier + collection + rkey together',
        );
      }
      if (!isValidNsid(coll)) {
        throw new McpToolError('invalid_parameter', `"${coll}" is not a valid collection NSID`);
      }
      if (!isValidRecordKey(key)) {
        throw new McpToolError('invalid_parameter', `"${key}" is not a valid record key`);
      }

      const requested = toAtUri({ did: repo, collection: coll, rkey: key });
      const cached = await getRecordByUri(requested);
      if (cached) {
        const explorePath = explorePathFromAtUri(cached.uri);
        return {
          uri: cached.uri,
          cid: cached.cid,
          value: cached.value,
          source: 'slingshot',
          links: {
            aturi: recordLink(repo, coll, key),
            ...(explorePath ? { explore: siteLink(explorePath) } : {}),
          },
        };
      }

      // Slingshot misses on brand-new records and unusual hosts; go to the
      // repo's own PDS before concluding the record doesn't exist.
      const bundle = await resolveGuardedIdentity(repo);
      let record;
      try {
        record = await getPdsRecord(bundle.pds, { repo: bundle.did, collection: coll, rkey: key });
      } catch (err) {
        if (hasStatus(err, 400) || hasStatus(err, 404)) {
          throw new McpToolError(
            'not_found',
            `No record at ${requested}`,
            'List the collection with list_records to see what exists.',
          );
        }
        throw err;
      }
      const explorePath = explorePathFromAtUri(record.uri);
      return {
        uri: record.uri,
        cid: record.cid,
        value: record.value,
        source: 'pds',
        links: {
          aturi: recordLink(bundle.handle ?? bundle.did, coll, key),
          ...(explorePath ? { explore: siteLink(explorePath) } : {}),
          pds: getRecordUrl(bundle.pds, { repo: bundle.did, collection: coll, rkey: key }),
        },
      };
    }),
  );

  server.registerTool(
    'describe_pds',
    {
      title: 'Describe a PDS host',
      description:
        'You have a PDS hostname (from resolve_identity or describe_repo) and want to know about ' +
        'the server itself: its metadata, software version, and a sample of the repos it hosts. ' +
        'Useful for mapping where communities actually live.',
      inputSchema: z.object({
        host: z
          .string()
          .min(1)
          .max(256)
          .describe('Hostname or URL of the PDS, e.g. pds.example.com.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ host }) => {
      const base = assertPublicServiceBase(host, 'The host');

      let description;
      try {
        description = await describeServer(base);
      } catch (err) {
        if (err instanceof Error && /^HTTP (404|400|501)/.test(err.message)) {
          throw new McpToolError(
            'not_found',
            `${base} does not answer com.atproto.server.describeServer`,
            'The host is reachable but does not look like an atproto PDS.',
          );
        }
        throw err;
      }

      let version: string | null = null;
      try {
        version = (await getServerHealth(base)).version ?? null;
      } catch {
        // _health is a reference-implementation convenience; absence is normal.
      }

      let repoSample: Array<Record<string, unknown>> = [];
      let repoCursor: string | null = null;
      try {
        const page = await listRepos(base, { limit: 25 });
        repoSample = page.repos.map((r) => ({
          did: r.did,
          active: r.active ?? null,
          status: r.status ?? null,
        }));
        repoCursor = page.cursor ?? null;
      } catch {
        // Some hosts disable listRepos; the description alone still answers.
      }

      const hostname = pdsHostname(base);
      return {
        host: hostname,
        endpoint: base,
        description,
        version,
        repoSample,
        repoSampleCursor: repoCursor,
        links: {
          explore: exploreLink(`/pds/${encodeURIComponent(hostname)}`),
        },
      };
    }),
  );
}
