import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private final class UFOsFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, reply: Reply)]
    private(set) var urls: [String] = []

    init(_ routes: [(String, Reply)]) {
        self.routes = routes.map { (pattern: $0.0, reply: $0.1) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        record(url)
        let reply = routes.first { url.absoluteString.contains($0.pattern) }?.reply
            ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
        let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: [:])!
        return (Data(reply.body.utf8), response)
    }

    /// Locking stays in a synchronous helper: NSLock is not async-safe.
    private func record(_ url: URL) {
        lock.lock(); defer { lock.unlock() }
        urls.append(url.absoluteString)
    }

    var requestCount: Int {
        lock.lock(); defer { lock.unlock() }
        return urls.count
    }
}

final class UFOsClientTests: XCTestCase {
    private func client(_ transport: UFOsFakeTransport) -> UFOsClient {
        UFOsClient(http: HTTPClient(transport: transport))
    }

    // MARK: /collections

    private let collectionsBody = """
    {"collections":[
      {"nsid":"app.bsky.feed.post","creates":120345,"updates":12,"deletes":3401,"dids_estimate":50210},
      {"nsid":"sh.tangled.repo","creates":42,"updates":0,"deletes":1,"dids_estimate":30},
      {"creates":1,"updates":0,"deletes":0,"dids_estimate":1},
      {"nsid":"net.anisota.harvest.minigame","creates":7.0,"updates":2}
    ],"cursor":"eyJ..."}
    """

    func testFetchCollectionsDecodesTheCannedResponse() async {
        let transport = UFOsFakeTransport([("/collections", .init(status: 200, body: collectionsBody))])
        let page = await client(transport).fetchCollections(order: .recordsCreated, cursor: "ignored", limit: 50, since: "2025-01-01T00:00:00.000Z", until: "2025-01-02T00:00:00.000Z")

        XCTAssertEqual(transport.urls, ["https://ufos-api.microcosm.blue/collections?order=records-created&limit=50&since=2025-01-01T00%3A00%3A00.000Z&until=2025-01-02T00%3A00%3A00.000Z"])
        XCTAssertFalse(page.failed)
        XCTAssertEqual(page.cursor, "eyJ...")
        XCTAssertEqual(page.collections.map(\.nsid), ["app.bsky.feed.post", "sh.tangled.repo", "net.anisota.harvest.minigame"], "a row without an nsid is dropped")
        XCTAssertEqual(page.collections[0].counts, JustCount(creates: 120345, updates: 12, deletes: 3401, didsEstimate: 50210))
        XCTAssertEqual(page.collections[2].counts, JustCount(creates: 7, updates: 2, deletes: 0, didsEstimate: 0), "floats and missing counters are tolerated")
        XCTAssertEqual(page.collections[0].stat(for: .dids), 50210)
    }

