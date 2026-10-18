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
import { isoAgo, type CollectionOrder, type JustCount, type NsidCount } from '@/utils/ufos/config';
import { lexiconPathFor, publisherForNsid, schemaPathFor } from '@/utils/ufos/nsid';
import { lexiconAuthorityDomain, resolveLexiconDid } from '@/utils/atproto/spaceLexicon';
import { resolveHandle } from '@/utils/atproto/identity';
import { getRecordByUri, mapWithConcurrency } from '@/utils/atproto/slingshot';
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

/**
 * list_new_lexicons is a set difference UFOs cannot answer in one request:
 * the NSIDs active in a window, minus every NSID seen before it began. The
 * direct route pages both sides, and the "before" side is the network's whole
 * history. In October 2026 that was 34,764 NSIDs, 174 sequential pages and
 * 34s, past the tool budget on its own. So only the window is paged (7d was
 * 2,860 NSIDs in 15 pages, ~3s; 30d was 30 pages), NSIDs under the account
 * threshold are dropped, and /collections/stats is asked about the rest's
 * history before the window. Checked against a full two-sided scan of the
 * same window, this found the same 46 NSIDs, and its history check took
 * about a second.
 *
 * /collections pages only when `order` is absent, at most 200 per page. The
 * page cap is double what 30d needed; a window busier than that is refused
 * rather than answered from the first half of the alphabet.
 */
const NEW_LEXICONS_PAGE_SIZE = 200;
const NEW_LEXICONS_MAX_PAGES = 60;

/**
 * Collections per history request are bounded by URL length, not count:
 * valid NSIDs need no escaping but run to 317 characters, so a fixed count
 * of long ones could reach a length the server refuses, and one refused
 * batch fails the whole call. 2,000 characters fits about fifty typical
 * NSIDs. Four at a time because UFOs is run by a volunteer.
 */
const HISTORY_BATCH_CHARS = 2_000;
const HISTORY_CONCURRENCY = 4;

/**
 * /collections/stats defaults `since` to a week ago, so the history query
 * names a start explicitly. UFOs' rollups actually begin on 2025-04-12, the
 * first day /timeseries reports any app.bsky.feed.post activity; that date
 * is what "first seen" is relative to, and it goes in the result's note.
 */
const ALL_HISTORY_SINCE = '1970-01-01T00:00:00Z';
const UFOS_HISTORY_BEGINS = '2025-04-12';

function batchByLength(nsids: string[], maxChars: number): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const nsid of nsids) {
    const cost = nsid.length + '&collection='.length;
    if (current.length > 0 && chars + cost > maxChars) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(nsid);
    chars += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
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
      // No cursor, and that is upstream's rule rather than an omission: the
      // UFOs /collections endpoint answers `cursor` alongside `order` with
      // "`cursor` is mutually exclusive with `order`. ordered results cannot
      // be paged", and returns no cursor at all on an ordered response. This
      // is a ranked top-N; `limit` is the only way to widen it.
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
    'list_new_lexicons',
    {
      title: 'New lexicons',
      description:
        'You want what is new in the Atmosphere: lexicons (record types) UFOs saw for the first ' +
        'time in a window, used by at least minAccounts accounts. This answers "what launched this ' +
        'week?", which list_trending_lexicons cannot: established types fill its top-N. Most ' +
        'first-time NSIDs are one developer testing, which the account threshold filters out. ' +
        'Follow up with get_lexicon_schema to see who publishes one and sample_recent_records ' +
        'for what its records hold.',
      inputSchema: z.object({
        window: windowSchema,
        // The floor is 2, not 1, because the threshold also sets how many
        // NSIDs need a history request. In October 2026 a 30d window held
        // 5,953 active NSIDs, 1,460 of them with two or more accounts.
        minAccounts: z
          .number()
          .int()
          .min(2)
          .max(1000)
          .optional()
          .describe('Distinct accounts an NSID needs in the window. Default 3.'),
        limit: z.number().int().min(1).max(200).optional().describe('Default 50.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ window, minAccounts, limit }) => {
      const win: Window = window ?? '7d';
      const threshold = minAccounts ?? 3;
      const since = isoAgo(WINDOWS[win].hours);

      const active: NsidCount[] = [];
      let cursor: string | undefined;
      for (let page = 0; ; page++) {
        if (page === NEW_LEXICONS_MAX_PAGES) {
          throw new McpToolError(
            'invalid_parameter',
            `More than ${NEW_LEXICONS_MAX_PAGES * NEW_LEXICONS_PAGE_SIZE} lexicons were active in this window, more than one call can page`,
            'Use a shorter window.',
          );
        }
        const result = await fetchCollections({ cursor, since, limit: NEW_LEXICONS_PAGE_SIZE });
        if (result.failed) {
          throw new McpToolError(
            'upstream_error',
            'The UFOs lexicon-stats service is unavailable',
            'Safe to retry; if it persists, ufos-api.microcosm.blue is down.',
          );
        }
        active.push(...result.collections);
        if (!result.cursor) break;
        cursor = result.cursor;
      }

      // UFOs makes no promise that every collection it saw is a valid NSID,
      // and the follow-up tools reject ones that are not.
      const candidates = active.filter(
        (c) => (c.dids_estimate ?? 0) >= threshold && isValidNsid(c.nsid),
      );
      const history = await mapWithConcurrency(
        batchByLength(
          candidates.map((c) => c.nsid),
          HISTORY_BATCH_CHARS,
        ),
        HISTORY_CONCURRENCY,
        (batch) => fetchCollectionStatsResult({ collections: batch, since: ALL_HISTORY_SINCE, until: since }),
      );
      if (history.some((h) => h.failed)) {
        throw new McpToolError(
          'upstream_error',
          'The UFOs lexicon-stats service is unavailable',
          'Retry shortly; without their history, established lexicons would be reported as new.',
        );
      }

      // UFOs answers zeroes for an NSID it has never seen. One missing from
      // the answer altogether is unexplained, so it is not called new.
      const prior = new Map(history.flatMap((h) => [...h.stats]));
      const fresh = candidates
        .filter((c) => {
          const before = prior.get(c.nsid);
          return before !== undefined && !before.creates && !before.updates && !before.deletes && !before.dids_estimate;
        })
        .sort((a, b) => b.dids_estimate - a.dids_estimate || b.creates - a.creates || a.nsid.localeCompare(b.nsid));

      const max = limit ?? 50;
      return {
        window: win,
        since,
        minAccounts: threshold,
        activeInWindow: active.length,
        checked: candidates.length,
        count: fresh.length,
        truncated: fresh.length > max,
        lexicons: fresh.slice(0, max).map((c) => ({ nsid: c.nsid, ...counts(c) })),
        note:
          `New means UFOs recorded no activity for the NSID from the start of its history ` +
          `(${UFOS_HISTORY_BEGINS}) until the window began, so a lexicon idle since before then ` +
          'also counts. Account counts are estimates.',
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
