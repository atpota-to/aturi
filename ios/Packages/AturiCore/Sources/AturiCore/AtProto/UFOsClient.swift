import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// MARK: - Wire types (src/utils/ufos/config.ts)

/// Per-collection record-operation counts in a time window. Field names
/// follow the UFOs OpenAPI schema (`dids_estimate` on the wire); a missing
/// counter reads as zero, as `s.creates ?? 0` does on the web.
public struct JustCount: Codable, Hashable, Sendable {
    public var creates: Int
    public var updates: Int
    public var deletes: Int
    public var didsEstimate: Int

    public static let zero = JustCount()

    public init(creates: Int = 0, updates: Int = 0, deletes: Int = 0, didsEstimate: Int = 0) {
        self.creates = creates
        self.updates = updates
        self.deletes = deletes
        self.didsEstimate = didsEstimate
    }

    private enum CodingKeys: String, CodingKey {
        case creates, updates, deletes
        case didsEstimate = "dids_estimate"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        creates = UFOsDecoding.integer(container, .creates)
        updates = UFOsDecoding.integer(container, .updates)
        deletes = UFOsDecoding.integer(container, .deletes)
        didsEstimate = UFOsDecoding.integer(container, .didsEstimate)
    }

    /// Project the count for the chosen metric. Port of `statForMetric`.
    public func stat(for metric: Metric) -> Int {
        switch metric {
        case .creates: return creates
        case .updates: return updates
        case .deletes: return deletes
        case .dids: return didsEstimate
        }
    }
}

/// A collection NSID with its counts (a `/collections` or `/search` row).
public struct NsidCount: Codable, Hashable, Sendable {
    public var nsid: String
    public var counts: JustCount

    public init(nsid: String, counts: JustCount) {
        self.nsid = nsid
        self.counts = counts
    }

    private enum CodingKeys: String, CodingKey {
        case nsid, creates, updates, deletes
        case didsEstimate = "dids_estimate"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        nsid = try container.decode(String.self, forKey: .nsid)
        counts = try JustCount(from: decoder)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(nsid, forKey: .nsid)
        try container.encode(counts.creates, forKey: .creates)
        try container.encode(counts.updates, forKey: .updates)
        try container.encode(counts.deletes, forKey: .deletes)
        try container.encode(counts.didsEstimate, forKey: .didsEstimate)
    }

    public func stat(for metric: Metric) -> Int {
        counts.stat(for: metric)
    }
}

/// A child of a `/prefix` listing: either a concrete collection or a deeper
/// sub-prefix (lexicon group) with aggregated counts. Discriminated by the
/// wire field `type`.
public enum PrefixChild: Codable, Hashable, Sendable {
    case collection(nsid: String, counts: JustCount)
    case prefix(prefix: String, counts: JustCount)

    public var counts: JustCount {
        switch self {
        case .collection(_, let counts), .prefix(_, let counts): return counts
        }
    }

    /// The NSID or the prefix, whichever this child names.
    public var name: String {
        switch self {
        case .collection(let nsid, _): return nsid
        case .prefix(let prefix, _): return prefix
        }
    }

    public var isPrefix: Bool {
        if case .prefix = self { return true }
        return false
    }

    public func stat(for metric: Metric) -> Int {
        counts.stat(for: metric)
    }

    private enum CodingKeys: String, CodingKey {
        case type, nsid, prefix, creates, updates, deletes
        case didsEstimate = "dids_estimate"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        let counts = try JustCount(from: decoder)
        switch type {
        case "collection":
            self = .collection(nsid: try container.decode(String.self, forKey: .nsid), counts: counts)
        case "prefix":
            self = .prefix(prefix: try container.decode(String.self, forKey: .prefix), counts: counts)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container, debugDescription: "Unknown prefix child type \(type)"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .collection(let nsid, _):
            try container.encode("collection", forKey: .type)
            try container.encode(nsid, forKey: .nsid)
        case .prefix(let prefix, _):
            try container.encode("prefix", forKey: .type)
            try container.encode(prefix, forKey: .prefix)
        }
        try container.encode(counts.creates, forKey: .creates)
        try container.encode(counts.updates, forKey: .updates)
        try container.encode(counts.deletes, forKey: .deletes)
        try container.encode(counts.didsEstimate, forKey: .didsEstimate)
    }
}

