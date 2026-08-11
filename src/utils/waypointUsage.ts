/**
 * Which clients this browser actually opens records in.
 *
 * A preference the user never sets is worth more than a preference they set
 * badly, and the cheapest way to learn one is to watch what they already do:
 * three trips to Blacksky is a stronger signal than an answer typed into a
 * setup wizard six months ago. This module counts those trips so the picker
 * can offer to turn the pattern into a rule.
 *
 * **Local only, and deliberately so.** Counts stay in this browser's
 * localStorage and are never written to the PDS or sent anywhere. They are a
 * record of what you have read, which is exactly the kind of thing Aturi
 * promises not to collect (see `extension/PRIVACY.txt`); the preference they
 * produce is the part that syncs, and only once you have agreed to it.
 */

const LS_KEY = 'aturi.usage.v1';

/** Beyond this, older entries are dropped oldest-last-used first. */
const MAX_ENTRIES = 40;

export type UsageStore = {
  /** `${questionId}|${waypointId}` -> how many times it was opened. */
  counts: Record<string, number>;
  /** Same key. ISO timestamp of the most recent open, for pruning. */
  lastAt: Record<string, string>;
  /**
   * Suggestions the user has waved away, so the picker stops asking. Keyed by
   * question id, since declining "make Blacksky your default" is a statement
   * about the question, not about Blacksky.
   */
  declined: string[];
};

const EMPTY: UsageStore = { counts: {}, lastAt: {}, declined: [] };

function key(questionId: string, waypointId: string): string {
  return `${questionId}|${waypointId}`;
}

export function readUsage(): UsageStore {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<UsageStore>;
    return {
      counts: isRecordOf(parsed.counts, 'number') ? parsed.counts : {},
      lastAt: isRecordOf(parsed.lastAt, 'string') ? parsed.lastAt : {},
      declined: Array.isArray(parsed.declined)
        ? parsed.declined.filter((d): d is string => typeof d === 'string')
        : [],
    };
  } catch {
    return EMPTY;
  }
}

function isRecordOf(v: unknown, type: 'number' | 'string'): v is Record<string, never> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === type);
}

function writeUsage(store: UsageStore): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(prune(store)));
  } catch {
    // Quota or disabled storage. Losing a click count is not worth a throw.
  }
}

/** Keep the store bounded by dropping the least recently used entries. */
function prune(store: UsageStore): UsageStore {
  const keys = Object.keys(store.counts);
  if (keys.length <= MAX_ENTRIES) return store;
  const ordered = keys.sort(
    (a, b) => (store.lastAt[b] ?? '').localeCompare(store.lastAt[a] ?? ''),
  );
  const keep = new Set(ordered.slice(0, MAX_ENTRIES));
  const counts: Record<string, number> = {};
  const lastAt: Record<string, string> = {};
  for (const k of keep) {
    counts[k] = store.counts[k];
    if (store.lastAt[k]) lastAt[k] = store.lastAt[k];
  }
  return { ...store, counts, lastAt };
}

/** Record one open. Returns the new count for that pairing. */
export function recordWaypointOpen(questionId: string, waypointId: string): number {
  const store = readUsage();
  const k = key(questionId, waypointId);
  const next = (store.counts[k] ?? 0) + 1;
  writeUsage({
    ...store,
    counts: { ...store.counts, [k]: next },
    lastAt: { ...store.lastAt, [k]: new Date().toISOString() },
  });
  return next;
}

export function openCount(questionId: string, waypointId: string): number {
  return readUsage().counts[key(questionId, waypointId)] ?? 0;
}

/** Stop offering to set a default for this question. */
export function declineSuggestion(questionId: string): void {
  const store = readUsage();
  if (store.declined.includes(questionId)) return;
  writeUsage({ ...store, declined: [...store.declined, questionId] });
}

export function hasDeclined(questionId: string): boolean {
  return readUsage().declined.includes(questionId);
}

/**
 * Clicks needed before offering to make a client the default.
 *
 * One when the question is unanswered: the user just chose a client for a
 * record with no rule behind it, which is the whole question being answered
 * in the most direct way available, and asking at that moment costs them a
 * glance.
 *
 * Three when a different client is already the answer. That answer was
 * deliberate, so a single stray click is not evidence against it; a habit is.
 */
export function suggestionThreshold(hasExistingAnswer: boolean): number {
  return hasExistingAnswer ? 3 : 1;
}
