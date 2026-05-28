/**
 * Supabase-backed storage for the confidential OAuth backend.
 *
 * Three stores, all keyed in the shared `atpota.to` Supabase project under
 * `aturi_*` table names (namespaced so they never collide with Anisota
 * Cocoon's `oauth_*` tables in the same project):
 *
 *   - SupabaseSessionStore   → aturi_oauth_sessions   (OAuth tokens, by DID)
 *   - SupabaseStateStore     → aturi_oauth_state      (CSRF state, 1h TTL)
 *   - FrontendSessionStore   → aturi_frontend_sessions(opaque 30-day tokens)
 *
 * Ported from anisota-cocoon/lib/oauth-storage.js. Server-only.
 */

import { randomBytes } from 'node:crypto';
import type {
  NodeSavedSession,
  NodeSavedSessionStore,
  NodeSavedState,
  NodeSavedStateStore,
} from '@atproto/oauth-client-node';
import { getSupabaseClient } from './supabaseClient';

const SESSIONS_TABLE = 'aturi_oauth_sessions';
const STATE_TABLE = 'aturi_oauth_state';
const FRONTEND_TABLE = 'aturi_frontend_sessions';

/**
 * Stores the @atproto/oauth-client-node session blob (access + refresh tokens,
 * DPoP key) keyed by user DID.
 */
class SupabaseSessionStore implements NodeSavedSessionStore {
  async get(sub: string): Promise<NodeSavedSession | undefined> {
    const supabase = getSupabaseClient();
    if (!supabase) return undefined;

    const { data, error } = await supabase
      .from(SESSIONS_TABLE)
      .select('session_data')
      .eq('sub', sub)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') {
        console.error('[SessionStore] get error:', error.message);
      }
      return undefined;
    }
    return data?.session_data as NodeSavedSession | undefined;
  }

  async set(sub: string, session: NodeSavedSession): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const { error } = await supabase
      .from(SESSIONS_TABLE)
      .upsert(
        { sub, session_data: session, updated_at: new Date().toISOString() },
        { onConflict: 'sub' },
      );
    if (error) throw error;
  }

  /**
   * INTENTIONAL NO-OP for library-initiated deletes.
   *
   * @atproto/oauth-client-node calls del() when a token refresh fails, but on
   * serverless those failures are often transient (cold-start DPoP races, a
   * concurrent instance that already rotated the tokens). Dropping the row here
   * would force a needless re-auth even though another instance may hold good
   * tokens. If the tokens are truly dead, the next restore also fails and the
   * frontend surfaces a re-sign-in. Real user logouts call forceDelete().
   */
  async del(sub: string): Promise<void> {
    console.warn(`[SessionStore] ignoring library delete for ${sub} (kept for recovery)`);
  }

  /** Actually delete a session — only for explicit user-initiated logout. */
  async forceDelete(sub: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.from(SESSIONS_TABLE).delete().eq('sub', sub);
    if (error) console.error('[SessionStore] forceDelete error:', error.message);
  }
}

/** Short-lived OAuth flow state (CSRF protection), 1-hour TTL. */
class SupabaseStateStore implements NodeSavedStateStore {
  async get(key: string): Promise<NodeSavedState | undefined> {
    const supabase = getSupabaseClient();
    if (!supabase) return undefined;

    const { data, error } = await supabase
      .from(STATE_TABLE)
      .select('state_data, expires_at')
      .eq('key', key)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') {
        console.error('[StateStore] get error:', error.message);
      }
      return undefined;
    }

    if (data && new Date(data.expires_at) < new Date()) {
      await this.del(key);
      return undefined;
    }
    return data?.state_data as NodeSavedState | undefined;
  }

  async set(key: string, state: NodeSavedState): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from(STATE_TABLE)
      .upsert({ key, state_data: state, expires_at: expiresAt }, { onConflict: 'key' });
    if (error) throw error;
  }

  async del(key: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.from(STATE_TABLE).delete().eq('key', key);
    if (error) console.error('[StateStore] del error:', error.message);
  }
}

export type FrontendValidation = { userDid: string | null; error: string | null };

/**
 * Opaque 30-day tokens the frontend uses to authenticate to /api/oauth/*.
 * These map a random token → user DID; they are NOT the OAuth tokens.
 */
class FrontendSessionStore {
  generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  async create(userDid: string, expiresInDays = 30): Promise<string> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from(FRONTEND_TABLE)
      .insert({ token, user_did: userDid, expires_at: expiresAt });
    if (error) throw error;
    return token;
  }

  /**
   * Validate a token, distinguishing "definitively not found / expired"
   * (`userDid: null, error: null`) from "transient backend failure"
   * (`userDid: null, error: <code>`) so callers don't drop a valid session on
   * a Supabase hiccup. Retries transient failures.
   */
  async validateWithDetails(token: string): Promise<FrontendValidation> {
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));

        const supabase = getSupabaseClient();
        if (!supabase) {
          if (attempt < MAX_RETRIES) continue;
          return { userDid: null, error: 'SUPABASE_UNAVAILABLE' };
        }

        const { data, error } = await supabase
          .from(FRONTEND_TABLE)
          .select('user_did, expires_at')
          .eq('token', token)
          .single();

        if (error) {
          if (error.code === 'PGRST116') return { userDid: null, error: null };
          if (attempt < MAX_RETRIES) continue;
          return { userDid: null, error: 'QUERY_ERROR' };
        }

        if (data && new Date(data.expires_at) < new Date()) {
          await this.delete(token);
          return { userDid: null, error: null };
        }
        return { userDid: data.user_did as string, error: null };
      } catch {
        if (attempt < MAX_RETRIES) continue;
        return { userDid: null, error: 'EXCEPTION' };
      }
    }
    return { userDid: null, error: 'MAX_RETRIES_EXCEEDED' };
  }

  async validate(token: string): Promise<string | null> {
    const { userDid } = await this.validateWithDetails(token);
    return userDid;
  }

  async delete(token: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.from(FRONTEND_TABLE).delete().eq('token', token);
    if (error) console.error('[FrontendSessionStore] delete error:', error.message);
  }

  async deleteAllForUser(userDid: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.from(FRONTEND_TABLE).delete().eq('user_did', userDid);
    if (error) console.error('[FrontendSessionStore] deleteAllForUser error:', error.message);
  }
}

/**
 * In-memory lock to serialize operations on a key WITHIN a single serverless
 * instance (prevents same-instance refresh stampedes). Cross-instance races are
 * handled by the retry logic in the route handlers.
 */
class MemoryLock {
  private locks = new Map<string, true>();

  async lock<T>(key: string, fn: () => T | PromiseLike<T>): Promise<T> {
    while (this.locks.has(key)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    this.locks.set(key, true);
    try {
      return await fn();
    } finally {
      this.locks.delete(key);
    }
  }
}

export const sessionStore = new SupabaseSessionStore();
export const stateStore = new SupabaseStateStore();
export const frontendSessionStore = new FrontendSessionStore();

const memoryLock = new MemoryLock();
export const requestLock = <T>(key: string, fn: () => T | PromiseLike<T>): Promise<T> =>
  memoryLock.lock(key, fn);
