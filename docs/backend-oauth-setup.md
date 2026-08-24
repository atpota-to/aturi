# Turning backend OAuth on

A runbook. The code is on `claude/aturi-backend-oauth-vhr358` and is **inert
until you do these steps** — every route answers 503 or 404, and sign-in keeps
using the browser client exactly as it does today.

Ordering is deliberate. Steps 1–5 change nothing a user can see, so you can stop
after any of them and the site behaves as it always has. Step 6 is the only one
that switches anything, and it is one variable.

Estimated time: about an hour for staging, plus however long you want to soak
before production.

---

## Before you start

You need:

- Access to the Supabase project `atpota.to` (`zdzjtziydmwkxbzlkwxv`).
- Access to the Vercel project `aturi` (team `atpotato`).
- To know whether `testing.aturi.to` is a domain on that same Vercel project or
  a separate project. **Check this first** — it decides step 3:
  - Vercel → `aturi` → Settings → Domains. If `testing.aturi.to` is listed,
    it is the same project and shares its environment variables.
  - If it is not listed, it is a separate project with its own variables, and
    staging and production can have separate signing keys. That is the better
    arrangement; if they share, a staging compromise is a production key
    compromise.

Nothing below touches the existing public OAuth client. Anyone signed in today
stays signed in, on that client, until they sign out themselves.

---

## 1. Apply the database migration

Two files. Run `sql/001_oauth_bff.sql` against the Supabase project — the SQL
editor is fine.

It creates the `aturi` schema's seven tables, the lock and rate-limit
functions, and the grants. It also drops three tables from an earlier
exploration (`aturi.aturi_oauth_sessions`, `aturi_oauth_state`,
`aturi_frontend_sessions`). **Those are empty** — I checked, 0 rows each — but
confirm for yourself before running it if you would rather:

```sql
select count(*) from aturi.aturi_oauth_sessions;
```

Then run `sql/002_cron_supabase.sql`, which schedules the expiry sweep. It is
separate because `cron.schedule` errors on any Postgres without `pg_cron`, and
a fork is likely to be on one. This project has `pg_cron` and `pgcrypto`
installed already, so it will work here.

**Verify:**

```sql
select table_name from information_schema.tables
where table_schema = 'aturi' order by table_name;
-- app_sessions, exchange_codes, oauth_locks, oauth_sessions,
-- oauth_state, rate_limits, space_consents

select jobname, schedule from cron.job where jobname = 'aturi-oauth-sweep';
```

## 2. Expose the schema to the Data API

**This is the step that costs people an afternoon.** PostgREST only serves
schemas on its exposed list, and `aturi` is not on it. Skip this and every
query returns 404 while the code looks completely correct.

Supabase → Project Settings → **Data API** (older UI: Settings → API) →
**Exposed schemas** → add `aturi` → Save.

Leave the rest of that page alone. The tables are unreachable to the anonymous
key regardless, because the migration revokes it — exposure is only what lets
the service role reach them over REST.

**Verify** — this should return `[]`, not a 404:

```bash
curl -s "https://zdzjtziydmwkxbzlkwxv.supabase.co/rest/v1/app_sessions?select=token_sha256" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Accept-Profile: aturi"
```

## 3. Generate the two keys

```bash
node scripts/generate-oauth-key.mjs
```

Prints one line of JSON to stdout and never writes a file — this repo is
force-pushed to a public mirror on every push, so a key in the working tree is
one `git add .` away from being published. Copy it straight into Vercel.

You also need an encryption key, which is a different thing and must not be
the database credential — it is what makes a database dump useless:

```bash
openssl rand -hex 32
```

If staging is a separate Vercel project, generate a **separate pair** for it.

## 4. Set the environment variables

Vercel → project → Settings → Environment Variables.

> **The default is wrong for these.** Vercel ticks Production, Preview and
> Development. Leave it that way and your OAuth signing key is present in every
> pull-request preview, where any route can read it. **Tick Production only**
> (and, on a separate staging project, its own environment only).

| Variable | Value |
| --- | --- |
| `ATURI_OAUTH_JWK_ACTIVE` | the JSON line from step 3 |
| `ATURI_SESSION_ENC_KEY` | the 64 hex chars from step 3 |
| `ATURI_DB_URL` | `https://zdzjtziydmwkxbzlkwxv.supabase.co` |
| `ATURI_DB_SERVICE_KEY` | the project's service-role key (`sb_secret_…`, or the legacy `service_role` JWT) |

Leave unset for now: `ATURI_DB_SCHEMA` (defaults to `aturi`),
`ATURI_APP_SESSION_TTL_DAYS` (defaults to 30), `ATURI_OAUTH_JWK_RETIRED` (only
used while rotating), `ATURI_EXTENSION_RETURN_ORIGINS` (the browsers' own
redirect hosts are matched by pattern; this is only for a Safari-style build
that needs naming explicitly).

**Do not set `NEXT_PUBLIC_AUTH_MODE` yet.** That is step 6.

## 5. Deploy, and check the client is real

Merge the branch (or deploy it to staging) and let it build.

Nothing user-visible changes. `NEXT_PUBLIC_AUTH_MODE` is still unset, so
`resolveAuthMode()` returns `browser` and every sign-in goes through the public
client as before. What you have now is a second OAuth client that exists and
can be validated.

