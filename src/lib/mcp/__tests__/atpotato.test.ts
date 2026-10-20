import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAtpotatoTools } from '@/lib/mcp/tools/atpotato';
import {
  captureRegistrations,
  resultBody,
  MAX_DESCRIPTION_LENGTH,
} from '@/lib/mcp/__tests__/harness';

const { tools } = captureRegistrations(registerAtpotatoTools);
const weather = tools.get('get_atmosphere_weather')!;
const history = tools.get('get_weather_history')!;
const dispatch = tools.get('read_atmosphere_dispatch')!;

const ATPOTATO_DID = 'did:plc:qntsxa2i4sb24noi45fx4np2';
const PUBLICATION = `at://${ATPOTATO_DID}/site.standard.publication/3myar4h4pls2n`;

type Route = (url: string) => unknown;

/**
 * Answer each request by URL. A route returning a number answers with that
 * status and no body; anything unrouted fails the test, so a tool cannot
 * quietly start calling somewhere new.
 */
async function withFetch<T>(route: Route, run: (calls: string[]) => Promise<T>): Promise<T> {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const answer = route(url);
    if (answer === undefined) throw new Error(`unrouted fetch: ${url}`);
    if (typeof answer === 'number') return new Response(null, { status: answer });
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const READING = {
  measuredAt: '2026-10-20T22:00:06.000Z',
  seconds: 60,
  perSecond: { posts: 45.9, likes: 304.7, reposts: 53.2, follows: 28.9 },
  condition: 'breezy',
  records: { perSecond: 440.7, bluesky: 439.6, elsewhere: 1.1 },
  diversity: { index: 0.26, apps: 18, collections: 40, level: 'low' },
  apps: [{ domain: 'stream.place', perSecond: 0.2, count: 10, collections: ['place.stream.chat.message'] }],
  bluesky: [{ nsid: 'app.bsky.feed.like', perSecond: 304.7, count: 18280 }],
  events: { creates: 431, updates: 2.3, deletes: 50, identity: 0.3, account: 0.4 },
  source: 'station',
  window: { from: '2026-10-20T21:59:06.000Z', to: '2026-10-20T22:00:06.000Z' },
  series: [{ t: 1792533703, creates: 403, bluesky: 403, elsewhere: 0, posts: 38 }],
};

const sums = (seconds: number, creates: number, extra: Record<string, number> = {}) => ({
  seconds,
  posts: creates / 10,
  creates,
  elsewhere: creates / 100,
  ...extra,
});

const ALMANAC = {
  tz: 'America/New_York',
  today: {
    start: '2026-10-20T04:00:00.000Z',
    seconds: 3600,
    posts: 180_000,
    creates: 1_800_000,
    elsewhere: 9_000,
    high: { minute: '2026-10-20T19:04:00.000Z', perSecond: 509.8 },
    low: { minute: '2026-10-20T18:53:00.000Z', perSecond: 378.5 },
  },
  normal: {
    historyStart: '2026-10-01T00:00:00.000Z',
    // 500 a second now against 400 usual: a quarter busier.
    now: sums(3600, 1_800_000),
    days: sums(7200, 2_880_000, { windows: 2 }),
    weeks: sums(3600, 1_440_000, { windows: 1 }),
  },
  newApps: {
    historyStart: '2026-10-01T00:00:00.000Z',
    readyAt: '2026-10-08T00:00:00.000Z',
    warmingUp: false,
    heard: 160,
    apps: [{ domain: 'zelk.space', firstSeen: '2026-10-20T12:00:00.000Z', creates: 42, collections: ['space.zelk.tv.watched'] }],
  },
  heatmap: {
    seconds: 10_800,
    cells: [
      { dow: 2, hour: 16, seconds: 600, posts: 99_999, creates: 9_999_999 },
      { dow: 2, hour: 17, seconds: 3600, posts: 180_000, creates: 1_440_000 },
      { dow: 2, hour: 18, seconds: 3600, posts: 180_000, creates: 1_800_000 },
    ],
  },
};

test('registers exactly the atpotato tools', () => {
  assert.deepEqual([...tools.keys()], ['get_atmosphere_weather', 'get_weather_history', 'read_atmosphere_dispatch']);
});

test('each tool carries a title, a bounded description, and read-only annotations', () => {
  for (const tool of tools.values()) {
    assert.ok(tool.config.title, `${tool.name} has no title`);
    assert.ok((tool.config.description ?? '').length <= MAX_DESCRIPTION_LENGTH, `${tool.name} description is too long`);
    assert.equal(tool.config.annotations?.readOnlyHint, true);
    assert.equal(tool.config.annotations?.openWorldHint, true);
  }
});

test('schemas bound their inputs', () => {
  assert.equal(history.config.inputSchema!.safeParse({ range: 'decade' }).success, false);
  assert.equal(history.config.inputSchema!.safeParse({ range: 'week' }).success, true);
  assert.equal(dispatch.config.inputSchema!.safeParse({ limit: 26 }).success, false);
  assert.equal(dispatch.config.inputSchema!.safeParse({ issue: 'latest', limit: 3 }).success, true);
  assert.equal(weather.config.inputSchema!.safeParse({ timeZone: 'x'.repeat(65) }).success, false);
});

test('an unknown time zone answers invalid_parameter before anything is fetched', async () => {
  await withFetch(() => undefined, async (calls) => {
    const result = await weather.handler({ timeZone: 'Mars/Olympus_Mons' });
    assert.equal(result.isError, true);
    assert.equal(resultBody(result).code, 'invalid_parameter');
    assert.equal(calls.length, 0);
  });
});

test('the weather report pairs the live reading with the almanac', async () => {
  const body = await withFetch(
    (url) => (url.includes('/api/atmosphere') ? READING : url.includes('/api/weather-almanac') ? ALMANAC : undefined),
    async (calls) => {
      const result = await weather.handler({ timeZone: 'America/New_York' });
      assert.ok(!result.isError);
      assert.ok(calls.some((c) => c.endsWith('/api/weather-almanac?tz=America%2FNew_York')));
      return resultBody(result);
    },
  );

  const now = body.now as Record<string, unknown>;
  assert.equal(now.condition, 'breezy');
  // The page's names read as everything; these are Bluesky's own.
  assert.deepEqual(now.blueskyPerSecond, READING.perSecond);
  assert.deepEqual(now.blueskyCollections, READING.bluesky);
  assert.equal('series' in now, false, 'the sparkline series is the page’s, not the agent’s');

  const almanac = body.almanac as Record<string, Record<string, unknown>>;
  assert.equal(almanac.timeZone, 'America/New_York');
  assert.equal(almanac.today.recordsPerSecond, 500);
  assert.deepEqual(almanac.today.busiestMinute, { minute: '2026-10-20T19:04:00.000Z', recordsPerSecond: 509.8 });

  // The same weekday wins over the days before once there is one.
  const usual = almanac.againstUsual as Record<string, unknown>;
  assert.equal((usual.usual as Record<string, unknown>).recordsPerSecond, 400);
  assert.equal(usual.changePercent, 25);
  assert.equal(usual.verdict, 'much busier than usual');

  // A ten-minute hour is too thin to rank, however busy it looked.
  const hours = almanac.hoursOfTheWeek as Record<string, unknown>;
  assert.equal(hours.hoursHeard, 2);
  assert.deepEqual((hours.busiest as Array<Record<string, unknown>>)[0], {
    weekday: 'tuesday',
    hour: 18,
    recordsPerSecond: 500,
    postsPerSecond: 50,
  });
  assert.ok(body.scale);
  assert.equal(body.unavailable, undefined);
});

test('a station with no history yet says so rather than inventing a usual', async () => {
  const almanac = {
    ...ALMANAC,
    normal: { ...ALMANAC.normal, days: sums(0, 0, { windows: 0 }), weeks: sums(0, 0, { windows: 0 }) },
  };
  const body = await withFetch(
    (url) => (url.includes('/api/atmosphere') ? READING : url.includes('/api/weather-almanac') ? almanac : undefined),
    async () => resultBody(await weather.handler({})),
  );
  const usual = (body.almanac as Record<string, Record<string, unknown>>).againstUsual;
  assert.equal(usual.verdict, null);
  assert.match(String(usual.note), /still learning/);
});

test('one half failing still answers with the other, and names what is missing', async () => {
  const body = await withFetch(
    (url) => (url.includes('/api/atmosphere') ? READING : url.includes('/api/weather-almanac') ? 503 : undefined),
    async () => resultBody(await weather.handler({})),
  );
  assert.ok(body.now);
  assert.equal(body.almanac, undefined);
  assert.deepEqual(body.unavailable, ['almanac']);
});

test('both halves failing is an upstream_error', async () => {
  const result = await withFetch(
    (url) => (url.includes('atpota.to/api/') ? 503 : undefined),
    () => weather.handler({}),
  );
  assert.equal(result.isError, true);
  assert.equal(resultBody(result).code, 'upstream_error');
});

const point = (t: string, seconds: number, creates: number) => ({
  t,
  seconds,
  creates,
  bluesky: creates - creates / 100,
  elsewhere: creates / 100,
  posts: creates / 10,
  likes: 0,
  reposts: 0,
  follows: 0,
  updates: 0,
  deletes: 0,
  identity: 0,
  account: 0,
});

function historyBody(compare: { seconds: number; prevSeconds: number }, accountsPrev: number) {
  return {
    range: 'day',
    points: [
      point('2026-10-20T16:00:00.000Z', 600, 9_000_000),
      point('2026-10-20T17:00:00.000Z', 3600, 1_800_000),
      point('2026-10-20T18:00:00.000Z', 3600, 1_440_000),
    ],
    total: point('2026-10-20T19:00:00.000Z', 7800, 12_240_000),
    apps: [
      { domain: 'zelk.space', creates: 7200, prevCreates: 1800, collections: ['space.zelk.tv.watched'] },
      { domain: 'standard.site', creates: 3600, prevCreates: 0, collections: ['site.standard.document'] },
    ],
    compare: { ...compare, lagMs: 86_400_000 },
    appsOverTime: { bucket: 'hour', points: [{ t: '2026-10-20T17:00:00.000Z', apps: 90 }] },
    accounts: {
      seconds: 3600,
      prevSeconds: accountsPrev,
      total: { active: 132_601, bluesky: 132_336, elsewhere: 423 },
      points: [{ t: '2026-10-20T17:00:00.000Z', seconds: 3600, active: 132_601, bluesky: 132_336, elsewhere: 423 }],
      apps: [{ domain: 'sprk.so', active: 80, prevActive: 40, collections: ['so.sprk.feed.post'] }],
    },
  };
}

test('history answers rates, and ranks only buckets the station mostly heard', async () => {
  const body = await withFetch(
    (url) => (url.includes('/api/weather-history?range=day') ? historyBody({ seconds: 7200, prevSeconds: 3600 }, 3600) : undefined),
    async () => resultBody(await history.handler({})),
  );
  assert.equal(body.range, 'day');
  assert.equal(body.bucket, 'hour');
  assert.deepEqual(body.coverage, { heardSeconds: 7800, rangeSeconds: 86_400, percent: 9 });
  assert.equal((body.averagePerSecond as Record<string, number>).creates, 1569.2);
  assert.equal(body.diversityIndex, 1);
  // The ten-minute bucket is the fastest by rate and is still not the busiest.
  assert.deepEqual(body.busiest, { t: '2026-10-20T17:00:00.000Z', recordsPerSecond: 500 });
  assert.deepEqual(body.quietest, { t: '2026-10-20T18:00:00.000Z', recordsPerSecond: 400 });
  assert.equal((body.points as unknown[]).length, 3);
});

test('apps compare by rate, so an earlier window heard for half as long is not a doubling', async () => {
  const body = await withFetch(
    (url) => (url.includes('/api/weather-history') ? historyBody({ seconds: 7200, prevSeconds: 3600 }, 3600) : undefined),
    async () => resultBody(await history.handler({ range: 'day' })),
  );
  const apps = body.apps as { comparable: boolean; busiest: Array<Record<string, unknown>> };
  assert.equal(apps.comparable, true);
  // 7200 over 2h is 1/s; 1800 over 1h is 0.5/s: double, where counts say quadruple.
  assert.equal(apps.busiest[0].changePercent, 100);
  assert.equal(apps.busiest[1].new, true);
  assert.equal(apps.busiest[1].changePercent, null);

  const accounts = body.accounts as { comparable: boolean; busiestApps: Array<Record<string, unknown>>; diversityIndex: number };
  assert.equal(accounts.comparable, true);
  assert.equal(accounts.busiestApps[0].changePercent, 100);
  assert.equal(accounts.diversityIndex, 0.32);
});

test('an earlier window the station barely heard compares nothing', async () => {
  const body = await withFetch(
    (url) => (url.includes('/api/weather-history') ? historyBody({ seconds: 7200, prevSeconds: 0 }, 1200) : undefined),
    async () => resultBody(await history.handler({ range: 'day' })),
  );
  const apps = body.apps as { comparable: boolean; busiest: Array<Record<string, unknown>> };
  assert.equal(apps.comparable, false);
  for (const app of apps.busiest) {
    assert.equal(app.changePercent, null);
    assert.equal(app.new, undefined, 'none in a window nobody heard is not new');
  }
  const accounts = body.accounts as { comparable: boolean; busiestApps: Array<Record<string, unknown>> };
  assert.equal(accounts.comparable, false);
  assert.equal(accounts.busiestApps[0].changePercent, null);
});

test('a history body without points is an upstream_error, not an empty trend', async () => {
  const result = await withFetch(
    (url) => (url.includes('/api/weather-history') ? { range: 'day' } : undefined),
    () => history.handler({}),
  );
  assert.equal(result.isError, true);
  assert.equal(resultBody(result).code, 'upstream_error');
});

/**
 * atpota.to's repo, served from an IP-literal PDS so the SSRF guard has
 * nothing to look up and the test needs no DNS.
 */
const PDS = 'https://8.8.8.8';

function doc(rkey: string, value: Record<string, unknown>) {
  return { uri: `at://${ATPOTATO_DID}/site.standard.document/${rkey}`, cid: 'bafy', value };
}

const RECORDS = [
  doc('3zzzfuture', { site: PUBLICATION, title: 'not yet', publishedAt: '2999-01-01T00:00:00.000Z', path: '/3zzzfuture' }),
  doc('3lrdzen52y224', {
    site: `at://${ATPOTATO_DID}/site.standard.publication/3lrdzen52y223`,
    title: 'How to use Bluesky to grow your brand',
    publishedAt: '2025-06-11T18:17:59.000Z',
  }),
  doc('3myasnk4bzk22', {
    site: PUBLICATION,
    title: 'attie sites, spaces near beta, and a brand new cow',
    description: 'bluesky widened attie into a site builder.',
    publishedAt: '2026-10-19T19:02:15.894Z',
    path: '/3myasnk4bzk22',
    tags: ['atmosphere', 'dispatch'],
    textContent: 'welcome to the first issue of poe’s atmosphere dispatch!',
  }),
  doc('3myaaaaaaaaa2', {
    site: PUBLICATION,
    title: 'an older issue',
    publishedAt: '2026-10-12T19:00:00.000Z',
    path: 'older-issue/',
    textContent: 'last week',
  }),
];

function dispatchRoute(url: string): unknown {
  if (decodeURIComponent(url) === `https://plc.directory/${ATPOTATO_DID}`) {
    return {
      id: ATPOTATO_DID,
      alsoKnownAs: ['at://atpota.to'],
      service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
    };
  }
  if (url.startsWith(`${PDS}/xrpc/com.atproto.repo.listRecords`)) return { records: RECORDS };
  return undefined;
}

test('the dispatch lists only its own published issues, newest first, and reads the latest', async () => {
  const body = await withFetch(dispatchRoute, async (calls) => {
    const result = await dispatch.handler({});
    assert.ok(!result.isError, JSON.stringify(resultBody(result)));
    assert.ok(calls.some((c) => c.includes(`repo=${encodeURIComponent(ATPOTATO_DID)}`) && c.includes('collection=site.standard.document')));
    return resultBody(result);
  });
  const issues = body.issues as Array<Record<string, unknown>>;
  // Not the guide, which shares the collection, and not the scheduled issue.
  assert.deepEqual(issues.map((i) => i.title), ['attie sites, spaces near beta, and a brand new cow', 'an older issue']);
  const issue = body.issue as Record<string, unknown>;
  assert.equal(issue.text, 'welcome to the first issue of poe’s atmosphere dispatch!');
  assert.deepEqual((issue.links as Record<string, string>).blog, 'https://atpota.to/blog/3myasnk4bzk22');
  assert.deepEqual((issue.links as Record<string, string>).leaflet, 'https://poe.leaflet.pub/3myasnk4bzk22');
  assert.match((issue.links as Record<string, string>).explorer, /\/profile\/did(%3A|:)plc(%3A|:)qntsxa2i4sb24noi45fx4np2\/site\.standard\.document\/3myasnk4bzk22$/);
});

test('an issue can be named by any link to it', async () => {
  for (const wanted of [
    'https://atpota.to/blog/older-issue/',
    'poe.leaflet.pub/older-issue',
    `at://${ATPOTATO_DID}/site.standard.document/3myaaaaaaaaa2`,
    '3myaaaaaaaaa2',
  ]) {
    const body = await withFetch(dispatchRoute, async () => resultBody(await dispatch.handler({ issue: wanted })));
    assert.equal((body.issue as Record<string, unknown>).title, 'an older issue', wanted);
  }
});

test('an issue that is not one of them is not_found, and a future one is not read early', async () => {
  for (const wanted of ['https://atpota.to/blog/nope', '3zzzfuture']) {
    const result = await withFetch(dispatchRoute, () => dispatch.handler({ issue: wanted }));
    assert.equal(result.isError, true);
    assert.equal(resultBody(result).code, 'not_found');
  }
});
