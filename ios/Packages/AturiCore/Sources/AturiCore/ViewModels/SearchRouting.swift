import Foundation

// Port of src/utils/atproto/searchRouting.ts: the explorer search box's
// input routing. Given a free-form string, decide which explorer page the
// user most likely wants: at:// URIs, Aturi's own links, known waypoint
// URLs, PDS hosts, and finally a handle or DID for repo lookup.
//
// Permissioned space addresses (`at://{did}/space/...`, `/explore/{id}/space/...`)
// are not supported on iOS. Where the web routes them to the space pages,
// this port refuses them (an at:// space address yields nil and an aturi.to
// space URL falls through to the low-confidence PDS guess, the same outcome
// the web produces for a malformed space path), so a private address is
// never rewritten into a public record path.

/// A routing decision plus how confident it is. `pdsGuess` marks the one
/// low-confidence branch: an http(s) URL that could not be reverse-parsed,
/// where treating the host as a PDS is a guess rather than a match. That is
/// the branch `resolveSearchPathAsync` upgrades by asking aturi.to's AT Tags
/// endpoint what record the page is about.
public enum SearchTarget: Hashable, Sendable {
    case match(path: String)
    case pdsGuess(path: String, url: String)

    /// The explorer path either branch lands on.
    public var path: String {
        switch self {
        case .match(let path): return path
        case .pdsGuess(let path, _): return path
        }
    }

    public var isGuess: Bool {
        if case .pdsGuess = self { return true }
        return false
    }
}

/// A typed reading of an explorer path, for the app's `Route` enum. The
/// web navigates by path string; the app navigates by value, and the two
/// convert with `init(explorePath:)` and `explorePath`. Segments are
/// percent-decoded on the way in and re-encoded on the way out, so a value
/// carries the raw repo, collection and rkey.
public enum SearchDestination: Hashable, Sendable {
    case repo(String)
    case collection(repo: String, collection: String)
    case record(repo: String, collection: String, rkey: String)
    case pds(host: String)
    case lexicon(nsid: String)
    case lexiconGroup(prefix: String)
    /// An explorer path this port does not model as a value (the lexicons
    /// index, a space page, anything future), carried verbatim.
    case explorer(path: String)

    public init(explorePath path: String) {
        let parts = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard parts.count >= 2, parts[0] == "explore" else {
            self = .explorer(path: path)
            return
        }
        let head = parts[1]
        if head == "pds" {
            if parts.count == 3 {
                self = .pds(host: SearchDestination.decode(parts[2]))
            } else {
                self = .explorer(path: path)
            }
            return
        }
        if head == "lexicons" {
            if parts.count == 3 {
                self = .lexicon(nsid: SearchDestination.decode(parts[2]))
            } else if parts.count == 4, parts[2] == "group" {
                self = .lexiconGroup(prefix: SearchDestination.decode(parts[3]))
            } else {
                self = .explorer(path: path)
            }
            return
        }
        // The route tree reserves `pds`, `lexicons` and `spaces`; every other
        // first segment is `[repo]`, which is how the search box routes any
        // text it does not recognise, dotted or not.
        if head == "spaces" {
            self = .explorer(path: path)
            return
        }
        let repo = SearchDestination.decode(head)
        if parts.count >= 3, parts[2] == "space" {
            self = .explorer(path: path)
            return
        }
        switch parts.count {
        case 2:
            self = .repo(repo)
        case 3:
            self = .collection(repo: repo, collection: SearchDestination.decode(parts[2]))
        case 4:
            self = .record(repo: repo, collection: SearchDestination.decode(parts[2]), rkey: SearchDestination.decode(parts[3]))
        default:
            self = .explorer(path: path)
        }
    }

    /// The canonical explorer path, spelled the way the web's link builders
    /// spell it: `encodeRepo` on the repo segment, `encodeURIComponent` on
    /// the rkey and on host / NSID query-ish segments.
    public var explorePath: String {
        switch self {
        case .repo(let repo):
            return "/explore/\(encodeRepo(repo))"
        case .collection(let repo, let collection):
            return "/explore/\(encodeRepo(repo))/\(collection)"
        case .record(let repo, let collection, let rkey):
            return "/explore/\(encodeRepo(repo))/\(collection)/\(URIEncoding.encodeComponent(rkey))"
        case .pds(let host):
            return "/explore/pds/\(URIEncoding.encodeComponent(host))"
        case .lexicon(let nsid):
            return NSID.lexiconPathFor(nsid)
        case .lexiconGroup(let prefix):
            return NSID.groupPathFor(prefix)
        case .explorer(let path):
            return path
        }
    }

