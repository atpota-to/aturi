import Foundation

/// The app's top-level sections, as a link can name them. The app's tab
/// bar maps onto these one to one.
public enum LinkSection: String, Hashable, Sendable, CaseIterable {
    case explore
    case links
    case lexicons
    case tools
    case settings
}

/// Where an incoming link points, before the app turns it into a screen.
public enum DeepLinkDestination: Hashable, Sendable {
    /// The universal-link page: preview card plus waypoint picker.
    case preview(AtUriComponents)
    /// An explorer page, never `.explorer(path:)`: a path the port does
    /// not model is refused instead. `repoTab` is the tab a repo page
    /// opens on, one of `DeepLinkRouting.repoTabs` other than the default,
    /// and only ever set on `.repo`.
    case explore(SearchDestination, repoTab: String? = nil)
    /// The lexicons index on one of its ranked lists, one of
    /// `DeepLinkRouting.lexiconLists`: a link's `?list=`, or `#new`, the
    /// anchor of the web's New card that its "All new lexicons" links to.
    case lexiconList(String)
    /// A section's root page.
    case section(LinkSection)
    /// A tool's page, `/tools/{slug}`, with the query it reads its input
    /// from (each tool's `useToolQuery` keys). Only slugs in `ToolCatalog`.
    case tool(slug: String, query: [String: String])
}

/// Pure URL-to-destination mapping for the app's deep links, kept here
/// rather than in the app target so it can be tested. The grammar follows
/// the web's route tree: `/profile/*` and the bare `/{handle}` forms are
/// the universal-link pages; `/explore/*` is the explorer, with the query
/// its pages read (`?tab=` on a repo, `?list=`, `?ns=`, `?q=` and `#new` on
/// the lexicons index); `/at/*`, `/at:*` and the `at` scheme land on the
/// explorer too, as the web's `/at/[...slug]` redirect sends pasted AT URIs
/// there; `aturi://open?url=` is the share extension's wrapper around any
/// of these; and a supported client's own link (bsky.app and the rest of
/// the catalog) is the preview page for what it names.
public enum DeepLinkRouting {
    /// `aturi://open?url=` can wrap a link that wraps another; two levels
    /// is already more than the share extension produces.
    static let maxNesting = 2

    /// Top-level aturi.to pages that are not handles even though the
    /// segment carries a dot.
    static let fileSuffixes = [".md", ".txt", ".json", ".xml"]

    /// The repo page's tabs as the web spells them in `?tab=` (`TABS` in
    /// `RepoExplorer.tsx`), in its order. A value outside this list opens
    /// the default, as it does on the web; one the app has no tab for yet
    /// is passed along and left to the repo page to ignore.
    public static let repoTabs = ["collections", "labels", "visibility", "identity", "audit", "backlinks", "graph"]

    /// The tab a repo page opens on with no `?tab=`; the web drops it from
    /// the address rather than spelling it out.
    public static let defaultRepoTab = "collections"

    /// The lexicons index's ranked lists (`LEXICON_LISTS` in
    /// `src/lib/lexiconExplorer.ts`).
    public static let lexiconLists = ["trending", "top", "new", "all"]

    public static func destination(for string: String) -> DeepLinkDestination? {
        destination(for: string, depth: 0)
    }

    /// Whether the link carries the web's `?stay=1`, looking through the
    /// share extension's `aturi://open?url=` wrapper.
    public static func asksToStay(_ string: String) -> Bool {
        asksToStay(string, depth: 0)
    }

    /// The hash of an `aturi.to/account` link, lowercased: `redirects` for
    /// `/account#redirects`, as the web's `SettingsShell` reads it, looking
    /// through the share extension's `aturi://open?url=` wrapper as
    /// `destination` does. Nil for any other link, and for an account link
    /// without one.
    public static func settingsFragment(for string: String) -> String? {
        settingsFragment(for: string, depth: 0)
    }

    private static func settingsFragment(for string: String, depth: Int) -> String? {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = LinkParts(trimmed) else { return nil }
        if parts.scheme == "aturi" {
            guard parts.host == "open", depth < maxNesting, let inner = parts.query["url"] else { return nil }
            return settingsFragment(for: inner, depth: depth + 1)
        }
        guard parts.scheme == "https" || parts.scheme == "http",
              parts.host == Endpoints.aturiHost, parts.pathSegments == ["account"],
              !parts.fragment.isEmpty
        else { return nil }
        return parts.fragment.lowercased()
    }

