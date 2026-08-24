# Backend OAuth (BFF) for aturi.to — scope and plan

**Status:** phases 0–4 are implemented on this branch and unconfigured, so they
are inert. Phase 5 (rollout, legal copy) and phase 6 (the extension client) are
not. See **Implementation status** below.
**Goal:** move aturi.to from a public browser OAuth client to a confidential
backend client (the BFF pattern anisota-cocoon uses), and design it so the
browser extension can sign in too.

---

## Summary

Today aturi is a **public** OAuth client: `@atproto/oauth-client-browser` holds
DPoP-bound tokens in IndexedDB (`src/lib/oauth/client.ts`). The authorization
server caps a public client's session at roughly two weeks, so users are signed
out regularly. A **confidential** client — one that authenticates to the token
endpoint with a private key — gets much longer lifetimes: per the atproto OAuth
spec, "overall session lifetime may be unlimited", with refresh tokens up to
180 days.

The recommended shape is **not** a second repository. It is a set of Node-runtime
Route Handlers inside the existing Next.js app, under `src/app/api/oauth/*`,
published as a **second, parallel** OAuth client alongside the existing public
one. The two coexist; a flag picks between them; nobody is logged out.

Three findings drive the whole design:

1. **A path-passthrough proxy, not a method-name RPC.** anisota-cocoon's
   `/oauth/proxy` takes an `X-XRPC-Method` header and walks it into an
   `@atproto/api` `Agent` by NSID segment. That forced anisota's frontend to
   hand-mimic the entire `AtpAgent` surface — `oauth-client-backend.js` is 2,175
   lines. It also **cannot serve `com.atproto.space.*` at all**, because no
   released `@atproto/api` registers those lexicons (`ComAtprotoNS` has nine
   members and `space` is not one). Copying it kills 13 space components and
   ~2,700 LOC.

   Instead: proxy by path. `new Agent(...)` accepts a bare `fetchHandler`
   function (verified in `packages/api/src/agent.ts` — the constructor takes
   `SessionManager | FetchHandler | FetchHandlerOptions`), so a single ~90-line
   shim satisfies `new Agent({ did, fetchHandler })`, `oauthTransport()` and the
   `OwnPdsFetch` type at once.

2. **The blast radius is four files, not thirty-five.** 33 files call
   `useAtprotoSession()`. 23 take only `did`/`loading`/`error`/`signIn`/
   `signOut`, which any session shape serves. 9 take `agent`, and the entire
   authenticated XRPC surface behind them is seven methods. Exactly one file —
   `src/components/explore/space/useSpaceAccess.ts` — touches the `OAuthSession`
   object itself, for `session.fetchHandler`.

3. **The extension is not an OAuth client.** In a BFF the only registered
   `redirect_uri` is the backend's own callback. The extension's return target
   is an *application-level* hand-off the BFF allowlists, never something the
   authorization server sees. That sidesteps the fact that Firefox's
   `identity.getRedirectURL()` host is unstable and Chrome extension ids differ
   between dev and store builds.

**Cost, stated plainly:** one new runtime dependency (`@atproto/oauth-client-node`),
the project's first server-side secret, the project's first database, and a
rewrite of privacy/terms copy that currently promises none of those exist.

---

## Implementation status

Built, and green through `npm run lint && npm run typecheck && npm test &&
npm run build`, the extension suite (305 tests) and the packages suite:

| Phase | State |
| --- | --- |
| 0 — sign-off, `.gitignore` | done |
| 1 — key generator, keyset, client metadata, JWKS | done |
| 2 — storage, lock, sessions, login/callback/session/logout/exchange/sessions | done |
| 3 — XRPC proxy, client shim, auth-mode dispatch | done |
| 4 — spaces delegation token and consent | done |
| 5 — `/account` device list, terms and privacy rewrite, fork and dev docs | done |
| 6 — extension client (read-only) | done |

**None of it is live.** Every route answers 503 until `ATURI_OAUTH_JWK_ACTIVE`,
`ATURI_DB_URL`, `ATURI_DB_SERVICE_KEY` and `ATURI_SESSION_ENC_KEY` are all set,
and `NEXT_PUBLIC_AUTH_MODE` resolves to `browser` when they are not — so the
build in CI, every preview, and any fork behave exactly as before. Going live
means applying `sql/001_oauth_bff.sql`, exposing the `aturi` schema to the
Data API, and setting the variables on staging.

### Where the implementation diverged from the plan, and why

1. **No `server-only` package.** It resolves through the `react-server` export
   condition, which plain `node --test` does not set, so it breaks `npm test`
   for any module a test touches. The substitute is an ESLint
   `no-restricted-imports` rule (`eslint.config.mjs`) forbidding
   `@/lib/oauth/server/*` outside the route handlers, plus
   `scripts/check-env-names.mjs` in `npm run lint`, which fails on a
   secret-shaped `NEXT_PUBLIC_` name. This also keeps the dependency ask to
   exactly the one that was approved.

2. **Only the PostgREST driver ships.** `StoreDriver` is the interface the plan
   described, but a `pg` implementation would be a second dependency, so it is
   documented rather than bundled and `ATURI_DB_DRIVER=pg` fails loudly instead
   of falling back.

3. **The CSRF binding lives inside the sealed application state, not in its own
   column.** Stronger than the planned `flow_sha256` column: it sits inside the
   AES-GCM envelope, so it cannot be read or forged from the database side
   either, and it needs no schema surface. `SealedStateStore.peekAppState()`
   reads it *before* the code exchange, which is also what lets the failure
   path recover the right return target.

4. **Sign-in dispatch lives in the provider's `signIn`, not in
   `useSignInFlow`.** The completeness review was right that two surfaces
   bypass that hook — `AccountTab.tsx:298` and `SpacesLanding.tsx:451` call the
   context's `signIn` directly — so patching the hook would have left both
   minting legacy sessions. Dispatching one level down covers all three with no
   per-surface change.

5. **`ScopeSelector` is untouched.** Rather than widen `onContinue` to carry
   permission ids, the provider inverts the scope string with
   `scopeIdsFromString` (new, in `scopes.ts`, with a round-trip test). Callers
   keep passing what they always passed.

6. **`useSpaceAccess` gained a consent helper, not an `ownPdsFetch` closure.**
   The shim special-cases `getDelegationToken` internally, so the only change
   is that unlocking an authority now also records that consent server-side.
   `spaceCredential.ts`, `spaceDpop.ts` and `spaceClient.ts` are byte-identical.

7. **The request-body cap is 4 MB, not 5.** Vercel rejects a body over 4.5 MB at
   the platform edge before the handler runs, so a 5 MB cap would be
   unreachable and anything in between would surface as an opaque platform
   error rather than a clean 413.

8. **`com.atproto.repo.uploadBlob` is not in the proxy allowlist.** Nothing in
   the app calls it; allowlisting an authenticated multi-megabyte write
   endpoint ahead of a caller is free exposure. It goes in with its caller.

9. **`scripts/alias-resolve.mjs` now also resolves extensionless relative
   imports.** Tests could previously only reach modules whose entire import
   graph used the `@/` alias — a limit that was invisible until a test imported
   one that didn't.

10. **The `pg_cron` sweep is a separate file** (`sql/002_cron_supabase.sql`).
    `cron.schedule` errors on any Postgres without the extension, which is
    exactly the Neon or self-hosted case a fork is most likely to be on.

11. **The extension's session is minted when its code is redeemed**, not at the
    callback, so `exchange_codes` never holds a credential — the same rule
    `app_sessions` follows by storing only a hash.

12. **`/api/oauth/login` requires the navigation to have started on this site**
    (`Sec-Fetch-Site`, with `Referer` as the fallback). Without it a hostile
    page could navigate a visitor here with a `handle` naming an authorization
    server it controls: the visitor would see an aturi-branded consent screen
    on that server and, on authorising, be signed in to an account the attacker
    owns — writing what they believe is their own content into the attacker's
    repo. The flow cookie does not catch this; it proves the flow started in
    this browser, not that the user asked for it. Extension flows are exempt,
    being cross-site by construction, and are bound by the PKCE verifier
    instead.

### Accepted limitations

Two things a review flagged that are deliberately not fixed, recorded so nobody
has to rediscover the reasoning:

- **The encryption envelope carries no key id**, so `ATURI_SESSION_ENC_KEY`
  cannot be rotated without re-encrypting every row. Adding a `kid` field now
  would be half a rotation mechanism with no second key to point at; the
  migration that needs it can add both together. Until then, rotating that key
  logs everyone out — which the key-handling section already says.

- **Revocation lags by up to 60 seconds across instances.** The token-to-session
  cache is per-instance, so a session revoked on one instance can still be
  honoured briefly by another. That is the same trade the reference backend
  makes, and it is what keeps a warm instance from paying a database round trip
  on every proxied call. The bound is the cache TTL; shortening it trades
  latency for promptness, and removing it is the option nobody should take
  quietly.

### What the review changed

Five adversarial lenses were run over the implementation and each finding put
through a refutation pass: 15 of 33 survived, and all 15 are fixed. The two
worth remembering, because both were cases of guarding against something the
SDK does not do:

- **`OAuthSession.fetchHandler` returns a 401; it does not throw.** It has
  already attempted a forced refresh by then, so that response means the grant
  is dead. The proxy's entire `/invalid token/i` catch branch was unreachable.
  Detection now reads the `WWW-Authenticate` challenge off the response, and
  the shim only ends a session on the backend's own error codes — a bare 401
  relayed from a PDS about one record used to sign the user out of everything.

- **`/api/oauth/login` accepted a cross-site navigation.** A hostile page could
  send a visitor there with a `handle` naming an authorization server it
  controls; the flow cookie could not catch it, because the victim's own
  browser was the thing that minted it. Note that refusing an `https://` handle
  would not have closed this — a bare handle resolves through DNS to a
  `did:web` on the same attacker host and reaches the same state. The check has
  to be on who started the navigation.

A regression test now derives the proxy's allowlist from `spaceClient.ts`
rather than restating it, in both directions: a method the client can send over
OAuth but the proxy omits fails, and so does an allowlisted method nothing
sends. That is the drift that produced the `getLatestCommit` and `listRepoOps`
gap in the first place.

### Extension sign-in, as built

Read-only, and off unless a user goes looking for it: Settings → Account, a
handle, and a browser-managed consent window. `?scopes=` is sent empty, which
yields `atproto` plus the AppView read token and nothing that can write — a
narrower grant than the website asks for, and a much easier thing to put in
front of a store reviewer.

What it buys, in v1: importing the waypoint groups and custom waypoints you
already built on the website, read from your own
`to.aturi.actor.preferences` record. One-directional on purpose — `putRecord`
replaces a whole record, and the extension knows about a fraction of the ~25
fields the web app writes, so an extension that wrote back would silently
delete the rest. That is also why the grant is read-only rather than the
read-only-ness being a consequence of the feature.

Three things are enforced rather than documented:

- **Sign-in throws if called from the popup.** `launchWebAuthFlow` opens a
  separate window, which destroys the popup and collects the pending promise
  with it. It works in development, where devtools often holds the popup open,
  and hangs in a real install — so the check is a runtime guard, with a test.
- **The token is in `storage.local`, never in the prefs object.** `prefs.ts`
  serialises the whole `Prefs` object to `storage.sync`, which uploads it to
  Google or Mozilla. A test reads both files and fails if the keys converge or
  if `session.ts` ever reaches for `storage.sync`.
- **Only the backend's own auth failures clear the token.** A 401 relayed from
  a PDS is about the record, not the session.

Store paperwork is done in the same change, which is the only way it stays
true: `data_collection_permissions` is now `['authenticationInfo']` (and
deliberately not `websiteContent` — page scanning still never leaves the
device), and both privacy documents — `extension/PRIVACY.txt` and
`src/app/extension/privacy/page.tsx`, which had drifted three months apart —
were rewritten together and now carry a Signing in section. Every no-data
claim is scoped so it stays true for someone who never signs in, because for
them it is.

### Still open

