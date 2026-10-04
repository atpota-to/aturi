import Foundation

// Port of src/utils/reverseParsers.ts: read a URL on any supported waypoint
// site back into the ParsedURI it addresses, so the share sheet and the link
// resolver can offer the other waypoints for a page the user already has open.
// Nothing syncs this file from the TypeScript; a host or route added there
// needs the same change here (AGENTS.md, rule 6).

/// The waypoint a URL was recognised as coming from. Every case but
/// `headDetected` is a `WaypointCatalog` id, which is how the picker keeps the
/// page you are already on out of its suggestions. `headDetected` marks an AT
/// URI found in a page's `<link>` tag rather than in its address.
public enum SourceApp: String, Codable, CaseIterable, Sendable, Hashable {
    case aturi
    case aturiExplore
    case bluesky
    case bluepy
    case blacksky
    case reddwarf
    case impro
    case lea
    case witchsky
    case deer
    case northsky
    case mu
    case anisota
    case pinksky
    case leaflet
    case tangled
    case margin
    case pdsls
    case atptools
    case semble
    case streamplace
    case grain
    case popfeed
    case sifa
    case blento
    case standardReader
    case taproot
    case offprint
    case pckt
    case headDetected

    /// The catalog id this source corresponds to; nil for `headDetected`,
    /// which names a detection method rather than a waypoint.
    public var waypointId: String? {
        self == .headDetected ? nil : rawValue
    }
}

/// A recognised URL: where it came from and what it addresses.
public struct ReverseMatch: Hashable, Sendable {
    public let source: SourceApp
    public let parsed: ParsedURI

    public init(source: SourceApp, parsed: ParsedURI) {
        self.source = source
        self.parsed = parsed
    }
}

// MARK: - Host tables

private struct ReverseHostConfig {
    let source: SourceApp
    let hosts: [String]
    /// When true, any subdomain of the listed hosts is treated as this source
    /// too (Anisota gives each publication its own `*.anisota.net` host).
    var matchSubdomains = false
}

/// Hosts that share the Bluesky-style `/profile/:handle[/(post|lists)/:rkey]`
/// layout.
private let reverseBlueskyFamily: [ReverseHostConfig] = [
    ReverseHostConfig(source: .bluesky, hosts: ["bsky.app"]),
    ReverseHostConfig(source: .blacksky, hosts: ["blacksky.community"]),
    ReverseHostConfig(source: .reddwarf, hosts: ["reddwarf.app"]),
    ReverseHostConfig(source: .impro, hosts: ["impro.social"]),
    ReverseHostConfig(source: .lea, hosts: ["lea.ac"]),
    ReverseHostConfig(source: .witchsky, hosts: ["witchsky.app"]),
    ReverseHostConfig(source: .deer, hosts: ["deer.social"]),
    ReverseHostConfig(source: .northsky, hosts: ["northsky.app"]),
    ReverseHostConfig(source: .mu, hosts: ["mu.social"]),
    ReverseHostConfig(source: .anisota, hosts: ["anisota.net"], matchSubdomains: true),
]

/// Base hosts whose subdomains are also recognised (`*.anisota.net`). Derived
/// from the `matchSubdomains` opt-in so there is one source of truth.
private let reverseSubdomainHosts: [String] = reverseBlueskyFamily
    .filter { $0.matchSubdomains }
    .flatMap { $0.hosts }

/// All host names the reverse parsers know. The popup and the share
/// extension use it to decide whether a page is relevant before doing more
/// expensive work. Same order as the web's `SUPPORTED_HOSTS`.
public let supportedHosts: [String] = ["aturi.to"]
    + reverseBlueskyFamily.flatMap { $0.hosts }
    + [
        "pinkleap.app",
        "leaflet.pub",
        "tangled.org",
        "margin.at",
        "pdsls.dev",
        "atp.tools",
        "bluepy.social",
        "semble.so",
        "stream.place",
        "grain.social",
        "popfeed.social",
        "sifa.id",
        "blento.app",
        "standard-reader.app",
        "offprint.app",
        "pckt.blog",
        "atproto.at",
    ]

