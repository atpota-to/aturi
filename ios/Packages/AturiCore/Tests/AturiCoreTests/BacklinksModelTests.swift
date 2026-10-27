import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport for the backlinks panel: the first pattern
/// found in the URL answers, anything else is a 404. An optional delay lets
/// a test cancel a load mid-flight.
private final class BacklinksFakeTransport: HTTPTransport, @unchecked Sendable {
    enum Route {
        case reply(status: Int, body: String)
        case fail(Error)
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, route: Route)]
    private let delayNanoseconds: UInt64
    private(set) var requests: [URLRequest] = []

    init(_ routes: [(String, Route)], delayNanoseconds: UInt64 = 0) {
        self.routes = routes.map { (pattern: $0.0, route: $0.1) }
        self.delayNanoseconds = delayNanoseconds
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        if delayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: delayNanoseconds)
        }
        let url = request.url!
        let route = routes.first { url.absoluteString.contains($0.pattern) }?.route
            ?? .reply(status: 404, body: #"{"error":"NotFound"}"#)
        switch route {
        case .fail(let error):
            throw error
        case .reply(let status, let body):
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
            return (Data(body.utf8), response)
        }
    }

    /// Locking stays in a synchronous helper: NSLock is not async-safe.
    private func record(_ request: URLRequest) {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
    }

    var urls: [String] {
        lock.lock(); defer { lock.unlock() }
        return requests.compactMap { $0.url?.absoluteString }
    }

    func count(containing fragment: String) -> Int {
        urls.filter { $0.contains(fragment) }.count
    }
}

@MainActor
final class BacklinksModelTests: XCTestCase {
    private typealias Route = BacklinksFakeTransport.Route

    nonisolated private static let target = "at://did:plc:alice123/app.bsky.feed.post/3kabc"
    nonisolated private static let sourcesPath = "/links/all"
    nonisolated private static let likeSource = "app.bsky.feed.like:subject.uri"
    nonisolated private static let likePage = "source=app.bsky.feed.like%3Asubject.uri"
    nonisolated private static let vouchPage = "source=sh.tangled.graph.vouch%3A."
    nonisolated private static let bobRecord = "getRecordByUri?at_uri=at%3A%2F%2Fdid%3Aplc%3Abob%2Fapp.bsky.feed.like%2F3k1"
    nonisolated private static let bobDoc = "resolveMiniDoc?identifier=did%3Aplc%3Abob"
    nonisolated private static let carolDoc = "resolveMiniDoc?identifier=did%3Aplc%3Acarol"

    nonisolated private static let sourcesBody = #"{"links":{"app.bsky.feed.like":{".subject.uri":{"records":1200,"distinct_dids":900}},"app.bsky.feed.repost":{".subject.uri":{"records":3,"distinct_dids":3}},"sh.tangled.graph.vouch":{".":{"records":2}}}}"#
    nonisolated private static let firstPage = #"{"linking_records":[{"did":"did:plc:bob","collection":"app.bsky.feed.like","rkey":"3k1"},{"did":"did:plc:carol","collection":"app.bsky.feed.like","rkey":"3k2"}],"cursor":"c1"}"#
    nonisolated private static let secondPage = #"{"linking_records":[{"did":"did:plc:bob","collection":"app.bsky.feed.like","rkey":"3k3"}]}"#
    nonisolated private static let bobLike = #"{"uri":"at://did:plc:bob/app.bsky.feed.like/3k1","cid":"c1","value":{"$type":"app.bsky.feed.like","subject":{"uri":"at://did:plc:alice123/app.bsky.feed.post/3kabc","cid":"x"},"createdAt":"2026-01-01T00:00:00Z"}}"#
    nonisolated private static let bobMiniDoc = #"{"did":"did:plc:bob","handle":"bob.test","pds":"https://pds.example"}"#

