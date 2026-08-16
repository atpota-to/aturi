// Single source of truth for the Markdown version of the developer docs.
//
// Consumed by:
//   - CopyMarkdownButton (the "Copy as Markdown" button in the docs header)
//   - /docs.md (a plain-text route handler agents can fetch directly)
//
// Keep this in sync with src/app/docs/page.tsx. It deliberately mirrors the
// page's prose and code blocks so an LLM or coding agent gets the full context
// in one paste — install commands, examples, API shape, and links included.
// Section order and heading text match the page's TOC one for one.
//
// Note: this is a template literal, so backticks (code fences / inline code)
// are escaped as \` and a literal ${ in the nested example is escaped as \${.

export const DOCS_MARKDOWN = `# aturi.to: Developer Docs

> Add Atmosphere "Open in…" links, per-type client recommendations, compose
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
- **@aturi.to/waypoints-react**: the React picker UI and the client icons,
  built on the core.

## @aturi.to/waypoints

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
  \`getComposeIntentWaypoints\`. See "Compose intents" below.
- **Universal links:** \`buildUniversalLink\`, \`parseUniversalLink\`,
  \`describeUniversalLink\`, \`buildUniversalLinkTags\`. See "Build an
  aturi.to link" below.

A handful of destinations (pdsls, atp.tools, Margin, Grain, Popfeed) only
produce useful URLs when a DID is known; they're filtered out unless a DID is
available, so pass one in or supply a \`resolveHandle\` to \`resolveUrl\`. Full
reference in the package README:
https://github.com/atpota-to/aturi/blob/main/packages/waypoints/README.md

## @aturi.to/waypoints-react

A drop-in React "Open in…" picker. It re-exports the entire core, so a single
install gives you the components and the resolvers.

\`\`\`bash
npm install @aturi.to/waypoints-react
# peers (you almost certainly already have react/react-dom):
npm install react react-dom lucide-react
\`\`\`

### 1. Drop-in picker

Every element carries a \`data-aturi-wp\` attribute and an \`aturi-wp-*\`
class; map your own via \`classNames\`, pass \`unstyled\` to drop the built-ins,
or replace rows with the \`renderWaypoint\` prop.

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

The hook returns render-ready data plus \`copy\` / \`open\` helpers, and renders
nothing.

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

### 3. The stylesheet (opt-in)

Import the stylesheet once to get the Aturi look without writing CSS. The
package ships zero CSS otherwise; the sheet targets the namespaced classes and
is themeable through \`--aturi-wp-*\` custom properties, with light and dark
defaults.

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

A companion endpoint answers questions about the catalog itself rather than a
specific record: what is in it, and which clients can do what. See the
Waypoints API below.

## Waypoints API

\`GET /api/waypoints\` returns the catalog itself, with no record to resolve
first. Same terms as the Resolve API: no login, no keys, CORS open to any
origin, responses cached for an hour.

\`\`\`http
GET https://aturi.to/api/waypoints
GET https://aturi.to/api/waypoints?type=post
GET https://aturi.to/api/waypoints?capability=compose
GET https://aturi.to/api/waypoints?capability=compose&text=<encoded-text>
\`\`\`

- \`type\` takes \`post\`, \`profile\`, \`list\`, \`record\`, or \`unknown\`,
  and keeps the clients that render that type.
- \`capability\` takes one value today, \`compose\`, and keeps the clients with
  a compose intent route.
- \`text\` pre-fills the compose intent links in the response, so you get
  finished URLs back instead of templates.

An unknown \`type\` or \`capability\` is a 400 rather than an empty list. The
response carries \`ok\`, the \`filters\` it applied, a \`count\`, and the
\`waypoints\` array; each entry has its id, name, description, category,
supported types, its \`expectedCollections\` where the catalog records them,
and its \`composeIntent\` or \`null\`.

## Compose intents

bsky.app can be handed a link that opens its composer pre-filled:
\`/intent/compose?text=…\` (see
https://docs.bsky.app/docs/advanced-guides/intent-links). Clients forked from
the official social app inherit the same route, so the catalog records which
ones do. Every waypoint carries a \`composeIntent\`, \`null\` when the client has
no confirmed route.

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

Two fields to read off the data rather than assume. \`prefillsText\` is
\`false\` for a client that routes the intent but ignores the text, so a "share
this" link would open an empty composer: fine as a jump, useless as a share.
And \`appUrl\` appears only where the client publishes a native scheme, so it's
a bonus, not a fallback.

Over HTTP, pass the text and the links come back built: \`text\` on the
Waypoints API, \`composeText\` on any resolve call. Or take \`urlTemplate\` and
substitute the URL-encoded text for \`{text}\` yourself.

\`\`\`http
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

## Build an aturi.to link

A universal link is the client-agnostic address of a record. It's just a URL,
so no SDK is required. The core package builds it from anything that names a
record, and adds the strings a copy button or a share sheet needs around it.

\`\`\`ts
import {
  buildUniversalLink,
  describeUniversalLink,
} from '@aturi.to/waypoints';

// Anything that names a record: an AT URI, a handle, a DID, or a page URL
// from any client in the catalog.
buildUniversalLink('at://did:plc:abc/app.bsky.feed.post/3k7');
// 'https://aturi.to/profile/did:plc:abc/post/3k7'
buildUniversalLink('https://bsky.app/profile/alice.bsky.social/post/3k7');
// 'https://aturi.to/profile/alice.bsky.social/post/3k7'

// Everything a copy button or a share sheet needs:
const link = describeUniversalLink('at://alice.bsky.social/app.bsky.feed.post/3k7');
link.label;             // 'Post by @alice.bsky.social'
link.share;             // { title, text, url }; hand it to navigator.share()
link.snippets.markdown; // '[Post by @alice.bsky.social](https://aturi.to/…)'
\`\`\`

Three options change what comes out: \`origin\` points the link at your own
deployment, \`did\` plus \`preferDid\` address it by DID so a handle change
doesn't break it, and \`params\` appends query parameters.

\`parseUniversalLink\` goes the other way, turning an aturi.to URL back into an
AT URI. In React, \`<UniversalLinkButton>\` is the whole control: a native share
sheet in browsers that implement \`navigator.share\`, the clipboard in the ones
that don't. \`useUniversalLink\` is the same logic without markup.

\`\`\`tsx
import { UniversalLinkButton } from '@aturi.to/waypoints-react';

// Native share sheet on phones, clipboard everywhere else.
<UniversalLinkButton target={post.uri} />
\`\`\`

### URL shapes

What \`buildUniversalLink\` emits, where \`{id}\` is whichever of the handle or
the DID it was given:

- \`/profile/{id}\` for a profile or a bare identity.
- \`/profile/{id}/post/{rkey}\` for \`app.bsky.feed.post\`.
- \`/profile/{id}/lists/{rkey}\` for \`app.bsky.graph.list\`.
- \`/profile/{did}/{collection}/{rkey}\` for every other collection, falling
  back to the handle when no DID is known.

\`parseUniversalLink\` reads those back, plus three more shapes the site serves:
the explorer's \`/explore/{id}/{collection}/{rkey}\` record views, the legacy
bare path \`aturi.to/{handle}/{collection}/{rkey}\` without the \`/profile\`
prefix, and an AT URI sitting in the path (\`aturi.to/at://…\`).

### Make your own pages resolvable

If your app renders atproto records, \`buildUniversalLinkTags\` writes the
\`at:canonical\`, \`at:author\` and \`alternate\` \`<head>\` tags for the record.

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

## Preferences and storage

On aturi.to, a signed-in visitor's picker preferences are written to their own
repo as a \`to.aturi.actor.preferences/self\` record, with a localStorage copy
(\`aturi.prefs.v1\`) behind it for anonymous use and for when the PDS isn't
reachable. The record is what loads on the next device that account signs in
to, and because it lives in the user's repo it travels with the account rather
than with aturi.to.

The browser extension keeps its own copy in extension storage:
\`chrome.storage.sync\` first, falling back to \`chrome.storage.local\` when the
sync quota is hit. Auto-redirect is off by default, and the favorite client is
stored per compatibility group rather than per lexicon, so Bluesky clients,
publications and Tangled each get their own destination. Turning auto-redirect
off leaves the popup working. Groups double as the popup's visibility list: a
waypoint that is in no group doesn't appear.

## License and catalog

@aturi.to/waypoints and @aturi.to/waypoints-react are MIT © atpotato, LLC. The
aturi.to web app and browser extension are licensed GPL-3.0. To get an
Atmosphere client into the catalog, see the supported waypoints at
https://aturi.to/links and open a PR.
`;
