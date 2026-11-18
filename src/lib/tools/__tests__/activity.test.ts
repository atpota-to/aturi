import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TID } from '@atproto/common-web';
import {
  appOf,
  buildWindow,
  dateFromKey,
  dayBreakdown,
  dayKey,
  dayKeyOf,
  emptyScan,
  intensityLevel,
  intensityThresholds,
  normalizeActorInput,
  recordTime,
  sumDays,
  summarize,
  tallyPage,
  totalsBy,
  windowDays,
  type CollectionScan,
} from '@/lib/tools/activity';

// Days are the viewer's local days, so the tests pin a zone with daylight
// saving: New York springs forward on 8 March 2026 and falls back on
// 1 November 2026. Each test file runs in its own process, so this reaches
// nothing else.
process.env.TZ = 'America/New_York';

/** A record key made at a local date and time. */
function tidAt(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return TID.fromTime(new Date(year, month - 1, day, hour, minute).getTime() * 1000, 0).toString();
}

function scanOf(collection: string, days: Record<string, number>): CollectionScan {
  return {
    ...emptyScan(collection),
    days,
    counted: Object.values(days).reduce((a, b) => a + b, 0),
    state: 'done',
  };
}

// --- input -----------------------------------------------------------------

test('normalizeActorInput accepts handles, DIDs and profile links', () => {
  assert.deepEqual(normalizeActorInput(' @Alice.Example.com '), { ok: true, actor: 'alice.example.com' });
  assert.deepEqual(normalizeActorInput('did:plc:z72i7hdynmk6r22z27h6tvur'), {
    ok: true,
    actor: 'did:plc:z72i7hdynmk6r22z27h6tvur',
  });
  assert.deepEqual(normalizeActorInput('did:web:example.com'), { ok: true, actor: 'did:web:example.com' });
  assert.deepEqual(normalizeActorInput('at://alice.example.com/app.bsky.feed.post/3kabc'), {
    ok: true,
    actor: 'alice.example.com',
  });
  assert.deepEqual(normalizeActorInput('https://bsky.app/profile/alice.example.com/post/3kabc'), {
    ok: true,
    actor: 'alice.example.com',
  });
  assert.deepEqual(normalizeActorInput('https://aturi.to/explore/did:plc:z72i7hdynmk6r22z27h6tvur'), {
    ok: true,
    actor: 'did:plc:z72i7hdynmk6r22z27h6tvur',
  });
  assert.deepEqual(normalizeActorInput('https://alice.example.com/'), { ok: true, actor: 'alice.example.com' });
  assert.equal(normalizeActorInput('').ok, false);
  assert.equal(normalizeActorInput('alice').ok, false);
  assert.equal(normalizeActorInput('did:plc:short').ok, false);
  assert.equal(normalizeActorInput('not a handle').ok, false);
});

// --- days ------------------------------------------------------------------

test('a moment belongs to the local day, not the UTC one', () => {
  // 02:30 UTC on 4 March is still the evening of 3 March in New York.
  assert.equal(dayKeyOf(Date.UTC(2026, 2, 4, 2, 30)), '2026-03-03');
  assert.equal(dayKeyOf(Date.UTC(2026, 2, 4, 5, 0)), '2026-03-04');
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(dateFromKey('2026-01-05').getTime(), new Date(2026, 0, 5).getTime());
});

// --- the window ------------------------------------------------------------

test('the window is 53 whole weeks ending with the week today is in', () => {
  // Thursday 12 November 2026, mid-afternoon.
  const window = buildWindow(new Date(2026, 10, 12, 15, 30));
  assert.equal(window.weeks.length, 53);
  assert.ok(window.weeks.every((week) => week.length === 7));
  assert.equal(window.todayKey, '2026-11-12');
  // The current week starts on Sunday 8 November; 52 weeks before is 9 November 2025.
  assert.equal(window.firstKey, '2025-11-09');
  assert.equal(window.weeks[0][0], '2025-11-09');
  assert.equal(dateFromKey(window.firstKey).getDay(), 0);
  // The last column holds Sunday to Thursday, then two days that have not happened.
  assert.deepEqual(window.weeks[52], ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', null, null]);
  assert.equal(window.startMs, new Date(2025, 10, 9).getTime());
  assert.equal(window.endMs, new Date(2026, 10, 13).getTime());
  assert.equal(windowDays(window).length, 52 * 7 + 5);
});

test('every day in the window is one calendar day after the last, across both clock changes', () => {
  const keys = windowDays(buildWindow(new Date(2026, 10, 12)));
  assert.equal(new Set(keys).size, keys.length);
  for (let i = 1; i < keys.length; i++) {
    const prev = dateFromKey(keys[i - 1]);
    const next = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1);
    assert.equal(keys[i], dayKey(next));
  }
  // The 23-hour day and the 25-hour day are both there, once each.
  assert.ok(keys.includes('2026-03-08'));
  assert.ok(keys.includes('2026-03-09'));
  assert.ok(keys.includes('2026-11-01'));
  assert.ok(keys.includes('2026-11-02'));
  // Every column starts on a Sunday, clock changes or not.
  for (const week of buildWindow(new Date(2026, 10, 12)).weeks) {
    assert.equal(dateFromKey(week[0] as string).getDay(), 0);
  }
});