- **`testing.aturi.to`'s Vercel project.** Decides whether staging shares
  production's signing key. Needs a look at the dashboard.
- **Pin the Chrome extension `key`** in the manifest, from the Web Store
  item's public key, so a development build and the published one share an id.
  Without it every developer's unpacked build has a different
  `chromiumapp.org` origin. Not blocking — the flow does not depend on an
  allowlisted redirect — but it is the difference between sign-in working
  first try in development and not.
- **Chrome Web Store's Privacy practices tab** has to tick "Authentication
  information" to match the manifest. The store cross-references them.
- **Safari and Firefox for Android.** Safari Web Extensions do not implement
  `browser.identity` at all, and Android support is unconfirmed. The extension
  fails with a clear message rather than hanging, and §8's nonce-and-claim
  flow is the portable alternative if either becomes a target.

---

## 0. What was verified, and what is assumed

Verified directly in this repo, the live database, and published package
tarballs:

- aturi uses **no** Supabase and no database of any kind today. Every
  `process.env` in `src/` is `NEXT_PUBLIC_*` or a Vercel-injected `VERCEL_*`.
  The single "supabase" hit is a string literal in `src/utils/credBlueScore.ts:13`.
- The `aturi` **schema already exists** in the shared `atpota.to` Supabase
  project (`zdzjtziydmwkxbzlkwxv`, Postgres 17, us-east-1) holding three empty
  cocoon-shaped tables: `aturi.aturi_oauth_sessions`, `aturi.aturi_oauth_state`,
  `aturi.aturi_frontend_sessions`. They are **not** in `pgrst.db_schemas`, so
  PostgREST cannot see them at all today.
  (`anisota-cocoon/sql/migrations/005_rls_security_hardening.sql:33-35` still
  names them as `public.aturi_*`, which is stale — they were moved.)
- `@atproto/oauth-client-node` **cannot run on Vercel Edge**:
  `dist/node-oauth-client.js` requires `node:crypto`, and it reaches
  `node:dns`/`node:net`/`undici` through `@atproto-labs/handle-resolver-node`.
  This is not a conflict — the repo already mixes runtimes
  (`src/app/api/did-doc/route.ts:7` is `nodejs`; eight other routes are `edge`).
- Keys are **ES256 (P-256)**, not RS256. `anisota-cocoon/scripts/generate-oauth-key.js`
  says so outright; its own `env.example:160` and `BACKEND_OAUTH_SETUP.md` still
  document RSA and are wrong.
- CI (`.github/workflows/ci.yml`) runs `npm run build` annotated "no secrets are
  required."
- Per the atproto OAuth spec, a **web** client's `redirect_uris` have no
  origin-matching requirement against the `client_id` (only *native* clients do).
  The `http://localhost` client-id shortcut generates
  `token_endpoint_auth_method: 'none'` and has **no confidential equivalent**.
- `anisota-cocoon` declares `"license": "MIT"` in `package.json:31` and its
  README says MIT, but the `LICENSE` file it points at does not exist. MIT → GPL-3.0
  is a compatible direction, so porting is fine; add the missing LICENSE file to
  cocoon and keep MIT attribution on any near-verbatim port.

Assumed, and worth checking before Phase 0 closes:

- Whether `testing.aturi.to` is an alias on Vercel project
  `prj_qSXta9t84ecBnmX31v7iOkozD0o9` or a separate project. This decides whether
  staging shares production's signing key. It is **not** in that project's domain
  list despite `src/app/oauth-client-metadata.json/route.ts` allowlisting it.
- Whether `launchWebAuthFlow` works on Firefox for Android (the manifest targets
  `gecko_android` 142+). Safari Web Extensions do **not** implement
  `browser.identity` at all.
- The `clientAttestation` wire format for `#allowList` spaces. No implementation
  exists in either released or spaces-alpha `oauth-provider` builds.

---

## 1. Architecture

### Shape

```
aturi.to  (one Vercel project, one deploy)
│
├─ src/app/oauth-client-metadata.json/route.ts   [edge]    UNTOUCHED — legacy public client
├─ src/app/oauth/callback/page.tsx               [client]  UNTOUCHED — legacy callback page
│
├─ src/app/oauth/client-metadata.json/route.ts   [edge]    NEW — confidential client_id
├─ src/app/oauth/jwks.json/route.ts              [nodejs]  NEW — public JWKS
│
├─ src/app/api/oauth/
│   ├─ login/route.ts                            [nodejs]  GET  → PAR + 302 to the AS
│   ├─ callback/route.ts                         [nodejs]  the registered redirect_uri
│   ├─ session/route.ts                          [nodejs]  GET  { did, client, scope, pds, … }
│   ├─ logout/route.ts                           [nodejs]  POST ?scope=client|all
│   ├─ exchange/route.ts                         [nodejs]  POST { code, verifier } → bearer
│   ├─ sessions/route.ts                         [nodejs]  GET list + DELETE one (account UI)
│   ├─ xrpc/[nsid]/route.ts                      [nodejs]  path-passthrough proxy
│   └─ space/delegation-token/route.ts           [nodejs]  consent-gated mint
│
├─ src/lib/oauth/scopes.ts                       shared, unchanged — imported by BOTH sides
├─ src/lib/oauth/bffSession.ts                   NEW — the client shim (~90 lines)
├─ src/lib/oauth/authMode.ts                     NEW — browser | bff dispatch
└─ src/lib/oauth/server/**                       NEW — server-only, never client-reachable
```

Everything under `src/lib/oauth/server/**` and `src/app/api/oauth/**` sits
outside the `@aturi/*` alias the extension resolves (`extension/wxt.config.ts`
aliases `@aturi` → `../src/utils`) and outside the six files
`packages/waypoints/scripts/sync.mjs` copies. **Nothing server-side goes in
`src/utils/`**, per AGENTS.md rule 2. In particular, do not route BFF fetches
through `src/utils/upstreamFetch.ts` — it is exported into the **MIT**
`@aturi.to/waypoints` package and AGENTS.md rule 4 forbids mixing GPL code into
anything the sync script exports.

### Why in-app rather than a second repo

`src/lib/oauth/scopes.ts` is the single source for three things that must agree
byte for byte: `METADATA_SCOPE` (served by the metadata route), the runtime
string from `buildScopeString()` (sent at sign-in), and `GRANULAR_SCOPES` (what
the picker renders). The file spends eighty lines defending exactly that
invariant, because "the declared-vs-requested check is a plain array membership
test."

A separate backend puts the metadata route and the login route in one repo while
the picker stays in another, degrading a compiler check into a cross-repo sync
problem. This repo has already paid that tax once — AGENTS.md rule 1,
`packages/waypoints/scripts/sync.mjs`, and the `sync:check` CI gate exist
*because* `src/utils/*` had to be duplicated into `packages/`. Paying it a second
time, for the strings that gate what a user's account can do, is the wrong trade.
`scopes.ts` has zero imports, so in-app it is one `import` and drift becomes
impossible rather than merely detected.

Same-origin also buys a real security property: the callback handler sets an
`HttpOnly` cookie directly and 302s, so the session token never enters a URL, a
`Location` header, an access log, browser history, or a `Referer`. cocoon cannot
do this — `lib/callback-redirect.js:14-21` still puts a 30-day bearer in the
query string, a deliberate regression after a July 2026 sign-in-loop incident.

**Reusing anisota-cocoon is rejected** on a user-facing rather than an
engineering argument: `client_id` is per-origin and non-negotiable, so an
aturi.to sign-in would show "Anisota Cocoon" on the PDS consent screen and in the
user's authorized-apps list forever, consenting against Anisota's scope superset
(`include:net.anisota.authFullApp`, `repo:social.grain.*`, `blob:*/*`, …). That
is the direct opposite of what `scopes.ts` was built for.

**The honest cost of in-app**, not argued away: a bad app deploy now also breaks
sign-in, and the app's deployment holds a signing key and a database credential.
Both are contained by mechanism (§6), not by relocation — a separate Vercel
project under the same team, deployed by the same operator against the same
database, relocates the blast radius rather than shrinking it.

### The client shim

`src/lib/oauth/bffSession.ts`, ~90 lines:

```ts
createBffSession({ did, scope, pds, bearer? }) → {
  sub: string;                     // useSpaceAccess.ts:288, spaceCredential
  did: string;                     // Agent.did / assertDid
  fetchHandler(path, init?, opts?): Promise<Response>;
  getTokenInfo(refresh?: false): Promise<{ scope?, aud?, sub }>;
  signOut(): Promise<void>;
}
```

`fetchHandler` parses the `/xrpc/<nsid>?<qs>` that `XrpcClient` hands it and
re-issues to `/api/oauth/xrpc/<nsid>?<qs>` with `credentials: 'same-origin'`
(web) or `Authorization: Bearer` (extension, localhost dev).

**One deliberate, loudly-commented special case:** a path of
`/xrpc/com.atproto.space.getDelegationToken?space=…` routes to
`POST /api/oauth/space/delegation-token`, with the JSON response re-wrapped as a
`Response` carrying the upstream status and body. This is what lets
`spaceCredential.ts`, `spaceDpop.ts` and `spaceClient.ts` stay **byte-identical**.
Verify the synthesized `Response` satisfies `getDelegationToken`'s three uses —
`res.ok`, `res.json()`, and `readSpaceXrpcError(res, res.url || path)` (a
constructed `Response` has `url === ''`, so the `|| path` fallback fires, which
is correct).

Note the third `opts` parameter: `OwnPdsFetch` is declared as
`(path, init?) => Promise<Response>`, so the consent channel in §7 is an
*extra* argument the shim reads and the type tolerates. Widen the `OwnPdsFetch`
type or pass consent another way — do not leave the declared and actual
signatures disagreeing.

### Files that change

| File | Change |
| --- | --- |
| `src/components/AtprotoSessionProvider.tsx` | widen `session` from `OAuthSession` to a structural `AtSession`; probe `/api/oauth/session` on mount before falling back to `client.init()`; take `grantedScope`/`pds` from the session response in BFF mode |
| `src/components/oauth/ScopeSelector.tsx` | `onContinue(scopeString)` → `onContinue(scopeString, selectedIds)` — one line at `:124`, one signature at `:28` |
| `src/components/oauth/useSignInFlow.ts` | `submitScopes(scopeString, ids)`; in BFF mode navigate to `/api/oauth/login?…&scopes=<ids>` |
| `src/components/explore/space/useSpaceAccess.ts` | `ownPdsFetch` at `:262-265` becomes a consent-aware closure (~15 lines). See §7. |

**Audit for sign-in entry points that bypass `useSignInFlow`.** Patching only
that hook leaves any surface calling the context's `signIn()` directly still
minting legacy-client sessions. Grep for `signIn(` across `src/components/**`
before Phase 3 and route every entry point through one place.

**Zero diff, and a diff here is a review smell:** `spaceClient.ts`,
`spaceCredential.ts`, `spaceDpop.ts`, `recordBackend.ts`, `RecordEditor.tsx`
(719 lines, already behind a `RecordBackend` prop), `writes.ts` (already behind
`type WriteAgent = Pick<Agent,'com'> & { assertDid: string }`),
`preferencesPds.ts`, `appview.ts`, `CollectionExplorer.tsx`,
`src/app/oauth/callback/page.tsx`, and the 23 identity-only consumers.

---

## 2. Endpoint surface

All BFF routes: `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`.
Config validated **inside the handler**, never at module scope — see Risk 6.

### `GET /oauth/client-metadata.json` *(edge — static JSON)*

Host-keyed off the existing `isAllowedHost` helper (`aturi.to`, `www.aturi.to`,
`testing.aturi.to`), so staging keeps its own client identity.

