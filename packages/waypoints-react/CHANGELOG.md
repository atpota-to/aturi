# Changelog

All notable changes to `@aturi.to/waypoints-react` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this package follows semantic versioning — with the caveat that at `0.x` a minor
bump may carry a breaking change while the API settles.

## [Unreleased]

### Fixed

- **The picker is now usable with a keyboard.** Every row was a
  `role="button"` `<div>` with no `tabIndex` and no key handler, wrapping a real
  `<button>` and a real `<a>` — axe's `nested-interactive` rule, rated Serious.
  Rows were unreachable by Tab, `onSelect` was pointer-only, and neither
  `classNames` nor `unstyled` could reach an attribute, so consumers inherited
  the violation with no way to patch it. The row's primary action is now a real
  `<a href>` — or a real `<button>` when `onSelect` is supplied — which also
  restores middle-click, cmd-click, "open in new tab" and the context menu.
- **Rows announce their destination, not a run-on sentence.** The accessible
  name was `"BlueskyView profile on bsky.appOpen in Bluesky"`, because the
  description and both controls sat inside the element carrying the role. The
  description now hangs off `aria-describedby`, so the name is `"Bluesky"`.
- **The picker no longer offers destinations that cannot resolve the target.**
  `useWaypoints` did not apply the DID-required filter the core resolver applies
  and documents, so `pdsls`, `atp.tools`, `grain` and `popfeed` were rendered
  with handle-shaped URLs those sites cannot resolve. Both packages now share
  one rule via `requiresDid`.
- **Collapsing a category sticks.** `useWaypoints` keyed its memo on the
  identity of the `waypointIds` / `hiddenIds` / `customWaypoints` arrays, so an
  inline array literal — the shape every README example uses — missed on every
  render, and `WaypointPicker` re-seeded its expansion state from the derived
  default. An unrelated parent re-render silently re-opened every category the
  user had collapsed. The memo is now keyed on content, the returned object is
  stable, and expansion re-seeds only when the target itself changes.
- Focus is visible again. No focus styling shipped at all, and `overflow:
  hidden` on the category container clipped the UA ring off the disclosure
  button inside it; that clip is now `clip-path`, which rounds the corner
  without touching descendant outlines.
- The copy control has a distinct accessible name per row (`Copy link to
  Bluesky`) rather than the same `Copy link` on all 28, and meets the 24×24 CSS
  px minimum target size of WCAG 2.5.8.
- Hover and chevron transitions respect `prefers-reduced-motion`.
- The shipped `styles.css` header named a package that does not exist
  (`@aturi/waypoints-react`, missing the `.to`).
- Published sourcemaps were off by one line in both bundles, because the `"use
  client"` directive is prepended after tsup writes them. Bundles no longer
  carry a duplicate `sourceMappingURL` pragma.
- The `./styles.css` subpath export declares types, so tooling that resolves
  subpath exports as modules can resolve it. It previously failed to resolve in
  every module resolution mode.

### Added

- A test suite. This package previously shipped to npm with no tests, no test
  script and no CI test step, gated only by `tsc --noEmit` — which cannot see a
  render crash, a broken SSR path, or an ARIA role. Covers SSR, DOM behavior,
  keyboard interaction, axe violations, icon parity with the catalog, the public
  export surface, and the built `dist/` output.
- A `rowAction` styling slot for the row's primary action.

### Changed

- **Breaking (markup):** the row container no longer carries `role="button"` or
  a click handler, and `data-aturi-wp="open"` is now a decorative `<span>`
  rather than a second anchor to the same URL. The whole card stays clickable —
  the opt-in stylesheet stretches the primary action over it. Consumers styling
  against `[data-aturi-wp="open"]` as a link, or relying on the container's
  `role`, need to adjust. `renderWaypoint` consumers are unaffected.
- `RenderWaypoint` documents that it is *called*, not rendered as a component,
  so React hooks in the function body will throw. Rendering it as a component
  was measured worse: an inline arrow gets a new component type each parent
  render, remounting every row.
- `waypointIds` no longer claims to be an "ordering hint" in its JSDoc; it is an
  allowlist and never applied ordering.
- `lucide-react`'s peer range is bounded below 1.0, and the `@aturi.to/waypoints`
  dependency tracks the version the two packages release in lockstep at.
- `LICENSE` carries the upstream ISC notice for the icon path data derived from
  Lucide.
