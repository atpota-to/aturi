import SwiftUI
import Observation
import AturiCore

/// The four top-level destinations, in tab-bar order.
enum Tab: String, CaseIterable, Identifiable, Hashable {
    case explore
    case links
    case lexicons
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .explore: return "Explore"
        case .links: return "Links"
        case .lexicons: return "Lexicons"
        case .settings: return "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .explore: return "magnifyingglass"
        case .links: return "link"
        case .lexicons: return "book.closed"
        case .settings: return "gearshape"
        }
    }
}

/// Every screen a `NavigationStack` can push. Values carry raw (decoded)
/// identifiers; the explorer path spelling is derived on the way out.
enum Route: Hashable {
    case repo(String)
    case collection(repo: String, collection: String)
    case record(repo: String, collection: String, rkey: String)
    case pds(host: String)
    case lexicon(nsid: String)
    case lexiconGroup(prefix: String)
    /// The universal-link page: preview card plus waypoint picker.
    case preview(AtUriComponents)
    /// Free-text search results from the explore landing.
    case search(String)
}

extension Route {
    /// The typed reading of an explorer path, when the path names a page
    /// this app models. Nil for the lexicons index, space pages and
    /// anything else `SearchDestination` carries verbatim.
    init?(destination: SearchDestination) {
        switch destination {
        case .repo(let repo):
            self = .repo(repo)
        case .collection(let repo, let collection):
            self = .collection(repo: repo, collection: collection)
        case .record(let repo, let collection, let rkey):
            self = .record(repo: repo, collection: collection, rkey: rkey)
        case .pds(let host):
            self = .pds(host: host)
        case .lexicon(let nsid):
            self = .lexicon(nsid: nsid)
        case .lexiconGroup(let prefix):
            self = .lexiconGroup(prefix: prefix)
        case .explorer:
            return nil
        }
    }

    /// `/explore/...` as the web's link builders spell it.
    init?(explorePath: String) {
        self.init(destination: SearchDestination(explorePath: explorePath))
    }

    /// An `at://` URI as an explorer route. Nil for non-AT input and for
    /// space addresses, which have no public page.
    init?(atUri: String) {
        guard let uri = AtUri(parsing: atUri) else { return nil }
        if let collection = uri.collection, !collection.isEmpty {
            if let rkey = uri.rkey, !rkey.isEmpty {
                self = .record(repo: uri.repo, collection: collection, rkey: rkey)
            } else {
                self = .collection(repo: uri.repo, collection: collection)
            }
        } else {
            self = .repo(uri.repo)
        }
    }

    /// The explorer destination behind this route; nil for the preview
    /// page and search results, which are not explorer pages.
    var destination: SearchDestination? {
        switch self {
        case .repo(let repo):
            return .repo(repo)
        case .collection(let repo, let collection):
            return .collection(repo: repo, collection: collection)
        case .record(let repo, let collection, let rkey):
            return .record(repo: repo, collection: collection, rkey: rkey)
        case .pds(let host):
            return .pds(host: host)
        case .lexicon(let nsid):
            return .lexicon(nsid: nsid)
        case .lexiconGroup(let prefix):
            return .lexiconGroup(prefix: prefix)
        case .preview, .search:
            return nil
        }
    }

    /// The canonical `/explore/...` path, for copy rows and history.
    var explorePath: String? {
        destination?.explorePath
    }

    /// The aturi.to page for this route, for share sheets. Nil for search.
    var webURL: URL? {
        switch self {
        case .preview(let components):
            return URL(string: generateAturiLink(components))
        case .search:
            return nil
        default:
            guard let path = explorePath else { return nil }
            return URL(string: Endpoints.aturiBase.absoluteString + path)
        }
    }

