/**
 * The refresh lock. SERVER ONLY.
 *
 * ATProto refresh tokens are single-use and rotating, and the PDS invalidates
 * the previous access token the instant one rotates. Two serverless instances
 * refreshing the same grant therefore destroy each other's tokens: one wins,
 * the rest fail with "Invalid token". The symptom reads as a session-expiry
 * bug — users randomly signed out at app launch — which is why this machinery
 * exists at all and why it is worth porting with its reasoning intact.
 *
 * Keying grants by (did, client) already removes the cross-client half of the
 * problem: the web app and the extension hold separate grants and cannot race
 * each other. What remains is genuine concurrency within one client, handled
 * in two tiers:
 *
 *   L1, in-process: collapses same-instance concurrency to one waiter, so an
 *       instance makes at most one distributed acquisition per key at a time.
 *   L2, in Postgres: serialises across instances.
 *
 * Both fail open. Blocking authentication is worse than a rare double refresh,
 * and waiting usually pays off even when acquisition never succeeds — by the
 * time the wait times out, the holder has typically written its rotated tokens
 * and the loser's next read is fresh.
 */

import { randomUUID } from 'node:crypto';
import { getStore } from './store';

const TTL_SECONDS = 20;
const MAX_WAIT_MS = 6_000;
const POLL_MIN_MS = 75;
const POLL_MAX_MS = 250;

/**
 * L1. A per-key promise chain, not the reference implementation's
 * `while (locks.has(key)) await sleep(10)` over an unbounded Map — that
 * busy-waits with no ceiling and never evicts.
 */
const chains = new Map<string, Promise<unknown>>();

function withLocalLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = chains.get(key) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  // Keep the chain from growing without bound, and never let a rejection
  // poison the next waiter.
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return run;
}

async function withDbLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let store;
  try {
    store = getStore();
  } catch {
    return fn(); // unconfigured — nothing to serialise against
  }

  const holder = randomUUID();
  const deadline = Date.now() + MAX_WAIT_MS;
  let acquired = false;

  while (Date.now() < deadline) {
    try {
      const got = await store.rpc<boolean>('acquire_oauth_lock', {
        p_key: key,
        p_holder: holder,
        p_ttl_seconds: TTL_SECONDS,
      });
      if (got === true) {
        acquired = true;
        break;
      }
    } catch {
      // Lock infrastructure is unavailable. Proceed unserialised rather than
      // failing the request.
      break;
    }
    const jitter = POLL_MIN_MS + Math.floor(Math.random() * (POLL_MAX_MS - POLL_MIN_MS));
    await new Promise((r) => setTimeout(r, jitter));
  }

  try {
    return await fn();
  } finally {
    if (acquired) {
      try {
        await store.rpc('release_oauth_lock', { p_key: key, p_holder: holder });
      } catch {
        // The TTL expires it anyway; a failed release must not surface.
      }
    }
  }
}

/**
 * What `NodeOAuthClient` receives as `requestLock`. The library wraps its
 * session critical section — the token refresh — in this.
 */
export function requestLock<T>(key: string, fn: () => T | PromiseLike<T>): Promise<T> {
  return withLocalLock(key, () => withDbLock(key, async () => fn()));
}
