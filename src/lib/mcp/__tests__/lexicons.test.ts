import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { registerLexiconTools } from '@/lib/mcp/tools/lexicons';
import { clearLexiconTrendsCache } from '@/lib/lexiconTrends';
import {
  captureRegistrations,
  resultBody,
  MAX_DESCRIPTION_LENGTH,
} from '@/lib/mcp/__tests__/harness';

const { tools } = captureRegistrations(registerLexiconTools);

// The lexicon tools cache UFOs answers for ten minutes, and every test here
// stubs a different UFOs.
beforeEach(() => clearLexiconTrendsCache());

test('registers exactly the lexicon tools', () => {
  assert.deepEqual(
    [...tools.keys()].sort(),
    [
      'get_lexicon_activity',
      'get_lexicon_schema',
      'list_lexicon_movers',
      'list_new_lexicons',
      'list_trending_lexicons',
      'sample_recent_records',
      'search_lexicons',
    ],
  );
});

test('every tool carries a title, a bounded description, and read-only annotations', () => {
  for (const tool of tools.values()) {
    assert.ok(tool.config.title, `${tool.name} has no title`);
    assert.ok(
      (tool.config.description ?? '').length <= MAX_DESCRIPTION_LENGTH,
      `${tool.name} description exceeds the budget`,
    );
    assert.equal(tool.config.annotations?.readOnlyHint, true, tool.name);
    assert.equal(tool.config.annotations?.openWorldHint, true, tool.name);
  }
});

test('window and sort are closed enums; limits are bounded', () => {
  const trending = tools.get('list_trending_lexicons')!.config.inputSchema!;
  assert.equal(trending.safeParse({ window: '90d' }).success, false);
  assert.equal(trending.safeParse({ sort: 'most-hype' }).success, false);
  assert.equal(trending.safeParse({ limit: 51 }).success, false);
  assert.equal(trending.safeParse({ window: '7d', sort: 'dids-estimate', limit: 50 }).success, true);
  assert.equal(trending.safeParse({ compare: 'yes' }).success, false);
  assert.equal(trending.safeParse({ window: '7d', compare: true }).success, true);

  const fresh = tools.get('list_new_lexicons')!.config.inputSchema!;
  assert.equal(fresh.safeParse({ window: '90d' }).success, false);
  assert.equal(fresh.safeParse({ minAccounts: 1 }).success, false);
  assert.equal(fresh.safeParse({ limit: 201 }).success, false);
  assert.equal(fresh.safeParse({ window: '30d', minAccounts: 2, limit: 200 }).success, true);
  assert.equal(fresh.safeParse({ sample: 'yes' }).success, false);
  assert.equal(fresh.safeParse({ sample: true }).success, true);

  const movers = tools.get('list_lexicon_movers')!.config.inputSchema!;
  assert.equal(movers.safeParse({ direction: 'sideways' }).success, false);
  assert.equal(movers.safeParse({ minAccounts: 0 }).success, false);
  assert.equal(movers.safeParse({ limit: 101 }).success, false);
  assert.equal(movers.safeParse({ window: '30d', direction: 'falling', minAccounts: 1, limit: 100 }).success, true);

  const sample = tools.get('sample_recent_records')!.config.inputSchema!;
  assert.equal(sample.safeParse({ nsid: 'app.bsky.feed.post', limit: 101 }).success, false);
  assert.equal(sample.safeParse({ nsid: 'app.bsky.feed.post', limit: 100 }).success, true);
});

test('NSID-taking tools reject non-NSIDs before touching the network', async () => {
  for (const name of ['get_lexicon_activity', 'sample_recent_records', 'get_lexicon_schema']) {
    const result = await tools.get(name)!.handler({ nsid: 'not an nsid' });
    assert.equal(result.isError, true, name);
    assert.equal(resultBody(result).code, 'invalid_parameter', name);
  }
});

test('search_lexicons requires at least two characters', () => {
  const schema = tools.get('search_lexicons')!.config.inputSchema!;
  assert.equal(schema.safeParse({ query: 'a' }).success, false);
  assert.equal(schema.safeParse({ query: 'blog' }).success, true);
});

