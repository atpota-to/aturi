import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport: a route matches when every one of its
/// fragments appears in the URL; the first match wins, the rest 404.
/// Routes can be swapped mid-test to simulate an outage after a success.
private final class LexiconsFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var delayNanoseconds: UInt64 = 0
    }

    private let lock = NSLock()
    private var routes: [(patterns: [String], reply: Reply)]
    private var recorded: [String] = []

    init(_ routes: [([String], Reply)]) {
        self.routes = routes.map { (patterns: $0.0, reply: $0.1) }
    }

    func setRoutes(_ routes: [([String], Reply)]) {
        lock.lock(); defer { lock.unlock() }
        self.routes = routes.map { (patterns: $0.0, reply: $0.1) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        let reply = route(for: url.absoluteString)
        if reply.delayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: reply.delayNanoseconds)
        }
        let response = HTTPURLResponse(
            url: url, statusCode: reply.status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (Data(reply.body.utf8), response)
    }

    private func route(for url: String) -> Reply {
        lock.lock(); defer { lock.unlock() }
        recorded.append(url)
        return routes.first { $0.patterns.allSatisfy(url.contains) }?.reply
            ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
    }

    var urls: [String] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }

    func urls(containing fragment: String) -> [String] {
        urls.filter { $0.contains(fragment) }
    }

    func count(containing fragment: String) -> Int {
        urls(containing: fragment).count
    }
}

@MainActor
final class LexiconsModelTests: XCTestCase {
    /// 2025-01-08T00:00:00Z, so a 7d window starts on 2025-01-01 and the
    /// prior 7d window on 2024-12-25.
    private nonisolated static let now = Date(timeIntervalSince1970: 1_736_294_400)
    private nonisolated static let unavailable = "the UFOs API is unavailable"

    // MARK: Fixtures

    private nonisolated static func counts(_ creates: Int = 0, updates: Int = 0, deletes: Int = 0, dids: Int = 0) -> String {
        #"{"creates":\#(creates),"updates":\#(updates),"deletes":\#(deletes),"dids_estimate":\#(dids)}"#
    }

    private nonisolated static func row(_ nsid: String, _ creates: Int = 0, updates: Int = 0, deletes: Int = 0, dids: Int = 0) -> String {
        #"{"nsid":"\#(nsid)","creates":\#(creates),"updates":\#(updates),"deletes":\#(deletes),"dids_estimate":\#(dids)}"#
    }

