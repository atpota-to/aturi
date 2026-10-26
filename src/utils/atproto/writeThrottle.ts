/**
 * Client-side pacing for AT Protocol repo writes.
 *
 * Bluesky's PDS rate-limits writes on a points budget: CREATE = 3, UPDATE = 2,
 * DELETE = 1 point, capped at 5,000 points/hour (and 35,000/day) per account.
 * `applyWrites` batching cuts the *request* count but still spends one point
 * per operation, so a large bulk delete can exhaust the hourly budget and 429.
 *
 * This tracks points spent per DID in a rolling one-hour window (persisted to
 * localStorage so it survives reloads and spans tabs/collections) and answers
 * "how long until spending N more points stays under budget?" Callers pace
 * their batches against it so they never trip the limit, keeping the reactive
 * 429 handler as a backstop for the abnormal case (e.g. writes from elsewhere).
 */

export const POINTS_WINDOW_MS = 60 * 60 * 1000; // rolling one hour

/** Bluesky's real hourly ceiling — exported for user-facing copy. */
export const HOURLY_POINT_BUDGET = 5000;

/**
 * We pace to stay under this rather than the true 5,000, leaving headroom for
 * clock skew and any other writes the account makes, so the reactive 429 stop
 * effectively never has to fire.
 */
export const THROTTLE_POINT_BUDGET = 4500;

/** Point cost of a single delete — one applyWrites#delete op. */
export const DELETE_POINT_COST = 1;

type Spend = { t: number; n: number };

function storageKey(did: string): string {
  return `aturi:writeSpend:${did}`;
}

function readSpends(did: string): Spend[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(did));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is Spend =>
        !!s && typeof s.t === 'number' && typeof s.n === 'number' && s.n > 0,
    );
  } catch {
    return [];
  }
}

function writeSpends(did: string, spends: Spend[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(did), JSON.stringify(spends));
  } catch {
    // Quota hit or storage disabled — pacing degrades to the 429 backstop.
  }
}

/** Drop spends that have aged out of the trailing window. */
function prune(spends: Spend[], now: number): Spend[] {
  const cutoff = now - POINTS_WINDOW_MS;
  return spends.filter((s) => s.t > cutoff);
}

/** Points spent in the trailing hour for this DID. */
export function pointsSpent(did: string, now: number = Date.now()): number {
  return prune(readSpends(did), now).reduce((sum, s) => sum + s.n, 0);
}

/** Points still available under the throttle budget right now. */
export function pointsAvailable(did: string, now: number = Date.now()): number {
  return Math.max(0, THROTTLE_POINT_BUDGET - pointsSpent(did, now));
}

/** Record that `points` write-points were just spent. */
export function recordSpend(did: string, points: number, now: number = Date.now()): void {
  if (points <= 0) return;
  const spends = prune(readSpends(did), now);
  spends.push({ t: now, n: points });
  writeSpends(did, spends);
}

/**
 * Milliseconds to wait before spending `needed` more points keeps the
 * trailing-hour total at or under the throttle budget. 0 when there's room
 * right now. Assumes `needed` <= THROTTLE_POINT_BUDGET (true for one batch).
 */
export function msUntilBudget(did: string, needed: number, now: number = Date.now()): number {
  const spends = prune(readSpends(did), now).sort((a, b) => a.t - b.t);
  const spent = spends.reduce((sum, s) => sum + s.n, 0);
  if (spent + needed <= THROTTLE_POINT_BUDGET) return 0;
  // Each spend frees its points when it ages out at s.t + POINTS_WINDOW_MS.
  // Walk oldest-first until enough has freed to fit `needed` under budget.
  const mustFree = spent + needed - THROTTLE_POINT_BUDGET;
  let freed = 0;
  for (const s of spends) {
    freed += s.n;
    if (freed >= mustFree) return Math.max(0, s.t + POINTS_WINDOW_MS - now);
  }
  // Unreachable while needed <= budget, but stay safe: wait for a full window.
  return spends.length ? Math.max(0, spends[spends.length - 1].t + POINTS_WINDOW_MS - now) : 0;
}