    /// `?tab=` on a repo page, when it names a tab other than the default.
    /// Compared exactly, as `TabbedView` in `RepoExplorer.tsx` does.
    static func repoTab(from query: [String: String]) -> String? {
        guard let tab = query["tab"], tab != defaultRepoTab, repoTabs.contains(tab) else { return nil }
        return tab
    }

    // MARK: Grammar

    private static func asksToStay(_ string: String, depth: Int) -> Bool {
        guard let parts = LinkParts(string.trimmingCharacters(in: .whitespacesAndNewlines)) else { return false }
        if parts.scheme == "aturi" {
            guard parts.host == "open", depth < maxNesting, let inner = parts.query["url"] else { return false }
            return asksToStay(inner, depth: depth + 1)
        }
        return parts.query["stay"] == "1"
    }

    private static func destination(for string: String, depth: Int) -> DeepLinkDestination? {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = LinkParts(trimmed) else { return nil }

        switch parts.scheme {
        case "at":
            return atUriDestination(trimmed)

        case "aturi":
            /* The app's own scheme: `aturi://open?url=<encoded link>` from
               the share extension. The wrapped link goes through the same
               grammar, so an unsupported page is refused here and the
               caller hands it to Safari. */
            guard parts.host == "open", depth < maxNesting, let inner = parts.query["url"] else { return nil }
            return destination(for: inner, depth: depth + 1)

        case "http", "https":
            if parts.host == Endpoints.aturiHost {
                return aturiDestination(parts)
            }
            guard let url = URL(string: trimmed), let match = matchSupportedUrl(url) else { return nil }
            let parsed = match.parsed
            return .preview(AtUriComponents(
                identifier: parsed.handle,
                collection: nonEmpty(parsed.collection),
                rkey: nonEmpty(parsed.rkey)
            ))

        default:
            // `to.aturi:` (the OAuth redirect) and anything else is not a page.
            return nil
        }
    }

    /// An `at://` URI as the explorer page for as much as it names. Nil for
    /// non-AT input and for space addresses, which have no public page.
    private static func atUriDestination(_ string: String) -> DeepLinkDestination? {
        guard let uri = AtUri(parsing: string) else { return nil }
        if let collection = uri.collection, !collection.isEmpty {
            if let rkey = uri.rkey, !rkey.isEmpty {
                return .explore(.record(repo: uri.repo, collection: collection, rkey: rkey))
            }
            return .explore(.collection(repo: uri.repo, collection: collection))
        }
        return .explore(.repo(uri.repo))
    }

    /// aturi.to paths. The path segments are percent-encoded; identifiers
    /// are decoded here because they are handed to resolvers raw, while the
    /// explorer ladder decodes through `SearchDestination`.
    private static func aturiDestination(_ parts: LinkParts) -> DeepLinkDestination? {
        let segments = parts.pathSegments
        guard let first = segments.first else { return .section(.links) }
        let rest = Array(segments.dropFirst())

        switch first {
        case "explore":
            return exploreDestination(rest, query: parts.query, fragment: parts.fragment)

        case "links":
            return .section(.links)

        case "account":
            return .section(.settings)

        case "tools":
            /* The hub, or one tool by its catalog slug; the query is the
               tool's input, which it keeps in the address on the web. */
            guard let slug = rest.first else { return .section(.tools) }
            guard rest.count == 1, ToolCatalog.tool(slug) != nil else { return nil }
            return .tool(slug: slug, query: parts.query)

        case "profile":
            guard let handle = rest.first.map(decode), !handle.isEmpty else { return nil }
            switch rest.count {
            case 1:
                return .preview(AtUriComponents(identifier: handle))
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
                return .preview(AtUriComponents(identifier: handle, collection: collection, rkey: rkey))
            default:
                return nil
            }

        case "at", "at:":
            /* `/at/{repo}[/{collection}/{rkey}]`, `/at://{repo}/...` and
               `/at:/{repo}/...` all split to the same segments once the
               empty ones between the slashes are dropped. */
            return atPathDestination(rest)

        default:
            /* Bare `/{handle}[/{collection}/{rkey}]`. Only a segment that
               spells a handle or a DID qualifies; `/about`, `/docs` and the
               served files (`/llms.txt`, `/openapi.json`) stay with Safari. */
            let identifier = decode(first)
            guard !fileSuffixes.contains(where: { identifier.lowercased().hasSuffix($0) }) else { return nil }
            guard identifier.hasPrefix("did:") || isValidHandle(identifier) else { return nil }
            switch segments.count {
            case 1:
                return .preview(AtUriComponents(identifier: identifier))
            case 3:
                let collection = decode(segments[1])
                let rkey = decode(segments[2])
                guard collection.contains("."), !rkey.isEmpty else { return nil }
                return .preview(AtUriComponents(identifier: identifier, collection: collection, rkey: rkey))
            default:
                return nil
            }
        }
    }

