import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerLexiconTools } from '@/lib/mcp/tools/lexicons';
import {
  captureRegistrations,
  resultBody,
  MAX_DESCRIPTION_LENGTH,
} from '@/lib/mcp/__tests__/harness';

const { tools } = captureRegistrations(registerLexiconTools);

test('registers exactly the lexicon tools', () => {
  assert.deepEqual(
    [...tools.keys()].sort(),
    [
      'get_lexicon_activity',
      'get_lexicon_schema',
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

  const fresh = tools.get('list_new_lexicons')!.config.inputSchema!;
  assert.equal(fresh.safeParse({ window: '90d' }).success, false);
  assert.equal(fresh.safeParse({ minAccounts: 1 }).success, false);
  assert.equal(fresh.safeParse({ limit: 201 }).success, false);
  assert.equal(fresh.safeParse({ window: '30d', minAccounts: 2, limit: 200 }).success, true);

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
