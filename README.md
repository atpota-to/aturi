# aturi.to

**Tour the Atmosphere.** Travel between clients with the browser extension, share universal Atmosphere links, and explore any account's PDS data.

## What is aturi.to?

aturi.to is a small toolkit for navigating the Atmosphere (the network of apps built on atproto). Three surfaces, one shared waypoint catalog and URI parser:

- **Browser extension** ([`extension/`](extension/)) — jump between Atmosphere clients in one click, or flip on auto-redirect to silently rewrite links to your preferred client before they load.
- **Atmosphere Explorer** ([aturi.to/explore](https://aturi.to/explore)) — browse any account's PDS in your browser: every collection, every record, identity history, audit log, inbound backlinks, and a live view of the firehose.
- **Universal links** ([aturi.to/profile/…](https://aturi.to/)) — share an `aturi.to/...` URL anywhere and the recipient lands on a friendly preview of the record, then picks the Atmosphere client they want to open it in. No login, no client lock-in.

The extension and the web app import the same `src/utils/waypoints.data.ts`, so the catalog of supported clients stays in lockstep across surfaces.

## Browser extension

The extension is a first-class part of Aturi — for many users it's the primary way they use the project day to day. It's available for Chrome, Firefox, and Safari (via WXT + Xcode's web-extension converter).

### What it does

- **One-click jump.** When you're on a supported site (bsky.app, blacksky.community, leaflet.pub, tangled.org, margin.at, pdsls.dev, atp.tools, and dozens more), click the toolbar icon to see every other Atmosphere waypoint that can render the same post, profile, list, or record. Click one and it opens in a new tab.
- **Auto-redirect.** Flip a switch and links get silently rewritten to your preferred client *before* they load. Pick a favorite per "data family" (Bluesky-style clients, Publications, Tangled, Margin, Grain, Pinkleap, Semble, Streamplace, Popfeed, Sifa, Blento). Powered by `chrome.declarativeNetRequest`, so it's fast and doesn't read your browsing history.
- **Inspect mode.** Surface the underlying AT URI, record JSON, PDS, DID, and backlinks for whatever's on screen — without leaving the page you're on.
- **Custom waypoints.** Wire up any site that uses a consistent URL structure via templates like `/profile/{handle}` or `/u/{handle}/p/{rkey}`. The extension forward-fills *and* reverse-matches the templates, so custom waypoints are first-class everywhere — popup, auto-redirect, and visibility controls.
- **Visibility & ordering.** Hide waypoints you'll never use, drag-and-drop the rest into the order you want, and the popup surfaces your most-used destinations first.
- **Shared catalog.** The extension imports waypoints, URI parsers, and reverse parsers directly from the web app's `src/utils/`, so the two stay in sync.

See [`extension/README.md`](extension/README.md) for development, build, and Safari packaging instructions.

## Atmosphere Explorer

Available at [aturi.to/explore](https://aturi.to/explore). A read-mostly window into any atproto repository:

- **PDS → repo → collection → record** drill-down for any handle or DID.
- **Repo at a glance** — record counts, creation date, identity history, audit log, and (where available) cred.blue score for any account.
- **Lexicon hierarchy** with two-level grouping so big repos stay browseable.
- **Inbound backlinks** — see who else's records reference the one you're looking at.
- **Live firehose feed** — a calm, paginated view of the jetstream right on the explore index.
- **Sign in with your atproto handle** to edit your own records inline, sync waypoint preferences across devices, and personalize how every universal link page renders.

## Universal links

Drop an `aturi.to/...` URL anywhere — a DM, a footer, a bio. Visitors land on a friendly preview of the record (post, profile, list, feed, leaflet, tangled repo, grain gallery, margin annotation, or any other supported lexicon) and pick the Atmosphere client they want to read it in.

- **One link, every client.** Every record, profile, and list resolves to the right destination across 25+ curated Atmosphere clients.
- **Platform-agnostic landing page.** Recipients choose — you don't lock them into your client.
- **Rich previews.** Dynamic OpenGraph images so links look great in Messages, Slack, Discord, and Twitter.
- **No login, no API keys.** Just a URL.
- **Handle, DID, or full `at://` URI** all work as input.
- **Signed-in personalization.** Your waypoint visibility and ordering preferences (synced from the extension via your PDS) carry over to every link page.

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

The catalog covers roughly 25+ Atmosphere apps and dev tools across categories like:

- **Bluesky clients** — Bluesky, Anisota, Blacksky, Red Dwarf, Witchsky, Catsky, Deer, and other forks
- **Publications** — Leaflet, Standard Site readers
- **Apps** — Tangled, Margin, Grain, Pinkleap, Semble, Streamplace, Popfeed, Sifa, Blento, Offprint, pckt, Anisota Reader
- **Dev tools** — PDSls, atp.tools

Want to add a new waypoint? Open a PR against [`src/utils/waypoints.data.ts`](src/utils/waypoints.data.ts) — both the web app and the extension pick it up automatically.

## Running locally

### Prerequisites

- Node.js 20.9.0 or higher (use `.nvmrc` with nvm: `nvm use`)

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

## Deployment

The web app is designed for Vercel so the OpenGraph route can use the Edge Runtime:

1. Push your code to GitHub
2. Import the repository in Vercel
3. Deploy

The extension ships as standalone bundles via `npm run zip` / `npm run zip:firefox` (and `xcrun safari-web-extension-converter` for Safari).

## Integration

Want to add aturi.to links to your app? Check out the [Integration Guide](https://aturi.to/integrate) for code examples and best practices.

### Quick example (TypeScript)

```typescript
function toAturiLink(atUri: string): string {
  const uri = atUri.replace('at://', '');
  return `https://aturi.to/profile/${uri}`;
}
```

## Tech stack

**Web app**

- **Next.js 16** — App Router with React Server Components
- **React 19** — Suspense, Server Components, and view transitions
- **TypeScript** — type safety throughout
- **@vercel/og** — dynamic OpenGraph image generation on the Edge Runtime
- **@vercel/analytics** — privacy-focused analytics
- **Tailwind CSS v4** — utility-first styling alongside hand-rolled CSS variables
- **Framer Motion** — page and component animations

**Extension**

- **WXT** — cross-browser MV3/MV2 build tooling (Chrome, Firefox, Safari)
- **React 19** — popup, options, and Inspect UI
- **`chrome.declarativeNetRequest`** — fast, privacy-preserving auto-redirect
- **`@dnd-kit`** — drag-and-drop ordering of waypoints
- **Vitest** — unit tests for templates, rules, and reverse parsers

## Contributing

This is a community tool for the Atmosphere ecosystem. Contributions are welcome — bugs, new waypoints, popup polish, explorer features, and extension features all land in the same repo. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Forking & custom domains

Want to run your own instance with a custom domain? aturi.to is designed to be forkable.

```bash
git clone https://github.com/atpota-to/aturi.git my-custom-instance
cd my-custom-instance
npm run setup-fork

npm install
npm run dev
```

The setup script will help you configure:

- Your custom domain
- Site branding and metadata
- Attribution information
- Environment variables

### More resources

- [Forking Guide](FORKING.md) — detailed customization instructions
- [Contributing Guide](CONTRIBUTING.md) — how to contribute back
- [Extension README](extension/README.md) — extension dev, build, and Safari notes

When forking, please keep your source code open (GPL v3) and credit the original project.

## License

This project is licensed under the GNU General Public License v3.0 or later — see the [LICENSE](LICENSE) file for details.

**GPL v3 ensures:** all forks and modifications must remain open source and credit the original work. When you fork aturi.to, you must share your source code and maintain the same GPL v3 license.

## Acknowledgments

Built for the Atmosphere ecosystem and inspired by the need for universal, platform-agnostic sharing — and for a way to escape link silos in your own browser.
