/**
 * atpotato's tools: the atmosphere weather report and Poe's weekly dispatch.
 *
 * Both come from atpota.to, the studio aturi.to belongs to, and both are
 * public. The weather is atpotato's weather station, an always-on Jetstream
 * consumer that keeps a rolling sixty seconds of the whole firehose and writes
 * a row a minute; atpota.to/weather renders it from three JSON endpoints, and
 * those are what these tools read. sample_jetstream answers "what is being
 * written"; this answers "how much, and is that usual", which no bounded
 * sample can.
 *
 * The dispatch is site.standard.document records in atpota.to's own repo,
 * read from its PDS like any other repo here, so it needs nothing from
 * atpota.to's servers.
 *
 * The history and almanac endpoints answer raw counts and the seconds they
 * cover, never rates, because the page sums them. An agent should not be
 * doing that arithmetic, so these tools do it, with the page's own rules for
 * when a comparison is fair: the station has gaps, and a window it heard half
 * of, compared by count, reads as a collapse that never happened.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { upstreamFetch } from '@/utils/upstreamFetch';
import { readCappedJson } from '@/utils/cappedJson';
import { listRecordsPage, type AtRecord } from '@/utils/atproto/pdsClient';
import { McpToolError } from '@/lib/mcp/errors';
import { resolveGuardedIdentity } from '@/lib/mcp/identityResolve';
import { toolHandler, recordLink, READ_ONLY } from '@/lib/mcp/respond';

const ATPOTATO = 'https://atpota.to';
const WEATHER_PAGE = `${ATPOTATO}/weather`;

/** atpota.to's repo. It also holds the guides, which are documents but not the dispatch. */
const ATPOTATO_DID = 'did:plc:qntsxa2i4sb24noi45fx4np2';
const PUBLICATION_NSID = 'site.standard.publication';
const PUBLICATION_RKEY = '3myar4h4pls2n';
const DISPATCH_PUBLICATION = `at://${ATPOTATO_DID}/${PUBLICATION_NSID}/${PUBLICATION_RKEY}`;
const DOCUMENT_NSID = 'site.standard.document';
const BLOG_HOME = `${ATPOTATO}/blog`;
const LEAFLET_HOME = 'https://poe.leaflet.pub';
/**
 * One listRecords page, newest first. The dispatch is weekly and shares the
 * collection with a handful of guides, so a page holds about two years of it.
 */
const DOCUMENT_PAGE = 100;
/** An issue runs to a few thousand characters; this is room for a long one. */
const MAX_ISSUE_CHARS = 60_000;

/**
 * The page's scale, said once per answer so an agent can explain a reading
 * without guessing at it. Thresholds are atpota.to's (server/atmosphere.ts).
 */
const SCALE = {
  condition:
    'New records a second, every app: calm under 300, light from 300, breezy from 400, gusty from 500, ' +
    'stormy from 600. A usual afternoon is about 450.',
  diversityIndex:
    'The percent of new records written outside Bluesky’s lexicons (app.bsky.*, chat.bsky.*): low under 3, ' +
    'moderate from 3, high from 6, very high from 8, extreme from 11.',
} as const;

const RANGES = {
  hour: { bucket: 'minute', bucketSeconds: 60, spanSeconds: 3_600, earlier: 'the same hour a day earlier' },
  day: { bucket: 'hour', bucketSeconds: 3_600, spanSeconds: 86_400, earlier: 'the 24 hours before' },
  week: { bucket: 'hour', bucketSeconds: 3_600, spanSeconds: 7 * 86_400, earlier: 'the 7 days before' },
  month: { bucket: 'day', bucketSeconds: 86_400, spanSeconds: 30 * 86_400, earlier: 'the 30 days before' },
  // The shortest month, so a whole February is not mistaken for a partial one.
  year: { bucket: 'month', bucketSeconds: 28 * 86_400, spanSeconds: 366 * 86_400, earlier: 'the year before' },
} as const;

type Range = keyof typeof RANGES;

const COUNT_KEYS = [
  'creates', 'bluesky', 'elsewhere', 'posts', 'likes', 'reposts',
  'follows', 'updates', 'deletes', 'identity', 'account',
] as const;

type Counts = Record<(typeof COUNT_KEYS)[number], number> & { seconds: number };

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** A heat-map hour heard for less than this is too thin a sample to rank. */
const MIN_HOUR_SECONDS = 1_800;
const HOURS_LISTED = 5;

type Json = Record<string, unknown>;

