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

> Add Atmosphere "Open in…" links, smart client recommendations, and AT-URI
> resolution to your own app, with two MIT-licensed packages and a public API.

- Docs: https://aturi.to/docs
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
- **Preferred clients:** \`fetchPreferredClients\`, \`preferredWaypointFor\`,
  \`resolveAtUriForActor\`, \`applyPreferredClients\` — read an account's
  published client preferences and route links accordingly. See below.

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

### 3. Honor the reader's preferred client

Point \`preferFor\` at whoever is about to click the link and the picker reads
their published preferences, pinning the client they chose above everything
else. See "Preferred clients" below.

\`\`\`tsx
<WaypointPicker
  type="post"
  handle="alice.bsky.social"
  collection="app.bsky.feed.post"
  rkey="3k7qw..."
  preferFor={viewerDid}
/>
\`\`\`

### 4. The polished theme (opt-in)

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

## Preferred clients

Right now the ecosystem sends every \`app.bsky.feed.post\` link to bsky.app. That
is a guess about the reader, and for anyone who reads Bluesky in Blacksky, Deer,
or Anisota it is the wrong one — they land somewhere they didn't want to be and
have to re-find the post themselves.

\`to.aturi.actor.preferredClients\` is a public record an account writes to its
own PDS saying where it wants records opened: "Bluesky posts in Blacksky,
Tangled records in Tangled, everything else in PDSls." If your app links out to
Atmosphere records and knows who it is linking on behalf of, read that record and
honor it.

\`\`\`ts
import { fetchPreferredClients, preferredWaypointFor } from '@aturi.to/waypoints';

// One public read — no auth, no API key. Handle or DID.
const record = await fetchPreferredClients(viewerHandleOrDid);

const choice = preferredWaypointFor(record, {
  type: 'post',
  handle: 'alice.bsky.social',
  collection: 'app.bsky.feed.post',
  rkey: '3k7qw...',
});

const href = choice?.url ?? myExistingDefault;
\`\`\`

Most accounts have published nothing, so \`null\` is the common answer and never
an error — fall back to whatever you do today. Or do both steps at once:

\`\`\`ts
import { resolveAtUriForActor } from '@aturi.to/waypoints';

const result = await resolveAtUriForActor(atUri, viewerHandleOrDid);
result?.preferred;         // { client, waypointId, url, scope } | null
result?.recommended.ids;   // their choices lifted to the front
\`\`\`

### The record

\`\`\`jsonc
{
  "$type": "to.aturi.actor.preferredClients",
  "preferences": [
    {
      "scope": "app.bsky.feed.post",
      "clients": [{ "id": "blacksky", "name": "Blacksky" }]
    },
    { "scope": "sh.tangled.*", "clients": [{ "id": "tangled", "name": "Tangled" }] },
    { "scope": "*", "clients": [{ "id": "pdsls", "name": "PDSls" }] }
  ],
  "createdAt": "2026-08-07T17:04:11.000Z"
}
\`\`\`

A \`scope\` is a collection NSID (\`app.bsky.feed.post\`), a namespace wildcard
(\`sh.tangled.*\`), a record kind (\`post\`, \`profile\`, \`list\`, \`record\`), or \`*\`.
The most specific match wins, regardless of array order. \`clients\` is ordered
most-preferred-first; use the first entry you can build a link for. A client
outside the Aturi catalog can carry its own URL templates
(\`{handle}\`, \`{did}\`, \`{actor}\`, \`{collection}\`, \`{rkey}\`), so a self-hosted
deploy still produces a working link in an app that has never heard of it.

Schema: https://aturi.to/lexicons/to.aturi.actor.preferredClients.json

Aturi users publish this from Settings → Clients
(https://aturi.to/account#clients).

## Resolve API

Don't want to install anything? Hit the hosted endpoint from a share sheet, an
Apple Shortcut, or any client: no login, no API keys. It returns the resolved
waypoints and recommendations for a page URL or an AT URI.

\`\`\`http
GET https://aturi.to/api/resolve?url=<encoded-page-url>
GET https://aturi.to/api/resolve?atUri=at://...
GET https://aturi.to/api/resolve?atUri=at://...&actor=<handle-or-did>
\`\`\`

Add \`actor\` and the endpoint applies that account's published preferred
clients for you: their choices lift to the front of \`recommended.ids\` and the
winning destination comes back as \`preferred\`. That's the whole integration —
one query parameter, and your links go where the reader asked.

The core package's \`resolveViaApi()\` is a typed client for this endpoint. It's
the right choice from a browser, where fetching arbitrary pages is blocked by
CORS.

## Build an aturi.to link (universal links)

Universal links need no SDK at all: just rewrite an AT URI into an
\`aturi.to/profile/…\` URL and the recipient picks their client on a friendly
landing page.

\`\`\`ts
function toAturiLink(atUri: string): string {
  const uri = atUri.replace('at://', '');
  return \`https://aturi.to/profile/\${uri}\`;
}
\`\`\`

## License

\`@aturi.to/waypoints\` and \`@aturi.to/waypoints-react\` are MIT © atpotato, LLC.
The aturi.to web app and browser extension are licensed GPL-3.0; the packages
are intentionally dual-licensed MIT so other Atmosphere developers can adopt
them freely.
`;
