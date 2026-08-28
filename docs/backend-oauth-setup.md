# Turning backend OAuth on

A runbook. The code is on `claude/aturi-backend-oauth-vhr358` and is **inert
until you do these steps** — every route answers 503 or 404, and sign-in keeps
using the browser client exactly as it does today.

**Step 1 is already done** — the migration is applied and verified. Start at
step 2.

Ordering is deliberate. Steps 1–5 change nothing a user can see, so you can
stop after any of them and the site behaves as it always has. Step 6 is the
only one that switches anything, and it is one variable.

Estimated time: half an hour or so for staging now that the database is in
place, plus however long you want to soak before production.

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

## 1. Apply the database migration — **done**

Applied to `zdzjtziydmwkxbzlkwxv` on 24 August 2026 as migration
`aturi_oauth_bff`, and the sweep scheduled as `pg_cron` job 5
(`aturi-oauth-sweep`, every 15 minutes). Nothing here is left for you.

What landed:

- Seven tables in `aturi`: `oauth_sessions`, `oauth_state`, `app_sessions`,
  `exchange_codes`, `space_consents`, `oauth_locks`, `rate_limits`.
- Four functions: `acquire_oauth_lock`, `release_oauth_lock`,
  `bump_rate_limit`, `touch_updated_at` — all with `search_path` pinned.
- RLS enabled **and forced** on all seven, 13 indexes, `anon` revoked from the
  schema, `service_role` granted.
- The three empty tables from the earlier exploration dropped. I checked their
  exact row counts immediately before dropping: 0, 0, 0.

Verified beyond "it ran", because the lock is the piece whose failure mode is
silent — it degrades to a no-op exactly when contended, and the symptom is
users randomly signed out at launch rather than an error:

- A second holder is refused while the first one's TTL is live.
- A non-holder cannot release someone else's lock.
- The holder can, and the key is then free.
- An expired lock is stealable, so a crashed instance cannot deadlock the rest.
- `bump_rate_limit` increments and returns 1, 2, 3 on the same bucket.
- The sweep body runs clean by hand.

The security advisor reports seven `rls_enabled_no_policy` notices against the
new tables. That is the intended state, not a finding: RLS on with no policies
is deny-all, the backend reaches them as `service_role` which bypasses RLS, and
the `REVOKE`s are what actually protect them. Every other app in this project
carries the same pattern for its own session tables. No `aturi` function
appears in the mutable-`search_path` warnings — the two that do are anisota's
copies in `public`.

`sql/001_oauth_bff.sql` in this repo is what was applied, so a fork gets the
same thing.

## 2. Expose the schema to the Data API — **yours**

**This is the step that costs people an afternoon**, and it is a dashboard
setting I cannot reach from here. PostgREST serves only the schemas on its
exposed list, and `aturi` is not on it. Skip this and every query returns 404
while the code above looks completely correct.

Supabase → Project Settings → **Data API** (older UI: Settings → API) →
**Exposed schemas** → add `aturi` → Save.

Nothing else on that page needs changing. Exposing the schema does not open the
tables to the anonymous key — step 1's `REVOKE`s already closed that, and I
confirmed `anon` has no `USAGE` on the schema.

**Verify** — this should return `[]`, not a 404:

```bash
curl -s "https://zdzjtziydmwkxbzlkwxv.supabase.co/rest/v1/app_sessions?select=token_sha256" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Accept-Profile: aturi"
```

## 3. Generate the two keys

Two keys, doing different jobs. They must be different values — see the check
at the end of this step.

### The signing key

```bash
node scripts/generate-oauth-key.mjs
```

Prints exactly one line to stdout — an ES256 (P-256) private JWK — plus some
guidance on stderr. It **never writes a file**: this repo is force-pushed to a
public mirror on every push, so a key in the working tree is one `git add .`
away from being published. Copy the line straight into Vercel.

The line looks like this (values shortened):

