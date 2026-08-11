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
  - `buildWaypointsForParsed(parsed, { did?, excludeSourceId?, composeText? })`
  - `resolveAtUri(uri, { did?, excludeSourceId?, composeText? })`
  - `resolveUrl(url, { fetchHead?, resolveHandle?, composeText?,
    allowPrivateHosts?, isAllowedFetchHost? })`
  - `requiresDid(waypoint, target, did?)`, `isPublicFetchHost(hostname)`

  `resolveUrl` omits the source app's own waypoint — it can tell where you are
  from the URL. An AT URI names no app, so `resolveAtUri` omits nothing unless
  you pass `excludeSourceId` yourself.
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
// ['anisota', 'bluesky', 'impro', 'blacksky', 'witchsky', 'mu', 'deer']

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
generally need a DID to produce a useful URL, and are filtered out when none is
known — pass a `did` in, or supply a `resolveHandle` to `resolveUrl`.

The requirement is evaluated per target rather than per waypoint, via the
exported `requiresDid(waypoint, target, did?)`. A waypoint that can build a
correct URL from a handle alone for a given record is kept: Margin's own
`at.margin.*` records resolve to `margin.at/<handle>/<type>/<rkey>`, so Margin
shows up for those without a DID, and drops out for everything else.
`@aturi.to/waypoints-react` applies the same function, so both packages agree.

### Hosted vs. local resolution

`resolveUrl` matches URL patterns locally (no network). The optional `fetchHead`
flag and `resolveViaApi` let you fall back to fetching the page and probing for a
`<link href="at://…">`, useful for sites without a recognizable URL shape.
`resolveViaApi` is the right choice from a browser, where fetching arbitrary
pages is blocked by CORS.

> **`fetchHead` makes a request to a URL you were handed.** If that URL came
> from a user, you are fetching on their behalf from wherever your code runs —
> which on a server means from inside your network. The probe refuses loopback,
> private, link-local and `.internal` addresses before connecting, re-checks
> every redirect hop (max 3), and caps the response body at 1 MB. Treat that as
> a floor. On a server route handling untrusted input, add your own allowlist
> via `isAllowedFetchHost`:
>
> ```ts
> await resolveUrl(userSuppliedUrl, {
>   fetchHead: true,
>   isAllowedFetchHost: (url) => KNOWN_PUBLICATION_HOSTS.has(url.hostname),
> });
> ```
>
> `allowPrivateHosts: true` turns the address check off, for local development
> against a dev server. The same address check is exported on its own as
> `isPublicFetchHost(hostname)`.

`resolveViaApi` returns a result rather than throwing when the endpoint is
unreachable or answers with something that isn't JSON — check `ok` first:

```ts
const result = await resolveViaApi({ url });
if (!result.ok) {
  // result.reason: 'http_error' | 'invalid_response' | 'network_error' | …
  console.warn(result.reason, result.message);
}
```

There's a second hosted endpoint for the catalog itself — what's in it, and
which clients can do what — for consumers that aren't installing the package:

```http
GET https://aturi.to/api/waypoints
GET https://aturi.to/api/waypoints?type=post&capability=compose
```

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