/// A recent record sample from `/records`. `record` is the raw value.
public struct ApiRecord: Codable, Hashable, Sendable {
    public var collection: String
    public var did: String
    public var record: JSONValue?
    public var rkey: String
    /// Firehose timestamp in MICROseconds since the epoch.
    public var timeUs: Int

    public init(collection: String, did: String, record: JSONValue? = nil, rkey: String, timeUs: Int) {
        self.collection = collection
        self.did = did
        self.record = record
        self.rkey = rkey
        self.timeUs = timeUs
    }

    private enum CodingKeys: String, CodingKey {
        case collection, did, record, rkey
        case timeUs = "time_us"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        collection = try container.decode(String.self, forKey: .collection)
        did = try container.decode(String.self, forKey: .did)
        record = try container.decodeIfPresent(JSONValue.self, forKey: .record)
        rkey = try container.decode(String.self, forKey: .rkey)
        timeUs = UFOsDecoding.integer(container, .timeUs)
    }

    public var atUri: String {
        "at://\(did)/\(collection)/\(rkey)"
    }

    public var time: Date {
        Date(timeIntervalSince1970: Double(timeUs) / 1_000_000)
    }
}

/// Rollup / consumer freshness info from `/meta`.
public struct UFOsMeta: Codable, Hashable, Sendable {
    public var consumer: JSONValue?
    public var storage: JSONValue?
    public var storageName: String

    public init(consumer: JSONValue? = nil, storage: JSONValue? = nil, storageName: String) {
        self.consumer = consumer
        self.storage = storage
        self.storageName = storageName
    }

    private enum CodingKeys: String, CodingKey {
        case consumer, storage
        case storageName = "storage_name"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        consumer = try container.decodeIfPresent(JSONValue.self, forKey: .consumer)
        storage = try container.decodeIfPresent(JSONValue.self, forKey: .storage)
        storageName = try container.decodeIfPresent(String.self, forKey: .storageName) ?? ""
    }
}

/// The two sort orders `/collections` and `/prefix` accept.
public enum CollectionOrder: String, Codable, CaseIterable, Hashable, Sendable {
    case recordsCreated = "records-created"
    case didsEstimate = "dids-estimate"
}

/// UI-facing metric. `dids` maps onto the API's `dids_estimate` field; the
/// other three are 1:1 with the operation counts.
public enum Metric: String, Codable, CaseIterable, Hashable, Sendable {
    case creates, updates, deletes, dids

    /// `METRIC_LABEL`.
    public var label: String {
        switch self {
        case .creates: return "Creates"
        case .updates: return "Updates"
        case .deletes: return "Deletes"
        case .dids: return "DIDs"
        }
    }

    /// `/collections` only supports two sort orders. Pick the closest to the
    /// chosen metric; deletes / updates fall back to records-created since
    /// the API cannot sort by them. Port of `orderForMetric`.
    public var collectionOrder: CollectionOrder {
        self == .dids ? .didsEstimate : .recordsCreated
    }
}

// MARK: - Windows (src/utils/ufos/windows.ts)

/// Time-window presets shared by the trending strip, the lexicon detail
/// screen and the timeseries fetchers. `step` (seconds) and `bucketCount`
/// encode the sparkline granularity for each window; every step satisfies
/// the API's 3600 s minimum.
public enum UFOsWindow: String, Codable, CaseIterable, Hashable, Sendable {
    case oneDay = "1d"
    case sevenDays = "7d"
    case thirtyDays = "30d"

    public var label: String { rawValue }

    public var hours: Int {
        switch self {
        case .oneDay: return 24
        case .sevenDays: return 24 * 7
        case .thirtyDays: return 24 * 30
        }
    }

    /// Bucket width in seconds.
    public var step: Int {
        switch self {
        case .oneDay: return 60 * 60 * 2
        case .sevenDays: return 60 * 60 * 12
        case .thirtyDays: return 60 * 60 * 24
        }
    }

    public var bucketCount: Int {
        switch self {
        case .oneDay: return 12
        case .sevenDays: return 14
        case .thirtyDays: return 30
        }
    }

    public var config: UFOsWindowConfig {
        UFOsWindowConfig(label: label, hours: hours, step: step, bucketCount: bucketCount)
    }
}

/// `WindowConfig`, for callers that want the four numbers as one value.
public struct UFOsWindowConfig: Hashable, Sendable {
    public var label: String
    public var hours: Int
    public var step: Int
    public var bucketCount: Int

    public init(label: String, hours: Int, step: Int, bucketCount: Int) {
        self.label = label
        self.hours = hours
        self.step = step
        self.bucketCount = bucketCount
    }
}

