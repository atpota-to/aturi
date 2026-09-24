import Foundation

/// AT URI helpers. Pure, no network IO. Port of `src/utils/atproto/urls.ts`
/// and the syntax validators of `src/utils/atproto/spaceUri.ts`.
///
/// Permissioned space addresses (`at://{did}/space/...`) are not supported
/// on iOS. They are still recognised so that they fail closed: parsing one
/// yields nil rather than a public record path built out of space
/// components, which is the wrong record entirely.
public struct AtUri: Hashable, Sendable, CustomStringConvertible {
    public var repo: String
    public var collection: String?
    public var rkey: String?

    public init(repo: String, collection: String? = nil, rkey: String? = nil) {
        self.repo = repo
        self.collection = collection
        self.rkey = rkey
    }

    /// Parse `at://repo[/collection[/rkey]]`. Returns nil for non-AT input
    /// and for space addresses. The repo segment stops at a query or a
    /// fragment, as the web's regex does.
    public init?(parsing string: String) {
        if string.isEmpty || isSpaceAtUri(string) { return nil }
        guard let match = string.prefixMatch(of: atUriPattern) else { return nil }
        repo = String(match.output.1)
        collection = match.output.2.map(String.init)
        rkey = match.output.3.map(String.init)
    }

    /// Canonical `at://` spelling. A record key without a collection is not
    /// addressable, so it is dropped, exactly as `toAtUri` does.
    public var description: String {
        if let collection = collection, !collection.isEmpty {
            if let rkey = rkey, !rkey.isEmpty {
                return "at://\(repo)/\(collection)/\(rkey)"
            }
            return "at://\(repo)/\(collection)"
        }
        return "at://\(repo)"
    }

    public var isRecord: Bool {
        guard let collection = collection, let rkey = rkey else { return false }
        return !collection.isEmpty && !rkey.isEmpty
    }
}

/// `^at:\/\/([^/?#]+)(?:\/([^/?#]+)(?:\/([^/?#]+))?)?` from urls.ts.
private let atUriPattern = #/^at://([^/?#]+)(?:/([^/?#]+)(?:/([^/?#]+))?)?/#

/// `^at:\/\/[^/]+\/[^/]+\/([^/?#]+)` from urls.ts: the rkey of a three-part
/// URI, ignoring anything after it.
private let rkeyPattern = #/^at://[^/]+/[^/]+/([^/?#]+)/#

/// The literal marker a space address wedges into the collection position.
/// An NSID needs at least three dot-separated segments and `space` has
/// none, so the test is exact-segment equality and never a prefix match,
/// which would swallow a real NSID like `space.example.thing`.
private let spaceMarker = "space"

private func isSpaceAtUri(_ input: String) -> Bool {
    guard input.hasPrefix("at://") else { return false }
    let afterScheme = input.index(input.startIndex, offsetBy: 5)
    guard let slash = input[afterScheme...].firstIndex(of: "/") else { return false }
    let rest = input[input.index(after: slash)...]
    return rest == spaceMarker || rest.hasPrefix(spaceMarker + "/")
}

/// Extract the rkey from an `at://did/collection/rkey` URI. Nil for a
/// repo or collection URI, and for space addresses.
public func rkeyFromAtUri(_ uri: String?) -> String? {
    guard let uri = uri, !uri.isEmpty else { return nil }
    if isSpaceAtUri(uri) { return nil }
    guard let match = uri.prefixMatch(of: rkeyPattern) else { return nil }
    return String(match.output.1)
}

/// Repo path segments contain colons (DIDs) and dots (handles). Both are
/// URL-safe in path segments without encoding, and encoding `:` breaks the
/// readability of DID URLs. Leave them raw; only encode the truly reserved
/// characters.
public func encodeRepo(_ input: String?) -> String {
    (input ?? "")
        .replacingOccurrences(of: "?", with: "%3F")
        .replacingOccurrences(of: "#", with: "%23")
}

/// Convert an `at://` URI (or a bare DID) into the corresponding
/// `/explore/...` path. Nil for empty or unparseable input and for space
/// addresses, which have no public page.
///
///     at://did:plc:abc/app.bsky.feed.post/xyz  -> /explore/did:plc:abc/app.bsky.feed.post/xyz
///     at://did:plc:abc/app.bsky.feed.post      -> /explore/did:plc:abc/app.bsky.feed.post
///     at://did:plc:abc                         -> /explore/did:plc:abc
///     did:plc:abc                              -> /explore/did:plc:abc
public func explorePath(fromAtUri input: String?) -> String? {
    guard let input = input, !input.isEmpty else { return nil }
    if input.hasPrefix("did:") { return "/explore/\(input)" }
    guard let parsed = AtUri(parsing: input) else { return nil }
    let repo = encodeRepo(parsed.repo)
    if let collection = parsed.collection {
        if let rkey = parsed.rkey {
            return "/explore/\(repo)/\(collection)/\(URIEncoding.encodeComponent(rkey))"
        }
        return "/explore/\(repo)/\(collection)"
    }
    return "/explore/\(repo)"
}

/// Short DID like "did:plc:abc1...wxyz" for display in dense tables. Only
/// `did:plc` identifiers are shortened; a did:web reads fine as it is.
public func shortDid(_ did: String?) -> String {
    guard let did = did else { return "" }
    if !did.hasPrefix("did:plc:") || did.count <= 18 { return did }
    return did.prefix(12) + "\u{2026}" + did.suffix(4)
}

// MARK: - Syntax validators (from spaceUri.ts)

private let maxDidLength = 2048
private let didPattern = #/^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/#

/// 253 chars of reversed domain + a dot + a 63-char name segment.
private let maxNsidLength = 317
private let maxNsidSegmentLength = 63
private let nsidCharsPattern = #/^[a-zA-Z0-9.-]*$/#
private let nsidNamePattern = #/^[a-zA-Z][a-zA-Z0-9]*$/#

private let recordKeyPattern = #/^[a-zA-Z0-9_~.:-]{1,512}$/#

/// Hostname shape per the atproto handle grammar: dot-separated labels of
/// letters, digits and inner hyphens, at least one dot, a TLD that starts
/// with a letter, 253 characters at most.
private let maxHandleLength = 253
private let handlePattern = #/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/#

public func isValidDid(_ s: String) -> Bool {
    s.count <= maxDidLength && s.wholeMatch(of: didPattern) != nil
}

public func isValidNsid(_ s: String) -> Bool {
    if s.count > maxNsidLength { return false }
    if s.wholeMatch(of: nsidCharsPattern) == nil { return false }

    let segments = s.split(separator: ".", omittingEmptySubsequences: false)
    if segments.count < 3 { return false }

    for segment in segments {
        if segment.count < 1 || segment.count > maxNsidSegmentLength { return false }
        if segment.hasPrefix("-") || segment.hasSuffix("-") { return false }
    }

    // The authority half is a reversed domain, so its first label follows
    // hostname rules; the trailing name segment is a camel-case identifier
    // and admits neither hyphens nor a leading digit.
    if let first = segments.first?.unicodeScalars.first, ("0"..."9").contains(first) { return false }
    if segments.last!.wholeMatch(of: nsidNamePattern) == nil { return false }

    return true
}

public func isValidRecordKey(_ s: String) -> Bool {
    if s == "." || s == ".." { return false }
    return s.wholeMatch(of: recordKeyPattern) != nil
}

public func isValidHandle(_ s: String) -> Bool {
    s.count <= maxHandleLength && s.wholeMatch(of: handlePattern) != nil
}