    /// The tab a route belongs to when nothing else decides: universal
    /// links land on Links, lexicon pages on Lexicons, the rest on Explore.
    var defaultTab: Tab {
        switch self {
        case .preview:
            return .links
        case .lexicon, .lexiconGroup:
            return .lexicons
        case .repo, .collection, .record, .pds, .search:
            return .explore
        }
    }
}

/// What a URL maps to: a route pushed on a tab, or a tab's root.
enum DeepLinkTarget: Hashable {
    case route(Route, tab: Tab)
    case tabRoot(Tab)
}

/// Pure URL-to-target mapping, kept separate from the router so it can be
/// exercised without a `NavigationPath`. The grammar follows the web's
/// route tree: `/profile/*` and the bare `/{handle}` forms are the
/// universal-link pages (Links tab); `/explore/*` is the explorer;
/// `/at/*`, `/at:*` and the `at` scheme land on the explorer too, as the
/// web's `/at/[...slug]` redirect sends pasted AT URIs there.
enum DeepLinks {
    /// `aturi://open?url=` can wrap a link that wraps another; two levels
    /// is already more than the share extension produces.
    private static let maxNesting = 2

    /// Top-level aturi.to pages that are not handles even though the
    /// segment carries a dot.
    private static let fileSuffixes = [".md", ".txt", ".json", ".xml"]

    static func target(for url: URL) -> DeepLinkTarget? {
        target(for: url.absoluteString)
    }

    static func target(for string: String) -> DeepLinkTarget? {
        target(for: string, depth: 0)
    }

    private static func target(for string: String, depth: Int) -> DeepLinkTarget? {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = LinkParts(trimmed) else { return nil }

        switch parts.scheme {
        case "at":
            return Route(atUri: trimmed).map { DeepLinkTarget.route($0, tab: .explore) }

        case "aturi":
            /* The app's own scheme: `aturi://open?url=<encoded link>` from
               the share extension. The wrapped link goes through the same
               grammar, so an unsupported page is refused here and the
               caller hands it to Safari. */
            guard parts.host == "open", depth < maxNesting, let inner = parts.query["url"] else { return nil }
            return target(for: inner, depth: depth + 1)

        case "http", "https":
            if parts.host == Endpoints.aturiHost {
                return aturiTarget(segments: parts.pathSegments)
            }
            guard let url = URL(string: trimmed), let match = matchSupportedUrl(url) else { return nil }
            let parsed = match.parsed
            let components = AtUriComponents(
                identifier: parsed.handle,
                collection: nonEmpty(parsed.collection),
                rkey: nonEmpty(parsed.rkey)
            )
            return .route(.preview(components), tab: .links)

        default:
            // `to.aturi:` (the OAuth redirect) and anything else is not a page.
            return nil
        }
    }

    /// aturi.to paths. `segments` are the percent-encoded path segments;
    /// identifiers are decoded here because they are handed to resolvers
    /// raw, while the explorer ladder decodes through `SearchDestination`.
    private static func aturiTarget(segments: [String]) -> DeepLinkTarget? {
        guard let first = segments.first else { return .tabRoot(.links) }
        let rest = Array(segments.dropFirst())

        switch first {
        case "explore":
            return exploreTarget(rest)

        case "links":
            return .tabRoot(.links)

        case "account":
            return .tabRoot(.settings)

        case "profile":
            guard let handle = rest.first.map(decode), !handle.isEmpty else { return nil }
            switch rest.count {
            case 1:
                return .route(.preview(AtUriComponents(identifier: handle)), tab: .links)
            case 3:
                let segment = rest[1]
                let rkey = decode(rest[2])
                let collection: String
                if segment == "post" {
                    collection = "app.bsky.feed.post"
                } else if segment == "lists" || segment == "list" {
                    collection = "app.bsky.graph.list"
                } else {
                    collection = decode(segment)
                }
                guard !rkey.isEmpty, !collection.isEmpty else { return nil }
                return .route(.preview(AtUriComponents(identifier: handle, collection: collection, rkey: rkey)), tab: .links)
            default:
                return nil
            }

        case "at", "at:":
            /* `/at/{repo}[/{collection}/{rkey}]`, `/at://{repo}/...` and
               `/at:/{repo}/...` all split to the same segments once the
               empty ones between the slashes are dropped. */
            return atPathTarget(rest)

        default:
            /* Bare `/{handle}[/{collection}/{rkey}]`. Only a segment that
               spells a handle or a DID qualifies; `/about`, `/docs` and the
               served files (`/llms.txt`, `/openapi.json`) stay with Safari. */
            let identifier = decode(first)
            guard !fileSuffixes.contains(where: { identifier.lowercased().hasSuffix($0) }) else { return nil }
            guard identifier.hasPrefix("did:") || isValidHandle(identifier) else { return nil }
            switch segments.count {
            case 1:
                return .route(.preview(AtUriComponents(identifier: identifier)), tab: .links)
            case 3:
                let collection = decode(segments[1])
                let rkey = decode(segments[2])
                guard collection.contains("."), !rkey.isEmpty else { return nil }
                return .route(.preview(AtUriComponents(identifier: identifier, collection: collection, rkey: rkey)), tab: .links)
            default:
                return nil
            }
        }
    }

