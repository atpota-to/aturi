# Aturi for iOS

A native port of [aturi.to](https://aturi.to): the Atmosphere Explorer, the universal-link waypoint picker, and your waypoint preferences, as a SwiftUI app. Same catalog, same parsers, same `to.aturi.actor.preferences/self` record as the web app and the extension.

The same project also packages the browser extension in `extension/` for Safari on iOS, iPadOS and macOS: the iOS app carries the iOS extension, and a small Mac app carries the Mac one. See [The Safari extension](#the-safari-extension).

## What is in here

```
ios/
  Aturi.xcodeproj        generated from project.yml (xcodegen); open this
  project.yml            the project spec, source of truth for targets and plists
  Aturi/                 the app: SwiftUI views, theme, deep links, session layer,
                         Shortcuts and Siri actions (Intents/)
  AturiShare/            the "Open in Aturi" share extension
  AturiSafari/           the Safari web extension's native side: the handler
                         both platforms share, and each platform's Info.plist
  AturiMac/              the Mac app that carries the Safari extension on macOS
  Packages/AturiCore/    Swift package: everything that is not UI
  scripts/               icon export, app icon rendering, and the build steps
                         that put the web extension into the Safari bundles
```

`AturiCore` is deliberately Foundation and Observation only. It holds the waypoint catalog, the URI parsers and reverse parsers, the link generator, identity resolution (handles, `did:plc`, `did:web`), the PDS / AppView / PLC / Constellation / Slingshot / UFOs / Jetstream clients, preferences and their PDS record encoding, personalisation, auto-redirect decisions, the native atproto OAuth client (PAR, PKCE, DPoP), and one `@Observable` state object per screen. Because it has no Apple-only dependency it builds and tests on Linux as well as macOS, which is how it was verified. The app target is the thin part: views, navigation, theming, Keychain, the ASWebAuthenticationSession sign-in, and the share extension.

## Building

Requirements:

- Xcode 26.2 or newer. The iOS app's Safari extension page uses SafariServices APIs that first appear in the iOS 26.2 SDK (`SFSafariExtensionManager.getStateOfExtension(withIdentifier:completionHandler:)` and `SFSafariSettings.openExtensionsSettings(forIdentifiers:completionHandler:)`), so older Xcode versions fail to compile it.
- iOS 17.0 or newer on the device or simulator; macOS 14 or newer for the Mac app.
- Node 22 or newer (`.nvmrc` pins the version CI uses) and both npm installs, because building either app also builds the Safari extension's web files with WXT:

```bash
npm ci                    # repo root: the extension imports ../src/utils
(cd extension && npm ci)
open ios/Aturi.xcodeproj
```

Select the `Aturi` scheme and run. The first build resolves the local `AturiCore` package; nothing is fetched from the network. The `AturiMac` scheme builds and runs the Mac app.

Signing: the project ships with no team. Set yours under Signing & Capabilities for every target you build (`Aturi`, `AturiShare` and `AturiSafari-iOS` for iOS; `AturiMac` and `AturiSafari-macOS` for the Mac), or export `DEVELOPMENT_TEAM=XXXXXXXXXX` before regenerating. The iOS app and the share extension share the app group `group.to.aturi.app` and the app claims the associated domain `applinks:aturi.to`; a free personal team cannot use associated domains, so to run on a device with one, remove that capability from the `Aturi` target first (universal links then won't open the app).

Regenerating the project after adding files or editing `project.yml`:

```bash
brew install xcodegen
cd ios && xcodegen generate
```

## The Safari extension

The browser extension in `extension/` ships for Safari as a Safari web extension inside both apps:

| Target | Platform | Bundle ID | Carried by |
| --- | --- | --- | --- |
| `AturiSafari-iOS` | iOS and iPadOS 17+ | `to.aturi.app.safari` | `Aturi` (`to.aturi.app`) |
| `AturiSafari-macOS` | macOS 14+ | `to.aturi.app.safari` | `AturiMac` (`to.aturi.app`) |

The Mac app uses the iOS app's bundle ID so the two are one App Store product (universal purchase), and both extensions use one ID so Safari treats them as one extension across devices. The manifest asks for Safari 18.4 or later (`strict_min_version`). Safari enforces that key itself rather than in WebKit's open-source code, so what an older iOS or Safari shows for the extension has not been checked; it should not run there.

**How the web files get into the bundles.** WXT's Safari build (`npm run build:safari` in `extension/`) writes `extension/.output/safari-mv3/`, which is not checked in. The `AturiSafariWeb` aggregate target runs `scripts/build-safari-web-extension.sh`, which runs that build; both extension targets depend on it. Each extension target then runs `scripts/copy-safari-web-extension.sh` as its last build phase, which copies the folder's contents into the bundle's resources folder (`AturiSafari.appex/` on iOS, `AturiSafari.appex/Contents/Resources/` on macOS) before Xcode signs the bundle. The native side is `AturiSafari/Shared/SafariWebExtensionHandler.swift`, which only echoes: the manifest does not ask for `nativeMessaging`.

**Node inside Xcode.** Xcode.app runs build phases without your shell's PATH. The build script looks for Node in `NODE_BINARY`, then in `ios/.xcode.env.local` (gitignored, read as shell), then in Homebrew's folders and the volta, mise and asdf shims. With nvm or another manager, point it at your Node once:

```bash
echo "export NODE_BINARY=\"$(command -v node)\"" > ios/.xcode.env.local
```

`xcodebuild` in a terminal inherits your PATH and needs none of this. To reuse the web build as it is (after running `npm run build:safari` yourself, or while working only on Swift), pass `ATURI_SKIP_WEB_BUILD=1` to `xcodebuild` or add `export ATURI_SKIP_WEB_BUILD=1` to `ios/.xcode.env.local`. The copy still fails if there is no `manifest.json` to copy.

**Running it on a Mac.**

1. Select the `AturiMac` scheme and My Mac, then run. Running the app registers the extension with Safari; its window says whether the extension is on and has a button to Safari's Extensions settings.
2. In Safari, choose Safari > Settings > Extensions and turn on Aturi.
3. Without a development team the build is not signed with a certificate, and Safari hides unsigned extensions. Turn on Safari > Settings > Advanced > "Show features for web developers", then Safari > Settings > Developer > "Allow unsigned extensions". Safari turns that setting off again when it quits.

After changing the web extension, build again (Product > Build); Safari picks up the new files. For a quick look without Xcode, Safari > Settings > Developer > "Add Temporary Extension…" loads `extension/.output/safari-mv3` directly until Safari quits or 24 hours pass.

**Running it on iOS.** Run the `Aturi` scheme on a simulator or device. On a device the app's associated domain needs a paid developer team; with a free personal team, remove the Associated Domains capability from the `Aturi` target first (see Signing above). The Safari extension itself adds no capability that needs a paid team. Then turn the extension on: in Safari, the More menu > Extensions on iOS 26 (the page menu in the address bar > Manage Extensions on iOS 17 and 18), or Settings > Apps > Safari > Extensions > Aturi (Settings > Safari > Extensions on iOS 17). The app's Settings tab has a Safari extension page with the same directions; on iOS 26.2 and later it also shows whether the extension is on and opens its page in Settings.

**Site access.** Safari grants an extension access site by site, whatever its manifest asks for. Until the person allows Aturi on a site, the extension cannot read that page's URL or run its content scripts there, and links to that site are not auto-redirected: Safari applies a redirect rule only with `declarativeNetRequestWithHostAccess` and a grant for the site the link points to. On macOS the toolbar button offers to allow a site once, for a day, always, or on every website; on iOS the same choice comes from Aturi's entry in Safari's page menu, and the grants are listed in Settings. A grant for one day runs out, and redirects of links to that site stop with it. The extension's options page lists the sites redirects cover and can ask for all of them at once.

**Inspecting the extension.** With "Show features for web developers" on, Safari's Develop menu has Web Extension Background Content, which lists Aturi's background script (its console and debugger). For the popup, Control-click it and choose Inspect Element; content scripts show up under Extension Scripts in the Sources tab of the page's own Web Inspector. For the iOS extension, turn on Web Inspector on the device (Settings > Apps > Safari > Advanced, or Settings > Safari > Advanced on iOS 17), connect it or start the simulator, and the Mac's Develop menu lists the device with Aturi's background page and any open popup. `pluginkit -mAvvv -p com.apple.Safari.web-extension` lists the extensions macOS has registered, which helps when several built copies of the Mac app confuse Safari.

## Tests

```bash
cd ios/Packages/AturiCore
swift test
```

Runs on macOS or Linux (Swift 5.9 or newer; developed against Swift 6.2). Just over a thousand tests cover the catalog (every waypoint's URL for every record type, pinned as literals, plus a drift guard that reads `WAYPOINT_ORDER` out of the web's `waypoints.data.ts` and the image sets out of the asset catalog), both parser directions, identity resolution, every client against canned responses, preferences round-trips through the PDS record shape, the OAuth handshake against a fake key and transport, the write throttle, and the view models against fake transports. A handful of tests also hit the live network (plc.directory, the public AppView, Constellation, UFOs, Jetstream, the PDS of a public account) and skip rather than fail when it is unreachable.

Without Xcode, `sh ios/scripts/parse-check.sh` runs the compiler's parser over the sources of both apps and their extensions; it catches syntax slips and nothing about types.

The same tests run from Xcode under the `Aturi` scheme's Test action. CI runs them and compiles both apps on a macOS runner (`.github/workflows/ci.yml`, job `ios`): the `Aturi` scheme for the iOS Simulator and the `AturiMac` scheme for macOS, unsigned, then `scripts/check-safari-bundles.sh` checks that every file in `extension/.output/safari-mv3` is in both built Safari extensions, byte for byte.

## How links reach the app

Three routes in, all handled by `Aturi/DeepLinks.swift`, which maps the destinations `DeepLinkRouting` in AturiCore reads off the URL (and tests) onto the app's screens:

| Link | Handled by |
| --- | --- |
| `https://aturi.to/profile/…`, `/explore/…`, `/at/…`, `/at://…`, `/links`, `/account`, `/tools/…` | Universal links (associated domains) |
| `at://did:plc:…/collection/rkey` | The `at` URL scheme |
| `aturi://open?url=<encoded link>` | The `aturi` URL scheme, used by the share extension |

Universal links only work once the site publishes its association file. The web app serves it from `/.well-known/apple-app-site-association` when the `IOS_APP_TEAM_ID` environment variable is set on the deployment (see `src/lib/iosApp.ts`); until then those links open in Safari, which is a perfectly good fallback. Any URL from a supported client (bsky.app, deer.social, tangled.org, margin.at and the rest of the catalog) can also be pasted or shared into the Links tab.

## Signing in

Sign-in is the same atproto OAuth flow the web app uses, run as a native client: the app's metadata is served by the site at `/oauth-client-metadata-ios.json` with `application_type: native` and the reverse-domain redirect `to.aturi:/oauth/callback`, tokens are DPoP-bound to a P-256 key kept in the Keychain, and the granted scope is chosen in the same picker (create, update, delete records, upload blobs) with the AppView `rpc:` grant always included. Signing in reads your preferences record and writes local changes back to it, debounced, so groups, favourites, custom waypoints and colour scheme follow you between the site, the extension and the phone.

Nothing about the account is stored anywhere but the device: there is no Aturi server in the loop.

## Shortcuts, Siri and Spotlight

The app's main jobs are App Intents, in `Aturi/Intents/`, so they appear as actions in the Shortcuts app and work in shortcuts and personal automations with nothing to set up.

| Action | Result | Opens Aturi |
| --- | --- | --- |
| Open Link in Aturi | The preview and client list for a link, AT URI, handle or DID | Yes |
| Open Copied Link in Aturi | The same, for the link on the clipboard | Yes |
| Get Aturi Link | The aturi.to link for the input, built offline | No |
| Get Client Link | The link that opens the input in a chosen client, built-in or custom waypoint | No |
| Get AT URI | The `at://` URI, with the handle resolved to a DID | No |
| Resolve Handle | The DID behind a handle | No |
| Get Handle for DID | The handle a DID document names | No |
| Get Profile | The Bluesky profile: handle, DID, name, description, avatar, banner, counts, aturi.to link | No |
| Get Record | A record's JSON | No |
| Explore in Aturi | The explorer for a handle, DID, AT URI, link or PDS host, routed like the search box | Yes |
| Open Lexicon in Aturi | A lexicon's page, or a namespace's group page | Yes |
| Open My Repo in Aturi | The signed-in account's repo | Yes |
| Open Section in Aturi | Explore, Links, Lexicons, Tools or Settings | Yes |

Ten of them are also App Shortcuts (`AturiShortcuts.swift`). iOS lists those in the Shortcuts app, in Spotlight and in the Action button settings, and Siri runs them by phrase: "Open copied link in Aturi", "Open Lexicons in Aturi", "Resolve a handle with Aturi" and the others in that file. Siri cannot take a URL by voice, so the phrases favour actions that need no link or that take a handle. A handle dictated as "dame dot is" is read as `dame.is`.

The actions marked No run without bringing the app forward and return a value for the next action. Get Client Link followed by the system's Open URLs action opens a link in Deer or pdsls; Get Record followed by Get Dictionary from Input reads one field of a record. A shortcut built from any of these can also go on the Action button, or in Control Center through the Shortcuts control on iOS 18 and later.

A few choices follow from how the rest of the app works:

- A link opened from Shortcuts or the clipboard counts as arriving from outside, like a universal link or the share sheet, so an auto-redirect preference applies to it.
- Custom waypoint templates come from the PDS record, which anything holding a token for the account can write, so Get Client Link only returns a custom waypoint's link when it is http or https. Auto-redirect applies the same rule.
- Open Copied Link reads the clipboard from the Links tab once the app is active, because iOS asks before an app reads what another app copied. Allowing Paste from Other Apps in Aturi's settings skips the question.
- Links resolve through the preview page's own pipeline, `LinkResolution` in AturiCore. Input handling and the client list are in `AturiCore/Shortcuts/`, with tests.

Every page pushed in the app is also advertised as an `NSUserActivity` (`Aturi/PageActivity.swift`) carrying its aturi.to URL. Spotlight lists the pages you open, Siri Suggestions can offer them again, and Handoff continues one on your other devices: in Aturi where it is installed, on aturi.to in a browser where it is not. The activities are not offered to Apple's public index. Tapping Clear above Recent on the Links tab deletes them, and Learn from this App in iOS's Siri settings for Aturi stops the suggestions.

Aturi does not ship Control Center or Lock Screen controls of its own, or Home Screen widgets. Those need a widget extension target, and a control that opens the app needs its intent compiled into both the app and the extension, which has to be set up and checked in Xcode.

## Privacy

Local-first, like the extension. No analytics and no telemetry. The app talks only to public atproto services (your PDS and the PDS of whatever repo you open, plc.directory, the public Bluesky AppView, and microcosm's Constellation, Slingshot and UFOs) and to two public, cached endpoints of aturi.to itself: `/api/at-tags`, when a pasted web page may declare the record it is about, and `/api/lexicons/new`, the lists of new lexicons on the Explore landing and the Lexicons tab, which costs UFOs too many requests to compute on the device. It does so only when you open a screen or run a Shortcuts action that needs them, and neither aturi.to request carries anything about you. The Explore landing's atmospheric conditions also come from atpota.to's public weather station (`/api/atmosphere` and `/api/weather-almanac`), read once a minute only while that screen is showing and the app is in front, and those requests carry nothing about you either. An account's label and visibility checks also ask `api.bsky.app`, the uncached Bluesky AppView host that reports labels from every labeler, and the relay at `relay1.us-east.bsky.network` for the list of labelers, about the account you opened. The Tools tab asks more hosts, each only when you run a tool that needs it, about what you typed: the label, shadowban and post tools ask `api.bsky.app` (the label tool also asks the relay above for its list of labelers) and, when picked, Blacksky's AppView at `api.blacksky.community`; the relay check asks the relays it lists (`relay1.us-east.bsky.network`, `relay1.us-west.bsky.network`, `relay.fire.hose.cam` and `relay3.fr.hose.cam`); the handle debugger and the lexicon tools look up DNS TXT records through Google's public resolver at `dns.google`, and the handle debugger also fetches `https://<handle>/.well-known/atproto-did`; the stream monitor opens Jetstream or plc.directory's export stream; the XRPC console reads method schemas from `raw.githubusercontent.com`; and the page, OAuth client and feed tools fetch the URL or service you give them. None of these requests carries anything about you, except the mutuals tool's optional save, which writes a list to your own repo. The actions that do not open the app make their requests in the background, when a shortcut or automation runs them. Preferences live in the app group's UserDefaults and, once you sign in, in your own repo. The pages you open are offered to Spotlight, Siri Suggestions and Handoff, which keep them on your own devices (see above). The privacy manifest is at `Aturi/Resources/PrivacyInfo.xcprivacy`.

## What was verified, and what was not

This port was written in a Linux session without Xcode. Be clear-eyed about what that means:

- `AturiCore` compiles with warnings as errors and its whole test suite passes under Swift 6.2 on Linux, live-network tests included (the Jetstream tap skips there because that libcurl has no WebSocket support). That is the catalog, parsers, clients, preferences, OAuth protocol pieces and view models.
- `Aturi.xcodeproj` is generated by XcodeGen from `project.yml` (XcodeGen itself was built from source on the same Linux box to do it); the plists and entitlements it produced are checked in and every source file is referenced.
- The SwiftUI app target and the share extension were parse-checked (`swiftc -parse`), cross-checked symbol by symbol against the package and the shell in one review pass per area and against the iOS 17 API surface in another, and measured against the web app's route tree and components by a parity pass whose gaps were then closed. They have not been compiled by Xcode. Expect the first Xcode build to surface some type errors; the `ios` CI job exists so that a pull request shows them.
- The OAuth sign-in has been exercised end to end only against a fake transport and a fake key, plus live discovery against bsky.social. It has not completed a real login, so the DPoP key handling and the `ASWebAuthenticationSession` round trip are the first things to try on a device.
- The Shortcuts, Siri and Spotlight layer was added later, also on Linux. Its logic is in AturiCore (`LinkResolution`, `ShortcutInput`, `WaypointDirectory`) and has tests. The app-side files (`Aturi/Intents/`, `PageActivity.swift` and the router additions) were type-checked against stand-in AppIntents and SwiftUI modules transcribed from Apple's documentation, in Swift 5 and Swift 6 language modes. That catches mistakes in this code, not differences between the stand-ins and the real SDK. Xcode's App Intents metadata extraction, which checks titles and Siri phrases at build time, has not run, and no action has run on a device. XcodeGen could not run either, so the new files were added to `Aturi.xcodeproj` by hand in its layout; the next `xcodegen generate` gives those entries new IDs.

### The Safari extension targets

Also added on Linux, without Xcode or Safari. What was checked here: `xcodegen generate` (XcodeGen 2.48.0, built from source) produces the targets, phases and schemes described above, and leaves the existing targets' build settings as they were; every Swift file parses with `swiftc -parse`; the extension handler and the SafariServices calls in both apps type-check against stand-in modules transcribed from Apple's documentation; the build, copy and check scripts were run against a fake repo and fake bundles. What was not: no `xcodebuild`, no SwiftUI type check, no run in Safari on any device. The things most likely to need attention on a Mac are the aggregate target building ahead of the copy phases under parallel builds, the Mac app's sandbox and signing, and whether the extension shows up and loads in Safari on both platforms. The `ios` CI job is the first real build. Regenerating the project for these targets also gave the Shortcuts and Tools files that had been added by hand their XcodeGen IDs.

### The November 2026 parity pass

A later pass, also on Linux and this time without a Swift toolchain at all, brought the app up to the web's design and pages as of mid-November 2026 (the explorer's record, collection and repo pages, the link-page heading and `?stay=1`, lexicon pins, site links and Watch, the Field Notes tokens and controls added since the first port, and the landing's "This week in the Atmosphere"). Nothing in that pass was compiled or run here: the package changes come with tests, and both they and the app build are left to the `ios` CI job on a pull request. The Tools tab's files (`Aturi/Features/Tools/`) were added to `Aturi.xcodeproj` by hand in XcodeGen's layout, as the Shortcuts files were; the next `xcodegen generate` gives those entries new IDs.

## Out of scope for this port

Server-side surfaces have no phone equivalent and were not ported: the MCP server, the Resolve API, OG image rendering, the markdown content negotiation, the sitemap. Permissioned spaces (`/explore/…/space/…`) and the feedback board depend on the space credential flow and are not included; a space link handed to the app opens in Safari. Marketing and docs pages are links out to the site. Keyboard shortcuts, the command palette, the release-notes modal and the browser-local accessibility controls (font scale, reduced motion, high contrast) have no place on a phone, where Dynamic Type and the system settings cover them.

## Licence

GPL-3.0-or-later, like `src/` and `extension/`. Waypoint marks are third-party trademarks reproduced from the shared catalog; see the icons note in `packages/waypoints/README.md`.
