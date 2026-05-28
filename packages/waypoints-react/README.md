# @aturi/waypoints-react

A drop-in React "Open in…" picker for the Atmosphere, built on
[`@aturi/waypoints`](../waypoints). Add per-client links, smart recommendations,
and client icons to your app in a few lines.

**Headless-first**: the components ship **zero CSS** by default and emit stable,
namespaced styling hooks. Use your own design system, opt into the polished Aturi
theme, or drop down to a hook and render everything yourself.

## Install

```sh
npm install @aturi/waypoints-react
# peers (you almost certainly already have react/react-dom):
npm install react react-dom lucide-react
```

`@aturi/waypoints-react` re-exports everything from `@aturi/waypoints`, so a
single install gives you the components *and* the catalog/resolvers.

## Three ways to use it

### 1. Drop-in picker (headless markup, bring your own styles)

```tsx
import { WaypointPicker } from '@aturi/waypoints-react';

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
import { useWaypoints } from '@aturi/waypoints-react';

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

Each entry carries `{ id, name, label, description, url, icon, category, isRecommended }`.

### 3. The polished theme (opt-in)

Want the Aturi look without writing CSS? Import the stylesheet once:

```tsx
import '@aturi/waypoints-react/styles.css';
import { WaypointPicker } from '@aturi/waypoints-react';
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
import { WAYPOINT_ICONS, BlueskySVG } from '@aturi/waypoints-react';
```

## License

MIT © dame.art.