    /// `/explore/...`: the ladder `SearchDestination` already decodes, plus
    /// the two index pages that have a tab of their own.
    private static func exploreTarget(_ rest: [String]) -> DeepLinkTarget? {
        if rest.isEmpty { return .tabRoot(.explore) }
        let path = "/explore/" + rest.joined(separator: "/")
        let destination = SearchDestination(explorePath: path)
        if let route = Route(destination: destination) {
            return .route(route, tab: route.defaultTab)
        }
        // Index pages the destination type carries verbatim.
        if rest == ["lexicons"] { return .tabRoot(.lexicons) }
        if rest == ["pds"] { return .tabRoot(.explore) }
        // Space pages and anything future: not modelled here.
        return nil
    }

    /// `/at/...` segments as an explorer route.
    private static func atPathTarget(_ rest: [String]) -> DeepLinkTarget? {
        let decoded = rest.map(decode)
        guard let repo = decoded.first, !repo.isEmpty else { return nil }
        if decoded.count > 1, decoded[1] == "space" { return nil }
        switch decoded.count {
        case 1:
            return .route(.repo(repo), tab: .explore)
        case 2:
            return .route(.collection(repo: repo, collection: decoded[1]), tab: .explore)
        case 3:
            return .route(.record(repo: repo, collection: decoded[1], rkey: decoded[2]), tab: .explore)
        default:
            return nil
        }
    }

    private static func decode(_ segment: String) -> String {
        segment.removingPercentEncoding ?? segment
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }
}

/// A hand-parsed URL. Foundation's `URL` is avoided on purpose: `at://`
/// authorities carry colons (`did:plc:...`) that read as ports, and a
/// literal `at://` inside an https path confuses the RFC 3986 parser.
/// Enough of the grammar to route on: scheme, host, path and query.
private struct LinkParts {
    let scheme: String
    /// Lowercased, without a `www.` prefix; empty for scheme-only URLs
    /// such as `to.aturi:/oauth/callback`.
    let host: String
    /// Percent-encoded, leading slash kept.
    let path: String
    let query: [String: String]

