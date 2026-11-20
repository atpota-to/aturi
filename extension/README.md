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
  you're on until you resume it or close the tab. Safari can't scope a rule
  to one tab, so it has the switch but neither rule nor the per-tab pause
  (see [Safari](#safari)).
- **Custom waypoints**: wire up any site that uses a consistent URL structure
  via URL templates (`/profile/{handle}`, `/u/{handle}/p/{rkey}`, etc.).
- **Recents**: the popup surfaces the waypoints you use most often first.
- **Every record on the page**: the popup's card carries a folder tab for the
  page's own record and one for each other record the page references, each
  with a Copy list of its identifiers (AT URI, aturi.to link, DID, handle, PDS
  host, CID) and a hand-off to aturi.to. Waypoints act on whichever record's
  tab is open.
- **Look up anything**: the search glyph in the popup's bar (or `/`) opens
  aturi.to's go-to field, with the accounts you have come across lately as
  suggestions. "Seen lately" is a small list kept on this device only, and
  goes with the Recents toggle.
- **AT Tags**: the popup reads the
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
npm run build:firefox    # .output/firefox-mv3/ (WXT handles manifest transforms)
npm run build:safari     # .output/safari-mv3/ (macOS, iOS and iPadOS)
npm run zip
npm run zip:firefox
npm run zip:safari
```

The Safari build ships inside the iOS and Mac apps rather than as a zip; see
[Safari](#safari).

## Safari

One Safari build covers Safari on macOS, iOS and iPadOS:

```bash
npm run build:safari     # .output/safari-mv3/
```

It needs Safari 18.4 or later, which the manifest declares in
`browser_specific_settings.safari.strict_min_version`. The redirect rules need
DNR `regexSubstitution` (Safari 17), and before 18.4 `storage.onChanged` left
out the name of the storage area that changed, which the settings, debug log
and page-scan code all check. There is no `dev:safari`: WXT can't launch
Safari.

### Running it

Safari installs web extensions only from inside an app (apart from the
temporary developer load below). The Xcode project in [`ios/`](../ios) builds
two:

- The `Aturi` scheme builds the iOS app with the iOS extension
  (`AturiSafari-iOS`) inside it.
- The `AturiMac` scheme builds a small Mac app that carries the Mac extension
  (`AturiSafari-macOS`). Its window shows whether the extension is on and opens
  Safari's extension settings.

Both schemes run `npm run build:safari` as part of the Xcode build and copy
`.output/safari-mv3/` into the extension bundle, so they need Node 22 or
newer and `npm ci` both at the repo root and in `extension/`.
[ios/README.md](../ios/README.md#the-safari-extension) covers signing, pointing
Xcode at Node, and turning the extension on in Safari on each platform.

To try a build on a Mac without Xcode, run `npm run build:safari`, turn on
Safari > Settings > Advanced > "Show features for web developers", then choose
Safari > Settings > Developer > "Add Temporary Extension…" and select
`.output/safari-mv3`. Safari removes a temporary extension when it quits or
after 24 hours.

### Site access

Safari doesn't grant `<all_urls>` at install. It asks site by site, and the
user can allow a site once, for one day, always, or allow every website. On a
Mac the choice is in Aturi's toolbar button; on iPhone and iPad it's under
Aturi in Safari's page menu, and the grants are listed in Settings. On a site
the user hasn't allowed:

- **Auto-redirect** leaves links to it alone. WebKit applies a DNR `redirect`
  only when the extension holds `declarativeNetRequestWithHostAccess` and the
  user has allowed the site the link points to (bsky.app, for a bsky.app
  link). The rules install either way; they just don't fire. A one-day grant
  runs out, and redirects of links to that site stop with it. On Safari,
  Settings > General shows a Site access panel under the auto-redirect switch
  that lists the redirect sources not allowed yet and asks for all of them in
  one prompt.
- **Head detection and the page scan** don't run when the page loads. Opening
  the popup grants the current tab through `activeTab`, which also injects both
  content scripts into it, so the popup still works on any page. If the first
  message to a script gets no answer, the popup asks once more after 200 ms,
  because the script may still be arriving.
- **The passive scan**, and the toolbar badge it drives, only run on allowed
  sites and in tabs where you've opened the popup.
- **Tab URLs** come back empty. So on Safari the popup only looks at the
  active tab of its own window (then of the last focused window), and never
  searches other windows for a tab that has a URL.

Allowing every website makes Safari behave like the other browsers, apart from
what the next section lists.

### What Safari can't do

- **Per-tab exceptions.** The popup's "Pause for this page", and the "Stay put
  on the app you're using" and "Skip the first URL in a new tab" settings, are
  hidden on Safari, and every matching link is redirected wherever the tab
  already is. All three work by adding a DNR rule scoped to one tab. Safari's
  DNR ignores `tabIds` without an error, so that rule would apply in every
  tab, and WebKit's regex dialect has no `|`, so the rule as built would make
  Safari reject the whole update. Safari also reports an empty URL for tabs on
  sites the user hasn't allowed, so the extension couldn't reliably tell what
  a tab is showing anyway. The popup's auto-redirect switch still turns
  redirects off everywhere.
- **Settings sync.** `storage.sync` works, but Safari never syncs it, so
  preferences stay on the device they were set on.

### Where the Safari code lives

- `lib/platform.ts`: `IS_SAFARI`, a build-time constant, so Safari branches
  are dropped from the Chrome and Firefox bundles. macOS and iOS share one
  bundle; code that needs to tell them apart uses
  `runtime.getPlatformInfo().os` (`"mac"` or `"ios"`).
- `wxt.config.ts`: the Safari manifest (`activeTab` and
  `declarativeNetRequestWithHostAccess`, extra 64, 256 and 512 px icons,
  `browser_specific_settings.safari`), and a hook that replaces WXT's service
  worker with a non-persistent background page (`background.scripts` with
  `persistent: false`).
- `entrypoints/background.ts`: on Safari, no per-tab tracking and no
  `tabs.query({})`, which makes Safari ask about every open tab on a site it
  hasn't been allowed and can block for up to two minutes. Before it updates
  the rules it drops any that `declarativeNetRequest.isRegexSupported`
  rejects, since one rule WebKit can't compile fails the whole update.
- `lib/safariRegex.ts`: a port of WebKit's content-blocker regex parser,
  used only by tests, which run every redirect and bypass rule through it.
- `lib/siteAccess.ts`: the Site access panel.
- `lib/activeTab.ts` and `entrypoints/popup/host.ts`: the popup's tab lookup,
  and its full-width layout when iPhone shows it as a sheet.
- The popup's settings button always opens the settings page with
  `tabs.create` on Safari, because `runtime.openOptionsPage()` from a popup
  crashes Safari (WebKit bug 290843).

### Status

The Safari build was written and unit-tested without a Mac. It has not yet run
in Safari on a Mac, iPhone or iPad, so the behaviour above is what WebKit's
source and Apple's documentation say, not what has been seen on a device. The
first things to check are redirects after allowing sites, whether the count
badge shows on iOS, and the popup in the iPhone sheet.

## Architecture

- `entrypoints/popup/` - React UI for the toolbar popup.
- `entrypoints/options/` - React settings page with four tabs: Defaults,
  Waypoints, Custom waypoints, History.
- `entrypoints/background.ts` - Background script (a service worker on
  Chrome, a non-persistent background page on Firefox and Safari) that syncs
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
`public/icon/` that WXT packages. It also writes 64/256/512 px PNGs to
`assets/safari-icon/`, which only the Safari build includes (WXT would add
anything in `public/icon/` to every browser's manifest).

## Design

The next popup design (a record card with folder tabs per record, a Copy ledger, Seen lately and a header search) is mocked up under `design/popup/`, with the briefs, the alternatives it was chosen over and the panel verdicts. See `design/popup/README.md` before implementing it.

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
there (on Safari, which has no per-tab pause, the auto-redirect switch is).