    func testFetchCollectionsUsesCursorOnlyWithoutOrder() async {
        let transport = UFOsFakeTransport([("/collections", .init(status: 200, body: #"{"collections":[]}"#))])
        let c = client(transport)
        _ = await c.fetchCollections(cursor: "abc")
        _ = await c.fetchCollections()
        XCTAssertEqual(transport.urls, [
            "https://ufos-api.microcosm.blue/collections?cursor=abc",
            "https://ufos-api.microcosm.blue/collections",
        ])
    }

    func testFetchCollectionsReportsFailure() async {
        let transport = UFOsFakeTransport([("/collections", .init(status: 502, body: "bad gateway"))])
        let page = await client(transport).fetchCollections(limit: 5)
        XCTAssertTrue(page.failed)
        XCTAssertEqual(page.collections, [])
        XCTAssertNil(page.cursor)

        let empty = UFOsFakeTransport([("/collections", .init(status: 200, body: #"{"collections":[],"cursor":null}"#))])
        let none = await client(empty).fetchCollections()
        XCTAssertFalse(none.failed)
        XCTAssertNil(none.cursor)
    }

    // MARK: /collections/stats

    func testFetchCollectionStatsRepeatsCollectionAndSkipsNonObjects() async {
        let transport = UFOsFakeTransport([
            ("/collections/stats", .init(status: 200, body: #"{"app.bsky.feed.post":{"creates":5,"updates":1,"deletes":0,"dids_estimate":4},"sh.tangled.repo":null,"x.y.z":7}"#)),
        ])
        let result = await client(transport).fetchCollectionStats(collections: ["app.bsky.feed.post", "sh.tangled.repo"], since: "s", until: "u")
        XCTAssertEqual(transport.urls, ["https://ufos-api.microcosm.blue/collections/stats?collection=app.bsky.feed.post&collection=sh.tangled.repo&since=s&until=u"])
        XCTAssertFalse(result.failed)
        XCTAssertEqual(result.stats, ["app.bsky.feed.post": JustCount(creates: 5, updates: 1, deletes: 0, didsEstimate: 4)])
    }

    func testFetchCollectionStatsWithNoCollectionsAsksNothing() async {
        let transport = UFOsFakeTransport([])
        let result = await client(transport).fetchCollectionStats(collections: [])
        XCTAssertEqual(result, UFOsCollectionStats(stats: [:], failed: false))
        XCTAssertEqual(transport.requestCount, 0)

        let failing = UFOsFakeTransport([("/collections/stats", .init(status: 500, body: ""))])
        let failed = await client(failing).fetchCollectionStats(collections: ["a.b.c"])
        XCTAssertTrue(failed.failed)
        XCTAssertEqual(failed.stats, [:])
    }

    // MARK: /timeseries

    func testFetchTimeseriesDecodesRangeAndSeries() async {
        let transport = UFOsFakeTransport([
            ("/timeseries", .init(status: 200, body: #"{"range":["2025-01-01T00:00:00Z","2025-01-01T02:00:00Z"],"series":{"app.bsky.feed.post":[{"creates":1,"updates":0,"deletes":0,"dids_estimate":1},{"creates":2,"updates":0,"deletes":0,"dids_estimate":2}],"broken":"nope"}}"#)),
        ])
        let result = await client(transport).fetchTimeseries(collection: "app.bsky.feed.post", since: "s", step: 7200, until: "u")
        XCTAssertEqual(transport.urls, ["https://ufos-api.microcosm.blue/timeseries?collection=app.bsky.feed.post&step=7200&since=s&until=u"])
        XCTAssertFalse(result.failed)
        XCTAssertEqual(result.range, ["2025-01-01T00:00:00Z", "2025-01-01T02:00:00Z"])
        XCTAssertEqual(result.series["app.bsky.feed.post"]?.map(\.creates), [1, 2])
        XCTAssertNil(result.series["broken"])
    }

    func testFetchTimeseriesFailure() async {
        let transport = UFOsFakeTransport([("/timeseries", .init(status: 500, body: ""))])
        let result = await client(transport).fetchTimeseries(collection: "a.b.c")
        XCTAssertEqual(result, UFOsTimeseries(range: [], series: [:], failed: true))
        XCTAssertEqual(transport.urls, ["https://ufos-api.microcosm.blue/timeseries?collection=a.b.c"])
    }

    // MARK: /search

    func testSearchLexiconsTrimsAndRequiresTwoSearchableCharacters() async {
        let transport = UFOsFakeTransport([("/search", .init(status: 200, body: #"{"matches":[{"nsid":"app.bsky.feed.post","creates":1,"updates":0,"deletes":0,"dids_estimate":1}]}"#))])
        let c = client(transport)
        let short = await c.searchLexicons(" a ")
        XCTAssertEqual(short, UFOsSearchResult(matches: [], failed: false))
        let punctuation = await c.searchLexicons("..")
        XCTAssertEqual(punctuation.matches, [])
        XCTAssertEqual(transport.requestCount, 0)

        let found = await c.searchLexicons("  feed post ")
        XCTAssertEqual(transport.urls, ["https://ufos-api.microcosm.blue/search?q=feed%20post"])
        XCTAssertEqual(found.matches.map(\.nsid), ["app.bsky.feed.post"])
        XCTAssertFalse(found.failed)

        XCTAssertTrue(UFOsClient.isSearchable("a-"))
        XCTAssertTrue(UFOsClient.isSearchable("x.y"))
        XCTAssertFalse(UFOsClient.isSearchable("a"))
        XCTAssertFalse(UFOsClient.isSearchable("!!!"))
    }

    func testSearchLexiconsReportsFailure() async {
        let transport = UFOsFakeTransport([("/search", .init(status: 503, body: ""))])
        let result = await client(transport).searchLexicons("tangled")
        XCTAssertTrue(result.failed)
        XCTAssertEqual(result.matches, [])
    }

    // MARK: /prefix

    private let prefixBody = """
    {"children":[
      {"type":"collection","nsid":"app.bsky.feed.post","creates":10,"updates":1,"deletes":2,"dids_estimate":9},
      {"type":"prefix","prefix":"app.bsky.feed.threadgate","creates":3,"updates":0,"deletes":0,"dids_estimate":3},
      {"type":"mystery","nsid":"app.bsky.feed.x","creates":1},
      {"type":"collection","creates":1}
    ],"cursor":null,"total":{"creates":13,"updates":1,"deletes":2,"dids_estimate":12}}
    """

    func testFetchPrefixDecodesTheCannedResponse() async {
        let transport = UFOsFakeTransport([("/prefix", .init(status: 200, body: prefixBody))])
        let page = await client(transport).fetchPrefix(prefix: "app.bsky.feed", order: .didsEstimate, limit: 25)
        XCTAssertEqual(transport.urls, ["https://ufos-api.microcosm.blue/prefix?prefix=app.bsky.feed&order=dids-estimate&limit=25"])
        XCTAssertFalse(page.failed)
        XCTAssertNil(page.cursor)
        XCTAssertEqual(page.total, JustCount(creates: 13, updates: 1, deletes: 2, didsEstimate: 12))
        XCTAssertEqual(page.children, [
            .collection(nsid: "app.bsky.feed.post", counts: JustCount(creates: 10, updates: 1, deletes: 2, didsEstimate: 9)),
            .prefix(prefix: "app.bsky.feed.threadgate", counts: JustCount(creates: 3, updates: 0, deletes: 0, didsEstimate: 3)),
        ], "unknown types and a collection without an nsid are dropped")
        XCTAssertEqual(page.children.map(\.name), ["app.bsky.feed.post", "app.bsky.feed.threadgate"])
        XCTAssertEqual(page.children.map(\.isPrefix), [false, true])
        XCTAssertEqual(page.children[1].stat(for: .creates), 3)
    }

    func testFetchPrefixCursorAndFailure() async {
        let transport = UFOsFakeTransport([("/prefix", .init(status: 200, body: #"{"children":[],"cursor":"c2"}"#))])
        let page = await client(transport).fetchPrefix(prefix: "sh.tangled", cursor: "c1", since: "s")
        XCTAssertEqual(transport.urls, ["https://ufos-api.microcosm.blue/prefix?prefix=sh.tangled&cursor=c1&since=s"])
        XCTAssertEqual(page.cursor, "c2")
        XCTAssertEqual(page.total, .zero, "a missing total reads as zero")

        let failing = UFOsFakeTransport([("/prefix", .init(status: 500, body: "")) ])
        let failed = await client(failing).fetchPrefix(prefix: "sh.tangled")
        XCTAssertEqual(failed, UFOsPrefixPage(children: [], cursor: nil, total: .zero, failed: true))
    }

    func testPrefixChildRoundTripsThroughCodable() throws {
        let children: [PrefixChild] = [
            .collection(nsid: "a.b.c", counts: JustCount(creates: 1, updates: 2, deletes: 3, didsEstimate: 4)),
            .prefix(prefix: "a.b", counts: .zero),
        ]
        let data = try JSONEncoder().encode(children)
        XCTAssertEqual(try JSONDecoder().decode([PrefixChild].self, from: data), children)
        let object = try JSONValue.parse(data)
        XCTAssertEqual(object[0]?["type"]?.stringValue, "collection")
        XCTAssertEqual(object[0]?["dids_estimate"]?.intValue, 4)
        XCTAssertEqual(object[1]?["prefix"]?.stringValue, "a.b")
    }

    func testNsidCountRoundTripsThroughCodableWithSnakeCaseKeys() throws {
        let row = NsidCount(nsid: "a.b.c", counts: JustCount(creates: 1, updates: 2, deletes: 3, didsEstimate: 4))
        let data = try JSONEncoder().encode(row)
        XCTAssertEqual(try JSONValue.parse(data), ["nsid": "a.b.c", "creates": 1, "updates": 2, "deletes": 3, "dids_estimate": 4])
        XCTAssertEqual(try JSONDecoder().decode(NsidCount.self, from: data), row)
    }

    // MARK: /records

    func testFetchRecentRecordsDecodesAndSkipsBrokenRows() async {
        let transport = UFOsFakeTransport([
            ("/records", .init(status: 200, body: #"[{"collection":"app.bsky.feed.post","did":"did:plc:x","record":{"text":"hi"},"rkey":"3k","time_us":1700000000123456},{"collection":"a.b.c","did":"did:plc:y","rkey":"r"},{"did":"broken"}]"#)),
        ])
        let result = await client(transport).fetchRecentRecords(collections: ["app.bsky.feed.post", "a.b.c"])
        XCTAssertEqual(transport.urls, ["https://ufos-api.microcosm.blue/records?collection=app.bsky.feed.post&collection=a.b.c"])
        XCTAssertFalse(result.failed)
        XCTAssertEqual(result.records.count, 2)
        XCTAssertEqual(result.records[0].record?["text"]?.stringValue, "hi")
        XCTAssertEqual(result.records[0].timeUs, 1_700_000_000_123_456)
        XCTAssertEqual(result.records[0].atUri, "at://did:plc:x/app.bsky.feed.post/3k")
        XCTAssertEqual(result.records[0].time.timeIntervalSince1970, 1_700_000_000.123456, accuracy: 0.001)
        XCTAssertNil(result.records[1].record)
        XCTAssertEqual(result.records[1].timeUs, 0)
    }

    func testFetchRecentRecordsEmptyInputAndFailure() async {
        let transport = UFOsFakeTransport([])
        let none = await client(transport).fetchRecentRecords(collections: [])
        XCTAssertEqual(none, UFOsRecentRecords(records: [], failed: false))
        XCTAssertEqual(transport.requestCount, 0)

        let failing = UFOsFakeTransport([("/records", .init(status: 500, body: ""))])
        let failed = await client(failing).fetchRecentRecords(collections: ["a.b.c"])
        XCTAssertEqual(failed, UFOsRecentRecords(records: [], failed: true))
    }

    func testApiRecordRoundTripsThroughCodable() throws {
        let record = ApiRecord(collection: "a.b.c", did: "did:plc:x", record: ["k": true], rkey: "r", timeUs: 42)
        let data = try JSONEncoder().encode(record)
        XCTAssertEqual(try JSONValue.parse(data)["time_us"]?.intValue, 42)
        XCTAssertEqual(try JSONDecoder().decode(ApiRecord.self, from: data), record)
    }

    // MARK: /meta

    func testFetchMeta() async {
        let transport = UFOsFakeTransport([("/meta", .init(status: 200, body: #"{"consumer":{"lag_us":12},"storage":{"rollups":3},"storage_name":"fjall"}"#))])
        let meta = await client(transport).fetchMeta()
        XCTAssertEqual(transport.urls, ["https://ufos-api.microcosm.blue/meta"])
        XCTAssertEqual(meta?.storageName, "fjall")
        XCTAssertEqual(meta?.consumer?["lag_us"]?.intValue, 12)

        let failing = UFOsFakeTransport([("/meta", .init(status: 500, body: ""))])
        let none = await client(failing).fetchMeta()
        XCTAssertNil(none)
    }

    // MARK: config helpers

    func testMetricLabelsOrdersAndStats() {
        XCTAssertEqual(Metric.allCases.map(\.label), ["Creates", "Updates", "Deletes", "DIDs"])
        XCTAssertEqual(Metric.allCases.map(\.collectionOrder), [.recordsCreated, .recordsCreated, .recordsCreated, .didsEstimate])
        XCTAssertEqual(UFOsClient.orderForMetric(.deletes), .recordsCreated)
        XCTAssertEqual(CollectionOrder.didsEstimate.rawValue, "dids-estimate")

        let counts = JustCount(creates: 1, updates: 2, deletes: 3, didsEstimate: 4)
        XCTAssertEqual(Metric.allCases.map { counts.stat(for: $0) }, [1, 2, 3, 4])
        XCTAssertEqual(UFOsClient.statForMetric(counts, .dids), 4)
        XCTAssertEqual(JustCount.zero.stat(for: .creates), 0)
    }

    func testIsoAgo() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        XCTAssertEqual(UFOsClient.isoAgo(hours: 24, now: now), "2023-11-13T22:13:20.000Z")
        XCTAssertEqual(UFOsClient.isoAgo(hours: 0, now: now), "2023-11-14T22:13:20.000Z")
        XCTAssertEqual(UFOsClient.isoAgo(hours: 0.5, now: now), "2023-11-14T21:43:20.000Z")
    }

    func testWindowTable() {
        XCTAssertEqual(UFOsWindow.allCases.map(\.rawValue), ["1d", "7d", "30d"])
        XCTAssertEqual(UFOsWindow.allCases.map(\.label), ["1d", "7d", "30d"])
        XCTAssertEqual(UFOsWindow.allCases.map(\.hours), [24, 168, 720])
        XCTAssertEqual(UFOsWindow.allCases.map(\.step), [7200, 43200, 86400])
        XCTAssertEqual(UFOsWindow.allCases.map(\.bucketCount), [12, 14, 30])
        XCTAssertEqual(UFOsWindow.sevenDays.config, UFOsWindowConfig(label: "7d", hours: 168, step: 43200, bucketCount: 14))
        for window in UFOsWindow.allCases {
            XCTAssertGreaterThanOrEqual(window.step, 3600, "the API's minimum step")
        }
        XCTAssertEqual(UFOsWindow(rawValue: "30d"), .thirtyDays)
    }

    // MARK: NSID helpers

    func testNamespaceKey() {
        XCTAssertEqual(NSID.namespaceKey("app.bsky.feed.post"), "app.bsky")
        XCTAssertEqual(NSID.namespaceKey("app.bsky"), "app.bsky")
        XCTAssertEqual(NSID.namespaceKey("app"), "app")
        XCTAssertEqual(NSID.namespaceKey(""), "")
    }

    func testSplitNsid() {
        let split = NSID.splitNsid("app.bsky.feed.post")
        XCTAssertEqual(split.head, "app.bsky")
        XCTAssertEqual(split.tail, "feed.post")
        let short = NSID.splitNsid("app.bsky")
        XCTAssertEqual(short.head, "app.bsky")
        XCTAssertEqual(short.tail, "")
        let three = NSID.splitNsid("sh.tangled.repo")
        XCTAssertEqual(three.tail, "repo")
    }

    func testGroupPrefix() {
        XCTAssertEqual(NSID.groupPrefix("app.bsky.feed.post"), "app.bsky.feed")
        XCTAssertEqual(NSID.groupPrefix("app.bsky"), "app")
        XCTAssertEqual(NSID.groupPrefix("app"), "app")
    }

    func testPublisherForNsid() {
        XCTAssertEqual(NSID.publisherForNsid("net.anisota.harvest.minigame"), "anisota.net")
        XCTAssertEqual(NSID.publisherForNsid("app.bsky.feed.post"), "bsky.app")
        XCTAssertEqual(NSID.publisherForNsid("solo"), "solo")
    }

    func testPaths() {
        XCTAssertEqual(NSID.schemaPathFor("app.bsky.feed.post"), "/explore/bsky.app/com.atproto.lexicon.schema/app.bsky.feed.post")
        XCTAssertEqual(NSID.lexiconPathFor("app.bsky.feed.post"), "/explore/lexicons/app.bsky.feed.post")
        XCTAssertEqual(NSID.groupPathFor("net.anisota"), "/explore/lexicons/group/net.anisota")
        XCTAssertEqual(NSID.groupPathFor("free text?"), "/explore/lexicons/group/free%20text%3F")
    }

    // MARK: formatters

    func testFormatCount() {
        XCTAssertEqual(UFOsFormat.formatCount(0), "0")
        XCTAssertEqual(UFOsFormat.formatCount(999), "999")
        XCTAssertEqual(UFOsFormat.formatCount(1_000), "1.0k")
        XCTAssertEqual(UFOsFormat.formatCount(1_234), "1.2k")
        XCTAssertEqual(UFOsFormat.formatCount(1_250), "1.3k", "JavaScript toFixed rounds an exact tie up")
        XCTAssertEqual(UFOsFormat.formatCount(999_949), "999.9k")
        XCTAssertEqual(UFOsFormat.formatCount(1_500_000), "1.5M")
        XCTAssertEqual(UFOsFormat.formatCount(2_100_000_000), "2.1B")
        XCTAssertEqual(UFOsFormat.formatCount(-5), "-5")
    }

    func testFormatPct() {
        XCTAssertEqual(UFOsFormat.formatPct(0), "+0.0%")
        XCTAssertEqual(UFOsFormat.formatPct(12.34), "+12.3%")
        XCTAssertEqual(UFOsFormat.formatPct(-5.55), "-5.5%")
        XCTAssertEqual(UFOsFormat.formatPct(0.25), "+0.3%")
        XCTAssertEqual(UFOsFormat.formatPct(-0.25), "-0.3%")
        XCTAssertEqual(UFOsFormat.formatPct(99.95), "+100.0%")
        XCTAssertEqual(UFOsFormat.formatPct(100), "+100%")
        XCTAssertEqual(UFOsFormat.formatPct(150.4), "+150%")
        XCTAssertEqual(UFOsFormat.formatPct(-100.5), "-101%")
        XCTAssertEqual(UFOsFormat.formatPct(-0.04), "-0.0%")
        XCTAssertEqual(UFOsFormat.formatPct(-0.0), "+0.0%")
    }

    func testToFixedMatchesJavaScriptOnKnownCases() {
        XCTAssertEqual(UFOsFormat.toFixed(1.005, 2), "1.00", "1.005 is below the tie in binary")
        XCTAssertEqual(UFOsFormat.toFixed(2.5, 0), "3")
        XCTAssertEqual(UFOsFormat.toFixed(0.5, 0), "1")
        XCTAssertEqual(UFOsFormat.toFixed(1.45, 1), "1.4", "1.45 is below the tie in binary")
        XCTAssertEqual(UFOsFormat.toFixed(-1.25, 1), "-1.3")
        XCTAssertEqual(UFOsFormat.toFixed(123.456, 1), "123.5")
    }

    // MARK: live

    func testLiveFetchCollectionsReturnsRows() async throws {
        let page = await UFOsClient().fetchCollections(limit: 5)
        if page.failed {
            let url = makeURL(Endpoints.ufos, path: "/collections", query: [("limit", "5")])
            do {
                _ = try await HTTPClient.shared.get(url)
            } catch let error as HTTPError {
                if error.status == 429 || error.status >= 500 {
                    throw XCTSkip("ufos answered \(error.status)")
                }
                XCTFail("ufos answered \(error.status): \(error.body.prefix(200))")
                return
            } catch {
                throw XCTSkip("network unavailable: \(error)")
            }
            XCTFail("ufos answered 2xx but the payload did not decode")
            return
        }
        XCTAssertFalse(page.collections.isEmpty)
        XCTAssertLessThanOrEqual(page.collections.count, 5)
        for row in page.collections {
            XCTAssertTrue(row.nsid.contains("."), row.nsid)
            XCTAssertGreaterThanOrEqual(row.counts.creates, 0)
        }
    }
}