function isObj(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function perSecond(count: number, seconds: number): number | null {
  return seconds > 0 ? round(count / seconds, 1) : null;
}

/** Percent of `part` in `whole`, two decimals: the index is often under one. */
function share(part: number, whole: number): number | null {
  return whole > 0 ? round((100 * part) / whole, 2) : null;
}

/** Each named field as a finite number, or null if any one is not. */
function numbers<K extends string>(value: unknown, keys: readonly K[]): Record<K, number> | null {
  if (!isObj(value)) return null;
  const out = {} as Record<K, number>;
  for (const key of keys) {
    const n = num(value[key]);
    if (n === null) return null;
    out[key] = n;
  }
  return out;
}

function countsOf(value: unknown): Counts | null {
  const c = numbers(value, [...COUNT_KEYS, 'seconds']);
  return c && c.seconds > 0 ? c : null;
}

async function readWeather(path: string): Promise<unknown> {
  const res = await upstreamFetch(`${ATPOTATO}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new McpToolError(
      'upstream_error',
      `atpota.to’s weather report answered HTTP ${res.status}`,
      `A 503 means neither the weather station nor its Jetstream fallback could be read. Retry in a minute; the same report is at ${WEATHER_PAGE}.`,
    );
  }
  return readCappedJson(res);
}

/** An IANA zone this runtime knows, mirroring the check atpota.to makes. */
function timeZoneOrThrow(raw: string | undefined): string {
  const tz = raw?.trim() || 'UTC';
  const shaped = tz.length <= 64 && /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz);
  try {
    if (shaped) {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    }
  } catch {
    // falls through to the refusal
  }
  throw new McpToolError(
    'invalid_parameter',
    `"${tz.slice(0, 64)}" is not a known IANA time zone`,
    'Pass a zone name like America/New_York or Europe/Berlin, or leave it out for UTC.',
  );
}

/**
 * The station's last sixty seconds, already rates. Known fields only, so the
 * result keeps one shape whatever atpota.to adds, and without the per-second
 * series, which is the page's sparkline rather than anything to reason over.
 * Two fields are renamed, because the page's `perSecond` and `bluesky` read
 * as everything rather than as Bluesky's own collections.
 */
function shapeNow(body: unknown): Json | null {
  if (!isObj(body) || !str(body.measuredAt) || !isObj(body.records) || num(body.records.perSecond) === null) {
    return null;
  }
  const out: Json = {
    measuredAt: body.measuredAt,
    source: body.source,
    seconds: body.seconds,
    window: body.window,
    condition: body.condition,
    records: body.records,
    diversity: body.diversity,
    blueskyPerSecond: body.perSecond,
    blueskyCollections: body.bluesky,
    apps: body.apps,
    events: body.events,
    accounts: body.accounts,
  };
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out;
}

/** The last hour against the same hour before, worded as the page words it. */
function againstUsual(normal: unknown): Json | null {
  if (!isObj(normal)) return null;
  const sums = ['seconds', 'posts', 'creates', 'elsewhere'] as const;
  const now = numbers(normal.now, sums);
  const days = numbers(normal.days, [...sums, 'windows']);
  const weeks = numbers(normal.weeks, [...sums, 'windows']);
  if (!now || !days || !weeks) return null;

  const lastHour = {
    heardSeconds: now.seconds,
    recordsPerSecond: perSecond(now.creates, now.seconds),
    diversityIndex: share(now.elsewhere, now.creates),
  };
  const listeningSince = str(normal.historyStart);
  // The same weekday once there is one to compare with, the same hour on the
  // days before until then; and nothing on less than half an hour of now.
  const basis = weeks.windows > 0 ? weeks : days.windows > 0 ? days : null;
  if (!basis || basis.seconds <= 0 || now.seconds < 1_800) {
    return {
      lastHour,
      verdict: null,
      note:
        'The station is still learning what usual looks like. After a day it compares with the same hour on ' +
        'earlier days, and after a week with the same weekday.',
      listeningSince,
    };
  }
  const ratio = now.creates / now.seconds / (basis.creates / basis.seconds);
  const verdict =
    ratio >= 1.25 ? 'much busier than usual'
      : ratio >= 1.08 ? 'busier than usual'
        : ratio <= 0.8 ? 'much quieter than usual'
          : ratio <= 0.93 ? 'quieter than usual'
            : 'about as busy as usual';
  return {
    lastHour,
    usual: {
      basis: basis === weeks ? 'the same hour on the same weekday, earlier weeks' : 'the same hour, earlier days',
      windows: basis.windows,
      recordsPerSecond: perSecond(basis.creates, basis.seconds),
      diversityIndex: share(basis.elsewhere, basis.creates),
    },
    changePercent: Math.round((ratio - 1) * 100),
    verdict,
    listeningSince,
  };
}

function shapeHours(heatmap: unknown): Json | null {
  if (!isObj(heatmap) || !Array.isArray(heatmap.cells)) return null;
  const hours = heatmap.cells
    .map((cell) => numbers(cell, ['dow', 'hour', 'seconds', 'posts', 'creates'] as const))
    .filter((c): c is NonNullable<typeof c> => c !== null && c.seconds >= MIN_HOUR_SECONDS && c.dow >= 1 && c.dow <= 7)
    .map((c) => ({
      weekday: WEEKDAYS[c.dow - 1],
      hour: c.hour,
      recordsPerSecond: perSecond(c.creates, c.seconds) ?? 0,
      postsPerSecond: perSecond(c.posts, c.seconds),
    }))
    .sort((a, b) => b.recordsPerSecond - a.recordsPerSecond);
  return {
    heardSeconds: num(heatmap.seconds),
    hoursHeard: hours.length,
    busiest: hours.slice(0, HOURS_LISTED),
    // From the hours left over, so a station that has heard only a few
    // does not list the same ones twice.
    quietest: hours.slice(Math.max(HOURS_LISTED, hours.length - HOURS_LISTED)).reverse(),
  };
}

function shapeAlmanac(body: unknown, timeZone: string): Json | null {
  if (!isObj(body)) return null;
  const out: Json = {};

  const today = numbers(body.today, ['seconds', 'posts', 'creates', 'elsewhere'] as const);
  if (today && isObj(body.today)) {
    const extreme = (x: unknown) => {
      const minute = isObj(x) ? str(x.minute) : null;
      const rate = isObj(x) ? num(x.perSecond) : null;
      return minute && rate !== null ? { minute, recordsPerSecond: rate } : null;
    };
    out.today = {
      since: str(body.today.start),
      heardSeconds: today.seconds,
      records: today.creates,
      posts: today.posts,
      recordsPerSecond: perSecond(today.creates, today.seconds),
      diversityIndex: share(today.elsewhere, today.creates),
      busiestMinute: extreme(body.today.high),
      quietestMinute: extreme(body.today.low),
    };
  }

  const usual = againstUsual(body.normal);
  if (usual) out.againstUsual = usual;

  if (isObj(body.newApps)) {
    const n = body.newApps;
    out.newApps = {
      warmingUp: n.warmingUp === true,
      // Until then every app is new to the station, so it names none.
      readyAt: str(n.readyAt),
      heardLast24Hours: num(n.heard),
      apps: (Array.isArray(n.apps) ? n.apps : []).flatMap((app) =>
        isObj(app) && str(app.domain) && num(app.creates) !== null
          ? [{ domain: app.domain, firstSeen: str(app.firstSeen), records: app.creates, collections: strings(app.collections) }]
          : [],
      ),
    };
  }

  const hours = shapeHours(body.heatmap);
  if (hours) out.hoursOfTheWeek = hours;

  return Object.keys(out).length ? { timeZone, ...out } : null;
}

/** Change in a rate, given both windows were heard well enough to compare. */
function changePercent(now: number, nowSeconds: number, before: number, beforeSeconds: number): number | null {
  if (before <= 0 || nowSeconds <= 0 || beforeSeconds <= 0) return null;
  return Math.round(((now / nowSeconds) / (before / beforeSeconds) - 1) * 100);
}

function shapeHistory(body: unknown, range: Range): Json | null {
  if (!isObj(body) || !Array.isArray(body.points)) return null;
  const total = countsOf(body.total);
  if (!total) return null;
  const { bucket, bucketSeconds, spanSeconds, earlier } = RANGES[range];

  const points = body.points.flatMap((p) => {
    const c = countsOf(p);
    const t = isObj(p) ? str(p.t) : null;
    return c && t ? [{ t, c }] : [];
  });
  const whole = points.filter(({ c }) => c.seconds >= bucketSeconds / 2);
  const byRate = [...whole].sort((a, b) => b.c.creates / b.c.seconds - a.c.creates / a.c.seconds);
  const extreme = (entry: (typeof points)[number] | undefined) =>
    entry ? { t: entry.t, recordsPerSecond: perSecond(entry.c.creates, entry.c.seconds) } : null;

  const average = Object.fromEntries(COUNT_KEYS.map((k) => [k, perSecond(total[k], total.seconds)]));

  const out: Json = {
    range,
    bucket,
    coverage: {
      heardSeconds: total.seconds,
      rangeSeconds: spanSeconds,
      percent: Math.min(100, Math.round((100 * total.seconds) / spanSeconds)),
    },
    totals: Object.fromEntries(COUNT_KEYS.map((k) => [k, total[k]])),
    averagePerSecond: average,
    diversityIndex: share(total.elsewhere, total.creates),
    busiest: extreme(byRate[0]),
    quietest: extreme(byRate[byRate.length - 1]),
    points: points.map(({ t, c }) => ({
      t,
      seconds: c.seconds,
      recordsPerSecond: perSecond(c.creates, c.seconds),
      postsPerSecond: perSecond(c.posts, c.seconds),
      diversityIndex: share(c.elsewhere, c.creates),
    })),
  };

  // Records compare as rates, and only when the earlier window was heard at
  // least half as well; the page holds itself to the same rule.
  const compare = numbers(body.compare, ['seconds', 'prevSeconds'] as const);
  if (compare && Array.isArray(body.apps)) {
    const fair = compare.seconds > 0 && compare.prevSeconds >= compare.seconds * 0.5;
    out.apps = {
      comparedWith: earlier,
      heardSeconds: compare.seconds,
      earlierHeardSeconds: compare.prevSeconds,
      comparable: fair,
      busiest: body.apps.flatMap((app) => {
        const c = numbers(app, ['creates', 'prevCreates'] as const);
        if (!c || !isObj(app) || !str(app.domain)) return [];
        return [{
          domain: app.domain,
          records: c.creates,
          recordsPerSecond: perSecond(c.creates, compare.seconds),
          earlierRecords: c.prevCreates,
          changePercent: fair ? changePercent(c.creates, compare.seconds, c.prevCreates, compare.prevSeconds) : null,
          ...(fair && c.prevCreates === 0 ? { new: true } : {}),
          collections: strings(app.collections),
        }];
      }),
    };
  }

  if (isObj(body.appsOverTime) && Array.isArray(body.appsOverTime.points)) {
    out.appsHeard = body.appsOverTime.points.flatMap((p) =>
      isObj(p) && str(p.t) && num(p.apps) !== null ? [{ t: p.t, apps: p.apps }] : [],
    );
  }

  // Accounts are distinct counts, which do not scale with time, so the page
  // only compares them when both windows were heard within a tenth of each
  // other. Same rule here.
  const accounts = isObj(body.accounts) ? body.accounts : null;
  const heard = numbers(accounts, ['seconds', 'prevSeconds'] as const);
  const accountTotal = numbers(accounts?.total, ['active', 'bluesky', 'elsewhere'] as const);
  if (accounts && heard && accountTotal) {
    const fair = heard.seconds > 0 && heard.prevSeconds >= heard.seconds * 0.9 && heard.prevSeconds <= heard.seconds * 1.1;
    out.accounts = {
      heardSeconds: heard.seconds,
      earlierHeardSeconds: heard.prevSeconds,
      comparable: fair,
      ...accountTotal,
      diversityIndex: share(accountTotal.elsewhere, accountTotal.active),
      points: (Array.isArray(accounts.points) ? accounts.points : []).flatMap((p) => {
        const c = numbers(p, ['seconds', 'active'] as const);
        return c && isObj(p) && str(p.t) ? [{ t: p.t, seconds: c.seconds, active: c.active }] : [];
      }),
      busiestApps: (Array.isArray(accounts.apps) ? accounts.apps : []).flatMap((app) => {
        const c = numbers(app, ['active', 'prevActive'] as const);
        if (!c || !isObj(app) || !str(app.domain)) return [];
        return [{
          domain: app.domain,
          accounts: c.active,
          earlierAccounts: c.prevActive,
          changePercent: fair && c.prevActive > 0 ? Math.round((c.active / c.prevActive - 1) * 100) : null,
          ...(fair && c.prevActive === 0 ? { new: true } : {}),
          collections: strings(app.collections),
        }];
      }),
    };
  }

  return out;
}

type Issue = {
  title: string;
  description: string | null;
  publishedAt: string;
  updatedAt: string | null;
  tags: string[];
  uri: string;
  rkey: string;
  path: string;
  text: string | null;
};

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** "/my-issue/" -> "/my-issue"; the record key when the path is unusable, as the blog does. */
function issuePath(value: unknown, rkey: string): string {
  if (typeof value === 'string') {
    let p = value.trim().replace(/\/+$/, '');
    if (p && !p.startsWith('/')) p = `/${p}`;
    if (/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,500}$/.test(p) && !p.includes('//') && !/(^|\/)\.\.?(\/|$)/.test(p)) {
      return p;
    }
  }
  return `/${rkey}`;
}

/**
 * The dispatch's published issues, newest first. Only documents whose `site`
 * is the dispatch belong to it, and one dated in the future waits, as it does
 * on the blog, so a scheduled issue is not read out early.
 */
function parseIssues(records: AtRecord[], now: number): Issue[] {
  const prefix = `at://${ATPOTATO_DID}/${DOCUMENT_NSID}/`;
  const issues: Issue[] = [];
  for (const record of records) {
    const v = record?.value;
    if (!isObj(v) || v.site !== DISPATCH_PUBLICATION || typeof record.uri !== 'string') continue;
    if (!record.uri.startsWith(prefix)) continue;
    const rkey = record.uri.slice(prefix.length);
    const title = str(v.title);
    const publishedAt = isoDate(v.publishedAt);
    if (!rkey || !title || !publishedAt || Date.parse(publishedAt) > now) continue;
    issues.push({
      title: title.trim(),
      description: str(v.description)?.trim() ?? null,
      publishedAt,
      updatedAt: isoDate(v.updatedAt),
      tags: strings(v.tags),
      uri: record.uri,
      rkey,
      path: issuePath(v.path, rkey),
      text: str(v.textContent),
    });
  }
  return issues.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

function issueLinks(issue: Issue) {
  return {
    blog: `${BLOG_HOME}${issue.path}`,
    leaflet: `${LEAFLET_HOME}${issue.path}`,
    explorer: recordLink(ATPOTATO_DID, DOCUMENT_NSID, issue.rkey),
  };
}

/** The issue a link, at:// URI or record key names; "latest" or nothing is the newest. */
function findIssue(issues: Issue[], wanted: string | undefined): Issue | null {
  const value = (wanted ?? '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (!value || value.toLowerCase() === 'latest') return issues[0] ?? null;
  if (value.startsWith('at://')) return issues.find((i) => i.uri === value) ?? null;
  const bare = value.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return (
    issues.find((issue) => {
      const { blog, leaflet } = issueLinks(issue);
      return (
        bare === issue.rkey ||
        bare === blog.replace(/^https:\/\//, '') ||
        bare === leaflet.replace(/^https:\/\//, '') ||
        bare.endsWith(`/${issue.rkey}`)
      );
    }) ?? null
  );
}

export function registerAtpotatoTools(server: McpServer): void {
  server.registerTool(
    'get_atmosphere_weather',
    {
      title: 'Atmosphere weather report',
      description:
        'You want how busy the Atmosphere is right now. atpotato’s weather station counts every record on the ' +
        'firehose; this returns its last 60 seconds (a condition from calm to stormy, records a second, the ' +
        'diversity index: the share written by apps other than Bluesky, the busiest of those apps, active ' +
        'accounts) and today’s almanac in a time zone: high and low, the last hour against usual, apps heard ' +
        'for the first time, the busiest hours of the week. For trends over a range, get_weather_history.',
      inputSchema: z.object({
        timeZone: z
          .string()
          .max(64)
          .optional()
          .describe('IANA time zone for the almanac’s "today" and its hours of the week, e.g. America/New_York. Default UTC.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ timeZone }) => {
      const tz = timeZoneOrThrow(timeZone);
      const [now, almanac] = await Promise.allSettled([
        readWeather('/api/atmosphere'),
        readWeather(`/api/weather-almanac?${new URLSearchParams({ tz })}`),
      ]);
      // Each half answers on its own, as on the page: a station that is down
      // still leaves the almanac's history, and the reverse.
      const reading = now.status === 'fulfilled' ? shapeNow(now.value) : null;
      const book = almanac.status === 'fulfilled' ? shapeAlmanac(almanac.value, tz) : null;
      if (!reading && !book) {
        throw new McpToolError(
          'upstream_error',
          'atpota.to’s weather report is unavailable',
          `Retry in a minute; the same report is at ${WEATHER_PAGE}.`,
        );
      }
      const unavailable = [...(reading ? [] : ['now']), ...(book ? [] : ['almanac'])];
      return {
        ...(reading ? { now: reading } : {}),
        ...(book ? { almanac: book } : {}),
        ...(unavailable.length ? { unavailable } : {}),
        scale: SCALE,
        links: { report: WEATHER_PAGE },
      };
    }),
  );

  server.registerTool(
    'get_weather_history',
    {
      title: 'Atmosphere weather history',
      description:
        'You want how the Atmosphere’s activity has moved over the last hour, day, week, month or year, from ' +
        'atpotato’s weather station. Returns records a second and the diversity index per bucket with the ' +
        'range’s average, busiest and quietest buckets, the busiest apps outside Bluesky against the window ' +
        'before, apps heard per bucket, and active accounts. Check coverage first: the station has gaps, and a ' +
        'range it heard little of says less. For right now, get_atmosphere_weather.',
      inputSchema: z.object({
        range: z
          .enum(['hour', 'day', 'week', 'month', 'year'])
          .optional()
          .describe('hour: a point a minute; day and week: a point an hour; month: a day; year: a month. Default day.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ range }) => {
      const chosen: Range = range ?? 'day';
      const body = await readWeather(`/api/weather-history?${new URLSearchParams({ range: chosen })}`);
      const history = shapeHistory(body, chosen);
      if (!history) {
        throw new McpToolError(
          'upstream_error',
          'atpota.to’s weather history answered in an unexpected shape',
          `Retry shortly; the same trends are at ${WEATHER_PAGE}.`,
        );
      }
      return { ...history, scale: SCALE, links: { report: WEATHER_PAGE } };
    }),
  );

  server.registerTool(
    'read_atmosphere_dispatch',
    {
      title: 'Poe’s atmosphere dispatch',
      description:
        'You want what happened in the Atmosphere lately as a person would tell it: poe’s atmosphere ' +
        'dispatch, the weekly roundup atpotato’s potato writes of what builders shipped, argued about and ' +
        'launched. Lists the newest issues with dates, summaries and links, plus the full text of one (the ' +
        'latest unless you name another). Read an issue before saying what is in it, and link it with the URLs ' +
        'returned.',
      inputSchema: z.object({
        issue: z
          .string()
          .max(600)
          .optional()
          .describe('"latest" (the default), or an issue’s link on atpota.to/blog or poe.leaflet.pub, its at:// URI, or its record key.'),
        limit: z.number().int().min(1).max(25).optional().describe('How many of the newest issues to list. Default 5.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ issue, limit }) => {
      const { did, pds } = await resolveGuardedIdentity(ATPOTATO_DID);
      const page = await listRecordsPage(pds, { repo: did, collection: DOCUMENT_NSID, limit: DOCUMENT_PAGE });
      const issues = parseIssues(Array.isArray(page?.records) ? page.records : [], Date.now());
      if (!issues.length) {
        throw new McpToolError(
          'not_found',
          'No published issues of the dispatch were found',
          `atpota.to’s repo answered with none; ${BLOG_HOME} reads the same records.`,
        );
      }
      const chosen = findIssue(issues, issue);
      if (!chosen) {
        throw new McpToolError(
          'not_found',
          'That is not one of the dispatch’s issues',
          'Call without `issue` to list them, then pass one of their links, at:// URIs or record keys.',
        );
      }
      const text = chosen.text ?? chosen.description ?? '';
      return {
        publication: {
          name: 'poe’s atmosphere dispatch',
          author: 'poe.atpota.to',
          uri: DISPATCH_PUBLICATION,
          links: {
            blog: BLOG_HOME,
            leaflet: LEAFLET_HOME,
            feed: `${BLOG_HOME}/feed.xml`,
            explorer: recordLink(ATPOTATO_DID, PUBLICATION_NSID, PUBLICATION_RKEY),
          },
        },
        issues: issues.slice(0, limit ?? 5).map((i) => ({
          title: i.title,
          description: i.description,
          publishedAt: i.publishedAt,
          tags: i.tags,
          uri: i.uri,
          links: issueLinks(i),
        })),
        issue: {
          title: chosen.title,
          description: chosen.description,
          publishedAt: chosen.publishedAt,
          updatedAt: chosen.updatedAt,
          tags: chosen.tags,
          uri: chosen.uri,
          links: issueLinks(chosen),
          text: text.slice(0, MAX_ISSUE_CHARS),
          ...(text.length > MAX_ISSUE_CHARS ? { truncated: true } : {}),
        },
      };
    }),
  );
}
