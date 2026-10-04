# @aturi.to/waypoints

Aturi's curated catalog of Atmosphere (AT Protocol) clients ("waypoints") plus
the logic to turn an AT URI into per-client "Open in…" links, recommend the best
client for a record type, and reverse-resolve a pasted URL back into an AT URI.
Each client's brand mark ships too, as framework-agnostic SVG.

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

Also mirrored to GitHub Packages as `@atpota-to/waypoints` (GitHub only accepts a
scope matching the repository owner, and it rejects the dot in `aturi.to`). Same
build, same version. GitHub Packages requires a token even for public packages,
so installing from there needs an `.npmrc`:

```sh
@atpota-to:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}   # PAT with read:packages
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
  - `resolveAtUri(uri, { composeText? })`
  - `resolveUrl(url, { fetchHead?, resolveHandle?, composeText? })`
  - `resolveViaApi(input, { endpoint? })`: typed client for the hosted
    `aturi.to/api/resolve` endpoint.
- **Universal links** (`universalLinks.ts`): `buildUniversalLink`,
  `parseUniversalLink`, `isUniversalLink`, `describeUniversalLink`,
  `buildUniversalLinkTags`, `UNIVERSAL_LINK_ORIGIN`.
- **Brand marks** (`@aturi.to/waypoints/icons`): `WAYPOINT_ICON_SVGS`,
  `getWaypointIconSvg`, and a named export per waypoint. See
  [Icons](#icons).

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
// ['anisota', 'bluesky', 'impro', 'blacksky', 'witchsky', 'mu', 'deer', 'northsky']

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

### Universal links

A universal link is the client-agnostic address of a record: drop an
`aturi.to/…` URL in a DM or a footer and the recipient gets a preview plus every
client that can open it, instead of being pushed into whichever app you happen
to use. `buildUniversalLink` returns that address for anything that names a
record: an AT URI, a handle, a DID, a page URL from any client in the catalog,
a `ParsedURI`. It's pure, synchronous, and never fetches.

```ts
import { buildUniversalLink, describeUniversalLink } from '@aturi.to/waypoints';

buildUniversalLink('at://did:plc:abc/app.bsky.feed.post/3k7');
// 'https://aturi.to/profile/did:plc:abc/post/3k7'
buildUniversalLink('https://bsky.app/profile/alice.bsky.social/post/3k7');
// 'https://aturi.to/profile/alice.bsky.social/post/3k7'
buildUniversalLink('@alice.bsky.social');
// 'https://aturi.to/profile/alice.bsky.social'
```

For a copy button or a share sheet, `describeUniversalLink` returns the strings
around the link too:

```ts
const link = describeUniversalLink('at://alice.bsky.social/app.bsky.feed.post/3k7');
link.url;               // 'https://aturi.to/profile/alice.bsky.social/post/3k7'
link.label;             // 'Post by @alice.bsky.social'
link.share;             // { title, text, url }; hand it straight to navigator.share()
link.snippets.markdown; // '[Post by @alice.bsky.social](https://aturi.to/…)'
link.oembedUrl;         // hosted oEmbed endpoint (posts only; null otherwise)
```

Options on both: `origin` (point at your own deployment), `did` + `preferDid`
(address links by DID, which survives a handle change), and `params` for
appended query parameters like `{ ref: 'my-app' }`.

Going the other way, `parseUniversalLink` turns an aturi.to URL back into a
`ParsedURI`. Canonical `/profile/…` links, `/explore/…` views, and the legacy
bare-path and `at://`-in-path spellings all resolve:

```ts
parseUniversalLink('https://aturi.to/profile/alice.bsky.social/post/3k7');
// { type: 'post', handle: 'alice.bsky.social', collection: 'app.bsky.feed.post', rkey: '3k7', … }
```

#### Making your own pages resolvable

If your app renders atproto records, `buildUniversalLinkTags` writes the
`<head>` tags that let the rest of the Atmosphere find its way back to them:

```ts
buildUniversalLinkTags('at://did:plc:abc/app.bsky.feed.post/3k7').html;
// <meta name="at:canonical" content="at://did:plc:abc/app.bsky.feed.post/3k7" />
// <meta name="at:author" content="at://did:plc:abc" />
// <link rel="alternate" href="at://did:plc:abc/app.bsky.feed.post/3k7" />
// <link rel="alternate" type="application/json+oembed" href="https://aturi.to/api/oembed?url=…" />
```

