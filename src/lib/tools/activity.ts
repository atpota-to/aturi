/**
 * The activity calendar's arithmetic: which day a record belongs to, the grid
 * of days the calendar draws, and what the counts add up to.
 *
 * Most record keys are TIDs, and a TID is a timestamp: the microsecond the
 * key was made, which is to say when the record was created. So an account's
 * year can be read from its keys alone, without keeping a single record body.
 * Keys that are not TIDs (`self`, a feed generator's name) carry no time;
 * for those the record's own `createdAt` stands in, and a record with
 * neither is counted as undated rather than guessed at.
 *
 * Two things follow from reading keys, and the page says both. Only records
 * that still exist are counted: a deleted post or an undone like leaves no
 * key behind. And a record is counted once, on the day it was created, so a
 * profile edited every week still shows as one day.
 *
 * Everything here is pure. Days are the viewer's local days, so every date
 * is built from local year, month and day rather than by adding 24 hours,
 * which would drift across a daylight-saving change. The reading itself (the
 * requests, the budget) is in activityScan.ts.
 */

import { looksLikeTid, tidToDate } from '@/utils/atproto/tid';

/* -------------------------------------------------------------------------- *
 * Input
 * -------------------------------------------------------------------------- */

export type ActorInput = { ok: true; actor: string } | { ok: false; reason: string };

const PROFILE_PATH = /\/(?:profile|explore)\/([^/?#]+)/i;

/**
 * Tidy what was typed into a handle or DID: `@name`, an at:// URI, or a
 * profile link from an app or from the Explorer.
 */
export function normalizeActorInput(raw: string): ActorInput {
  let value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter a handle or DID.' };

  if (/^https?:\/\//i.test(value)) {
    const fromPath = value.match(PROFILE_PATH);
    if (fromPath) {
      value = decodeURIComponent(fromPath[1]);
    } else {
      try {
        value = new URL(value).hostname;
      } catch {
        return { ok: false, reason: 'That link could not be read. Enter a handle such as alice.example.com.' };
      }
    }
  }
  value = value.replace(/^at:\/\//i, '').replace(/^@/, '').split('/')[0];

  if (/^did:/i.test(value)) {
    return /^did:(plc:[a-z2-7]{24}|web:[A-Za-z0-9.%:_-]+)$/.test(value)
      ? { ok: true, actor: value }
      : { ok: false, reason: 'That DID is not a valid did:plc or did:web identifier.' };
  }
  value = value.replace(/\.$/, '').toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) {
    return { ok: false, reason: 'Enter a handle such as alice.example.com, or a DID.' };
  }
  return { ok: true, actor: value };
}

/* -------------------------------------------------------------------------- *
 * Days
 * -------------------------------------------------------------------------- */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The local day a moment falls on, as `YYYY-MM-DD`. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dayKeyOf(ms: number): string {
  return dayKey(new Date(ms));
}

/** Local midnight at the start of a day key. */
export function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/* -------------------------------------------------------------------------- *
 * The window
 * -------------------------------------------------------------------------- */

/** A year of weeks, and the one in progress. */
export const CALENDAR_WEEKS = 53;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export type ActivityWindow = {
  /** Local midnight at the start of the first day shown, in epoch ms. */
  startMs: number;
  /** Local midnight at the end of today, in epoch ms. Exclusive. */
  endMs: number;
  firstKey: string;
  todayKey: string;
  /**
   * One column per week, Sunday first, seven day keys each. Days after today
   * in the last column are null: they have not happened.
   */
  weeks: (string | null)[][];
  /** Where each month's label sits: the first column that starts in it. */
  months: { column: number; label: string }[];
};

/**
 * The days the calendar shows: whole weeks, ending with the week today is
 * in. 53 columns is the last 12 months and however much of a 53rd week it
 * takes to start on a Sunday.
 */
export function buildWindow(now: Date, weekCount: number = CALENDAR_WEEKS): ActivityWindow {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const first = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - today.getDay() - (weekCount - 1) * 7,
  );
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

  const weeks: (string | null)[][] = [];
  const months: { column: number; label: string }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weekCount; w++) {
    const column: (string | null)[] = [];
    for (let d = 0; d < 7; d++) {
      // By calendar date, never by adding 24 hours: a day is 23 or 25 hours
      // long twice a year.
      const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + w * 7 + d);
      column.push(date.getTime() > today.getTime() ? null : dayKey(date));
      if (d === 0 && date.getMonth() !== lastMonth) {
        months.push({ column: w, label: MONTHS_SHORT[date.getMonth()] });
        lastMonth = date.getMonth();
      }
    }
    weeks.push(column);
  }
  // A window that opens in the last week of a month would print that month's
  // label on top of the next one's.
  if (months.length > 1 && months[1].column - months[0].column < 3) months.shift();

  return {
    startMs: first.getTime(),
    endMs: tomorrow.getTime(),
    firstKey: dayKey(first),
    todayKey: dayKey(today),
    weeks,
    months,
  };
}

