import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport: a route matches when every one of its
/// fragments appears in the URL; the first match wins, the rest 404.
private final class PulseFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
    }

    private let lock = NSLock()
    private let routes: [(patterns: [String], reply: Reply)]
    private var recorded: [String] = []

    init(_ routes: [([String], Reply)]) {
        self.routes = routes.map { (patterns: $0.0, reply: $0.1) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        let reply = route(for: url.absoluteString)
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

    func count(containing fragment: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        return recorded.filter { $0.contains(fragment) }.count
    }
}

@MainActor
final class AtmospherePulseModelTests: XCTestCase {
    /// 2025-01-08T00:00:00Z: the 7d window starts 2025-01-01, the one
    /// before it 2024-12-25.
    private nonisolated static let now = Date(timeIntervalSince1970: 1_736_294_400)

    private nonisolated static func counts(_ creates: Int = 0, dids: Int = 0) -> String {
        #"{"creates":\#(creates),"updates":0,"deletes":0,"dids_estimate":\#(dids)}"#
    }

    private nonisolated static func row(_ nsid: String, _ creates: Int, dids: Int) -> String {
        #"{"nsid":"\#(nsid)","creates":\#(creates),"updates":0,"deletes":0,"dids_estimate":\#(dids)}"#
    }

    private nonisolated static func stats(_ entries: [(String, String)]) -> String {
        "{" + entries.map { #""\#($0.0)":\#($0.1)"# }.joined(separator: ",") + "}"
    }

    private nonisolated static let pool = #"{"collections":["# + [
        row("app.bsky.feed.post", 5000, dids: 1000),
        row("social.grain.gallery", 800, dids: 500),
        row("sh.tangled.repo", 300, dids: 300),
    ].joined(separator: ",") + "]}"

    private nonisolated static func newBody(count: Int) -> String {
        let lexicons = (1...count).map { #"{"nsid":"app.new\#($0).thing","creates":\#($0 * 10),"didsEstimate":\#($0)}"# }
        return #"{"ok":true,"window":"7d","since":"2025-01-01T00:00:00.000Z","minAccounts":3,"historyBegins":"2024-11-01","count":\#(count),"lexicons":[\#(lexicons.joined(separator: ","))]}"#
    }

    private func routes() -> [([String], PulseFakeTransport.Reply)] {
        [
            (["/collections/stats", "since=2024-12-25"], .init(status: 200, body: Self.stats([
                ("social.grain.gallery", Self.counts(400, dids: 250)),
                ("sh.tangled.repo", Self.counts(600, dids: 400)),
            ]))),
            (["/collections/stats", "since=2025-01-01"], .init(status: 200, body: Self.stats([
                ("app.bsky.feed.post", Self.counts(5000, dids: 1000)),
                ("social.grain.gallery", Self.counts(800, dids: 520)),
                ("sh.tangled.repo", Self.counts(300, dids: 300)),
            ]))),
            (["/collections?"], .init(status: 200, body: Self.pool)),
            (["aturi.to/api/lexicons/new", "window=7d"], .init(status: 200, body: Self.newBody(count: 12))),
            (["aturi.to/api/lexicons/new", "window=1d"], .init(status: 502, body: #"{"ok":false,"error":"upstream_error"}"#)),
        ]
    }

    private func makeModel(_ transport: PulseFakeTransport) -> AtmospherePulseModel {
        AtmospherePulseModel(http: HTTPClient(transport: transport), clock: { AtmospherePulseModelTests.now })
    }

    func testTheNewLexiconsURL() {
        XCTAssertEqual(NewLexiconsClient.url(window: .sevenDays).absoluteString, "https://aturi.to/api/lexicons/new?window=7d")
        XCTAssertEqual(NewLexiconsClient.url(window: .thirtyDays).absoluteString, "https://aturi.to/api/lexicons/new?window=30d")
    }

    func testLoadFillsTheThreeCards() async {
        let transport = PulseFakeTransport(routes())
        let model = makeModel(transport)
        XCTAssertTrue(model.top.isIdle)
        XCTAssertNil(model.visibleTop)

        await model.load().value

        // Most active keeps Bluesky and carries a delta against the week before.
        XCTAssertEqual(model.visibleTop?.map(\.nsid), ["app.bsky.feed.post", "social.grain.gallery", "sh.tangled.repo"])
        XCTAssertEqual(model.visibleTop?.map(\.deltaPct), [nil, 108, -25])
        // Rising hides Bluesky and reads as prior -> now.
        XCTAssertEqual(model.visibleRising?.map(\.nsid), ["social.grain.gallery", "sh.tangled.repo"])
        XCTAssertEqual(model.visibleRising?.map(\.prior), [250, 400])
        XCTAssertEqual(model.visibleRising?.map(\.value), [520, 300])
        XCTAssertEqual(transport.count(containing: "/timeseries"), 0, "the cards draw no sparklines")

        XCTAssertEqual(model.visibleNew?.count, AtmospherePulseModel.newResultCount)
        XCTAssertEqual(model.visibleNew?.first, NewLexicon(nsid: "app.new1.thing", creates: 10, didsEstimate: 1))
        XCTAssertTrue(model.showsNewToggle)
        XCTAssertEqual(model.newToggleLabel, "Show 12 of 12")
        model.newExpanded = true
        XCTAssertEqual(model.visibleNew?.count, 12)
        XCTAssertEqual(model.newToggleLabel, "Show 10")

        XCTAssertFalse(model.showsTopToggle, "three rows: nothing more to reveal")
        XCTAssertNil(model.topErrorMessage)
        XCTAssertNil(model.newErrorMessage)
    }

    func testCopyFollowsTheWindowAndMetric() {
        let model = makeModel(PulseFakeTransport([]))
        XCTAssertEqual(model.heading, "This week in the Atmosphere")
        XCTAssertEqual(model.headingDetail, "Compared with the week before, via UFOs")
        XCTAssertEqual(model.topSubtitle, "By accounts")
        XCTAssertEqual(model.risingSubtitle, "Accounts last week \u{2192} this week")
        XCTAssertEqual(model.newTitle, "New this week")
        XCTAssertEqual(model.newSubtitle, "By accounts")

        model.window = .oneDay
        model.metric = .creates
        XCTAssertEqual(model.heading, "Today in the Atmosphere")
        XCTAssertEqual(model.topSubtitle, "By records created")
        XCTAssertEqual(model.risingSubtitle, "Records created yesterday \u{2192} today")
        XCTAssertEqual(model.newTitle, "New today")
        XCTAssertEqual(UFOsWindow.allCases.map(AtmospherePulseModel.windowLabel), ["Day", "Week", "Month"])
    }

    func testTogglesBeforeLoadDoNotFetch() {
        let transport = PulseFakeTransport(routes())
        let model = makeModel(transport)
        model.window = .thirtyDays
        model.metric = .creates
        model.topExpanded = true
        XCTAssertEqual(transport.count(containing: "https://"), 0)
    }

    func testAFailedNewListLeavesTheRankedCardsAlone() async {
        let transport = PulseFakeTransport(routes())
        let model = makeModel(transport)
        await model.load().value
        XCTAssertNotNil(model.visibleNew)

        model.window = .oneDay
        await model.awaitPending()

        XCTAssertEqual(model.newErrorMessage, "Couldn\u{2019}t load new lexicons: \(AtmospherePulseModel.newUnavailableMessage)")
        XCTAssertNil(model.visibleNew)
        // The 1d fixture has no stats, so the ranked pool's own counts stand in.
        XCTAssertEqual(model.visibleTop?.map(\.value), [1000, 500, 300])
        XCTAssertNil(model.topErrorMessage)
    }

    func testRankingFailureIsAnError() async {
        let transport = PulseFakeTransport([
            (["aturi.to/api/lexicons/new"], .init(status: 200, body: Self.newBody(count: 2))),
        ])
        let model = makeModel(transport)
        await model.load().value
        XCTAssertEqual(model.topErrorMessage, "Couldn\u{2019}t reach the UFOs API: \(LexiconsModel.apiUnavailableMessage)")
        XCTAssertEqual(model.risingErrorMessage, "Couldn\u{2019}t reach the UFOs API: \(LexiconsModel.apiUnavailableMessage)")
        XCTAssertEqual(model.visibleNew?.count, 2)
        XCTAssertFalse(model.showsNewToggle)
    }

    func testBarFractionIsLogScaledWithAFloor() {
        XCTAssertEqual(AtmospherePulseModel.barFraction(1000, max: 1000), 1, accuracy: 1e-9)
        XCTAssertEqual(AtmospherePulseModel.barFraction(0, max: 1000), 0.02, accuracy: 1e-9)
        XCTAssertEqual(AtmospherePulseModel.barFraction(9, max: 99), 0.5, accuracy: 1e-9)
        XCTAssertEqual(AtmospherePulseModel.barFraction(5, max: 0), 1, accuracy: 1e-9, "a zero max clamps")
    }
}
