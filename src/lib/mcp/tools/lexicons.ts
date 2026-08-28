/**
 * Lexicon-ecosystem tools: what the network is doing beyond any one app,
 * via microcosm's UFOs API, plus published-schema lookup through the
 * standard `_lexicon` DNS authority method.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  fetchCollections,
  fetchCollectionStatsResult,
  fetchRecentRecordsResult,
  fetchTimeseries,
  searchLexiconsResult,
} from '@/utils/ufos/client';
import { WINDOWS, type Window } from '@/utils/ufos/windows';
import { isoAgo, type CollectionOrder, type JustCount } from '@/utils/ufos/config';
import { lexiconPathFor, publisherForNsid, schemaPathFor } from '@/utils/ufos/nsid';
import { lexiconAuthorityDomain, resolveLexiconDid } from '@/utils/atproto/spaceLexicon';
import { resolveHandle } from '@/utils/atproto/identity';
import { getRecordByUri } from '@/utils/atproto/slingshot';
import { getRecord as getPdsRecord } from '@/utils/atproto/pdsClient';
import { isValidNsid } from '@/utils/atproto/spaceUri';
import { toAtUri } from '@/utils/atproto/urls';
import { McpToolError } from '@/lib/mcp/errors';
import { resolveGuardedIdentity } from '@/lib/mcp/identityResolve';
import { toolHandler, exploreLink, recordLink, siteLink, READ_ONLY } from '@/lib/mcp/respond';

const SCHEMA_COLLECTION = 'com.atproto.lexicon.schema';
/** Serialized schema budget; whole lexicon documents can run to megabytes. */
const MAX_SCHEMA_BYTES = 48_000;

const nsidSchema = z
  .string()
  .min(1)
  .max(512)
  .describe('A collection NSID, e.g. app.bsky.feed.post or com.whtwnd.blog.entry.');

const windowSchema = z
  .enum(['1d', '7d', '30d'])
  .optional()
  .describe('Time window; default varies by tool.');

function assertNsid(nsid: string): void {
  if (!isValidNsid(nsid)) {
    throw new McpToolError(
      'invalid_parameter',
      `"${nsid}" is not a valid NSID`,
      'Expected a reverse-domain name like app.bsky.feed.post. search_lexicons finds NSIDs from free text.',
    );
  }
}

function counts(entry: JustCount) {
  return {
    creates: entry.creates ?? 0,
    updates: entry.updates ?? 0,
    deletes: entry.deletes ?? 0,
    didsEstimate: entry.dids_estimate ?? 0,
  };
}

