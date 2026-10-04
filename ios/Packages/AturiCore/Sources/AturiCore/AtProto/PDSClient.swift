import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A record as the PDS hands it back: its AT URI, its CID and the raw value.
/// The value stays a `JSONValue` because the explorer renders any lexicon,
/// known or not; typed views (`BskyPost` and friends) are decoded from it on
/// demand.
public struct AtRecord: Codable, Hashable, Sendable {
    public var uri: String
    /// The lexicon marks `cid` optional on getRecord; a host that omits it
    /// yields "" here rather than failing the whole read.
    public var cid: String
    public var value: JSONValue

    public init(uri: String, cid: String, value: JSONValue) {
        self.uri = uri
        self.cid = cid
        self.value = value
    }

    private enum CodingKeys: String, CodingKey {
        case uri, cid, value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        uri = try container.decode(String.self, forKey: .uri)
        cid = try container.decodeIfPresent(String.self, forKey: .cid) ?? ""
        value = try container.decodeIfPresent(JSONValue.self, forKey: .value) ?? .object([:])
    }
}

public struct ListRecordsPage: Codable, Hashable, Sendable {
    public var records: [AtRecord]
    public var cursor: String?

    public init(records: [AtRecord], cursor: String? = nil) {
        self.records = records
        self.cursor = cursor
    }

    private enum CodingKeys: String, CodingKey {
        case records, cursor
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        records = try container.decodeIfPresent([AtRecord].self, forKey: .records) ?? []
        cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
    }
}

public struct DescribeRepoResponse: Codable, Hashable, Sendable {
    public var handle: String?
    public var did: String
    public var didDoc: JSONValue?
    public var collections: [String]
    public var handleIsCorrect: Bool?

    public init(
        handle: String? = nil,
        did: String,
        didDoc: JSONValue? = nil,
        collections: [String],
        handleIsCorrect: Bool? = nil
    ) {
        self.handle = handle
        self.did = did
        self.didDoc = didDoc
        self.collections = collections
        self.handleIsCorrect = handleIsCorrect
    }

    private enum CodingKeys: String, CodingKey {
        case handle, did, didDoc, collections, handleIsCorrect
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        handle = try container.decodeIfPresent(String.self, forKey: .handle)
        did = try container.decode(String.self, forKey: .did)
        didDoc = try container.decodeIfPresent(JSONValue.self, forKey: .didDoc)
        collections = try container.decodeIfPresent([String].self, forKey: .collections) ?? []
        handleIsCorrect = try container.decodeIfPresent(Bool.self, forKey: .handleIsCorrect)
    }
}

public struct LatestCommit: Codable, Hashable, Sendable {
    public var cid: String
    /// Head commit revision: a TID encoding the last write's timestamp.
    public var rev: String

    public init(cid: String, rev: String) {
        self.cid = cid
        self.rev = rev
    }
}

public struct RepoStatus: Codable, Hashable, Sendable {
    public var did: String
    /// False for a repo the host holds but won't serve records for.
    public var active: Bool
    /// Why it's inactive: 'takendown', 'suspended', 'deactivated', 'deleted',
    /// and others hosts may add. The lexicon leaves the set open, so callers
    /// render whatever came back rather than mapping it to a closed set.
    /// Absent when `active` is true.
    public var status: String?
    /// Head commit rev (a TID). Relays return it here; PDS implementations may not.
    public var rev: String?

    public init(did: String, active: Bool, status: String? = nil, rev: String? = nil) {
        self.did = did
        self.active = active
        self.status = status
        self.rev = rev
    }
}

/// AT Protocol PDS client, port of `src/utils/atproto/pdsClient.ts`. Pure
/// GET + JSON, no SDK.
///
/// The PDS base comes from a DID document, which anyone can author, so a
/// redirect here would send the request to an unchecked host and hand its
/// body back to the caller. A PDS serving XRPC never needs to redirect, so
/// every read refuses them. Bodies are capped by `HTTPClient`.
public struct PDSClient: Sendable {
    private let http: HTTPClient

    public init(http: HTTPClient = .shared) {
        self.http = http
    }

    /// com.atproto.repo.describeRepo
    public func describeRepo(pds: String, repo: String) async throws -> DescribeRepoResponse {
        let url = makeURL(try PDSServer.requireBase(pds), path: "/xrpc/com.atproto.repo.describeRepo", query: [("repo", repo)])
        return try await http.getJSON(DescribeRepoResponse.self, from: url, refuseRedirects: true)
    }