private func normalizeReverseHost(_ host: String) -> String {
    let lowered = host.lowercased()
    return lowered.hasPrefix("www.") ? String(lowered.dropFirst("www.".count)) : lowered
}

/// True when `host` is a subdomain of `base` (a real dotted-label boundary,
/// so `notanisota.net` is not one of `anisota.net`).
private func isReverseSubdomain(_ host: String, of base: String) -> Bool {
    host.hasSuffix(".\(base)")
}

/// Exact host match, or a subdomain match when the config opts in.
private func reverseHostMatches(_ host: String, _ config: ReverseHostConfig) -> Bool {
    if config.hosts.contains(host) { return true }
    if !config.matchSubdomains { return false }
    return config.hosts.contains { isReverseSubdomain(host, of: $0) }
}

/// Whether a hostname belongs to a supported waypoint. Prefer this over a raw
/// `supportedHosts.contains` check: it strips a leading `www.` and also
/// recognises subdomains of hosts that opt in (`eclose.anisota.net`).
public func isSupportedHost(_ host: String) -> Bool {
    let normalized = normalizeReverseHost(host)
    if supportedHosts.contains(normalized) { return true }
    return reverseSubdomainHosts.contains { isReverseSubdomain(normalized, of: $0) }
}

// MARK: - Match builders

/// The non-empty path segments of a URL, indexed like a JavaScript array: a
/// position past the end reads as nil rather than trapping, which is what
/// the web's `parts[3]` checks rely on.
private struct ReversePathSegments {
    let segments: [String]

    init(pathname: String) {
        segments = pathname.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    }

    subscript(index: Int) -> String? {
        segments.indices.contains(index) ? segments[index] : nil
    }
}

private func reverseDid(for handle: String) -> String? {
    handle.hasPrefix("did:") ? handle : nil
}

private func inferReverseType(_ collection: String) -> ParsedURI.Kind {
    if collection == "app.bsky.feed.post" { return .post }
    if collection == "app.bsky.graph.list" { return .list }
    return .record
}

private func reverseProfileMatch(_ source: SourceApp, handle: String) -> ReverseMatch {
    ReverseMatch(
        source: source,
        parsed: ParsedURI(type: .profile, uri: "at://\(handle)", handle: handle, did: reverseDid(for: handle))
    )
}

/// A record match. `uri` is only passed where the web keeps the caller's
/// original spelling (the Pinkleap query value, a `<link>` href) instead of
/// rebuilding it from the three parts.
private func reverseRecordMatch(
    _ source: SourceApp,
    handle: String,
    collection: String,
    rkey: String,
    uri: String? = nil
) -> ReverseMatch {
    ReverseMatch(
        source: source,
        parsed: ParsedURI(
            type: inferReverseType(collection),
            uri: uri ?? "at://\(handle)/\(collection)/\(rkey)",
            handle: handle,
            did: reverseDid(for: handle),
            collection: collection,
            rkey: rkey
        )
    )
}

// MARK: - Per-host matchers

private func matchReverseBlueskyFamily(_ host: String, _ parts: ReversePathSegments) -> ReverseMatch? {
    guard let entry = reverseBlueskyFamily.first(where: { reverseHostMatches(host, $0) }) else { return nil }
    guard parts[0] == "profile", let handle = parts[1] else { return nil }

    guard let kind = parts[2] else {
        return reverseProfileMatch(entry.source, handle: handle)
    }

    if kind == "post", let rkey = parts[3] {
        return reverseRecordMatch(entry.source, handle: handle, collection: "app.bsky.feed.post", rkey: rkey)
    }

    if kind == "lists" || kind == "list", let rkey = parts[3] {
        return reverseRecordMatch(entry.source, handle: handle, collection: "app.bsky.graph.list", rkey: rkey)
    }

    // Anisota's reader addresses Standard Site / Leaflet documents at
    // `/profile/:handle/document/:rkey` without the collection NSID in the
    // URL. Mirror Standard Reader's convention and reconstruct the canonical
    // `site.standard.document` collection so the record still resolves.
    if kind == "document", let rkey = parts[3] {
        return reverseRecordMatch(entry.source, handle: handle, collection: "site.standard.document", rkey: rkey)
    }

    return reverseProfileMatch(entry.source, handle: handle)
}

