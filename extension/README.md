# Aturi browser extension

A companion extension for [Aturi](https://aturi.to) that lets you jump from any
supported Atmosphere page into your preferred client, and optionally
auto-redirect links between them.

## What it does

- **Popup**: when you're on a supported site (bsky.app, blacksky.community,
  leaflet.pub, pdsls.dev, atp.tools, and many more), click the toolbar icon to
  see every other Aturi waypoint that can open that same content. Clicking one
  opens it in a new tab.
- **Auto-redirect**: flip a switch in settings to silently rewrite links before
  they even load. You pick a favorite reader for each compatibility group (apps
  that render the same underlying records), so redirects only happen between
  clients that share data. That includes a **Record explorers** group: point it
  at Aturi Explore to have pdsls.dev and atp.tools links open in
  `aturi.to/explore` instead. Because those explorers already carry the full AT
  URI in the path, no handle/DID resolution is needed. Powered by
  `chrome.declarativeNetRequest`, so it's fast and doesn't need to see your
  browsing history. An explicit pick in the popup always wins: choosing a client
  there opens *that* client, even when a standing redirect rule would otherwise
  rewrite the same URL.
- **Knowing when to stand down**: auto-redirect is meant to catch links
  arriving from outside the Atmosphere, not to steer you off a page you asked
  for. So it leaves a navigation alone when the tab is already showing one of
  the apps involved. Retyping `bsky.app` after being sent to your reader takes
  you to bsky.app instead of bouncing straight back, and editing the address
  bar while you're on bsky.app keeps you there. It also leaves alone the first
  URL to land in a tab you opened yourself, since that's one you typed or
  pasted. Both rules are settings you can turn off. The popup also carries a
  switch: turn auto-redirect off everywhere, or pause it for just the tab
  you're on until you resume it or close the tab.
- **Custom waypoints**: wire up any site that uses a consistent URL structure
  via URL templates (`/profile/{handle}`, `/u/{handle}/p/{rkey}`, etc.).
- **Recents**: the popup surfaces the waypoints you use most often first.
- **AT Tags**: the Inspect tab reads the
  [AT Tags](https://tangled.org/chrisshank.com/at-tags/) a page declares about
  itself (`<meta name="at:canonical" content="at://...">` and the `at:alternate`,
  `at:author`, `at:me`, and namespaced `at:{namespace}:{property}` siblings) and
  labels each detected URI with its relationship. The popup's jump flow also
  prefers a page's `at:canonical` record when one is declared. Parsing lives in
  the shared `src/utils/atproto/atTags.ts`, so the web app emits the same tags on
  its record and profile pages.

## Development

```bash
cd aturi-to/extension
npm install
npm run dev            # Chrome
npm run dev:firefox    # Firefox
```

```bash
cd aturi-to/extension
npm install
npm run dev:firefox    # Firefox
```

`npm run dev` launches a Chromium instance with the extension loaded; WXT
watches for changes and hot-reloads.

## Building for release

```bash
npm run build            # .output/chrome-mv3/
npm run build:firefox    # .output/firefox-mv2/ (WXT handles manifest transforms)
npm run zip
npm run zip:firefox
```

## Safari

Safari accepts a web extension via Xcode's converter. Once you've built the
Chrome bundle, run:

```bash
xcrun safari-web-extension-converter ./.output/chrome-mv3
```

Xcode will open a generated project. From there, run it on macOS or iOS
simulators, then submit through App Store Connect. No code changes are needed
in the extension itself.

## Architecture

- `entrypoints/popup/` - React UI for the toolbar popup.
- `entrypoints/options/` - React settings page with four tabs: Defaults,
  Waypoints, Custom waypoints, History.
- `entrypoints/background.ts` - Service worker that syncs
  `declarativeNetRequest` rules whenever prefs change.
- `lib/prefs.ts` - Typed wrapper around `chrome.storage.sync` (falls back to
  `.local` if the sync quota is exceeded).
- `lib/template.ts` - URL template engine for custom waypoints (forward fill
  and reverse matching).
- `lib/rules.ts` - Compiles prefs into DNR rules.
- `lib/catalog.ts` - Merges built-in waypoints with user-defined customs and
  applies the hidden-waypoints filter.
- Imports from `@aturi/*` map to `../src/utils/*` so the extension shares the
  waypoint catalog and URI parsers with the main Aturi web app.

## Icons

The toolbar icon matches the main Aturi app favicon (a lucide leaf on the deep
green background). The master SVG lives at `assets/icon.svg`; run
`npm run icons` after editing it to regenerate the 16/32/48/96/128 px PNGs in
`public/icon/` that WXT packages.

## Known limitations

Auto-redirect uses static DNR rules, so it can't rewrite *to* destinations that
need a DID - PDSls, atp.tools, Margin, and any custom waypoint
whose template uses `{did}`. Those destinations still work great from the
popup, which resolves the handle on demand. (PDSls and atp.tools can still be
redirect *sources*: their URLs already contain the DID or handle, so rewriting
them into another explorer needs no resolution.)

The extension also can't tell a typed URL from a clicked link at the moment it
has to decide. DNR has no condition for it, and the API that does know
(`webNavigation`, whose transition types include `typed` and `from_address_bar`)
reports only after a navigation has committed, and can't cancel one. Acting on
it would mean loading the wrong client and then bouncing off it. The stand-down
rules above use the tab's current state instead, which is knowable before the
request goes out. What they don't cover is typing a fresh URL into a tab that's
sitting on an unrelated site; the popup's pause switch is the escape hatch
there.