```json
{
  "client_id": "https://aturi.to/oauth/client-metadata.json",
  "client_name": "aturi.to",
  "client_uri": "https://aturi.to",
  "logo_uri": "https://aturi.to/icon.svg",
  "tos_uri": "https://aturi.to/terms",
  "policy_uri": "https://aturi.to/terms",
  "redirect_uris": ["https://aturi.to/api/oauth/callback"],
  "scope": "<METADATA_SCOPE>",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "application_type": "web",
  "dpop_bound_access_tokens": true,
  "token_endpoint_auth_method": "private_key_jwt",
  "token_endpoint_auth_signing_alg": "ES256",
  "jwks_uri": "https://aturi.to/oauth/jwks.json"
}
```

Hard constraints, each failing at client-construction time rather than at runtime:

- `token_endpoint_auth_signing_alg` is **mandatory** with `private_key_jwt` and
  **forbidden** with `none`.
- The alg must be `ES256`.
- `jwks` and `jwks_uri` are mutually exclusive; use `jwks_uri` so rotation is
  possible. (Note the library injects `jwks` from the keyset when neither is
  present — set `jwks_uri` explicitly.)
- `client_uri` must share the `client_id` origin and be a path-parent of it.
- **`redirect_uri` is `/api/oauth/callback`, not `/oauth/callback`.** The latter
  is the existing legacy client page; colliding there breaks the legacy flow.
- `Cache-Control: no-store` (the current route sets `max-age=300`). The AS caches
  this ~10 minutes in-process anyway; a CDN copy on top masks deploys.

For a fork, the host-keyed `isAllowedHost` must be driven from
`NEXT_PUBLIC_DOMAIN` rather than hardcoded, or forks serve a 400 forever.

### `GET /oauth/jwks.json` *(nodejs)*

Public JWKs from the keyset. Keep the CDN cache **short or absent**: a 300s CDN
cache sits in front of the AS's own ~10-minute in-process JWKS cache, and during
rotation the effective propagation delay is the sum.

### `GET /api/oauth/login`

Accepts **exactly these parameters** and forwards nothing else:

| Param | Validation |
| --- | --- |
| `handle` | handle \| DID \| https URL shape; https URLs go through `src/utils/ssrfGuard.ts` before `authorize()` performs discovery against them |
| `scopes` | comma-separated `ScopeId`; validated against `ALL_SCOPE_IDS`; **any unknown id is a 400, never a silent narrowing** |
| `client` | `web` \| `extension` |
| `return` | root-relative path (web) or exact-match entry in `ATURI_EXTENSION_RETURN_ORIGINS` |
| `challenge` | extension only — base64url `SHA-256(verifier)`, see §8 |

Then `buildScopeString(new Set(ids))`, and **always pass an explicit `scope`** —
omitting it makes `@atproto/oauth-client` fall back to `clientMetadata.scope`,
which for aturi is the full declared union including whole-space read and space
writes.

**Do not copy cocoon's `api/oauth/login.js:61` `...otherOptions` spread.** It
forwards caller-controlled `prompt`, `display`, `max_age` and
`authorization_details` straight into `authorize()`, and `?prompt=none` on a
confidential client is a silent-authorization path.

Pass `prompt: 'consent'` in v1 (see §4).

**Bind the flow to this browser** — this closes the most serious hole in the
design and has no analogue in cocoon. `@atproto/oauth-client`'s `authorize()`
writes `{iss, dpopKey, authMethod, verifier, appState}` into the state store
keyed only by a random `state` nonce, and `callback()` mints a session for
*whoever presents it*. Today's public client is immune because the state store is
the victim's own IndexedDB — that per-browser binding **is** the CSRF defence,
and moving the store to shared Postgres deletes it. Without a replacement, an
attacker starts a flow with their own account, captures `code`+`state` from their
own callback, then makes the victim's browser issue a top-level GET to
`https://aturi.to/api/oauth/callback?code=…&state=…&iss=…` — and the victim's
browser now holds a session cookie for the **attacker's** DID, silently, with
every subsequent write landing in the attacker's repo.

The fix: `/api/oauth/login` sets a short-lived
`__Host-aturi_flow=<random>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
cookie and stores `sha256(flow_nonce)` on the `oauth_state` row. `/api/oauth/callback`
requires the cookie, requires it to match the row, and clears it. Extension flows
carry the nonce in the state row and match it against the PKCE verifier at
`/api/oauth/exchange` instead.

**Rate-limit it.** It performs outbound identity resolution against an
attacker-supplied identifier, an AS metadata fetch, a PAR call, and a row write —
all unauthenticated.

### `GET /api/oauth/callback`

The registered `redirect_uri`. Verify the flow-binding cookie, then
`client.callback(params)` → `{ session, state }`.

- **web:** `Set-Cookie: __Host-aturi_sid=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<ttl>`
  and 302 to the validated return path.
- **extension:** mint a one-time ~60s exchange code, 302 to the allowlisted
  return origin with `#code=…` only.
- **error path:** recover the return target from the state-store row keyed by
  the state key **before** the code exchange. Do not `JSON.parse` the wire
  `state` — it is the library's opaque key and always throws, which is why
  cocoon's `api/oauth/callback.js:48-58` silently sends staging users to
  production.

Use the **`__Host-` prefix**. It forbids a `Domain` attribute, so nobody can
later "fix" cross-subdomain sign-in by setting `Domain=.aturi.to` and thereby
expose the session cookie to every current and future aturi.to subdomain.

The server-side 302 bypasses two pieces of return logic that live on the client
today: `takeReturnPath()` (`src/lib/oauth/returnTo.ts`, sessionStorage) and
`landingFor()`'s `GENERIC_ORIGINS` mapping (`src/app/oauth/callback/page.tsx`),
which sends a sign-in from a generic page to the user's own repo. Port
`landingFor` server-side; keep `isSafeReturnPath` but harden it — `startsWith('/')
&& !startsWith('//')` is adequate for a client-side `router.push` but not as a
server redirect validator (`/\evil.example` and backslash variants).

### `GET /api/oauth/session[?lite=1]`

Reads the denormalised `granted_scope`/`pds` off the row. **No restore, no
refresh, no PDS round trip.** `?lite=1` is a side-effect-free liveness probe: a
single row read, no refresh, no writes — for checking non-active accounts.

Three statuses the client branches on, and the split is load-bearing:

- `200 { did, client, scope, pds, expiresAt, handle? }`
- `401 { code: 'SESSION_INVALID' }` — definitive
- `503 { code: 'SESSION_TRANSIENT' }` — DB hiccup or cold start

Without that split, a Postgres blip bounces every user through re-authorization.
Bump `last_seen_at` at most once per hour (sliding expiry — cocoon has none).

**This adds a serverless round trip to every mount, for every visitor including
anonymous ones,** before `loading` goes false. Gate the probe on a cheap
client-side hint (a non-HttpOnly `aturi_signed_in=1` companion cookie set
alongside the session cookie) so anonymous visitors skip it entirely.

### `POST /api/oauth/logout?scope=client|all`

Default `client`: delete this app-session row only; if it was the last for that
`(did, client)`, force-delete that grant and revoke it at the PDS. `all`: do that
for every client. cocoon conflates these (`api/oauth/logout.js:51-70`), so
signing out in one tab kills every device — which compounds badly once an
extension holds a long-lived token.

### `GET /api/oauth/sessions` · `DELETE /api/oauth/sessions/[id]`

Backs the `/account` list: "This browser", "Aturi extension (Chrome)", last-seen,
per-row revoke.

### `POST /api/oauth/exchange`

`{ code, verifier }` → `{ token, did, expiresAt }`. Single-use, delete-on-read,
60s TTL, `Cache-Control: no-store`. Extension only.

**The `verifier` is not optional.** This endpoint is `ACAO: *` and
unauthenticated; a bare `{code}` is redeemable by anyone who observes the
redirect. The extension generates a random 32-byte `verifier`, sends
`challenge = base64url(SHA-256(verifier))` to `/api/oauth/login`, and the
exchange row stores the challenge. Redemption requires
`SHA-256(verifier) === stored_challenge`, compared in constant time. This is what
makes the loose return-origin situation (§8) safe: a hostile extension that
somehow observes the redirect still cannot redeem the code.

### `GET|POST|PUT|DELETE /api/oauth/xrpc/[nsid]`

The NSID arrives as **our own route segment**; the upstream path is rebuilt
server-side as `` `/xrpc/${nsid}${request.nextUrl.search}` ``. A caller-supplied
path is never concatenated. Use a **single dynamic segment** `[nsid]`, not a
catch-all `[...nsid]` — a catch-all accepts slashes, which is what the guard
exists to prevent.

Validate `/^[a-z][a-z0-9]*(\.[a-zA-Z0-9]+){2,}$/` plus a ban on
`__proto__`/`constructor`/`prototype`, then check a **literal allowlist**:

```
com.atproto.repo.{getRecord,putRecord,createRecord,deleteRecord,applyWrites,listRecords,describeRepo}
com.atproto.space.{listSpaces,getRecord,listRecords,putRecord,createRecord,deleteRecord}
com.atproto.simplespace.{listMembers,getSpace}
app.bsky.actor.getProfile
```

Derive this list from **every** `SpaceTransport` call site, not only those that
`assertTransport(t, 'oauth', …)` — several space methods accept either transport
and route through OAuth when that is what they were handed. Auditing only the
asserted ones undercounts and produces 403s in exactly the paths spaces need.
`com.atproto.repo.uploadBlob` is **omitted**: nothing in the codebase calls it
today, and allowlisting it opens an authenticated write endpoint for no current
caller. Add it in the phase that adds a caller.

`com.atproto.space.getDelegationToken` is **deny-listed here** — it has its own
consent-gated endpoint (§7).

Mechanics that are not optional:

- **Buffer the request body** with `await request.arrayBuffer()` before calling
  `fetchHandler`. `@atproto/oauth-client`'s `oauth-session.js:88` refuses its
  refresh-and-retry when `init.body instanceof ReadableStream`, so streaming
  silently disables refresh-on-401 for **every write**.
- **Cap the body at 4 MB, not 5.** Vercel Functions reject request bodies over
  4.5 MB at the platform edge before the handler runs, so a 5 MB cap is
  unreachable and uploads between 4.5 and 5 MB return an opaque platform error
  instead of a clean 413.
- **Buffer the response and rebuild headers from an allowlist** —
  `content-type`, `ratelimit-*`, `retry-after`, `atproto-*`. undici keeps
  `content-encoding` while decoding the body, so blind passthrough yields a
  corrupt response.
- **Forward request headers from an allowlist**, and **validate
  `atproto-proxy`'s value**, not just its name. The header names a DID plus a
  service fragment which the user's own PDS resolves and then forwards the
  request to — a caller-controlled value is a request-forgery primitive carrying
  a user-identifying service-auth token. Allowlist the handful of legitimate
  values (`did:web:api.bsky.app#bsky_appview`,
  `did:web:api.blacksky.community#bsky_appview`, the chat service), or at minimum
  require `did:web:` plus a known-host regex plus a known fragment.
- **Return upstream status and body bytes verbatim.** No `{success, data}`
  envelope anywhere — three call sites parse structure off thrown errors, and one
  of them (`preferencesPds.ts:82-96` distinguishing `RecordNotFound` from a bare
  400, feeding `PreferencesProvider.tsx:105-118`) is a **data-loss path**.
- **Rate-limit per app session.** cocoon has none on its most expensive path.

### CORS

Applied to `/api/oauth/*` only: `Access-Control-Allow-Origin: *`,
`Access-Control-Max-Age: 86400`, allow-headers
`Content-Type, Authorization, atproto-proxy, atproto-accept-labelers, accept-language`.
**No `Access-Control-Allow-Credentials`** — it is invalid with `*`, and its
absence is precisely what makes the wildcard safe, because the cookie path is
same-origin only.

The cookie path is additionally gated by an `Origin` check. **But note it fails
open**: cross-site top-level GET navigations send no `Origin` header at all, and
`SameSite=Lax` sends the cookie on exactly those. So the check must be "reject
when `Origin` is present and foreign" **plus** "require `Sec-Fetch-Site: same-origin`
where available" **plus** the flow-binding cookie above. Treat the `Origin` check
as defence in depth, never as the control.

