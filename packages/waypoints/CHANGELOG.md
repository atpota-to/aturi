# Changelog

All notable changes to `@aturi.to/waypoints` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
package follows semantic versioning — with the caveat that at `0.x` a minor
bump may carry a breaking change while the API settles.

## [Unreleased]

### Security

- **The `fetchHead` probe no longer fetches arbitrary hosts.** `resolveUrl(url,
  { fetchHead: true })` fetched whatever hostname it was handed, followed
  redirects automatically, and read the whole response body. Wired into a server
  route — the use the option is written for — that gave an attacker an
  unauthenticated GET against loopback, RFC1918, link-local and `.internal`
  addresses, plus a memory-exhaustion DoS. Loopback and private addresses are
  now refused before any request is made, redirects are followed manually with
  the same check applied to each hop (maximum 3), and the body is read from the
  stream with a 1 MB cap. Two escape hatches are available on
  `ResolveUrlOptions`: `allowPrivateHosts` (for local development) and
  `isAllowedFetchHost` (a predicate that can only narrow what is reachable).
- **Fixed quadratic backtracking in the head probe.** The `<head>` and `<link>`
  regexes were both quadratic: a ~300 KB page of repeated unclosed `<head`
  openers blocked the event loop for 9.8 seconds, and the request timeout gave
  no protection because the scan is synchronous and runs after the body
  resolves. Head extraction is now an `indexOf` scan and the link pattern is
  bounded, taking the same input from 14,963 ms to 96 ms.

### Added

- `isPublicFetchHost(hostname)` — the address check used by the head probe,
  exported so callers can apply the same rule to their own fetches.
- `requiresDid(waypoint, target, did?)` — whether a waypoint has to be dropped
  because it needs a DID and none is known. Exported so
  `@aturi.to/waypoints-react` applies an identical rule; the two packages
  previously disagreed about which waypoints exist for a handle-only target.
- `resolveHandle` and `resolveHandleStatus` take an options argument with an
  `apiUrl` override, so browser consumers can point at a different appview
  without an environment variable.
- `resolveAtUri` accepts `did` and `excludeSourceId`, matching what
  `buildWaypointsForParsed` already supported.

### Fixed

- **Handle resolution silently never worked in browser bundles.** The appview
  URL was read from a bare `process.env`, and the resulting `ReferenceError` was
  swallowed by the surrounding `catch` and reported as a transient
  `reason: 'unavailable'` — so callers retried forever against an error that
  would never clear. Masked in Next.js and Vite production builds, reproducible
  in dev.
- `resolveViaApi` returns its documented `ResolveApiFailure` arm instead of
  throwing a raw `SyntaxError` when the endpoint answers with a non-2xx status,
  a non-JSON body, or is unreachable. New `reason` values: `http_error`,
  `invalid_response`, `network_error`. An abort still propagates.
- **Margin is no longer hidden from its own records.** `DID_REQUIRED_WAYPOINTS`
  was applied as a flat id list, but `at.margin.*` records resolve to
  `margin.at/<handle>/<type>/<rkey>` and need no DID. The requirement is now
  determined per target by whether substituting a DID changes the URL.
- **Site pages no longer parse as accounts.** `tangled.org`, `stream.place`,
  `blento.app`, `offprint.app` and `pckt.blog` treated any first path segment as
  a repo identifier, so `resolveUrl('https://tangled.org/about')` returned a
  successful result for a handle named `about` and a menu of ~20 links to
  profiles that do not exist. All five now require a DID or a dotted handle.
- **`getCategorizedWaypointsData` returns every waypoint.** It dropped the whole
  `blueskyForks` subcategory — blacksky, witchsky, mu and deer — returning 24 of
  28 for every type, while blacksky remained in the recommended set. Each entry
  now carries a recursive `subcategories` array.
- `buildWaypointsForParsed` returns an empty result for input carrying
  `ParsedURI.error` or an empty handle, instead of building ~21 confident-looking
  dead links from it.
- `getWaypointDataForType` no longer throws a `TypeError` when `WAYPOINT_ORDER`
  names an id the catalog does not define; it skips the row, as every sibling
  helper already did. `getWaypointCountData` counts the real catalog.
- `getDisplayName` renders a DID passed as the handle instead of returning
  `'Unknown'`.
- Host matching accepts trailing-dot FQDNs (`bsky.app.` is `bsky.app`) and no
  longer treats an empty leading label as a subdomain.
- `offprint` and `pckt` no longer advertise `profile` support. Neither can build
  a profile URL — both require a collection and rkey — so the type only made
  them appear available before dropping out.

### Changed

- Importing a single function no longer pulls in the whole catalog. An object
  spread in the compose-intent data was an impure expression that defeated
  tree-shaking; a `parseURI`-only import measured 14.2 kB minified against a
  31.5 kB whole-package bundle.
- `ResolveApiFailure.reason` is typed as a union of the reasons this client
  produces, kept open so the hosted endpoint can send others.
- **Breaking (type):** `CategorizedWaypointsData` gains a required
  `subcategories: CategorizedWaypointsData[]`. Code that only reads the shape is
  unaffected; code that constructs one needs the extra field.