```json
{"kty":"EC","x":"am269wfcoTTy…","y":"0CD1n4y2VZ9N…","crv":"P-256","d":"PgzPPH1uYKgQ…","alg":"ES256","kid":"aturi-2026-08-24-a1b2c3"}
```

Three fields matter and the loader rejects the key without them:

- `"alg":"ES256"` — RS256 is not accepted. The reference backend's own
  `env.example` still documents RSA; following it produces an unusable key.
- `"kid"` — required, and must be unique per key. It is auto-generated with a
  date and random suffix; pass `--kid my-label` to choose your own. A key
  without one is refused rather than defaulted, because defaulting by position
  is how a rotation silently reuses an identifier for a different key.
- `"d"` — the private half. This is why the value is a secret. What gets
  published at `/oauth/jwks.json` is the same key **without** `d`.

If staging is a separate Vercel project, generate a **separate key for it**.
Sharing one means a staging compromise is a production compromise.

### The encryption key

```bash
openssl rand -hex 32
```

This encrypts the stored OAuth tokens. It must **not** be the database
credential — keeping them apart is the entire point: it means a database dump,
backup, or leaked service key yields ciphertext rather than usable refresh
tokens.

Accepted formats, verified against the loader: 64 hex characters, or base64 /
base64url that decodes to 32 bytes. Anything decoding to a different length is
refused with a message saying so. (A common near-miss: `openssl rand -hex 16`
gives 32 characters, which is not 64 hex and base64-decodes to 24 bytes — it
fails, clearly, rather than silently weakening anything.)

**Rotating this key later logs everyone out**, because the envelope carries no
key id and existing rows cannot be decrypted with a new one. Store it somewhere
you will not lose it.

## 4. Set the environment variables

Vercel → project → Settings → Environment Variables.

> **Change the environment scope before you save.** Vercel ticks Production,
> Preview *and* Development by default. Leave that and your OAuth signing key is
> present in every pull-request preview, where any route can read it — including
> previews of forks' PRs. **Tick Production only.** On a separate staging
> project, tick that project's environment only.

Five variables. The first four are secrets; the fifth is public and comes last.

| Variable | Value | Notes |
| --- | --- | --- |
| `ATURI_OAUTH_JWK_ACTIVE` | the one-line JSON from step 3 | Paste as-is, including the braces. No quotes around it. |
| `ATURI_SESSION_ENC_KEY` | the 64 hex chars from step 3 | Not the database key. |
| `ATURI_DB_URL` | `https://zdzjtziydmwkxbzlkwxv.supabase.co` | Project URL, no trailing slash and no `/rest/v1`. |
| `ATURI_DB_SERVICE_KEY` | the **service-role** key | Supabase → Settings → API Keys. Either the newer `sb_secret_…` or the legacy `service_role` JWT. **Not** the anon/publishable key — that one is rejected, and the preflight below says so explicitly. |
| `NEXT_PUBLIC_AUTH_MODE` | **leave unset for now** | Step 6. |

Optional, all with working defaults — leave them unset unless you need them:

| Variable | Default | When you would set it |
| --- | --- | --- |
| `ATURI_DB_SCHEMA` | `aturi` | Only if you applied the migration to a different schema. |
| `ATURI_APP_SESSION_TTL_DAYS` | `30` | Session lifetime. Slides on use, so this is "days of inactivity". Clamped to 1–365. |
| `ATURI_OAUTH_JWK_RETIRED` | — | Only during a key rotation. Published but never signs. |
| `ATURI_EXTENSION_RETURN_ORIGINS` | — | Only for an extension build whose redirect host is not one the browsers reserve — a Safari build, say. Chrome and Firefox are matched by pattern already. |
| `ATURI_DB_DRIVER` | `postgrest` | Only `postgrest` ships. Anything else fails loudly. |
| `NEXT_PUBLIC_BFF_ORIGIN` | — | Bearer callers only (the extension, local dev). The web app cannot use it — its session is a cookie on the backend's own origin. |

### Check them before you deploy

```bash
npm run check:oauth
```

Reads the environment it is given and calls the same loaders the running app
calls, so it cannot drift from what happens at runtime. To check values you are
about to paste, put them in a local file and run:

