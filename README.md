# aturi.to

Universal links for the Atmosphere. Share ATProto content with anyone, let them choose where to view it — and jump between clients yourself, in one click, with the companion browser extension.

## What is aturi.to?

aturi.to is a small ecosystem for navigating the Atmosphere (ATProto) web. It has two halves that share the same waypoint catalog and URI parsers:

- **The web app** at [aturi.to](https://aturi.to) turns any ATProto URI into a universal link. When someone opens an `aturi.to/...` URL, they see every supported app that can render that content (Bluesky, Anisota, Blacksky, Red Dwarf, Leaflet, Tangled, Margin, Grain, PDSls, atp.tools, and many more) and pick the one they prefer.
- **The browser extension** ([`extension/`](extension/)) puts that same catalog in your toolbar. From any supported page, click the icon to open the same content in any other client, or flip on auto-redirect to silently rewrite links between apps before they load.

If aturi.to is "send a link, let them pick the client," the extension is the inverse: "I landed on a link, take me to *my* client."

## Browser extension

The extension is a first-class part of Aturi — for many users it's the primary way they use the project day to day. It's available for Chrome, Firefox, and Safari (via WXT + Xcode's web-extension converter).

### What it does

- **One-click jump.** When you're on a supported site (bsky.app, blacksky.community, leaflet.pub, tangled.org, margin.at, pdsls.dev, atp.tools, and dozens more), click the toolbar icon to see every other Atmosphere waypoint that can render the same post, profile, list, or record. Click one and it opens in a new tab.
- **Auto-redirect.** Flip a switch and links get silently rewritten to your preferred client *before* they load. Pick a favorite per "data family" (Bluesky-style clients, Publications, Tangled, Margin, Grain, Pinkleap, Semble, Streamplace, Popfeed, Sifa, Blento). Powered by `chrome.declarativeNetRequest`, so it's fast and doesn't read your browsing history.
- **Custom waypoints.** Wire up any site that uses a consistent URL structure via templates like `/profile/{handle}` or `/u/{handle}/p/{rkey}`. The extension forward-fills *and* reverse-matches the templates, so custom waypoints are first-class everywhere — popup, auto-redirect, and visibility controls.
- **Visibility & ordering.** Hide waypoints you'll never use, drag-and-drop the rest into the order you want, and the popup surfaces your most-used destinations first.
- **Shared catalog.** The extension imports `@aturi/*` directly from the web app's `src/utils/`, so the waypoint list, URI parsers, and reverse parsers stay in sync between the two.

See [`extension/README.md`](extension/README.md) for development, build, and Safari packaging instructions.

### Supported waypoints

The catalog covers roughly 25+ Atmosphere apps and dev tools across categories like:

- **Bluesky clients** — Bluesky, Anisota, Blacksky, Red Dwarf, Witchsky, Catsky, Deer, and other forks
- **Publications** — Leaflet, Standard Site readers
- **Apps** — Tangled, Margin, Grain, Pinkleap, Semble, Streamplace, Popfeed, Sifa, Blento, Offprint, pckt, Anisota Reader
- **Dev tools** — PDSls, atp.tools, Anisota Explorer

Want to add a new waypoint? Open a PR against [`src/utils/waypoints.data.ts`](src/utils/waypoints.data.ts) — both the web app and the extension pick it up automatically.

## Web app features

- **Universal sharing** — one link works everywhere
- **Platform-agnostic landing page** — recipients choose their preferred client
- **Rich previews** — dynamic OpenGraph images for beautiful social sharing
- **Easy integration** — simple URL structure, no API keys required
- **Handle and DID resolution** — handles, DIDs, and full `at://` URIs all work

### URL structure

Profiles:

```
aturi.to/[handle or did]
```

Example: `aturi.to/alice.bsky.social`

Records (posts, lists, etc.):

```
aturi.to/[handle or did]/[collection]/[rkey]
```

Example: `aturi.to/alice.bsky.social/app.bsky.feed.post/3k7qw...`

## Running locally

### Prerequisites

- Node.js 20.9.0 or higher (use `.nvmrc` with nvm: `nvm use`)

### Web app

```bash
git clone https://github.com/yourusername/aturi-to.git
cd aturi-to
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
  return `https://aturi.to/${uri}`;
}
```

## Tech stack

**Web app**

- **Next.js 16** — App Router with React Server Components
- **TypeScript** — type safety throughout
- **@vercel/og** — dynamic OpenGraph image generation
- **@vercel/analytics** — privacy-focused analytics
- **Tailwind CSS v4** — utility-first styling
- **Framer Motion** — page and component animations

**Extension**

- **WXT** — cross-browser MV3/MV2 build tooling (Chrome, Firefox, Safari)
- **React 19** — popup and options UI
- **`chrome.declarativeNetRequest`** — fast, privacy-preserving auto-redirect
- **`@dnd-kit`** — drag-and-drop ordering of waypoints
- **Vitest** — unit tests for templates, rules, and reverse parsers

## Contributing

This is a community tool for the Atmosphere ecosystem. Contributions are welcome — bugs, new waypoints, popup polish, and extension features all land in the same repo. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Forking & custom domains

Want to run your own instance with a custom domain? aturi.to is designed to be forkable.

```bash
git clone https://github.com/yourusername/aturi-to.git my-custom-instance
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

- [Quick Start Guide](QUICKSTART.md) — get running in 10 minutes
- [Forking Guide](FORKING.md) — detailed customization instructions
- [Contributing Guide](CONTRIBUTING.md) — how to contribute back
- [Extension README](extension/README.md) — extension dev, build, and Safari notes

When forking, please keep your source code open (GPL v3) and credit the original project.

## License

This project is licensed under the GNU General Public License v3.0 or later — see the [LICENSE](LICENSE) file for details.

**GPL v3 ensures:** all forks and modifications must remain open source and credit the original work. When you fork aturi.to, you must share your source code and maintain the same GPL v3 license.

## Acknowledgments

Built for the Atmosphere ecosystem and inspired by the need for universal, platform-agnostic sharing — and for a way to escape link silos in your own browser.