    /// The happy-path routes, with per-test overrides taking precedence.
    /// The cursor route sits before the bare page route so the second page
    /// is matched by its cursor first.
    private func transport(overrides: [(String, Route)] = [], delayNanoseconds: UInt64 = 0) -> BacklinksFakeTransport {
        let base: [(String, Route)] = [
            (Self.sourcesPath, .reply(status: 200, body: Self.sourcesBody)),
            ("cursor=c1", .reply(status: 200, body: Self.secondPage)),
            (Self.likePage, .reply(status: 200, body: Self.firstPage)),
            (Self.vouchPage, .reply(status: 200, body: #"{"linking_records":[]}"#)),
            (Self.bobRecord, .reply(status: 200, body: Self.bobLike)),
            (Self.bobDoc, .reply(status: 200, body: Self.bobMiniDoc)),
            (Self.carolDoc, .reply(status: 404, body: #"{"error":"NotFound"}"#)),
        ]
        return BacklinksFakeTransport(overrides + base, delayNanoseconds: delayNanoseconds)
    }

    private func makeModel(_ transport: BacklinksFakeTransport, hydrates: Bool = true) -> BacklinksModel {
        BacklinksModel(target: Self.target, http: HTTPClient(transport: transport), hydrates: hydrates)
    }

    // MARK: Sources

    func testSourcesLoadSortedWithTotals() async {
        let transport = transport()
        let model = makeModel(transport)
        XCTAssertTrue(model.sources.isIdle)
        XCTAssertEqual(model.summaryText, "loading\u{2026}")
        XCTAssertEqual(model.countText, "\u{2014}")

        await model.loadAndWait(target: Self.target)

        XCTAssertEqual(model.sourceList.map(\.source), [Self.likeSource, "app.bsky.feed.repost:subject.uri", "sh.tangled.graph.vouch:."])
        XCTAssertEqual(model.sourceList.map(\.count), [1200, 3, 2])
        XCTAssertEqual(model.sourceList.map(\.path), [".subject.uri", ".subject.uri", "."])
        XCTAssertEqual(model.sourceList.first?.distinctDids, 900)
        XCTAssertNil(model.sourceList.last?.distinctDids)
        XCTAssertEqual(model.totals, BacklinkTotals(records: 1205, accounts: 903, sources: 3))
        XCTAssertEqual(model.countText, "1,205")
        XCTAssertEqual(model.summaryText, "across 3 sources \u{00B7} from 903 accounts")
        XCTAssertFalse(model.isUnavailable)
        XCTAssertFalse(model.isEmpty)
        XCTAssertNil(model.openSource)
        XCTAssertEqual(transport.urls, ["https://constellation.microcosm.blue/links/all?target=at%3A%2F%2Fdid%3Aplc%3Aalice123%2Fapp.bsky.feed.post%2F3kabc"])
    }

    func testSingularSummaryWithoutAccounts() async {
        let transport = transport(overrides: [(Self.sourcesPath, .reply(status: 200, body: #"{"links":{"sh.tangled.graph.vouch":{".":{"records":1}}}}"#))])
        let model = makeModel(transport)
        await model.loadAndWait(target: Self.target)
        XCTAssertEqual(model.summaryText, "across 1 source")
        XCTAssertEqual(model.countText, "1")
        XCTAssertEqual(model.totals?.accounts, nil, "no source reported distinct DIDs, so the accounts figure is hidden")
    }

    func testUnavailableIndexIsAFailure() async {
        let transport = transport(overrides: [(Self.sourcesPath, .reply(status: 503, body: "down"))])
        let model = makeModel(transport)
        await model.loadAndWait(target: Self.target)
        XCTAssertEqual(model.sources, .failed(BacklinksModel.unavailableMessage))
        XCTAssertTrue(model.isUnavailable)
        XCTAssertFalse(model.isEmpty)
        XCTAssertEqual(model.summaryText, "unavailable")
        XCTAssertEqual(model.countText, "\u{2014}")
        XCTAssertNil(model.totals)
        XCTAssertTrue(model.sourceList.isEmpty)
    }

    func testNoSourcesIsARealEmptyAnswer() async {
        let transport = transport(overrides: [(Self.sourcesPath, .reply(status: 200, body: #"{"links":{}}"#))])
        let model = makeModel(transport)
        await model.loadAndWait(target: Self.target)
        XCTAssertEqual(model.sources, .loaded([]))
        XCTAssertTrue(model.isEmpty)
        XCTAssertFalse(model.isUnavailable)
        XCTAssertEqual(model.summaryText, "no records reference this yet")
        XCTAssertEqual(model.countText, "0")
        XCTAssertEqual(model.totals, BacklinkTotals(records: 0, accounts: nil, sources: 0))
    }

    func testEmptyTargetStaysIdle() async {
        let transport = transport()
        let model = BacklinksModel(http: HTTPClient(transport: transport))
        await model.loadAndWait(target: "")
        XCTAssertTrue(model.sources.isIdle)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    // MARK: Per-source records

    func testOpeningASourceLoadsItsFirstPageAndHydratesIt() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.loadAndWait(target: Self.target)

        model.open(source: Self.likeSource)
        XCTAssertTrue(model.isOpen(Self.likeSource))
        XCTAssertEqual(model.pages[Self.likeSource]?.isLoading, true)
        await model.awaitPage(for: Self.likeSource)

        guard let page = model.pages[Self.likeSource] else { return XCTFail("expected a page") }
        XCTAssertFalse(page.isLoading)
        XCTAssertFalse(page.errored)
        XCTAssertFalse(page.isDone)
        XCTAssertEqual(page.cursor, "c1")
        XCTAssertTrue(page.canLoadMore)
        XCTAssertEqual(page.records.map(\.rkey), ["3k1", "3k2"])

        let rows = model.rows(for: Self.likeSource)
        XCTAssertEqual(rows.map(\.id), ["at://did:plc:bob/app.bsky.feed.like/3k1", "at://did:plc:carol/app.bsky.feed.like/3k2"])
        XCTAssertEqual(rows.map(\.rkey), ["3k1", "3k2"])
        XCTAssertEqual(rows[0].shortDid, shortDid("did:plc:bob"))
        XCTAssertEqual(rows[0].handle, "bob.test")
        XCTAssertEqual(rows[0].label, "@bob.test")
        XCTAssertEqual(rows[0].preview, "at://did:plc:alice123/app.bsky.feed.post/3kabc", "a like previews as its subject")
        XCTAssertEqual(rows[0].hydrated?.cid, "c1")
        XCTAssertNil(rows[1].handle, "carol's DID could not be labelled")
        XCTAssertEqual(rows[1].label, shortDid("did:plc:carol"))
        XCTAssertNil(rows[1].preview, "carol's record was not in the edge cache")
        XCTAssertEqual(model.label(for: "did:plc:bob"), "bob.test")
        XCTAssertNil(model.label(for: "did:plc:carol"))

        XCTAssertEqual(transport.count(containing: "getBacklinks?subject=at%3A%2F%2Fdid%3Aplc%3Aalice123%2Fapp.bsky.feed.post%2F3kabc&source=app.bsky.feed.like%3Asubject.uri&limit=25"), 1)
        XCTAssertEqual(transport.count(containing: "getRecordByUri"), 2)
        XCTAssertEqual(transport.count(containing: "resolveMiniDoc"), 2)
    }

    func testLoadMoreAppendsThenFinishesWithoutReaskingKnownDids() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.loadAndWait(target: Self.target)
        model.open(source: Self.likeSource)
        await model.awaitPage(for: Self.likeSource)

        model.loadMore(source: Self.likeSource)
        XCTAssertEqual(model.pages[Self.likeSource]?.isLoading, true)
        XCTAssertEqual(model.pages[Self.likeSource]?.records.count, 2, "the first page stays while the next loads")
        await model.awaitPage(for: Self.likeSource)

        guard let page = model.pages[Self.likeSource] else { return XCTFail("expected a page") }
        XCTAssertEqual(page.records.map(\.rkey), ["3k1", "3k2", "3k3"])
        XCTAssertTrue(page.isDone, "no cursor on the second page")
        XCTAssertNil(page.cursor)
        XCTAssertFalse(page.canLoadMore)
        XCTAssertEqual(model.rows(for: Self.likeSource).map(\.label), ["@bob.test", shortDid("did:plc:carol"), "@bob.test"])
        XCTAssertEqual(transport.count(containing: "cursor=c1"), 1)
        XCTAssertEqual(transport.count(containing: "resolveMiniDoc"), 2, "bob and carol were labelled on the first page")
        XCTAssertEqual(transport.count(containing: "getRecordByUri"), 3)

        model.loadMore(source: Self.likeSource)
        await model.awaitPage(for: Self.likeSource)
        XCTAssertEqual(transport.count(containing: "getBacklinks"), 2, "a finished source is never asked again")
    }

    func testAFailedPageIsErroredAndDone() async {
        let transport = transport(overrides: [(Self.likePage, .reply(status: 500, body: "boom"))])
        let model = makeModel(transport)
        await model.loadAndWait(target: Self.target)
        model.open(source: Self.likeSource)
        await model.awaitPage(for: Self.likeSource)
        guard let page = model.pages[Self.likeSource] else { return XCTFail("expected a page") }
        XCTAssertTrue(page.errored)
        XCTAssertTrue(page.isDone)
        XCTAssertFalse(page.isLoading)
        XCTAssertTrue(page.records.isEmpty)
        XCTAssertFalse(page.canLoadMore)
        XCTAssertTrue(model.rows(for: Self.likeSource).isEmpty)
        XCTAssertEqual(transport.count(containing: "getRecordByUri"), 0)
    }

    func testAnEmptyBatchFinishesTheSource() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.loadAndWait(target: Self.target)
        model.open(source: "sh.tangled.graph.vouch:.")
        await model.awaitPage(for: "sh.tangled.graph.vouch:.")
        guard let page = model.pages["sh.tangled.graph.vouch:."] else { return XCTFail("expected a page") }
        XCTAssertTrue(page.isDone)
        XCTAssertFalse(page.errored)
        XCTAssertTrue(page.records.isEmpty)
        XCTAssertEqual(transport.count(containing: Self.vouchPage), 1, "the root-path source keeps its dot")
        XCTAssertEqual(transport.count(containing: "getRecordByUri"), 0, "nothing to hydrate")
    }

    func testToggleClosesAndReopensWithoutRefetching() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.loadAndWait(target: Self.target)

        model.toggle(source: Self.likeSource)
        XCTAssertEqual(model.openSource, Self.likeSource)
        await model.awaitPage(for: Self.likeSource)
        model.toggle(source: Self.likeSource)
        XCTAssertNil(model.openSource)
        XCTAssertFalse(model.isOpen(Self.likeSource))
        XCTAssertNotNil(model.pages[Self.likeSource], "the page is kept for reopening")

        model.toggle(source: Self.likeSource)
        XCTAssertEqual(model.openSource, Self.likeSource)
        XCTAssertEqual(transport.count(containing: "getBacklinks"), 1)

        // Opening another source closes this one; the web keeps one open.
        model.open(source: "sh.tangled.graph.vouch:.")
        XCTAssertEqual(model.openSource, "sh.tangled.graph.vouch:.")
        XCTAssertFalse(model.isOpen(Self.likeSource))
        await model.awaitPage(for: "sh.tangled.graph.vouch:.")
        model.close()
        XCTAssertNil(model.openSource)
    }

    func testANewTargetResetsEverything() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.loadAndWait(target: Self.target)
        model.open(source: Self.likeSource)
        await model.awaitPage(for: Self.likeSource)
        XCTAssertFalse(model.hydratedRecords.isEmpty)
        XCTAssertFalse(model.handles.isEmpty)

        await model.loadAndWait(target: "did:plc:alice123")
        XCTAssertEqual(model.target, "did:plc:alice123")
        XCTAssertNil(model.openSource)
        XCTAssertTrue(model.pages.isEmpty)
        XCTAssertTrue(model.hydratedRecords.isEmpty)
        XCTAssertTrue(model.handles.isEmpty)
        XCTAssertEqual(model.sourceList.count, 3)
        XCTAssertEqual(transport.count(containing: "links/all?target=did%3Aplc%3Aalice123"), 1)

        model.reload()
        XCTAssertTrue(model.sources.isLoading)
        await model.awaitLoad()
        XCTAssertEqual(model.sourceList.count, 3)
    }

    func testHydrationCanBeSwitchedOff() async {
        let transport = transport()
        let model = makeModel(transport, hydrates: false)
        await model.loadAndWait(target: Self.target)
        model.open(source: Self.likeSource)
        await model.awaitPage(for: Self.likeSource)
        let rows = model.rows(for: Self.likeSource)
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].label, shortDid("did:plc:bob"))
        XCTAssertNil(rows[0].preview)
        XCTAssertEqual(transport.count(containing: "slingshot"), 0)
    }

    func testCancelLeavesALoadUnsettled() async {
        let transport = transport(delayNanoseconds: 30_000_000)
        let model = makeModel(transport)
        model.load()
        XCTAssertTrue(model.sources.isLoading)
        model.cancel()
        await model.awaitLoad()
        XCTAssertTrue(model.sources.isLoading, "a cancelled load never settles")

        model.load()
        model.load(target: "did:plc:alice123")
        await model.awaitLoad()
        XCTAssertEqual(model.target, "did:plc:alice123")
        XCTAssertEqual(model.sourceList.count, 3)
    }

    func testCompactCountsMatchTheLexiconsFormatter() {
        XCTAssertEqual(BacklinksModel.compactCount(2400), UFOsFormat.formatCount(2400))
        XCTAssertEqual(BacklinksModel.compactCount(12), "12")
        XCTAssertEqual(BacklinksModel.pageSize, 25)
    }
}
