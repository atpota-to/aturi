# aturi.to

**Tour the Atmosphere.** Switch clients, share universal links, browse any PDS.

## What is aturi.to?

aturi.to is a toolkit for navigating the Atmosphere (the network of apps built on atproto). Three surfaces, one shared waypoint catalog and URI parser:

- **Browser extension** ([`extension/`](extension/)): jump between Atmosphere clients in one click, auto-redirect every Atmosphere link to your preferred client before it loads, and inspect the AT URI under any page.
- **Atmosphere Explorer** ([aturi.to/explore](https://aturi.to/explore)). Browse any account's PDS: every collection, every record, identity history, audit log, inbound backlinks, trending lexicons, and a live view of the firehose. Sign in to edit your own records.
- **Universal links** ([aturi.to/profile/…](https://aturi.to/)): drop an `aturi.to/...` URL anywhere and the recipient lands on a friendly preview of the record, then picks the Atmosphere client they want to open it in. No login, no client lock-in.

Plus a **[feedback board](#feedback-board)** at [aturi.to/feedback](https://aturi.to/feedback), built on the userinput.app lexicons: post a bug or an idea, vote on someone else's, and every record lands in your own repo.

The extension and the web app import the same `src/utils/waypoints.data.ts`, so the catalog of supported clients stays in lockstep across surfaces. That same catalog and resolver logic is also published as the MIT-licensed [`@aturi.to/waypoints`](packages/waypoints/README.md) packages, so you can build on it in your own app. See the [developer docs](https://aturi.to/docs).

## Browser extension

The extension is a core part of Aturi: for many users it's the primary way they use the project day to day. Available for Chrome, Firefox, and Safari (via WXT + Xcode's web-extension converter).

### What it does

- **One-click jump.** Land on a Bluesky post and want to read it in Anisota? Click the leaf in your toolbar. The popup detects the AT URI on the page and offers every other Atmosphere waypoint that can render it: every other Bluesky fork, plus Leaflet, Tangled, Margin, Grain, and the rest. Click one and it opens in a new tab.
- **Auto-redirect.** Flip a switch and links get silently rewritten to your preferred client *before* they load. Pick a favorite per data family (Bluesky-style clients, Publications, Tangled, Margin, Grain, Pinkleap, Semble, Streamplace, Popfeed, Sifa, Blento). Powered by `chrome.declarativeNetRequest`, so it's fast and doesn't read your browsing history.
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

- **Bluesky clients**: Bluesky, Anisota, Bluepy, Red Dwarf, Impro, plus forks like Blacksky, Witchsky, Mu, and Deer
- **Publications**: Leaflet, Standard Reader, Anisota Reader, Offprint, pckt
- **Apps**: Aturi, Tangled, Margin, Grain, Pinkleap, Semble, Streamplace, Popfeed, Sifa, Blento
- **Dev tools**: Aturi Explore, PDSls, atp.tools, Taproot

Building an Atmosphere client or tool and want it added? Email [aturi@atpota.to](mailto:aturi@atpota.to), DM [@aturi.to](https://bsky.app/profile/aturi.to) on Bluesky, or open a PR against [`src/utils/waypoints.data.ts`](src/utils/waypoints.data.ts). Both the web app and the extension pick it up automatically.

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

## Tech stack

**Web app**

- **Next.js 16**: App Router with React Server Components
- **React 19**: Suspense, Server Components, and view transitions
- **TypeScript**: type safety throughout
- **`@atproto/oauth-client-browser`**: DPoP-bound, granular-scope OAuth sign-in entirely in the browser
- **`@vercel/og`**: dynamic OpenGraph image generation on the Edge Runtime
- **`@vercel/analytics`**: privacy-focused, cookieless analytics
- **Constellation & Slingshot**: microcosm's backlink index and record cache, which the feedback board reads instead of an AppView
- **Tailwind CSS v4**: utility-first styling alongside hand-rolled CSS variables
- **Framer Motion**: page and component animations

**Extension**

- **WXT**: cross-browser MV3/MV2 build tooling (Chrome, Firefox, Safari)
- **React 19** (Preact-aliased in the bundle): popup, options, and Inspect UI
- **`chrome.declarativeNetRequest`**: fast, privacy-preserving auto-redirect
- **`@dnd-kit`**: drag-and-drop ordering of waypoints
- **Vitest**: unit tests for templates, rules, and reverse parsers

## Contributing

This is a community tool for the Atmosphere ecosystem. Contributions are welcome: bugs, new waypoints, popup polish, explorer features, and extension features all land in the same repo. See [CONTRIBUTING.md](CONTRIBUTING.md).

## More resources

- [Developer docs](https://aturi.to/docs): integrate the waypoint packages and the Resolve API into your own app
- [`@aturi.to/waypoints`](packages/waypoints/README.md) & [`@aturi.to/waypoints-react`](packages/waypoints-react/README.md): the published package READMEs
- [Contributing Guide](CONTRIBUTING.md): how to contribute back
- [Extension README](extension/README.md): extension dev, build, and Safari notes
- [Terms & Privacy Policy](https://aturi.to/terms): what we collect, how the third-party services we depend on fit in
- [Extension Privacy Policy](https://aturi.to/extension/privacy): what the extension stores, what it reads, and what it sends where

## License

This project is licensed under the GNU General Public License v3.0 or later. See the [LICENSE](LICENSE) file for details.

**GPL v3 ensures:** all forks and modifications must remain open source and credit the original work. When you fork aturi.to, you must share your source code and maintain the same GPL v3 license.

**The published packages are MIT.** The two libraries under [`packages/`](packages/) ([`@aturi.to/waypoints`](packages/waypoints/LICENSE) and [`@aturi.to/waypoints-react`](packages/waypoints-react/LICENSE)) are dual-licensed MIT by the copyright holder so other Atmosphere developers can adopt them without the GPL's copyleft obligations.

## Acknowledgments

Built for the Atmosphere ecosystem and inspired by the need for universal, platform-agnostic sharing, and for a way to escape link silos in your own browser.
