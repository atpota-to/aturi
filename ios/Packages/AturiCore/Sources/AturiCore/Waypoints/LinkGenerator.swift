import Foundation

// Port of src/utils/linkGenerator.ts: pull AT URI components out of whatever
// the user pasted or shared (an AT URI, a client URL, a bare handle or DID)
// and build the canonical aturi.to link for them. The async DID-resolving
// variants are not ported; resolution lives in Identity.

/// The identity (and optionally the record) an input names.
public struct AtUriComponents: Hashable, Sendable {
    /// DID or handle.
    public var identifier: String
    public var collection: String?
    public var rkey: String?

    public init(identifier: String, collection: String? = nil, rkey: String? = nil) {
        self.identifier = identifier
        self.collection = collection
        self.rkey = rkey
    }

    public var isRecord: Bool {
        collection != nil && rkey != nil
    }
}

/// The parts of an absolute URL the extractor looks at, parsed by hand.
///
/// JS `new URL('https://x.y/at://did:plc:a/b/c')` keeps the path
/// `/at://did:plc:a/b/c` intact; Foundation's URL rejects or mangles such
/// input, so the extractor splits `scheme://authority/path` itself and only
/// borrows the WHATWG rules that matter for its decisions: the scheme is
/// lowercased, hosts of special schemes are lowercased and get a `/` path
/// when empty, query and fragment are dropped, and an authority whose port is
/// not numeric is not a URL at all (which is why `at://did:plc:x/coll` falls
/// through to the bare-identifier checks exactly as it does in the browser).
private struct LinkGeneratorParsedURL {
    let scheme: String
    let hostname: String
    let pathname: String

    private static let specialSchemes: Set<String> = ["http", "https", "ws", "wss", "ftp", "file"]

    /// Characters JS leaves alone in a path. Everything else (space, quotes,
    /// angle brackets, braces, backtick, controls, non-ASCII) is percent
    /// encoded as UTF-8, and an existing `%` is kept as is.
    private static let pathAllowed: CharacterSet = {
        var set = CharacterSet(charactersIn: UnicodeScalar(0x21)...UnicodeScalar(0x7e))
        set.remove(charactersIn: "\"<>`{}")
        return set
    }()

    init?(_ input: String) {
        guard let separator = input.range(of: "://") else { return nil }
        let rawScheme = input[input.startIndex..<separator.lowerBound]
        guard let first = rawScheme.first, first.isASCII, first.isLetter,
              rawScheme.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "+" || $0 == "-" || $0 == ".") })
        else { return nil }
        let scheme = rawScheme.lowercased()
        let isSpecial = Self.specialSchemes.contains(scheme)

        let rest = input[separator.upperBound...]
        let authorityEnd = rest.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) ?? rest.endIndex
        var authority = String(rest[rest.startIndex..<authorityEnd])
        if let at = authority.lastIndex(of: "@") {
            authority = String(authority[authority.index(after: at)...])
        }

        // Split host from port. A bracketed IPv6 literal may carry colons of
        // its own; anything after the closing bracket is the port.
        var host = authority
        var port = ""
        if authority.hasPrefix("[") {
            if let close = authority.firstIndex(of: "]") {
                host = String(authority[authority.startIndex...close])
                let tail = authority[authority.index(after: close)...]
                if tail.hasPrefix(":") { port = String(tail.dropFirst()) } else if !tail.isEmpty { return nil }
            } else {
                return nil
            }
        } else if let colon = authority.firstIndex(of: ":") {
            host = String(authority[authority.startIndex..<colon])
            port = String(authority[authority.index(after: colon)...])
        }
        guard port.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        if isSpecial && host.isEmpty { return nil }
        if host.contains(" ") { return nil }

        var path = String(rest[authorityEnd...])
        if let stop = path.firstIndex(where: { $0 == "?" || $0 == "#" }) {
            path = String(path[path.startIndex..<stop])
        }
        if isSpecial && path.isEmpty { path = "/" }
        path = path.addingPercentEncoding(withAllowedCharacters: Self.pathAllowed) ?? path

        self.scheme = scheme
        self.hostname = isSpecial ? host.lowercased() : host
        self.pathname = path
    }
}