// MARK: - Result shapes

/// `failed` distinguishes a real request failure from a genuinely empty
/// result, so callers can show an error state instead of silently
/// rendering an outage as "no data".
public struct UFOsCollectionsPage: Hashable, Sendable {
    public var collections: [NsidCount]
    /// Non-nil when more pages are available.
    public var cursor: String?
    public var failed: Bool

    public init(collections: [NsidCount], cursor: String? = nil, failed: Bool = false) {
        self.collections = collections
        self.cursor = cursor
        self.failed = failed
    }
}

public struct UFOsCollectionStats: Hashable, Sendable {
    /// Keyed by NSID.
    public var stats: [String: JustCount]
    public var failed: Bool

    public init(stats: [String: JustCount], failed: Bool = false) {
        self.stats = stats
        self.failed = failed
    }
}

public struct UFOsTimeseries: Hashable, Sendable {
    /// Aligned bucket timestamps.
    public var range: [String]
    /// Buckets keyed by NSID, one entry per element of `range`.
    public var series: [String: [JustCount]]
    public var failed: Bool

    public init(range: [String], series: [String: [JustCount]], failed: Bool = false) {
        self.range = range
        self.series = series
        self.failed = failed
    }
}

public struct UFOsSearchResult: Hashable, Sendable {
    public var matches: [NsidCount]
    public var failed: Bool

    public init(matches: [NsidCount], failed: Bool = false) {
        self.matches = matches
        self.failed = failed
    }
}

public struct UFOsPrefixPage: Hashable, Sendable {
    public var children: [PrefixChild]
    public var cursor: String?
    /// Aggregated counts over the whole group.
    public var total: JustCount
    public var failed: Bool

    public init(children: [PrefixChild], cursor: String? = nil, total: JustCount = .zero, failed: Bool = false) {
        self.children = children
        self.cursor = cursor
        self.total = total
        self.failed = failed
    }
}

public struct UFOsRecentRecords: Hashable, Sendable {
    public var records: [ApiRecord]
    public var failed: Bool

    public init(records: [ApiRecord], failed: Bool = false) {
        self.records = records
        self.failed = failed
    }
}

// MARK: - Client (src/utils/ufos/client.ts)

/// Typed client for the UFOs API (ufos-api.microcosm.blue), "every lexicon
/// in the ATmosphere". One function per endpoint; every function degrades
/// gracefully (empty result plus `failed`, or nil) instead of throwing, so
/// callers can render without do/catch. Each function is the failure-aware
/// `*Result` variant of its web counterpart.
public struct UFOsClient: Sendable {
    private let http: HTTPClient

    public init(http: HTTPClient = .shared) {
        self.http = http
    }

    /// GET /collections: list collections with stats.
    ///
    /// `order` and `cursor` are mutually exclusive (sorted results cannot be
    /// paged); when `order` is set the cursor is dropped.
    public func fetchCollections(
        order: CollectionOrder? = nil,
        cursor: String? = nil,
        limit: Int? = nil,
        since: String? = nil,
        until: String? = nil
    ) async -> UFOsCollectionsPage {
        var query: [(String, String)] = []
        if let order {
            query.append(("order", order.rawValue))
        } else if let cursor, !cursor.isEmpty {
            query.append(("cursor", cursor))
        }
        if let limit {
            query.append(("limit", String(limit)))
        }
        UFOsClient.appendRange(&query, since: since, until: until)
        let url = makeURL(Endpoints.ufos, path: "/collections", query: query)
        guard let data = await http.getJSONOrNil(UFOsCollectionsWire.self, from: url) else {
            return UFOsCollectionsPage(collections: [], cursor: nil, failed: true)
        }
        return UFOsCollectionsPage(
            collections: (data.collections ?? []).compactMap(\.value),
            cursor: data.cursor,
            failed: false
        )
    }

    /// GET /collections/stats: record stats for one or more collections
    /// over a time window, keyed by NSID. An empty request is answered
    /// locally with an empty map.
    public func fetchCollectionStats(
        collections: [String],
        since: String? = nil,
        until: String? = nil
    ) async -> UFOsCollectionStats {
        guard !collections.isEmpty else { return UFOsCollectionStats(stats: [:], failed: false) }
        var query = collections.map { ("collection", $0) }
        UFOsClient.appendRange(&query, since: since, until: until)
        let url = makeURL(Endpoints.ufos, path: "/collections/stats", query: query)
        guard let data = await http.getJSONOrNil([String: UFOsLenient<JustCount>].self, from: url) else {
            return UFOsCollectionStats(stats: [:], failed: true)
        }
        var stats: [String: JustCount] = [:]
        for (nsid, entry) in data {
            if let counts = entry.value { stats[nsid] = counts }
        }
        return UFOsCollectionStats(stats: stats, failed: false)
    }

