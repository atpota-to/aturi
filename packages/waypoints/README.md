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

## What's included

- **Catalog**: `WAYPOINT_DESTINATIONS_DATA`, `WAYPOINT_ORDER`, `WAYPOINT_CATEGORIES_DATA`,
  `COMPAT_FAMILIES`, and the `WaypointData` / `WaypointType` types.
- **Link builders & recommendations**: `getWaypointDataForType`,
  `getCategorizedWaypointsData`, `getRecommendedWaypointsData`,
  `getFeaturedWaypointData`, `waypointActivity`.
- **Compose intents**: `supportsComposeIntent`, `getComposeIntentUrl`,
  `getComposeIntentAppUrl`, `getComposeIntentTemplate`,
  `getComposeIntentWaypoints`, `describeComposeIntent`.
- **AT URI parsing**: `parseURI`, `resolveHandle`, `getDisplayName`.
- **Reverse resolution**: `matchSupportedUrl`, `parseAtUri`, `SUPPORTED_HOSTS`.
- **High-level resolvers** (`resolve.ts`):
  - `buildWaypointsForParsed(parsed, { did?, excludeSourceId? })`
  - `resolveAtUri(uri)`
  - `resolveUrl(url, { fetchHead?, resolveHandle? })`
  - `resolveViaApi(input, { endpoint? })`: typed client for the hosted
    `aturi.to/api/resolve` endpoint.

### Compose intents

bsky.app can be handed a link that opens its composer pre-filled —
`/intent/compose?text=…`, documented at
[docs.bsky.app](https://docs.bsky.app/docs/advanced-guides/intent-links) — and
the clients forked from the official social app inherit the same route. The
catalog records which ones do, so you can offer "post this in your client"
without hardcoding a list.

```ts
import {
  WAYPOINT_DESTINATIONS_DATA,
  getComposeIntentUrl,
  getComposeIntentWaypoints,
  supportsComposeIntent,
} from '@aturi.to/waypoints';

getComposeIntentWaypoints().map((w) => w.id);
// ['bluesky', 'impro', 'blacksky', 'witchsky', 'mu', 'deer']

supportsComposeIntent(WAYPOINT_DESTINATIONS_DATA.pdsls); // false
getComposeIntentUrl(WAYPOINT_DESTINATIONS_DATA.deer, 'hello from my app');
// 'https://deer.social/intent/compose?text=hello%20from%20my%20app'
```

Resolver results carry the same information per waypoint as a serializable
`composeIntent` (`null` when the client has no confirmed route), and
`resolveAtUri` / `resolveUrl` / `buildWaypointsForParsed` take a `composeText`
option to pre-fill it:

```ts
const { waypoints } = resolveAtUri(uri, { composeText: 'look at this' })!;
waypoints.find((w) => w.id === 'deer')?.composeIntent;
// {
//   url: 'https://deer.social/intent/compose?text=look%20at%20this',
//   urlTemplate: 'https://deer.social/intent/compose?text={text}',
//   textParam: 'text',
//   prefillsText: true,
// }
```

Two things not to assume. `prefillsText` is `false` for a client that routes
the intent but drops the text (Impro today), so the link opens an empty
composer — fine as a jump, useless as a share. And `appUrl` is only set where
the client publishes a native scheme (`bluesky://intent/compose`), so treat it
as a bonus rather than a fallback.

A missing `composeIntent` means "no route we've confirmed", not proof the
client lacks one. If a client you maintain handles compose intents,
[open an issue](https://github.com/atpota-to/aturi/issues) and we'll add it.

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

The four canonical logic/icon files (`waypoints.data.ts`, `uriParser.ts`,
`reverseParsers.ts`, and the React icon catalog) are the single source of truth
inside the [`aturi.to`](https://github.com/atpota-to/aturi) app under `src/`.
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
