# Plan: an MCP server for the Atmosphere

Status: decided and built. The read-only server (M0 + M1 scope) lives on this
branch; the sections below are the original proposal, kept as the design
record. Decisions taken 2026-08-23:

- **D1 (endpoint):** the protocol endpoint is `/api/mcp`; `/mcp` is the
  human landing page, with a Markdown twin at `/mcp.md` behind the same
  Accept negotiation as `/about` and `/docs`.
- **D2 (dependencies):** approved. `mcp-handler` 2.x (Apache-2.0, not MIT as
  first written below), `@modelcontextprotocol/server` 2.x (MIT), `zod` 4
  (MIT), web app only.
- **D3/D4 (catalog):** nothing trimmed; all groups shipped including the
  `get_lexicon_schema` stretch, which makes the real count **eighteen**
  tools, not the sixteen the proposal text says. `search_posts` shipped;
  in testing its upstream (Bluesky search) answers 403 to data-center IPs,
  so the tool reports an honest `upstream_error` where that applies — watch
  whether Vercel egress is affected in production.
- **D5 (writes):** hosted stays read-only; write tools go to a future local
  companion package (Option A). Option B is parked.
- **D6 (firehose):** deferred, as proposed; `sample_recent_records` covers
  the need over UFOs.
- **D7 (rate limits):** still open — a Vercel WAF rule on `/api/mcp` is a
  dashboard step at deploy time; in-code fan-out caps shipped.
- **D8 (naming):** serverInfo name `aturi`, flat unprefixed tool names.
  Registry namespace (`to.aturi/mcp`) still to be claimed at M2.

The pitch in one line: `https://aturi.to/mcp`, a hosted Model Context Protocol
server that any AI agent can add by URL, with no key and no account, exposing
the Atmosphere Explorer as tools. A person asks their agent "who links to this
post?", "what lexicons are trending?", "show me this account's repo", and the
agent answers from live network data, handing back `at://` URIs and aturi.to
universal links a human can click.

This would be the fifth surface in the repo, next to the web app, the
extension, and the two packages, running on the same shared protocol layer in
`src/utils/atproto/`.

## Why this is nearly built already

The hard part of an atproto MCP server is not MCP, it is the protocol layer:
identity resolution, PDS discovery, record fetching, backlink queries, lexicon
stats, SSRF protection, timeouts, retries. All of that exists in this repo and
is in production behind the explorer and the public API:

| MCP tool needs | Already in the repo |
| --- | --- |
| handle/DID resolution, PDS discovery | `src/utils/atproto/identity.ts` (DoH + `.well-known`, PLC fallback) |
| DID document, identity history | `src/utils/atproto/plc.ts` (`getPlcDocument`, `getPlcAuditLog`, `diffOps`) |
| fetch any record by `at://` URI | `src/utils/atproto/slingshot.ts` (edge cache) + `pdsClient.ts` fallback |
| browse any repo: collections, records, pagination | `src/utils/atproto/pdsClient.ts` (`describeRepo`, `listRecordsPage`, `getRecord`) |
| PDS metadata and health | `src/utils/atproto/pdsServer.ts` |
| who-links-here across the whole network | `src/utils/atproto/constellation.ts` (counts, pages, many-to-many) |
| Bluesky layer: profiles, threads, actor search | `src/utils/atproto/appview.ts` (keyless `public.api.bsky.app`) |
| lexicon activity, trends, recent records network-wide | `src/utils/ufos/client.ts` (UFOs API) |
| NSID → authority DID resolution (`_lexicon` TXT) | `src/utils/atproto/spaceLexicon.ts` + `DOH_RESOLVER` |
| URL ↔ `at://` in both directions, 25+ clients | `uriParser.ts`, `reverseParsers.ts`, `waypoints.data.ts` |
| "where can a human open this?" | the waypoint catalog and link builders |
| outbound fetch discipline | `upstreamFetch.ts` (8s timeout, one retry on network failure) |
| internal-address protection for host-shaped input | `ssrfGuard.ts` |
| stable machine-readable error codes | `src/lib/apiError.ts` |
| per-instance TTL caching | `src/utils/atproto/cache.ts` |

The MCP server is a thin adapter over this table: JSON-RPC in, existing
functions in the middle, structured results out. The recent agent-legibility
work (OpenAPI 3.1, `llms.txt`, Markdown negotiation, real 404s) was the
read-the-docs half of serving agents; MCP is the call-the-tools half.