    /// GET /timeseries: time-bucketed stats for a single collection. `step`
    /// is in seconds (min 3600, rounded down to the hour by the API).
    public func fetchTimeseries(
        collection: String,
        since: String? = nil,
        step: Int? = nil,
        until: String? = nil
    ) async -> UFOsTimeseries {
        var query = [("collection", collection)]
        if let step {
            query.append(("step", String(step)))
        }
        UFOsClient.appendRange(&query, since: since, until: until)
        let url = makeURL(Endpoints.ufos, path: "/timeseries", query: query)
        guard let data = await http.getJSONOrNil(UFOsTimeseriesWire.self, from: url) else {
            return UFOsTimeseries(range: [], series: [:], failed: true)
        }
        var series: [String: [JustCount]] = [:]
        for (nsid, buckets) in data.series ?? [:] {
            if let buckets = buckets.value { series[nsid] = buckets }
        }
        return UFOsTimeseries(range: data.range ?? [], series: series, failed: false)
    }

    /// GET /search: lexicon search. The API requires at least two
    /// alphanumeric/hyphen characters in the query; that is checked here to
    /// avoid 400s, and a too-short query answers empty without a request.
    public func searchLexicons(_ query: String) async -> UFOsSearchResult {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard UFOsClient.isSearchable(trimmed) else { return UFOsSearchResult(matches: [], failed: false) }
        let url = makeURL(Endpoints.ufos, path: "/search", query: [("q", trimmed)])
        guard let data = await http.getJSONOrNil(UFOsSearchWire.self, from: url) else {
            return UFOsSearchResult(matches: [], failed: true)
        }
        return UFOsSearchResult(matches: (data.matches ?? []).compactMap(\.value), failed: false)
    }

    /// GET /prefix: enumerate a lexicon group. `prefix` is everything
    /// before the final NSID segment (e.g. `app.bsky.feed`). Like
    /// /collections, `order` and `cursor` are mutually exclusive.
    public func fetchPrefix(
        prefix: String,
        order: CollectionOrder? = nil,
        cursor: String? = nil,
        limit: Int? = nil,
        since: String? = nil,
        until: String? = nil
    ) async -> UFOsPrefixPage {
        var query = [("prefix", prefix)]
        if let order {
            query.append(("order", order.rawValue))
        } else if let cursor, !cursor.isEmpty {
            query.append(("cursor", cursor))
        }
        if let limit {
            query.append(("limit", String(limit)))
        }
        UFOsClient.appendRange(&query, since: since, until: until)
        let url = makeURL(Endpoints.ufos, path: "/prefix", query: query)
        guard let data = await http.getJSONOrNil(UFOsPrefixWire.self, from: url) else {
            return UFOsPrefixPage(children: [], cursor: nil, total: .zero, failed: true)
        }
        return UFOsPrefixPage(
            children: (data.children ?? []).compactMap(\.value),
            cursor: data.cursor,
            total: data.total ?? .zero,
            failed: false
        )
    }

    /// GET /records: recent record samples for one or more collections,
    /// newest activity from the firehose.
    public func fetchRecentRecords(collections: [String]) async -> UFOsRecentRecords {
        guard !collections.isEmpty else { return UFOsRecentRecords(records: [], failed: false) }
        let url = makeURL(Endpoints.ufos, path: "/records", query: collections.map { ("collection", $0) })
        guard let data = await http.getJSONOrNil([UFOsLenient<ApiRecord>].self, from: url) else {
            return UFOsRecentRecords(records: [], failed: true)
        }
        return UFOsRecentRecords(records: data.compactMap(\.value), failed: false)
    }

    /// GET /meta: rollup / consumer freshness info, or nil on failure.
    public func fetchMeta() async -> UFOsMeta? {
        await http.getJSONOrNil(UFOsMeta.self, from: makeURL(Endpoints.ufos, path: "/meta"))
    }

    // MARK: Pure helpers (config.ts)