    init?(_ raw: String) {
        guard let colon = raw.firstIndex(of: ":") else { return nil }
        let schemePart = raw[..<colon]
        guard let head = schemePart.first, head.isLetter,
              schemePart.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "+" || $0 == "-" || $0 == "." })
        else { return nil }
        scheme = schemePart.lowercased()

        var rest = raw[raw.index(after: colon)...]
        if let hash = rest.firstIndex(of: "#") {
            rest = rest[..<hash]
        }
        var queryPart: Substring = ""
        if let question = rest.firstIndex(of: "?") {
            queryPart = rest[rest.index(after: question)...]
            rest = rest[..<question]
        }

        if rest.hasPrefix("//") {
            let authorityAndPath = rest.dropFirst(2)
            if let slash = authorityAndPath.firstIndex(of: "/") {
                host = LinkParts.normalizeHost(authorityAndPath[..<slash])
                path = String(authorityAndPath[slash...])
            } else {
                host = LinkParts.normalizeHost(authorityAndPath)
                path = ""
            }
        } else {
            host = ""
            path = String(rest)
        }

        var items: [String: String] = [:]
        for pair in queryPart.split(separator: "&") {
            let keyValue = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            let key = String(keyValue[0]).removingPercentEncoding ?? String(keyValue[0])
            let value = keyValue.count > 1 ? (String(keyValue[1]).removingPercentEncoding ?? String(keyValue[1])) : ""
            if items[key] == nil {
                items[key] = value
            }
        }
        query = items
    }

    /// Non-empty path segments, still percent-encoded.
    var pathSegments: [String] {
        path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    }

    private static func normalizeHost(_ authority: Substring) -> String {
        var host = authority
        if let at = host.lastIndex(of: "@") {
            host = host[host.index(after: at)...]
        }
        var lowered = host.lowercased()
        if lowered.hasPrefix("www.") {
            lowered.removeFirst("www.".count)
        }
        return lowered
    }
}

/// Navigation state for the whole app: one path per tab plus the selected
/// tab. Screens push by value (`open`), incoming URLs are mapped by
/// `DeepLinks` and applied here.
@MainActor
@Observable
final class AppRouter {
    var selectedTab: Tab = .explore
    var explorePath = NavigationPath()
    var linksPath = NavigationPath()
    var lexiconsPath = NavigationPath()
    var settingsPath = NavigationPath()

    init() {}

    /// Push a route. Without a tab it goes on the stack the person is
    /// looking at, so a lexicon tapped on a record page stays in Explore.
    func open(_ route: Route, in tab: Tab? = nil) {
        let target = tab ?? selectedTab
        if target != selectedTab {
            selectedTab = target
        }
        switch target {
        case .explore: explorePath.append(route)
        case .links: linksPath.append(route)
        case .lexicons: lexiconsPath.append(route)
        case .settings: settingsPath.append(route)
        }
    }

    /// `open` for an `at://` URI or bare DID found in record JSON. False
    /// when the string is not an AT URI this app has a page for.
    @discardableResult
    func open(atUri: String, in tab: Tab? = nil) -> Bool {
        let route: Route?
        if isValidDid(atUri) {
            route = .repo(atUri)
        } else {
            route = Route(atUri: atUri)
        }
        guard let route else { return false }
        open(route, in: tab)
        return true
    }

    func popToRoot(_ tab: Tab? = nil) {
        switch tab ?? selectedTab {
        case .explore: explorePath = NavigationPath()
        case .links: linksPath = NavigationPath()
        case .lexicons: lexiconsPath = NavigationPath()
        case .settings: settingsPath = NavigationPath()
        }
    }

    func select(_ tab: Tab) {
        selectedTab = tab
    }

    /// Route an incoming URL. False for links the app has no page for, so
    /// the caller can hand them to Safari.
    @discardableResult
    func handle(url: URL) -> Bool {
        guard let target = DeepLinks.target(for: url) else { return false }
        apply(target)
        return true
    }

    /// `handle(url:)` for pasted text and strings Foundation's `URL`
    /// refuses (an `at://` URI with a DID authority).
    @discardableResult
    func handle(string: String) -> Bool {
        guard let target = DeepLinks.target(for: string) else { return false }
        apply(target)
        return true
    }

    private func apply(_ target: DeepLinkTarget) {
        switch target {
        case .tabRoot(let tab):
            popToRoot(tab)
            selectedTab = tab
        case .route(let route, let tab):
            open(route, in: tab)
        }
    }
}
