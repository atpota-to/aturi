/**
 * PostgREST storage driver — plain `fetch`, no client library.
 *
 * SERVER ONLY.
 *
 * One trap worth stating loudly, because the symptom is that every query 404s
 * while the code looks correct: PostgREST only serves schemas listed in the
 * project's exposed-schemas setting. The `aturi` schema is NOT exposed by
 * default. Add it under Supabase Settings → API → Exposed schemas, or nothing
 * here can see a table.
 *
 * `Accept-Profile` selects the schema on reads and `Content-Profile` on
 * writes; they are not interchangeable, and sending the wrong one silently
 * falls back to `public`.
 */

import type { Row, StoreDriver, Where } from './driver';

export class PostgrestDriver implements StoreDriver {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
    private readonly schema: string,
  ) {}

  private headers(kind: 'read' | 'write', extra?: Record<string, string>) {
    return {
      apikey: this.serviceKey,
      authorization: `Bearer ${this.serviceKey}`,
      [kind === 'read' ? 'accept-profile' : 'content-profile']: this.schema,
      'content-type': 'application/json',
      ...extra,
    };
  }

  private url(table: string, where?: Where, columns?: string): string {
    const u = new URL(`${this.baseUrl}/rest/v1/${table}`);
    if (columns) u.searchParams.set('select', columns);
    for (const [k, v] of Object.entries(where ?? {})) {
      // Every value is double-quoted, which is how PostgREST wants an operand
      // that could contain one of its reserved characters (comma, parenthesis,
      // dot, whitespace). No value that reaches here today can — DIDs exclude
      // them by grammar, hashes are hex, and `client` is a checked enum — but
      // the escaping rule belongs to the layer that builds the query rather
      // than to the charset of whatever happens to call it.
      u.searchParams.set(k, `eq."${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    }
    return u.toString();
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const res = await fetch(url, init);
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // Never echo the row body — these tables hold sealed tokens.
      throw new StoreError(
        `PostgREST ${init.method ?? 'GET'} ${new URL(url).pathname} → ${res.status}`,
        res.status,
        detail.slice(0, 300),
      );
    }
    return res;
  }

  async select(table: string, where: Where, columns = '*'): Promise<Row[]> {
    const res = await this.request(this.url(table, where, columns), {
      method: 'GET',
      headers: this.headers('read'),
    });
    return (await res.json()) as Row[];
  }

  async selectOne(table: string, where: Where, columns = '*'): Promise<Row | null> {
    const rows = await this.select(table, where, columns);
    return rows[0] ?? null;
  }

  async upsert(table: string, row: Row, onConflict?: string): Promise<void> {
    const u = new URL(`${this.baseUrl}/rest/v1/${table}`);
    if (onConflict) u.searchParams.set('on_conflict', onConflict);
    await this.request(u.toString(), {
      method: 'POST',
      headers: this.headers('write', {
        prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify(row),
    });
  }

  async insert(table: string, row: Row): Promise<void> {
    await this.request(this.url(table), {
      method: 'POST',
      headers: this.headers('write', { prefer: 'return=minimal' }),
      body: JSON.stringify(row),
    });
  }

  async update(table: string, where: Where, patch: Row): Promise<void> {
    await this.request(this.url(table, where), {
      method: 'PATCH',
      headers: this.headers('write', { prefer: 'return=minimal' }),
      body: JSON.stringify(patch),
    });
  }

  async remove(table: string, where: Where): Promise<void> {
    await this.request(this.url(table, where), {
      method: 'DELETE',
      headers: this.headers('write', { prefer: 'return=minimal' }),
    });
  }

  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const res = await this.request(`${this.baseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: this.headers('write'),
      body: JSON.stringify(args),
    });
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}