`at:canonical` is the [AT Tags proposal](https://tangled.org/chrisshank.com/at-tags/).
Aturi's browser extension reads it off the live page and `/api/resolve` reads it
off your HTML, so a link to your page resolves into every other client that can
open the record, without your app being in the catalog at all. The
`<link rel="alternate" href="at://…">` beside it is the older spelling of the
same declaration, kept because the resolver still falls back to it. The oEmbed
pointer is emitted for posts only, since that's all the endpoint renders.

They're static strings describing a record you already display, and serving
them hands nothing to aturi.to.

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

There's a second hosted endpoint for the catalog itself — what's in it, and
which clients can do what — for consumers that aren't installing the package:

```http
GET https://aturi.to/api/waypoints
GET https://aturi.to/api/waypoints?type=post&capability=compose
```

## Icons

Every waypoint's brand mark ships as plain SVG markup, behind a subpath:

```ts
import { WAYPOINT_ICON_SVGS, getWaypointIconSvg } from '@aturi.to/waypoints/icons';

getWaypointIconSvg('bluesky'); // '<svg xmlns="…" viewBox="0 0 512 512">…</svg>'
```

The marks are a subpath rather than part of the main entry because a bundler
cannot drop unused keys from an object literal. Importing them is opt-in, so
nothing that only wants link builders pays for roughly 80KB of artwork.

Values are markup, not components, so any framework can render them:

```svelte
{@html getWaypointIconSvg(id)}
```
```vue
<span v-html="getWaypointIconSvg(id)" />
```
```tsx
<span dangerouslySetInnerHTML={{ __html: getWaypointIconSvg(id) ?? '' }} />
```

The values are static package data, not user input, so none of those three is an
injection risk. Linters that flag `v-html` or `dangerouslySetInnerHTML` on sight
will still want an inline exception.

Individual marks are exported by name if you would rather pull one and let the
rest tree-shake away:

```ts
import { blueskyIconSvg, tangledIconSvg } from '@aturi.to/waypoints/icons';
```

Every id in `WAYPOINT_ORDER` has a mark. React consumers who want components
instead can use [`@aturi.to/waypoints-react`](../waypoints-react), which ships
the same catalog as JSX.

### Styling

Each mark is 24x24 and paints in `currentColor`, so it takes the colour of the
surrounding text. A CSS rule beats the width and height baked into the markup,
so size them from your stylesheet rather than rewriting the string:

```css
.waypoint-icon svg { width: 1.25rem; height: 1.25rem; }
```

Three marks (Lea, Leaflet, pckt) knock part of the shape out to the page
background instead of painting it. That colour comes from
`var(--bg-primary, white)`, so set `--bg-primary` on an ancestor if your surface
is not white:

```css
.waypoint-icon { --bg-primary: #0c0908; }
```

`currentColor` only resolves when the SVG is part of the page. Inlining is the
supported path; a mark referenced as an external image or data URI through
`<img src>` or `background-image` is a separate document with no access to your
text colour, and will paint black.

Every mark fills the same 24x24 box, so a row of them lines up, but the artwork
inside does not carry equal weight. Painted area runs from roughly a third of
the box (Impro, Mu, Taproot) to all of it (Lea, Red Dwarf). That is the brands'
own proportions rather than something the catalog flattens, so nudge individual
marks in your own CSS if you want them optically even.

### Accessibility

The marks carry no title or description, and a handful set `aria-hidden` while
most do not. Be explicit at the call site rather than relying on what happens to
be in the markup.

Beside a visible client name the mark is decorative, so hide it:

```html
<span class="waypoint-icon" aria-hidden="true"><!-- mark --></span>
```

Standing alone as the whole of a link or button, it needs an accessible name:

```html
<a href="…" aria-label="Open in Bluesky">
  <span class="waypoint-icon"><!-- mark --></span>
</a>
```

### Trademarks

These are third-party brand marks, reproduced so a picker can identify each
client. The MIT licence on this package covers the code, not the trademarks.
Using a mark to identify a client is nominative use; using one to suggest that
client endorses your product is not. If you represent one of these projects and
want a mark changed or removed, open an issue.

## A note on drift

The canonical logic and icon files (`waypoints.data.ts`, `uriParser.ts`,
`reverseParsers.ts`, and the React icon catalog) are the single source of truth
inside the [`aturi.to`](https://github.com/atpota-to/aturi) app under `src/`.
This package ships **copies** so it can build standalone, kept in lockstep by a
sync script. The SVG strings above are generated from that same React catalog by
the same script, so the two never disagree about what a waypoint looks like:

```sh
npm run sync        # copy the canonical files into the packages
npm run sync:check  # exit non-zero if any copy is stale (wire into CI/pre-publish)
```

If you change waypoint data or parsing logic in the app, re-run `npm run sync`.

## License

MIT © atpotato, LLC. (The Aturi app itself is GPL-3.0; these packages are
dual-licensed MIT by the copyright holder to remove the adoption barrier.)
