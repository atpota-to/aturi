# @aturi.to/waypoints-react

A drop-in React "Open in…" picker for the Atmosphere, built on
[`@aturi.to/waypoints`](../waypoints). Add per-client links, smart recommendations,
and client icons to your app in a few lines.

**Headless-first**: the components ship **zero CSS** by default and emit stable,
namespaced styling hooks. Use your own design system, opt into the polished Aturi
theme, or drop down to a hook and render everything yourself.

> **Beta: early release.** This is a `0.x` package that hasn't been
> thoroughly tested in production yet. Expect rough edges, and possible
> breaking changes between minor versions while the API settles. Bug reports
> and feedback are very welcome at
> [github.com/atpota-to/aturi/issues](https://github.com/atpota-to/aturi/issues).

## Install

```sh
npm install @aturi.to/waypoints-react
# peers (you almost certainly already have react/react-dom):
npm install react react-dom lucide-react
```

`@aturi.to/waypoints-react` re-exports everything from `@aturi.to/waypoints`, so a
single install gives you the components *and* the catalog/resolvers.

Also mirrored to GitHub Packages as `@atpota-to/waypoints-react` (GitHub only
accepts a scope matching the repository owner, and it rejects the dot in
`aturi.to`). Installing from there needs an `.npmrc`, because GitHub Packages
requires a token even for public packages:

```sh
@atpota-to:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}   # PAT with read:packages
```

The mirror keeps its dependency on `@aturi.to/waypoints` from npm rather than
pointing at the mirrored core, because the published bundle re-exports that exact
specifier. npm resolves it from npmjs with no token involved.

## Server vs. client components

This is a **client** package: its entry carries the `"use client"` directive,
so the components work out of the box in the Next.js App Router and other React
Server Components setups (no wrapper needed). Because the directive applies to
the whole entry, reach for [`@aturi.to/waypoints`](../waypoints) directly when you
need the framework-agnostic helpers (`resolveAtUri`, `buildWaypointsForParsed`,
the catalog, …) inside a Server Component.

## Three ways to use it

### 1. Drop-in picker (headless markup, bring your own styles)

```tsx
import { WaypointPicker } from '@aturi.to/waypoints-react';

<WaypointPicker
  type="post"
  handle="alice.bsky.social"
  collection="app.bsky.feed.post"
  rkey="3k7qw..."
/>;
```

This renders clean semantic markup with no CSS attached. Every element carries
both a `data-aturi-wp="…"` attribute and an `aturi-wp-*` class so you can style
it however you like. Map your own classes per slot, or pass `unstyled` to drop
the built-in class names entirely:

```tsx
<WaypointPicker
  type="profile"
  handle="alice.bsky.social"
  unstyled
  classNames={{
    button: 'flex items-center gap-3 rounded-lg border p-4 hover:bg-gray-50',
    name: 'font-semibold',
    description: 'text-sm text-gray-500',
  }}
/>
```

Replace a row entirely with `renderWaypoint` while still getting the computed
`url`, `description`, `icon`, and `isRecommended` flag:

```tsx
<WaypointPicker
  type="post"
  handle="alice.bsky.social"
  collection="app.bsky.feed.post"
  rkey="3k7qw..."
  renderWaypoint={({ waypoint }) => (
    <a href={waypoint.url} className="my-row">
      {waypoint.icon}
      {waypoint.name}
    </a>
  )}
/>
```

### 2. The `useWaypoints` hook (no markup at all)

For full control, the hook returns render-ready data and `copy` / `open`
helpers. Render 100% your own UI:

```tsx
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
```

Each entry carries `{ id, name, label, description, url, icon, category, isRecommended, composeIntent }`.

#### Compose intents

`composeIntent` is a link that opens that client's own composer
([Bluesky's intent links](https://docs.bsky.app/docs/advanced-guides/intent-links)),
or `null` when the client has no confirmed route — enough on its own to gate a
"post this over there" button. Pass `composeText` to have the links built for
you:

```tsx
const { waypoints } = useWaypoints({
  type: 'post',
  handle: 'alice.bsky.social',
  composeText: 'found via my app',
});

{waypoints
  .filter((w) => w.composeIntent?.prefillsText)
  .map((w) => (
    <button key={w.id} onClick={() => open(w.composeIntent!.url)}>
      Post in {w.name}
    </button>
  ))}
```

The `prefillsText` filter matters: one client routes the intent but ignores the
text, so without it a share button would open an empty composer. Drop the filter
when you just want to send someone to a composer. Custom waypoints can declare a
`composeIntent` of their own and they'll surface the same way.

### 3. The polished theme (opt-in)

Want the Aturi look without writing CSS? Import the stylesheet once:

```tsx
import '@aturi.to/waypoints-react/styles.css';
import { WaypointPicker } from '@aturi.to/waypoints-react';
```

It targets the namespaced classes and is fully themeable via CSS custom
properties (with light/dark defaults). Recolor or respace by overriding a few
tokens:

```css
.aturi-wp {
  --aturi-wp-accent: #db2777;
  --aturi-wp-radius: 4px;
  --aturi-wp-bg: #fffaf5;
}
```

Available tokens: `--aturi-wp-accent`, `--aturi-wp-accent-contrast`,
`--aturi-wp-bg`, `--aturi-wp-surface`, `--aturi-wp-surface-hover`,
`--aturi-wp-border`, `--aturi-wp-text`, `--aturi-wp-text-secondary`,
`--aturi-wp-text-tertiary`, `--aturi-wp-radius`, `--aturi-wp-gap`,
`--aturi-wp-pad`, `--aturi-wp-font`.

## `<WaypointPicker>` props

| Prop | Type | Description |
| --- | --- | --- |
| `type` | `WaypointType` | `'post' \| 'profile' \| 'list' \| 'record' \| 'unknown'` |
| `handle` | `string` | Handle or DID of the target repo |
| `collection`, `rkey`, `did` | `string?` | Record coordinates / explicit DID |
| `displayName` | `string?` | Shown in the subtitle; defaults to `@handle` |
| `waypointIds` | `string[]?` | Allowlist of waypoint ids to surface |
| `hiddenIds` | `string[]?` | Ids to remove |
| `customWaypoints` | `CustomWaypoint[]?` | Your own destinations |
| `composeText` | `string?` | Pre-fills each entry's `composeIntent` link |
| `showRecommended` | `boolean?` | Default `true` |
| `showCopy` | `boolean?` | Default `true` |
| `onSelect` | `(waypoint, event) => void` | Override open-in-new-tab |
| `unstyled` | `boolean?` | Drop built-in class names |
| `classNames` | `WaypointClassNames?` | Per-slot class map |
| `renderWaypoint` | render prop | Replace the row markup |
| `className` | `string?` | Extra class on the root |

## Universal links

The picker asks "where do you want to open this?". A universal link answers the
same question for someone who isn't here yet: an `aturi.to/…` URL you can paste
anywhere, where the recipient gets a preview and picks their own client. Two
exports offer one from your UI: a button, and the hook behind it.

`<UniversalLinkButton>` is the whole control. It opens the native share sheet
in browsers that implement `navigator.share` and copies to the clipboard in the
ones that don't, with the transient "Copied" state already wired up:

```tsx
import { UniversalLinkButton } from '@aturi.to/waypoints-react';

<UniversalLinkButton target={post.uri} />
<UniversalLinkButton target="https://bsky.app/profile/alice.bsky.social/post/3k7" mode="copy" />
```

`target` takes anything that names a record: an AT URI, a handle, a DID, a page
URL from any client in the catalog. The button renders nothing when it doesn't
resolve, so it's safe to drop into a row whose data is still loading.

| Prop | Type | Description |
| --- | --- | --- |
| `target` | `UniversalLinkTarget` | AT URI, handle, DID, client URL, or `ParsedURI` |
| `mode` | `'auto' \| 'copy' \| 'share'` | Default `'auto'`: share sheet where `navigator.share` exists, clipboard where it doesn't |
| `label`, `copiedLabel` | `ReactNode?` | Button text; default `Copy link` / `Copied` |
| `iconOnly` | `boolean?` | Icon only; the label still names the button for assistive tech |
| `onAction` | `(outcome, link) => void` | `'shared' \| 'copied' \| 'dismissed' \| 'failed' \| 'copy-failed'` |
| `origin`, `did`, `preferDid`, `params`, `title`, `text` | | Passed through to `describeUniversalLink` |
| `resetAfterMs` | `number?` | How long `Copied` shows. Default `2000`; `0` keeps it |
| `unstyled`, `classNames`, `className` | | Same styling hooks as the picker |

`useUniversalLink` is the same logic without markup:

```tsx
const { url, link, copy, copied, share, canShare } = useUniversalLink({
  target: 'at://alice.bsky.social/app.bsky.feed.post/3k7',
});

<button onClick={() => (canShare ? share() : copy())}>
  {copied ? 'Copied' : url}
</button>
<button onClick={() => copy(link.snippets.markdown)}>Copy as Markdown</button>
```

`link` is the full [`describeUniversalLink`](../waypoints/README.md#universal-links)
result: label, `navigator.share()` payload, markdown/HTML snippets, oEmbed URL.
`canShare` is false on the server and on the first client render (it can't be
read before mount without risking a hydration mismatch), so branch on it for the
icon, not for whether to render the control.

## Icons

The per-client SVG components and the `WAYPOINT_ICONS` map are exported too:

```tsx
import { WAYPOINT_ICONS, BlueskySVG } from '@aturi.to/waypoints-react';
```

## License

MIT © atpotato, LLC.
