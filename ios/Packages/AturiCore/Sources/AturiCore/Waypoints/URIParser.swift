import Foundation

/// Structured reading of the three path segments a universal link carries.
/// Port of `src/utils/uriParser.ts` minus handle resolution, which lives in
/// `IdentityResolver`.
public struct ParsedURI: Hashable, Sendable {
    /// The same five values as the waypoint catalog's `WaypointType`; the
    /// raw values match so the two convert with `init(rawValue:)`.
    public enum Kind: String, Hashable, Sendable, CaseIterable {
        case post
        case profile
        case list
        case record
        case unknown
    }

    public var type: Kind
    /// The `at://` URI, or "" when the segments do not spell one.
    public var uri: String
    public var handle: String
    /// Set only when the handle segment already is a DID.
    public var did: String?
    public var collection: String?
    public var rkey: String?
    public var error: String?

    public init(
        type: Kind,
        uri: String,
        handle: String,
        did: String? = nil,
        collection: String? = nil,
        rkey: String? = nil,
        error: String? = nil
    ) {
        self.type = type
        self.uri = uri
        self.handle = handle
        self.did = did
        self.collection = collection
        self.rkey = rkey
        self.error = error
    }
}

/// Parse URL path segments into structured AT URI data.
///
///     alice.bsky.social                                  -> profile
///     alice.bsky.social / app.bsky.feed.post / 3k7qw...  -> post
///     did:plc:xxx / app.bsky.graph.list / abc            -> list
///
/// Empty segments count as absent, as JavaScript's falsy test treats them.
public func parseURI(handle: String, collection: String? = nil, rkey: String? = nil) -> ParsedURI {
    let collection = collection.flatMap { $0.isEmpty ? nil : $0 }
    let rkey = rkey.flatMap { $0.isEmpty ? nil : $0 }

    if handle.isEmpty {
        return ParsedURI(type: .unknown, uri: "", handle: "", error: "Handle or DID is required")
    }

    let did = handle.hasPrefix("did:") ? handle : nil

    if collection == nil && rkey == nil {
        return ParsedURI(type: .profile, uri: "at://\(handle)", handle: handle, did: did)
    }

    // The literal `space` marker sits where a public collection NSID would
    // in a permissioned AT URI (at://{did}/space/{type}/{skey}/...). An NSID
    // always carries at least two dots and the marker carries none, so the
    // two never collide. A space address names private data, so the
    // three-segment universal-link route can never render one.
    if collection == "space" {
        return ParsedURI(type: .unknown, uri: "", handle: handle, error: "Space URIs are not public records")
    }

    if let collection = collection, let rkey = rkey {
        let type: ParsedURI.Kind
        switch collection {
        case "app.bsky.feed.post": type = .post
        case "app.bsky.graph.list": type = .list
        default: type = .record
        }
        return ParsedURI(
            type: type,
            uri: "at://\(handle)/\(collection)/\(rkey)",
            handle: handle,
            did: did,
            collection: collection,
            rkey: rkey
        )
    }

    return ParsedURI(type: .unknown, uri: "", handle: handle, error: "Invalid URI structure")
}

/// Display name from a handle or a DID: "@alice.bsky.social", or the first
/// sixteen characters of the DID when that is all we have.
public func displayName(handle: String, did: String? = nil) -> String {
    if handle.hasPrefix("did:") {
        if let did = did { return "@\(did.prefix(16))..." }
        return "Unknown"
    }
    return "@\(handle)"
}
