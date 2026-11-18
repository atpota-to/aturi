#!/usr/bin/env node
/**
 * Preflight for the backend OAuth environment.
 *
 *   node --import ./scripts/test-setup.mjs scripts/check-oauth-config.mjs
 *
 * Checks the four required variables the way the running app checks them —
 * by calling the same loaders, not by reimplementing their rules, so this
 * cannot drift from what actually happens at runtime. Then it reaches the
 * database, which is the only way to confirm the `aturi` schema is exposed to
 * Supabase's Data API short of deploying: an unexposed schema answers 404 to
 * every query while every line of code looks correct.
 *
 * Reads the environment it is given. To check what you are about to paste into
 * Vercel, put it in `.env.local` and run with `--env-file=.env.local`; to check
 * what a deployment has, run it there.
 *
 * Prints no secret. A key that fails to load is described by what is wrong with
 * it, never by its contents.
 */

import { getKeyset } from '@/lib/oauth/server/keyset';
import { open, seal } from '@/lib/oauth/server/crypto';
import { readBffConfig } from '@/lib/oauth/server/env';

const results = [];
const ok = (name, detail) => results.push({ state: 'ok', name, detail });
const bad = (name, detail) => results.push({ state: 'bad', name, detail });
const note = (name, detail) => results.push({ state: 'note', name, detail });

const REQUIRED = [
  'ATURI_OAUTH_JWK_ACTIVE',
  'ATURI_DB_URL',
  'ATURI_DB_SERVICE_KEY',
  'ATURI_SESSION_ENC_KEY',
];

const missing = REQUIRED.filter((n) => !process.env[n]?.trim());
if (missing.length > 0) {
  // Partial configuration is treated as unconfigured on purpose, so name every
  // absent variable rather than failing on the first.
  for (const n of missing) bad(n, 'not set');
  report();
  process.exit(1);
}

const cfg = readBffConfig();
if (!cfg) {
  bad('configuration', 'readBffConfig() returned null despite all four being set');
  report();
  process.exit(1);
}

// --- signing key(s) -------------------------------------------------------
try {
  const keys = await getKeyset();
  const kids = keys.map((k) => k.kid);
  ok('ATURI_OAUTH_JWK_ACTIVE', `loads as ES256, kid "${kids[0]}"`);
  if (kids.length > 1) {
    note('ATURI_OAUTH_JWK_RETIRED', `also published, kid "${kids[1]}" — clear this once rotation is done`);
  }
  // The private half must never be in what gets published.
  const pub = JSON.stringify(keys.map((k) => k.publicJwk ?? {}));
  if (pub.includes('"d"')) bad('JWKS', 'the published key set contains a private "d" — do not deploy');
  else ok('JWKS', 'publishes public halves only');
} catch (err) {
  bad('ATURI_OAUTH_JWK_ACTIVE', err.message);
}

// --- encryption key -------------------------------------------------------
try {
  const probe = { probe: 'round-trip', n: Math.floor(Math.random() * 1e9) };
  const opened = open(seal(probe, cfg.sessionEncKey), cfg.sessionEncKey);
  if (opened.n !== probe.n) throw new Error('sealed and opened values differ');
  ok('ATURI_SESSION_ENC_KEY', 'decodes to 32 bytes and round-trips');
  if (cfg.sessionEncKey.trim() === cfg.dbServiceKey.trim()) {
    bad('ATURI_SESSION_ENC_KEY', 'is the same value as the database key — then it protects nothing');
  }
} catch (err) {
  bad('ATURI_SESSION_ENC_KEY', err.message);
}

// --- database -------------------------------------------------------------
try {
  new URL(cfg.dbUrl);
  ok('ATURI_DB_URL', cfg.dbUrl);
} catch {
  bad('ATURI_DB_URL', `not a URL: ${cfg.dbUrl}`);
}

/**
 * Reach every table, but stop at the first authentication or exposure failure.
 * Those two causes fail identically for all seven, and seven copies of one
 * message buries the one line that says what to do about it.
 */
