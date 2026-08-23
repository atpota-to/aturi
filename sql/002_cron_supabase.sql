-- ============================================================================
-- 002_cron_supabase.sql — expiry sweep. SUPABASE (or any pg_cron host) ONLY.
--
-- Kept separate from 001 on purpose: `cron.schedule` errors on a Postgres
-- without pg_cron, which is exactly the Neon / self-hosted case a fork is most
-- likely to be on. Skip this file there and run the same statements from
-- whatever scheduler you have.
--
-- Sweeping is not optional housekeeping. The reference deployment has never
-- swept: its oauth_state is 100% expired rows, and its session table is ~90%
-- expired — thousands of dead 30-day bearer tokens sitting in a database
-- indefinitely.
-- ============================================================================

SELECT cron.schedule('aturi-oauth-sweep', '*/15 * * * *', $sweep$
  DELETE FROM aturi.oauth_state    WHERE expires_at < now();
  DELETE FROM aturi.app_sessions   WHERE expires_at < now();
  DELETE FROM aturi.exchange_codes WHERE expires_at < now();
  DELETE FROM aturi.oauth_locks    WHERE expires_at < now() - interval '5 minutes';
  DELETE FROM aturi.rate_limits    WHERE window_start < now() - interval '1 day';

  -- NOT EXISTS, not NOT IN: `NOT IN` against a subquery that yields any NULL
  -- evaluates to NULL for every row and deletes nothing, so consents would
  -- silently outlive the sessions that granted them.
  DELETE FROM aturi.space_consents sc
    WHERE NOT EXISTS (
      SELECT 1 FROM aturi.app_sessions a WHERE a.token_sha256 = sc.session_sha256
    );
$sweep$);