export function registerLexiconTools(server: McpServer): void {
  server.registerTool(
    'list_trending_lexicons',
    {
      title: 'Trending lexicons',
      description:
        'You want the network pulse: which lexicons (record types, i.e. apps) saw the most ' +
        'activity in a window, ranked by records created or by distinct accounts. This is how you ' +
        'discover what exists in the Atmosphere beyond Bluesky; follow up with ' +
        'sample_recent_records on anything unfamiliar.',
      inputSchema: z.object({
        window: windowSchema,
        sort: z
          .enum(['records-created', 'dids-estimate'])
          .optional()
          .describe('Rank by record volume (default) or by distinct accounts.'),
        limit: z.number().int().min(1).max(50).optional().describe('Default 20.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ window, sort, limit }) => {
      const win: Window = window ?? '1d';
      const { collections, failed } = await fetchCollections({
        order: (sort ?? 'records-created') as CollectionOrder,
        since: isoAgo(WINDOWS[win].hours),
        limit: limit ?? 20,
      });
      if (failed) {
        throw new McpToolError(
          'upstream_error',
          'The UFOs lexicon-stats service is unavailable',
          'Safe to retry; if it persists, ufos-api.microcosm.blue is down.',
        );
      }
      return {
        window: win,
        sort: sort ?? 'records-created',
        lexicons: collections.map((c) => ({ nsid: c.nsid, ...counts(c) })),
        links: { explore: exploreLink('/lexicons') },
      };
    }),
  );

  server.registerTool(
    'get_lexicon_activity',
    {
      title: 'Activity for one lexicon',
      description:
        'You have an NSID and want its activity profile: creates/updates/deletes and distinct ' +
        'accounts over a window, with a time series showing whether it is growing, steady, or a ' +
        'spike. Use get_lexicon_schema for what the records mean, sample_recent_records for ' +
        'what they look like.',
      inputSchema: z.object({ nsid: nsidSchema, window: windowSchema }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ nsid, window }) => {
      assertNsid(nsid);
      const win: Window = window ?? '7d';
      const since = isoAgo(WINDOWS[win].hours);

      const [statsResult, timeseries] = await Promise.all([
        fetchCollectionStatsResult({ collections: [nsid], since }),
        fetchTimeseries({ collection: nsid, since, step: WINDOWS[win].step }),
      ]);
      if (statsResult.failed) {
        throw new McpToolError(
          'upstream_error',
          'The UFOs lexicon-stats service is unavailable',
          'Retry shortly; zeroes here would read as "this lexicon is idle", which is not what happened.',
        );
      }
      const entry = statsResult.stats.get(nsid) ?? null;
      const buckets = timeseries.series.get(nsid) ?? [];
      const series = timeseries.range.map((time, i) => ({
        time,
        ...(buckets[i] ? counts(buckets[i]) : { creates: 0, updates: 0, deletes: 0, didsEstimate: 0 }),
      }));

      return {
        nsid,
        window: win,
        stats: entry ? counts(entry) : null,
        series,
        links: {
          explore: siteLink(lexiconPathFor(nsid)),
          schema: siteLink(schemaPathFor(nsid)),
        },
      };
    }),
  );

  server.registerTool(
    'search_lexicons',
    {
      title: 'Find lexicons by name',
      description:
        'You have a word or fragment ("blog", "recipe", "leaflet") and want matching lexicon ' +
        'NSIDs with their activity counts — the way into a corner of the Atmosphere when you do ' +
        'not know its NSIDs yet. Zero matches on a sensible query genuinely means nothing is ' +
        'published under that name.',
      inputSchema: z.object({
        query: z.string().min(2).max(100).describe('Free text; at least two alphanumeric characters.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ query }) => {
      const { matches, failed } = await searchLexiconsResult(query);
      if (failed) {
        throw new McpToolError(
          'upstream_error',
          'The UFOs lexicon index is unavailable',
          'Retry shortly; an empty answer here would read as "nothing is published under that name", which is not what happened.',
        );
      }
      return {
        query,
        count: matches.length,
        matches: matches.map((m) => ({ nsid: m.nsid, ...counts(m) })),
        links: { explore: exploreLink('/lexicons') },
      };
    }),
  );

  server.registerTool(
    'sample_recent_records',
    {
      title: 'Recent records in a lexicon',
      description:
        'You want to see what activity in a lexicon actually looks like right now: the newest ' +
        'records network-wide in that collection, straight from the live stream sample, with full ' +
        'record values. The concrete follow-up to list_trending_lexicons. An empty result means ' +
        'the lexicon is currently quiet.',
      inputSchema: z.object({
        nsid: nsidSchema,
        limit: z.number().int().min(1).max(100).optional().describe('Default 10.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ nsid, limit }) => {
      assertNsid(nsid);
      const { records: all, failed } = await fetchRecentRecordsResult([nsid]);
      if (failed) {
        throw new McpToolError(
          'upstream_error',
          'The UFOs record sampler is unavailable',
          'Retry shortly; an empty answer here would read as "this lexicon is quiet", which is not what happened.',
        );
      }
      const max = limit ?? 10;
      const records = all.slice(0, max).map((r) => ({
        uri: toAtUri({ did: r.did, collection: r.collection, rkey: r.rkey }),
        did: r.did,
        rkey: r.rkey,
        seenAt: new Date(r.time_us / 1000).toISOString(),
        record: r.record,
        link: recordLink(r.did, r.collection, r.rkey),
      }));
      return {
        nsid,
        count: records.length,
        truncated: all.length > max,
        records,
        links: { explore: siteLink(lexiconPathFor(nsid)) },
      };
    }),
  );

  server.registerTool(
    'get_lexicon_schema',
    {
      title: 'Published schema for an NSID',
      description:
        'You have an NSID and want its published schema: the com.atproto.lexicon.schema record ' +
        'defining the type, found via the _lexicon DNS authority method (with the publisher-handle ' +
        'convention as fallback). Many older lexicons never published one — that answer is ' +
        'not_found with an explanation, not an error to retry.',
      inputSchema: z.object({ nsid: nsidSchema }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ nsid }) => {
      assertNsid(nsid);

      // Authority resolution: the DNS method is the spec; the reversed-NSID
      // handle convention catches publishers who registered the handle but
      // never added the TXT record.
      const domain = lexiconAuthorityDomain(nsid);
      let did = domain ? await resolveLexiconDid(domain) : null;
      let resolvedVia = did ? '_lexicon DNS' : null;
      if (!did) {
        did = await resolveHandle(publisherForNsid(nsid));
        if (did) resolvedVia = 'publisher handle convention';
      }
      if (!did) {
        throw new McpToolError(
          'not_found',
          `No authority found for ${nsid}`,
          `Neither a _lexicon TXT record on ${domain ?? 'its domain'} nor the handle ${publisherForNsid(nsid)} resolves; the publisher has not made this lexicon discoverable.`,
        );
      }

      const uri = toAtUri({ did, collection: SCHEMA_COLLECTION, rkey: nsid });
      let record = await getRecordByUri(uri);
      if (!record) {
        // Slingshot misses new or rarely-read records; the authority's own
        // PDS is the source of truth before declaring the schema unpublished.
        try {
          const bundle = await resolveGuardedIdentity(did);
          record = await getPdsRecord(bundle.pds, { repo: did, collection: SCHEMA_COLLECTION, rkey: nsid });
        } catch {
          record = null;
        }
      }
      if (!record) {
        throw new McpToolError(
          'not_found',
          `${did} is the authority for ${nsid} but has published no schema record`,
          'The lexicon works without one; sample_recent_records shows the shape in practice.',
        );
      }

      const serialized = JSON.stringify(record.value);
      const truncated = serialized.length > MAX_SCHEMA_BYTES;
      const value = truncated
        ? {
            id: (record.value as { id?: string }).id ?? nsid,
            defs: Object.keys((record.value as { defs?: Record<string, unknown> }).defs ?? {}),
          }
        : record.value;

      return {
        nsid,
        authorityDid: did,
        resolvedVia,
        uri: record.uri,
        cid: record.cid,
        truncated,
        ...(truncated ? { note: 'Schema too large to inline; defs lists its definitions. Fetch in full with get_record.' } : {}),
        value,
        links: {
          explore: siteLink(schemaPathFor(nsid)),
          aturi: recordLink(did, SCHEMA_COLLECTION, nsid),
        },
      };
    }),
  );
}