/** Every day in the window, oldest first. */
export function windowDays(window: ActivityWindow): string[] {
  const out: string[] = [];
  for (const week of window.weeks) for (const key of week) if (key) out.push(key);
  return out;
}

/* -------------------------------------------------------------------------- *
 * Reading one collection
 * -------------------------------------------------------------------------- */

export type CollectionScan = {
  collection: string;
  /** Records per local day, for days inside the window. */
  days: Record<string, number>;
  /** Records inside the window. The sum of `days`. */
  counted: number;
  /** Records with no time in their key and no usable `createdAt`. */
  undated: number;
  /** Pages read so far, across every run. */
  pages: number;
  /** Where the next page starts. Unset before the first page and after the last. */
  cursor?: string;
  /**
   * `waiting` and `reading` are on their way. `done` has been read back past
   * the start of the window, or to its end. `partial` stopped short, at the
   * budget or because Stop was pressed, and `cursor` says where to resume.
   */
  state: 'waiting' | 'reading' | 'done' | 'partial' | 'failed';
  /** The oldest moment read so far, when the keys carry time. */
  reachedMs?: number;
  error?: string;
};

export function emptyScan(collection: string): CollectionScan {
  return { collection, days: {}, counted: 0, undated: 0, pages: 0, state: 'waiting' };
}

/**
 * When a record was created, in epoch ms, and whether its key said so.
 *
 * A TID key is trusted over `createdAt`: the field is whatever the client
 * wrote, and imported or backdated posts carry dates years from when they
 * entered the repository.
 */
export function recordTime(rkey: string, createdAt: unknown): { ms: number | null; fromKey: boolean } {
  if (looksLikeTid(rkey)) {
    const date = tidToDate(rkey);
    if (date) return { ms: date.getTime(), fromKey: true };
  }
  if (typeof createdAt === 'string') {
    const ms = Date.parse(createdAt);
    if (Number.isFinite(ms)) return { ms, fromKey: false };
  }
  return { ms: null, fromKey: false };
}

/** A clock a little ahead is normal; a key dated next month is a mistake. */
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/**
 * Add one page of records, as listRecords returns them (newest key first),
 * to a collection's count.
 *
 * `passedWindow` says the page reached a key older than the window, so no
 * later page can hold anything inside it and reading can stop. Only a key
 * can say that. Keys sort as text, so a TID older than the window means
 * every TID after it is older still, while a `createdAt` on a record with a
 * custom key says nothing about the records that sort after it.
 */
export function tallyPage(
  scan: CollectionScan,
  records: { rkey: string; createdAt?: unknown }[],
  window: Pick<ActivityWindow, 'startMs' | 'endMs'>,
): { scan: CollectionScan; passedWindow: boolean } {
  const days = { ...scan.days };
  let { counted, undated, reachedMs } = scan;
  let passedWindow = false;

  for (const record of records) {
    const { ms, fromKey } = recordTime(record.rkey, record.createdAt);
    if (ms === null) {
      undated += 1;
      continue;
    }
    if (fromKey && (reachedMs === undefined || ms < reachedMs)) reachedMs = ms;
    if (ms < window.startMs) {
      if (fromKey) {
        passedWindow = true;
        break;
      }
      continue;
    }
    if (ms >= window.endMs + FUTURE_SLACK_MS) continue;
    const key = dayKeyOf(Math.min(ms, window.endMs - 1));
    days[key] = (days[key] ?? 0) + 1;
    counted += 1;
  }

  return { scan: { ...scan, days, counted, undated, reachedMs, pages: scan.pages + 1 }, passedWindow };
}

/* -------------------------------------------------------------------------- *
 * Adding up
 * -------------------------------------------------------------------------- */

/** `app.bsky.feed.post` belongs to `app.bsky`, as the explorer groups its collections. */
export function appOf(collection: string): string {
  const segments = collection.split('.');
  return segments.length >= 2 ? `${segments[0]}.${segments[1]}` : collection;
}

export type ActivityFilter = { by: 'app' | 'collection'; key: string } | null;

export function matchesFilter(collection: string, filter: ActivityFilter): boolean {
  if (!filter) return true;
  return filter.by === 'app' ? appOf(collection) === filter.key : collection === filter.key;
}