const ZERO = { creates: 0, updates: 0, deletes: 0, dids_estimate: 0 };

/**
 * Run list_new_lexicons against a fake UFOs. `pages` are the /collections
 * pages in cursor order; `history` is what /collections/stats knows about
 * each NSID before the window, and an NSID absent from it is absent from
 * the stats answer too.
 */
async function runNewLexicons(
  args: Record<string, unknown>,
  ufos: {
    pages: Array<Array<{ nsid: string; dids_estimate: number; creates?: number }>>;
    history: Record<string, typeof ZERO>;
    statsStatus?: number;
    endlessPages?: boolean;
    /** DIDs behind each NSID's /records sample; an NSID not listed answers 500. */
    records?: Record<string, string[]>;
  },
) {
  const calls: URL[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/collections') {
      const index = Number(url.searchParams.get('cursor') ?? 0);
      const rows = (ufos.pages[index] ?? []).map((r) => ({ ...ZERO, creates: r.creates ?? r.dids_estimate, ...r }));
      const more = ufos.endlessPages || index + 1 < ufos.pages.length;
      return json({ collections: rows, cursor: more ? String(index + 1) : null });
    }
    if (url.pathname === '/collections/stats') {
      if (ufos.statsStatus) return json({}, ufos.statsStatus);
      const answer: Record<string, typeof ZERO> = {};
      for (const nsid of url.searchParams.getAll('collection')) {
        if (nsid in ufos.history) answer[nsid] = ufos.history[nsid];
      }
      return json(answer);
    }
    if (url.pathname === '/records') {
      const nsid = url.searchParams.get('collection')!;
      const dids = ufos.records?.[nsid];
      if (!dids) return json({}, 500);
      return json(dids.map((did, i) => ({ collection: nsid, did, rkey: `r${i}`, record: {}, time_us: 1 })));
    }
    return json({}, 404);
  }) as typeof fetch;
  try {
    const result = await tools.get('list_new_lexicons')!.handler(args);
    return { result, body: resultBody(result), calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('list_new_lexicons keeps NSIDs with no history and enough accounts', async () => {
  const { result, body, calls } = await runNewLexicons(
    {},
    {
      pages: [
        [
          { nsid: 'app.bsky.feed.post', dids_estimate: 900 },
          { nsid: 'com.example.launch.post', dids_estimate: 10 },
          { nsid: 'com.example.solo.test', dids_estimate: 1 },
        ],
        [
          { nsid: 'com.example.second.item', dids_estimate: 4, creates: 50 },
          { nsid: 'not an nsid', dids_estimate: 9 },
          { nsid: 'com.example.unanswered.thing', dids_estimate: 3 },
        ],
      ],
      history: {
        'app.bsky.feed.post': { creates: 5, updates: 0, deletes: 0, dids_estimate: 2 },
        'com.example.launch.post': ZERO,
        'com.example.second.item': ZERO,
        'com.example.solo.test': ZERO,
      },
    },
  );
  assert.equal(result.isError, undefined);
  assert.deepEqual(
    (body.lexicons as Array<{ nsid: string }>).map((l) => l.nsid),
    ['com.example.launch.post', 'com.example.second.item'],
  );
  assert.equal(body.window, '7d');
  assert.equal(body.minAccounts, 3);
  assert.equal(body.activeInWindow, 6);
  assert.equal(body.checked, 4);
  assert.equal(body.count, 2);
  assert.equal(body.truncated, false);

  const pages = calls.filter((u) => u.pathname === '/collections');
  assert.equal(pages.length, 2);
  assert.equal(pages[0].searchParams.get('order'), null, 'ordered results cannot be paged');
  assert.equal(pages[1].searchParams.get('cursor'), '1');

  // History is asked only about candidates, over everything before the window.
  const stats = calls.filter((u) => u.pathname === '/collections/stats');
  const asked = stats.flatMap((u) => u.searchParams.getAll('collection')).sort();
  assert.deepEqual(asked, [
    'app.bsky.feed.post',
    'com.example.launch.post',
    'com.example.second.item',
    'com.example.unanswered.thing',
  ]);
  for (const u of stats) {
    assert.equal(u.searchParams.get('until'), body.since);
    assert.equal(u.searchParams.get('since'), '1970-01-01T00:00:00Z');
  }
});

test('list_new_lexicons truncates to limit after sorting by accounts', async () => {
  const { body } = await runNewLexicons(
    { limit: 1, minAccounts: 2 },
    {
      pages: [[
        { nsid: 'com.example.small.thing', dids_estimate: 2 },
        { nsid: 'com.example.big.thing', dids_estimate: 20 },
      ]],
      history: { 'com.example.small.thing': ZERO, 'com.example.big.thing': ZERO },
    },
  );
  assert.equal(body.count, 2);
  assert.equal(body.truncated, true);
  assert.deepEqual((body.lexicons as Array<{ nsid: string }>).map((l) => l.nsid), ['com.example.big.thing']);
});

test('list_new_lexicons fails rather than call everything new when history is unavailable', async () => {
  const { result, body } = await runNewLexicons(
    {},
    {
      pages: [[{ nsid: 'app.bsky.feed.post', dids_estimate: 900 }]],
      history: {},
      statsStatus: 500,
    },
  );
  assert.equal(result.isError, true);
  assert.equal(body.code, 'upstream_error');
});

test('list_new_lexicons refuses a window it cannot page to the end', async () => {
  const { result, body, calls } = await runNewLexicons(
    { window: '30d' },
    { pages: [[{ nsid: 'com.example.any.thing', dids_estimate: 5 }]], history: {}, endlessPages: true },
  );
  assert.equal(result.isError, true);
  assert.equal(body.code, 'invalid_parameter');
  assert.equal(calls.filter((u) => u.pathname === '/collections').length, 60);
  assert.equal(calls.filter((u) => u.pathname === '/collections/stats').length, 0);
});

test('list_new_lexicons splits the history check into bounded requests', async () => {
  // 120 valid NSIDs of 98 characters each: far over one request's worth.
  const nsids = Array.from(
    { length: 120 },
    (_, i) => `com.example.${'x'.repeat(40)}.${'z'.repeat(40)}.n${String(i).padStart(3, '0')}`,
  );
  const { body, calls } = await runNewLexicons(
    {},
    {
      pages: [nsids.map((nsid) => ({ nsid, dids_estimate: 3 }))],
      history: Object.fromEntries(nsids.map((n) => [n, ZERO])),
    },
  );
  const stats = calls.filter((u) => u.pathname === '/collections/stats');
  assert.ok(stats.length > 1, 'expected more than one history request');
  for (const u of stats) assert.ok(u.search.length < 2_200, `history request is ${u.search.length} characters`);
  assert.deepEqual(stats.flatMap((u) => u.searchParams.getAll('collection')).sort(), [...nsids].sort());
  assert.equal(body.count, 120);
});

/**
 * Run list_trending_lexicons against a fake UFOs: `ranked` is the ordered
 * /collections answer, `current` and `previous` what /collections/stats
 * reports for the window and the one before it (told apart by `until`).
 */
async function runTrending(
  args: Record<string, unknown>,
  ufos: {
    ranked: Array<{ nsid: string; dids_estimate: number; creates: number }>;
    current: Record<string, typeof ZERO>;
    previous: Record<string, typeof ZERO>;
    statsStatus?: number;
  },
) {
  const calls: URL[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/collections') {
      return json({ collections: ufos.ranked.map((r) => ({ ...ZERO, ...r })), cursor: null });
    }
    if (url.pathname === '/collections/stats') {
      if (ufos.statsStatus) return json({}, ufos.statsStatus);
      const source = url.searchParams.has('until') ? ufos.previous : ufos.current;
      const answer: Record<string, typeof ZERO> = {};
      for (const nsid of url.searchParams.getAll('collection')) {
        if (nsid in source) answer[nsid] = source[nsid];
      }
      return json(answer);
    }
    return json({}, 404);
  }) as typeof fetch;
  try {
    const result = await tools.get('list_trending_lexicons')!.handler(args);
    return { result, body: resultBody(result), calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const RANKED = [
  { nsid: 'app.bsky.feed.like', dids_estimate: 1000, creates: 9000 },
  { nsid: 'com.example.grow.thing', dids_estimate: 50, creates: 400 },
  { nsid: 'com.example.fresh.thing', dids_estimate: 5, creates: 20 },
  { nsid: 'com.example.unanswered.thing', dids_estimate: 4, creates: 8 },
];

test('list_trending_lexicons compares each lexicon with the window before', async () => {
  const { result, body, calls } = await runTrending(
    { window: '7d', compare: true },
    {
      ranked: RANKED,
      current: {
        // Deliberately not the ranked listing's numbers: stats is the source.
        'app.bsky.feed.like': { creates: 9900, updates: 0, deletes: 0, dids_estimate: 1100 },
        'com.example.grow.thing': { creates: 400, updates: 0, deletes: 0, dids_estimate: 50 },
        'com.example.fresh.thing': { creates: 20, updates: 0, deletes: 0, dids_estimate: 5 },
        // Stats puts this above grow.thing, which the ranked listing did not.
        'com.example.unanswered.thing': { creates: 500, updates: 0, deletes: 0, dids_estimate: 4 },
      },
      previous: {
        'app.bsky.feed.like': { creates: 10000, updates: 0, deletes: 0, dids_estimate: 1000 },
        'com.example.grow.thing': { creates: 100, updates: 0, deletes: 0, dids_estimate: 20 },
        'com.example.fresh.thing': ZERO,
      },
    },
  );
  assert.equal(result.isError, undefined);
  const rows = body.lexicons as Array<Record<string, unknown>>;
  assert.deepEqual(
    rows.map((r) => r.nsid),
    ['app.bsky.feed.like', 'com.example.unanswered.thing', 'com.example.grow.thing', 'com.example.fresh.thing'],
    'rows are ordered by the counts they show',
  );
  const row = (nsid: string) => rows.find((r) => r.nsid === nsid)!;

  assert.equal(row('app.bsky.feed.like').didsEstimate, 1100);
  assert.deepEqual(row('app.bsky.feed.like').change, { creates: -1, didsEstimate: 10 });
  assert.deepEqual(row('com.example.grow.thing').change, { creates: 300, didsEstimate: 150 });
  // Nothing last window: there is no percentage to report, not an infinite one.
  assert.deepEqual(row('com.example.fresh.thing').previous, { creates: 0, updates: 0, deletes: 0, didsEstimate: 0 });
  assert.deepEqual(row('com.example.fresh.thing').change, { creates: null, didsEstimate: null });
  assert.equal(row('com.example.unanswered.thing').previous, null);
  assert.equal(row('com.example.unanswered.thing').change, null);

  const window = body.comparedWith as { since: string; until: string };
  const stats = calls.filter((u) => u.pathname === '/collections/stats');
  const before = stats.filter((u) => u.searchParams.has('until'));
  assert.ok(before.length > 0 && before.length < stats.length, 'expected requests for both windows');
  for (const u of before) {
    assert.equal(u.searchParams.get('since'), window.since);
    assert.equal(u.searchParams.get('until'), window.until);
  }
  const span = Date.parse(window.until) - Date.parse(window.since);
  assert.ok(Math.abs(span - 7 * 24 * 3600 * 1000) < 60_000, 'previous window is the same length');
});

test('list_trending_lexicons without compare still shows stats counts, not the ranked ones', async () => {
  const { body, calls } = await runTrending(
    {},
    {
      ranked: RANKED,
      current: {
        'app.bsky.feed.like': { creates: 9900, updates: 0, deletes: 0, dids_estimate: 1100 },
        'com.example.unanswered.thing': { creates: 500, updates: 0, deletes: 0, dids_estimate: 4 },
      },
      previous: {},
    },
  );
  const stats = calls.filter((u) => u.pathname === '/collections/stats');
  assert.ok(stats.length > 0);
  assert.ok(stats.every((u) => !u.searchParams.has('until')), 'no previous-window request without compare');
  assert.equal(body.comparedWith, undefined);
  assert.equal(body.note, undefined);
  const rows = body.lexicons as Array<Record<string, unknown>>;
  assert.equal(rows[0].previous, undefined);
  assert.equal(rows[0].creates, 9900);
  // Stats has no row for grow.thing or fresh.thing, so they keep the ranked counts.
  assert.deepEqual(
    rows.map((r) => r.nsid),
    ['app.bsky.feed.like', 'com.example.unanswered.thing', 'com.example.grow.thing', 'com.example.fresh.thing'],
  );
});

test('list_trending_lexicons without compare falls back to ranked counts, and says so', async () => {
  const { result, body } = await runTrending({}, { ranked: RANKED, current: {}, previous: {}, statsStatus: 500 });
  assert.equal(result.isError, undefined);
  assert.match(String(body.note), /ranked listing/);
  assert.equal((body.lexicons as Array<Record<string, unknown>>)[0].creates, 9000);
});

test('list_trending_lexicons fails a comparison it cannot complete', async () => {
  const { result, body } = await runTrending(
    { compare: true },
    { ranked: RANKED, current: {}, previous: {}, statsStatus: 500 },
  );
  assert.equal(result.isError, true);
  assert.equal(body.code, 'upstream_error');
});

test('list_new_lexicons samples recent records only when asked', async () => {
  const ufos = {
    pages: [[
      { nsid: 'com.example.busy.thing', dids_estimate: 8 },
      { nsid: 'com.example.lonely.thing', dids_estimate: 4 },
      { nsid: 'com.example.broken.thing', dids_estimate: 3 },
    ]],
    history: { 'com.example.busy.thing': ZERO, 'com.example.lonely.thing': ZERO, 'com.example.broken.thing': ZERO },
    records: {
      'com.example.busy.thing': ['did:plc:a', 'did:plc:b', 'did:plc:a', 'did:plc:c'],
      'com.example.lonely.thing': ['did:plc:z', 'did:plc:z', 'did:plc:z'],
    },
  };
  const plain = await runNewLexicons({}, ufos);
  assert.equal(plain.calls.filter((u) => u.pathname === '/records').length, 0);
  assert.equal((plain.body.lexicons as Array<Record<string, unknown>>)[0].recentSample, undefined);

  clearLexiconTrendsCache();
  const { result, body, calls } = await runNewLexicons({ sample: true }, ufos);
  assert.equal(result.isError, undefined, 'a failed sample does not fail the call');
  assert.equal(calls.filter((u) => u.pathname === '/records').length, 3);
  const row = (nsid: string) => (body.lexicons as Array<Record<string, unknown>>).find((r) => r.nsid === nsid)!;
  assert.deepEqual(row('com.example.busy.thing').recentSample, { records: 4, accounts: 3 });
  assert.deepEqual(row('com.example.lonely.thing').recentSample, { records: 3, accounts: 1 });
  assert.equal(row('com.example.broken.thing').recentSample, null);
  assert.match(String(body.note), /recentSample/);
});

test('list_new_lexicons reuses its answer within ten minutes', async () => {
  const ufos = {
    pages: [[{ nsid: 'com.example.launch.post', dids_estimate: 10 }]],
    history: { 'com.example.launch.post': ZERO },
  };
  const first = await runNewLexicons({}, ufos);
  assert.ok(first.calls.length > 0);
  const second = await runNewLexicons({ limit: 5 }, ufos);
  assert.equal(second.calls.length, 0, 'a different limit is the same answer, sliced');
  assert.deepEqual(second.body.lexicons, first.body.lexicons);
  const third = await runNewLexicons({ minAccounts: 5 }, ufos);
  assert.deepEqual(
    [...new Set(third.calls.map((u) => u.pathname))],
    ['/collections/stats'],
    'a new threshold reuses the window listing and only checks history again',
  );
});

type Row = { nsid: string; dids_estimate: number; creates?: number };

/** Run list_lexicon_movers against a fake UFOs whose listings differ by window. */
async function runMovers(args: Record<string, unknown>, ufos: { current: Row[]; previous: Row[] }) {
  const calls: URL[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/collections') {
      const rows = url.searchParams.has('until') ? ufos.previous : ufos.current;
      return json({ collections: rows.map((r) => ({ ...ZERO, creates: r.dids_estimate, ...r })), cursor: null });
    }
    return json({}, 404);
  }) as typeof fetch;
  try {
    const result = await tools.get('list_lexicon_movers')!.handler(args);
    return { result, body: resultBody(result), calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const MOVERS = {
  current: [
    { nsid: 'so.sprk.feed.post', dids_estimate: 4668 },
    { nsid: 'social.grain.actor.profile', dids_estimate: 1144 },
    { nsid: 'com.example.tiny.base', dids_estimate: 43 },
    { nsid: 'app.bsky.feed.like', dids_estimate: 1000 },
    { nsid: 'com.example.brand.new', dids_estimate: 50 },
    { nsid: 'com.example.below.threshold', dids_estimate: 9 },
    { nsid: 'not an nsid', dids_estimate: 500 },
    { nsid: 'com.example.shrinking.one', dids_estimate: 20 },
    { nsid: 'com.example.flat.thing', dids_estimate: 30 },
  ],
  previous: [
    { nsid: 'so.sprk.feed.post', dids_estimate: 39 },
    { nsid: 'social.grain.actor.profile', dids_estimate: 46 },
    { nsid: 'com.example.tiny.base', dids_estimate: 1 },
    { nsid: 'app.bsky.feed.like', dids_estimate: 990 },
    { nsid: 'com.example.below.threshold', dids_estimate: 1 },
    { nsid: 'not an nsid', dids_estimate: 10 },
    { nsid: 'com.example.shrinking.one', dids_estimate: 92 },
    { nsid: 'com.example.flat.thing', dids_estimate: 30 },
    { nsid: 'com.example.gone.quiet', dids_estimate: 11 },
    { nsid: 'com.example.small.gone', dids_estimate: 5 },
  ],
};

test('list_lexicon_movers ranks risers so a tiny base does not win on ratio alone', async () => {
  const { result, body, calls } = await runMovers({}, MOVERS);
  assert.equal(result.isError, undefined);
  // Raw ratios would put tiny.base (x43) above grain (x24.9).
  assert.deepEqual(
    (body.lexicons as Array<{ nsid: string }>).map((l) => l.nsid),
    ['so.sprk.feed.post', 'social.grain.actor.profile', 'com.example.tiny.base', 'app.bsky.feed.like'],
  );
  assert.equal(body.absentLastWindow, 1, 'brand.new is counted, not ranked');
  assert.equal(body.count, 4);
  const top = (body.lexicons as Array<Record<string, unknown>>)[0];
  assert.equal(top.didsEstimate, 4668);
  assert.deepEqual(top.previous, { creates: 39, updates: 0, deletes: 0, didsEstimate: 39 });
  assert.deepEqual(top.change, { creates: 11869.2, didsEstimate: 11869.2 });

  // The previous window is the same length and ends where this one starts.
  const window = body.comparedWith as { since: string; until: string };
  assert.equal(window.until, body.since);
  assert.equal(Date.parse(window.until) - Date.parse(window.since), 7 * 24 * 3600 * 1000);
  const listings = calls.filter((u) => u.pathname === '/collections');
  assert.equal(listings.length, 2);
  assert.ok(listings.every((u) => u.searchParams.get('order') === null));
  const previous = listings.find((u) => u.searchParams.has('until'))!;
  assert.equal(previous.searchParams.get('since'), window.since);
  assert.equal(previous.searchParams.get('until'), window.until);
});

test('list_lexicon_movers keeps fallers that went quiet, with zeroes for now', async () => {
  const { body } = await runMovers({ direction: 'falling' }, MOVERS);
  assert.deepEqual(
    (body.lexicons as Array<{ nsid: string }>).map((l) => l.nsid),
    ['com.example.shrinking.one', 'com.example.gone.quiet'],
  );
  const quiet = (body.lexicons as Array<Record<string, unknown>>)[1];
  assert.equal(quiet.didsEstimate, 0);
  assert.deepEqual(quiet.change, { creates: -100, didsEstimate: -100 });
  assert.equal(body.absentLastWindow, undefined);
});

test('list_lexicon_movers applies the threshold to the busier window', async () => {
  const { body } = await runMovers({ minAccounts: 1, limit: 2 }, MOVERS);
  // below.threshold (1 -> 9) now qualifies; limit truncates.
  assert.equal(body.truncated, true);
  assert.equal((body.lexicons as unknown[]).length, 2);
  assert.equal(body.count, 5);
});