test('the window crosses a year boundary without losing a day', () => {
  // Saturday 3 January 2026: the current week began in the old year.
  const window = buildWindow(new Date(2026, 0, 3, 9));
  assert.equal(window.todayKey, '2026-01-03');
  assert.deepEqual(window.weeks[52], [
    '2025-12-28',
    '2025-12-29',
    '2025-12-30',
    '2025-12-31',
    '2026-01-01',
    '2026-01-02',
    '2026-01-03',
  ]);
  assert.equal(window.firstKey, '2024-12-29');
  assert.equal(windowDays(window).length, 53 * 7);
});

test('a window that ends on a Sunday has a last column of one day', () => {
  const window = buildWindow(new Date(2026, 10, 8, 0, 5));
  assert.deepEqual(window.weeks[52], ['2026-11-08', null, null, null, null, null, null]);
  assert.equal(window.firstKey, '2025-11-09');
});

test('month labels sit on the first column that starts in each month', () => {
  const window = buildWindow(new Date(2026, 10, 12));
  const labels = window.months.map((m) => m.label);
  assert.deepEqual(labels, ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
  for (const month of window.months) {
    const sunday = dateFromKey(window.weeks[month.column][0] as string);
    const before = month.column > 0 ? dateFromKey(window.weeks[month.column - 1][0] as string) : null;
    if (before) assert.notEqual(sunday.getMonth(), before.getMonth());
  }
  // Columns strictly increase, so labels never collide.
  for (let i = 1; i < window.months.length; i++) {
    assert.ok(window.months[i].column - window.months[i - 1].column >= 3);
  }
});

test('a first month with under three columns gives up its label', () => {
  // Wednesday 27 May 2026: the window opens on Sunday 25 May 2025, one
  // column before June starts.
  const window = buildWindow(new Date(2026, 4, 27));
  assert.equal(window.firstKey, '2025-05-25');
  assert.equal(window.months[0].label, 'Jun');
  assert.equal(window.months[0].column, 1);
});

test('a shorter window is the same shape with fewer columns', () => {
  const window = buildWindow(new Date(2026, 10, 12), 26);
  assert.equal(window.weeks.length, 26);
  assert.equal(window.firstKey, '2026-05-17');
});

// --- reading a collection ---------------------------------------------------

test('recordTime prefers the key, then createdAt, then gives up', () => {
  const key = tidAt(2026, 6, 15, 9, 30);
  assert.deepEqual(recordTime(key, '2020-01-01T00:00:00Z'), {
    ms: new Date(2026, 5, 15, 9, 30).getTime(),
    fromKey: true,
  });
  assert.deepEqual(recordTime('self', '2026-06-15T13:30:00.000Z'), {
    ms: Date.UTC(2026, 5, 15, 13, 30),
    fromKey: false,
  });
  assert.deepEqual(recordTime('self', undefined), { ms: null, fromKey: false });
  assert.deepEqual(recordTime('whats-hot', 'yesterday'), { ms: null, fromKey: false });
  assert.deepEqual(recordTime('self', 12345), { ms: null, fromKey: false });
});

test('tallyPage counts records by local day and stops at a key older than the window', () => {
  const window = buildWindow(new Date(2026, 10, 12, 15));
  const page = [
    { rkey: tidAt(2026, 11, 12, 9) },
    { rkey: tidAt(2026, 11, 12, 8) },
    // 23:30 local on the 11th is already the 12th in UTC.
    { rkey: tidAt(2026, 11, 11, 23, 30) },
    { rkey: tidAt(2025, 11, 9, 0, 0) },
    { rkey: tidAt(2025, 11, 8, 23, 59) },
    { rkey: tidAt(2025, 6, 1) },
  ];
  const { scan, passedWindow } = tallyPage(emptyScan('app.bsky.feed.post'), page, window);
  assert.equal(passedWindow, true);
  assert.deepEqual(scan.days, { '2026-11-12': 2, '2026-11-11': 1, '2025-11-09': 1 });
  assert.equal(scan.counted, 4);
  assert.equal(scan.undated, 0);
  assert.equal(scan.pages, 1);
  // The key that ended the read is the oldest moment seen, not the one after it.
  assert.equal(scan.reachedMs, new Date(2025, 10, 8, 23, 59).getTime());
});

test('tallyPage keeps reading when every key is inside the window', () => {
  const window = buildWindow(new Date(2026, 10, 12));
  const first = tallyPage(emptyScan('app.bsky.feed.like'), [{ rkey: tidAt(2026, 11, 1) }, { rkey: tidAt(2026, 10, 1) }], window);
  assert.equal(first.passedWindow, false);
  const second = tallyPage(first.scan, [{ rkey: tidAt(2026, 10, 1, 8) }, { rkey: tidAt(2026, 9, 1) }], window);
  assert.equal(second.passedWindow, false);
  assert.deepEqual(second.scan.days, { '2026-11-01': 1, '2026-10-01': 2, '2026-09-01': 1 });
  assert.equal(second.scan.counted, 4);
  assert.equal(second.scan.pages, 2);
  // The input is not changed in place: a published snapshot stays what it was.
  assert.deepEqual(first.scan.days, { '2026-11-01': 1, '2026-10-01': 1 });
});

test('keys without a time fall back to createdAt, and an old createdAt does not stop the read', () => {
  const window = buildWindow(new Date(2026, 10, 12));
  const { scan, passedWindow } = tallyPage(
    emptyScan('app.bsky.feed.generator'),
    [
      { rkey: 'whats-hot', createdAt: '2026-08-02T15:00:00.000Z' },
      { rkey: 'old-feed', createdAt: '2023-05-01T00:00:00.000Z' },
      { rkey: 'no-date' },
      { rkey: 'newer', createdAt: '2026-08-03T15:00:00.000Z' },
    ],
    window,
  );
  // Custom keys sort as text, so an old record says nothing about the next.
  assert.equal(passedWindow, false);
  assert.deepEqual(scan.days, { '2026-08-02': 1, '2026-08-03': 1 });
  assert.equal(scan.undated, 1);
  assert.equal(scan.reachedMs, undefined);
});

test('a key dated well into the future is left out, and a slightly fast clock lands on today', () => {
  const window = buildWindow(new Date(2026, 10, 12, 15));
  const { scan, passedWindow } = tallyPage(
    emptyScan('app.bsky.feed.post'),
    [{ rkey: tidAt(2027, 3, 1) }, { rkey: tidAt(2026, 11, 13, 0, 20) }, { rkey: tidAt(2026, 11, 12, 10) }],
    window,
  );
  assert.equal(passedWindow, false);
  assert.deepEqual(scan.days, { '2026-11-12': 2 });
  assert.equal(scan.counted, 2);
});

test('an empty page changes nothing but the page count', () => {
  const window = buildWindow(new Date(2026, 10, 12));
  const { scan, passedWindow } = tallyPage(emptyScan('app.bsky.feed.post'), [], window);
  assert.equal(passedWindow, false);
  assert.deepEqual(scan.days, {});
  assert.equal(scan.pages, 1);
});

// --- adding up -------------------------------------------------------------

const POSTS = scanOf('app.bsky.feed.post', { '2026-11-10': 2, '2026-11-11': 1 });
const LIKES = scanOf('app.bsky.feed.like', { '2026-11-11': 5 });
const ENTRIES = scanOf('com.whtwnd.blog.entry', { '2026-11-12': 1 });
const PROFILE = scanOf('app.bsky.actor.profile', {});

test('appOf is the first two segments of an NSID', () => {
  assert.equal(appOf('app.bsky.feed.post'), 'app.bsky');
  assert.equal(appOf('com.whtwnd.blog.entry'), 'com.whtwnd');
  assert.equal(appOf('is.dame'), 'is.dame');
  assert.equal(appOf('odd'), 'odd');
});

test('sumDays adds collections together and honours a filter', () => {
  const all = [POSTS, LIKES, ENTRIES, PROFILE];
  assert.deepEqual(sumDays(all), { '2026-11-10': 2, '2026-11-11': 6, '2026-11-12': 1 });
  assert.deepEqual(sumDays(all, { by: 'app', key: 'app.bsky' }), { '2026-11-10': 2, '2026-11-11': 6 });
  assert.deepEqual(sumDays(all, { by: 'collection', key: 'app.bsky.feed.like' }), { '2026-11-11': 5 });
  assert.deepEqual(sumDays(all, { by: 'app', key: 'nobody.here' }), {});
  assert.deepEqual(sumDays([]), {});
});

test('totalsBy ranks apps and collections and leaves out the empty ones', () => {
  const all = [POSTS, LIKES, ENTRIES, PROFILE];
  assert.deepEqual(totalsBy(all, 'app'), [
    { key: 'app.bsky', count: 8, collections: 2, share: 8 / 9 },
    { key: 'com.whtwnd', count: 1, collections: 1, share: 1 / 9 },
  ]);
  assert.deepEqual(
    totalsBy(all, 'collection').map((row) => [row.key, row.count]),
    [
      ['app.bsky.feed.like', 5],
      ['app.bsky.feed.post', 3],
      ['com.whtwnd.blog.entry', 1],
    ],
  );
  assert.deepEqual(totalsBy([PROFILE], 'app'), []);
});

test('dayBreakdown lists what was written on one day, largest first', () => {
  const all = [POSTS, LIKES, ENTRIES];
  assert.deepEqual(dayBreakdown(all, '2026-11-11'), [
    { collection: 'app.bsky.feed.like', count: 5 },
    { collection: 'app.bsky.feed.post', count: 1 },
  ]);
  assert.deepEqual(dayBreakdown(all, '2026-01-01'), []);
});

// --- intensity -------------------------------------------------------------

test('intensity steps come from the quartiles of the active days', () => {
  const counts = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8];
  const thresholds = intensityThresholds(counts);
  assert.deepEqual(thresholds, [3, 5, 7]);
  assert.equal(intensityLevel(0, thresholds), 0);
  assert.equal(intensityLevel(1, thresholds), 1);
  assert.equal(intensityLevel(3, thresholds), 1);
  assert.equal(intensityLevel(4, thresholds), 2);
  assert.equal(intensityLevel(6, thresholds), 3);
  assert.equal(intensityLevel(8, thresholds), 4);
});

