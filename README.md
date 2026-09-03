# aturi.to

**Tour the Atmosphere.** Switch clients, share universal links, discover lexicons, detect URIs, browse any PDS, point an AI agent at the network, add Waypoints to any app.

## What is aturi.to?

aturi.to is a toolkit for navigating the Atmosphere (the network of apps built on atproto). Five surfaces, one shared waypoint catalog and URI parser:

- **Browser extension** ([`extension/`](extension/)): jump between Atmosphere clients in one click, auto-redirect every Atmosphere link to your preferred client before it loads, and inspect the AT URI under any page.
- **Atmosphere Explorer** ([aturi.to/explore](https://aturi.to/explore)). Browse any account's PDS: every collection, every record, identity history, audit log, inbound backlinks, trending lexicons, and a live view of the firehose. Sign in to edit your own records.
- **Universal links** ([aturi.to/profile/…](https://aturi.to/)): drop an `aturi.to/...` URL anywhere and the recipient lands on a friendly preview of the record, then picks the Atmosphere client they want to open it in. No login, no client lock-in.
- **Waypoints packages** ([`@aturi.to/waypoints`](packages/waypoints/README.md)): the same catalog, link builders, and URI resolution the other three surfaces run on, published as a zero-dependency npm package, with a headless React picker UI in [`@aturi.to/waypoints-react`](packages/waypoints-react/README.md). MIT-licensed, so you can add waypoints to your own app.
- **Atmosphere MCP** ([aturi.to/mcp](https://aturi.to/mcp)): a hosted Model Context Protocol server, currently in beta. Add one URL to Claude, Cursor, or any MCP client and an AI agent can resolve any Atmosphere link, read any repository, trace backlinks across every app, and sample Jetstream, the live event stream. Keyless and read-only.

Plus a **[feedback board](#feedback-board)** at [aturi.to/feedback](https://aturi.to/feedback), built on the userinput.app lexicons: post a bug or an idea, vote on someone else's, and every record lands in your own repo.

The extension and the web app import the same `src/utils/waypoints.data.ts`, so the catalog of supported clients stays in lockstep across surfaces. See the [developer docs](https://aturi.to/docs) for the packages.

## Browser extension

The extension is a core part of Aturi: for many users it's the primary way they use the project day to day. Available for Chrome, Firefox, and Safari (via WXT + Xcode's web-extension converter).

### What it does

- **One-click jump.** Land on a Bluesky post and want to read it in Anisota? Click the leaf in your toolbar. The popup detects the AT URI on the page and offers every other Atmosphere waypoint that can render it: every other Bluesky fork, plus Leaflet, Tangled, Margin, Grain, and the rest. Click one and it opens in a new tab.
- **Auto-redirect.** Flip a switch and links get silently rewritten to your preferred client *before* they load. Pick a favorite per data family (Bluesky-style clients, Publications, Tangled, Margin, Grain, Pinkleap, Semble, Streamplace, Popfeed, Sifa, Blento). Powered by `chrome.declarativeNetRequest`, so it's fast and doesn't read your browsing history. It stands down when the tab is already showing one of the apps involved, so editing the address bar back to the original site sticks instead of bouncing you straight back, and the popup can pause it for one tab or turn it off everywhere.
- **Inspect mode.** Open the Inspect tab to see the underlying AT URI for whatever's on screen: the DID behind the handle, its PDS, the lexicon collection, the record JSON, and the inbound backlinks count from [Constellation](https://constellation.microcosm.blue). Tap any field to copy it, or jump straight into the Atmosphere Explorer for the raw record. When a page declares its records with [AT Tags](https://tangled.org/chrisshank.com/at-tags/) (`<meta name="at:canonical">` and friends), the extension reads them first and labels each hit with its relationship (canonical, author, and so on), falling back to scanning links, meta tags, and page text.
- **Custom waypoints.** Wire up any site that uses a consistent URL structure via templates like `/profile/{handle}` or `/u/{handle}/p/{rkey}`. Templates work in both directions: the extension generates outbound links *and* reverse-matches inbound ones, so custom waypoints are fully supported in the popup, auto-redirect, and visibility controls.
- **Visibility, groups & ordering.** Hide waypoints you'll never use, group the rest however you like, drag-and-drop to reorder, and the popup surfaces your most-used destinations first.
- **Local-first.** No account, no telemetry, no background network calls. The extension only talks to public atproto services when you open the popup or hit Inspect. Preferences live in your browser's local storage. See [`extension/PRIVACY.txt`](extension/PRIVACY.txt) or [aturi.to/extension/privacy](https://aturi.to/extension/privacy).
- **Shared catalog.** Imports waypoints, URI parsers, and reverse parsers directly from the web app's `src/utils/`, so the two stay in sync.

See [`extension/README.md`](extension/README.md) for development, build, and Safari packaging instructions.

## Atmosphere Explorer

Available at [aturi.to/explore](https://aturi.to/explore). A read-mostly window into any atproto repository, and a record editor for your own:

- **Browse any repository.** Drill from PDS → repo → collection → record for any handle or DID, with collapsible group nav and a search box that autocompletes from your own repo's collections when signed in.
- **Repo at a glance.** Record counts, creation date, identity history, PLC audit log, and (where available) cred.blue score for any account.
- **Inbound backlinks.** See who else's records reference the one you're looking at, via the Constellation backlink index.
- **Live firehose feed.** A calm, paginated view of the Jetstream right on the explore index, with creates/updates/deletes and rolling stats.
- **Trending lexicons.** A live leaderboard of which atproto lexicons are seeing the most activity, sorted by mutations, events, repos, or PDS hosts.
- **Record editor.** Sign in and edit any record in your own repo inline: schema-aware form for known lexicons, raw JSON for everything else.
- **Pinning & customization.** Pin the lexicons you care about, name and reorder waypoint groups, add custom waypoints, all synced to a record in your own PDS so they follow you across browsers.

### Sign in with atproto

Authentication uses standard atproto OAuth: no passwords, no Aturi-side account database. The sign-in flow shows a granular permissions picker so you can grant only the scopes you want (create / update / delete records / upload blobs), and access tokens are DPoP-bound and stored only in your browser. Reads of your own repo are always allowed.

Your personalization (waypoint groups, ordering, pins, custom waypoints, color scheme) is written to a `to.aturi.actor.preferences/self` record in your own PDS, so it migrates with you if you move servers.

## Atmosphere MCP

Available at [aturi.to/mcp](https://aturi.to/mcp), with the endpoint at `https://aturi.to/api/mcp`. **In beta.**

The Atmosphere Explorer, as tools an agent can call. Add the URL to Claude, Cursor, or any client that speaks Streamable HTTP, and ask questions in plain language:

- *"What has this account been posting about, and which post got the most engagement?"*
- *"Who links to this post, anywhere on the network?"*
- *"What apps does this account actually use, and when did it change servers?"*
- *"Which lexicons are busiest today, and what do their records look like?"*
- *"Show me `com.whtwnd.blog.entry` records as people publish them."*

Thirty-eight tools across nine groups: link resolution and the client catalog, identity and PLC history, whole-repository reads on any PDS, network-wide backlinks via Constellation, the Bluesky social layer (feeds, threads, graph, engagement, trends), custom feeds and lists, lexicon activity via UFOs, a bounded live tap on Jetstream, and the protocol documentation itself, searched from atproto.com, docs.bsky.app and bsky.network so an agent can answer "how does this work" with a citation instead of from memory. Every answer carries the `at://` URI and an aturi.to link, so anything an agent mentions is one click from opening in whichever client you use.

### Before you rely on it

- It reads. No tool can post, like, follow, or edit anything, and the server holds no credentials that could. Write access is planned as a separate package you would run on your own machine with your own keys.
- Beta means tool names and result shapes can still change. Nothing should pin to them yet.
- Answers come from live public services: Bluesky's AppView, plc.directory, Jetstream, and microcosm's Constellation, Slingshot and UFOs. When one is down or rate-limiting, the tool says so rather than guessing.
- Bluesky's post search refuses requests from data-centre networks, so `search_posts` can fail where every other tool works.
- Posts and records are written by strangers. Treat what comes back as data to read, not as instructions to follow.
- There is no uptime promise and no support queue.

No API key, no account, and nothing to install. The [OpenAPI](https://aturi.to/openapi.json) REST endpoints remain the right interface for code; MCP is for interactive agents. Both wrap the same resolution core, so neither drifts from the other.


## Universal links

Drop an `aturi.to/...` URL anywhere: a DM, a footer, a bio. Visitors land on a friendly preview of the record (post, profile, list, feed, leaflet, tangled repo, grain gallery, margin annotation, or any other supported lexicon) and pick the Atmosphere client they want to read it in.

- **One link, every client.** Every record, profile, and list resolves cleanly across 25+ curated Atmosphere clients.
- **A friendly landing page.** Recipients see a clean preview with a recommended client pinned at the top and every alternative below. They read the record, choose where to open it, and skip apps they don't use.
- **Rich previews.** Dynamic OpenGraph images so links look great in Messages, Slack, Discord, and Twitter. Real, indexable URLs that link unfurlers can read.
- **Smart preferences.** Sign in and the picker reorders for you: your favorite client per record type lifts to the top, hidden waypoints disappear, and your custom ones show up alongside the built-ins.
- **No login, no API keys.** Handles, DIDs, and full `at://` URIs all work as input.

### URL structure

Profiles:

```
aturi.to/profile/[handle or did]
```

Example: `aturi.to/profile/aturi.to`

Records (posts, lists, feeds, etc.):

```
aturi.to/profile/[handle or did]/[collection]/[rkey]
```

Example: `aturi.to/profile/alice.bsky.social/app.bsky.feed.post/3k7qw...`

Posts also have a friendly alias: `aturi.to/profile/[handle]/post/[rkey]`. The bare-path forms (without `/profile/`) still resolve for backwards compatibility, but new links should prefer the canonical `/profile/` form.

### Supported waypoints

The catalog covers 25+ Atmosphere apps and dev tools across categories like:

- **Bluesky clients**: Bluesky, Anisota, Bluepy, Red Dwarf, Impro, Lea, plus forks like Blacksky, Witchsky, Mu, Deer, and Northsky
- **Publications**: Leaflet, Standard Reader, Anisota Reader, Offprint, pckt
- **Apps**: Aturi, Tangled, Margin, Grain, Pinkleap, Semble, Streamplace, Popfeed, Sifa, Blento
- **Dev tools**: Aturi Explore, PDSls, atp.tools, Taproot

Building an Atmosphere client or tool and want it added? The quickest route is to [open a waypoint request](https://github.com/atpota-to/aturi/issues/new?template=add-waypoint.yml) with your URL patterns and lexicon NSIDs, or email [aturi@atpota.to](mailto:aturi@atpota.to) or DM [@aturi.to](https://bsky.app/profile/aturi.to) on Bluesky, and it can be added for you.

To send a PR instead, follow [the waypoint walkthrough in CONTRIBUTING.md](CONTRIBUTING.md#adding-a-waypoint). It is four edits rather than one: the entry in [`src/utils/waypoints.data.ts`](src/utils/waypoints.data.ts), the id in `WAYPOINT_ORDER`, an icon, and a `npm run sync` so the published packages stay in step. Once merged, the web app and the extension both pick it up.

## Feedback board

Available at [aturi.to/feedback](https://aturi.to/feedback). Bugs, feature requests and ideas, posted and voted on by whoever shows up:

- **Post, reply, vote.** Sign in with atproto and file feedback under a category, thread replies on anything, and up/downvote what matters to you.
- **Statuses that stick.** The team marks discussions `planned`, `in-progress`, `implemented`, `declined` and so on, optionally with a note explaining the call.
- **Sort and filter.** By score, recency or reply volume; narrow to a status or a category.
- **Nothing stored here.** Every post, reply and vote is a record in *your* repo — delete it and it's gone network-wide, take it with you if you move servers.

### How it works

The board speaks the [userinput.app](https://userinput.app) lexicon family (`app.userinput.*`, browsable in the explorer at [`/explore/userinput.app/com.atproto.lexicon.schema`](https://aturi.to/explore/userinput.app/com.atproto.lexicon.schema)). There is no AppView and no aturi.to database: a *space* is one record in its owner's repo, and everything else is a record in the acting user's repo pointing back at it. That leaves two questions to answer at read time, and one service for each:

- **[Constellation](https://constellation.microcosm.blue)** answers *what links here* — turning a space URI into every discussion filed into it, and a discussion URI into its vote, reply and edit tallies.
- **[Slingshot](https://slingshot.microcosm.blue)** answers *what is this record* — hydrating those coordinates through an edge cache, so the browser makes one request per record instead of resolving each author's DID and then asking their PDS.

Authority is checked when reading, not writing. Anyone can publish a record claiming a discussion is `implemented`; it only counts if its author is the space owner or holds a role the owner granted, and the same filter governs pins, hides, locks and bans. Edits never mutate the original — they're sidecar records, so the newest one from the author is the live text and the whole set is the revision history.

### Configuring it for a fork

The board renders one `app.userinput.space` record; point it at yours in `.env.local`:

```sh
NEXT_PUBLIC_FEEDBACK_OWNER=yourhandle.example      # repo to find the space in
# NEXT_PUBLIC_FEEDBACK_SPACE_URI=at://did:plc:.../app.userinput.space/3l...  # or pin one exactly
```

If that account has no space yet, `/feedback` shows a setup panel instead of an empty board — sign in as the owner and create one in a click. Discovery scans the owner's repo, so it's picked up on the next load without a redeploy.

## Running locally

### Prerequisites

- Node.js 22 or higher (the exact pinned version is in `.nvmrc`: `nvm use`)

### Repo layout

Four codebases share this repository:

| Path | What it is |
| --- | --- |
| `src/` | The Next.js web app: universal links, Atmosphere Explorer, OG images, Resolve API |
| `extension/` | The browser extension (Chrome, Firefox, Safari) |
| `packages/waypoints` | Published `@aturi.to/waypoints`, MIT |
| `packages/waypoints-react` | Published `@aturi.to/waypoints-react`, MIT |

The extension imports the app's `src/utils/**` directly. The packages ship generated copies of those files so they can build without Next.js, kept honest by a drift guard in CI. `src/` is canonical for both. See [CONTRIBUTING.md](CONTRIBUTING.md#repo-map).

### Web app

```bash
git clone https://github.com/atpota-to/aturi.git
cd aturi
nvm use
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

### Browser extension

```bash
cd extension
npm install
npm run dev            # Chrome (loads the extension into a fresh Chromium profile)
npm run dev:firefox    # Firefox
```

WXT hot-reloads on changes. For release builds and Safari packaging, see [`extension/README.md`](extension/README.md).

### Verifying a change

The same commands CI runs, in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Run the ones that touch what you changed:

```bash
npm run lint && npm run typecheck && npm run build          # web app
cd extension && npm run compile && npm test                 # extension
cd packages && npm run sync:check && npm test && npm run build   # packages
```

If you edited a canonical file under `src/utils/` that the packages copy, run `cd packages && npm run sync` and commit the regenerated copies, or `sync:check` will fail.

## Deployment

The web app is designed for Vercel so the OpenGraph route can use the Edge Runtime:

1. Push your code to GitHub
2. Import the repository in Vercel
3. Deploy

The extension ships as standalone bundles via `npm run zip` / `npm run zip:firefox` (and `xcrun safari-web-extension-converter` for Safari).

## Integration

Want to add aturi.to links (or the whole waypoint picker) to your app? Here's how. For the full guide, see the **[developer docs](https://aturi.to/docs)**.

### Packages

The waypoint catalog, link builders, recommendations, and URI resolution that power aturi.to are published as two standalone npm packages, dual-licensed **MIT** (the app itself is GPL-3.0) so other Atmosphere developers can build on them freely:

- **[`@aturi.to/waypoints`](packages/waypoints/README.md)**: zero-dependency, framework-agnostic core. Works in the browser, Node 18+, and edge runtimes.

  ```sh
  npm install @aturi.to/waypoints
  ```

  ```ts
  import { resolveAtUri } from '@aturi.to/waypoints';

  const result = resolveAtUri('at://did:plc:abc/app.bsky.feed.post/3k7');
  result?.waypoints;   // [{ id: 'anisota', name: 'Anisota', category, url }, ...]
  result?.recommended; // { ids: ['bluesky', 'anisota', ...], label: 'Recommended for Posts' }
  ```

- **[`@aturi.to/waypoints-react`](packages/waypoints-react/README.md)**: a headless-first React picker UI + client icons, built on the core. Ships zero CSS by default and is fully themeable.

  ```sh
  npm install @aturi.to/waypoints-react react react-dom lucide-react
  ```

  ```tsx
  import { WaypointPicker } from '@aturi.to/waypoints-react';

  <WaypointPicker type="post" handle="alice.bsky.social" collection="app.bsky.feed.post" rkey="3k7qw..." />;
  ```

Every release also mirrors both packages to [GitHub Packages](https://github.com/atpota-to/aturi/packages) as `@atpota-to/waypoints` and `@atpota-to/waypoints-react`. The scope differs because GitHub only accepts one matching the repository owner, and it rejects the dot in `aturi.to`. npm stays the primary registry; the mirror is for orgs that install from GitHub. It requires a token even for public packages, so consumers need an `.npmrc`:

```sh
@atpota-to:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}   # PAT with read:packages
```

```sh
npm install @atpota-to/waypoints-react
```

The mirrored React package still depends on `@aturi.to/waypoints` from npm: its bundle re-exports that exact specifier, and npm resolves it without a token.

### Quick example (TypeScript)

```typescript
function toAturiLink(atUri: string): string {
  const uri = atUri.replace('at://', '');
  return `https://aturi.to/profile/${uri}`;
}
```

Or use the public Resolve API to look up the waypoints for an arbitrary page URL or AT URI from a share sheet, Apple Shortcut, or any other client:

```
GET https://aturi.to/api/resolve?url=<encoded-page-url>
GET https://aturi.to/api/resolve?atUri=at://...
```

To ask about the catalog itself instead of a single record — what's in it, and which clients can do what — there's a companion endpoint:

```
GET https://aturi.to/api/waypoints
GET https://aturi.to/api/waypoints?type=post&capability=compose
```

### Compose intents

Clients that inherit Bluesky's [intent links](https://docs.bsky.app/docs/advanced-guides/intent-links) can be handed a URL that opens their composer pre-filled. The catalog tracks which ones do, so every waypoint — in the packages, in both API endpoints, and in the React hook — carries a `composeIntent` (`null` when the client has no confirmed route):

```ts
import { getComposeIntentUrl, WAYPOINT_DESTINATIONS_DATA } from '@aturi.to/waypoints';

getComposeIntentUrl(WAYPOINT_DESTINATIONS_DATA.deer, 'hello from my app');
// 'https://deer.social/intent/compose?text=hello%20from%20my%20app'
```

Watch `prefillsText`: one client routes the intent but ignores the text, so the link opens an empty composer. Maintain a client that handles compose intents and isn't listed? Open an issue and we'll add it.

## Tech stack

**Web app**

- **Next.js 16**: App Router with React Server Components
- **React 19**: Suspense, Server Components, and view transitions
- **TypeScript**: type safety throughout
- **`@atproto/oauth-client-browser`**: DPoP-bound, granular-scope OAuth sign-in entirely in the browser
- **`@vercel/og`**: dynamic OpenGraph image generation on the Edge Runtime
- **`@vercel/analytics`**: privacy-focused, cookieless analytics
- **Constellation & Slingshot**: microcosm's backlink index and record cache, which the feedback board reads instead of an AppView
- **`mcp-handler` + `@modelcontextprotocol/server`**: the Atmosphere MCP endpoint, served from a single Next.js route handler
- **Tailwind CSS v4**: utility-first styling alongside hand-rolled CSS variables
- **Framer Motion**: page and component animations

**Extension**

- **WXT**: cross-browser MV3/MV2 build tooling (Chrome, Firefox, Safari)
- **React 19** (Preact-aliased in the bundle): popup, options, and Inspect UI
- **`chrome.declarativeNetRequest`**: fast, privacy-preserving auto-redirect
- **`@dnd-kit`**: drag-and-drop ordering of waypoints
- **Vitest**: unit tests for templates, rules, and reverse parsers

## Contributing

This is a community tool for the Atmosphere ecosystem. Bugs, new waypoints, popup polish, explorer features, and extension work all land in the same repo. Start with [CONTRIBUTING.md](CONTRIBUTING.md): it covers the repo layout, the checks CI runs, and the four-step walkthrough for adding a waypoint.

Coding agents are welcome, and much of this repository was written with one. If you are using an agent, point it at [AGENTS.md](AGENTS.md) and read the [AI-assisted contributions](CONTRIBUTING.md#ai-assisted-contributions) section first. The short version: disclose it, run the result rather than only the tests, keep the diff to what was asked, and verify URL patterns and NSIDs against the live app instead of trusting the model. There is one maintainer here, so a PR nobody has read costs more to review than it took to generate.

Found a security issue? Report it privately. See [SECURITY.md](SECURITY.md).

## More resources

- [Developer docs](https://aturi.to/docs): integrate the waypoint packages and the Resolve API into your own app
- [Atmosphere MCP](https://aturi.to/mcp): the MCP server's tool list and per-client setup (Markdown at [/mcp.md](https://aturi.to/mcp.md))
- [`@aturi.to/waypoints`](packages/waypoints/README.md) & [`@aturi.to/waypoints-react`](packages/waypoints-react/README.md): the published package READMEs
- [Contributing Guide](CONTRIBUTING.md): how to contribute back
- [AGENTS.md](AGENTS.md): repository instructions for coding agents
- [Security Policy](SECURITY.md): what's in scope and how to report privately
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Extension README](extension/README.md): extension dev, build, and Safari notes
- [Terms & Privacy Policy](https://aturi.to/terms): what we collect, how the third-party services we depend on fit in
- [Extension Privacy Policy](https://aturi.to/extension/privacy): what the extension stores, what it reads, and what it sends where

## License

This project is licensed under the GNU General Public License v3.0 or later. See the [LICENSE](LICENSE) file for details.

**GPL v3 ensures:** all forks and modifications must remain open source and credit the original work. When you fork aturi.to, you must share your source code and maintain the same GPL v3 license.

**The published packages are MIT.** The two libraries under [`packages/`](packages/) ([`@aturi.to/waypoints`](packages/waypoints/LICENSE) and [`@aturi.to/waypoints-react`](packages/waypoints-react/LICENSE)) are dual-licensed MIT by the copyright holder so other Atmosphere developers can adopt them without the GPL's copyleft obligations.

## Acknowledgments

Built for the Atmosphere ecosystem and inspired by the need for universal, platform-agnostic sharing, and for a way to escape link silos in your own browser.
