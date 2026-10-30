/**
 * The narrow storage interface the BFF needs, so the backing database is a
 * configuration choice rather than an architectural one.
 *
 * SERVER ONLY.
 *
 * Only the PostgREST driver ships. It is ~150 lines of `fetch` and takes no
 * package: PostgREST is a plain REST API, and adding `@supabase/supabase-js`
 * for it would mean a second runtime dependency for no capability.
 *
 * A fork that wants plain Postgres (Neon, or self-hosted — worth doing, since
 * a free-tier Supabase project pauses after about a week of inactivity and a
 * paused project is a sign-in outage) implements this same interface over `pg`
 * and selects it with ATURI_DB_DRIVER. That driver is not bundled here because
 * `pg` would be a dependency this repository has not taken.
 */

export type Row = Record<string, unknown>;

/** Equality filters. Every query the BFF makes is `column = value`. */
export type Where = Record<string, string>;

export interface StoreDriver {
  /** First matching row, or null. */
  selectOne(table: string, where: Where, columns?: string): Promise<Row | null>;
  /** All matching rows. */
  select(table: string, where: Where, columns?: string): Promise<Row[]>;
  /** Insert, or update the row that collides on `onConflict` (a column list). */
  upsert(table: string, row: Row, onConflict?: string): Promise<void>;
  /** Insert without an upsert path; rejects on primary-key collision. */
  insert(table: string, row: Row): Promise<void>;
  /** Update matching rows. */
  update(table: string, where: Where, patch: Row): Promise<void>;
  /** Delete matching rows. */
  remove(table: string, where: Where): Promise<void>;
  /** Call a database function. */
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
}

/** Tables, named once so a typo is a compile error rather than a 404. */
export const TABLE = {
  oauthSessions: 'oauth_sessions',
  oauthState: 'oauth_state',
  appSessions: 'app_sessions',
  exchangeCodes: 'exchange_codes',
  spaceConsents: 'space_consents',
  rateLimits: 'rate_limits',
} as const;