    /// The repo the destination is about, for history enrichment and the
    /// "your repo" chip; nil for PDS and lexicon pages.
    public var repo: String? {
        switch self {
        case .repo(let repo), .collection(let repo, _), .record(let repo, _, _):
            return repo
        default:
            return nil
        }
    }

    /// `decodeURIComponent` with the web's "malformed escapes are left
    /// alone" behaviour.
    private static func decode(_ segment: String) -> String {
        segment.removingPercentEncoding ?? segment
    }
}

public enum SearchRouting {
    /// Where the low-confidence branch asks about a page's AT Tags. The
    /// endpoint is aturi.to's own (`src/app/api/at-tags/route.ts`): it
    /// fetches the page server-side with the SSRF guard and byte cap the
    /// app should not re-implement.
    public static let atTagsPath = "/api/at-tags"

    /// Port of `resolveSearchTarget`. Nil for blank input and for an at://
    /// URI that names nothing (or a space address, see the file comment).
    public static func resolveSearchTarget(_ rawInput: String) -> SearchTarget? {
        let value = rawInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }

        // 1. at:// URIs: drill down as far as the URI allows.
        // `explorePath(fromAtUri:)` walks the same repo -> collection -> rkey
        // ladder, so routing goes through it rather than re-deriving it.
        if value.hasPrefix("at://") {
            return AturiCore.explorePath(fromAtUri: value).map { .match(path: $0) }
        }

        // 2. Explicit URL. Anything with a protocol is a URL, not a handle.
        if hasHTTPScheme(value) {
            // 2a. Aturi's own links and known waypoint apps (bsky.app,
            //     pdsls.dev, ...): reverse-parse back into repo/collection/
            //     rkey and drill into that record. A URL Foundation cannot
            //     parse falls through to PDS host handling, where the web's
            //     `new URL` would have thrown.
            if let url = URL(string: value), let host = url.host, !host.isEmpty {
                if let own = explorePath(fromAturiURL: url) {
                    return .match(path: own)
                }
                if let found = matchSupportedUrl(url) {
                    return .match(path: explorePath(fromParsed: found.parsed))
                }
            }

            // 2b. Otherwise treat it as a PDS host. Path, query and fragment
            //     are stripped down to the host so a pasted `/xrpc/...` URL
            //     still lands on the right page. A guess, not a match: the
            //     async resolver gets a chance to beat it with the page's
            //     own AT Tags before anyone is sent to a PDS page that may
            //     not exist.
            let host = PDSServer.pdsHostname(value)
            if !host.isEmpty {
                return .pdsGuess(path: "/explore/pds/\(URIEncoding.encodeComponent(host))", url: value)
            }
            return nil
        }

        // 3. Bare `pds.<domain>` shortcut.
        if looksLikeBarePdsHostname(value) {
            return .match(path: "/explore/pds/\(URIEncoding.encodeComponent(value))")
        }

