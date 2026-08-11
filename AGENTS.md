# AGENTS.md

Instructions for coding agents working in this repository. Humans should read [CONTRIBUTING.md](CONTRIBUTING.md).

## What this repo is

aturi.to: universal links, an Atmosphere Explorer, and a browser extension for atproto. Four codebases in one repo.

| Path | Stack | Verify with |
| --- | --- | --- |
| `src/` | Next.js 16 App Router, React 19, Tailwind v4 | `npm run lint && npm run typecheck && npm run build` |
| `extension/` | WXT, Preact-aliased React 19, Vitest | `cd extension && npm run compile && npm test` |
| `packages/waypoints` | tsup, zero runtime deps, MIT | `cd packages && npm run sync:check && npm test && npm run build` |
| `packages/waypoints-react` | tsup, React peer dep, MIT | `cd packages && npm run typecheck && npm run build` |

Node 22+ (`.nvmrc` pins the exact version). Root install is `npm install`; `extension/` and `packages/` have their own lockfiles and need separate installs.

## Rules that are not obvious from the code

**1. `packages/` contains generated copies. Do not hand-edit them.**

These files are copied from `src/` by `packages/waypoints/scripts/sync.mjs`:

| Canonical | Copy |
| --- | --- |
| `src/utils/waypoints.data.ts` | `packages/waypoints/src/waypoints.data.ts` |
| `src/utils/uriParser.ts` | `packages/waypoints/src/uriParser.ts` |
| `src/utils/reverseParsers.ts` | `packages/waypoints/src/reverseParsers.ts` |
| `src/utils/upstreamFetch.ts` | `packages/waypoints/src/upstreamFetch.ts` |
| `src/utils/waypointIcons.tsx` | `packages/waypoints-react/src/waypointIcons.tsx` |
| `src/components/AnisotaLogo` | `packages/waypoints-react/src/AnisotaLogo` |

Edit the canonical file, then run `cd packages && npm run sync` and commit both. CI fails on drift via `npm run sync:check`. If you find yourself editing a file in `packages/waypoints/src/` that appears above, you are in the wrong file.

**2. `extension/` imports `../src/utils/**` through the `@aturi/*` alias.** A change to a util changes the extension. Run the extension tests after touching anything in `src/utils/`.

**3. `src/utils/waypoints.tsx` is a re-export shim.** Waypoint data lives in `src/utils/waypoints.data.ts`. Do not add waypoints to `waypoints.tsx`.

**4. Two licenses.** `src/` and `extension/` are GPL-3.0-or-later. `packages/` is MIT. Do not copy code from a GPL dependency into anything the sync script exports to `packages/`.

**5. Do not bump package versions or touch the publish workflow.** Releases are tag-triggered and maintainer-driven. npm trusted publishing pins the credential to `atpota-to/aturi` plus the exact filename `.github/workflows/publish-packages.yml`, so renaming or moving that file breaks publishing until it is re-registered on npm for both packages.

The same workflow's `github-packages` job then mirrors both builds to GitHub Packages under `@atpota-to`, rewriting only the `name` field at publish time. GitHub rejects the real scope on two counts: it must match the repository owner, and it cannot contain the dot in `aturi.to`. Do not rewrite `@aturi.to/waypoints-react`'s dependency on `@aturi.to/waypoints` to the mirrored scope. The built bundle re-exports the `@aturi.to/waypoints` specifier verbatim, so a rewritten dependency would resolve to a package the bundle never imports.

## Adding a waypoint

Four edits, all required, none of which fail the build if you skip them:

1. Entry in `WAYPOINT_DESTINATIONS_DATA` (`src/utils/waypoints.data.ts`)
2. Id appended to `WAYPOINT_ORDER` in the same file, or it never renders
3. Icon keyed by id in `WAYPOINT_ICONS` (`src/utils/waypointIcons.tsx`)
4. `cd packages && npm run sync`

The `WaypointData` shape:

```typescript
{
  id: string;
  name: string;
  description: string | ((collection?: string, type?: WaypointType) => string);
  getUrl: (handle: string, collection?: string, rkey?: string, did?: string) => string | null;
  supportedTypes: WaypointType[];      // 'post' | 'profile' | 'list' | 'record' | 'unknown'
  category: string;                    // must exist in CATEGORY_ORDER
  redirectCompat: RedirectCompatFamily[];
  expectedCollections?: string[];      // NSID prefixes, trailing dot for a namespace
}
```

`getUrl` returns `null` for unrenderable input rather than a broken URL. `redirectCompat` gates auto-redirect: links are only rewritten between waypoints sharing a family. An empty array means the waypoint is never a redirect source or destination, which is correct for generic explorers. A new family needs an entry in the `RedirectCompatFamily` union and in `COMPAT_FAMILIES`.

Do not invent URL patterns, NSIDs, or supported record types. Fetch the app and check.

## Working style

- Change what was asked and nothing else. No opportunistic reformatting, renaming, comment rewriting, or type tightening in files you happened to open.
- No new dependencies. `@aturi.to/waypoints` is zero-dependency by design and the extension bundle size is a constraint. If a dependency looks necessary, stop and say so.
- Match surrounding style. This codebase uses explanatory block comments above non-obvious constants and logic. Follow that; do not add line-by-line narration.
- Read [CLEANER.md](CLEANER.md) before handing back a diff. It covers the AI tells to strip from code, comments, copy, and UI. Where it disagrees with this file or with the surrounding code, this file and the code win.
- Tests live in `extension/lib/__tests__/` and `packages/waypoints/src/__tests__/`. Add to them when you change parsing, templates, redirect rules, or waypoint data.
- Never commit `.env` values, tokens, or a real DID/handle used for testing into fixtures.
- Report failures honestly. A check you did not run is not a check that passed.

## Security-sensitive files

Read the surrounding code before changing these:

- `src/utils/ssrfGuard.ts`: blocks server-side fetches to internal addresses
- `src/utils/sanitize.ts`: user-content sanitization for rendered records
- `src/utils/upstreamFetch.ts`: outbound fetch wrapper, also shipped in the MIT package
- Anything touching OAuth, DPoP, or token storage
- `extension/` host permissions and `declarativeNetRequest` rules

Widening any of these needs a maintainer's sign-off, not a plausible-looking diff.
