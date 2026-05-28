/**
 * Supabase service-role client singleton for the confidential OAuth backend.
 *
 * Uses the service-role key (admin, bypasses RLS) and never persists/refreshes
 * an auth session of its own — it's a pure server-side data client for the
 * `aturi_oauth_sessions` / `aturi_oauth_state` / `aturi_frontend_sessions`
 * tables. Server-only.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseServiceKey } from './config';

let supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (supabase) return supabase;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.warn('[oauth/supabase] SUPABASE_URL / SUPABASE_SERVICE_KEY not configured');
    return null;
  }

  supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'public' },
  });
  return supabase;
}

export function isSupabaseAvailable(): boolean {
  return !!supabaseUrl && !!supabaseServiceKey;
}
