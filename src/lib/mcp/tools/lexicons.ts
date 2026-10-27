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
import {
  findMovers,
  findNewLexicons,
  percentChange,
  sampleRecordAccounts,
  statsInBatches,
  UFOS_HISTORY_BEGINS,
  type Direction,
} from '@/lib/lexiconTrends';
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

function change(now: JustCount, before: JustCount) {
  return {
    creates: percentChange(now.creates ?? 0, before.creates ?? 0),
    didsEstimate: percentChange(now.dids_estimate ?? 0, before.dids_estimate ?? 0),
  };
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
        'activity in a window, ranked by records created or by distinct accounts. Set compare to ' +
        'add each one\'s counts in the window before (this week against last, for 7d) and the ' +
        'percent change. This is how you discover what exists in the Atmosphere beyond Bluesky; ' +
        'follow up with sample_recent_records on anything unfamiliar.',
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
        compare: z
          .boolean()
          .optional()
          .describe('Add counts for the previous window of the same length, and the change. Default false.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ window, sort, limit, compare }) => {
      const win: Window = window ?? '1d';
      const since = isoAgo(WINDOWS[win].hours);
      const { collections, failed } = await fetchCollections({
        order: (sort ?? 'records-created') as CollectionOrder,
        since,
        limit: limit ?? 20,
      });
      if (failed) {
        throw new McpToolError(
          'upstream_error',
          'The UFOs lexicon-stats service is unavailable',
          'Safe to retry; if it persists, ufos-api.microcosm.blue is down.',
        );
      }

      // The ranked listing reads low. In October 2026, 22 of the top 50 by
      // accounts over 7d were more than 1% under what /collections/stats and
      // the unordered listing both report for the same window, one by 32%,
      // and aligning the window to the hour or the day did not change that.
      // So the counts shown come from stats, the rows are re-sorted by them,
      // and the ranked listing only chooses which lexicons appear. Comparing
      // its numbers with stats for the window before would also have
      // invented changes.
      const previousSince = isoAgo(WINDOWS[win].hours * 2);
      const nsids = collections.map((c) => c.nsid);
      const [current, previous] = await Promise.all([
        statsInBatches(nsids, since),
        compare ? statsInBatches(nsids, previousSince, since) : null,
      ]);
      if (compare && (!current || !previous)) {
        throw new McpToolError(
          'upstream_error',
          'The UFOs lexicon-stats service is unavailable',
          'Retry shortly, or call without compare; a missing window would read as a change to or from zero.',
        );
      }
      const metric = sort === 'dids-estimate' ? 'dids_estimate' : 'creates';
      const rows = collections
        .map((c) => ({ nsid: c.nsid, now: current?.get(c.nsid) ?? c, before: previous?.get(c.nsid) }))
        .sort((a, b) => (b.now[metric] ?? 0) - (a.now[metric] ?? 0));
      const links = { explore: exploreLink('/lexicons') };

      if (!compare) {
        return {
          window: win,
          sort: sort ?? 'records-created',
          // Without stats the ranked listing is still a ranking, so this
          // answers with its numbers rather than failing a call that worked
          // before the correction existed.
          ...(current
            ? {}
            : { note: 'Counts are from the UFOs ranked listing, which can read low; /collections/stats did not answer.' }),
          lexicons: rows.map(({ nsid, now }) => ({ nsid, ...counts(now) })),
          links,
        };
      }
      return {
        window: win,
        sort: sort ?? 'records-created',
        comparedWith: { since: previousSince, until: since },
        lexicons: rows.map(({ nsid, now, before }) => ({
          nsid,
          ...counts(now),
          previous: before ? counts(before) : null,
          change: before ? change(now, before) : null,
        })),
        links,
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
        'first-time NSIDs are one developer testing, which the account threshold filters out; ' +
        'set sample to see how many accounts wrote each one\'s recent records. Follow up with ' +
        'get_lexicon_schema for who publishes one and sample_recent_records for its records.',
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
        sample: z
          .boolean()
          .optional()
          .describe('Count the accounts behind each result\'s recent records; one request per result. Default false.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ window, minAccounts, limit, sample }) => {
      const win: Window = window ?? '7d';
      const threshold = minAccounts ?? 3;
      const found = await findNewLexicons(win, threshold);
      const max = limit ?? 50;
      const shown = found.lexicons.slice(0, max);
      const samples = sample ? await sampleRecordAccounts(shown.map((c) => c.nsid)) : null;
      return {
        window: win,
        since: found.since,
        minAccounts: threshold,
        activeInWindow: found.activeInWindow,
        checked: found.checked,
        count: found.lexicons.length,
        truncated: found.lexicons.length > max,
        lexicons: shown.map((c) => ({
          nsid: c.nsid,
          ...counts(c),
          ...(samples ? { recentSample: samples.get(c.nsid) ?? null } : {}),
        })),
        note:
          'New means UFOs recorded no activity for the NSID from the start of its history ' +
          `(${UFOS_HISTORY_BEGINS}) until the window began, so a lexicon idle since before then ` +
          'also counts. Account counts are estimates.' +
          (samples
            ? ' recentSample counts the accounts behind the newest records UFOs keeps for each ' +
              'lexicon; one account behind all of them means concentrated activity, not ' +
              'necessarily a test. Null means the sample did not load.'
            : ''),
        links: { explore: exploreLink('/lexicons') },
      };
    }),
  );

  server.registerTool(
    'list_lexicon_movers',
    {
      title: 'Rising and falling lexicons',
      description:
        'You want what is growing or fading: lexicons whose account count rose or fell most ' +
        'against the window of the same length before (this week against last, for 7d), across ' +
        'every lexicon UFOs saw rather than a top-N. This finds an app taking off before it is ' +
        'big enough to trend. Lexicons with no accounts last window are left to ' +
        'list_new_lexicons. Follow up with get_lexicon_activity for the shape of a change.',
      inputSchema: z.object({
        window: windowSchema,
        direction: z.enum(['rising', 'falling']).optional().describe('Default rising.'),
        minAccounts: z
          .number()
          .int()
          .min(1)
          .max(100_000)
          .optional()
          .describe('Accounts a lexicon needs in the busier of the two windows. Default 10.'),
        limit: z.number().int().min(1).max(100).optional().describe('Default 25.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ window, direction, minAccounts, limit }) => {
      const win: Window = window ?? '7d';
      const dir: Direction = direction ?? 'rising';
      const threshold = minAccounts ?? 10;
      const found = await findMovers(win, dir, threshold);
      const max = limit ?? 25;
      return {
        window: win,
        direction: dir,
        minAccounts: threshold,
        since: found.since,
        comparedWith: { since: found.previousSince, until: found.since },
        activeInWindow: found.activeInWindow,
        activeInPreviousWindow: found.activeInPreviousWindow,
        ...(dir === 'rising' ? { absentLastWindow: found.absentLastWindow } : {}),
        count: found.movers.length,
        truncated: found.movers.length > max,
        lexicons: found.movers.slice(0, max).map(({ nsid, now, before }) => ({
          nsid,
          ...counts(now),
          previous: counts(before),
          change: change(now, before),
        })),
        note:
          `Ranked by (accounts now + ${threshold}) / (accounts before + ${threshold}), so a jump ` +
          'from 1 account to 12 does not outrank one from 46 to 1,144. Account counts are estimates.' +
          (dir === 'rising'
            ? ' absentLastWindow counts lexicons over the threshold now that had no accounts last ' +
              'window; list_new_lexicons says which of them are new.'
            : ''),
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