test('one enormous day does not flatten the rest', () => {
  const counts = [1, 1, 2, 2, 3, 3, 4, 4, 10000];
  const thresholds = intensityThresholds(counts);
  assert.equal(intensityLevel(1, thresholds), 1);
  assert.ok(intensityLevel(3, thresholds) > intensityLevel(1, thresholds));
  assert.equal(intensityLevel(10000, thresholds), 4);
});

test('intensity copes with nothing, and with every day the same', () => {
  assert.deepEqual(intensityThresholds([]), [0, 0, 0]);
  assert.deepEqual(intensityThresholds([0, 0]), [0, 0, 0]);
  assert.equal(intensityLevel(0, [0, 0, 0]), 0);
  const same = intensityThresholds([2, 2, 2]);
  assert.deepEqual(same, [2, 2, 2]);
  assert.equal(intensityLevel(2, same), 1);
});

// --- summary ---------------------------------------------------------------

test('summarize finds the busiest day, the longest streak and the busiest month', () => {
  const window = buildWindow(new Date(2026, 10, 12));
  const days = {
    // A three-day run across the spring clock change.
    '2026-03-07': 1,
    '2026-03-08': 4,
    '2026-03-09': 1,
    // A two-day run across the year boundary.
    '2025-12-31': 2,
    '2026-01-01': 2,
    '2026-07-04': 9,
    // Outside the window: not counted.
    '2024-01-01': 50,
  };
  const summary = summarize(days, window);
  assert.equal(summary.total, 19);
  assert.equal(summary.activeDays, 6);
  assert.equal(summary.windowDays, 52 * 7 + 5);
  assert.deepEqual(summary.busiestDay, { key: '2026-07-04', count: 9 });
  assert.deepEqual(summary.longestStreak, { days: 3, startKey: '2026-03-07', endKey: '2026-03-09' });
  assert.deepEqual(summary.busiestMonth, { label: 'July 2026', count: 9 });
});

test('a streak can run across the autumn clock change and up to today', () => {
  const window = buildWindow(new Date(2026, 10, 12));
  const days: Record<string, number> = {};
  for (let d = 28; d <= 31; d++) days[`2026-10-${d}`] = 1;
  for (let d = 1; d <= 12; d++) days[`2026-11-${d < 10 ? `0${d}` : d}`] = 1;
  const summary = summarize(days, window);
  assert.deepEqual(summary.longestStreak, { days: 16, startKey: '2026-10-28', endKey: '2026-11-12' });
  assert.deepEqual(summary.busiestMonth, { label: 'November 2026', count: 12 });
});

test('an account with nothing in the window summarizes to zeros', () => {
  const window = buildWindow(new Date(2026, 10, 12));
  assert.deepEqual(summarize({}, window), {
    total: 0,
    activeDays: 0,
    windowDays: 52 * 7 + 5,
    busiestDay: null,
    longestStreak: null,
    busiestMonth: null,
  });
  assert.deepEqual(sumDays([PROFILE]), {});
  assert.deepEqual(totalsBy([PROFILE], 'collection'), []);
});