    /// `/explore/...`: the ladder `SearchDestination` already decodes, a
    /// repo page's `?tab=`, and the two index pages that are sections of
    /// their own.
    private static func exploreDestination(_ rest: [String], query: [String: String], fragment: String) -> DeepLinkDestination? {
        if rest.isEmpty { return .section(.explore) }
        let destination = SearchDestination(explorePath: "/explore/" + rest.joined(separator: "/"))
        switch destination {
        case .explorer:
            break
        case .repo:
            return .explore(destination, repoTab: repoTab(from: query))
        default:
            return .explore(destination)
        }
        // Index pages the destination type carries verbatim.
        if rest == ["lexicons"] { return lexiconsIndexDestination(query: query, fragment: fragment) }
        if rest == ["pds"] { return .section(.explore) }
        // Space pages and anything future: not modelled here.
        return nil
    }

    /* `/explore/lexicons` with the web's query, read in the order
       `parseLexiconLocation` reads it: a named list wins, then a dotted
       namespace (`?ns=`), then a search (`?q=`). A namespace or a search
       opens the group page, which lists a dotted prefix's namespace and
       searches anything else, as the web's group route does. Failing all
       three, `#new` is the anchor of the page's New card. */
    private static func lexiconsIndexDestination(query: [String: String], fragment: String) -> DeepLinkDestination {
        if let list = query["list"], lexiconLists.contains(list) {
            return .lexiconList(list)
        }
        if let namespace = trimmedValue(query["ns"]), namespace.contains(".") {
            return .explore(.lexiconGroup(prefix: namespace))
        }
        if let term = trimmedValue(query["q"]) {
            return .explore(.lexiconGroup(prefix: term))
        }
        if fragment == "new" {
            return .lexiconList("new")
        }
        return .section(.lexicons)
    }

    /// `/at/...` segments as an explorer page.
    private static func atPathDestination(_ rest: [String]) -> DeepLinkDestination? {
        let decoded = rest.map(decode)
        guard let repo = decoded.first, !repo.isEmpty else { return nil }
        if decoded.count > 1, decoded[1] == "space" { return nil }
        switch decoded.count {
        case 1:
            return .explore(.repo(repo))
        case 2:
            return .explore(.collection(repo: repo, collection: decoded[1]))
        case 3:
            return .explore(.record(repo: repo, collection: decoded[1], rkey: decoded[2]))
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

    private static func trimmedValue(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// A hand-parsed URL. Foundation's `URL` is avoided on purpose: `at://`
/// authorities carry colons (`did:plc:...`) that read as ports, and a
/// literal `at://` inside an https path confuses the RFC 3986 parser.
/// Enough of the grammar to route on: scheme, host, path, query and
/// fragment.
struct LinkParts: Hashable, Sendable {
    let scheme: String
    /// Lowercased, without a `www.` prefix; empty for scheme-only URLs
    /// such as `to.aturi:/oauth/callback`.
    let host: String
    /// Percent-encoded, leading slash kept.
    let path: String
    /// Decoded; the first value wins when a key repeats.
    let query: [String: String]
    /// Everything after the first `#`, as written; empty without one.
    let fragment: String

    init?(_ raw: String) {
        guard let colon = raw.firstIndex(of: ":") else { return nil }
        let schemePart = raw[..<colon]
        guard let head = schemePart.first, head.isLetter,
              schemePart.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "+" || $0 == "-" || $0 == "." })
        else { return nil }
        scheme = schemePart.lowercased()

        var rest = raw[raw.index(after: colon)...]
        if let hash = rest.firstIndex(of: "#") {
            fragment = String(rest[rest.index(after: hash)...])
            rest = rest[..<hash]
        } else {
            fragment = ""
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

        /* Form encoding, as `URLSearchParams` reads and writes it: a `+` is a
           space (the web's lexicon links spell `?q=two+words`), and a
           literal plus arrives as `%2B`, which `URIEncoding.encodeComponent`
           also writes for the share extension's `?url=`. */
        func decode(_ raw: Substring) -> String {
            let spaced = raw.replacingOccurrences(of: "+", with: " ")
            return spaced.removingPercentEncoding ?? spaced
        }
        var items: [String: String] = [:]
        for pair in queryPart.split(separator: "&") {
            let keyValue = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            let key = decode(keyValue[0])
            let value = keyValue.count > 1 ? decode(keyValue[1]) : ""
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