        // 4. Default: treat as handle or DID.
        return .match(path: "/explore/\(encodeRepo(value))")
    }

    /// Synchronous routing: the path of `resolveSearchTarget`, used where a
    /// network round trip is not wanted.
    public static func resolveSearchPath(_ rawInput: String) -> String? {
        resolveSearchTarget(rawInput)?.path
    }

    /// `resolveSearchPath` as a typed destination.
    public static func resolveSearchDestination(_ rawInput: String) -> SearchDestination? {
        resolveSearchPath(rawInput).map(SearchDestination.init(explorePath:))
    }

    /// Port of `resolveSearchPathAsync`: identical to `resolveSearchPath`
    /// for everything it already understands. For an unrecognised URL,
    /// instead of blindly treating the host as a PDS, aturi.to is asked what
    /// atproto record the page declares about itself (the AT Tags proposal)
    /// and the canonical one wins. Never throws and never blocks past the
    /// HTTP client's timeout: any failure (offline, no tags, malformed)
    /// falls back to the synchronous guess.
    public static func resolveSearchPathAsync(_ rawInput: String, http: HTTPClient = .shared) async -> String? {
        guard let target = resolveSearchTarget(rawInput) else { return nil }
        guard case .pdsGuess(let guessedPath, let pageURL) = target else { return target.path }

        if let body = try? await http.getJSONValue(from: atTagsURL(for: pageURL)),
           body["ok"]?.boolValue == true,
           let primary = body["primary"]?.stringValue, !primary.isEmpty,
           let path = AturiCore.explorePath(fromAtUri: primary) {
            return path
        }
        return guessedPath
    }

    /// `https://aturi.to/api/at-tags?url=<encoded page url>`.
    public static func atTagsURL(for pageURL: String) -> URL {
        makeURL(Endpoints.aturiBase, path: atTagsPath, query: [("url", pageURL)])
    }

    /// Turn a reverse-parsed waypoint URL (a bsky.app post, a pdsls record,
    /// ...) into the explorer path that shows the same record. Drills down
    /// as far as the parsed components allow: repo -> collection -> rkey.
    public static func explorePath(fromParsed parsed: ParsedURI) -> String {
        let repo = encodeRepo(parsed.handle)
        if let collection = parsed.collection, !collection.isEmpty {
            if let rkey = parsed.rkey, !rkey.isEmpty {
                return "/explore/\(repo)/\(collection)/\(URIEncoding.encodeComponent(rkey))"
            }
            return "/explore/\(repo)/\(collection)"
        }
        return "/explore/\(repo)"
    }

    /// Aturi's own links (the main app's `/profile/...` shapes and the
    /// explorer's `/explore/...` shapes) route straight back into the
    /// explorer. Pasting an `aturi.to` URL should land on the same record
    /// rather than being treated as a PDS host, so our own domain is
    /// recognised explicitly. Nil for any other host and for a space path.
    ///
    /// Works on the percent-encoded path, as `URL.pathname` does on the web:
    /// the repo segment goes through `encodeRepo` and the rkey through
    /// `encodeURIComponent` exactly as they would there.
    public static func explorePath(fromAturiURL url: URL) -> String? {
        guard let rawHost = url.host else { return nil }
        var host = rawHost.lowercased()
        if host.hasPrefix("www.") { host.removeFirst("www.".count) }
        guard host == Endpoints.aturiHost else { return nil }

        let pathname = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? url.path
        let parts = pathname.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard let first = parts.first else { return nil }

        // `/explore/<id>[/<collection>[/<rkey>]]`: already an explorer path.
        if first == "explore" {
            // `/explore/<authority>/space/...` is a permissioned address.
            // Unsupported here; rebuilding it through the repo/collection/
            // rkey ladder would truncate it to a record in a collection
            // called `space`, so it is refused instead.
            if parts.count > 2, parts[2] == "space" { return nil }
            guard parts.count > 1, !parts[1].isEmpty else { return nil }
            let repo = encodeRepo(parts[1])
            if parts.count > 3 {
                return "/explore/\(repo)/\(parts[2])/\(URIEncoding.encodeComponent(parts[3]))"
            }
            if parts.count > 2 {
                return "/explore/\(repo)/\(parts[2])"
            }
            return "/explore/\(repo)"
        }

        // `/profile/<id>[/(post|lists)/<rkey>]` or `/profile/<id>/<nsid>/<rkey>`.
        if first == "profile" {
            guard parts.count > 1, !parts[1].isEmpty else { return nil }
            let repo = encodeRepo(parts[1])
            if parts.count > 3 {
                let segment = parts[2]
                let rkey = URIEncoding.encodeComponent(parts[3])
                if segment == "post" {
                    return "/explore/\(repo)/app.bsky.feed.post/\(rkey)"
                }
                if segment == "lists" || segment == "list" {
                    return "/explore/\(repo)/app.bsky.graph.list/\(rkey)"
                }
                // Generic record route: the collection NSID sits in the path verbatim.
                return "/explore/\(repo)/\(segment)/\(rkey)"
            }
            return "/explore/\(repo)"
        }

        return nil
    }

    /// Bare hostnames that begin with `pds.` are overwhelmingly atproto PDS
    /// hosts (pds.atpota.to, pds.bsky.network, ...). Anything else without a
    /// protocol scheme is treated as a handle by default: there is no
    /// reliable way to tell a "pds-less" PDS hostname from a handle without
    /// a network call.
    public static func looksLikeBarePdsHostname(_ input: String) -> Bool {
        if input.contains("/") { return false }
        if input.hasPrefix("did:") || input.hasPrefix("at://") { return false }
        return input.prefixMatch(of: barePdsHostPattern) != nil
    }

    /// `/^pds\.[^\s.]+\.[^\s.]+/i`.
    private static let barePdsHostPattern = #/^pds\.[^\s.]+\.[^\s.]+/#.ignoresCase()

    /// `/^https?:\/\//i`.
    private static func hasHTTPScheme(_ value: String) -> Bool {
        let lowered = value.prefix(8).lowercased()
        return lowered.hasPrefix("http://") || lowered.hasPrefix("https://")
    }
}