    /// Port of `statForMetric`.
    public static func statForMetric(_ counts: JustCount, _ metric: Metric) -> Int {
        counts.stat(for: metric)
    }

    /// Port of `orderForMetric`.
    public static func orderForMetric(_ metric: Metric) -> CollectionOrder {
        metric.collectionOrder
    }

    /// ISO timestamp `hours` ago, the form the API's `since`/`until` expect.
    public static func isoAgo(hours: Double, now: Date = Date()) -> String {
        Formatting.isoTimestamp(now.addingTimeInterval(-hours * 60 * 60))
    }

    /// The API's minimum: two characters matching `[a-z0-9-]`, case
    /// insensitive, anywhere in the query.
    public static func isSearchable(_ query: String) -> Bool {
        var matched = 0
        for scalar in query.unicodeScalars {
            switch scalar {
            case "a"..."z", "A"..."Z", "0"..."9", "-":
                matched += 1
                if matched >= 2 { return true }
            default:
                continue
            }
        }
        return false
    }

    /// Append `since`/`until` ISO bounds when provided (empty means absent).
    private static func appendRange(_ query: inout [(String, String)], since: String?, until: String?) {
        if let since, !since.isEmpty { query.append(("since", since)) }
        if let until, !until.isEmpty { query.append(("until", until)) }
    }
}

// MARK: - NSID helpers (src/utils/ufos/nsid.ts)

/// Pure NSID helpers shared by the lexicons screens and the record usage
/// card. No network IO. Segment splitting follows JavaScript's
/// `split('.')`, so an empty string is one empty segment.
public enum NSID {
    /// First two segments: `app.bsky.feed.post` -> `app.bsky`. Single- or
    /// two-segment NSIDs return the whole NSID.
    public static func namespaceKey(_ nsid: String) -> String {
        let parts = nsid.components(separatedBy: ".")
        if parts.count <= 2 { return nsid }
        return "\(parts[0]).\(parts[1])"
    }

    /// Split an NSID into its top-2-segment namespace and the remainder, so
    /// narrow screens can stack the two on separate lines instead of
    /// truncating. `app.bsky.feed.post` -> `(app.bsky, feed.post)`; NSIDs
    /// with two or fewer segments return an empty tail.
    public static func splitNsid(_ nsid: String) -> (head: String, tail: String) {
        let parts = nsid.components(separatedBy: ".")
        if parts.count <= 2 { return (nsid, "") }
        return ("\(parts[0]).\(parts[1])", parts[2...].joined(separator: "."))
    }

    /// The parent lexicon group, everything before the final NSID segment:
    /// `app.bsky.feed.post` -> `app.bsky.feed`. Used as the `/prefix`
    /// argument to find sibling collections.
    public static func groupPrefix(_ nsid: String) -> String {
        let parts = nsid.components(separatedBy: ".")
        if parts.count <= 1 { return nsid }
        return parts.dropLast().joined(separator: ".")
    }

    /// Convention: an NSID like `<tld>.<owner>.<...>` maps to `<owner>.<tld>`
    /// as the publisher's handle. `net.anisota.harvest.minigame` ->
    /// `anisota.net`, `app.bsky.feed.post` -> `bsky.app`.
    public static func publisherForNsid(_ nsid: String) -> String {
        let parts = nsid.components(separatedBy: ".")
        if parts.count < 2 { return nsid }
        return "\(parts[1]).\(parts[0])"
    }

    /// Lexicon-schema records live at this collection on the publisher's
    /// repo, keyed by the full NSID. The explorer's record screen renders
    /// them, falling through to a not-found message when the publisher has
    /// not published a schema.
    public static func schemaPathFor(_ nsid: String) -> String {
        "/explore/\(publisherForNsid(nsid))/com.atproto.lexicon.schema/\(URIEncoding.encodeComponent(nsid))"
    }

    /// Deep link into the lexicons explorer for a given NSID.
    public static func lexiconPathFor(_ nsid: String) -> String {
        "/explore/lexicons/\(URIEncoding.encodeComponent(nsid))"
    }

    /// Deep link into the namespace/prefix browse page for a lexicon group
    /// (e.g. `net.anisota`) or a free-text term.
    public static func groupPathFor(_ prefix: String) -> String {
        "/explore/lexicons/group/\(URIEncoding.encodeComponent(prefix))"
    }
}

// MARK: - Formatters (src/utils/ufos/format.ts)

