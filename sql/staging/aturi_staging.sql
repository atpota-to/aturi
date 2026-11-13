-- ============================================================================
-- staging/aturi_staging.sql — aturi.to's own staging schema. Forks skip this.
--
-- testing.aturi.to is a branch domain on the same Vercel project and the same
-- Supabase project as aturi.to, so it needs its own tables. It cannot share
-- `aturi`: oauth_sessions is keyed (sub, client) with no notion of which site
-- issued the grant, so a sign-in on staging would overwrite that person's
-- production grant — a grant issued to a different client_id, sealed under a
-- different key — and sign them out of aturi.to.
--
-- This is sql/001_oauth_bff.sql followed by sql/002_cron_supabase.sql with the
-- schema renamed to `aturi_staging` and the sweep job renamed to match, nothing
-- else. Staging points at it with ATURI_DB_SCHEMA=aturi_staging, and it must be
-- added to Supabase's exposed schemas just as `aturi` is. If 001 or 002 change,
-- change this file the same way.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS aturi_staging;


-- ---------------------------------------------------------------------------
-- 1. The ATProto grant.
--
-- Keyed (sub, client) rather than by DID alone. ATProto refresh tokens are
-- single-use and rotating, so every extra client sharing one grant multiplies
-- the chance of two concurrent refreshes destroying each other's tokens. Split
-- grants also make "sign out the extension" a local delete that leaves the web
-- session and the PDS grant untouched, and let each client request its own
-- scopes.
--
-- session_data is an AES-256-GCM envelope, sealed under a key that lives in
-- the application's environment and not beside the database credential.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aturi_staging.oauth_sessions (
  sub           text NOT NULL,
  client        text NOT NULL CHECK (client IN ('web','extension')),
  session_data  jsonb NOT NULL,
  granted_scope text,          -- denormalised tokenSet.scope
  pds           text,          -- denormalised tokenSet.aud
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sub, client)
);

