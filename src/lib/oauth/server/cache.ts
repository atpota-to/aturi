/**
 * Per-instance TTL cache.
 *
 * SERVER ONLY.
 *
 * Two of these carry the BFF's request path: token-hash → session row, and
 * (client, did) → restored OAuthSession. The second is what turns the
 * cross-instance refresh lock from a per-request cost into a per-refresh one.
 *
 * Every caller must tolerate a miss — that is what makes these
 * correctness-neutral, and the discipline is worth keeping. Eviction at `max`
 * clears the whole map rather than tracking recency: entries are cheap to
 * recompute and LRU bookkeeping on a serverless instance that lives for
 * minutes is not worth its own bugs.
 */

type Entry<V> = { value: V; expiresAt: number };

export class TtlCache<V> {
  private readonly map = new Map<string, Entry<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly max: number,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.map.size >= this.max) this.map.clear();
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  deleteWhere(predicate: (key: string, value: V) => boolean): void {
    for (const [k, v] of this.map) {
      if (predicate(k, v.value)) this.map.delete(k);
    }
  }
}

const CACHE_TTL_MS = 60_000;

/** token sha256 → the app session it identifies. */
export const appSessionCache = new TtlCache<{
  userDid: string;
  client: string;
  expiresAt: number;
}>(CACHE_TTL_MS, 10_000);