const TABLES = ['app_sessions', 'oauth_sessions', 'oauth_state', 'exchange_codes',
                'space_consents', 'oauth_locks', 'rate_limits'];
let dbReachable = true;

for (const table of TABLES) {
  let res;
  try {
    res = await fetch(`${cfg.dbUrl}/rest/v1/${table}?select=*&limit=0`, {
      headers: {
        apikey: cfg.dbServiceKey,
        authorization: `Bearer ${cfg.dbServiceKey}`,
        'accept-profile': cfg.dbSchema,
      },
    });
  } catch (err) {
    bad('database', `unreachable: ${err.message}`);
    dbReachable = false;
    break;
  }

  if (res.ok) {
    ok(`${cfg.dbSchema}.${table}`, 'reachable');
    continue;
  }

  dbReachable = false;
  if (res.status === 404) {
    bad(
      `${cfg.dbSchema} schema`,
      'not exposed to the Data API — Supabase → Settings → Data API → ' +
        'Exposed schemas → add "' + cfg.dbSchema + '". Every table 404s until you do.',
    );
  } else if (res.status === 401 || res.status === 403) {
    bad('ATURI_DB_SERVICE_KEY', `rejected (${res.status}) — this must be the service-role key, not the anon key`);
  } else {
    bad(`${cfg.dbSchema}.${table}`, `HTTP ${res.status}`);
  }
  break;
}

// --- the lock, which is the one piece whose failure is silent -------------
// A broken lock degrades to a no-op exactly when contended, and the symptom is
// users randomly signed out at launch rather than an error anyone sees.
if (!dbReachable) {
  note('acquire_oauth_lock', 'skipped — fix the database access above first');
} else try {
  const holder = `preflight-${Date.now()}`;
  const call = (fn, body) =>
    fetch(`${cfg.dbUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: cfg.dbServiceKey,
        authorization: `Bearer ${cfg.dbServiceKey}`,
        'content-profile': cfg.dbSchema,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

  const first = await call('acquire_oauth_lock', { p_key: holder, p_holder: 'A', p_ttl_seconds: 5 });
  const second = await call('acquire_oauth_lock', { p_key: holder, p_holder: 'B', p_ttl_seconds: 5 });
  const a = await first.json();
  const b = await second.json();
  if (a === true && b === false) ok('acquire_oauth_lock', 'serialises — a second holder is refused');
  else bad('acquire_oauth_lock', `expected true then false, got ${JSON.stringify(a)} then ${JSON.stringify(b)}`);
  await call('release_oauth_lock', { p_key: holder, p_holder: 'A' });
} catch (err) {
  bad('acquire_oauth_lock', `could not call: ${err.message}`);
}

// --- the public flag ------------------------------------------------------
const mode = process.env.NEXT_PUBLIC_AUTH_MODE;
if (mode === 'bff') note('NEXT_PUBLIC_AUTH_MODE', 'bff — new sign-ins use the backend');
else if (!mode) note('NEXT_PUBLIC_AUTH_MODE', 'unset — new sign-ins still use the browser client (set it last)');
else if (mode === 'browser') note('NEXT_PUBLIC_AUTH_MODE', 'browser — new sign-ins use the browser client');
else bad('NEXT_PUBLIC_AUTH_MODE', `"${mode}" is not recognised; only "bff" enables the backend`);

report();
process.exit(results.some((r) => r.state === 'bad') ? 1 : 0);

function report() {
  const mark = { ok: '  ok  ', bad: ' FAIL ', note: ' note ' };
  console.log('');
  for (const r of results) {
    console.log(`${mark[r.state]} ${r.name.padEnd(34)} ${r.detail}`);
  }
  const failed = results.filter((r) => r.state === 'bad').length;
  console.log('');
  console.log(failed === 0
    ? 'Configuration looks good. Deploy, then verify the two public endpoints.'
    : `${failed} problem${failed === 1 ? '' : 's'} above. The app treats partial configuration as unconfigured.`);
  console.log('');
}