/// `URLSearchParams.get`: the first value under `name`, decoded as a form
/// field (`+` is a space) so it matches what the browser hands the web app.
private func reverseQueryValue(named name: String, in url: URL) -> String? {
    guard let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedQuery else { return nil }
    for pair in query.split(separator: "&", omittingEmptySubsequences: true) {
        let halves = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
        let key = String(halves[0]).replacingOccurrences(of: "+", with: " ").removingPercentEncoding
        guard key == name else { continue }
        let raw = halves.count > 1 ? String(halves[1]) : ""
        let spaced = raw.replacingOccurrences(of: "+", with: " ")
        return spaced.removingPercentEncoding ?? spaced
    }
    return nil
}

private func matchReversePinksky(_ host: String, _ parts: ReversePathSegments, _ url: URL) -> ReverseMatch? {
    guard host == "pinkleap.app" else { return nil }

    if parts[0] == "feed", let uri = reverseQueryValue(named: "uri", in: url), uri.hasPrefix("at://") {
        // The web destructures a plain split here, so an empty middle segment
        // reads as no collection rather than being skipped over.
        let pieces = uri.dropFirst("at://".count).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        let handle = pieces.indices.contains(0) && !pieces[0].isEmpty ? pieces[0] : nil
        if let handle {
            let collection = pieces.indices.contains(1) && !pieces[1].isEmpty ? pieces[1] : nil
            let rkey = pieces.indices.contains(2) && !pieces[2].isEmpty ? pieces[2] : nil
            if let collection, let rkey {
                return reverseRecordMatch(.pinksky, handle: handle, collection: collection, rkey: rkey, uri: uri)
            }
            return reverseProfileMatch(.pinksky, handle: handle)
        }
    }

    if parts[0] == "profile", let handle = parts[1] {
        return reverseProfileMatch(.pinksky, handle: handle)
    }

    return nil
}

private func matchReverseLeaflet(_ host: String, _ parts: ReversePathSegments) -> ReverseMatch? {
    guard host == "leaflet.pub", parts[0] == "p", let handle = parts[1] else { return nil }
    return reverseProfileMatch(.leaflet, handle: handle)
}

private func matchReverseTangled(_ host: String, _ parts: ReversePathSegments) -> ReverseMatch? {
    guard host == "tangled.org", let handle = parts[0] else { return nil }
    return reverseProfileMatch(.tangled, handle: handle)
}

private func matchReverseMargin(_ host: String, _ parts: ReversePathSegments) -> ReverseMatch? {
    guard host == "margin.at" else { return nil }

    if parts[0] == "profile", let handle = parts[1] {
        return reverseProfileMatch(.margin, handle: handle)
    }

    if let handle = parts[0], let recordType = parts[1], let rkey = parts[2] {
        if recordType == "annotation" || recordType == "highlight" || recordType == "bookmark" {
            return reverseRecordMatch(.margin, handle: handle, collection: "at.margin.\(recordType)", rkey: rkey)
        }
    }

    return nil
}

private struct ReverseAtUriPath {
    let handle: String
    let collection: String?
    let rkey: String?
}

/// The `at://identifier[/collection/rkey]` or `at:/identifier[/collection/rkey]`
/// spelling that follows a route prefix, the web's `^at:\/{1,2}(.+)$`. Both
/// slash counts are accepted because servers and browsers collapse the
/// double slash when the AT URI sits inside a path.
private func parseReverseAtUriSegments(_ cleaned: Substring) -> ReverseAtUriPath? {
    guard cleaned.hasPrefix("at:/") else { return nil }
    var rest = cleaned.dropFirst("at:/".count)
    if rest.hasPrefix("/") { rest = rest.dropFirst() }
    guard !rest.isEmpty else { return nil }
    let segments = rest.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    guard let handle = segments.first else { return nil }
    // Permissioned space addresses must never be handed to a public
    // explorer; see the note in matchReverseAturi. A real NSID never equals
    // `space`, it needs dots.
    if segments.count > 1, segments[1] == "space" { return nil }
    return ReverseAtUriPath(
        handle: handle,
        collection: segments.count > 1 ? segments[1] : nil,
        rkey: segments.count > 2 ? segments[2] : nil
    )
}

