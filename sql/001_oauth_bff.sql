-- ============================================================================
-- 001_oauth_bff.sql — schema for the backend (BFF) OAuth client.
--
-- Apply once, to the database named by ATURI_DB_URL. On Supabase you must ALSO
-- add the `aturi` schema under Settings → API → Exposed schemas, or PostgREST
-- cannot see any of these tables and every query 404s while the code looks
-- correct.
--
-- Nothing here is required to run aturi. With the BFF environment variables
-- unset the app uses the public browser OAuth client it always has, and none
-- of this exists.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS aturi;

-- Empty scaffolding from an earlier exploration. The aturi_ prefix is
-- redundant inside a schema that is already called aturi.
DROP TABLE IF EXISTS aturi.aturi_oauth_sessions,
                     aturi.aturi_oauth_state,
                     aturi.aturi_frontend_sessions;

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
CREATE TABLE IF NOT EXISTS aturi.oauth_sessions (
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
CREATE TABLE IF NOT EXISTS aturi.oauth_state (
  key        text PRIMARY KEY,
  state_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE INDEX IF NOT EXISTS oauth_state_expires_idx ON aturi.oauth_state (expires_at);

-- ---------------------------------------------------------------------------
-- 3. App sessions — what a browser or the extension actually holds.
--
--    Only sha256(token) is stored, so a database dump yields nothing
--    replayable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aturi.app_sessions (
  token_sha256 text PRIMARY KEY,
  user_did     text NOT NULL,
  client       text NOT NULL CHECK (client IN ('web','extension')),
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS app_sessions_did_idx     ON aturi.app_sessions (user_did, client);
CREATE INDEX IF NOT EXISTS app_sessions_expires_idx ON aturi.app_sessions (expires_at);

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
CREATE TABLE IF NOT EXISTS aturi.exchange_codes (
  code_sha256   text PRIMARY KEY,
  challenge_b64 text NOT NULL,
  user_did      text NOT NULL,
  expires_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS exchange_codes_expires_idx ON aturi.exchange_codes (expires_at);

-- ---------------------------------------------------------------------------
-- 5. Which space authorities a session has consented to ask on the user's
--    behalf. Server-side because a consent flag in a request body is set by
--    whoever makes the request and therefore enforces nothing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aturi.space_consents (
  session_sha256 text NOT NULL,
  authority_did  text NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_sha256, authority_did)
);

-- ---------------------------------------------------------------------------
-- 6. Cross-instance refresh lock.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aturi.oauth_locks (
  key         text PRIMARY KEY,
  holder      text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_locks_expires_idx ON aturi.oauth_locks (expires_at);

-- ---------------------------------------------------------------------------
-- 7. Rate limiting. Counted in the database rather than per instance, because
--    a per-instance counter on a serverless platform is not a limit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aturi.rate_limits (
  bucket       text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON aturi.rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aturi.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
  BEGIN NEW.updated_at = now(); RETURN NEW; END $fn$;

DROP TRIGGER IF EXISTS oauth_sessions_touch ON aturi.oauth_sessions;
CREATE TRIGGER oauth_sessions_touch BEFORE UPDATE ON aturi.oauth_sessions
  FOR EACH ROW EXECUTE FUNCTION aturi.touch_updated_at();

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
    EXECUTE format('ALTER TABLE aturi.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE aturi.%I FORCE ROW LEVEL SECURITY', t);
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
      EXECUTE format('REVOKE ALL ON SCHEMA aturi FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA aturi FROM %I', r);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA aturi REVOKE ALL ON TABLES FROM %I', r);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA aturi TO service_role';
    EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA aturi TO service_role';
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
CREATE OR REPLACE FUNCTION aturi.acquire_oauth_lock(p_key text, p_holder text, p_ttl_seconds int)
RETURNS boolean LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, aturi, pg_temp AS $acq$
  WITH upsert AS (
    INSERT INTO aturi.oauth_locks (key, holder, acquired_at, expires_at)
    VALUES (p_key, p_holder, now(), now() + make_interval(secs => p_ttl_seconds))
    ON CONFLICT (key) DO UPDATE
      SET holder = excluded.holder,
          acquired_at = excluded.acquired_at,
          expires_at = excluded.expires_at
      WHERE aturi.oauth_locks.expires_at < now()
    RETURNING holder
  )
  SELECT EXISTS (SELECT 1 FROM upsert WHERE holder = p_holder);
$acq$;

CREATE OR REPLACE FUNCTION aturi.release_oauth_lock(p_key text, p_holder text)
RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, aturi, pg_temp AS $rel$
  DELETE FROM aturi.oauth_locks WHERE key = p_key AND holder = p_holder;
$rel$;

-- Atomic counter increment; returns the new count for this window.
CREATE OR REPLACE FUNCTION aturi.bump_rate_limit(p_bucket text, p_window_start timestamptz)
RETURNS integer LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, aturi, pg_temp AS $bump$
  INSERT INTO aturi.rate_limits (bucket, window_start, hits)
  VALUES (p_bucket, p_window_start, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE
    SET hits = aturi.rate_limits.hits + 1
  RETURNING hits;
$bump$;

REVOKE EXECUTE ON FUNCTION aturi.acquire_oauth_lock(text,text,int),
                           aturi.release_oauth_lock(text,text),
                           aturi.bump_rate_limit(text,timestamptz)
  FROM public;

DO $fngrants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION aturi.acquire_oauth_lock(text,text,int), '
        'aturi.release_oauth_lock(text,text), aturi.bump_rate_limit(text,timestamptz) '
        'FROM %I', r);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION aturi.acquire_oauth_lock(text,text,int), '
            'aturi.release_oauth_lock(text,text), aturi.bump_rate_limit(text,timestamptz) '
            'TO service_role';
  END IF;
END $fngrants$;