Extension origins are structurally unallowlistable — Firefox background scripts
send `Origin: null`, Chrome extension ids are unstable before store publication —
so bearer + wildcard is the only workable presentation.

---

## 3. Database schema

Target: Supabase project `atpota.to` (`zdzjtziydmwkxbzlkwxv`), schema `aturi`.

The schema already exists there with three **empty** cocoon-shaped tables and is
**not in `pgrst.db_schemas`** — PostgREST 404s every table until `aturi` is added
to Settings → API → Exposed schemas. Worth stating twice: the code will look
right and every query will fail.

Check the migration into `sql/001_oauth_bff.sql` so a fork can apply it. **Keep
`pg_cron` scheduling in a separate `sql/002_cron_supabase.sql`** — a
`SELECT cron.schedule(...)` in the main file errors on any Postgres without
`pg_cron`, i.e. exactly the Neon / self-hosted targets the `pg` driver exists to
support.

```sql
-- Empty scaffolding from an earlier attempt. The aturi_* prefix is redundant
-- inside a namespaced schema.
DROP TABLE IF EXISTS aturi.aturi_oauth_sessions,
                     aturi.aturi_oauth_state,
                     aturi.aturi_frontend_sessions;

-- 1. The ATProto grant. Keyed (sub, client) so the web app and the extension
--    hold independent authorizations and independent rotating refresh tokens.
--    session_data is an AES-256-GCM envelope of the library's NodeSavedSession.
CREATE TABLE aturi.oauth_sessions (
  sub           text NOT NULL,
  client        text NOT NULL CHECK (client IN ('web','extension')),
  session_data  jsonb NOT NULL,
  granted_scope text,           -- denormalised tokenSet.scope, for cheap /session
  pds           text,           -- denormalised tokenSet.aud
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sub, client)
);

-- 2. Ephemeral authorize-request state (PKCE verifier, nonce, ephemeral DPoP key).
--    flow_sha256 binds the row to the browser that started it — see §2.
CREATE TABLE aturi.oauth_state (
  key         text PRIMARY KEY,
  state_data  jsonb NOT NULL,
  flow_sha256 text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE INDEX oauth_state_expires_idx ON aturi.oauth_state (expires_at);

-- 3. App sessions. ONLY a sha256 of the opaque token is stored, so a database
--    dump cannot be replayed. (cocoon stores the raw 30-day bearer as the PK,
--    one table over from AES-GCM-encrypted OAuth tokens.)
CREATE TABLE aturi.app_sessions (
  token_sha256 text PRIMARY KEY,          -- lowercase hex
  user_did     text NOT NULL,
  client       text NOT NULL CHECK (client IN ('web','extension')),
  label        text,                      -- 'Chrome extension', for /account
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX app_sessions_did_idx     ON aturi.app_sessions (user_did, client);
CREATE INDEX app_sessions_expires_idx ON aturi.app_sessions (expires_at);

-- 4. One-time exchange codes for the extension hand-off. challenge_b64 is
--    base64url(SHA-256(verifier)) — redemption requires the verifier.
CREATE TABLE aturi.exchange_codes (
  code_sha256   text PRIMARY KEY,
  challenge_b64 text NOT NULL,
  token         text NOT NULL,            -- held <= 60s
  expires_at    timestamptz NOT NULL
);

-- 5. Server-side authority-consent record for space delegation minting.
CREATE TABLE aturi.space_consents (
  session_sha256 text NOT NULL,
  authority_did  text NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_sha256, authority_did)
);

-- 6. Cross-instance refresh lock.
CREATE TABLE aturi.oauth_locks (
  key         text PRIMARY KEY,
  holder      text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX oauth_locks_expires_idx ON aturi.oauth_locks (expires_at);

-- 7. Rate limiting. Named as a requirement in four places above, so it needs a
--    mechanism: a fixed-window counter, atomic via ON CONFLICT.
CREATE TABLE aturi.rate_limits (
  bucket       text NOT NULL,   -- e.g. 'login:<ip-hash>' | 'xrpc:<session-hash>'
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX rate_limits_window_idx ON aturi.rate_limits (window_start);

CREATE FUNCTION aturi.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER oauth_sessions_touch BEFORE UPDATE ON aturi.oauth_sessions
  FOR EACH ROW EXECUTE FUNCTION aturi.touch_updated_at();

-- RLS enabled with NO policies = deny-all to anon/authenticated.
-- FORCE also binds the table owner. service_role carries BYPASSRLS, so RLS is
-- NOT what protects these tables from the backend — the REVOKEs below are what
-- protect them from the anon key once the schema is exposed to the Data API.
ALTER TABLE aturi.oauth_sessions ENABLE ROW LEVEL SECURITY; ALTER TABLE aturi.oauth_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE aturi.oauth_state    ENABLE ROW LEVEL SECURITY; ALTER TABLE aturi.oauth_state    FORCE ROW LEVEL SECURITY;
ALTER TABLE aturi.app_sessions   ENABLE ROW LEVEL SECURITY; ALTER TABLE aturi.app_sessions   FORCE ROW LEVEL SECURITY;
ALTER TABLE aturi.exchange_codes ENABLE ROW LEVEL SECURITY; ALTER TABLE aturi.exchange_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE aturi.space_consents ENABLE ROW LEVEL SECURITY; ALTER TABLE aturi.space_consents FORCE ROW LEVEL SECURITY;
ALTER TABLE aturi.oauth_locks    ENABLE ROW LEVEL SECURITY; ALTER TABLE aturi.oauth_locks    FORCE ROW LEVEL SECURITY;
ALTER TABLE aturi.rate_limits    ENABLE ROW LEVEL SECURITY; ALTER TABLE aturi.rate_limits    FORCE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA aturi FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA aturi FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA aturi REVOKE ALL ON TABLES FROM anon, authenticated;
GRANT USAGE ON SCHEMA aturi TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA aturi TO service_role;

-- Atomic acquire. RETURNING yields a row only when the INSERT or the guarded
-- UPDATE actually fired, so there is no second read for a rival instance to win
-- in between. cocoon's version (006_oauth_locks.sql:41-50) does a separate
-- `SELECT holder` after the upsert, which takes a fresh snapshot under READ
-- COMMITTED and can report success to two holders.
CREATE FUNCTION aturi.acquire_oauth_lock(p_key text, p_holder text, p_ttl_seconds int)
RETURNS boolean LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, aturi, pg_temp AS $$
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
$$;

CREATE FUNCTION aturi.release_oauth_lock(p_key text, p_holder text)
RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, aturi, pg_temp AS $$
  DELETE FROM aturi.oauth_locks WHERE key = p_key AND holder = p_holder;
$$;

REVOKE EXECUTE ON FUNCTION aturi.acquire_oauth_lock(text,text,int),
                           aturi.release_oauth_lock(text,text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION aturi.acquire_oauth_lock(text,text,int),
                          aturi.release_oauth_lock(text,text)
  TO service_role;
```

`sql/002_cron_supabase.sql` (Supabase only — `pg_cron` is already installed and
running three jobs on this project):

```sql
SELECT cron.schedule('aturi-oauth-sweep', '*/15 * * * *', $sweep$
  DELETE FROM aturi.oauth_state    WHERE expires_at < now();
  DELETE FROM aturi.app_sessions   WHERE expires_at < now();
  DELETE FROM aturi.exchange_codes WHERE expires_at < now();
  DELETE FROM aturi.oauth_locks    WHERE expires_at < now() - interval '5 minutes';
  DELETE FROM aturi.rate_limits    WHERE window_start < now() - interval '1 day';
  -- NOT IN with a NULLable subquery evaluates to NULL for every row and deletes
  -- nothing. Use NOT EXISTS.
  DELETE FROM aturi.space_consents sc
    WHERE NOT EXISTS (SELECT 1 FROM aturi.app_sessions a
                      WHERE a.token_sha256 = sc.session_sha256);
$sweep$);
```

cocoon has **never** swept: its `oauth_state` is 2,428 rows of which 2,428 are
expired, and `frontend_sessions` is 4,871 of which 4,420 are expired — dead
30-day bearer tokens sitting in a database indefinitely.

### Storage driver

`src/lib/oauth/server/store/driver.ts` — a narrow interface (`get`/`set`/`del`
per table, `rpc` for the two lock functions) with two implementations:

- `postgrest.ts` — plain `fetch` against `${SUPABASE_URL}/rest/v1/...` with
  `apikey`, `Authorization`, `Accept-Profile: aturi` on reads /
  `Content-Profile: aturi` on writes, `/rest/v1/rpc/<fn>` for the locks.
  ~60 lines, **no `@supabase/supabase-js`**.
- `pg.ts` — plain Postgres, for a fork on Neon or self-hosted.

Ship both from day one. This is the difference between forkability in principle
and in practice: a fork on Supabase's free tier loses sign-in entirely when the
project pauses after ~7 days of inactivity.

### Concurrency machinery, ported with its reasoning

The root problem: **ATProto refresh tokens are single-use and rotating**, and the
PDS invalidates the previous access token the instant one rotates. Concurrent
serverless instances refreshing the same `(sub, client)` destroy each other's
tokens; the symptom reads like a session-expiry bug — users randomly logged out
at app launch. Keying grants `(sub, client)` removes the *cross-client* half
outright. The rest still needs:

- **Two-tier lock.** `requestLock = (key, fn) => memoryLock.lock(key, () => pgLock.lock(key, fn))`,
  handed to `NodeOAuthClient`. `MemoryLock` collapses same-instance concurrency —
  use a per-key promise chain with an explicit timeout, **not** cocoon's
  unbounded `while (locks.has(key)) await sleep(10)` busy-wait over an uncapped
  Map. `PgLock`: 20s TTL, 6s max wait, jittered 75–250ms poll, **fail-open on
  every path**. Blocking auth is worse than a rare double refresh — and the wait
  usually pays off even when acquisition fails, because by then the holder has
  written its rotated tokens.
- **Two 60s per-instance TTL caches**, from day one. Cache A:
  `sha256(token)` → `{ did, client, expiresAt }`, max 10000. Cache B:
  `${client}:${did}` → restored `OAuthSession`, max 2000. Cache B is what turns
  the refresh lock from a per-request cost into a per-refresh cost. Eviction on
  `max` is a full `map.clear()`. **Both are correctness-neutral only because
  every caller tolerates a miss; keep that discipline.** Sizing reference:
  cocoon's proxy runs ~116k calls/day at ~4 sequential DB round trips each
  without them.
- **`sessionStore.del()` is an intentional no-op that only logs.** The library
  constructs with `deleteOnError: isExpectedSessionError`, so it deletes stored
  tokens on *any* transient refresh failure — frequent on serverless — permanently
  signing the user out even though another instance may have refreshed
  successfully moments earlier. Real deletion is `forceDelete(sub, client)`,
  called from exactly one place: `/api/oauth/logout`.

  **But separate transient failure from real revocation.** The no-op is right for
  the former and wrong for the latter: when the PDS says the grant is gone
  (`invalid_grant`, a revoked token), the row is dead and keeping it means every
  subsequent request pays three restore attempts plus backoff before returning
  401. Delete on a definitive revocation signal; no-op on everything else. Then
  hold the resulting invariant — an absent row means deliberate deletion — because
  that is what makes the `?lite=1` probe sound.
- **Retry ladders.** 3 restore attempts, `800ms × n` backoff, then
  `401 OAUTH_SESSION_MISSING`. Exactly one `Invalid token` retry: sleep 1200ms,
  re-restore with `{ fresh: true }` to pick up the race winner's rotated tokens;
  a second failure means the grant is permanently dead — evict, 401, **never fall
  back**.
