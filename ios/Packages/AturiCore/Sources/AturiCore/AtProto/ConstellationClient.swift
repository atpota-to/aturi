import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One (collection, record path) pair that points at a target, with how many
/// records do so and from how many distinct repos. Port of `BacklinkSource`
/// in `src/utils/atproto/constellation.ts`.
public struct BacklinkSource: Hashable, Sendable {
    public var collection: String
    /// The path exactly as `/links/all` prints it, leading dot included
    /// (".subject", or "." for a root-level link).
    public var path: String
    /// `collection:path` in the form `getBacklinks` takes as `source`.
    public var source: String
    public var count: Int
    /// Nil when the index did not report distinct linking DIDs for this source.
    public var distinctDids: Int?

    public init(collection: String, path: String, source: String, count: Int, distinctDids: Int? = nil) {
        self.collection = collection
        self.path = path
        self.source = source
        self.count = count
        self.distinctDids = distinctDids
    }
}

/// Link coordinates: the record that holds the link, not its content.
/// Hydrate through `SlingshotClient` to read it.
public struct BacklinkRecord: Codable, Hashable, Sendable {
    public var did: String
    public var collection: String
    public var rkey: String

    public init(did: String, collection: String, rkey: String) {
        self.did = did
        self.collection = collection
        self.rkey = rkey
    }

    public var atUri: String {
        "at://\(did)/\(collection)/\(rkey)"
    }
}

/// A page of `blue.microcosm.links.getBacklinks`. The remote API returns
/// either `records` or `linking_records` depending on the endpoint version;
/// `backlinks` is the normalised view callers should read.
public struct BacklinksPage: Codable, Hashable, Sendable {
    public var records: [BacklinkRecord]?
    public var linkingRecords: [BacklinkRecord]?
    public var cursor: String?

    public init(records: [BacklinkRecord]? = nil, linkingRecords: [BacklinkRecord]? = nil, cursor: String? = nil) {
        self.records = records
        self.linkingRecords = linkingRecords
        self.cursor = cursor
    }

    private enum CodingKeys: String, CodingKey {
        case records
        case linkingRecords = "linking_records"
        case cursor
    }

    /// `records ?? linking_records ?? []`, the port of `backlinksFromPage`.
    public var backlinks: [BacklinkRecord] {
        records ?? linkingRecords ?? []
    }
}

/// Per-source counters as `/links/all` prints them. Older and newer index
/// versions spell the same two numbers differently (`records` / `count`,
/// `distinct_dids` / `distinctDids`), so both spellings are kept and
/// `effectiveCount` picks the way the web does.
public struct BacklinkSourceInfo: Codable, Hashable, Sendable {
    public var records: Int?
    public var count: Int?
    public var distinctDids: Int?

    public init(records: Int? = nil, count: Int? = nil, distinctDids: Int? = nil) {
        self.records = records
        self.count = count
        self.distinctDids = distinctDids
    }

    /// `records ?? count ?? 0`.
    public var effectiveCount: Int {
        records ?? count ?? 0
    }

    /// Anything that is not an object decodes to an info with no numbers,
    /// which flattens to a count of zero, as `info?.records ?? 0` does.
    public init(json: JSONValue) {
        records = BacklinkSourceInfo.integer(json["records"])
        count = BacklinkSourceInfo.integer(json["count"])
        distinctDids = BacklinkSourceInfo.integer(json["distinct_dids"]) ?? BacklinkSourceInfo.integer(json["distinctDids"])
    }

    public init(from decoder: Decoder) throws {
        self.init(json: try JSONValue(from: decoder))
    }

    private enum CodingKeys: String, CodingKey {
        case records, count
        case distinctDids = "distinct_dids"
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(records, forKey: .records)
        try container.encodeIfPresent(count, forKey: .count)
        try container.encodeIfPresent(distinctDids, forKey: .distinctDids)
    }

    private static func integer(_ value: JSONValue?) -> Int? {
        guard let value else { return nil }
        if let exact = value.intValue { return exact }
        if let double = value.doubleValue, double.isFinite { return Int(double) }
        return nil
    }
}

/// Raw `/links/all` payload: collection -> path -> info. The index has
/// answered both as `{ "links": { ... } }` and as the bare map; both decode
/// here, so callers never see the difference.
public struct BacklinkSourcesResponse: Codable, Hashable, Sendable {
    public var links: [String: [String: BacklinkSourceInfo]]

    public init(links: [String: [String: BacklinkSourceInfo]]) {
        self.links = links
    }