## Timing: the protocol just turned serverless-friendly

The MCP specification released 2026-07-28 removed the stateful core: no more
`initialize` handshake, no session IDs, each request self-contained. That is
exactly the shape of this app. Vercel's `mcp-handler` 2.x implements the new
revision on a plain Next.js route handler with no Redis and no session store,
and keeps a compatibility layer for 2025-era Streamable HTTP clients, which is
what most deployed agents still speak in August 2026. One route file serves
both.

Two consequences worth naming:

- Hosting cost and complexity collapse to "one more API route". No separate
  service, no WebSocket infrastructure, no state.
- The 2026 auth model (Client ID Metadata Documents replacing Dynamic Client
  Registration) is the same design atproto OAuth already uses. If we ever add
  an authenticated tier, the two systems now rhyme.

## What exists elsewhere, and the gap

| Project | Shape | Auth | Scope |
| --- | --- | --- | --- |
| `brianellin/bsky-mcp-server` (49 stars) | local Node process per user | app password in env vars | Bluesky client actions: timeline, post, like, follow |
| `atproto-mcp` (rye.dev, Aug 2025) | self-hosted, Docker/K8s | keyless public reads, OAuth writes | posts, profiles, feeds, social graph |
| various directory listings (mcpmarket etc.) | wrappers of the above pattern | app passwords | Bluesky |

Every existing option is something a user installs and runs. None of them is a
URL you paste into Claude, ChatGPT, or Cursor and start asking questions. And
all of them model *Bluesky the app*, not the network: none can answer "what
links to this Leaflet document", "which PDS is this repo on and when did it
migrate", "what is this `to.aturi.actor.preferences` record", or "which
lexicons saw the most new records today".

The gap is a hosted, keyless, whole-network explorer. That is aturi.to's
existing niche, in tool form. The waypoint catalog adds one thing nobody else
has: every answer can end with links a human can open in the client they
already use.

## Design principles

Carried over from the rest of the project:

1. **Keyless and read-only.** Same posture as `/api/resolve`: no API key, no
   account, no paid tier, be reasonable about volume. The hosted server ships
   with zero write tools (see the writes section for what comes later).
2. **No aturi-side user state.** The server stores nothing about callers.
   Caching is of public upstream data only.
3. **Honest errors.** Tool failures return the existing `ApiErrorCode` enum
   (`missing_parameter`, `invalid_parameter`, `not_found`, `upstream_error`,
   `internal_error`) plus a `hint` naming the fix, so agents branch on codes,
   not prose.
4. **Every result is addressable.** Tool outputs carry the `at://` URI, the
   `aturi.to` universal link, and (where the record type is in the catalog)
   per-client waypoint URLs. Agents can always hand a human something to open.
5. **Network content is data, not instructions.** Record text, profile bios,
   and handles appear only as JSON string values in structured results, never
   interpolated into prose the model might read as directives.
6. **Fork-friendly.** Like `llms.txt` and the OpenAPI document, all
   self-referential URLs derive from `getSiteUrl()`, so a fork serves an MCP
   server that points at itself.

## Tool catalog

