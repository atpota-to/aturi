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
  they even load. You pick a default per source site per content type (post,
  profile, list, record). Powered by `chrome.declarativeNetRequest`, so it's
  fast and doesn't need to see your browsing history. An explicit pick in the
  popup always wins: choosing a client there opens *that* client, even when a
  standing redirect rule would otherwise rewrite the same URL.
- **Custom waypoints**: wire up any site that uses a consistent URL structure
  via URL templates (`/profile/{handle}`, `/u/{handle}/p/{rkey}`, etc.).
- **Recents**: the popup surfaces the waypoints you use most often first.

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

Auto-redirect uses static DNR rules, so it can't rewrite to destinations that
need a DID - PDSls, atp.tools, Margin, and any custom waypoint
whose template uses `{did}`. Those destinations still work great from the
popup, which resolves the handle on demand.
