# Turning backend OAuth on

A runbook. The code ships **inert**: until the steps below are done every
backend route answers 503 or 404, and sign-in keeps using the browser client
exactly as it does today. Merging it changes nothing anyone can see.

The order is staging first, then production. Staging is `testing.aturi.to`;
production is `aturi.to`. Every step until the last one in each part changes
nothing a user can see, so you can stop after any of them. The switch itself is
one variable, and rolling it back signs nobody out.

Estimated time: about half an hour for staging, then the same again for
production once you are happy with it.

---

## Where things stand (checked 27 October 2026)

| | Staging (`testing.aturi.to`) | Production (`aturi.to`) |
| --- | --- | --- |
| Code deployed | When this branch merges into `testing` | When `testing` merges into `main` |
| Database schema | `aturi_staging`: **not applied yet** (step A1) | `aturi`: **done**: 7 tables, sweep job active |
| Schema exposed to the Data API | **No** (step A2) | **No** (step A2, same setting) |
| Keys generated | No (A3) | No (B1) |
| Vercel variables | None set (A4) | None set (B2) |
| Switched on | No (A6) | No (B4) |

The exposed-schemas list on the Supabase project is currently
`public, graphql_public, trackerapp, credblue, typesapp, turtleme, mod`.

### Two facts that shape everything below

**1. `testing.aturi.to` is a branch domain, not a separate project.** It is
attached to the `aturi` Vercel project with Git branch `testing`, so its
deployments run in Vercel's **Preview** environment, not Production. That means:

- Staging's variables go under **Preview**, restricted to the **`testing`**
  branch. Variables marked "Production only" never reach it.
- Never scope a secret to *all* Preview branches. Every pull-request preview,
  including previews of forks' pull requests, would then hold your signing key.
- Staging and production can still have different keys: same variable name,
  one value for Preview (`testing`) and another for Production. Do that. Sharing
  one means a staging compromise is a production compromise.

**2. Staging needs its own database schema.** `oauth_sessions` is keyed by
account and client type (`web` or `extension`), with no notion of which site
issued the grant. If staging and production shared the `aturi` tables, signing
in on `testing.aturi.to` would overwrite that person's production grant, and
they would be signed out of `aturi.to`. So staging uses `aturi_staging`, set
with `ATURI_DB_SCHEMA`. Same Supabase project, separate tables.

### What you need

- Access to the Supabase project `atpota.to` (`zdzjtziydmwkxbzlkwxv`).
- Access to the Vercel project `aturi` (team `atpotato`).
- Node 22 and a checkout of this repo, to generate the signing keys.

Nothing below touches the existing public OAuth client. Anyone signed in today
stays signed in, on that client, until they sign out themselves.

---

# Part A: staging on testing.aturi.to

## A0. Merge this branch into `testing`

Merge the pull request and let Vercel deploy `testing`. With no variables set,
nothing changes on `testing.aturi.to`. You can confirm the new routes are there
but idle:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://testing.aturi.to/api/oauth/session
# 503: deployed and unconfigured, which is correct for now
```

## A1. Create the staging schema

`sql/staging/aturi_staging.sql` is the production migration with the schema
renamed to `aturi_staging`, plus its own 15-minute sweep job. It only creates
things; nothing else in the database refers to it.

Supabase → **SQL Editor** → New query → paste the whole file → **Run**.

(Or ask Claude to apply it: it is ready to go through the Supabase connector,
which asks you to confirm first.)

**Verify:**

```sql
select count(*) from information_schema.tables where table_schema = 'aturi_staging';
-- 7
select jobname, schedule, active from cron.job where jobname like 'aturi%';
-- aturi-oauth-sweep and aturi-staging-oauth-sweep, both active
```

## A2. Expose both schemas to the Data API

**This is the step that costs people an afternoon.** PostgREST serves only the
schemas on its exposed list. Skip this and every query returns 404 while the
code looks completely correct.

Supabase → Project Settings → **Data API** (older UI: Settings → API) →
**Exposed schemas** → add **`aturi`** and **`aturi_staging`** → Save. Leave the
schemas already on the list as they are.

This does not open the tables to the anonymous key. The migrations revoke
`anon` and `authenticated` from both schemas; only the service role can reach
them.

**Verify.** Both should print `[]`, not a 404 or a "schema must be one of"
error:

```bash
SERVICE_KEY='…service-role key…'
for schema in aturi aturi_staging; do
  curl -s "https://zdzjtziydmwkxbzlkwxv.supabase.co/rest/v1/app_sessions?select=token_sha256" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Accept-Profile: $schema"; echo