/// Parse a path of the form `/at://identifier[/collection/rkey]` used by
/// pdsls.dev, atp.tools and bluepy.social.
private func parseReverseAtUriPath(_ pathname: String) -> ReverseAtUriPath? {
    parseReverseAtUriSegments(pathname.drop(while: { $0 == "/" }))
}

private func reverseAtUriPathMatch(_ source: SourceApp, _ atUri: ReverseAtUriPath) -> ReverseMatch {
    if let collection = atUri.collection, let rkey = atUri.rkey {
        return reverseRecordMatch(source, handle: atUri.handle, collection: collection, rkey: rkey)
    }
    return reverseProfileMatch(source, handle: atUri.handle)
}

private func matchReversePdsls(_ host: String, _ pathname: String) -> ReverseMatch? {
    guard host == "pdsls.dev", let atUri = parseReverseAtUriPath(pathname) else { return nil }
    return reverseAtUriPathMatch(.pdsls, atUri)
}

private func matchReverseAtpTools(_ host: String, _ pathname: String) -> ReverseMatch? {
    guard host == "atp.tools", let atUri = parseReverseAtUriPath(pathname) else { return nil }
    return reverseAtUriPathMatch(.atptools, atUri)
}

private func matchReverseBluepy(_ host: String, _ pathname: String) -> ReverseMatch? {
    guard host == "bluepy.social", let atUri = parseReverseAtUriPath(pathname) else { return nil }
    // Bluepy links the profile record itself; that is the profile, not a
    // record view.
    if atUri.collection == "app.bsky.actor.profile" {
        return reverseProfileMatch(.bluepy, handle: atUri.handle)
    }
    return reverseAtUriPathMatch(.bluepy, atUri)
}

private func matchReverseSemble(_ host: String, _ parts: ReversePathSegments) -> ReverseMatch? {
    guard host == "semble.so", parts[0] == "profile", let handle = parts[1] else { return nil }
    return reverseProfileMatch(.semble, handle: handle)
}

private func matchReverseStreamplace(_ host: String, _ parts: ReversePathSegments) -> ReverseMatch? {
    guard host == "stream.place", let handle = parts[0] else { return nil }
    return reverseProfileMatch(.streamplace, handle: handle)
}

private func matchReverseGrain(_ host: String, _ parts: ReversePathSegments) -> ReverseMatch? {
    guard host == "grain.social", parts[0] == "profile", let handle = parts[1] else { return nil }

    if parts[2] == "gallery", let rkey = parts[3] {
        return reverseRecordMatch(.grain, handle: handle, collection: "social.grain.gallery", rkey: rkey)
    }

    return reverseProfileMatch(.grain, handle: handle)
}

private func matchReversePopfeed(_ host: String, _ parts: ReversePathSegments) -> ReverseMatch? {
    guard host == "popfeed.social", parts[0] == "profile", let handle = parts[1] else { return nil }
    return reverseProfileMatch(.popfeed, handle: handle)
}

private func matchReverseSifa(_ host: String, _ parts: ReversePathSegments) -> ReverseMatch? {
    guard host == "sifa.id", parts[0] == "p", let handle = parts[1] else { return nil }
    return reverseProfileMatch(.sifa, handle: handle)
}

private func matchReverseBlento(_ host: String, _ parts: ReversePathSegments) -> ReverseMatch? {
    guard host == "blento.app", let handle = parts[0] else { return nil }
    return reverseProfileMatch(.blento, handle: handle)
}

