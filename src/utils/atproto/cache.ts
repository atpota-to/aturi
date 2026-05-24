/**
 * In-memory TTL cache used by hot-path resolvers (PLC documents, audit logs)
 * so multi-tab exploration doesn't hammer external services. Module-singletons
 * reset on cold serverless invocations and on each browser tab reload.
 */

export class TTLMap<K, V> {
  private store = new Map<K, { value: V; expires: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