/** Records per day across the collections a filter lets through. */
export function sumDays(scans: CollectionScan[], filter: ActivityFilter = null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const scan of scans) {
    if (!matchesFilter(scan.collection, filter)) continue;
    for (const [key, count] of Object.entries(scan.days)) out[key] = (out[key] ?? 0) + count;
  }
  return out;
}

export type ActivityShare = {
  key: string;
  count: number;
  /** Of every counted record, 0 to 1. */
  share: number;
  /** How many collections are behind this row. 1 for a collection. */
  collections: number;
};

/** Totals by app or by collection, largest first, leaving out the ones with nothing in the window. */
export function totalsBy(scans: CollectionScan[], by: 'app' | 'collection'): ActivityShare[] {
  const rows = new Map<string, { count: number; collections: number }>();
  let total = 0;
  for (const scan of scans) {
    if (scan.counted === 0) continue;
    const key = by === 'app' ? appOf(scan.collection) : scan.collection;
    const row = rows.get(key) ?? { count: 0, collections: 0 };
    row.count += scan.counted;
    row.collections += 1;
    rows.set(key, row);
    total += scan.counted;
  }
  return [...rows.entries()]
    .map(([key, row]) => ({ key, count: row.count, collections: row.collections, share: total ? row.count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** What was written on one day, by collection, largest first. */
export function dayBreakdown(scans: CollectionScan[], key: string): { collection: string; count: number }[] {
  return scans
    .map((scan) => ({ collection: scan.collection, count: scan.days[key] ?? 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.collection.localeCompare(b.collection));
}

/* -------------------------------------------------------------------------- *
 * Intensity
 * -------------------------------------------------------------------------- */

export type IntensityLevel = 0 | 1 | 2 | 3 | 4;

/**
 * The three cut points between the four shades, from the quartiles of the
 * days that have anything at all.
 *
 * Quartiles rather than fractions of the busiest day, because one day of a
 * bulk import (ten thousand follows from a starter pack) would otherwise
 * push every ordinary day into the palest shade.
 */
export function intensityThresholds(counts: number[]): [number, number, number] {
  const active = counts.filter((n) => n > 0).sort((a, b) => a - b);
  if (active.length === 0) return [0, 0, 0];
  const at = (q: number) => active[Math.min(active.length - 1, Math.floor(q * active.length))];
  return [at(0.25), at(0.5), at(0.75)];
}

/** 0 for an empty day, then 1 to 4: how many cut points the count is above, plus one. */
export function intensityLevel(count: number, thresholds: [number, number, number]): IntensityLevel {
  if (count <= 0) return 0;
  let level = 1;
  for (const threshold of thresholds) if (count > threshold) level += 1;
  return level as IntensityLevel;
}

/* -------------------------------------------------------------------------- *
 * Summary
 * -------------------------------------------------------------------------- */

export type ActivitySummary = {
  total: number;
  activeDays: number;
  /** Days in the window, up to and including today. */
  windowDays: number;
  busiestDay: { key: string; count: number } | null;
  /** The longest run of consecutive days with at least one record. */
  longestStreak: { days: number; startKey: string; endKey: string } | null;
  busiestMonth: { label: string; count: number } | null;
};

export function summarize(days: Record<string, number>, window: ActivityWindow): ActivitySummary {
  const keys = windowDays(window);
  let total = 0;
  let activeDays = 0;
  let busiestDay: ActivitySummary['busiestDay'] = null;
  let longestStreak: ActivitySummary['longestStreak'] = null;
  let runStart: string | null = null;
  let runLength = 0;
  const months = new Map<string, number>();

  for (const key of keys) {
    const count = days[key] ?? 0;
    if (count > 0) {
      total += count;
      activeDays += 1;
      if (!busiestDay || count > busiestDay.count) busiestDay = { key, count };
      const month = key.slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + count);
      if (runStart === null) runStart = key;
      runLength += 1;
      if (!longestStreak || runLength > longestStreak.days) {
        longestStreak = { days: runLength, startKey: runStart, endKey: key };
      }
    } else {
      runStart = null;
      runLength = 0;
    }
  }

  let busiestMonth: ActivitySummary['busiestMonth'] = null;
  for (const [month, count] of months) {
    if (!busiestMonth || count > busiestMonth.count) {
      const [year, index] = month.split('-').map(Number);
      busiestMonth = { label: `${MONTHS_LONG[index - 1]} ${year}`, count };
    }
  }

  return { total, activeDays, windowDays: keys.length, busiestDay, longestStreak, busiestMonth };
}
