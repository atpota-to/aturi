# @aturi.to/waypoints

Aturi's curated catalog of Atmosphere (AT Protocol) clients ("waypoints") plus
the logic to turn an AT URI into per-client "Open in…" links, recommend the best
client for a record type, and reverse-resolve a pasted URL back into an AT URI.

Zero runtime dependencies. Works in the browser, Node 18+, and edge runtimes.
Ships ESM + CJS with full type definitions.

For a drop-in React picker UI, see [`@aturi.to/waypoints-react`](../waypoints-react).

> **Beta: early release.** This is a `0.x` package that hasn't been
> thoroughly tested in production yet. Expect rough edges, and possible
> breaking changes between minor versions while the API settles. Bug reports
> and feedback are very welcome at
> [github.com/atpota-to/aturi/issues](https://github.com/atpota-to/aturi/issues).

## Install

```sh
npm install @aturi.to/waypoints
```

## Quick start

```ts
import { resolveAtUri, resolveUrl, buildWaypointsForParsed } from '@aturi.to/waypoints';

// AT URI -> waypoints
const result = resolveAtUri('at://did:plc:abc/app.bsky.feed.post/3k7');
result?.waypoints; // [{ id: 'anisota', name: 'Anisota', category, url }, ...]
result?.recommended; // { ids: ['bluesky', 'anisota', ...], label: 'Recommended for Posts' }

// Pasted page URL -> waypoints (offline pattern match)
const fromUrl = await resolveUrl('https://bsky.app/profile/alice.bsky.social/post/3k7');
```

## Preferred clients

The ecosystem default is to send every `app.bsky.feed.post` link to bsky.app.
That's a guess about the reader, and it's often wrong — plenty of people read
Bluesky in Blacksky, Deer, or Anisota.

`to.aturi.actor.preferredClients` is a public record an account publishes to its
own PDS saying where it wants records opened. If your app links out to Atmosphere
records and knows who it's linking on behalf of, you can read that record and
honor it:

```ts
import { fetchPreferredClients, preferredWaypointFor } from '@aturi.to/waypoints';

// One public read — no auth, no API key. Accepts a handle or a DID.
const record = await fetchPreferredClients('alice.bsky.social');

const choice = preferredWaypointFor(record, {
  type: 'post',
  handle: 'bob.bsky.social',
  collection: 'app.bsky.feed.post',
  rkey: '3k7qw...',
});

const href = choice?.url ?? myExistingDefault;
```

Most accounts have published nothing, so `null` is the common answer and never an
error: fall back to whatever you do today. Or do both steps at once with
`resolveAtUriForActor(uri, actor)`, which returns a normal `ResolveResult` with
the reader's clients lifted to the front of `recommended.ids` and the winner on
`preferred`.

A rule's scope is a collection NSID (`app.bsky.feed.post`), a namespace wildcard
(`sh.tangled.*`), a record kind (`post`, `profile`, `list`, `record`), or `*`.
The most specific match wins. Clients are listed most-preferred-first, and a
client outside the catalog can carry its own URL templates — so a self-hosted
deploy still produces a working link in an app that has never heard of it.

Schema:
[`to.aturi.actor.preferredClients`](https://aturi.to/lexicons/to.aturi.actor.preferredClients.json).

## What's included

- **Catalog**: `WAYPOINT_DESTINATIONS_DATA`, `WAYPOINT_ORDER`, `WAYPOINT_CATEGORIES_DATA`,
  `COMPAT_FAMILIES`, `DID_REQUIRED_WAYPOINTS`, and the `WaypointData` /
  `WaypointType` types.
- **Link builders & recommendations**: `getWaypointDataForType`,
  `getCategorizedWaypointsData`, `getRecommendedWaypointsData`,
  `getFeaturedWaypointData`, `waypointActivity`.
- **AT URI parsing**: `parseURI`, `resolveHandle`, `getDisplayName`.
- **Reverse resolution**: `matchSupportedUrl`, `parseAtUri`, `SUPPORTED_HOSTS`.
- **Identity**: `resolveHandleToDid`, `fetchDidDocument`, `resolvePdsEndpoint`,
  `resolveDidToHandle`.
- **Preferred clients**: `fetchPreferredClients`, `preferredWaypointFor`,
  `preferredClientUrl`, `preferredWaypointIdsFor`, `orderIdsByPreference`,
  `parsePreferredClientsRecord`, `buildPreferredClientsRecord`.
- **High-level resolvers** (`resolve.ts`):
  - `buildWaypointsForParsed(parsed, { did?, excludeSourceId? })`
  - `resolveAtUri(uri)` / `resolveAtUriForActor(uri, actor)`
  - `resolveUrl(url, { fetchHead?, resolveHandle? })` /
    `resolveUrlForActor(url, actor, …)`
  - `applyPreferredClients(result, record)`
  - `resolveViaApi(input, { endpoint? })`: typed client for the hosted
    `aturi.to/api/resolve` endpoint.

### DID-only waypoints

A handful of destinations (`pdsls`, `atptools`, `margin`, `grain`, `popfeed`)
only produce useful URLs when a DID is known. They're filtered out unless a DID
is available: pass one in, or supply a `resolveHandle` to `resolveUrl`.

### Hosted vs. local resolution

`resolveUrl` matches URL patterns locally (no network). The optional `fetchHead`
flag and `resolveViaApi` let you fall back to fetching the page and probing for a
`<link href="at://…">`, useful for sites without a recognizable URL shape.
`resolveViaApi` is the right choice from a browser, where fetching arbitrary
pages is blocked by CORS.

## A note on drift

The canonical logic/icon files (`waypoints.data.ts`, `uriParser.ts`,
`reverseParsers.ts`, `didResolver.ts`, `preferredClients.ts`, and the React icon
catalog) are the single source of truth inside the
[`aturi.to`](https://github.com/atpota-to/aturi) app under `src/`.
This package ships **copies** so it can build standalone, kept in lockstep by a
sync script:

```sh
npm run sync        # copy the canonical files into the packages
npm run sync:check  # exit non-zero if any copy is stale (wire into CI/pre-publish)
```

If you change waypoint data or parsing logic in the app, re-run `npm run sync`.

## License

MIT © atpotato, LLC. (The Aturi app itself is GPL-3.0; these packages are
dual-licensed MIT by the copyright holder to remove the adoption barrier.)