    /// Mirrors `raw.links || raw` followed by the per-collection object
    /// check: a `links` member that is an object wins, otherwise the whole
    /// document is the map, and any collection whose value is not an object
    /// is dropped.
    public init(json: JSONValue) {
        let table: [String: JSONValue]
        if let nested = json["links"]?.objectValue {
            table = nested
        } else {
            table = json.objectValue ?? [:]
        }
        var links: [String: [String: BacklinkSourceInfo]] = [:]
        for (collection, paths) in table {
            guard let paths = paths.objectValue else { continue }
            var infos: [String: BacklinkSourceInfo] = [:]
            for (path, info) in paths {
                infos[path] = BacklinkSourceInfo(json: info)
            }
            links[collection] = infos
        }
        self.links = links
    }

    public init(from decoder: Decoder) throws {
        self.init(json: try JSONValue(from: decoder))
    }

    private enum CodingKeys: String, CodingKey {
        case links
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(links, forKey: .links)
    }
}

/// A join record that links a target and a secondary target at once.
public struct ManyToManyItem: Codable, Hashable, Sendable {
    public var linkRecord: BacklinkRecord
    /// The secondary target the join record points at (an AT URI or a DID).
    public var otherSubject: String

    public init(linkRecord: BacklinkRecord, otherSubject: String) {
        self.linkRecord = linkRecord
        self.otherSubject = otherSubject
    }
}

/// The header numbers of the record page's backlinks card, lifted from
/// `BacklinksSummaryPanel` in `BacklinksTab.tsx`.
public struct BacklinkTotals: Hashable, Sendable {
    /// Sum of every source's count.
    public var records: Int
    /// Sum of distinct linking DIDs, or nil when no source reported any
    /// (the card then hides the accounts figure rather than showing 0).
    public var accounts: Int?
    /// Number of distinct sources.
    public var sources: Int

    public init(records: Int, accounts: Int? = nil, sources: Int) {
        self.records = records
        self.accounts = accounts
        self.sources = sources
    }
}

/// Constellation backlinks service client, port of
/// `src/utils/atproto/constellation.ts`. All calls swallow network / 4xx /
/// 5xx errors and return nil so the UI can render "Unavailable" without
/// wrapping every call site in do/catch.
public struct ConstellationClient: Sendable {
    /// Constellation caps `limit` at 100 on every paginated endpoint.
    public static let maxPage = 100

    private let http: HTTPClient

    public init(http: HTTPClient = .shared) {
        self.http = http
    }

    /// All sources (collection + record path) that point at `target`, with
    /// per-source counts and distinct linking DIDs. `target` can be an AT
    /// URI (record) or a bare DID (identity backlinks like follows / blocks).
    public func getBacklinkSources(target: String) async -> BacklinkSourcesResponse? {
        guard !target.isEmpty else { return nil }
        let url = makeURL(Endpoints.constellation, path: "/links/all", query: [("target", target)])
        return await http.getJSONOrNil(BacklinkSourcesResponse.self, from: url)
    }

    /// `flattenSources(getBacklinkSources(target))` in one call. Nil means
    /// the index was unreachable; an empty array means no inbound links.
    public func sources(for target: String) async -> [BacklinkSource]? {
        ConstellationClient.flattenSources(await getBacklinkSources(target: target))
    }

    /// Paginated backlinks for a (target, source) tuple. Returns the raw page
    /// or nil; read `page.backlinks` for the normalised record list.
    public func getBacklinks(
        target: String,
        source: String,
        limit: Int = 25,
        cursor: String? = nil
    ) async -> BacklinksPage? {
        guard !target.isEmpty, !source.isEmpty else { return nil }
        var query = [("subject", target), ("source", source), ("limit", String(limit))]
        if let cursor, !cursor.isEmpty {
            query.append(("cursor", cursor))
        }
        let url = makeURL(Endpoints.constellation, path: "/xrpc/blue.microcosm.links.getBacklinks", query: query)
        return await http.getJSONOrNil(BacklinksPage.self, from: url)
    }

    /// Every backlink for a (target, source) tuple, following the cursor
    /// until the index is exhausted or `max` records have been collected.
    /// Returns nil only when the first page fails; a mid-pagination failure
    /// yields what we have, since a partial list beats an empty one.
    ///
    /// `dids` narrows the result to specific linking identities server-side,
    /// far cheaper than paging the whole set and filtering here when only
    /// one author's links can possibly matter.
    public func getAllBacklinks(
        target: String,
        source: String,
        max: Int = 500,
        reverse: Bool = false,
        dids: [String] = []
    ) async -> [BacklinkRecord]? {
        guard !target.isEmpty, !source.isEmpty else { return nil }
        var out: [BacklinkRecord] = []
        var cursor: String?

        while out.count < max {
            var query = [
                ("subject", target),
                ("source", source),
                ("limit", String(Swift.min(ConstellationClient.maxPage, max - out.count))),
            ]
            if let cursor, !cursor.isEmpty {
                query.append(("cursor", cursor))
            }
            if reverse {
                query.append(("reverse", "true"))
            }
            for did in dids {
                query.append(("did", did))
            }
            let url = makeURL(Endpoints.constellation, path: "/xrpc/blue.microcosm.links.getBacklinks", query: query)
            guard let page = await http.getJSONOrNil(BacklinksPage.self, from: url) else {
                return out.isEmpty ? nil : out
            }
            let records = page.backlinks
            out.append(contentsOf: records)
            guard let next = page.cursor, !next.isEmpty, !records.isEmpty else { break }
            cursor = next
        }

        return out
    }

