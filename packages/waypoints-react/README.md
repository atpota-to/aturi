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

## Server vs. client components

This is a **client** package: its entry carries the `"use client"` directive,
so the components work out of the box in the Next.js App Router and other React
Server Components setups (no wrapper needed). Because the directive applies to
the whole entry, reach for [`@aturi.to/waypoints`](../waypoints) directly when you
need the framework-agnostic helpers (`resolveAtUri`, `buildWaypointsForParsed`,
the catalog, …) inside a Server Component.

To import from `@aturi.to/waypoints` by name, install it too:

```sh
npm install @aturi.to/waypoints
```

It arrives as a transitive dependency either way, so the import often resolves
without this — but not under pnpm's default isolated `node_modules`, and not in
any setup that forbids importing undeclared dependencies. Declaring it is the
difference between "works on my machine" and "works".

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
it however you like.

Each row's primary action is a real `<a href>` — or a real `<button>` when you
pass `onSelect` — carrying `data-aturi-wp="row-action"`. That is what makes Tab,
Enter, middle-click, "open in new tab" and the context menu work. If you are
writing your own styles rather than importing the theme, three rules restore the
click-anywhere-on-the-card behavior:

```css
[data-aturi-wp='button']     { position: relative; }
[data-aturi-wp='row-action']::after { content: ''; position: absolute; inset: 0; }
[data-aturi-wp='actions']    { position: relative; z-index: 1; }
```

Without them you get a normally-sized link, which is still fully functional. Map your own classes per slot, or pass `unstyled` to drop
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

## Icons

The per-client SVG components and the `WAYPOINT_ICONS` map are exported too:

```tsx
import { WAYPOINT_ICONS, BlueskySVG } from '@aturi.to/waypoints-react';
```

## License

MIT © atpotato, LLC.
