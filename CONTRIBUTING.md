# Contributing to aturi.to

Thanks for wanting to help. This is a community tool for the Atmosphere, and most of what it does exists because someone asked for it.

Read the [repo map](#repo-map) and [Before you open a PR](#before-you-open-a-pr) before you write code. If you are using an AI coding agent, read [AI-assisted contributions](#ai-assisted-contributions) too, and point your agent at [`AGENTS.md`](AGENTS.md).

## Repo map

Four codebases share one repository:

| Path | What it is | Checks |
| --- | --- | --- |
| `src/` | The Next.js 16 web app: universal links, Atmosphere Explorer, OG images, Resolve API | `npm run lint`, `npm run typecheck`, `npm run build` |
| `extension/` | The browser extension (WXT, Chrome/Firefox/Safari) | `npm run compile`, `npm test` |
| `packages/waypoints` | Published `@aturi.to/waypoints`, MIT, zero-dependency core | `npm run sync:check`, `npm run typecheck`, `npm test`, `npm run build` |
| `packages/waypoints-react` | Published `@aturi.to/waypoints-react`, MIT, headless picker UI | `npm run typecheck`, `npm run build` |

Two things about this layout will bite you if you do not know them:

**The extension imports the app's source directly.** Files under `extension/` reach into `../src/utils/**` through the `@aturi/*` alias. Change a util and you have changed the extension. This is why CI installs the root dependencies before typechecking the extension.

**The packages ship copies, not imports.** `packages/waypoints` contains standalone copies of `src/utils/waypoints.data.ts`, `uriParser.ts`, `reverseParsers.ts`, and `upstreamFetch.ts` so it can build without Next.js. `packages/waypoints-react` copies `waypointIcons.tsx` and `AnisotaLogo`. `src/` is canonical; the copies are generated. A drift guard (`npm run sync:check`) fails CI when they disagree. If you edit any of those files, run the sync:

```bash
cd packages && npm install && npm run sync
```

Then commit the regenerated copies alongside your change.

## Setup

Node 22 or newer. The repo pins an exact version in `.nvmrc`.

```bash
git clone https://github.com/atpota-to/aturi.git
cd aturi
nvm use
npm install
npm run dev          # http://localhost:3000
```

For the extension:

```bash
cd extension
npm install
npm run dev          # Chrome, loads into a fresh Chromium profile
npm run dev:firefox  # Firefox
```

For the packages:

```bash
cd packages
npm install          # nested workspace, links both packages locally
```

## Before you open a PR

Run the checks that touch what you changed. These are the same commands CI runs, in `.github/workflows/ci.yml`. Running them locally takes a few minutes and saves a review round trip.

```bash
# Web app
npm run lint && npm run typecheck && npm run build

# Extension
cd extension && npm run compile && npm test

# Packages
cd packages && npm run sync:check && npm run typecheck && npm test && npm run build
```

If a check fails and you do not understand why, say so in the PR. An honest "the extension tests fail and I could not work out whether it is my change" is a fine thing to open a PR with. A green checkbox you did not verify is not.

## Adding a waypoint

This is the most common contribution and the one most likely to be got wrong, because the shape has changed since the old guide. Here is what a waypoint actually looks like today.

### 1. Add the entry

In `src/utils/waypoints.data.ts`, add to `WAYPOINT_DESTINATIONS_DATA`:

```typescript
grain: {
  id: 'grain',
  name: 'Grain',
  description: (collection) => {
    if (collection === 'social.grain.gallery') return 'View gallery on grain.social';
    return 'View profile on grain.social';
  },
  getUrl: (handle, collection, rkey, did) => {
    const identifier = did || handle;
    if (collection === 'social.grain.gallery' && rkey) {
      return `https://grain.social/profile/${identifier}/gallery/${rkey}`;
    }
    return `https://grain.social/profile/${identifier}`;
  },
  supportedTypes: ['post', 'profile', 'list', 'record'],
  category: 'atmosphereApps',
  redirectCompat: ['grain'],
  expectedCollections: ['social.grain.'],
},
```

Field by field:

- **`description`** takes a string or a `(collection, type) => string` function. Use the function form when the app renders more than one collection.
- **`getUrl`** returns `string | null`. Return `null` for inputs the app cannot render; the picker hides the waypoint instead of linking somewhere broken. Prefer `did || handle` when the app accepts both, because DIDs survive handle changes.
- **`supportedTypes`** is drawn from `'post' | 'profile' | 'list' | 'record' | 'unknown'`.
- **`category`** must be one of the ids in `CATEGORY_ORDER`: `blueskyClients`, `blueskyForks`, `publications`, `atmosphereApps`, `devTools`.
- **`redirectCompat`** controls auto-redirect. The extension only rewrites a link between two waypoints that share a family. Getting this wrong does not fail the build; it silently breaks auto-redirect, so it is worth a second look. If your app renders the same records as an existing family, reuse that family id. If it does not, add one to the `RedirectCompatFamily` union and to `COMPAT_FAMILIES` with a description, because that text appears in the options UI. Pass `[]` for generic explorers that should never be a redirect source or destination.
- **`expectedCollections`** lists NSID prefixes. The extension calls `describeRepo` and demotes the waypoint when the account has published none of them. Use a trailing dot for a namespace (`'social.grain.'`) or a full NSID for a single-collection app. Omit the field for generic record viewers such as PDSls and atp.tools, which have no opinion about which records exist.

### 2. Register it in the order

Add your id to `WAYPOINT_ORDER` in the same file. A waypoint missing from that array never renders, and nothing warns you.

### 3. Add an icon

Add an entry keyed by your waypoint id to `WAYPOINT_ICONS` in `src/utils/waypointIcons.tsx`, and export the SVG component alongside the others.

### 4. Reverse-parse it (optional but useful)

If you want the extension to recognise your app's URLs when a user is already on your site, add a parser to `src/utils/reverseParsers.ts`. Without one, the extension can send users to your app but cannot detect when they are on it.

### 5. Sync and test

```bash
cd packages && npm run sync
npm test                              # in packages/
cd ../extension && npm test
```

### 6. In the PR

Include a working link for each record type you claimed in `supportedTypes`. A reviewer should be able to paste them into a browser. If your app is not live yet, say so; that is fine, but it changes how the PR is reviewed.

You do not have to open a PR to get a client listed. Email [aturi@atpota.to](mailto:aturi@atpota.to) or DM [@aturi.to](https://bsky.app/profile/aturi.to) and it can be added for you.

## AI-assisted contributions

Coding agents are welcome here. Much of this repository was written with one. What follows is not a restriction on agents; it is what makes an agent-written PR reviewable.

**Disclose it.** The PR template asks whether an agent wrote the change. Say yes. Nobody will think less of the PR, and it tells a reviewer where to look hardest.

**You are the author.** Whatever produced the diff, you are answerable for it. "The model wrote it" does not resolve a review comment. If you cannot explain why a line is there, delete the line.

**Run it.** Not the tests alone: the actual thing. Open the page, click the button, load the extension. Agents produce code that typechecks and does nothing, and that failure mode is invisible in a diff.

**Keep the diff to the ask.** Agents reformat neighbouring code, rename variables for consistency, "fix" unrelated types, and rewrite comments they find imprecise. Strip all of it before pushing. A 40-line feature inside a 900-line diff will sit unreviewed. If you genuinely found something unrelated worth fixing, open a separate PR.

**No new dependencies without asking.** Open an issue first. The core package is zero-dependency on purpose and the extension bundle size is a real constraint.

**Describe behaviour, not process.** A PR body that says what changed and what you checked is useful. One that narrates the agent's reasoning, restates the diff in prose, or lists implementation phases is noise. Keep it short.

**Do not invent facts about the Atmosphere.** URL structures, lexicon NSIDs, and which app renders which collection are all things a model will guess confidently and wrongly. Verify each one against the live app before you claim it.

Generated PRs that do none of this get closed without a detailed review. That is not hostility toward the tool; there is one maintainer, and a PR nobody has read costs more to review than it took to produce.

## Reporting bugs and requesting features

[Open an issue](https://github.com/atpota-to/aturi/issues). The templates ask for what a fix needs: which surface (web app, extension, packages), the AT URI or link involved, what you expected, and what happened. For extension bugs, the browser and version matter, because Chrome, Firefox, and Safari differ in how they handle `declarativeNetRequest`.

Search first. Waypoint requests in particular tend to arrive twice.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Other ways to help

- **Documentation.** Typos, unclear explanations, missing examples, translations.
- **Testing across browsers.** Safari especially, since it needs the Xcode converter and gets the least coverage.
- **Forks.** Built something for a specific community? Say so, and it can be featured.

## Releases

Publishing `@aturi.to/waypoints` and `@aturi.to/waypoints-react` to npm is a maintainer step, not part of a PR. Do not bump the version in `packages/*/package.json` in a contribution; it makes the branch conflict with every other open PR and does not make a release happen any sooner.

For maintainers: bump both `package.json` versions, merge to main, then push a tag (`git tag v0.1.2 && git push origin v0.1.2`). `.github/workflows/publish-packages.yml` runs the same gates as CI and publishes through npm trusted publishing (OIDC), so there is no token to rotate. A package already on the registry at that version is skipped, so re-runs and single-package bumps are both safe. Renaming that workflow file breaks publishing until the new name is registered on npm for both packages.

## License

The app is GPL-3.0-or-later. The two packages under `packages/` are MIT, so other Atmosphere developers can build on them without copyleft obligations.

Contributions to `src/` and `extension/` are licensed GPL-3.0-or-later. Contributions to `packages/` are licensed MIT. Note that the sync guard means editing a canonical file under `src/utils/` can land the same code in an MIT package; by contributing those files you agree to both licenses for that code.

## Questions

Open an issue, email [aturi@atpota.to](mailto:aturi@atpota.to), or DM [@aturi.to](https://bsky.app/profile/aturi.to) on Bluesky.
