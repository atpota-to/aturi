// Single source of truth for the Markdown version of the developer docs.
//
// Consumed by:
//   - CopyMarkdownButton (the "Copy as Markdown" button in the docs header)
//   - /docs.md (a plain-text route handler agents can fetch directly)
//
// Keep this in sync with src/app/docs/page.tsx. It deliberately mirrors the
// page's prose and code blocks so an LLM or coding agent gets the full context
// in one paste — install commands, examples, API shape, and links included.
//
// Note: this is a template literal, so backticks (code fences / inline code)
// are escaped as \` and a literal ${ in the nested example is escaped as \${.

export const DOCS_MARKDOWN = `# aturi.to: Developer Docs

> Add Atmosphere "Open in…" links, smart client recommendations, compose
> intents, and AT-URI resolution to your own app, with two MIT-licensed
> packages and a public API.

- Docs: https://aturi.to/docs
- Core package: https://npmx.dev/package/@aturi.to/waypoints
- Repo: https://github.com/atpota-to/aturi
- Raw Markdown: https://aturi.to/docs.md

## Overview

The same waypoint catalog, recommendations, and link logic that power aturi.to
are published as two standalone, MIT-licensed npm packages so you can drop them
into any Atmosphere (AT Protocol) app:

- **@aturi.to/waypoints**, a zero-dependency, framework-agnostic core: the
  client catalog, per-client "Open in…" link builders, recommendations, and
  URL ⇄ AT-URI resolution. Works in the browser, Node 18+, and edge runtimes.
- **@aturi.to/waypoints-react**: a headless-first React picker UI plus client
  icons, built on the core. Ships zero CSS by default and is fully themeable.

Both are licensed **MIT** (the aturi.to app itself is GPL-3.0) to remove the
adoption barrier. Prefer not to install anything? The hosted Resolve API does
the same work over HTTP.

## @aturi.to/waypoints (core)

The zero-dependency core. Turn an AT URI into per-client links, recommend the
best client for a record type, and reverse-resolve a pasted URL back into an
AT URI.

\`\`\`bash
npm install @aturi.to/waypoints
\`\`\`

### Resolve an AT URI or a pasted URL

\`\`\`ts
import { resolveAtUri, resolveUrl } from '@aturi.to/waypoints';

// AT URI -> waypoints
const result = resolveAtUri('at://did:plc:abc/app.bsky.feed.post/3k7');
result?.waypoints;   // [{ id: 'anisota', name: 'Anisota', category, url }, ...]
result?.recommended; // { ids: ['bluesky', 'anisota', ...], label: 'Recommended for Posts' }

// Pasted page URL -> waypoints (offline pattern match)
const fromUrl = await resolveUrl('https://bsky.app/profile/alice.bsky.social/post/3k7');
\`\`\`

### What's included

- **High-level resolvers:** \`resolveAtUri\`, \`resolveUrl\`,
  \`buildWaypointsForParsed\`, and \`resolveViaApi\` (a typed client for the
  hosted endpoint).
- **Catalog & recommendations:** \`getWaypointDataForType\`,
  \`getCategorizedWaypointsData\`, \`getRecommendedWaypointsData\`, and the raw
  \`WAYPOINT_DESTINATIONS_DATA\` catalog.
- **Parsing:** \`parseURI\`, \`parseAtUri\`, \`matchSupportedUrl\`,
  \`resolveHandle\`.
- **Capabilities:** \`supportsComposeIntent\`, \`getComposeIntentUrl\`,
  \`getComposeIntentWaypoints\` — see "Compose intents" below.
- **Universal links:** \`buildUniversalLink\`, \`parseUniversalLink\`,
  \`describeUniversalLink\`, \`buildUniversalLinkTags\`. See "Build an
  aturi.to link" below.

A handful of destinations (pdsls, atp.tools, Margin, Grain, Popfeed) only
produce useful URLs when a DID is known; they're filtered out unless a DID is
available, so pass one in or supply a \`resolveHandle\` to \`resolveUrl\`. Full
reference in the package README:
https://github.com/atpota-to/aturi/blob/main/packages/waypoints/README.md

## @aturi.to/waypoints-react (React picker)

A drop-in React "Open in…" picker. Headless-first: it ships zero CSS and emits
stable, namespaced styling hooks, so you can use your own design system, opt
into the polished theme, or drop down to a hook and render everything yourself.
It re-exports the entire core, so a single install gives you the components and
the resolvers.

\`\`\`bash
npm install @aturi.to/waypoints-react
# peers (you almost certainly already have react/react-dom):
npm install react react-dom lucide-react
\`\`\`

### 1. Drop-in picker

Renders clean semantic markup with no CSS attached. Every element carries a
\`data-aturi-wp\` attribute and an \`aturi-wp-*\` class; map your own via
\`classNames\`, pass \`unstyled\` to drop the built-ins, or replace rows with the
\`renderWaypoint\` prop.

\`\`\`tsx
import { WaypointPicker } from '@aturi.to/waypoints-react';

<WaypointPicker
  type="post"
  handle="alice.bsky.social"
  collection="app.bsky.feed.post"
  rkey="3k7qw..."
/>;
\`\`\`

### 2. The useWaypoints hook

For full control, the hook returns render-ready data plus \`copy\` / \`open\`
helpers: no markup at all.

\`\`\`tsx
import { useWaypoints } from '@aturi.to/waypoints-react';

function MyPicker() {
  const { recommended, categories, waypoints, copy, open } = useWaypoints({
    type: 'post',
    handle: 'alice.bsky.social',
    collection: 'app.bsky.feed.post',
    rkey: '3k7qw...',
  });

  return (
    <ul>
      {waypoints.map((w) => (
        <li key={w.id}>
          {w.icon}
          <button onClick={() => open(w.url)}>{w.name}</button>
          <button onClick={() => copy(w.url)}>Copy</button>
        </li>
      ))}
    </ul>
  );
}
\`\`\`

### 3. The polished theme (opt-in)

Want the Aturi look without writing CSS? Import the stylesheet once. It targets
the namespaced classes and is fully themeable via \`--aturi-wp-*\` CSS custom
properties (with light/dark defaults).

\`\`\`tsx
import '@aturi.to/waypoints-react/styles.css';
import { WaypointPicker } from '@aturi.to/waypoints-react';
\`\`\`

**Server vs. client:** the package is a client component (it carries
\`"use client"\`), so it works out of the box in the Next.js App Router. For
framework-agnostic helpers inside a Server Component, import them from
\`@aturi.to/waypoints\` directly.

## Resolve API

Don't want to install anything? Hit the hosted endpoint from a share sheet, an
Apple Shortcut, or any client: no login, no API keys. It returns the resolved
waypoints and recommendations for a page URL or an AT URI.

\`\`\`http
GET https://aturi.to/api/resolve?url=<encoded-page-url>
GET https://aturi.to/api/resolve?atUri=at://...
\`\`\`

The core package's \`resolveViaApi()\` is a typed client for this endpoint. It's
the right choice from a browser, where fetching arbitrary pages is blocked by
CORS.

To ask about the catalog itself rather than a specific record — what's in it,
and which clients can do what — there's a companion endpoint, filterable by
\`?type=\` and \`?capability=\`:

\`\`\`http
GET https://aturi.to/api/waypoints
GET https://aturi.to/api/waypoints?type=post&capability=compose
\`\`\`

### Apple Shortcuts: format=map

Add \`&format=map\` and the envelope is dropped for a flat name -> URL object.
Shortcuts' *Choose from List* action shows a dictionary's keys and hands back
the matching value, so that one parameter turns a share-sheet Shortcut into
three actions: fetch, choose, open.

\`\`\`http
GET https://aturi.to/api/resolve?url=<encoded-page-url>&format=map
\`\`\`

\`\`\`json
{
  "Anisota": "https://anisota.net/profile/bsky.app/post/3lkxq...",
  "Red Dwarf": "https://reddwarf.app/profile/bsky.app/post/3lkxq...",
  "Blacksky": "https://blacksky.community/profile/bsky.app/post/3lkxq..."
}
\`\`\`

1. **Receive** URLs from the share sheet.
2. **Get Contents of URL** — \`https://aturi.to/api/resolve?format=map&url=\`
   with the URL-encoded Shortcut Input appended.
3. **Choose from List** -> **Open URLs**.

Every failure is an empty object under this format — a bad parameter, a page
with no atproto data — so nothing has to branch on a response shape. Guard the
picker with an \`If <count> is 0\` to say "nothing to open here". The full
\`format=json\` response is the one to reach for when you want \`recommended\`,
\`parsed\`, or the compose intents.

## Compose intents

bsky.app can be handed a link that opens its composer pre-filled:
\`/intent/compose?text=…\` (see
https://docs.bsky.app/docs/advanced-guides/intent-links). Clients forked from
the official social app inherit the same route, so the catalog records which
ones do — and every waypoint carries a \`composeIntent\`, \`null\` when the client
has no confirmed route.

\`\`\`ts
import {
  WAYPOINT_DESTINATIONS_DATA,
  getComposeIntentUrl,
  getComposeIntentWaypoints,
  supportsComposeIntent,
} from '@aturi.to/waypoints';

// Which clients will open a composer for you?
getComposeIntentWaypoints().map((w) => w.id);
// ['anisota', 'bluesky', 'impro', 'blacksky', 'witchsky', 'mu', 'deer', 'northsky']

supportsComposeIntent(WAYPOINT_DESTINATIONS_DATA.deer); // true
getComposeIntentUrl(WAYPOINT_DESTINATIONS_DATA.deer, 'hello from my app');
// 'https://deer.social/intent/compose?text=hello%20from%20my%20app'
\`\`\`

Two nuances worth reading off the data rather than assuming. \`prefillsText\` is
\`false\` for a client that routes the intent but ignores the text, so a "share
this" link would open an empty composer — fine as a jump, useless as a share.
And \`appUrl\` appears only where the client publishes a native scheme, so it's a
bonus, not a fallback.

Over HTTP, the same data comes back on both endpoints. Pass the text to get
finished links, or take \`urlTemplate\` and substitute the URL-encoded text for
\`{text}\` yourself.

\`\`\`http
GET https://aturi.to/api/waypoints?capability=compose&text=<encoded-text>
GET https://aturi.to/api/resolve?atUri=at://...&composeText=<encoded-text>
\`\`\`

\`\`\`json
{
  "id": "deer",
  "name": "Deer",
  "category": "blueskyForks",
  "composeIntent": {
    "url": "https://deer.social/intent/compose?text=hello",
    "urlTemplate": "https://deer.social/intent/compose?text={text}",
    "textParam": "text",
    "prefillsText": true
  }
}
\`\`\`

In React, each \`useWaypoints\` entry carries the same \`composeIntent\`; pass
\`composeText\` to the hook to have the links built for you.

## Build an aturi.to link (universal links)

A universal link is the client-agnostic address of a record: paste an
\`aturi.to/…\` URL anywhere and the recipient gets a preview plus every client
that can open it, rather than being pushed into whichever app you happen to
use. It's just a URL, so no SDK is required. The core package builds it from
anything that names a record, and adds the strings a copy button or a share
sheet needs around it.

\`\`\`ts
import { buildUniversalLink, describeUniversalLink } from '@aturi.to/waypoints';

// An AT URI, a handle, a DID, or a page URL from any client in the catalog.
buildUniversalLink('at://did:plc:abc/app.bsky.feed.post/3k7');
// 'https://aturi.to/profile/did:plc:abc/post/3k7'
buildUniversalLink('https://bsky.app/profile/alice.bsky.social/post/3k7');
// 'https://aturi.to/profile/alice.bsky.social/post/3k7'

const link = describeUniversalLink('at://alice.bsky.social/app.bsky.feed.post/3k7');
link.label;             // 'Post by @alice.bsky.social'
link.share;             // { title, text, url }; hand it to navigator.share()
link.snippets.markdown; // '[Post by @alice.bsky.social](https://aturi.to/…)'
\`\`\`

Options: \`origin\` (point at your own deployment), \`did\` + \`preferDid\`
(address links by DID, which survives a handle change), and \`params\` for
appended query parameters. \`parseUniversalLink\` goes the other way, turning
an aturi.to URL back into an AT URI.

In React, \`<UniversalLinkButton target={post.uri} />\` is the whole control: a
native share sheet in browsers that implement \`navigator.share\`, the clipboard
in the ones that don't. \`useUniversalLink\` is the same logic without markup.

### Make your own pages resolvable

If your app renders atproto records, \`buildUniversalLinkTags\` writes the
\`<head>\` tags that let the rest of the Atmosphere find its way back to them.

\`\`\`ts
import { buildUniversalLinkTags } from '@aturi.to/waypoints';

buildUniversalLinkTags('at://did:plc:abc/app.bsky.feed.post/3k7').html;
// <meta name="at:canonical" content="at://did:plc:abc/app.bsky.feed.post/3k7" />
// <meta name="at:author" content="at://did:plc:abc" />
// <link rel="alternate" href="at://did:plc:abc/app.bsky.feed.post/3k7" />
// <link rel="alternate" type="application/json+oembed" href="https://aturi.to/api/oembed?url=…" />
\`\`\`

\`at:canonical\` is the AT Tags proposal
(https://tangled.org/chrisshank.com/at-tags/). The Aturi extension reads it off
the live page and the Resolve API reads it off your HTML, so a link to your page
resolves into every other client that can open the record, without your app
being in the catalog at all. The oEmbed pointer is emitted for posts, so a link
to your page previews as the post it is. They're static strings describing a
record you already display, and serving them hands nothing to aturi.to.

## License

\`@aturi.to/waypoints\` and \`@aturi.to/waypoints-react\` are MIT © atpotato, LLC.
The aturi.to web app and browser extension are licensed GPL-3.0; the packages
are intentionally dual-licensed MIT so other Atmosphere developers can adopt
them freely.
`;