    private nonisolated static func collectionsBody(_ rows: [String], cursor: String? = nil) -> String {
        let cursorField = cursor.map { #","cursor":"\#($0)""# } ?? ""
        return #"{"collections":[\#(rows.joined(separator: ","))]\#(cursorField)}"#
    }

    private nonisolated static func statsBody(_ entries: [(String, String)]) -> String {
        "{" + entries.map { #""\#($0.0)":\#($0.1)"# }.joined(separator: ",") + "}"
    }

    /// Every counter of a bucket equals its number, so a series reads the
    /// same whichever metric projects it.
    private nonisolated static func timeseriesBody(_ nsid: String, _ buckets: [Int]) -> String {
        let series = buckets.map { counts($0, updates: $0, deletes: $0, dids: $0) }.joined(separator: ",")
        let range = buckets.indices.map { #""t\#($0)""# }.joined(separator: ",")
        return #"{"range":[\#(range)],"series":{"\#(nsid)":[\#(series)]}}"#
    }

    /// Several collections sharing the same buckets.
    private nonisolated static func multiTimeseriesBody(_ nsids: [String], _ buckets: [Int]) -> String {
        let series = buckets.map { counts($0, updates: $0, deletes: $0, dids: $0) }.joined(separator: ",")
        let entries = nsids.map { #""\#($0)":[\#(series)]"# }.joined(separator: ",")
        return #"{"range":[],"series":{\#(entries)}}"#
    }

    /// The candidate pool the strip fixtures share.
    private nonisolated static let pool = collectionsBody([
        row("app.bsky.feed.post", 5000, updates: 50, deletes: 30, dids: 1000),
        row("chat.bsky.convo.message", 4000, updates: 40, deletes: 20, dids: 900),
        row("social.grain.gallery", 800, updates: 8, deletes: 1, dids: 500),
        row("social.grain.like", 700, updates: 7, dids: 400),
        row("sh.tangled.repo", 300, updates: 30, dids: 300),
        row("net.anisota.harvest.minigame", 60, updates: 2, dids: 50),
        row("com.example.thing", 20, updates: 4, dids: 10),
    ])

    private func rankingRoutes() -> [([String], LexiconsFakeTransport.Reply)] {
        [
            (["/collections/stats", "since=2024-12-25"], .init(status: 200, body: Self.statsBody([
                ("social.grain.gallery", Self.counts(400, updates: 4, dids: 250)),
                ("sh.tangled.repo", Self.counts(600, updates: 60, dids: 400)),
                ("com.example.thing", Self.counts(10, updates: 1, dids: 5)),
            ]))),
            (["/collections/stats", "since=2025-01-01"], .init(status: 200, body: Self.statsBody([
                ("app.bsky.feed.post", Self.counts(5000, updates: 50)),
                ("sh.tangled.repo", Self.counts(300, updates: 30)),
                ("social.grain.gallery", Self.counts(800, updates: 8)),
            ]))),
            (["/timeseries", "collection=social.grain.gallery"], .init(status: 200, body: Self.timeseriesBody("social.grain.gallery", Array(1...16)))),
            (["/timeseries"], .init(status: 200, body: Self.multiTimeseriesBody(["app.bsky.feed.post", "sh.tangled.repo", "net.anisota.harvest.minigame", "com.example.thing"], [1, 2, 3]))),
            (["/collections?"], .init(status: 200, body: Self.pool)),
        ]
    }

    private func makeModel(_ transport: LexiconsFakeTransport) -> LexiconsModel {
        LexiconsModel(http: HTTPClient(transport: transport), searchDebounce: 0, clock: { LexiconsModelTests.now })
    }

    private func waitUntil(_ condition: @escaping @MainActor () -> Bool, timeout: TimeInterval = 2) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
        return condition()
    }

    // MARK: Pure helpers

    func testHiddenPrefixesAndDedupFollowTheMode() async {
        XCTAssertTrue(LexiconsModel.hasHiddenPrefix("app.bsky.feed.post", LexiconsModel.trendingHiddenPrefixes))
        XCTAssertTrue(LexiconsModel.hasHiddenPrefix("chat.bsky.convo.message", LexiconsModel.trendingHiddenPrefixes))
        XCTAssertFalse(LexiconsModel.hasHiddenPrefix("app.bskyx.thing", LexiconsModel.trendingHiddenPrefixes), "the dot is part of the prefix")
        XCTAssertFalse(LexiconsModel.hasHiddenPrefix("app.bsky.feed.post", LexiconsModel.topHiddenPrefixes))
        XCTAssertTrue(LexiconsModel.hasHiddenPrefix("chat.bsky.convo.message", LexiconsModel.topHiddenPrefixes))

        let rows = [
            NsidCount(nsid: "app.bsky.feed.post", counts: .zero),
            NsidCount(nsid: "chat.bsky.convo.message", counts: .zero),
            NsidCount(nsid: "social.grain.gallery", counts: .zero),
            NsidCount(nsid: "social.grain.like", counts: .zero),
            NsidCount(nsid: "app.bsky.feed.like", counts: .zero),
            NsidCount(nsid: "sh.tangled.repo", counts: .zero),
            NsidCount(nsid: "single", counts: .zero),
            NsidCount(nsid: "two.segments", counts: .zero),
            NsidCount(nsid: "two.segments.deeper", counts: .zero),
        ]
        XCTAssertEqual(
            LexiconsModel.filterAndDedup(rows, mode: .trending).map(\.nsid),
            ["social.grain.gallery", "sh.tangled.repo", "single", "two.segments"]
        )
        XCTAssertEqual(
            LexiconsModel.filterAndDedup(rows, mode: .top).map(\.nsid),
            ["app.bsky.feed.post", "social.grain.gallery", "sh.tangled.repo", "single", "two.segments"]
        )
        XCTAssertEqual(
            LexiconsModel.dedupeByNamespace(rows).map(\.nsid),
            ["app.bsky.feed.post", "chat.bsky.convo.message", "social.grain.gallery", "sh.tangled.repo", "single", "two.segments"]
        )
        XCTAssertEqual(LexiconsModel.filterAndDedup([], mode: .top), [])
    }

    func testRankingRowDerivedValues() async {
        let row = LexiconRankingRow(nsid: "app.bsky.feed.post", value: 1234, series: [1, 2], deltaPct: 12.345)
        XCTAssertEqual(row.id, "app.bsky.feed.post")
        XCTAssertEqual(row.namespaceHead, "app.bsky")
        XCTAssertEqual(row.namespaceTail, "feed.post")
        XCTAssertEqual(row.schemaPath, "/explore/bsky.app/com.atproto.lexicon.schema/app.bsky.feed.post")
        XCTAssertEqual(row.lexiconPath, "/explore/lexicons/app.bsky.feed.post")
        XCTAssertEqual(row.valueLabel, "1.2k")
        XCTAssertEqual(row.deltaLabel, "+12.3%")

        let top = LexiconRankingRow(nsid: "sh.tangled", value: 12, series: [])
        XCTAssertEqual(top.namespaceHead, "sh.tangled")
        XCTAssertEqual(top.namespaceTail, "")
        XCTAssertNil(top.deltaLabel)
        XCTAssertEqual(top.valueLabel, "12")

        XCTAssertEqual(LexiconRankingMode.trending.title, "Trending lexicons")
        XCTAssertEqual(LexiconRankingMode.top.title, "Top lexicons")
        XCTAssertEqual(LexiconRankingMode.allCases.map(\.label), ["Trending", "Top"])
        XCTAssertEqual(LexiconBrowseView.allCases.map(\.label), ["Top", "All"])
    }

    // MARK: Ranking strip

    func testTrendingRankingFiltersDedupesComputesDeltasAndSortsNullsLast() async {
        let transport = LexiconsFakeTransport(rankingRoutes())
        let model = makeModel(transport)
        XCTAssertTrue(model.ranking.isIdle)
        XCTAssertNil(model.visibleRanking)
        XCTAssertEqual(model.rankingTitle, "Trending lexicons")
        XCTAssertEqual(model.rankingSeriesLabel, "Activity over the last 7d")

        await model.load().value

        let rows = model.ranking.value ?? []
        XCTAssertEqual(rows.map(\.nsid), ["social.grain.gallery", "com.example.thing", "sh.tangled.repo", "net.anisota.harvest.minigame"])
        XCTAssertEqual(rows.map(\.value), [500, 10, 300, 50])
        XCTAssertEqual(rows.map(\.deltaPct), [100, 100, -25, nil])
        XCTAssertEqual(rows.map(\.deltaLabel), ["+100%", "+100%", "-25.0%", nil])
        XCTAssertEqual(rows[0].series, Array(3...16), "trimmed to the 7d bucket count")
        XCTAssertEqual(rows[1].series, [1, 2, 3])
        XCTAssertEqual(model.visibleRanking?.count, 4)
        XCTAssertFalse(model.isRankingEmpty)
        XCTAssertFalse(model.showsRankingToggle, "four rows: nothing more to reveal")
        XCTAssertFalse(model.isRankingRefreshing)
        XCTAssertNil(model.rankingErrorMessage)

        let poolURL = transport.urls(containing: "limit=50").first ?? ""
        XCTAssertTrue(poolURL.hasSuffix("/collections?order=dids-estimate&limit=50&since=2025-01-01T00%3A00%3A00.000Z"), poolURL)
        let stats = transport.urls(containing: "/collections/stats")
        XCTAssertEqual(stats.count, 1, "dids come straight from /collections; only the prior window needs a lookup")
        XCTAssertTrue(stats[0].contains("since=2024-12-25T00%3A00%3A00.000Z&until=2025-01-01T00%3A00%3A00.000Z"), stats[0])
        XCTAssertTrue(stats[0].contains("collection=social.grain.gallery"))
        XCTAssertFalse(stats[0].contains("collection=app.bsky.feed.post"), "hidden rows are not scored")
        XCTAssertFalse(stats[0].contains("collection=social.grain.like"), "deduped rows are not scored")
        XCTAssertEqual(transport.count(containing: "/timeseries"), 4)
        XCTAssertTrue(transport.urls(containing: "/timeseries")[0].contains("step=43200&since=2025-01-01T00%3A00%3A00.000Z"))
    }

    func testTopRankingKeepsBlueskyHidesChatAndSortsByTheMetric() async {
        let transport = LexiconsFakeTransport(rankingRoutes())
        let model = makeModel(transport)
        model.mode = .top
        model.metric = .creates
        model.window = .oneDay
        XCTAssertEqual(transport.urls.count, 0, "toggles before load() do not fetch")

        await model.load().value

        let rows = model.ranking.value ?? []
        XCTAssertEqual(rows.map(\.nsid), ["app.bsky.feed.post", "social.grain.gallery", "sh.tangled.repo", "net.anisota.harvest.minigame", "com.example.thing"])
        XCTAssertEqual(rows.map(\.value), [5000, 800, 300, 60, 20])
        XCTAssertEqual(rows.map(\.deltaPct), [nil, nil, nil, nil, nil])
        XCTAssertEqual(rows[1].series, Array(5...16), "trimmed to the 1d bucket count")
        XCTAssertEqual(model.rankingTitle, "Top lexicons")
        XCTAssertEqual(model.rankingSeriesLabel, "Activity over the last 1d")

        let poolURL = transport.urls(containing: "limit=50").first ?? ""
        XCTAssertTrue(poolURL.contains("order=records-created&limit=50&since=2025-01-07T00%3A00%3A00.000Z"), poolURL)
        XCTAssertEqual(transport.count(containing: "/collections/stats"), 0)
        XCTAssertTrue(transport.urls(containing: "/timeseries")[0].contains("step=7200"))
    }

    func testTopRankingWithUpdatesMetricScoresThroughStats() async {
        let transport = LexiconsFakeTransport(rankingRoutes())
        let model = makeModel(transport)
        model.mode = .top
        model.metric = .updates
        await model.load().value

        let rows = model.ranking.value ?? []
        XCTAssertEqual(rows.map(\.nsid), ["app.bsky.feed.post", "sh.tangled.repo", "social.grain.gallery", "net.anisota.harvest.minigame", "com.example.thing"])
        XCTAssertEqual(rows.map(\.value), [50, 30, 8, 0, 0], "rows the stats call did not cover score zero and keep the pool order")

        let poolURL = transport.urls(containing: "limit=50").first ?? ""
        XCTAssertTrue(poolURL.contains("order=records-created"), "updates cannot be sorted server side")
        let stats = transport.urls(containing: "/collections/stats")
        XCTAssertEqual(stats.count, 1)
        XCTAssertTrue(stats[0].contains("since=2025-01-01T00%3A00%3A00.000Z&until=2025-01-08T00%3A00%3A00.000Z"), stats[0])
    }

    func testTrendingWithDeletesMetricLooksUpBothWindows() async {
        let transport = LexiconsFakeTransport(rankingRoutes())
        let model = makeModel(transport)
        model.metric = .deletes
        await model.load().value
        let rows = model.ranking.value ?? []
        // Current deletes: gallery 0 (stats row omits it), tangled 0; prior:
        // gallery 0, tangled 0: every delta is nil, so the pool order holds.
        XCTAssertEqual(rows.map(\.nsid), ["social.grain.gallery", "sh.tangled.repo", "net.anisota.harvest.minigame", "com.example.thing"])
        XCTAssertEqual(rows.map(\.deltaPct), [nil, nil, nil, nil])
        XCTAssertEqual(transport.count(containing: "/collections/stats"), 2)
    }

    func testRankingFailureSurfacesAnErrorNotAnEmptyLeaderboard() async {
        let transport = LexiconsFakeTransport([(["/collections?"], .init(status: 502, body: "bad gateway"))])
        let model = makeModel(transport)
        await model.load().value
        XCTAssertEqual(model.ranking.errorMessage, Self.unavailable)
        XCTAssertEqual(model.rankingErrorMessage, "Couldn't reach the UFOs API: the UFOs API is unavailable")
        XCTAssertNil(model.visibleRanking)
        XCTAssertFalse(model.isRankingEmpty)
        XCTAssertFalse(model.showsRankingToggle)
        XCTAssertEqual(transport.count(containing: "/timeseries"), 0)

        // A retry after a failure shows the skeleton, not stale rows.
        transport.setRoutes(rankingRoutes())
        let retry = model.reloadRanking()
        XCTAssertTrue(model.ranking.isLoading)
        await retry.value
        XCTAssertEqual(model.ranking.value?.count, 4)
    }

    func testRankingEmptyAfterFilteringIsLoadedEmpty() async {
        let transport = LexiconsFakeTransport([
            (["/collections?"], .init(status: 200, body: Self.collectionsBody([Self.row("app.bsky.feed.post", 5), Self.row("chat.bsky.convo.message", 4)]))),
        ])
        let model = makeModel(transport)
        await model.load().value
        XCTAssertEqual(model.ranking.value, [])
        XCTAssertTrue(model.isRankingEmpty)
        XCTAssertFalse(model.showsRankingToggle)
        XCTAssertNil(model.rankingErrorMessage)
        XCTAssertEqual(LexiconsModel.rankingEmptyMessage, "No lexicons matched in this window.")
        XCTAssertEqual(transport.count(containing: "/collections/stats"), 0, "nothing left to score")
    }

    func testExpandRefetchesWithALargerPoolAndCollapseSlicesImmediately() async {
        let wide = Self.collectionsBody((0..<25).map { Self.row("ns\($0).x.y", 100 - $0, dids: 100 - $0) })
        let transport = LexiconsFakeTransport([
            (["/timeseries"], .init(status: 200, body: #"{"range":[],"series":{}}"#)),
            (["/collections?", "limit=100"], .init(status: 200, body: wide, delayNanoseconds: 30_000_000)),
            (["/collections?"], .init(status: 200, body: wide)),
        ])
        let model = makeModel(transport)
        model.mode = .top
        await model.load().value
        XCTAssertEqual(model.ranking.value?.count, 10)
        XCTAssertEqual(model.visibleRanking?.count, 10)
        XCTAssertTrue(model.showsRankingToggle, "a full collapsed list can expand")
        XCTAssertEqual(model.rankingToggleLabel, "Show top 20")
        XCTAssertEqual(model.rankingLimit, 10)
        XCTAssertEqual(model.visibleRanking?.first?.series, [], "a missing series reads as empty")

        model.expanded = true
        XCTAssertEqual(model.rankingLimit, 20)
        XCTAssertTrue(model.isRankingRefreshing)
        XCTAssertEqual(model.visibleRanking?.count, 10, "the old rows stay while the wider pool loads")
        await model.awaitPending()
        XCTAssertFalse(model.isRankingRefreshing)
        XCTAssertEqual(model.ranking.value?.count, 20)
        XCTAssertEqual(model.visibleRanking?.count, 20)
        XCTAssertEqual(model.rankingToggleLabel, "Show top 10")
        XCTAssertTrue(model.showsRankingToggle)
        XCTAssertEqual(transport.count(containing: "limit=100"), 1)

        model.expanded = false
        XCTAssertEqual(model.visibleRanking?.count, 10, "collapsing takes effect before the refetch lands")
        XCTAssertTrue(model.showsRankingToggle)
        await model.awaitPending()
        XCTAssertEqual(model.visibleRanking?.count, 10)
        XCTAssertEqual(transport.count(containing: "limit=50"), 2)
    }

    func testModeChangeKeepsTheOldTableWhileRefreshing() async {
        let transport = LexiconsFakeTransport(rankingRoutes())
        let model = makeModel(transport)
        await model.load().value
        XCTAssertEqual(model.ranking.value?.count, 4)

        model.mode = .top
        XCTAssertTrue(model.isRankingRefreshing)
        XCTAssertEqual(model.ranking.value?.count, 4)
        XCTAssertEqual(model.rankingTitle, "Top lexicons")
        await model.awaitPending()
        XCTAssertFalse(model.isRankingRefreshing)
        XCTAssertEqual(model.ranking.value?.count, 5)

        model.mode = .top
        await model.awaitPending()
        XCTAssertEqual(transport.count(containing: "limit=50"), 2, "setting the same value again does not refetch")

        model.window = .thirtyDays
        await model.awaitPending()
        XCTAssertTrue(transport.urls(containing: "limit=50").last!.contains("since=2024-12-09T00%3A00%3A00.000Z"))
        XCTAssertTrue(transport.urls(containing: "/timeseries").last!.contains("step=86400"))
    }

    func testStaticFetchRankingReturnsNilOnFailure() async {
        let transport = LexiconsFakeTransport([])
        let client = UFOsClient(http: HTTPClient(transport: transport))
        let rows = await LexiconsModel.fetchRanking(window: .sevenDays, mode: .trending, metric: .dids, resultCount: 10, client: client, now: Self.now)
        XCTAssertNil(rows)
    }

    // MARK: Search box

    private func searchRoutes() -> [([String], LexiconsFakeTransport.Reply)] {
        let matches = (1...15).map { Self.row("social.grain.m\($0)", $0) } + [Self.row("social.grain.gallery", 0)]
        return [
            (["/search", "q=grain"], .init(status: 200, body: #"{"matches":[\#(matches.joined(separator: ","))]}"#)),
            (["/search"], .init(status: 200, body: #"{"matches":[\#(Self.row("a.b.c", 3)),\#(Self.row("a.b.d", 5)),\#(Self.row("a.b.e", 4))]}"#)),
        ]
    }

    func testSearchDebouncesRanksByCreatesAndCapsSuggestions() async {
        let transport = LexiconsFakeTransport(searchRoutes())
        let model = makeModel(transport)
        XCTAssertFalse(model.isSearchOpen)

        model.searchQuery = " grain "
        XCTAssertTrue(model.isSearchOpen, "typing opens the suggestion area")
        XCTAssertTrue(model.isSearchPending)
        await model.awaitPendingSearch()
        XCTAssertFalse(model.isSearchPending)
        XCTAssertEqual(model.suggestions.count, LexiconsModel.suggestionLimit)
        XCTAssertEqual(model.suggestions.first?.nsid, "social.grain.m15")
        XCTAssertEqual(model.suggestions.last?.nsid, "social.grain.m4")
        XCTAssertEqual(model.highlightIndex, -1)
        XCTAssertTrue(model.showsSuggestionList)
        XCTAssertTrue(model.showsSearchDropdown)
        XCTAssertFalse(model.showsNamespaceRow, "no dot in the query")
        XCTAssertTrue(transport.urls.last!.hasSuffix("/search?q=grain"), "trimmed before it is sent")

        model.searchQuery = "g"
        XCTAssertEqual(model.suggestions, [], "under two searchable characters clears the list without a request")
        XCTAssertFalse(model.isSearchPending)
        XCTAssertFalse(model.showsSearchDropdown)
        XCTAssertEqual(transport.count(containing: "/search"), 1)
    }

    func testSubmitPrefersTheHighlightThenAnExactMatchThenTheGroupPage() async {
        let transport = LexiconsFakeTransport(searchRoutes())
        let model = makeModel(transport)
        XCTAssertNil(model.submitSearch(), "nothing to search")

        model.searchQuery = "a.b"
        await model.awaitPendingSearch()
        XCTAssertEqual(model.suggestions.map(\.nsid), ["a.b.d", "a.b.e", "a.b.c"])
        model.highlightNext()
        XCTAssertEqual(model.highlightedSuggestion?.nsid, "a.b.d")
        XCTAssertEqual(model.submitSearch(), .lexicon(nsid: "a.b.d"))
        XCTAssertFalse(model.isSearchOpen)

        model.searchQuery = "a.b.c"
        await model.awaitPendingSearch()
        XCTAssertTrue(model.isSearchOpen)
        XCTAssertEqual(model.submitSearch(), .lexicon(nsid: "a.b.c"), "an exact match opens the detail page")
        XCTAssertFalse(model.isSearchOpen)

        model.searchQuery = "a.b.zzz"
        await model.awaitPendingSearch()
        XCTAssertEqual(model.submitSearch(), .lexiconGroup(prefix: "a.b.zzz"), "anything else routes to the group page")

        model.searchQuery = "smokesignal"
        await model.awaitPendingSearch()
        XCTAssertEqual(model.submitSearch(), .lexiconGroup(prefix: "smokesignal"))

        model.searchQuery = "-"
        XCTAssertNil(model.submitSearch(), "one searchable character is too short")
    }

    func testHighlightWrapsAndOnlyMovesWhileTheListShows() async {
        let transport = LexiconsFakeTransport(searchRoutes())
        let model = makeModel(transport)
        model.highlightNext()
        XCTAssertEqual(model.highlightIndex, -1, "no suggestions yet")

        model.searchQuery = "a.b"
        await model.awaitPendingSearch()
        model.highlightNext()
        model.highlightNext()
        model.highlightNext()
        XCTAssertEqual(model.highlightIndex, 2)
        model.highlightNext()
        XCTAssertEqual(model.highlightIndex, 0, "wraps to the top")
        model.highlightPrevious()
        XCTAssertEqual(model.highlightIndex, 2, "wraps to the bottom")
        model.highlightPrevious()
        XCTAssertEqual(model.highlightIndex, 1)
        model.setHighlight(0)
        XCTAssertEqual(model.highlightedSuggestion?.nsid, "a.b.d")

        model.dismissSearch()
        XCTAssertFalse(model.isSearchOpen)
        XCTAssertFalse(model.showsSuggestionList)
        model.highlightNext()
        XCTAssertEqual(model.highlightIndex, 0, "closed: the keys do nothing")
        XCTAssertEqual(model.pickSuggestion("a.b.e"), .lexicon(nsid: "a.b.e"))
    }

    func testNamespaceRowOffersTheGroupPageForDottedQueries() async {
        let transport = LexiconsFakeTransport([(["/search"], .init(status: 200, body: #"{"matches":[]}"#))])
        let model = makeModel(transport)
        XCTAssertNil(model.browseNamespace())

        model.searchQuery = "net.anisota"
        XCTAssertTrue(model.showsNamespaceRow)
        XCTAssertEqual(model.namespaceRowTerm, "net.anisota")
        XCTAssertTrue(model.showsSearchDropdown, "the row alone opens the dropdown")
        XCTAssertFalse(model.showsSuggestionList)
        XCTAssertEqual(model.browseNamespace(), .lexiconGroup(prefix: "net.anisota"))
        XCTAssertFalse(model.isSearchOpen)
        XCTAssertFalse(model.showsSearchDropdown)

        model.searchQuery = "."
        XCTAssertFalse(model.showsNamespaceRow, "a lone dot is not searchable")
        model.searchQuery = "grain"
        XCTAssertFalse(model.showsNamespaceRow)
        await model.awaitPendingSearch()
        XCTAssertNil(model.browseNamespace())
    }

    func testSearchFailureReadsAsNoSuggestions() async {
        let transport = LexiconsFakeTransport([(["/search"], .init(status: 500, body: "down"))])
        let model = makeModel(transport)
        model.searchQuery = "grain"
        await model.awaitPendingSearch()
        XCTAssertEqual(model.suggestions, [])
        XCTAssertFalse(model.isSearchPending)
        XCTAssertEqual(model.submitSearch(), .lexiconGroup(prefix: "grain"))
    }

    // MARK: Browse all

    private nonisolated static let browsePool = collectionsBody((0..<60).map { i in
        i < 55 ? row("app.bsky.c\(i)", 1000 - i, dids: 500 - i) : row("ns\(i).x.y", 10 - (i - 55), dids: 5 - (i - 55))
    })

    private func browseRoutes() -> [([String], LexiconsFakeTransport.Reply)] {
        [
            (["/collections?", "order=dids-estimate", "limit=200"], .init(status: 200, body: Self.browsePool)),
            (["/collections?", "order=records-created", "limit=200"], .init(status: 200, body: Self.collectionsBody([Self.row("sh.tangled.repo", 9, dids: 1), Self.row("app.bsky.feed.post", 8, dids: 2)]))),
            (["/collections?cursor=c1&limit=100"], .init(status: 200, body: Self.collectionsBody((100..<103).map { Self.row("page2.n\($0).x", $0) }))),
            (["/collections?limit=100"], .init(status: 200, body: Self.collectionsBody((0..<100).map { Self.row("all.n\($0).x", $0) }, cursor: "c1"))),
            (["/collections?"], .init(status: 200, body: Self.pool)),
        ]
    }

    func testBrowseTopFetchesADeepPoolAndShowsOnePerGroupOrTheTopFifty() async {
        let transport = LexiconsFakeTransport(browseRoutes())
        let model = makeModel(transport)
        XCTAssertNil(model.displayedBrowse)
        XCTAssertFalse(model.isBrowseEmpty)
        XCTAssertEqual(model.browseOrderLabel, "Rank by")
        await model.load().value

        XCTAssertEqual(model.browse.value?.count, 60)
        XCTAssertNil(model.browseCursor, "Top never paginates")
        XCTAssertFalse(model.canLoadMoreBrowse)
        XCTAssertNil(model.loadMoreBrowse())
        XCTAssertEqual(model.displayedBrowse?.map(\.nsid), ["app.bsky.c0", "ns55.x.y", "ns56.x.y", "ns57.x.y", "ns58.x.y", "ns59.x.y"])
        XCTAssertEqual(model.browseMetricLabel, "Repos")
        XCTAssertEqual(model.browseStat(model.displayedBrowse![0]), 500)

        model.onePerGroup = false
        XCTAssertEqual(model.displayedBrowse?.count, 50)
        XCTAssertEqual(model.displayedBrowse?.last?.nsid, "app.bsky.c49")
        XCTAssertEqual(transport.count(containing: "/collections?"), 2, "the pool and the strip; the dedupe toggle is display only")
        XCTAssertTrue(transport.urls(containing: "limit=200")[0].hasSuffix("/collections?order=dids-estimate&limit=200"))
    }

    func testBrowseOrderRefetchesInTopAndOnlyPicksTheColumnInAll() async {
        let transport = LexiconsFakeTransport(browseRoutes())
        let model = makeModel(transport)
        await model.load().value
        let before = transport.count(containing: "limit=200")

        model.browseOrder = .recordsCreated
        XCTAssertTrue(model.isBrowseRefreshing)
        XCTAssertEqual(model.browse.value?.count, 60, "the old pool stays while the re-sort loads")
        XCTAssertEqual(model.browseMetricLabel, "Creates")
        await model.awaitPending()
        XCTAssertFalse(model.isBrowseRefreshing)
        XCTAssertEqual(model.browse.value?.map(\.nsid), ["sh.tangled.repo", "app.bsky.feed.post"])
        XCTAssertEqual(model.browseStat(model.browse.value![0]), 9)
        XCTAssertEqual(transport.count(containing: "limit=200"), before + 1)

        model.browseView = .all
        XCTAssertEqual(model.browseOrderLabel, "Show metric")
        await model.awaitPending()
        XCTAssertEqual(model.browse.value?.count, 100)
        let allFetches = transport.count(containing: "/collections?limit=100")
        model.browseOrder = .didsEstimate
        await model.awaitPending()
        XCTAssertEqual(transport.count(containing: "/collections?limit=100"), allFetches, "All keeps its pages on a metric toggle")
        XCTAssertEqual(model.browseMetricLabel, "Repos")
        XCTAssertEqual(model.browse.value?.count, 100)
    }

    func testBrowseAllPaginatesWithLoadMore() async {
        let transport = LexiconsFakeTransport(browseRoutes())
        let model = makeModel(transport)
        model.browseView = .all
        model.onePerGroup = false
        await model.load().value

        XCTAssertEqual(model.browse.value?.count, 100)
        XCTAssertEqual(model.browseCursor, "c1")
        XCTAssertTrue(model.canLoadMoreBrowse)
        XCTAssertEqual(model.displayedBrowse?.count, 100, "All shows every page, not the top fifty")
        XCTAssertTrue(transport.urls(containing: "limit=100")[0].hasSuffix("/collections?limit=100"))

        let more = model.loadMoreBrowse()
        XCTAssertNotNil(more)
        XCTAssertTrue(model.isLoadingMore)
        XCTAssertNil(model.loadMoreBrowse(), "one page at a time")
        await more?.value
        XCTAssertFalse(model.isLoadingMore)
        XCTAssertEqual(model.browse.value?.count, 103)
        XCTAssertEqual(model.browse.value?.last?.nsid, "page2.n102.x")
        XCTAssertNil(model.browseCursor)
        XCTAssertFalse(model.canLoadMoreBrowse)
        XCTAssertNil(model.loadMoreBrowse())

        model.onePerGroup = true
        XCTAssertEqual(model.displayedBrowse?.count, 103, "every row is its own namespace here")
        model.browseView = .top
        XCTAssertFalse(model.canLoadMoreBrowse, "Top has no pages")
        await model.awaitPending()
        XCTAssertNil(model.browseCursor)
    }

    func testBrowseFailureShowsTheErrorOnlyWhenThereIsNothingToShow() async {
        let transport = LexiconsFakeTransport([(["/collections?"], .init(status: 503, body: "down"))])
        let model = makeModel(transport)
        await model.load().value
        XCTAssertEqual(model.browse.errorMessage, Self.unavailable)
        XCTAssertEqual(model.browseErrorMessage, "Couldn't reach the UFOs API: the UFOs API is unavailable")
        XCTAssertNil(model.displayedBrowse)
        XCTAssertFalse(model.isBrowseEmpty)

        transport.setRoutes(browseRoutes())
        await model.reloadBrowse().value
        XCTAssertEqual(model.browse.value?.count, 60)
        XCTAssertNil(model.browseErrorMessage)

        transport.setRoutes([(["/collections?"], .init(status: 503, body: "down"))])
        model.browseOrder = .recordsCreated
        await model.awaitPending()
        XCTAssertEqual(model.browse.value?.count, 60, "a failed refetch keeps what was on screen")
        XCTAssertNil(model.browseErrorMessage)
        XCTAssertFalse(model.isBrowseRefreshing)
    }

    func testBrowseLoadMoreFailureKeepsTheCursorForARetry() async {
        var routes = browseRoutes()
        routes.insert((["/collections?cursor=c1"], .init(status: 500, body: "boom")), at: 0)
        let transport = LexiconsFakeTransport(routes)
        let model = makeModel(transport)
        model.browseView = .all
        await model.load().value
        await model.loadMoreBrowse()?.value
        XCTAssertEqual(model.loadMoreError, Self.unavailable)
        XCTAssertEqual(model.browseCursor, "c1")
        XCTAssertEqual(model.browse.value?.count, 100)
        XCTAssertTrue(model.canLoadMoreBrowse)

        transport.setRoutes(browseRoutes())
        await model.loadMoreBrowse()?.value
        XCTAssertNil(model.loadMoreError)
        XCTAssertEqual(model.browse.value?.count, 103)
    }

    func testBrowseEmptyCatalogIsLoadedEmpty() async {
        let transport = LexiconsFakeTransport([(["/collections?"], .init(status: 200, body: #"{"collections":[]}"#))])
        let model = makeModel(transport)
        await model.load().value
        XCTAssertEqual(model.displayedBrowse, [])
        XCTAssertTrue(model.isBrowseEmpty)
        XCTAssertNil(model.browseErrorMessage)
        XCTAssertEqual(LexiconsModel.browseEmptyMessage, "No lexicons found.")
    }

    // MARK: Freshness

    func testFreshnessLabelBucketsTheLag() async {
        func label(_ secondsAgo: Double) -> String {
            LexiconsModel.freshnessLabel(cursorUs: (Self.now.timeIntervalSince1970 - secondsAgo) * 1_000_000, now: Self.now)
        }
        XCTAssertEqual(label(12), "Firehose data current as of 12s ago")
        XCTAssertEqual(label(89), "Firehose data current as of 89s ago")
        XCTAssertEqual(label(90), "Firehose data current as of 2m ago")
        XCTAssertEqual(label(5399), "Firehose data current as of 90m ago")
        XCTAssertEqual(label(5400), "Firehose data current as of 2h ago")
        XCTAssertEqual(label(7200), "Firehose data current as of 2h ago")
        XCTAssertEqual(label(-30), "Firehose data current as of 0s ago", "a cursor ahead of the clock clamps to zero")
        XCTAssertEqual(label(0.4), "Firehose data current as of 0s ago")
        XCTAssertEqual(label(0.5), "Firehose data current as of 1s ago")
    }

    func testLoadFreshnessReadsTheJetstreamCursor() async {
        let cursor = Int((Self.now.timeIntervalSince1970 - 42) * 1_000_000)
        let transport = LexiconsFakeTransport([
            (["/meta"], .init(status: 200, body: #"{"consumer":{"jetstream":{"latest_cursor":\#(cursor)}},"storage":{},"storage_name":"x"}"#)),
        ])
        let model = makeModel(transport)
        XCTAssertNil(model.freshnessLabel)
        await model.loadFreshness().value
        XCTAssertEqual(model.freshnessLabel, "Firehose data current as of 42s ago")

        let missing = makeModel(LexiconsFakeTransport([
            (["/meta"], .init(status: 200, body: #"{"consumer":{"jetstream":{"latest_cursor":"soon"}},"storage_name":"x"}"#)),
        ]))
        await missing.loadFreshness().value
        XCTAssertNil(missing.freshnessLabel, "a non-numeric cursor is ignored")

        let down = makeModel(LexiconsFakeTransport([(["/meta"], .init(status: 500, body: ""))]))
        await down.loadFreshness().value
        XCTAssertNil(down.freshnessLabel)
    }

    // MARK: Cancellation

    func testLoadSupersedesAnInFlightLoadAndCancelKeepsLoading() async {
        var routes = rankingRoutes()
        routes.insert((["/collections?"], .init(status: 200, body: Self.pool, delayNanoseconds: 40_000_000)), at: 0)
        let transport = LexiconsFakeTransport(routes)
        let model = makeModel(transport)
        let first = model.load()
        let second = model.load()
        await first.value
        await second.value
        XCTAssertEqual(model.ranking.value?.count, 4)
        XCTAssertEqual(model.browse.value?.count, 7)

        let again = makeModel(transport)
        let task = again.load()
        again.cancel()
        await task.value
        XCTAssertTrue(again.ranking.isLoading)
        XCTAssertTrue(again.browse.isLoading)
        XCTAssertNil(again.freshnessLabel)
    }

    // MARK: Group page

    private nonisolated static let anisotaChildren = #"""
    {"children":[
      {"type":"collection","nsid":"net.anisota.harvest.minigame","creates":40,"updates":1,"deletes":0,"dids_estimate":9},
      {"type":"prefix","prefix":"net.anisota.beta","creates":100,"updates":0,"deletes":0,"dids_estimate":3},
      {"type":"collection","nsid":"net.anisota.thing","creates":5,"updates":0,"deletes":0,"dids_estimate":2}
    ],"cursor":"c1","total":{"creates":145,"updates":1,"deletes":0,"dids_estimate":12}}
    """#

    private func groupRoutes() -> [([String], LexiconsFakeTransport.Reply)] {
        [
            (["/prefix", "prefix=net.anisota", "cursor=c1"], .init(status: 200, body: #"{"children":[{"type":"collection","nsid":"net.anisota.zeta","creates":70,"dids_estimate":4}],"cursor":null,"total":{"creates":215}}"#)),
            (["/prefix", "prefix=net.anisota"], .init(status: 200, body: Self.anisotaChildren)),
            (["/prefix", "prefix=empty.ns"], .init(status: 200, body: #"{"children":[],"cursor":null,"total":{"creates":0,"updates":0,"deletes":0,"dids_estimate":0}}"#)),
            (["/search", "q=grain"], .init(status: 200, body: #"{"matches":[\#(Self.row("social.grain.like", 40)),\#(Self.row("social.grain.gallery", 100))]}"#)),
            (["/search"], .init(status: 200, body: #"{"matches":[]}"#)),
        ]
    }

    private func makeGroup(_ prefix: String, _ transport: LexiconsFakeTransport) -> LexiconGroupModel {
        LexiconGroupModel(prefix: prefix, http: HTTPClient(transport: transport))
    }

    func testGroupEntryDerivedValues() async {
        let namespace = LexiconGroupEntry(child: .prefix(prefix: "net.anisota.beta", counts: JustCount(creates: 1500)))
        XCTAssertTrue(namespace.isNamespace)
        XCTAssertEqual(namespace.id, "prefix:net.anisota.beta")
        XCTAssertEqual(namespace.displayName, "net.anisota.beta.*")
        XCTAssertEqual(namespace.path, "/explore/lexicons/group/net.anisota.beta")
        XCTAssertEqual(namespace.destination, .lexiconGroup(prefix: "net.anisota.beta"))
        XCTAssertEqual(namespace.countLabel, "1.5k")

        let collection = LexiconGroupEntry(match: NsidCount(nsid: "social.grain.like", counts: JustCount(creates: 40)))
        XCTAssertFalse(collection.isNamespace)
        XCTAssertEqual(collection.id, "collection:social.grain.like")
        XCTAssertEqual(collection.displayName, "social.grain.like")
        XCTAssertEqual(collection.path, "/explore/lexicons/social.grain.like")
        XCTAssertEqual(collection.destination, .lexicon(nsid: "social.grain.like"))
        XCTAssertEqual(collection.countLabel, "40")
    }

    func testPrefixViewSortsFiltersAndSummarises() async {
        let transport = LexiconsFakeTransport(groupRoutes())
        let model = makeGroup("net.anisota", transport)
        XCTAssertTrue(model.isPrefixView)
        XCTAssertEqual(model.eyebrow, "Namespace")
        XCTAssertEqual(model.breadcrumbs.map(\.segment), ["net", "anisota"])
        XCTAssertEqual(model.breadcrumbs.map(\.cumulative), ["net", "net.anisota"])
        XCTAssertEqual(model.breadcrumbs.map(\.isLast), [false, true])
        XCTAssertEqual(model.breadcrumbs[0].path, "/explore/lexicons/group/net")
        XCTAssertEqual(model.breadcrumbs[0].destination, .lexiconGroup(prefix: "net"))
        XCTAssertEqual(model.filterPlaceholder, "Filter this namespace…")
        XCTAssertEqual(model.filterLabel, "Filter entries under net.anisota")
        XCTAssertNil(model.statusLabel)
        XCTAssertNil(model.summaryLine)
        XCTAssertNil(model.visibleEntries)

        model.filter = "stale"
        await model.load().value
        XCTAssertEqual(model.filter, "", "load clears the filter")
        XCTAssertEqual(model.entries.value?.map(\.name), ["net.anisota.beta", "net.anisota.harvest.minigame", "net.anisota.thing"])
        XCTAssertEqual(model.entries.value?.map(\.isNamespace), [true, false, false])
        XCTAssertEqual(model.total, JustCount(creates: 145, updates: 1, deletes: 0, didsEstimate: 12))
        XCTAssertEqual(model.cursor, "c1")
        XCTAssertEqual(model.summaryLine, "145 creates · 12 repos · 3 entries")
        XCTAssertEqual(model.statusLabel, "3")
        XCTAssertTrue(model.canLoadMore)
        XCTAssertNil(model.emptyMessage)
        XCTAssertNil(model.noMatchMessage)
        XCTAssertNil(model.errorMessage)
        XCTAssertTrue(transport.urls[0].hasSuffix("/prefix?prefix=net.anisota&limit=200"), transport.urls[0])

        model.filter = " HARVEST "
        XCTAssertEqual(model.visibleEntries?.map(\.name), ["net.anisota.harvest.minigame"])
        XCTAssertEqual(model.statusLabel, "1/3")
        XCTAssertNil(model.noMatchMessage)

        model.filter = "zzz"
        XCTAssertEqual(model.visibleEntries, [])
        XCTAssertEqual(model.statusLabel, "0/3")
        XCTAssertEqual(model.noMatchMessage, "No entries under net.anisota match \u{201C}zzz\u{201D}.")
        XCTAssertFalse(model.canLoadMore, "no list, no button")
        XCTAssertNil(model.emptyMessage)
    }

    func testPrefixViewLoadMoreAppendsAndResorts() async {
        let transport = LexiconsFakeTransport(groupRoutes())
        let model = makeGroup("net.anisota", transport)
        XCTAssertNil(model.loadMore(), "nothing loaded yet")
        await model.load().value

        let more = model.loadMore()
        XCTAssertNotNil(more)
        XCTAssertTrue(model.isLoadingMore)
        XCTAssertNil(model.loadMore(), "one page at a time")
        await more?.value
        XCTAssertFalse(model.isLoadingMore)
        XCTAssertEqual(model.entries.value?.map(\.name), ["net.anisota.beta", "net.anisota.zeta", "net.anisota.harvest.minigame", "net.anisota.thing"])
        XCTAssertNil(model.cursor)
        XCTAssertFalse(model.canLoadMore)
        XCTAssertNil(model.loadMore())
        XCTAssertEqual(model.summaryLine, "145 creates · 12 repos · 4 entries", "the total is the first page's; the count grows")
        XCTAssertTrue(transport.urls.last!.hasSuffix("/prefix?prefix=net.anisota&cursor=c1&limit=200"))
    }

    func testPrefixViewLoadMoreFailureKeepsTheCursor() async {
        var routes = groupRoutes()
        routes.insert((["/prefix", "cursor=c1"], .init(status: 500, body: "boom")), at: 0)
        let model = makeGroup("net.anisota", LexiconsFakeTransport(routes))
        await model.load().value
        await model.loadMore()?.value
        XCTAssertEqual(model.loadMoreError, Self.unavailable)
        XCTAssertEqual(model.cursor, "c1")
        XCTAssertEqual(model.entries.value?.count, 3)
        XCTAssertTrue(model.canLoadMore)
    }

    func testPrefixViewEmptyNamespaceOffersTheLexiconPage() async {
        let model = makeGroup("empty.ns", LexiconsFakeTransport(groupRoutes()))
        await model.load().value
        XCTAssertEqual(model.entries.value, [])
        XCTAssertEqual(model.emptyMessage, "Nothing is published under empty.ns.")
        XCTAssertEqual(model.emptyLexiconPath, "/explore/lexicons/empty.ns")
        XCTAssertEqual(model.emptyLexiconLinkLabel, "View empty.ns as a lexicon →")
        XCTAssertNil(model.noMatchMessage)
        XCTAssertFalse(model.canLoadMore)
        XCTAssertEqual(model.summaryLine, "0 creates · 0 repos · 0 entries")
        XCTAssertEqual(model.statusLabel, "0")
    }

    func testPrefixViewFailureIsAnError() async {
        let model = makeGroup("net.anisota", LexiconsFakeTransport([(["/prefix"], .init(status: 502, body: "down"))]))
        await model.load().value
        XCTAssertEqual(model.entries.errorMessage, Self.unavailable)
        XCTAssertEqual(model.errorMessage, "Couldn't reach the UFOs API: the UFOs API is unavailable")
        XCTAssertNil(model.total)
        XCTAssertNil(model.summaryLine)
        XCTAssertNil(model.emptyMessage)
        XCTAssertNil(model.visibleEntries)
    }

    func testSearchViewSortsByCreatesAndFilters() async {
        let transport = LexiconsFakeTransport(groupRoutes())
        let model = makeGroup("grain", transport)
        XCTAssertFalse(model.isPrefixView)
        XCTAssertEqual(model.eyebrow, "Search results")
        XCTAssertEqual(model.breadcrumbs.count, 1)
        XCTAssertEqual(model.breadcrumbs[0].isLast, true)
        XCTAssertEqual(model.filterPlaceholder, "Filter these results…")
        XCTAssertEqual(model.filterLabel, "Filter lexicons matching grain")

        await model.load().value
        XCTAssertEqual(model.entries.value?.map(\.name), ["social.grain.gallery", "social.grain.like"])
        XCTAssertEqual(model.entries.value?.map(\.isNamespace), [false, false])
        XCTAssertNil(model.total)
        XCTAssertNil(model.summaryLine, "no summary line on the search view")
        XCTAssertNil(model.cursor)
        XCTAssertFalse(model.canLoadMore)
        XCTAssertNil(model.loadMore())
        XCTAssertEqual(model.statusLabel, "2")
        XCTAssertTrue(transport.urls[0].hasSuffix("/search?q=grain"))

        model.filter = "like"
        XCTAssertEqual(model.visibleEntries?.map(\.name), ["social.grain.like"])
        XCTAssertEqual(model.statusLabel, "1/2")
        model.filter = "zzz"
        XCTAssertEqual(model.noMatchMessage, "No results match \u{201C}zzz\u{201D}.")
        XCTAssertNil(model.emptyMessage)
    }

    func testSearchViewEmptyAndFailure() async {
        let empty = makeGroup("smokesignal", LexiconsFakeTransport(groupRoutes()))
        await empty.load().value
        XCTAssertEqual(empty.entries.value, [])
        XCTAssertEqual(empty.emptyMessage, "No lexicons matched \u{201C}smokesignal\u{201D}.")
        XCTAssertNil(empty.emptyLexiconPath)
        XCTAssertNil(empty.emptyLexiconLinkLabel)

        let down = makeGroup("smokesignal", LexiconsFakeTransport([(["/search"], .init(status: 500, body: ""))]))
        await down.load().value
        XCTAssertEqual(down.entries.errorMessage, Self.unavailable)
    }

    // MARK: Detail page

    private nonisolated static let galleryPrefix: String = {
        var children = [
            #"{"type":"collection","nsid":"social.grain.gallery","creates":800,"dids_estimate":500}"#,
            #"{"type":"collection","nsid":"social.grain.like","creates":40,"dids_estimate":9}"#,
            #"{"type":"prefix","prefix":"social.grain.beta","creates":999,"dids_estimate":1}"#,
            #"{"type":"collection","nsid":"social.grain.follow","creates":60,"dids_estimate":3}"#,
            #"{"type":"collection","nsid":"social.grain.comment","creates":10,"dids_estimate":2}"#,
        ]
        children += (1...12).map { #"{"type":"collection","nsid":"social.grain.c\#($0)","creates":\#($0),"dids_estimate":1}"# }
        return #"{"children":[\#(children.joined(separator: ","))],"cursor":null,"total":{"creates":2000}}"#
    }()

    private nonisolated static let gallerySamples: String = {
        let base = Int(now.timeIntervalSince1970 * 1_000_000)
        let records = (0..<10).map { i in
            #"{"collection":"social.grain.gallery","did":"did:plc:abcdefghijklmnopqrstuvwx","rkey":"r\#(i)","time_us":\#(base - (i + 1) * 60_000_000),"record":{"text":"sample \#(i)"}}"#
        }
        return "[" + records.joined(separator: ",") + "]"
    }()

    private func detailRoutes() -> [([String], LexiconsFakeTransport.Reply)] {
        [
            (["/collections/stats", "since=2025-01-01", "until=2025-01-08"], .init(status: 200, body: Self.statsBody([("social.grain.gallery", Self.counts(100, updates: 5, deletes: 2, dids: 50))]))),
            (["/collections/stats", "since=2024-12-25", "until=2025-01-01"], .init(status: 200, body: Self.statsBody([("social.grain.gallery", Self.counts(50, updates: 0, deletes: 4, dids: 25))]))),
            (["/collections/stats"], .init(status: 200, body: "{}")),
            (["/timeseries", "collection=social.grain.gallery"], .init(status: 200, body: Self.timeseriesBody("social.grain.gallery", [1, 0, 3]))),
            (["/prefix", "prefix=social.grain"], .init(status: 200, body: Self.galleryPrefix)),
            (["/records", "collection=social.grain.gallery"], .init(status: 200, body: Self.gallerySamples)),
            (["/records"], .init(status: 200, body: "[]")),
        ]
    }

    private func makeDetail(_ nsid: String, _ transport: LexiconsFakeTransport) -> LexiconDetailModel {
        LexiconDetailModel(nsid: nsid, http: HTTPClient(transport: transport), clock: { LexiconsModelTests.now })
    }

    func testDetailLoadsActivitySiblingsAndSamples() async {
        let transport = LexiconsFakeTransport(detailRoutes())
        let model = makeDetail("social.grain.gallery", transport)
        XCTAssertEqual(model.publisher, "grain.social")
        XCTAssertEqual(model.group, "social.grain")
        XCTAssertEqual(model.groupPath, "/explore/lexicons/group/social.grain")
        XCTAssertEqual(model.groupPrefix, "social.grain")
        XCTAssertEqual(model.schemaPath, "/explore/grain.social/com.atproto.lexicon.schema/social.grain.gallery")
        XCTAssertEqual(model.chartTitle, "Creates over the last 7d")
        XCTAssertNil(model.statTiles)
        XCTAssertEqual(model.series, [])
        XCTAssertFalse(model.hasSeriesActivity)
        XCTAssertTrue(model.hasActivity, "unknown reads as active so the notice does not flash")
        XCTAssertNil(model.noActivityMessage)
        XCTAssertNil(model.visibleSamples)
        XCTAssertNil(model.browseGroupPath)

        await model.load().value

        let tiles = model.statTiles ?? []
        XCTAssertEqual(tiles.map(\.label), ["Creates", "Updates", "Deletes", "DIDs"])
        XCTAssertEqual(tiles.map(\.id), ["creates", "updates", "deletes", "dids"])
        XCTAssertEqual(tiles.map(\.current), [100, 5, 2, 50])
        XCTAssertEqual(tiles.map(\.prior), [50, 0, 4, 25])
        XCTAssertEqual(tiles.map(\.deltaPct), [100, nil, -50, 100])
        XCTAssertEqual(tiles.map(\.deltaLabel), ["+100%", nil, "-50.0%", "+100%"])
        XCTAssertEqual(tiles.map(\.valueLabel), ["100", "5", "2", "50"])
        XCTAssertEqual(model.activity.value?.total, 157)
        XCTAssertTrue(model.hasActivity)
        XCTAssertNil(model.noActivityMessage)
        XCTAssertNil(model.activityErrorMessage)
        XCTAssertEqual(model.series, [1, 0, 3])
        XCTAssertTrue(model.hasSeriesActivity)
        model.metric = .dids
        XCTAssertEqual(model.series, [1, 0, 3])
        XCTAssertEqual(model.chartTitle, "DIDs over the last 7d")

        XCTAssertEqual(
            model.siblings.value?.map(\.nsid),
            ["social.grain.follow", "social.grain.like", "social.grain.c12", "social.grain.c11", "social.grain.comment", "social.grain.c10", "social.grain.c9", "social.grain.c8", "social.grain.c7", "social.grain.c6"],
            "the lexicon itself and sub-prefixes are excluded, creates descending (ties keep the API's order), capped at ten"
        )
        XCTAssertEqual(model.siblings.value?.first?.counts.creates, 60)
        XCTAssertEqual(model.browseGroupPath, "/explore/lexicons/group/social.grain")
        XCTAssertEqual(model.browseGroupLabel, "Browse all of social.grain →")
        XCTAssertEqual(model.siblingsEmptyMessage, "No sibling collections found in social.grain.")

        XCTAssertEqual(model.samples.value?.count, 10)
        let samples = model.visibleSamples ?? []
        XCTAssertEqual(samples.count, LexiconDetailModel.sampleLimit)
        XCTAssertEqual(samples[0].id, "did:plc:abcdefghijklmnopqrstuvwx-r0-0")
        XCTAssertEqual(samples[0].rkey, "r0")
        XCTAssertEqual(samples[0].didLabel, shortDid("did:plc:abcdefghijklmnopqrstuvwx"))
        XCTAssertEqual(samples[0].atUri, "at://did:plc:abcdefghijklmnopqrstuvwx/social.grain.gallery/r0")
        XCTAssertEqual(samples[0].explorerPath, "/explore/did:plc:abcdefghijklmnopqrstuvwx/social.grain.gallery/r0")
        XCTAssertEqual(samples[0].preview, "sample 0")
        XCTAssertEqual(samples[0].relativeTime(now: Self.now), "1m ago")
        XCTAssertEqual(samples[7].relativeTime(now: Self.now), "8m ago")

        let stats = transport.urls(containing: "/collections/stats")
        XCTAssertEqual(stats.count, 2)
        XCTAssertTrue(stats.contains { $0.hasSuffix("/collections/stats?collection=social.grain.gallery&since=2025-01-01T00%3A00%3A00.000Z&until=2025-01-08T00%3A00%3A00.000Z") })
        XCTAssertTrue(stats.contains { $0.hasSuffix("/collections/stats?collection=social.grain.gallery&since=2024-12-25T00%3A00%3A00.000Z&until=2025-01-01T00%3A00%3A00.000Z") })
        XCTAssertTrue(transport.urls(containing: "/timeseries")[0].hasSuffix("/timeseries?collection=social.grain.gallery&step=43200&since=2025-01-01T00%3A00%3A00.000Z"))
        XCTAssertTrue(transport.urls(containing: "/prefix")[0].hasSuffix("/prefix?prefix=social.grain"), "no order and no limit, as the web sends it")
        XCTAssertTrue(transport.urls(containing: "/records")[0].hasSuffix("/records?collection=social.grain.gallery"))
    }

    func testDetailWindowChangeRefetchesTheActivityOnly() async {
        let transport = LexiconsFakeTransport(detailRoutes())
        let model = makeDetail("social.grain.gallery", transport)
        model.window = .oneDay
        XCTAssertEqual(transport.urls.count, 0, "before load() a toggle only sets state")
        model.window = .sevenDays
        await model.load().value
        XCTAssertEqual(transport.count(containing: "/prefix"), 1)

        model.window = .oneDay
        XCTAssertTrue(model.isActivityRefreshing)
        XCTAssertEqual(model.statTiles?.map(\.current), [100, 5, 2, 50], "the previous numbers stay visible")
        XCTAssertEqual(model.chartTitle, "Creates over the last 1d")
        await model.awaitPending()
        XCTAssertFalse(model.isActivityRefreshing)
        XCTAssertEqual(model.statTiles?.map(\.current), [0, 0, 0, 0], "the 1d window has no stats in the fixture")
        XCTAssertFalse(model.hasActivity)
        XCTAssertEqual(model.noActivityMessage, "No recorded activity for this lexicon in the last 1d.")
        XCTAssertEqual(model.series, [1, 0, 3])
        XCTAssertEqual(transport.count(containing: "/prefix"), 1, "siblings and samples are NSID-only")
        XCTAssertEqual(transport.count(containing: "/records"), 1)
        XCTAssertTrue(transport.urls(containing: "/collections/stats").last!.contains("since=2025-01-06T00%3A00%3A00.000Z&until=2025-01-07T00%3A00%3A00.000Z"))
        XCTAssertTrue(transport.urls(containing: "/timeseries").last!.contains("step=7200"))

        model.window = .oneDay
        await model.awaitPending()
        XCTAssertEqual(transport.count(containing: "/timeseries"), 2, "the same window again does not refetch")
    }

    func testDetailSkipsThePrefixCallForShortNsids() async {
        let transport = LexiconsFakeTransport(detailRoutes())
        let single = makeDetail("foo", transport)
        await single.load().value
        XCTAssertEqual(single.siblings.value, [])
        XCTAssertEqual(single.groupPrefix, "foo")
        XCTAssertNil(single.browseGroupPath)
        XCTAssertEqual(single.siblingsEmptyMessage, "No sibling collections found in foo.")
        XCTAssertEqual(single.publisher, "foo")
        XCTAssertEqual(single.samples.value, [])
        XCTAssertEqual(transport.count(containing: "/prefix"), 0)

        let two = makeDetail("social.grain", transport)
        await two.load().value
        XCTAssertEqual(two.siblings.value, [], "a two-segment NSID has a single-segment group")
        XCTAssertEqual(transport.count(containing: "/prefix"), 0)
    }

    func testDetailFailureStates() async {
        let down = makeDetail("social.grain.gallery", LexiconsFakeTransport([]))
        await down.load().value
        XCTAssertEqual(down.activity.errorMessage, Self.unavailable)
        XCTAssertEqual(down.activityErrorMessage, "Couldn't reach the UFOs API: the UFOs API is unavailable")
        XCTAssertEqual(down.siblings.errorMessage, Self.unavailable)
        XCTAssertEqual(down.samples.errorMessage, Self.unavailable)
        XCTAssertNil(down.statTiles)
        XCTAssertEqual(down.series, [])
        XCTAssertTrue(down.hasActivity)
        XCTAssertNil(down.noActivityMessage)
        XCTAssertNil(down.visibleSamples)
        XCTAssertNil(down.browseGroupPath)

        // One miss among the three window calls reads as zero, as the web's
        // allSettled fallbacks do.
        var routes = detailRoutes()
        routes.insert((["/timeseries"], .init(status: 500, body: "boom")), at: 0)
        let partial = makeDetail("social.grain.gallery", LexiconsFakeTransport(routes))
        await partial.load().value
        XCTAssertEqual(partial.statTiles?.map(\.current), [100, 5, 2, 50])
        XCTAssertEqual(partial.series, [])
        XCTAssertFalse(partial.hasSeriesActivity)
        XCTAssertEqual(LexiconDetailModel.chartEmptyMessage, "No recorded activity in this window.")

        // An empty group and no samples are loaded-empty, not errors.
        let quiet = makeDetail("social.grain.gallery", LexiconsFakeTransport([
            (["/collections/stats"], .init(status: 200, body: "{}")),
            (["/timeseries"], .init(status: 200, body: #"{"range":[],"series":{}}"#)),
            (["/prefix"], .init(status: 200, body: #"{"children":[]}"#)),
            (["/records"], .init(status: 200, body: "[]")),
        ]))
        await quiet.load().value
        XCTAssertEqual(quiet.activity.value, LexiconActivity(current: .zero, prior: .zero, buckets: []))
        XCTAssertFalse(quiet.hasActivity)
        XCTAssertEqual(quiet.noActivityMessage, "No recorded activity for this lexicon in the last 7d.")
        XCTAssertEqual(quiet.siblings.value, [])
        XCTAssertNil(quiet.browseGroupPath)
        XCTAssertEqual(quiet.visibleSamples, [])
        XCTAssertEqual(LexiconDetailModel.samplesEmptyMessage, "No recent records sampled for this lexicon.")
    }

    func testDetailSearchRoutesThroughTheGroupPage() async {
        let model = makeDetail("social.grain.gallery", LexiconsFakeTransport([]))
        XCTAssertNil(model.submitSearch())
        model.search = "   "
        XCTAssertNil(model.submitSearch())
        model.search = " net.anisota "
        XCTAssertEqual(model.submitSearch(), .lexiconGroup(prefix: "net.anisota"))
    }

    func testRelativeTimeRoundsLikeTheWeb() async {
        let now = Self.now
        func ago(_ seconds: Double) -> String {
            LexiconDetailModel.relativeTime(now.addingTimeInterval(-seconds), now: now)
        }
        XCTAssertEqual(ago(-5), "just now")
        XCTAssertEqual(ago(0), "0s ago")
        XCTAssertEqual(ago(30), "30s ago")
        XCTAssertEqual(ago(59.4), "59s ago")
        XCTAssertEqual(ago(59.6), "1m ago")
        XCTAssertEqual(ago(90), "2m ago")
        XCTAssertEqual(ago(3569), "59m ago")
        XCTAssertEqual(ago(3600), "1h ago")
        XCTAssertEqual(ago(23 * 3600), "23h ago")
        XCTAssertEqual(ago(25 * 3600), "1d ago")
        XCTAssertEqual(ago(10 * 86_400), "10d ago")
        XCTAssertEqual(LexiconDetailModel.relativeTime(.distantPast, now: now).hasSuffix("d ago"), true)
    }
}