/// Standard Reader: `/u/<identifier>` is a profile (document list) and
/// `/a/<identifier>/<rkey>` is a document. The document route omits the
/// collection NSID, but every `/a/` link is a Standard Site document, so the
/// full `site.standard.document/<rkey>` AT URI is reconstructed.
private func matchReverseStandardReader(_ host: String, _ parts: ReversePathSegments) -> ReverseMatch? {
    guard host == "standard-reader.app" else { return nil }

    if parts[0] == "a", let handle = parts[1], let rkey = parts[2] {
        return reverseRecordMatch(.standardReader, handle: handle, collection: "site.standard.document", rkey: rkey)
    }

    if parts[0] == "u", let handle = parts[1] {
        return reverseProfileMatch(.standardReader, handle: handle)
    }

    return nil
}

/// Offprint (offprint.app) and pckt (pckt.blog) address publications at the
/// flat path `/<identifier>/<collection>/<rkey>`: the collection NSID sits in
/// the path verbatim, so it round-trips straight back. Both only expose
/// record-level URLs, so a profile-only path has no meaningful match.
private func matchReverseFlatRecordHost(
    _ host: String,
    _ parts: ReversePathSegments,
    targetHost: String,
    source: SourceApp
) -> ReverseMatch? {
    guard host == targetHost else { return nil }
    guard let handle = parts[0], let collection = parts[1], let rkey = parts[2] else { return nil }
    // Guard against non-record pages (settings, landing, ...): a real record
    // path always carries an NSID collection segment.
    guard collection.contains(".") else { return nil }
    return reverseRecordMatch(source, handle: handle, collection: collection, rkey: rkey)
}

/// Taproot (atproto.at): a generic AT-URI explorer addressed at
/// `/uri/at://<identifier>[/<collection>/<rkey>]`.
private func matchReverseTaproot(_ host: String, _ pathname: String) -> ReverseMatch? {
    guard host == "atproto.at" else { return nil }
    let cleaned = pathname.drop(while: { $0 == "/" })
    guard cleaned.hasPrefix("uri/") else { return nil }
    guard let atUri = parseReverseAtUriSegments(cleaned.dropFirst("uri/".count)) else { return nil }
    return reverseAtUriPathMatch(.taproot, atUri)
}

/// Aturi's own pages. Two URL spaces share the aturi.to host:
///   - `/explore/<identifier>[/<collection>[/<rkey>]]`, the raw record
///     explorer (source `aturiExplore`).
///   - `/profile/<identifier>[/post/<rkey> | /lists/<rkey> | /<collection>/<rkey>]`,
///     the universal-link view (source `aturi`).
///
/// Detecting these lets the picker offer jumps to other clients and explorers
/// while you are already on Aturi. Reporting the source as the matching
/// waypoint (`aturiExplore` vs `aturi`) also keeps the page you are on out of
/// the suggestion list.
private func matchReverseAturi(_ host: String, _ parts: ReversePathSegments) -> ReverseMatch? {
    guard host == "aturi.to" else { return nil }

    // A repo identifier is always a DID (`did:...`) or a dotted handle. This
    // rules out the explorer's own sub-tools, `/explore/lexicons` and
    // `/explore/pds`, whose first segment is a bare word, not an account.
    func isIdentifier(_ segment: String?) -> Bool {
        guard let segment else { return false }
        return segment.hasPrefix("did:") || segment.contains(".")
    }

    // Explorer: /explore/<identifier>[/<collection>[/<rkey>]]
    if parts[0] == "explore", isIdentifier(parts[1]), let handle = parts[1] {
        // `/explore/<did>/space/...` addresses permissioned data. A match here
        // would be handed to the picker as a record other explorers can open,
        // leaking the address of private data to public tools, so the page
        // reads as unrecognised instead. A real NSID never equals `space`; it
        // needs dots.
        if parts[2] == "space" { return nil }
        if let collection = parts[2], let rkey = parts[3] {
            return reverseRecordMatch(.aturiExplore, handle: handle, collection: collection, rkey: rkey)
        }
        // Repo browse or a collection listing (no rkey): treat as
        // profile-level so the picker offers profile waypoints for the
        // identifier.
        return reverseProfileMatch(.aturiExplore, handle: handle)
    }

    // Universal-link view: /profile/<identifier>[/post|/lists|/<collection>/<rkey>]
    if parts[0] == "profile", isIdentifier(parts[1]), let handle = parts[1] {
        if parts[2] == "post", let rkey = parts[3] {
            return reverseRecordMatch(.aturi, handle: handle, collection: "app.bsky.feed.post", rkey: rkey)
        }

        if parts[2] == "lists", let rkey = parts[3] {
            return reverseRecordMatch(.aturi, handle: handle, collection: "app.bsky.graph.list", rkey: rkey)
        }

        // Generic record view: /profile/<identifier>/<collection>/<rkey>.
        // Guard on the dot so non-record profile subpages do not masquerade
        // as records.
        if let collection = parts[2], collection.contains("."), let rkey = parts[3] {
            return reverseRecordMatch(.aturi, handle: handle, collection: collection, rkey: rkey)
        }

        return reverseProfileMatch(.aturi, handle: handle)
    }

    return nil
}