done
```

## A3. Generate staging's two keys

Two keys doing different jobs. They must be different values.

**The signing key:**

```bash
node scripts/generate-oauth-key.mjs --kid aturi-staging-2026-10
```

This prints exactly one line to stdout, an ES256 (P-256) private JWK, plus some
guidance on stderr. It **never writes a file**: this repo is force-pushed to a
public mirror on every push, so a key in the working tree is one `git add .`
away from being published. Copy the line straight into Vercel.

The line looks like this (values shortened):

```json
{"kty":"EC","x":"am269wfcoTTy…","y":"0CD1n4y2VZ9N…","crv":"P-256","d":"PgzPPH1uYKgQ…","alg":"ES256","kid":"aturi-staging-2026-10"}
```

The loader rejects a key without `"alg":"ES256"` (RS256 is not accepted), a
`"kid"` (unique per key), and `"d"` (the private half, which is why this is a
secret). What gets published at `/oauth/jwks.json` is the same key without `d`.

**The encryption key:**

```bash
openssl rand -hex 32
```

This encrypts the stored OAuth tokens. It must **not** be the database
credential: keeping them apart means a database dump, backup or leaked service
key yields ciphertext rather than usable refresh tokens. Accepted: 64 hex
characters, or base64/base64url decoding to 32 bytes. (`openssl rand -hex 16`
is the common near-miss, and it is refused.)

**Rotating this key later signs everyone out**, because existing rows cannot be
decrypted with a new one. Store it somewhere you will not lose it.

## A4. Set staging's variables in Vercel

Vercel → `aturi` → Settings → **Environment Variables** → Add.

For **each** variable below:

1. Untick **Production** and **Development**. Leave only **Preview** ticked.
2. In the Preview branch field, choose **`testing`**. Not "All Preview
   branches": that puts the key in every pull-request preview.
3. Mark the four secrets **Sensitive**.

| Variable | Staging value | Notes |
| --- | --- | --- |
| `ATURI_OAUTH_JWK_ACTIVE` | the one-line JSON from A3 | Paste as-is, braces included, no quotes around it. |
| `ATURI_SESSION_ENC_KEY` | the 64 hex characters from A3 | Not the database key. |
| `ATURI_DB_URL` | `https://zdzjtziydmwkxbzlkwxv.supabase.co` | No trailing slash, no `/rest/v1`. |
| `ATURI_DB_SERVICE_KEY` | the **service-role** key | Supabase → Settings → API Keys: the `sb_secret_…` key or the legacy `service_role` JWT. **Not** the anon/publishable key, which is rejected. |
| `ATURI_DB_SCHEMA` | `aturi_staging` | **Required for staging.** Without it staging writes to production's tables. |
| `NEXT_PUBLIC_AUTH_MODE` | **leave unset for now** | Step A6. |

Optional, all with working defaults. Leave them unset unless you need them:

| Variable | Default | When you would set it |
| --- | --- | --- |
| `ATURI_APP_SESSION_TTL_DAYS` | `30` | Session lifetime, as days of inactivity (it slides on use). Clamped to 1–365. |
| `ATURI_OAUTH_JWK_RETIRED` | — | Only during a key rotation. Published but never used to sign. |
| `ATURI_EXTENSION_RETURN_ORIGINS` | — | Only for an extension build whose redirect host the browsers do not reserve, a Safari build for example. Chrome and Firefox are matched by pattern already. |
| `ATURI_DB_DRIVER` | `postgrest` | Only `postgrest` ships. |
| `NEXT_PUBLIC_BFF_ORIGIN` | — | Bearer callers only (the extension, local dev). The web app cannot use it. |

### Check the values before you deploy

Put the same values in a local file that git ignores (`.env` and `.env.*` are
ignored, except `.env.example`), say `.env.staging.local`, then:

```bash
node --env-file=.env.staging.local --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --import ./scripts/test-setup.mjs scripts/check-oauth-config.mjs
```

This calls the same loaders the running app calls, so it cannot drift from what
happens at runtime. It prints no secrets, and exits non-zero on any failure. A
good run:

```
  ok   ATURI_OAUTH_JWK_ACTIVE             loads as ES256, kid "aturi-staging-2026-10"
  ok   JWKS                               publishes public halves only
  ok   ATURI_SESSION_ENC_KEY              decodes to 32 bytes and round-trips
  ok   ATURI_DB_URL                       https://zdzjtziydmwkxbzlkwxv.supabase.co
  ok   aturi_staging.app_sessions         reachable
  … one line per table …
  ok   acquire_oauth_lock                 serialises — a second holder is refused
  note NEXT_PUBLIC_AUTH_MODE              unset — new sign-ins still use the browser client (set it last)
```