```bash
node --env-file=.env.local --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --import ./scripts/test-setup.mjs scripts/check-oauth-config.mjs
```

(`.env` and `.env.*` are gitignored, with `.env.example` excepted.)

A good run:

```
  ok   ATURI_OAUTH_JWK_ACTIVE             loads as ES256, kid "aturi-2026-08-24-a1b2c3"
  ok   JWKS                               publishes public halves only
  ok   ATURI_SESSION_ENC_KEY              decodes to 32 bytes and round-trips
  ok   ATURI_DB_URL                       https://zdzjtziydmwkxbzlkwxv.supabase.co
  ok   aturi.app_sessions                 reachable
  … one line per table …
  ok   acquire_oauth_lock                 serialises — a second holder is refused
  note NEXT_PUBLIC_AUTH_MODE              unset — new sign-ins still use the browser client (set it last)
```

It exits non-zero on any failure, and prints no secret — a key that fails is
described by what is wrong with it, never by its contents. It also catches the
two mistakes that are otherwise invisible until something breaks:

- **The schema is not exposed.** Every table answers 404 while the code looks
  correct. The check says so in one line and names the setting.
- **The lock does not serialise.** A broken lock degrades to a no-op exactly
  when contended, and the symptom is users randomly signed out at launch rather
  than an error anyone sees. The check acquires it twice with different holders
  and requires the second to be refused.

## 5. Deploy, and check the client is real

Merge the branch, or deploy it to staging, and let it build.

Nothing user-visible changes yet. `NEXT_PUBLIC_AUTH_MODE` is still unset, so
sign-in keeps using the public browser client. What you now have is a second
OAuth client that exists and can be validated by an authorization server.

### The two public endpoints

```bash
curl -s https://aturi.to/oauth/client-metadata.json | jq
curl -s https://aturi.to/oauth/jwks.json | jq
```

Both must be **200**. The metadata must contain:

```json
{
  "client_id": "https://aturi.to/oauth/client-metadata.json",
  "token_endpoint_auth_method": "private_key_jwt",
  "token_endpoint_auth_signing_alg": "ES256",
  "redirect_uris": ["https://aturi.to/api/oauth/callback"],
  "jwks_uri": "https://aturi.to/oauth/jwks.json",
  "dpop_bound_access_tokens": true
}
```

Four things to actually look at:

1. **`client_id` equals the URL you just fetched.** That identity is what makes
   it a valid client id, and it is why this document is served per-host.
2. **`redirect_uris` says `/api/oauth/callback`** — note the `/api/`. The
   existing public client's `/oauth/callback` page is untouched and still works.
3. **`jwks_uri` resolves** and lists your `kid` with `"crv":"P-256"`.
4. **The JWKS has no `d` field.** A `d` there is the private half; stop, rotate
   the key, and work out how it got published.

```bash
# Should print nothing. Anything printed is the private half.
curl -s https://aturi.to/oauth/jwks.json | jq '.keys[] | select(.d)'
```

### Confirm the routes are alive but idle

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://aturi.to/api/oauth/session
```

**401** is correct here — you have no session yet. A **503** means the four
variables are not all set (partial configuration is treated as unconfigured on
purpose), and a **404** on the metadata means the same.

### What each failure means

| Symptom | Cause |
| --- | --- |
| Metadata and JWKS both 404 | One of the four variables is missing. Re-run `npm run check:oauth` against the deployment. |
| Metadata 200, JWKS 500 | The origin is not `https://`. Only happens locally, where there is no `x-forwarded-proto` — add `-H 'x-forwarded-proto: https'` when probing a local build. |
| Either endpoint 400 "Unknown host" | The `Host` is not one of `aturi.to`, `www.aturi.to`, `testing.aturi.to`. Preview deployments land here deliberately: a `client_id` must equal the URL it is served from, so every preview hash would be a distinct OAuth client. |
| `/api/oauth/session` returns 503 | Same as the first row — not configured. |

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