**Verify** — both must be 200:

```bash
curl -s https://aturi.to/oauth/client-metadata.json | jq
curl -s https://aturi.to/oauth/jwks.json | jq
```

The metadata should show:

- `"client_id": "https://aturi.to/oauth/client-metadata.json"` — matching the
  URL you fetched it from, which is what makes it a valid client id
- `"token_endpoint_auth_method": "private_key_jwt"` and
  `"token_endpoint_auth_signing_alg": "ES256"`
- `"redirect_uris": ["https://aturi.to/api/oauth/callback"]` — note `/api/`;
  the existing public client's `/oauth/callback` page is untouched
- `"jwks_uri"` pointing at the second URL

The JWKS should list your `kid` with `"crv": "P-256"`, `"alg": "ES256"`, and
**no `d` field**. A `d` there is the private half and means something is very
wrong; stop and rotate.

If either 404s, the four variables are not all set (the code treats partial
configuration as unconfigured on purpose). If the JWKS 500s while the metadata
is fine, the origin is not `https://` — that only happens locally.

## 6. Switch new sign-ins over

Set one more variable, **Production only**:

```
NEXT_PUBLIC_AUTH_MODE = bff
```

Then **redeploy**. This one is not read at runtime — Next inlines
`NEXT_PUBLIC_*` at build time, so changing it without rebuilding does nothing.

What changes: new sign-ins go through the backend. What does not: anyone
already signed in through the browser client keeps that session until they sign
out, and a backend session is honoured even if you later set this back to
`browser`.

**Verify, in a private window:**

1. Sign in. The PDS consent screen should appear (it is forced — a confidential
   client otherwise loses it).
2. You land back where you started, signed in.
3. `/account` now shows a **Where you're signed in** card listing this browser.
4. Read a record, then edit one, then change a preference and confirm it
   round-trips to your PDS.
5. In `/explore`, confirm the relationship strip shows mutual-follow state —
   that proves the `atproto-proxy` header survived the hop, which is the one
   failure that looks like success.
6. Sign out, and confirm you are actually signed out after a reload.

Then leave it a few days before deciding it is fine.

## 7. Rolling back

Set `NEXT_PUBLIC_AUTH_MODE=browser` and redeploy. New sign-ins go back to the
public client immediately.

Nobody is signed out by this. Backend sessions already minted stay valid,
because the provider honours an existing session of either kind — the flag only
decides which client a *new* sign-in uses. That is deliberate: a rollback that
logged everyone out would be worse than whatever prompted it.

If you need to go further and end every backend session, delete the rows:

```sql
delete from aturi.app_sessions;
delete from aturi.oauth_sessions;
```

That signs those users out; it does not revoke at their PDS. To revoke too,
they use "sign out everywhere" on `/account`, or revoke Aturi from their own
PDS.

---

## The extension, later

Deliberately its own release. The backend half is done and needs nothing
further; what is left is store process:

1. **Pin the Chrome `key`** in `extension/wxt.config.ts` from the Web Store
   item's public key, so a development build and the published one share an id.
   Not required for sign-in to work — the browsers' reserved redirect hosts are
   matched by pattern — but without it a dev build gets its own separate
   session and storage.
2. **Chrome Web Store → Privacy practices** must tick **Authentication
   information** to match the manifest's new declaration. The store
   cross-references the two, and a mismatch is a rejection.
3. **AMO** reads the linked privacy policy against the declared permissions.
   `extension/PRIVACY.txt` and `/extension/privacy` are already rewritten to
   match, both with a "Signing in (optional)" section.
4. Ship it. Sign-in lives at Settings → Account and is read-only: the grant it
   requests cannot write to a repository, enforced server-side rather than by
   the extension asking nicely.

Safari has no `browser.identity` at all, so extension sign-in will not work
there; the extension says so rather than hanging. Firefox for Android is
unconfirmed.

---

## When something is wrong

| What you see | Cause |
| --- | --- |
| Every route 404 / 503, metadata absent | One of the four variables is unset. Partial config is treated as unconfigured. |
| Everything 404s from PostgREST, code looks right | `aturi` is not in the Data API's exposed schemas (step 2). |
| `Sign-in must start from the app` | The sign-in did not begin as a same-origin navigation. Deliberate — it stops a hostile page starting a flow against a server it names. Use the sign-in button. |
| `This sign-in did not start in this browser` | The flow cookie is missing or stale. Usually cookies blocked, or a flow resumed after more than ten minutes. |
| Signed in, but writes fail | The scopes the user ticked did not include them. Check `scope` on `/api/oauth/session`. |
| Relationship strip renders but shows nothing | `atproto-proxy` is being dropped somewhere. |
| Sign-ins work, then stop after ~30 days of no use | Expected: sessions slide on use and expire otherwise. |
| Users randomly signed out at launch | The refresh lock is not working. Check `aturi.oauth_locks` exists and `acquire_oauth_lock` is executable by the service role. |

Two known limits, both written up in `docs/backend-oauth.md`: the encryption
envelope carries no key id, so rotating `ATURI_SESSION_ENC_KEY` without
re-encrypting logs everyone out; and revocation can lag up to a minute across
serverless instances, which is the cost of not hitting the database on every
proxied call.