It catches the two mistakes that are otherwise invisible until something breaks:
a schema that is not exposed (every table 404s), and a lock that does not
serialise (it degrades to a no-op under contention, and the symptom is people
randomly signed out rather than an error).

Delete the local file afterwards.

## A5. Redeploy staging, and check the client is real

Environment variables apply to new deployments only. Vercel → Deployments →
the latest `testing` deployment → **⋯ → Redeploy**.

Nothing user-visible changes yet. What you now have is a second OAuth client
that an authorization server can validate.

```bash
curl -s https://testing.aturi.to/oauth/client-metadata.json | jq
curl -s https://testing.aturi.to/oauth/jwks.json | jq
```

Both must be **200**. The metadata must contain:

```json
{
  "client_id": "https://testing.aturi.to/oauth/client-metadata.json",
  "token_endpoint_auth_method": "private_key_jwt",
  "token_endpoint_auth_signing_alg": "ES256",
  "redirect_uris": ["https://testing.aturi.to/api/oauth/callback"],
  "jwks_uri": "https://testing.aturi.to/oauth/jwks.json",
  "dpop_bound_access_tokens": true
}
```

Check four things:

1. **`client_id` equals the URL you just fetched.** That is what makes it a
   valid client id, and why the document is served per host.
2. **`redirect_uris` says `/api/oauth/callback`**, with the `/api/`. The
   existing public client's `/oauth/callback` page is untouched.
3. **The JWKS lists your `kid`** with `"crv":"P-256"`.
4. **The JWKS has no `d` field.** This must print nothing:

   ```bash
   curl -s https://testing.aturi.to/oauth/jwks.json | jq '.keys[] | select(.d)'
   ```

   Anything printed is the private half: stop, rotate the key, and work out how
   it got published.

Then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://testing.aturi.to/api/oauth/session
```

**401** is correct: configured, and you have no session yet. **503** means the
four required variables are not all reaching this deployment. Partial
configuration counts as unconfigured on purpose.

| Symptom | Cause |
| --- | --- |
| Metadata and JWKS both 404, session 503 | A variable is missing from this deployment. Usually it was scoped to Production, or to all Preview branches but added after this deployment was built. Check the scope, then redeploy. |
| Either endpoint 400 "Unknown host" | You fetched a deployment's own `*.vercel.app` URL. Only `aturi.to`, `www.aturi.to` and `testing.aturi.to` can serve the client, because a `client_id` must equal the URL it is served from. |
| Metadata 200, JWKS 500 | The origin is not `https://`. Only happens locally; add `-H 'x-forwarded-proto: https'`. |

## A6. Switch staging's sign-ins over

Add one more variable, with the same scope as the others (Preview, branch
`testing`):

```
NEXT_PUBLIC_AUTH_MODE = bff
```

Then **redeploy `testing` again**. This one is not read at runtime: Next inlines
`NEXT_PUBLIC_*` at build time, so changing it without rebuilding does nothing.
Only the exact string `bff` selects the backend; any other value is the
browser client.

**Verify, in a private window on `testing.aturi.to`:**

1. Sign in. Your PDS's consent screen should appear. It always does for this
   client, by design.
2. You land back where you started, signed in.
3. `/account` shows a **Where you're signed in** card listing this browser.
4. Read a record, edit one, then change a preference and confirm it reaches your
   PDS.
5. In `/explore`, open a profile you follow and confirm the relationship strip
   shows mutual-follow state. That proves the `atproto-proxy` header survived
   the hop, and losing it is the one failure that looks like success.
6. If you tick the space permissions at sign-in: open a space, and create then
   delete one under "Manage your own spaces".
7. Sign out, reload, and confirm you are actually signed out.

Then leave it a few days. In Supabase, `aturi_staging.app_sessions` should hold
a row per signed-in browser, and `aturi.app_sessions` should still be empty.

---

# Part B: production on aturi.to

Do this once staging has soaked and `testing` has merged into `main`, so the
code is live on `aturi.to` (and still inert there).

## B1. Generate production's keys

The same two commands as A3, with a different label:

```bash
node scripts/generate-oauth-key.mjs --kid aturi-prod-2026-10
openssl rand -hex 32
```

Use **new** values. Do not reuse staging's.

## B2. Set production's variables

Vercel → `aturi` → Settings → Environment Variables. The same variable names as
A4, but this time tick **Production only**: untick Preview and Development,
which Vercel ticks by default. Mark the secrets Sensitive.