/// Pure number formatters shared across the lexicons UI.
public enum UFOsFormat {
    /// Compact count: 1_234 -> "1.2k", 1_500_000 -> "1.5M",
    /// 2_100_000_000 -> "2.1B"; below a thousand the number prints as is.
    public static func formatCount(_ n: Int) -> String {
        let value = Double(n)
        if value >= 1_000_000_000 { return toFixed(value / 1_000_000_000, 1) + "B" }
        if value >= 1_000_000 { return toFixed(value / 1_000_000, 1) + "M" }
        if value >= 1_000 { return toFixed(value / 1_000, 1) + "k" }
        return String(n)
    }

    /// Signed percent: 1 decimal under 100%, 0 decimals at/above.
    public static func formatPct(_ pct: Double) -> String {
        let sign = pct >= 0 ? "+" : ""
        if abs(pct) >= 100 { return sign + toFixed(pct, 0) + "%" }
        return sign + toFixed(pct, 1) + "%"
    }

    /// JavaScript `Number.prototype.toFixed`. printf rounds from the exact
    /// binary value like JavaScript does, except on an exact tie (1.25 to
    /// one place), where printf rounds to even and JavaScript rounds the
    /// magnitude up; so 1250 reads "1.3k" here as it does on the web.
    static func toFixed(_ value: Double, _ digits: Int) -> String {
        guard value.isFinite else { return value.isNaN ? "NaN" : (value < 0 ? "-Infinity" : "Infinity") }
        let negative = value < 0
        let magnitude = abs(value)
        let text = tieRoundedUp(magnitude, digits) ?? String(format: "%.\(digits)f", magnitude)
        return negative ? "-" + text : text
    }

    /// When `magnitude * 10^digits` sits exactly on a .5 boundary, the
    /// JavaScript result (rounded up); nil otherwise, where printf agrees.
    ///
    /// Decided in integers on the double's significand: a scaled product in
    /// floating point can itself round onto the boundary (1.45 * 10 lands
    /// on 14.5 although 1.45 is stored just below it), which would turn a
    /// "1.4" into a "1.5".
    private static func tieRoundedUp(_ magnitude: Double, _ digits: Int) -> String? {
        guard magnitude.isNormal, (0...3).contains(digits) else { return nil }
        // magnitude == significand * 2^-shift, with shift > 0 for anything
        // that has a fractional part at all.
        let shift = 52 - magnitude.exponent
        guard shift > 0, shift <= 62 else { return nil }
        let significand = magnitude.significandBitPattern | (1 << 52)
        let scale: UInt64 = [1, 10, 100, 1000][digits]
        let (scaled, overflow) = significand.multipliedReportingOverflow(by: scale)
        guard !overflow else { return nil }
        let denominator: UInt64 = 1 << UInt64(shift)
        guard scaled % denominator == denominator / 2 else { return nil }
        let roundedUp = scaled / denominator + 1
        let whole = roundedUp / scale
        if digits == 0 { return String(whole) }
        let fraction = String(roundedUp % scale)
        return String(whole) + "." + String(repeating: "0", count: digits - fraction.count) + fraction
    }
}

// MARK: - Decoding helpers

/// Wraps an element so one malformed row is dropped instead of failing the
/// whole page, which is what the web's `Array.isArray` / `typeof entry ===
/// 'object'` guards amount to.
private struct UFOsLenient<Wrapped: Decodable>: Decodable {
    let value: Wrapped?

    init(from decoder: Decoder) throws {
        value = try? Wrapped(from: decoder)
    }
}

private enum UFOsDecoding {
    /// A counter that may arrive as an integer, a float or not at all.
    static func integer<Key: CodingKey>(_ container: KeyedDecodingContainer<Key>, _ key: Key) -> Int {
        if let exact = try? container.decodeIfPresent(Int.self, forKey: key) { return exact }
        if let double = try? container.decodeIfPresent(Double.self, forKey: key), double.isFinite { return Int(double) }
        return 0
    }
}

private struct UFOsCollectionsWire: Decodable {
    var collections: [UFOsLenient<NsidCount>]?
    var cursor: String?
}

private struct UFOsTimeseriesWire: Decodable {
    var range: [String]?
    var series: [String: UFOsLenient<[JustCount]>]?
}

private struct UFOsSearchWire: Decodable {
    var matches: [UFOsLenient<NsidCount>]?
}

private struct UFOsPrefixWire: Decodable {
    var children: [UFOsLenient<PrefixChild>]?
    var cursor: String?
    var total: JustCount?
}
