# Aturi for iOS

A native port of [aturi.to](https://aturi.to): the Atmosphere Explorer, the universal-link waypoint picker, and your waypoint preferences, as a SwiftUI app. Same catalog, same parsers, same `to.aturi.actor.preferences/self` record as the web app and the extension.

## What is in here

```
ios/
  Aturi.xcodeproj        generated from project.yml (xcodegen); open this
  project.yml            the project spec, source of truth for targets and plists
  Aturi/                 the app: SwiftUI views, theme, deep links, session layer,
                         Shortcuts and Siri actions (Intents/)
  AturiShare/            the "Open in Aturi" share extension
  Packages/AturiCore/    Swift package: everything that is not UI
  scripts/               icon export and app icon rendering
```

`AturiCore` is deliberately Foundation and Observation only. It holds the waypoint catalog, the URI parsers and reverse parsers, the link generator, identity resolution (handles, `did:plc`, `did:web`), the PDS / AppView / PLC / Constellation / Slingshot / UFOs / Jetstream clients, preferences and their PDS record encoding, personalisation, auto-redirect decisions, the native atproto OAuth client (PAR, PKCE, DPoP), and one `@Observable` state object per screen. Because it has no Apple-only dependency it builds and tests on Linux as well as macOS, which is how it was verified. The app target is the thin part: views, navigation, theming, Keychain, the ASWebAuthenticationSession sign-in, and the share extension.

## Building

Requirements: Xcode 16 or newer, iOS 17.0 or newer on the device or simulator.

```bash
open ios/Aturi.xcodeproj
```

Select the `Aturi` scheme and run. The first build resolves the local `AturiCore` package; nothing is fetched from the network.

Signing: the project ships with no team. Set yours under Signing & Capabilities for both the `Aturi` and `AturiShare` targets, or export `DEVELOPMENT_TEAM=XXXXXXXXXX` before regenerating. Both targets share the app group `group.to.aturi.app` and the app claims the associated domain `applinks:aturi.to`; a free personal team can run the app but cannot use associated domains, so universal links need a paid team.

Regenerating the project after adding files or editing `project.yml`:

```bash
brew install xcodegen
cd ios && xcodegen generate
```

## Tests

```bash
cd ios/Packages/AturiCore
swift test
```

Runs on macOS or Linux (Swift 5.9 or newer; developed against Swift 6.2). Just over a thousand tests cover the catalog (every waypoint's URL for every record type, pinned as literals, plus a drift guard that reads `WAYPOINT_ORDER` out of the web's `waypoints.data.ts` and the image sets out of the asset catalog), both parser directions, identity resolution, every client against canned responses, preferences round-trips through the PDS record shape, the OAuth handshake against a fake key and transport, the write throttle, and the view models against fake transports. A handful of tests also hit the live network (plc.directory, the public AppView, Constellation, UFOs, Jetstream, the PDS of a public account) and skip rather than fail when it is unreachable.

Without Xcode, `sh ios/scripts/parse-check.sh` runs the compiler's parser over the app and share-extension sources; it catches syntax slips and nothing about types.

The same tests run from Xcode under the `Aturi` scheme's Test action. CI runs them and compiles the app on a macOS runner (`.github/workflows/ci.yml`, job `ios`).

## How links reach the app

Three routes in, all handled by `Aturi/DeepLinks.swift`:

| Link | Handled by |
| --- | --- |
| `https://aturi.to/profile/…`, `/explore/…`, `/at/…`, `/at://…` | Universal links (associated domains) |
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
| Open Section in Aturi | Explore, Links, Lexicons or Settings | Yes |

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

Local-first, like the extension. No analytics and no telemetry. The app talks only to public atproto services (your PDS and the PDS of whatever repo you open, plc.directory, the public Bluesky AppView, and microcosm's Constellation, Slingshot and UFOs), and only when you open a screen or run a Shortcuts action that needs them. The actions that do not open the app make their requests in the background, when a shortcut or automation runs them. Preferences live in the app group's UserDefaults and, once you sign in, in your own repo. The pages you open are offered to Spotlight, Siri Suggestions and Handoff, which keep them on your own devices (see above). The privacy manifest is at `Aturi/Resources/PrivacyInfo.xcprivacy`.

## What was verified, and what was not

This port was written in a Linux session without Xcode. Be clear-eyed about what that means:

- `AturiCore` compiles with warnings as errors and its whole test suite passes under Swift 6.2 on Linux, live-network tests included (the Jetstream tap skips there because that libcurl has no WebSocket support). That is the catalog, parsers, clients, preferences, OAuth protocol pieces and view models.
- `Aturi.xcodeproj` is generated by XcodeGen from `project.yml` (XcodeGen itself was built from source on the same Linux box to do it); the plists and entitlements it produced are checked in and every source file is referenced.
- The SwiftUI app target and the share extension were parse-checked (`swiftc -parse`), cross-checked symbol by symbol against the package and the shell in one review pass per area and against the iOS 17 API surface in another, and measured against the web app's route tree and components by a parity pass whose gaps were then closed. They have not been compiled by Xcode. Expect the first Xcode build to surface some type errors; the `ios` CI job exists so that a pull request shows them.
- The OAuth sign-in has been exercised end to end only against a fake transport and a fake key, plus live discovery against bsky.social. It has not completed a real login, so the DPoP key handling and the `ASWebAuthenticationSession` round trip are the first things to try on a device.
- The Shortcuts, Siri and Spotlight layer was added later, also on Linux. Its logic is in AturiCore (`LinkResolution`, `ShortcutInput`, `WaypointDirectory`) and has tests. The app-side files (`Aturi/Intents/`, `PageActivity.swift` and the router additions) were type-checked against stand-in AppIntents and SwiftUI modules transcribed from Apple's documentation, in Swift 5 and Swift 6 language modes. That catches mistakes in this code, not differences between the stand-ins and the real SDK. Xcode's App Intents metadata extraction, which checks titles and Siri phrases at build time, has not run, and no action has run on a device. XcodeGen could not run either, so the new files were added to `Aturi.xcodeproj` by hand in its layout; the next `xcodegen generate` gives those entries new IDs.

## Out of scope for this port

Server-side surfaces have no phone equivalent and were not ported: the MCP server, the Resolve API, OG image rendering, the markdown content negotiation, the sitemap. Permissioned spaces (`/explore/…/space/…`) and the feedback board depend on the space credential flow and are not included; a space link handed to the app opens in Safari. Marketing and docs pages are links out to the site. Keyboard shortcuts, the command palette, the release-notes modal and the browser-local accessibility controls (font scale, reduced motion, high contrast) have no place on a phone, where Dynamic Type and the system settings cover them.

## Licence

GPL-3.0-or-later, like `src/` and `extension/`. Waypoint marks are third-party trademarks reproduced from the shared catalog; see the icons note in `packages/waypoints/README.md`.