| Variable | Production value |
| --- | --- |
| `ATURI_OAUTH_JWK_ACTIVE` | the JWK from B1 |
| `ATURI_SESSION_ENC_KEY` | the hex key from B1 |
| `ATURI_DB_URL` | `https://zdzjtziydmwkxbzlkwxv.supabase.co` |
| `ATURI_DB_SERVICE_KEY` | the service-role key |
| `ATURI_DB_SCHEMA` | leave unset (defaults to `aturi`), or set `aturi` explicitly |
| `NEXT_PUBLIC_AUTH_MODE` | **leave unset for now** |

Run the same preflight as A4 against a local copy of these values. It should
report `aturi.app_sessions reachable` and so on.

## B3. Redeploy production, and check the client

Redeploy production, then run the A5 checks against `https://aturi.to`. The
`client_id` must be `https://aturi.to/oauth/client-metadata.json`,
`/api/oauth/session` must answer 401, and the JWKS must list
`aturi-prod-2026-10` with no `d`.

## B4. Switch production's sign-ins over

Add `NEXT_PUBLIC_AUTH_MODE = bff`, **Production only**, and redeploy. Run the A6
checks on `aturi.to`.

Anyone already signed in through the browser client keeps that session until
they sign out. New sign-ins go through the backend.

---

## Rolling back

On either site: set `NEXT_PUBLIC_AUTH_MODE` to `browser` (or delete it) in that
environment's scope, and redeploy. New sign-ins go back to the public client
immediately.

Nobody is signed out by this. Backend sessions already minted stay valid,
because an existing session of either kind is always honoured. The flag only
decides which client a *new* sign-in uses. A rollback that logged everyone out
would be worse than whatever prompted it.

To end every backend session as well, delete the rows (use `aturi_staging` for
staging):

```sql
delete from aturi.app_sessions;
delete from aturi.oauth_sessions;
```

That signs those people out; it does not revoke at their PDS. To revoke too,
they use "sign out everywhere" on `/account`, or revoke Aturi from their own PDS.

---

## The extension, later

Deliberately its own release. The backend half is done; what is left is store
process:

1. **Pin the Chrome `key`** in `extension/wxt.config.ts` from the Web Store
   item's public key, so a development build and the published one share an id.
   Sign-in works without it, because the browsers' reserved redirect hosts are
   matched by pattern, but a dev build would get its own separate session.
2. **Chrome Web Store → Privacy practices** must tick **Authentication
   information** to match the manifest's new `identity` permission. The store
   cross-references the two, and a mismatch gets the item rejected.
3. **AMO** reads the linked privacy policy against the declared permissions.
   `extension/PRIVACY.txt` and `/extension/privacy` already describe sign-in in
   their "Signing in (optional)" section.
4. Build with `NEXT_PUBLIC_BFF_ORIGIN=https://aturi.to` and ship. Sign-in lives at
   Settings → Account and is read-only: the server pins the extension to the
   base scope, so it cannot write to a repository whatever it asks for.

Safari has no `browser.identity` at all, so extension sign-in does not work
there; the extension says so rather than hanging. Firefox for Android is
unconfirmed.

---

## When something is wrong

| What you see | Cause |
| --- | --- |
| Every route 404/503, metadata absent | A required variable is not reaching this deployment. Check its environment scope and branch, then redeploy. |
| PostgREST 404s everywhere, code looks right | The schema is not in the Data API's exposed schemas (A2). |
| Signed in on staging, then signed out of production | Staging is on the `aturi` schema. Set `ATURI_DB_SCHEMA=aturi_staging` for Preview (`testing`) and redeploy. |
| `Sign-in must start from the app` | The sign-in did not begin as a same-origin navigation. Deliberate: it stops a hostile page starting a flow. Use the sign-in button. |
| `This sign-in did not start in this browser` | The flow cookie is missing or stale: cookies blocked, or more than ten minutes between starting and finishing. |
| Signed in, but writes fail | The permissions ticked at sign-in did not include them. Check `scope` on `/api/oauth/session`. |
| A feature works with browser sign-in but 403s with backend sign-in | Its XRPC method is not on the proxy allowlist in `src/app/api/oauth/xrpc/[nsid]/route.ts`. `src/lib/__tests__/oauthProxyAllowlist.test.ts` is meant to catch this in CI. |
| Relationship strip renders but shows nothing | `atproto-proxy` is being dropped somewhere. |
| Signed out after ~30 days of not visiting | Expected: sessions slide on use and expire otherwise. |
| People randomly signed out at launch | The refresh lock is not working. Check the schema's `oauth_locks` table exists and `acquire_oauth_lock` is executable by the service role. |

Two known limits, both written up in `docs/backend-oauth.md`: the encryption
envelope carries no key id, so rotating `ATURI_SESSION_ENC_KEY` without
re-encrypting signs everyone out; and revocation can lag up to a minute across
serverless instances, the cost of not hitting the database on every proxied
call.