/// Extracts AT URI components from a URL or AT URI string.
///
/// Universal AT URI pattern detection (works with any domain):
/// - https://anydomain.com/at://did:plc:xxx/collection/rkey
/// - https://anydomain.com/at:/did:plc:xxx/collection/rkey
/// - https://anydomain.com/did:plc:xxx/collection/rkey
/// - https://anydomain.com/handle.bsky.social/collection/rkey
///
/// Specific platform formats also supported:
/// - https://bsky.app/profile/did:plc:xxx
/// - https://bsky.app/profile/handle.bsky.social/post/rkey
/// - https://leaflet.pub/p/identifier
/// - https://margin.at/domain.com/annotation/rkey (maps to at.margin.annotation)
/// - https://semble.so/profile/identifier
/// - at://did:plc:xxx/app.bsky.feed.post/rkey
public func extractAtUriComponents(_ input: String) -> AtUriComponents? {
    let trimmedInput = input.trimmingCharacters(in: .whitespacesAndNewlines)

    // Case 1: native AT URI.
    if trimmedInput.hasPrefix("at://") {
        let parts = trimmedInput.dropFirst(5).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        if parts.count == 1 {
            return AtUriComponents(identifier: parts[0])
        } else if parts.count == 3 {
            return AtUriComponents(identifier: parts[0], collection: parts[1], rkey: parts[2])
        }
    }

    // Case 2: URL formats.
    if let url = LinkGeneratorParsedURL(trimmedInput) {
        let pathname = url.pathname
        let hostname = url.hostname

        // Universal AT URI pattern: /at://identifier/collection/rkey
        if pathname.hasPrefix("/at://") {
            return extractAtUriComponents(String(pathname.dropFirst()))
        }

        // Universal AT URI pattern, single-slash spelling: /at:/identifier/collection/rkey
        if pathname.hasPrefix("/at:/") {
            let parts = pathname.dropFirst(5).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            if parts.count == 1 {
                return AtUriComponents(identifier: parts[0])
            } else if parts.count == 3 {
                return AtUriComponents(identifier: parts[0], collection: parts[1], rkey: parts[2])
            }
        }

        // Universal pattern: /did:xxx/collection/rkey or /handle.tld/collection/rkey.
        // Catches any domain with a DID or handle-like structure in the path.
        let pathParts = pathname.dropFirst().split(separator: "/", omittingEmptySubsequences: true).map(String.init)

        if let potentialIdentifier = pathParts.first {
            let isDid = potentialIdentifier.hasPrefix("did:")
            let isHandle = !isDid && potentialIdentifier.contains(".") && !potentialIdentifier.contains(" ")

            if isDid || isHandle {
                if pathParts.count == 1 {
                    return AtUriComponents(identifier: potentialIdentifier)
                } else if pathParts.count == 3 {
                    let collection = pathParts[1]
                    let rkey = pathParts[2]
                    // The collection has to look like a lexicon NSID.
                    if collection.contains(".") {
                        return AtUriComponents(identifier: potentialIdentifier, collection: collection, rkey: rkey)
                    }
                }
            }
        }

        // Specific domain patterns for non-AT-URI-like paths.

        // Standard /profile/identifier format (bsky.app, blacksky.community,
        // anisota.net, reddwarf.app, witchsky.app, deer.social).
        if pathname.hasPrefix("/profile/") {
            let parts = pathname.dropFirst(9).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            if parts.count == 1 {
                return AtUriComponents(identifier: parts[0])
            } else if parts.count == 3 && parts[1] == "post" {
                return AtUriComponents(identifier: parts[0], collection: "app.bsky.feed.post", rkey: parts[2])
            } else if parts.count == 3 && parts[1] == "lists" {
                return AtUriComponents(identifier: parts[0], collection: "app.bsky.graph.list", rkey: parts[2])
            }
        }

        // Leaflet: /p/identifier
        if pathname.hasPrefix("/p/") {
            let parts = pathname.dropFirst(3).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            if parts.count == 1 {
                return AtUriComponents(identifier: parts[0])
            }
        }

        // margin.at: /domain/recordType/rkey, mapped to at.margin.{recordType}.
        if hostname == "margin.at" {
            let parts = pathname.dropFirst().split(separator: "/", omittingEmptySubsequences: true).map(String.init)
            if parts.count == 3 {
                let domain = parts[0]
                let recordType = parts[1].lowercased()
                let rkey = parts[2]
                let validMarginTypes: Set<String> = ["annotation", "highlight", "bookmark", "collection", "collectionitem", "reply", "like"]
                if validMarginTypes.contains(recordType) {
                    // The domain in the URL is the handle.
                    return AtUriComponents(identifier: domain, collection: "at.margin.\(recordType)", rkey: rkey)
                }
            } else if parts.count == 2 && parts[0] == "profile" {
                return AtUriComponents(identifier: parts[1])
            } else if parts.count == 1 {
                return AtUriComponents(identifier: parts[0])
            }
        }

        // Semble: /profile/identifier
        if hostname == "semble.so" && pathname.hasPrefix("/profile/") {
            let parts = pathname.dropFirst(9).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            if parts.count == 1 {
                return AtUriComponents(identifier: parts[0])
            }
        }

        // Legacy /at/ format: /at/identifier or /at/identifier/collection/rkey
        if pathname.hasPrefix("/at/") {
            let parts = pathname.dropFirst(4).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            if parts.count == 1 {
                return AtUriComponents(identifier: parts[0])
            } else if parts.count == 3 {
                return AtUriComponents(identifier: parts[0], collection: parts[1], rkey: parts[2])
            }
        }

        // atp.tools: /record/identifier/collection/rkey
        if pathname.hasPrefix("/record/") {
            let parts = pathname.dropFirst(8).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            if parts.count == 1 {
                return AtUriComponents(identifier: parts[0])
            } else if parts.count == 3 {
                return AtUriComponents(identifier: parts[0], collection: parts[1], rkey: parts[2])
            }
        }
    }

    // Case 3: bare DID.
    if trimmedInput.hasPrefix("did:") {
        return AtUriComponents(identifier: trimmedInput)
    }

    // Case 4: handle-like string (contains dots and no slashes).
    if trimmedInput.contains(".") && !trimmedInput.contains("/") {
        return AtUriComponents(identifier: trimmedInput)
    }

    return nil
}