- **`src/lib/oauth/server/retriable.ts`**, ported from
  `anisota-cocoon/lib/retriable-errors.js`, comment included. Retry once at 500ms
  on `UND_ERR_CONNECT_TIMEOUT`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN` **only**.
  Every one is a connection-*establishment* failure, so the request never left
  the process and a retry cannot duplicate a write. `UND_ERR_HEADERS_TIMEOUT`,
  `UND_ERR_BODY_TIMEOUT`, `ECONNRESET`, `UND_ERR_SOCKET` are excluded because
  they can occur after the PDS received the request. **A naive "retry network
  errors" rule double-likes posts.**
- **A per-request budget (~20s) degrading to a fast 503.** cocoon bounds each
  ladder individually but they compose: 3 restores × 6s lock wait + 800+1600ms
  sleeps + a 1200ms token retry can approach the 30s `maxDuration` and be killed
  by the platform instead of returning a clean error.

---

## 4. Scope handling

`src/lib/oauth/scopes.ts` is unchanged and is imported by both the metadata route
and the login route. That is the whole point of the in-app design.

**The frontend never sends a scope string.** `ScopeSelector` keeps rendering
labels and hints from `GRANULAR_SCOPES`; only what `onContinue` hands upward
changes — it now passes the `Set<ScopeId>` alongside the string (the string keeps
the legacy browser path working unchanged). The login route validates ids,
rejects unknown ones, and rebuilds canonically:

```ts
const ids = (searchParams.get('scopes') ?? '').split(',').filter(Boolean);
const valid = ids.filter((id): id is ScopeId => ALL_SCOPE_IDS.has(id as ScopeId));
if (valid.length !== ids.length) return badRequest('unknown scope id');
const scope = buildScopeString(new Set(valid));   // byte-exact against METADATA_SCOPE
```

This turns an open string parameter into a closed 7-value enum.

### The silent-SSO hazard, and why `prompt: 'consent'` is always-on in v1

A confidential client **loses the authorization server's forced consent screen**:
the provider injects `prompt: 'consent'` only when the client is not confidential
and not trusted. Combined with `login_hint` (which the client library always
sets) matching one active device session, and every requested scope already
present in the accumulated `authorizedScopes` for that (device account, client
id), an authorization completes with **no UI at all**.

Today's public client always shows the consent screen. `prompt: 'consent'`
always-on preserves that byte for byte and keeps aturi's own picker honest — the
user sees at their PDS the same list they just ticked. Narrowing it to "only when
the requested id set is wider than the last recorded set" is a later UX
optimisation that requires `granted_scope` to already be recorded and the
widening comparison to be exactly right, or it reintroduces silent SSO. Defer it.

### Drift protection

`src/lib/oauth/__tests__/loginScope.test.ts` — **`node:test`**, per
`package.json`'s `node --test "src/**/*.test.ts"`, not vitest (which cocoon
uses). Assert the login route's id→string function returns exactly
`buildScopeString` output for the same id set, and that the new metadata route's
`scope` field is exactly `METADATA_SCOPE`.

`extension/lib/__tests__/spaceScopes.test.ts` pins `DEFAULT_SIGN_IN_SCOPE` as a
hard-coded literal and would keep passing while a backend that assembled the
string elsewhere diverged in production. The new test closes that.

---

## 5. Client dispatch and the auth mode flag

`src/lib/oauth/authMode.ts` resolves `browser | bff` from `NEXT_PUBLIC_AUTH_MODE`
= `auto` (default) | `bff` | `browser`.

`auto` means: **use the BFF for NEW sign-ins when it is configured, but always
honour an existing browser-client session found in IndexedDB.** Existing
signed-in users are never logged out and never forced to re-authorize — they keep
running against the old public `client_id` until they sign out on their own. That
is the entire "never breaks signed-in users" guarantee, and it only works because
both clients live in one deployment.

`AtprotoSessionProvider` bootstrap, in order:

1. If BFF configured **and** the `aturi_signed_in` hint cookie is present:
   `GET /api/oauth/session`. On 200 → build the shim,
   `new Agent({ did, fetchHandler })`, set `grantedScope`/`pds` from the response.
   On 503 → retry 3× with `800ms × n` backoff and **never mark the account signed
   out**. On 401 → fall through.
2. `getOauthClient().init()` exactly as today.

`SessionContextValue` keeps its exact current field list. Only `session`'s type
widens from `OAuthSession | null` to:

```ts
type AtSession = {
  sub: string;
  fetchHandler(path: string, init?: RequestInit, opts?: unknown): Promise<Response>;
  getTokenInfo(refresh?: false): Promise<{ scope?: string; aud?: string }>;
  signOut(): Promise<void>;
};
```

`OAuthSession` satisfies this structurally, so the legacy path is unchanged and
the 23 identity-only consumers never appear in the diff.

Two things must be preserved that are easy to lose:

- **`pds` is not display metadata.** It is used as a repo host for real requests
  (`SpaceTree.tsx:168`, `YourSpaceRecordsSection`). If the BFF's `/session`
  response omits or approximates it, those calls target the wrong host.
- **Revocation must still propagate.** Today `getOauthEvents()` fires `'deleted'`
  and `AtprotoSessionProvider.tsx:78-91` responds by calling
  `clearSpaceCredentials()` and dropping the session. In BFF mode there is no
  such event — a 401 `SESSION_INVALID` from any proxied call must dispatch the
  same event so space credentials in memory are cleared. Without it, a revoked
  session leaves live credentials that read other members' private records.

`signOut` still calls `clearSpaceCredentials()` first in both modes.

Rollback is `NEXT_PUBLIC_AUTH_MODE=browser` — one env var, no OAuth-server
redeploy, and already-minted BFF sessions stay valid.

---

## 6. Secret containment

This is the sharpest objection to the in-app design and deserves mechanisms.

1. **Scope the secrets to Production only.** Vercel environment variables default
   to Production + Preview + Development. If `ATURI_OAUTH_JWK_ACTIVE` is added at
   that default, the confidential client's ES256 private key is present in every
   PR preview deployment — including a fork's — where any route can read it.
   "Previews stay signed out" governs the *return-origin allowlist*, not the
   secrets. Set every BFF secret for **Production only**, and staging's for the
   staging environment only.
2. **`import 'server-only'` at the top of every file under
   `src/lib/oauth/server/**`.** This is a *second* package (`server-only@0.0.1`,
   zero deps, 611 bytes) — it is **not** bundled with Next 16.1.1. It earns its
   place because a client-component import becomes a build failure rather than a
   lint warning. Two caveats: `npm test` is plain `node --test` with no
   `react-server` export condition, so verify `server-only` resolves there (or
   scope it so tests do not import those modules). The zero-package substitute is
   an ESLint `no-restricted-imports` rule forbidding `@/lib/oauth/server/*`
   outside `src/app/api/oauth/**` — note `npm run lint` is bare `eslint`, so the
   rule goes in `eslint.config.mjs`, not the script.
3. **`scripts/check-env-names.mjs`** in `npm run lint`: fail on any env name
   matching `NEXT_PUBLIC_.*(JWK|SERVICE|SECRET|ENC_KEY)`.
4. **No Server Component reads a secret** — route handlers only, so nothing can
   be serialised into an RSC payload.
5. **`session_data` is AES-256-GCM enveloped** under `ATURI_SESSION_ENC_KEY`, a
   key distinct from the database key. Database access alone then yields nothing
   usable — which matters because one service-role key on the shared `atpota.to`
   project reads anisota, cred-blue, trackerapp and typesapp too. Port
   `anisota-cocoon/lib/session-crypto.js`, but **fix its plaintext fallback**: it
   returns the object unchanged when no key is configured, which was correct for
   cocoon's live migration and is wrong for a greenfield table. Require the key;
   fail closed.

Plus: `*.jwk`, `*.jwk.json`, `oauth-key*.json` go into `.gitignore`. The current
file covers `*.pem`, `id_rsa*`, `id_ed25519*` but **not a JSON JWK**, in a repo
that `mirror-tangled.yml` force-pushes to a second host on every push.

### Key handling

`scripts/generate-oauth-key.mjs`: `crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })`,
export `{ format: 'jwk' }`, set `alg: 'ES256'` and a **required explicit unique
`kid`**. Do not set `use` (the library rejects it). **Print to stdout only.**

`src/lib/oauth/server/keyset.ts` loads `ATURI_OAUTH_JWK_ACTIVE` (signs, published)
and optional `ATURI_OAUTH_JWK_RETIRED` (published only). **Fail closed** on three
things cocoon gets wrong:

- A JWK with no explicit `kid` is rejected. cocoon defaults `kid` to
  `key1`/`key2`/`key3` by slot position, so rotating by swapping slot values
  silently reuses `key1` for a different key.
- A malformed JWK in a rotation slot is an error, not a `console.warn`-and-skip.
- **Never fall back to `token_endpoint_auth_method: 'none'`.** cocoon's
  `config.clientMetadata` flips to `'none'` when no key loads, silently
  republishing the same `client_id` as a *public* client. Refuse to serve
  metadata at all instead.

Rotation runbook: publish the new key as ACTIVE with the old as RETIRED, wait
past the AS's ~10-minute in-process JWKS cache (in-memory and per-AS-process, so
different PDS instances expire at different times — during that window a PDS
holding the old JWKS rejects the client assertion at the token endpoint), then
drop RETIRED.

---

## 7. Spaces and DPoP

### The split is forced, and it is the right one

- **Hop 1** — `com.atproto.space.getDelegationToken` on the user's *own* PDS,
  over OAuth → must go through the BFF.
- **Hop 2** — `com.atproto.space.getSpaceCredential` on the *authority's* host,
  presenting that delegation token plus a DPoP proof from a browser-generated
  **non-extractable** key → must stay in the browser.
- **Every subsequent read** — `Authorization: DPoP <credential>` plus a fresh
  proof → stays in the browser.

Moving the exchange server-side would force the DPoP key to be persisted across
stateless invocations, therefore extractable, destroying the guarantee
`spaceDpop.ts:121` (`generateKey(params, false, …)`) was written for; it would put
credentials that read *other members'* private records into a database at rest,
inverting the threat model `spaceCredential.ts:22-40` states; and it would require
accepting a host parameter from the client, reintroducing exactly the
token-egress hole the NSID validation closes. **Per AGENTS.md's
security-sensitive list, confirm this split explicitly rather than assuming it.**

### `POST /api/oauth/space/delegation-token`

Body: `{ space }` and nothing else.

1. Parse with `parseSpaceAtUri`, check `isSpaceRefParts`, and **re-serialize with
   `formatSpaceRef`** — never echo the caller's string, because the PDS compares
   a credential's `sub` byte-for-byte against it, and the strict parser rejects
   trailing slashes, queries, fragments and handle authorities.
2. Resolve the actor from cookie (web) or bearer (extension). The acting DID
   comes only from the session.
3. Check `spaceGrantLevel(row.granted_scope) === 'read'` **server-side**.
4. Enforce consent (below).
5. `oauthSession.fetchHandler('/xrpc/com.atproto.space.getDelegationToken?space=' + encodeURIComponent(ref))`.
6. **Mirror the upstream status and JSON body verbatim**, `Cache-Control: no-store`,
   never log the token. Mirroring is what keeps `readSpaceXrpcError` and
   `classifySpaceError` working unmodified.
7. Rate-limit mints per session and per distinct authority per hour.

The ~60s single-use budget survives the extra hop comfortably — the clock starts
at PDS issuance and `acquireSpaceCredential` (`spaceCredential.ts:282-291`) spends
the token one statement after awaiting it. The real hazards are retry and
caching, not expiry: **never retry the exchange with an already-spent token** (it
returns `InvalidDelegationToken`, which `classifySpaceError` maps to
`invalid-credential`).

### The consent gate must be enforced server-side, from server state

`spaceCredential.ts:323-342` documents what the browser-side `unlockedAuthorities`
Set bounds: a `read` grant is `authority=*`, so the PDS mints a token for *any*
space ref asked of it, and an `/explore/{attacker-did}/space/…` link **opened and
nothing more** would tell an attacker's server who the visitor is, where their
PDS is, and that they hold whole-space access.

**A `consent: true` field in the request body enforces nothing** — the caller
supplies it, so any caller can set it. The gate must be:

- A prior row in `aturi.space_consents` for `(session_sha256, authority_did)`; or
- an **auto-consent** the server derives itself: port
  `holdsRepoUnderAuthority` (`useSpaceAccess.ts:224-237`) server-side — it is a
  `listSpaces` call against the visitor's own PDS with a `did` filter and
  `limit: 1`, so it discloses nothing to the authority and legitimately skips the
  prompt for existing members.

Consent rows are written by a **separate, explicit** `POST /api/oauth/space/consent`
that the UI calls only after the user actually clicks through the unlock prompt —
never as a field on the mint request. `unlockedAuthorities` and
`subscribeSpaceAuthorityUnlocks` stay in the browser; they still drive the UI.

Same-origin genuinely helps here: with an `HttpOnly; SameSite=Lax` cookie plus
the `Sec-Fetch-Site`/`Origin` checks, a cross-site attacker cannot reach the
endpoint through the cookie at all. But the **extension holds a real bearer token
in extension storage**, so the server-side record is required for that surface
and is defence-in-depth for the web one.

### The other space methods need nothing

`listSpaces`, `simplespace.listMembers`, `space.getRecord/listRecords/putRecord/
createRecord/deleteRecord` flow through the generic `/api/oauth/xrpc/[nsid]`
route because it is path-passthrough. That is the concrete payoff of the proxy
design; a method-name proxy would need a hand-written case each and would still
fail on the response envelope.

### Untouched, and verified so

`exchangeSpaceCredential` (`spaceCredential.ts:202-234`) and `spaceFetch`
(`:380-392`) are plain browser fetch to third-party hosts with `redirect: 'error'`
and never `credentials: 'include'`. Nothing about this migration reaches them.

---

## 8. Extension sign-in

**Ships in its own phase and its own release.** The code is ~150 lines with
**zero new extension dependencies** — `@types/chrome` is already in
devDependencies and the codebase's atproto layer is already raw fetch by design.
The cost is entirely store process.

### Flow

1. Extension generates a random 32-byte `verifier`; computes
   `challenge = base64url(SHA-256(verifier))`.
2. `browser.identity.launchWebAuthFlow({ url: '<origin>/api/oauth/login?handle=…&scopes=…&client=extension&challenge=…&return=' + encodeURIComponent(browser.identity.getRedirectURL()), interactive: true })`.
3. Read `#code=` from the returned URL.
4. `POST /api/oauth/exchange` with `{ code, verifier }` → token.
5. Store the token.

The atproto authorization server never learns the extension exists. Only
`/api/oauth/callback` is a registered `redirect_uri`; the extension return target
is an app-level allowlist entry.

### Why the verifier is load-bearing

Redirect URLs cannot authenticate the extension:

- Chrome: `https://<extension-id>.chromiumapp.org/`. Stable only after store
  publication — WXT sets no `key`, so every developer's unpacked build has a
  different id.
- Firefox: `https://<host>.extensions.allizom.org/`, where the host derives from
  the extension's **internal UUID, which is randomised per install**. Not
  allowlistable at all. (Firefox 86+ also permits
  `http://127.0.0.1/mozoauth2/<subdomain>`.)

So `ATURI_EXTENSION_RETURN_ORIGINS` can be exact-match for Chrome but must be
pattern-matched for Firefox, and a pattern hands any Firefox extension a valid
redirect target. The PKCE-style verifier is what makes that safe: the code is
worthless without the secret the legitimate extension holds.

### Non-negotiables

- **Run the flow from the options page, never the popup.** `launchWebAuthFlow`
  opens a separate window; the popup loses focus, is destroyed, and the pending
  promise is collected with it. This is the single most common "works in dev,
  hangs in production" failure. Add an `account` tab to the existing `TABS` in
  `entrypoints/options/App.tsx` (it already deep-links by hash); the popup's
  Sign in affordance calls `browser.tabs.create({ url: browser.runtime.getURL('/options.html#account') })`.
- **`getToken()` reads storage on every call.** Never a module-level `let` —
  `entrypoints/background.ts` already demonstrates the MV3 suspension reset
  pattern (`nextBypassId:151`), and cached module state produces intermittent
  unreproducible 401s.
- **Storage key `aturi.session.v1` in `chrome.storage.local`, deliberately
  separate from `aturi.prefs.v1`.** `extension/lib/prefs.ts:334` defines
  `STORAGE_KEY = 'aturi.prefs.v1'` and `:339` serialises the whole `Prefs` object
  to `browser.storage.sync` — so a `session` field added to the `Prefs` type
  would upload the bearer token to Google's and Mozilla's sync servers. Add a
  comment block on the `Prefs` type saying credentials never go in it.
  `onPrefsChanged` (`prefs.ts:579`) filters on `STORAGE_KEY` and will not see the
  new key, so it needs its own `storage.onChanged` listener.
- **Pin the Chrome `key`** from the Chrome Web Store item's public key so dev and
  store extension ids match.
- **`identity` is the only new permission.** `host_permissions: ['<all_urls>']`
  already covers aturi.to.

### Ship v1 read-only

Request only `atproto` plus the appview `rpc:` token. Per-client grants (§3) make
the narrower scope expressible without affecting the web session, and read-only
makes both store reviews materially easier.

**Lead with preferences sync.** `src/utils/preferences.ts:60` already states the
web `WaypointGroup` type "Mirrors the extension's WaypointGroup 1:1 so PDS records
round-trip between the two surfaces", and the web app already round-trips
`to.aturi.actor.preferences/self` via `preferencesPds.ts`. The extension is the
only surface that cannot read that record. Two proxied calls — `getRecord` and
`putRecord` — join it to the loop, and retire the `storage.sync` 100KB
quota-fallback dance at `prefs.ts:337-348`.

**One correctness trap on that path:** `com.atproto.repo.putRecord` **replaces the
whole record**. `writePreferencesToPds` writes ~25 web-owned fields; an extension
that writes back only the fields it knows about silently deletes the rest. Either
the extension does read-modify-write over the full record, or preference writes
stay web-only in v1 and the extension is read-only for real. Prefer the latter
for v1 — it matches the read-only framing and removes the trap entirely.

### Store paperwork — the real cost

- `extension/wxt.config.ts:51`: `data_collection_permissions.required` changes
  from `['none']` to `['authenticationInfo']`, plus `personallyIdentifyingInfo`
  if handle/avatar surface in the popup. **Do not declare `websiteContent`** —
  page scanning still never leaves the device and that distinction is worth
  preserving.
- Rewrite the false claims, in the same PR as the manifest change:
  `extension/PRIVACY.txt` summary (`:9`), `:141` ("The extension never contacts
  aturi.to or any other Aturi-operated server during normal use"), `:168`, `:196`,
  plus an `identity` entry in §4; and the duplicated copy in
  `src/app/extension/privacy/page.tsx`. The two documents are already out of sync
  on their Last-updated stamps (July 17 2026 vs May 26 2026) — fix that here.
  Both need a section on what the BFF stores server-side, for how long, and how
  to delete it, **scoped so "signing in is optional; if you never sign in,
  nothing below applies" stays true and is stated.**
- Chrome Web Store: `identity` adds no new install-time warning string (unlike
  `identity.email`), but the Privacy practices tab must tick "Authentication
  information". Budget review latency, not rework — the risk is shipping a
  manifest change without the matching dashboard disclosure, which CWS
  cross-references.
- Add "Sign out this device" / "Sign out everywhere" to
  `src/components/account/tabs/AccountTab.tsx`.

### Safari / Firefox-for-Android contingency

Safari Web Extensions do not implement `browser.identity`, and
`launchWebAuthFlow` on Firefox for Android is unconfirmed while the manifest
targets `gecko_android` 142+. If either is a shipping target, build the
**portable nonce-and-claim flow** instead: the extension generates a verifier,
opens `https://aturi.to/extension/connect#c=<challenge>` in a normal tab, the page
runs the ordinary web sign-in, the BFF mints an extension-scoped token keyed by
that challenge, and the extension polls
`GET /api/oauth/extension/claim?c=…&v=…` (short TTL, single use, delete-on-read).

**Explicitly reject the postMessage-from-a-tab variant**: `externally_connectable`
for web pages is Chromium-only, and the Firefox workaround requires a third
content script on `<all_urls>` that reads a long-lived token out of page
JavaScript.

---

## 9. Environment matrix

| Environment | Origin | client_id | redirect_uri | Session presentation |
| --- | --- | --- | --- | --- |
| Production | `https://aturi.to` (+ `www.aturi.to`, `aturi.app`, `www.aturi.app`, `altsky.app` — the last already 301s in `vercel.json`) | `https://aturi.to/oauth/client-metadata.json` | `https://aturi.to/api/oauth/callback` | `__Host-` cookie, same-origin |
| Staging | `https://testing.aturi.to` | `https://testing.aturi.to/oauth/client-metadata.json` — host-keyed, so staging stays a separate OAuth client with separate consent records | same shape on that host | cookie |
| Vercel previews | per-deploy `*.vercel.app` | **none** — signed out, **and no BFF secrets present** | — | — |
| localhost | `http://localhost:3000` | none of its own | — | bearer against staging, or legacy browser client |
| Extension | `chrome-extension://…` / `moz-extension://…` | reuses the web client_id | web `/api/oauth/callback` → app-level hand-off | bearer in `Authorization` |
| Fork, unconfigured | any | legacy public client | `/oauth/callback` | IndexedDB, as today |

**Previews stay signed out.** Do not "fix" this by allowlisting a `*.vercel.app`
return-origin pattern — that hands a live session token to any preview deploy,
including a fork's PR preview. A branch that needs sign-in gets a stable alias
domain.

### `.env.example` additions

Lead with the disclaimer: *"Leave all of these unset and the app uses the public
browser OAuth client, exactly as it always has. A fork does not need a database."*

```
# ATURI_OAUTH_JWK_ACTIVE=          # ES256 P-256 JWK, explicit kid, signs + published
# ATURI_OAUTH_JWK_RETIRED=         # published only, during rotation
# ATURI_DB_DRIVER=postgrest        # postgrest | pg
# ATURI_DB_URL=
# ATURI_DB_SERVICE_KEY=
# ATURI_DB_SCHEMA=aturi
# ATURI_SESSION_ENC_KEY=           # 32 bytes hex or base64 — AES-256-GCM at rest
# ATURI_EXTENSION_RETURN_ORIGINS=  # exact-match list (Chrome); pattern only for Firefox
# ATURI_APP_SESSION_TTL_DAYS=30
# NEXT_PUBLIC_AUTH_MODE=auto       # auto | bff | browser
```

### `vercel.json`

Currently only a redirect block. Add:

```json
"regions": ["iad1"],
"functions": { "src/app/api/oauth/**/route.ts": { "maxDuration": 30 } }
```

Note the glob must match an actual route file — `src/app/api/oauth/**` with no
filename matches nothing and is silently ignored, leaving the routes on the
default duration. Supabase is us-east-1; a cross-region default adds ~70ms per
DB round trip.

### Localhost dev

The loopback shortcut in `src/lib/oauth/client.ts:44-51` **cannot be made
confidential**: `@atproto/oauth-types`' loopback metadata hard-codes
`token_endpoint_auth_method: 'none'` and `application_type: 'native'`. There is no
confidential equivalent.

Three options, documented in `CONTRIBUTING.md`, in preference order:

1. **Default local dev runs the browser client** — which is also the fork
   fallback, so it is exercised code rather than dead code. Zero setup.
2. **`NEXT_PUBLIC_AUTH_MODE=bff` + `ATURI_BFF_ORIGIN=https://testing.aturi.to`.**
   Cookies cannot cross localhost ↔ testing.aturi.to, so dev necessarily uses the
   **bearer** path — which is the extension's path, so it gets daily exercise
   instead of only being tested at release.
3. **A tunnel** (`cloudflared`/`ngrok`), needed by anyone working *on* the BFF.
   Each new tunnel URL is a new `client_id`, so consent repeats.

---

## 10. Phased rollout

### Phase 0 — Sign-off and decision lock · **S / 1 day (mostly waiting)**

Four things cannot be reversed once code exists.

- **Maintainer sign-off on dependencies**, per AGENTS.md "No new dependencies. If
  a dependency looks necessary, stop and say so." The ask, with measured facts:
  - `@atproto/oauth-client-node` — ESM-only, `engines: node >=22` (satisfied:
    `.nvmrc` pins 22.22.0), imports `node:crypto`, ~33 transitive packages / ~36 MB
    installed, dominated by `core-js` (16 MB, imported exactly once), `zod` and
    `undici`. Far inside Vercel's 250 MB per-function limit; server-only, so
    nothing reaches the client bundle; `extension/` and `packages/` have separate
    lockfiles and are untouched.
  - `server-only@0.0.1` — zero deps, 611 bytes. Optional; substitutable by an
    ESLint rule.
  - **Explicitly not taking `@supabase/supabase-js`** — the store is PostgREST
    over `fetch`.
- **Lock the grant model:** `(sub, client)` where `client ∈ {'web','extension'}`.
  This is the primary key.
- **Lock the client_id path:** `https://aturi.to/oauth/client-metadata.json`,
  redirect at `/api/oauth/callback`. The existing
  `https://aturi.to/oauth-client-metadata.json` is not touched in this or any
  later phase.
- **Sign-off on the spaces split** (AGENTS.md security-sensitive list): DPoP key
  and credential stay in the browser; only `getDelegationToken` is proxied,
  behind a server-side consent record.
- Add `*.jwk`, `*.jwk.json`, `oauth-key*.json` to `.gitignore`.
- Confirm whether `testing.aturi.to` is an alias on
  `prj_qSXta9t84ecBnmX31v7iOkozD0o9` or a separate project.

**Exit:** written sign-off on the dependencies, the grant model, the client_id
path, and the spaces split. `.gitignore` updated.

### Phase 1 — Confidential client identity · **S / 1–2 days**

Publish a second OAuth client an authorization server can fetch and validate. No
behaviour change; nothing consumes it.

- `scripts/generate-oauth-key.mjs` (ES256, explicit `kid`, stdout only, no `use`).
- `src/lib/oauth/server/env.ts` — lazy `isBffConfigured()`; **validate inside
  handlers, never at module scope**.
- `src/lib/oauth/server/keyset.ts` — fail closed on malformed JWK, missing `kid`,
  and no key at all (never downgrade to `'none'`).
- `src/app/oauth/client-metadata.json/route.ts` (edge) and
  `src/app/oauth/jwks.json/route.ts` (nodejs).
- `src/lib/oauth/__tests__/scopes.metadata.test.ts` — `node:test`.
- Set `ATURI_OAUTH_JWK_ACTIVE` on **staging only**, scoped to that environment.

**Exit:** both URLs resolve on testing.aturi.to and pass
`validateClientMetadata(metadata, keyset)` in a scratch script without throwing.
`npm run build` still green in CI with zero secrets. Production byte-identical.

### Phase 2 — Storage, locking, session endpoints · **L / 5–7 days**

- Apply `sql/001_oauth_bff.sql`; add `aturi` to the Data API's exposed schemas.
- `src/lib/oauth/server/store/{driver,postgrest,pg}.ts`; `crypto.ts` (AES-GCM
  envelope + `sha256Hex`); `lock.ts`; `cache.ts`; `client.ts`
  (`getOAuthClient(client)` — two `NodeOAuthClient` instances sharing one keyset,
  one client_id, one redirect_uri and one state store, differing only in
  `sessionStore: sessionStoreFor(client)`); `session.ts` (`mintAppSession`,
  `resolveActor`); `retriable.ts`; `rateLimit.ts`.
- Routes: `login`, `callback`, `session`, `logout`, `exchange`, `sessions`.
- The flow-binding cookie and the PKCE-style exchange verifier.
- `cors.ts` on `/api/oauth/*` only.
- `import 'server-only'` on every server module; `check-env-names.mjs` in lint.
- `export const dynamic = 'force-dynamic'` on every route.
- Pin `regions` and `maxDuration` in `vercel.json`.
- **Measure and record** the traced function bundle size and cold-start latency
  for `/api/oauth/session`.

**Exit:** on testing.aturi.to, a full login round trip lands with a
`__Host-aturi_sid` cookie; `/api/oauth/session` returns the right did/scope/pds;
`?scope=client` logout deletes one row and `?scope=all` revokes at the PDS; a
malformed scope id returns 400; **a replayed `code`+`state` from a different
browser is rejected**; **an exchange without the verifier is rejected**; the
sweep has run once. No UI reaches any of it.

### Phase 3 — Proxy and shim · **M / 4–6 days**

- `src/app/api/oauth/xrpc/[nsid]/route.ts` with all the mechanics in §2.
- `src/lib/oauth/bffSession.ts` (~90 lines) including the `getDelegationToken`
  special case.
- `src/lib/oauth/authMode.ts`.
- The existing-file edits, plus the sign-in-entry-point audit.
- `src/lib/oauth/__tests__/loginScope.test.ts`.
- Fixture tests: a 400 `{"error":"RecordNotFound"}` arrives at the client as
  status 400 with that exact body; a 429 preserves `ratelimit-reset`; an absolute
  path in the NSID segment 400s; a non-allowlisted NSID 403s; a foreign
  `atproto-proxy` value 400s.

**Exit:** on testing.aturi.to behind the flag — sign in with the picker, read and
write a record in RecordEditor, save a preference round-tripping to the PDS,
**deliberately provoke a transient 400 on the preferences path and confirm it is
not classified as `missing`**, bulk-delete into a rate limit and see the real
countdown, and confirm RelationshipStrip shows mutual-follow state (proving
`atproto-proxy` survived). `git diff --stat` on existing files shows only the
planned ones. `npm run lint && npm run typecheck && npm test && npm run build`
green; `cd extension && npm run compile && npm test` green.

### Phase 4 — Spaces · **M / 3–4 days**

- `src/app/api/oauth/space/delegation-token/route.ts` and
  `.../space/consent/route.ts` with the server-side gate and the
  `holdsRepoUnderAuthority` auto-consent.
- The `ownPdsFetch` closure change in `useSpaceAccess.ts` (and the `OwnPdsFetch`
  type widening).
- Revocation propagation: a 401 from any proxied call dispatches `'deleted'` so
  `clearSpaceCredentials()` runs.

**Exit:** signed in with the space scopes ticked — SpaceExplorer,
SpaceRecordExplorer and SpaceListExplorer all render; a space write succeeds; the
authority-unlock prompt still appears for an unknown authority **and is enforced
by the server** (verified by calling the mint endpoint directly without a consent
row and being refused). **Zero diff in `spaceCredential.ts`, `spaceDpop.ts`,
`spaceClient.ts`.**

### Phase 5 — Rollout, docs, legal · **M / 3–5 days**

- Ramp: testing.aturi.to → maintainer accounts → 10% → all new sign-ins.
  Rollback is `NEXT_PUBLIC_AUTH_MODE=browser`.
- Dismissible, non-blocking upgrade prompt in `AccountTab.tsx`. The honest copy is
  the real reason: *"Longer sessions — your sign-in stops expiring every two
  weeks."*
- `/account` session list backed by `/api/oauth/sessions`, with per-row revoke and
  a separate explicit "Sign out everywhere (revokes app access at your PDS)".
- `.env.example` block; `/fork` "Optional: long-lived sign-in" section pointing at
  `sql/001_oauth_bff.sql` and the key generator, stating plainly that skipping it
  costs nothing but session length, and noting the Supabase free-tier 7-day pause
  (which is why `pg.ts` exists).
- `CONTRIBUTING.md` dev story (§9).
- **`src/app/terms/page.tsx`** — four claims become false and are easy to miss in
  a 1,154-line page: `:276-278` "do not maintain a centralized user account
  database" (`app_sessions(user_did, …)` is exactly that), `:294-299` "never
  transmitted to Aturi", `:814-820` "Aturi acts as a public OAuth client", and §6
  Sub-processors at `:940` (no database provider listed — add Supabase by name
  with region and contents). Extend §7 Data retention at `:997` with the new
  classes: `oauth_state` 10 min, `app_sessions` 30 d sliding, `oauth_sessions`
  until logout or sweep, sweep cadence 15 minutes. **Scope every new claim with
  "if you never sign in through the backend, none of this applies"** — which stays
  true because of the fallback.
- Basic observability: structured logs on the four failure classes
  (`SESSION_INVALID`, `SESSION_TRANSIENT`, `OAUTH_SESSION_MISSING`, lock
  fail-open), so the ramp gate ("zero unexpected sign-outs") is measurable rather
  than anecdotal.
- Runbooks: key rotation, and incident response for a suspected key or DB-key leak.

**Exit:** 100% of new sign-ins use the BFF; zero support reports of an unexpected
sign-out; a clean clone with an empty `.env.local` builds and signs in via the
browser client; terms, `.env.example` and `/fork` are accurate and reviewed.

### Phase 6 — Extension · **L / 5–8 days + store review latency**

Everything in §8.

**Exit:** signed-in extension on Chrome and Firefox reads
`to.aturi.actor.preferences/self`; a waypoint group created on aturi.to appears in
the extension; signing out in the extension leaves the web session intact;
`/account` lists and revokes the extension session independently;
`cd extension && npm run compile && npm test` green; both store listings'
disclosures match the shipped manifest.

### Phase 7 — Follow-ups, explicitly out of the migration diff

- **Delete the `SCOPE_SETTLE_MS` machinery** (`useSpaceAccess.ts:75,128-139,162-176`)
  — ~30 lines and two state machines that exist because `getTokenInfo` reports
  null both in-flight and on failure. Under the BFF, `grantedScope` arrives
  synchronously with the session bootstrap. Its own reviewed commit, after the
  cutover is stable.
- **`clientAttestation` for `#allowList` spaces.** `spaceCredential.ts:197-199`
  records that attestation "is never sent: aturi.to is a public OAuth client with
  no published JWKS… A space whose appAccess is #allowList is therefore
  permanently out of reach." A confidential client publishes a JWKS by definition.
  Blocked on confirming the wire format against a real space-host implementation.
- **Server-rendered session state.** With an HttpOnly cookie, Server Components
  can read auth at request time and kill the signed-in/signed-out flash. Genuine
  win, but it touches many components — AGENTS.md's "change what was asked and
  nothing else" applies.
- Slower sweep of `aturi.oauth_sessions` untouched for >90 days — those hold live
  refresh tokens for accounts that stopped using the app.
- **Align the Node version.** The Vercel project reports `nodeVersion` 24.x while
  `.nvmrc` pins 22.22.0 and CI uses `node-version-file: .nvmrc`.
- Multi-account, if wanted. `app_sessions` already supports it structurally.

---

## 11. Risks

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| 1 | **Login CSRF / session fixation.** Moving the OAuth state store from the victim's IndexedDB to shared Postgres deletes the per-browser binding that is today's CSRF defence. A crafted top-level GET to the callback plants the *attacker's* DID in the victim's browser, silently, with every subsequent write landing in the attacker's repo. | **Critical** | Flow-binding cookie (`__Host-aturi_flow`) set at `/api/oauth/login`, `sha256` stored on the state row, required and cleared at callback. Plus `Sec-Fetch-Site`/`Origin` checks — but note the `Origin` check alone fails open on exactly the navigation the attack uses. |
| 2 | **Unvalidated path in the XRPC proxy is blind SSRF plus exfiltration of a live DPoP-bound access token.** `oauth-session.js:64` does `new URL(pathname, tokenSet.aud)`, and `new URL(absolute, base)` returns the absolute URL. | **Critical** | NSID arrives only as our own `[nsid]` segment (single, not catch-all); upstream path rebuilt server-side; shape regex plus a ban on `__proto__`/`constructor`/`prototype`; a literal allowlist on top. Never accept a host, `X-PDS-URL`, or absolute URL on any OAuth route. Flag the file under AGENTS.md's security-sensitive list. |
| 3 | **`atproto-proxy` is a caller-controlled *value*, not just a header name.** It names a DID the user's own PDS resolves and forwards to, carrying a user-identifying service-auth token. | **Critical** | Allowlist the legitimate values, or require `did:web:` plus a known-host regex plus a known service fragment. Forwarding the header by name only is not enough. |
| 4 | **The extension exchange has no proof of possession.** `/api/oauth/exchange` is `ACAO: *` and unauthenticated; a bare `{code}` is redeemable by whoever observes the redirect — and Firefox's redirect host cannot be allowlisted. | **Critical** | PKCE-style `challenge`/`verifier` bound to the exchange row, compared in constant time. |
| 5 | **A confidential client loses the AS's forced consent screen.** With `login_hint` matching an active device session and the scopes already accumulated, authorization completes with no UI. | **Critical** | Closed 7-value `ScopeId` enum, never a scope string; unknown ids are a 400. **Always** pass `prompt: 'consent'` in v1. Forward an explicit allowlist of params to `authorize()` — never spread the query. |
| 6 | **The consent gate enforces nothing if its input comes from the caller.** A `consent: true` body field is set by whoever calls the endpoint. | **Critical** | Consent lives in `aturi.space_consents`, written only by a separate explicit endpoint after a real user click, or derived server-side via `holdsRepoUnderAuthority`. |
| 7 | **BFF secrets present in every preview deployment.** Vercel env vars default to Production + Preview + Development. | **Critical** | Scope every BFF secret to Production (and staging's to staging) explicitly. Audit after setting. |
| 8 | **Copying the reference session store verbatim logs users out at scale.** The library deletes stored tokens on any transient refresh failure. | High | `del()` is an intentional no-op that only logs; `forceDelete` from one place; **but** delete on a definitive revocation signal so dead grants do not cost three restores each. |
| 9 | **Streaming the request body silently disables token refresh on writes.** Presents as intermittent "could not save" on exactly the operations that matter most. | High | `await request.arrayBuffer()` before `fetchHandler`, capped at **4 MB** (Vercel rejects >4.5 MB at the edge before the handler runs) with a clean 413. Buffer the response too and rebuild headers from an allowlist, because undici keeps `content-encoding` while decoding the body. |
| 10 | **A naive network retry double-writes** — a retried `createRecord` or `setVote` duplicates a record the PDS already accepted. | High | Connection-establishment-only allowlist. Deliberately exclude `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, `ECONNRESET`, `UND_ERR_SOCKET`. |
| 11 | **A module-scope env throw turns the whole CI pipeline and every preview build red.** CI runs `npm run build` annotated "no secrets are required", and the obvious port of cocoon's config singleton calls `requireEnv` at import. | High | Validate inside handlers only; `isBffConfigured()`; 503 when unconfigured; `dynamic = 'force-dynamic'`. This discipline is what makes the fork fallback work too. |
| 12 | **A re-wrapping proxy silently breaks three call sites that parse structure off thrown errors** — and the preferences one is a data-loss path. | High | Path-passthrough with verbatim upstream status, body bytes, and an allowlisted header set. No envelope anywhere. Fixture tests in CI. |
| 13 | **Concurrent refresh of a rotating refresh token.** Symptom reads as random logouts at launch. | High | `(sub, client)` grants remove the cross-client half. Then: the full two-tier lock (fail-open on every path), both 60s caches from day one, the `del()` no-op, the single `Invalid token` retry with `{fresh:true}`, and an **atomic** lock RPC (CTE + `RETURNING`) rather than cocoon's upsert-then-`SELECT holder`, which under READ COMMITTED can report success to two holders. |
| 14 | **Revocation stops propagating.** Today `'deleted'` clears in-memory space credentials that read other members' private records. | High | A 401 `SESSION_INVALID` from any proxied call dispatches the same event. Verify explicitly in Phase 4. |
| 15 | **Secrets leak from the public app's deployment** — a `NEXT_PUBLIC_` typo, a client component importing a server module, a value in an RSC payload, or a JWK force-pushed to tangled.org. | High | Five layers in §6. **This is the honest cost of the in-app choice**; it is contained by mechanism, not by relocation. |
| 16 | **Mutating the existing client_id, or an over-permissive return-origin allowlist.** | High | Never touch the existing document. New path, both live in parallel behind `NEXT_PUBLIC_AUTH_MODE`. Return targets are root-relative paths for the web plus an exact-match list for Chrome; Firefox's unavoidable pattern is made safe by the verifier (Risk 4), not by the pattern. Previews stay signed out. |
| 17 | **No rate limiting anywhere.** `/api/oauth/login` is unauthenticated and does identity resolution, an AS metadata fetch, PAR, and a row write per call. | Medium | `aturi.rate_limits` fixed-window counters, atomic via `ON CONFLICT`. Per-IP on login, per-session on xrpc and delegation-token. |
| 18 | **Coupling OAuth availability to the frontend's deploy cadence.** A bad app deploy now also breaks sign-in. | Medium | All OAuth state lives in Postgres, so a deploy mid-flow loses nothing — only caches go cold. Vercel instant rollback; the legacy public client is a live fallback. **A real cost of the in-app choice, accepted knowingly.** |
| 19 | **Store declarations become false the moment a token leaves the device.** | Medium | Its own phase and release. `['authenticationInfo']`, rewrite both privacy documents together, scope every claim so no-data statements stay true for users who never sign in. Ship read-only in v1. |
| 20 | **Sharing the `atpota.to` Supabase project** means one service-role key reads anisota, cred-blue, trackerapp, typesapp and aturi alike. | Medium | AES-256-GCM on `session_data` under a key that lives only in the aturi Vercel project. Store only `sha256(token)`. RLS `ENABLE` + `FORCE` plus explicit `REVOKE`s — noting `service_role` carries `BYPASSRLS`, so the REVOKEs, not RLS, are what protect against the anon key once the schema is exposed. |
| 21 | **Bundle and cold-start regression** from a ~36 MB dependency tree. | Medium | Measured, not assumed: core-js imported exactly once, Next traces per route so page routes are unaffected, `regions: ["iad1"]` co-locates with the database, and the two caches take a warm instance to zero DB round trips. Phase 2 records actual numbers. |
| 22 | **Forks face a harder setup, or a fork's sign-in goes offline when its free-tier Supabase project pauses after ~7 days.** | Medium | The public browser client remains the default when unconfigured. Tier 2 ships the migration, a key generator, and the `pg.ts` driver so a fork can use Neon or plain Postgres and never meet the pause. |

---

## 12. Open decisions

Each has a recommendation, but each is genuinely the maintainer's.

1. **Do we take the dependencies?** `@atproto/oauth-client-node`, plus optionally
   `server-only`. **Recommendation: yes to the first**; either take the second or
   accept the ESLint substitute. There is no version of a confidential client
   that stays inside the existing dep set, and hand-rolling DPoP +
   `private_key_jwt` + rotating-refresh handling is the highest-risk code in the
   system. *Blocker: nothing else can start.*

2. **Grant model — `(sub, client)` or `sub` alone?** **Recommendation:
   `(sub, client)`.** It is the primary key, so it must be settled before Phase 2
   writes DDL. Per-client grants eliminate the cross-client rotating-refresh
   race, make "sign out the extension" a local delete, and let the extension
   request strictly narrower scopes. Cost: the user authorizes once more the
   first time they sign in on the extension, under the same client name.

3. **Shared Supabase project or a dedicated one?** **Recommendation: shared,
   schema `aturi`, with `session_data` encrypted at rest.** The schema already
   exists, `pg_cron` is already installed, and the schema-per-app pattern is
   established (`trackerapp`, `credblue`, `typesapp` all live alongside `public`).
   The blast-radius objection is real and is mitigated directly rather than
   architecturally.

4. **Does the extension ship in the same wave as the web BFF, or later?**
   **Recommendation: later (Phase 6).** The code is small; the cost is entirely
   store process. Sequencing it after the web BFF is proven also means the bearer
   path has been exercised daily by localhost dev before an extension depends on it.

5. **Is the legacy public browser client removed after cutover, or kept
   permanently?** **Recommendation: kept permanently.** Forkability requires it
   (`git clone && vercel` must still sign in, or `/fork` and `.env.example` become
   false and CI's secret-free build has nothing to build), and it independently
   solves localhost dev. It is not two auth paths for their own sake; it is one
   path already required for two independent reasons. Honest cost:
   `src/lib/oauth/client.ts` and `@atproto/oauth-client-browser` stay forever.

6. **Does staging share production's signing key?** Depends on whether
   `testing.aturi.to` is an alias on the same Vercel project. If it is, they share
   the env var and a staging compromise is a production key compromise. **Needs a
   fact check.**

7. **`prompt: 'consent'` always, or only on widening?** **Recommendation: always
   in v1**, revisit in Phase 7.

8. **Does space-credential minting stay in the browser?** **Recommendation: yes**
   — only `getDelegationToken` is proxied. Moving it server-side forces the DPoP
   key to be extractable and puts credentials that read other members' private
   records into a database at rest. AGENTS.md lists anything touching
   OAuth/DPoP/token storage as needing maintainer sign-off, so **confirm this
   explicitly rather than assuming it**.

9. **Is Safari a shipping target for the extension, and does Firefox for Android
   support `launchWebAuthFlow`?** If either is yes, build the nonce-and-claim flow
   first and treat `launchWebAuthFlow` as the Chrome/Firefox fast path.

10. **Is multi-account in scope?** **Not recommended for v1** — it is scope creep
    on an auth swap — but the schema should not preclude it, and it does not.

---

## Appendix — what not to copy from anisota-cocoon

Ported near-verbatim (with MIT attribution): `lib/retriable-errors.js`,
`lib/session-crypto.js` (minus its plaintext fallback), `lib/ttl-cache.js`, the
lock concept, and the three status codes the frontend branches on
(`FRONTEND_SESSION_INVALID`, `OAUTH_SESSION_MISSING`,
`VALIDATION_TRANSIENT_ERROR`).

Not copied, each for a stated reason:

| Thing | Why not |
| --- | --- |
| Session token in the query string (`lib/callback-redirect.js:16-17`) | A deliberate regression after a July 2026 sign-in-loop incident. Same-origin cookies retire it entirely. |
| Raw session token as the `frontend_sessions` primary key | Unhashed 30-day bearers sitting one table over from AES-GCM-encrypted OAuth tokens. Store `sha256` only. |
| `Access-Control-Allow-Origin: *` on every OAuth route | Scope it to `/api/oauth/*`; the cookie path is same-origin and needs no CORS at all. |
| Account-wide logout | Kills every device. Split `?scope=client` from `?scope=all`. |
| No expiry sweeper | cocoon's `oauth_state` is 100% expired rows; `frontend_sessions` is 91% expired. |
| One grant keyed by DID alone | Multiplies the rotating-refresh race with every client, and has nowhere to record which client a session belongs to. |
| Method-name RPC proxy (`X-XRPC-Method`) | Cannot serve `com.atproto.space.*` at all, and forces a 2,175-line hand-written agent shim on the client. |
| `...otherOptions` spread into `authorize()` (`api/oauth/login.js:61`) | Forwards caller-controlled `prompt`/`max_age` — a silent-authorization path on a confidential client. |
| `JSON.parse` of the wire `state` (`api/oauth/callback.js:48-58`) | It is the library's opaque key and always throws, silently sending staging users to production. |
| Module-scope config singleton with `requireEnv` | Turns CI and every preview build red in a Next.js route module. |
| `MemoryLock`'s unbounded busy-wait | `while (locks.has(key)) await sleep(10)` over an uncapped Map. |
| Upsert-then-`SELECT holder` lock RPC (`006_oauth_locks.sql:41-50`) | Under READ COMMITTED it can report success to two holders. |
| RS256 key documentation (`env.example:160`, `BACKEND_OAUTH_SETUP.md`) | Stale. The library requires ES256; following those docs generates an unusable key. |
| `token_endpoint_auth_method` falling back to `'none'` | Silently republishes the same `client_id` as a *public* client when the key env var goes missing. |
| vitest test setup | aturi's `npm test` is `node --test`. |