-- ---------------------------------------------------------------------------
-- 2. In-flight authorization state: PKCE verifier, nonce, and the ephemeral
--    DPoP PRIVATE key. Also sealed — this is not merely bookkeeping.
--
--    There is no separate CSRF column: the browser-binding nonce is carried
--    inside the application state, which lives inside the sealed envelope, so
--    it cannot be read or forged from the database side either.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aturi_staging.oauth_state (
  key        text PRIMARY KEY,
  state_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE INDEX IF NOT EXISTS oauth_state_expires_idx ON aturi_staging.oauth_state (expires_at);

-- ---------------------------------------------------------------------------
-- 3. App sessions — what a browser or the extension actually holds.
--
--    Only sha256(token) is stored, so a database dump yields nothing
--    replayable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aturi_staging.app_sessions (
  token_sha256 text PRIMARY KEY,
  user_did     text NOT NULL,
  client       text NOT NULL CHECK (client IN ('web','extension')),
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS app_sessions_did_idx     ON aturi_staging.app_sessions (user_did, client);
CREATE INDEX IF NOT EXISTS app_sessions_expires_idx ON aturi_staging.app_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- 4. One-time codes for the extension hand-off.
--
--    challenge_b64 is base64url(SHA-256(verifier)). Redemption requires the
--    verifier, which is what makes the hand-off safe: an extension's redirect
--    URL cannot authenticate it (Firefox randomises the host per install, and
--    a Chrome id is unstable until publication), so the code alone must be
--    worthless to whoever observes it.
--
--    No token is stored here. The session is minted when the code is redeemed,
--    so this table never holds a credential — which is the same rule
--    app_sessions follows by storing only a hash.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aturi_staging.exchange_codes (
  code_sha256   text PRIMARY KEY,
  challenge_b64 text NOT NULL,
  user_did      text NOT NULL,
  expires_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS exchange_codes_expires_idx ON aturi_staging.exchange_codes (expires_at);

-- ---------------------------------------------------------------------------
-- 5. Which space authorities a session has consented to ask on the user's
--    behalf. Server-side because a consent flag in a request body is set by
--    whoever makes the request and therefore enforces nothing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aturi_staging.space_consents (
  session_sha256 text NOT NULL,
  authority_did  text NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_sha256, authority_did)
);

-- ---------------------------------------------------------------------------
-- 6. Cross-instance refresh lock.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aturi_staging.oauth_locks (
  key         text PRIMARY KEY,
  holder      text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_locks_expires_idx ON aturi_staging.oauth_locks (expires_at);

-- ---------------------------------------------------------------------------
-- 7. Rate limiting. Counted in the database rather than per instance, because
--    a per-instance counter on a serverless platform is not a limit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aturi_staging.rate_limits (
  bucket       text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON aturi_staging.rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aturi_staging.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
  BEGIN NEW.updated_at = now(); RETURN NEW; END $fn$;

DROP TRIGGER IF EXISTS oauth_sessions_touch ON aturi_staging.oauth_sessions;
CREATE TRIGGER oauth_sessions_touch BEFORE UPDATE ON aturi_staging.oauth_sessions
  FOR EACH ROW EXECUTE FUNCTION aturi_staging.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Access control.
--
-- Note what actually protects these tables. The backend connects with the
-- service role, which carries BYPASSRLS — so RLS is NOT the control here. The
-- REVOKEs are: exposing a schema to the Data API also exposes it to the
-- anonymous key, and these grants are what stop that. RLS is enabled (and
-- FORCEd, which also binds the table owner) as a second layer.
-- ---------------------------------------------------------------------------
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['oauth_sessions','oauth_state','app_sessions',
                           'exchange_codes','space_consents','oauth_locks','rate_limits']
  LOOP
    EXECUTE format('ALTER TABLE aturi_staging.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE aturi_staging.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $rls$;

-- Guarded on role existence: anon, authenticated and service_role are
-- Supabase's, and naming a role that does not exist aborts the whole
-- migration. A fork on Neon or plain Postgres connects as an ordinary owner,
-- where there is no anonymous role to revoke from and nothing to grant.
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA aturi_staging FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA aturi_staging FROM %I', r);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA aturi_staging REVOKE ALL ON TABLES FROM %I', r);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA aturi_staging TO service_role';
    EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA aturi_staging TO service_role';
  END IF;
END $grants$;

-- ---------------------------------------------------------------------------
-- Lock functions.
--
-- The CTE with RETURNING is load-bearing: a row comes back only when the
-- INSERT or the guarded UPDATE actually fired, so there is no second read for
-- a rival instance to win in between. The reference implementation does an
-- upsert and then a separate `SELECT holder`, which under READ COMMITTED takes
-- a fresh snapshot and can report success to two holders at once — turning the
-- lock into a no-op exactly when it is contended.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aturi_staging.acquire_oauth_lock(p_key text, p_holder text, p_ttl_seconds int)
RETURNS boolean LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, aturi_staging, pg_temp AS $acq$
  WITH upsert AS (
    INSERT INTO aturi_staging.oauth_locks (key, holder, acquired_at, expires_at)
    VALUES (p_key, p_holder, now(), now() + make_interval(secs => p_ttl_seconds))
    ON CONFLICT (key) DO UPDATE
      SET holder = excluded.holder,
          acquired_at = excluded.acquired_at,
          expires_at = excluded.expires_at
      WHERE aturi_staging.oauth_locks.expires_at < now()
    RETURNING holder
  )
  SELECT EXISTS (SELECT 1 FROM upsert WHERE holder = p_holder);
$acq$;

CREATE OR REPLACE FUNCTION aturi_staging.release_oauth_lock(p_key text, p_holder text)
RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, aturi_staging, pg_temp AS $rel$
  DELETE FROM aturi_staging.oauth_locks WHERE key = p_key AND holder = p_holder;
$rel$;

-- Atomic counter increment; returns the new count for this window.
CREATE OR REPLACE FUNCTION aturi_staging.bump_rate_limit(p_bucket text, p_window_start timestamptz)
RETURNS integer LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, aturi_staging, pg_temp AS $bump$
  INSERT INTO aturi_staging.rate_limits (bucket, window_start, hits)
  VALUES (p_bucket, p_window_start, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE
    SET hits = aturi_staging.rate_limits.hits + 1
  RETURNING hits;
$bump$;

REVOKE EXECUTE ON FUNCTION aturi_staging.acquire_oauth_lock(text,text,int),
                           aturi_staging.release_oauth_lock(text,text),
                           aturi_staging.bump_rate_limit(text,timestamptz)
  FROM public;

DO $fngrants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION aturi_staging.acquire_oauth_lock(text,text,int), '
        'aturi_staging.release_oauth_lock(text,text), aturi_staging.bump_rate_limit(text,timestamptz) '
        'FROM %I', r);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION aturi_staging.acquire_oauth_lock(text,text,int), '
            'aturi_staging.release_oauth_lock(text,text), aturi_staging.bump_rate_limit(text,timestamptz) '
            'TO service_role';
  END IF;
END $fngrants$;

SELECT cron.schedule('aturi-staging-oauth-sweep', '*/15 * * * *', $sweep$
  DELETE FROM aturi_staging.oauth_state    WHERE expires_at < now();
  DELETE FROM aturi_staging.app_sessions   WHERE expires_at < now();
  DELETE FROM aturi_staging.exchange_codes WHERE expires_at < now();
  DELETE FROM aturi_staging.oauth_locks    WHERE expires_at < now() - interval '5 minutes';
  DELETE FROM aturi_staging.rate_limits    WHERE window_start < now() - interval '1 day';

  -- A grant nobody has used in three months holds a live refresh token for an
  -- account that stopped using the app. Deleting it costs that user one
  -- re-authorization if they come back, and removes a standing credential if
  -- they do not. Deliberately generous: this is the one table whose rows are
  -- expensive to recreate.
  DELETE FROM aturi_staging.oauth_sessions WHERE updated_at < now() - interval '90 days';

  -- NOT EXISTS, not NOT IN: `NOT IN` against a subquery that yields any NULL
  -- evaluates to NULL for every row and deletes nothing, so consents would
  -- silently outlive the sessions that granted them.
  DELETE FROM aturi_staging.space_consents sc
    WHERE NOT EXISTS (
      SELECT 1 FROM aturi_staging.app_sessions a WHERE a.token_sha256 = sc.session_sha256
    );
$sweep$);