/// Generates an aturi.to link from AT URI components.
///
/// Canonical URLs include the `/profile/` prefix to mirror the bsky.app /
/// anisota.net layout. The bare-path forms (`aturi.to/{identifier}/...`)
/// still resolve, but new links always use `/profile/` so every caller
/// produces consistent output.
///
/// - Parameter useAtPrefix: keep the literal `at://` prefix
///   (`aturi.to/at://did:plc:xxx/...`).
public func generateAturiLink(_ components: AtUriComponents, useAtPrefix: Bool = false) -> String {
    let identifier = components.identifier
    let record: (collection: String, rkey: String)?
    if let collection = components.collection, !collection.isEmpty,
       let rkey = components.rkey, !rkey.isEmpty {
        record = (collection, rkey)
    } else {
        record = nil
    }

    if useAtPrefix {
        if let record {
            return "https://aturi.to/at://\(identifier)/\(record.collection)/\(record.rkey)"
        }
        return "https://aturi.to/at://\(identifier)"
    }

    if let record {
        if record.collection == "app.bsky.feed.post" {
            return "https://aturi.to/profile/\(identifier)/post/\(record.rkey)"
        }
        if record.collection == "app.bsky.graph.list" {
            return "https://aturi.to/profile/\(identifier)/lists/\(record.rkey)"
        }
        return "https://aturi.to/profile/\(identifier)/\(record.collection)/\(record.rkey)"
    }

    return "https://aturi.to/profile/\(identifier)"
}

/// `convertToAturiLinkSync`: any input straight to an aturi.to link, or nil
/// when the input names nothing.
public func convertToAturiLink(_ input: String, useAtPrefix: Bool = false) -> String? {
    guard let components = extractAtUriComponents(input) else { return nil }
    return generateAturiLink(components, useAtPrefix: useAtPrefix)
}

/// Whether the input can be converted to an aturi.to link.
public func isValidInput(_ input: String) -> Bool {
    extractAtUriComponents(input) != nil
}