// MARK: - Entry points

/// Reverse-match any supported waypoint site URL back into a structured
/// ParsedURI (handle/collection/rkey). nil when the URL is not on a supported
/// site or is not a shape we recognise.
public func matchSupportedUrl(_ url: URL) -> ReverseMatch? {
    guard let rawHost = url.host, !rawHost.isEmpty else { return nil }
    let host = normalizeReverseHost(rawHost)
    // The percent-encoded path is what the browser's `pathname` exposes; the
    // decoded `url.path` would also drop a trailing slash and turn `%2F` into
    // a segment boundary.
    let pathname = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? url.path
    let parts = ReversePathSegments(pathname: pathname)

    // Same order as the web; the first matcher that recognises the host and
    // shape wins. Every host is claimed by exactly one matcher, so the order
    // only matters for readability.
    let matchers: [() -> ReverseMatch?] = [
        { matchReverseAturi(host, parts) },
        { matchReverseBlueskyFamily(host, parts) },
        { matchReversePinksky(host, parts, url) },
        { matchReverseLeaflet(host, parts) },
        { matchReverseTangled(host, parts) },
        { matchReverseMargin(host, parts) },
        { matchReversePdsls(host, pathname) },
        { matchReverseAtpTools(host, pathname) },
        { matchReverseBluepy(host, pathname) },
        { matchReverseSemble(host, parts) },
        { matchReverseStreamplace(host, parts) },
        { matchReverseGrain(host, parts) },
        { matchReversePopfeed(host, parts) },
        { matchReverseSifa(host, parts) },
        { matchReverseBlento(host, parts) },
        { matchReverseStandardReader(host, parts) },
        { matchReverseFlatRecordHost(host, parts, targetHost: "offprint.app", source: .offprint) },
        { matchReverseFlatRecordHost(host, parts, targetHost: "pckt.blog", source: .pckt) },
        { matchReverseTaproot(host, pathname) },
    ]
    for matcher in matchers {
        if let found = matcher() { return found }
    }
    return nil
}

/// Convenience for pasted or shared text: trims whitespace, parses with
/// Foundation's URL and matches. nil when the text is not an absolute URL
/// with a host, which is where `new URL(...)` would have thrown on the web.
public func matchSupportedUrl(string: String) -> ReverseMatch? {
    let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = URL(string: trimmed) else { return nil }
    return matchSupportedUrl(url)
}

/// Parse an AT URI string (`at://did:plc:abc123/collection/rkey`) into its
/// components. The web's `parseAtUri`, renamed so it does not collide with
/// `AtUri`. Used by head-based detection when an AT URI is found in a
/// `<link>` tag's href attribute, hence the `headDetected` source.
public func reverseParseAtUri(_ uri: String) -> ReverseMatch? {
    guard uri.hasPrefix("at://") else { return nil }
    let segments = uri.dropFirst("at://".count).split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    guard let handle = segments.first else { return nil }
    // Permissioned space addresses must never be handed to a public explorer;
    // see the note in matchReverseAturi.
    if segments.count > 1, segments[1] == "space" { return nil }

    if segments.count > 2 {
        return reverseRecordMatch(.headDetected, handle: handle, collection: segments[1], rkey: segments[2], uri: uri)
    }

    return reverseProfileMatch(.headDetected, handle: handle)
}