Sixteen tools in five groups. Names are flat snake_case verbs; descriptions
will be written as dispatch criteria in the `llms.txt` style ("you have X and
need Y") rather than as feature copy, since the description is what the model
routes on.

### Resolve and open (the aturi-specific tools)

| Tool | Input | Output | Upstream |
| --- | --- | --- | --- |
| `resolve_link` | any URL or `at://` URI | record coordinates, record type, every client that can open it with ready URLs, the universal link | waypoint catalog; AT Tags page read as fallback (SSRF-guarded) |
| `list_waypoints` | optional `type`, `capability` filters | the client catalog, compose-intent support flags | none (static) |

### Identity

| Tool | Input | Output | Upstream |
| --- | --- | --- | --- |
| `resolve_identity` | handle or DID | DID, current handle, PDS endpoint, DID document summary | DoH, `.well-known`, PLC |
| `get_identity_history` | DID | chronological PLC audit log with per-operation diffs: handle changes, PDS migrations, key rotations, tombstones | plc.directory |

### Repositories and records

| Tool | Input | Output | Upstream |
| --- | --- | --- | --- |
| `describe_repo` | handle or DID | PDS, collections present, profile summary, latest commit, approximate repo size | PDS, appview |
| `list_records` | repo + collection (+ cursor, limit ≤ 100) | one page of records with `at://` URIs | PDS |
| `get_record` | `at://` URI (or repo + collection + rkey) | record JSON, CID, universal link, waypoints | Slingshot, PDS fallback |
| `describe_pds` | hostname | server description, health, sample of hosted repos | that PDS (SSRF-guarded) |

### Network graph

| Tool | Input | Output | Upstream |
| --- | --- | --- | --- |
| `get_backlinks` | `at://` URI or DID, optional source collection+path filter, `mode: counts \| records` | who references this, grouped by lexicon and link path; record pages in `records` mode | Constellation |

One tool with a mode switch rather than two tools, because "how many" and
"show me" are the same question at different zoom, and agents reliably pass
enum params.

### Bluesky layer

| Tool | Input | Output | Upstream |
| --- | --- | --- | --- |
| `get_profile` | 1–25 handles/DIDs | profile cards: display name, bio, counts | public appview |
| `get_thread` | post `at://` URI or bsky.app URL | simplified thread tree: author, text, counts, depth-capped | public appview |
| `search_posts` | query, optional author/since/until/lang/sort, limit ≤ 50 | matching posts | public appview |
| `search_actors` | query, limit ≤ 25 | matching accounts | public appview |

### Lexicon ecosystem

| Tool | Input | Output | Upstream |
| --- | --- | --- | --- |
| `list_trending_lexicons` | time window, sort (mutations/events/repos/hosts), limit | the leaderboard the explorer landing shows | UFOs |
| `get_lexicon_activity` | NSID | stats + timeseries for one lexicon: records, repos, PDS hosts over time | UFOs |
| `search_lexicons` | free-text query | matching NSIDs with record counts | UFOs |
| `sample_recent_records` | NSID, limit ≤ 25 | recent records network-wide in that collection | UFOs |

`sample_recent_records` is the "explore the atmosphere" tool: it answers
"what does leaflet.pub activity actually look like right now" without a
WebSocket, using the UFOs recent-records endpoint the explorer already calls.

**Stretch (v1.1): `get_lexicon_schema`**, NSID → published
`com.atproto.lexicon.schema` record via the `_lexicon` DNS TXT resolution that
`spaceLexicon.ts` already implements. Deferred only because output size needs
design (schemas run large); everything it needs exists.

**Explicitly not in v1:** anything requiring auth (timelines, notifications,
preferences), anything that writes, live Jetstream streaming (the WS client is
browser-only by design; UFOs covers the read need), and full-firehose
analytics we'd have to index ourselves. The server reads existing indexes; it
does not become one.

### Prompts and resources

Two MCP prompts at launch, because they demonstrate composition:
`explore_account` (identity → history → repo → backlinks → summary) and
`whats_happening` (trending lexicons → samples from the top three). Resources
stay out of v1; client support is uneven and every resource we'd serve is
reachable as a tool result or at an existing URL (`/llms.txt`, `/docs.md`,
`/openapi.json`).

## Architecture

```
agent (Claude, ChatGPT, Cursor, ...)
  │  Streamable HTTP / 2026-07-28 stateless JSON-RPC
  ▼
aturi.to/mcp        Next.js route handler, mcp-handler 2.x
  │  zod-validated params → existing service functions
  ▼
src/utils/atproto/* + src/utils/ufos/* + waypoint catalog
  │  upstreamFetch (8s timeout, 1 retry) + ssrfGuard + TTLMap
  ▼
public.api.bsky.app · plc.directory · constellation · slingshot · ufos-api · any PDS
```

Concrete choices:

- **Route:** `src/app/mcp/route.ts` (final path is a decision point, see
  below). Stateless per the 2026 spec; no Redis, no session store, matching
  the "no server-side state" line the project already holds.
- **Runtime:** Node runtime on Vercel, same as the other API routes.
  `upstreamFetch`'s 8-second per-attempt timeout keeps any tool call bounded;
  tools that fan out (thread hydration, `mode: records` backlinks) get
  explicit page/depth caps rather than longer budgets.
- **Validation:** zod schemas per tool, which mcp-handler converts to the
  JSON Schema agents see. Reject before any upstream call; reuse the
  `ApiErrorCode` mapping on the way out.
- **SSRF:** every tool that accepts a host or URL (`resolve_link` page reads,
  `describe_pds`, PDS fallbacks in `get_record`/`list_records`) goes through
  `ssrfGuard.ts`, no exceptions. MCP inputs are attacker-shaped by
  definition.
- **Caching:** three layers we already use elsewhere. Per-instance `TTLMap`
  for hot identity/PLC lookups; `Cache-Control`/data-cache on upstream GETs
  (identity 5m, audit log 1h, UFOs 60–300s, records uncached because Slingshot
  is the cache); and the 2026 spec's `ttlMs` metadata on `tools/list` so
  clients stop re-fetching the catalog.
- **Rate limiting:** enforced at the platform edge with a Vercel WAF rule on
  the MCP path (exact numbers are a decision point; a starting posture is
  60 requests/minute per IP), plus in-code caps on fan-out per call. Keyless
  like the rest of the API, with the same "no paid tier, be reasonable" line
  in the docs.
- **Observability:** count tool invocations by name and error code, nothing
  else. No payload logging; tool inputs contain whatever people are curious
  about, and the privacy page should be able to keep saying we don't store it.
- **Identification:** set a descriptive `User-Agent`
  (`aturi-mcp/<version> (+https://aturi.to/mcp)`) on MCP-originated upstream
  calls. `upstreamFetch` sets none today; microcosm and Bluesky operators
  should be able to see and contact us.

## The dependency exception this needs

AGENTS.md says no new dependencies, and to stop and say so when one looks
necessary. This is that stop. The proposal is three packages, scoped to the
web app only:

- `mcp-handler` (Vercel, MIT): transport, spec-version negotiation, the
  Next.js adapter.
- `@modelcontextprotocol/server` v2 (MIT): the protocol SDK mcp-handler
  builds on.
- `zod` v4 (MIT): tool input schemas. New to the web app, though `@atproto/*`
  packages already pull zod v3 transitively.

`packages/` stays zero-dependency and MIT; `extension/` is untouched; nothing
the sync script exports may import any of the three. The alternative, hand-
rolling the protocol like we hand-wrote `openapi.ts`, was real when MCP was
five endpoints of JSON, but dual-era transport negotiation (2026 stateless
plus 2025 Streamable HTTP), capability advertisement, and schema plumbing is
ongoing spec-tracking work, not a one-time file. Node 22 is already pinned,
which satisfies the SDK's floor.

## Writes and auth: phased, and maybe never hosted

The hosted server should launch read-only and may stay that way. The honest
options for "my agent should be able to post":

**Option A, local companion package.** Publish `@aturi.to/mcp` under
`packages/`: a stdio server a user runs on their own machine, holding their
own credentials, with write tools (`create_record`, `delete_record`,
`put_record`) plus the same read tools pointed at the same upstreams.
Credentials never touch aturi infrastructure, which is the same trade the
extension already makes (local-first, no telemetry). Licensing note: it would
be MIT like the other packages, so it imports `@aturi.to/waypoints` and its
own thin clients, not GPL app code.

**Option B, hosted OAuth tier.** `aturi.to/mcp` becomes an OAuth-protected
resource: agents sign in with atproto (the granular scope picker the web app
already has), and the server holds DPoP-bound tokens server-side via
`@atproto/oauth-client-node`. This is the first server-side user state in the
project's history and needs a KV store, key custody, revocation, and a
rewrite of the "tokens are stored only in your browser" promise. The 2026 MCP
auth spec and atproto OAuth both using client metadata documents makes the
plumbing cleaner than it was a year ago, but the custody question is
philosophical, not technical.

Recommendation: ship read-only hosted; build Option A when write demand is
real; keep Option B parked unless there's a reason a local process can't
serve (mobile-only users of remote agents is the strongest one).

## Distribution: how people actually add it

- **Claude:** Settings → Connectors → add by URL, or
  `claude mcp add --transport http aturi https://aturi.to/mcp`.
- **Cursor / VS Code / ChatGPT developer mode:** the same URL in each
  client's MCP config.
- **MCP Registry:** publish a `server.json` under a DNS-verified `to.aturi/*`
  namespace, which puts the server in every client that browses the registry.
- **llms.txt and /docs:** a new section teaching agents that read the site
  that the tool form exists ("if your runtime supports MCP, add
  `https://aturi.to/mcp` instead of calling the REST endpoints").
- **The existing channels:** README, a `/docs` section with copy-paste
  configs per client, an announce post from @aturi.to, and a `mcp` category
  on the feedback board so bug reports land in the same place as everything
  else.

A note on OpenAPI vs MCP: both stay. The REST API remains the right interface
for code and for function-calling bridges that consume OpenAPI; MCP is for
interactive agents. They wrap the same service layer, so neither is a fork of
the other.

## Testing

Same pattern as the OpenAPI contract tests in `src/lib/__tests__/`:

- A `tools/list` snapshot test: names stable, every schema converts to valid
  JSON Schema, description lengths bounded (they're prompt real estate).
- Per-tool fixture tests with `upstreamFetch` mocked: golden outputs for the
  happy path, every `ApiErrorCode` reachable, SSRF-guarded tools reject
  internal addresses.
- An error-code sync test so the MCP error enum can't drift from
  `apiError.ts`, mirroring the existing OpenAPI drift guard.
- Manual pass before each milestone: MCP Inspector, Claude Code, one
  hosted-agent client, running a fixed script of ten questions ("who links to
  this post", "what's trending", "where can I open this record", ...).

## Milestones

**M0, spike (a weekend):** `mcp-handler` route behind an env flag with three
tools: `resolve_link`, `resolve_identity`, `get_record`. Verify in MCP
Inspector and Claude Code against production upstreams. Nothing announced,
no docs. Output: confidence in the adapter layer and a feel for tool
ergonomics.

**M1, read-only beta (one to two weeks part-time):** the full sixteen-tool
catalog, caching and WAF limits in place, contract tests green in CI, /docs
and llms.txt updated. Soft-announce to the atproto dev community and iterate
on tool descriptions based on what agents actually do with them (the
transcripts will be humbling).

**M2, launch:** MCP Registry publication, the two prompts, structured output
schemas, `ttlMs` metadata, invocation dashboards, feedback-board category,
announce post. Reach out to the microcosm maintainer beforehand: Constellation
and UFOs are community infrastructure, and a traffic bump should be a
conversation first and (if it grows) a donation, not a surprise.

**M3, afterwards:** `get_lexicon_schema`, the writes decision (Option A build
or explicit no), spaces/userinput read tools if the feedback board's lexicons
prove interesting to agents, and whatever the beta transcripts demand.

## Risks

- **Upstream dependence.** Constellation, Slingshot, and UFOs are
  community-run; `public.api.bsky.app` is Bluesky's. Mitigations: caching,
  per-upstream error codes so agents degrade gracefully ("backlinks
  unavailable" is an answer), the User-Agent so operators can reach us, and
  the M2 conversation with microcosm before launch traffic.
- **Spec churn.** 2026-07-28 landed four weeks ago and clients are
  mid-migration. mcp-handler's dual-era support is the hedge; the cost of
  being early is tracking minor releases.
- **Abuse.** A keyless endpoint that fetches URLs is a proxy if you get it
  wrong. `ssrfGuard` on every host-shaped input, fan-out caps, WAF limits,
  and no tool that fetches arbitrary non-atproto content beyond the AT Tags
  reader that already exists at `/api/at-tags` with the same guard.
- **Cost.** Each tool call is one function invocation plus one to four cached
  upstream fetches, all on infrastructure with a generous free tier and no
  per-call upstream fees. The realistic cost is maintainer attention, which
  is why v1 is read-only and stateless.

## Decision points

The plan assumes an answer to each of these; all are open to change:

1. **Endpoint shape.** `aturi.to/mcp` (proposed) vs `/api/mcp` vs an
   `mcp.aturi.to` subdomain. Path-on-apex needs no new DNS or cert and keeps
   the fork story simple; a subdomain reads more like a product.
2. **The dependency exception.** Three MIT packages, web app only, as scoped
   above. This one is yours to sign off per AGENTS.md.
3. **Catalog scope.** Sixteen tools as listed, or trim for v1? Candidates to
   cut if smaller is better: `describe_pds`, `search_posts`, one of the
   lexicon four.
4. **`search_posts` specifically.** It's the only tool whose upstream
   (Bluesky search) has historically tightened keyless access. In v1, or wait?
5. **Writes.** Read-only forever, Option A (local package), or eventually
   Option B (hosted OAuth)? This decides whether "no server-side user state"
   stays a permanent property or a current one.
6. **Live firehose.** Defer (proposed, UFOs covers the need) or build a
   time-boxed server-side Jetstream sampler as a v1 tool?
7. **Rate-limit posture.** Starting numbers for the WAF rule and per-call
   fan-out caps.
8. **Naming.** Server display name ("Aturi", "Atmosphere Explorer", ...),
   registry namespace (`to.aturi/mcp`), and whether tool names carry no
   prefix (proposed; clients namespace by server already).
