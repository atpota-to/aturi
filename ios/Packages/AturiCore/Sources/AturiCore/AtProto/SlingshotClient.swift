import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The subset of a DID document Slingshot returns: identity + host.
public struct MiniDoc: Codable, Hashable, Sendable {
    public var did: String
    public var handle: String?
    public var pds: String
    public var signingKey: String?

    public init(did: String, handle: String? = nil, pds: String, signingKey: String? = nil) {
        self.did = did
        self.handle = handle
        self.pds = pds
        self.signingKey = signingKey
    }

    private enum CodingKeys: String, CodingKey {
        case did, handle, pds
        case signingKey = "signing_key"
    }

    /// Lenient: a document missing `did` decodes to an empty one, which
    /// `resolveMiniDoc` then rejects the way `doc?.did ? doc : null` does.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        did = try container.decodeIfPresent(String.self, forKey: .did) ?? ""
        handle = try container.decodeIfPresent(String.self, forKey: .handle)
        pds = try container.decodeIfPresent(String.self, forKey: .pds) ?? ""
        signingKey = try container.decodeIfPresent(String.self, forKey: .signingKey)
    }
}

/// A record as Slingshot hands it back. `value` stays dynamic because
/// backlinks come from any lexicon; typed views are decoded from it on demand.
public struct FetchedRecord: Codable, Hashable, Sendable {
    public var uri: String
    public var cid: String
    public var value: JSONValue

    public init(uri: String, cid: String, value: JSONValue) {
        self.uri = uri
        self.cid = cid
        self.value = value
    }

    /// The same record in the PDS client's shape, for views that render both.
    public var atRecord: AtRecord {
        AtRecord(uri: uri, cid: cid, value: value)
    }
}

/// Slingshot client, port of `src/utils/atproto/slingshot.ts`: microcosm's
/// atproto edge record cache.
///
/// Constellation hands back link coordinates (`{ did, collection, rkey }`),
/// not record content, so anything built on backlinks needs a second hop to
/// hydrate them. Doing that against each author's PDS means resolving every
/// DID to its host first: two round trips per record, fanned out across
/// dozens of repos. Slingshot collapses that into one cached edge request
/// per AT URI, and resolves identity in one hop as well. Like the
/// Constellation client, every call swallows network / 4xx / 5xx errors and
/// returns nil so call sites can render a placeholder.
///
/// Endpoints used (see https://slingshot.microcosm.blue/openapi):
///   GET /xrpc/blue.microcosm.repo.getRecordByUri?at_uri=...
///   GET /xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=...
public struct SlingshotClient: Sendable {
    /// Hydrating a page of backlinks means one request per record; firing
    /// 50 at once gets us rate limited and starves the rest of the page of
    /// connections, while awaiting them serially is 50 sequential round
    /// trips.
    public static let defaultConcurrency = 8

    private let http: HTTPClient

    public init(http: HTTPClient = .shared) {
        self.http = http
    }

    /// Resolve a handle or DID to `{ did, handle, pds }` in a single request.
    /// Nil when the identity does not resolve.
    public func resolveMiniDoc(_ identifier: String) async -> MiniDoc? {
        guard !identifier.isEmpty else { return nil }
        let url = makeURL(
            Endpoints.slingshot,
            path: "/xrpc/blue.microcosm.identity.resolveMiniDoc",
            query: [("identifier", identifier)]
        )
        guard let doc = await http.getJSONOrNil(MiniDoc.self, from: url), !doc.did.isEmpty else {
            return nil
        }
        return doc
    }

    /// Fetch a single record by AT URI. The repo segment may be a DID or a
    /// handle; Slingshot resolves it either way. Nil when the answer carries
    /// no value (`rec?.value ? rec : null`).
    public func getRecordByUri(_ atUri: String) async -> FetchedRecord? {
        guard !atUri.isEmpty else { return nil }
        let url = makeURL(
            Endpoints.slingshot,
            path: "/xrpc/blue.microcosm.repo.getRecordByUri",
            query: [("at_uri", atUri)]
        )
        guard let wire = await http.getJSONOrNil(SlingshotRecordWire.self, from: url),
            let value = wire.value, SlingshotClient.isTruthy(value)
        else {
            return nil
        }
        return FetchedRecord(uri: wire.uri ?? "", cid: wire.cid ?? "", value: value)
    }

    /// Hydrate many AT URIs at once, keyed by URI. URIs that fail to resolve
    /// are absent from the map rather than present-with-nil, so callers can
    /// filter with a single lookup. Duplicate and empty URIs are fetched
    /// once and never, respectively.
    public func getRecordsByUris(
        _ uris: [String],
        concurrency: Int = SlingshotClient.defaultConcurrency
    ) async -> [String: FetchedRecord] {
        var seen = Set<String>()
        var unique: [String] = []
        for uri in uris where !uri.isEmpty && seen.insert(uri).inserted {
            unique.append(uri)
        }
        guard !unique.isEmpty else { return [:] }

        // The task never throws (getRecordByUri swallows), so the fallback
        // is unreachable; it exists because the helper is generic over
        // throwing work.
        let fetched = (try? await SlingshotClient.mapWithConcurrency(unique, limit: concurrency) { uri, _ in
            await self.getRecordByUri(uri)
        }) ?? []

        var out: [String: FetchedRecord] = [:]
        for (index, record) in fetched.enumerated() {
            if let record { out[unique[index]] = record }
        }
        return out
    }

    /// Run `task` over `items` with at most `limit` in flight, keeping input
    /// order in the result. The first failure cancels the rest and is
    /// rethrown. A `limit` below one runs the items one at a time.
    public static func mapWithConcurrency<Item: Sendable, Output: Sendable>(
        _ items: [Item],
        limit: Int,
        _ task: @escaping @Sendable (Item, Int) async throws -> Output
    ) async throws -> [Output] {
        guard !items.isEmpty else { return [] }
        let width = Swift.max(1, Swift.min(limit, items.count))
        var results = [Output?](repeating: nil, count: items.count)

        try await withThrowingTaskGroup(of: (Int, Output).self) { group in
            var next = 0
            func enqueue() {
                let index = next
                next += 1
                let item = items[index]
                group.addTask {
                    (index, try await task(item, index))
                }
            }
            for _ in 0..<width { enqueue() }
            while let (index, output) = try await group.next() {
                results[index] = output
                if next < items.count { enqueue() }
            }
        }

        return results.map { $0! }
    }

    /// JavaScript truthiness for the `value` guard: an empty string, zero,
    /// false and null all mean "no record" to the web client.
    private static func isTruthy(_ value: JSONValue) -> Bool {
        switch value {
        case .null: return false
        case .bool(let flag): return flag
        case .number(let number): return number != 0 && !number.isNaN
        case .string(let text): return !text.isEmpty
        case .array, .object: return true
        }
    }
}

private struct SlingshotRecordWire: Decodable {
    var uri: String?
    var cid: String?
    var value: JSONValue?
}