    /// com.atproto.sync.getLatestCommit: the repo's current head commit. The
    /// `rev` is the same TID the PDS-wide listRepos surfaces, so decoding it
    /// with `TID.date(from:)` gives the account's last-active time.
    public func getLatestCommit(pds: String, did: String) async throws -> LatestCommit {
        let url = makeURL(try PDSServer.requireBase(pds), path: "/xrpc/com.atproto.sync.getLatestCommit", query: [("did", did)])
        return try await http.getJSON(LatestCommit.self, from: url, refuseRedirects: true)
    }

    /// com.atproto.sync.getRepoStatus: one host's hosting status for an account.
    ///
    /// The only repo-scoped read that still answers for an inactive account.
    /// describeRepo, listRecords, getLatestCommit and getRepo all fail with a
    /// 400 whose body names the state but which is otherwise just an error;
    /// this returns 200 and the reason as data. `host` is a PDS or a relay:
    /// the lexicon is implemented by both, and the two can legitimately
    /// disagree while an account event is still propagating.
    public func getRepoStatus(host: String, did: String) async throws -> RepoStatus {
        let url = makeURL(try PDSServer.requireBase(host), path: "/xrpc/com.atproto.sync.getRepoStatus", query: [("did", did)])
        return try await http.getJSON(RepoStatus.self, from: url, refuseRedirects: true)
    }

    /// com.atproto.repo.listRecords (single page). Use this when the caller
    /// wants to control pagination ("Load more").
    public func listRecordsPage(
        pds: String,
        repo: String,
        collection: String,
        limit: Int = 50,
        cursor: String? = nil,
        reverse: Bool = false
    ) async throws -> ListRecordsPage {
        let url = try PDSClient.listRecordsURL(
            pds: pds, repo: repo, collection: collection, limit: limit, cursor: cursor, reverse: reverse
        )
        return try await http.getJSON(ListRecordsPage.self, from: url, refuseRedirects: true)
    }

    /// com.atproto.repo.listRecords, auto-paginating up to `max` records.
    public func listRecords(
        pds: String,
        repo: String,
        collection: String,
        limit: Int = 100,
        max: Int = 500,
        reverse: Bool = false
    ) async throws -> [AtRecord] {
        var records: [AtRecord] = []
        var cursor: String? = nil
        while records.count < max {
            let page = try await listRecordsPage(
                pds: pds,
                repo: repo,
                collection: collection,
                limit: Swift.min(limit, max - records.count),
                cursor: cursor,
                reverse: reverse
            )
            records.append(contentsOf: page.records)
            guard let next = page.cursor, !next.isEmpty, !page.records.isEmpty else { break }
            cursor = next
        }
        return records
    }

    /// com.atproto.repo.getRecord
    public func getRecord(pds: String, repo: String, collection: String, rkey: String) async throws -> AtRecord {
        let url = try PDSClient.recordURL(pds: pds, repo: repo, collection: collection, rkey: rkey)
        return try await http.getJSON(AtRecord.self, from: url, refuseRedirects: true)
    }

    /// The public PDS XRPC URL for a single record. Used by the "View on
    /// PDS" link so the visitor can read the raw JSON straight from the source.
    public static func recordURL(pds: String, repo: String, collection: String, rkey: String) throws -> URL {
        makeURL(
            try PDSServer.requireBase(pds),
            path: "/xrpc/com.atproto.repo.getRecord",
            query: [("repo", repo), ("collection", collection), ("rkey", rkey)]
        )
    }

    /// The public PDS XRPC URL for an account's full repo export (the CAR
    /// file). The "Download CAR" link hands this to the system; the export
    /// can run to many megabytes, so nothing here fetches it.
    public static func repoURL(pds: String, did: String) throws -> URL {
        makeURL(try PDSServer.requireBase(pds), path: "/xrpc/com.atproto.sync.getRepo", query: [("did", did)])
    }

    private static func listRecordsURL(
        pds: String,
        repo: String,
        collection: String,
        limit: Int,
        cursor: String?,
        reverse: Bool
    ) throws -> URL {
        var query = [("repo", repo), ("collection", collection), ("limit", String(limit))]
        if reverse {
            query.append(("reverse", "true"))
        }
        if let cursor, !cursor.isEmpty {
            query.append(("cursor", cursor))
        }
        return makeURL(try PDSServer.requireBase(pds), path: "/xrpc/com.atproto.repo.listRecords", query: query)
    }
}