    /// Join records that link a target and a secondary target, e.g. an
    /// `app.userinput.pin` carries both `space.uri` (the target) and
    /// `subject.uri` (the pinned discussion). One request returns both ends
    /// of every pin, where `getBacklinks` would return the pin coordinates
    /// and leave us to hydrate each record just to read the other side.
    ///
    /// `pathToOther` is the record path of the secondary link without a
    /// leading dot (`subject.uri` for a strongRef, `subject` for a bare DID).
    public func getManyToMany(
        target: String,
        source: String,
        pathToOther: String,
        max: Int = 500
    ) async -> [ManyToManyItem]? {
        guard !target.isEmpty, !source.isEmpty, !pathToOther.isEmpty else { return nil }
        var out: [ManyToManyItem] = []
        var cursor: String?

        while out.count < max {
            var query = [
                ("subject", target),
                ("source", source),
                ("pathToOther", pathToOther),
                ("limit", String(Swift.min(ConstellationClient.maxPage, max - out.count))),
            ]
            if let cursor, !cursor.isEmpty {
                query.append(("cursor", cursor))
            }
            let url = makeURL(Endpoints.constellation, path: "/xrpc/blue.microcosm.links.getManyToMany", query: query)
            guard let page = await http.getJSONOrNil(ManyToManyPage.self, from: url) else {
                return out.isEmpty ? nil : out
            }
            let items = page.items ?? []
            out.append(contentsOf: items)
            guard let next = page.cursor, !next.isEmpty, !items.isEmpty else { break }
            cursor = next
        }

        return out
    }

    /// Per-source counts for one target, keyed by `collection:path` in the
    /// same `source` form `getBacklinks` takes. One request covers every
    /// relationship pointing at a record.
    public func getBacklinkCounts(target: String) async -> [String: BacklinkSource]? {
        guard let sources = ConstellationClient.flattenSources(await getBacklinkSources(target: target)) else {
            return nil
        }
        return Dictionary(sources.map { ($0.source, $0) }, uniquingKeysWith: { _, last in last })
    }

    /// Flatten `getBacklinkSources` output into an array sorted by count,
    /// largest first. Nil when the underlying call failed.
    ///
    /// Ties are broken by source name so the order is stable across runs;
    /// the web keeps the index's own (insertion) order for ties, which a
    /// Swift dictionary cannot preserve.
    public static func flattenSources(_ raw: BacklinkSourcesResponse?) -> [BacklinkSource]? {
        guard let raw else { return nil }
        var out: [BacklinkSource] = []
        for (collection, paths) in raw.links {
            for (path, info) in paths {
                // /links/all returns the path with a leading dot (e.g.
                // ".subject"), but getBacklinks' `source` param uses the
                // unprefixed form ("app.bsky.graph.follow:subject"), so the
                // dot is stripped.
                //
                // The exception is a root-level link, whose whole path is
                // ".". Stripping there leaves "collection:", which
                // getBacklinks answers with nothing at all rather than an
                // error, silently hiding every root-path source
                // (sh.tangled.graph.vouch and friends). Verified against the
                // live index: "sh.tangled.graph.vouch:." returns records,
                // and "sh.tangled.graph.vouch:" returns none.
                let sourcePath = path == "." ? path : (path.hasPrefix(".") ? String(path.dropFirst()) : path)
                out.append(BacklinkSource(
                    collection: collection,
                    path: path,
                    source: "\(collection):\(sourcePath)",
                    count: info.effectiveCount,
                    distinctDids: info.distinctDids
                ))
            }
        }
        out.sort { lhs, rhs in
            if lhs.count != rhs.count { return lhs.count > rhs.count }
            return lhs.source < rhs.source
        }
        return out
    }

    /// Normalise a page so callers always see a record array; nil pages
    /// (a failed request) read as empty. Port of `backlinksFromPage`.
    public static func backlinks(from page: BacklinksPage?) -> [BacklinkRecord] {
        page?.backlinks ?? []
    }

    /// The card header numbers for a flattened source list.
    public static func totals(of sources: [BacklinkSource]) -> BacklinkTotals {
        let records = sources.reduce(0) { $0 + $1.count }
        let hasAccounts = sources.contains { $0.distinctDids != nil }
        let accounts = hasAccounts ? sources.reduce(0) { $0 + ($1.distinctDids ?? 0) } : nil
        return BacklinkTotals(records: records, accounts: accounts, sources: sources.count)
    }
}

private struct ManyToManyPage: Decodable {
    var items: [ManyToManyItem]?
    var cursor: String?
}
