import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport: the first fragment found in the URL answers,
/// anything else is a 404.
private final class NewLexiconsFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
    }

    private let lock = NSLock()
    private let routes: [(fragment: String, reply: Reply)]
    private var recorded: [String] = []

    init(_ routes: [(String, Reply)]) {
        self.routes = routes.map { (fragment: $0.0, reply: $0.1) }
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

    /// Locking stays in synchronous helpers: NSLock is not async-safe.
    private func route(for url: String) -> Reply {
        lock.lock(); defer { lock.unlock() }
        recorded.append(url)
        return routes.first { url.contains($0.fragment) }?.reply
            ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
    }

    var urls: [String] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }
}

@MainActor
final class NewLexiconsModelTests: XCTestCase {
    private nonisolated static func body(count: Int, prefix: String = "app.new", historyBegins: String? = "2024-11-01") -> String {
        let lexicons: [String] = count == 0 ? [] : (1...count).map {
            #"{"nsid":"\#(prefix)\#($0).thing","creates":\#($0 * 10),"didsEstimate":\#($0)}"#
        }
        let history = historyBegins.map { #","historyBegins":"\#($0)""# } ?? ""
        return #"{"ok":true,"window":"7d","since":"2025-01-01T00:00:00.000Z","minAccounts":3\#(history),"count":\#(count),"lexicons":[\#(lexicons.joined(separator: ","))]}"#
    }

    private func routes() -> [(String, NewLexiconsFakeTransport.Reply)] {
        [
            ("aturi.to/api/lexicons/new?window=7d", .init(status: 200, body: Self.body(count: 30))),
            ("aturi.to/api/lexicons/new?window=1d", .init(status: 200, body: Self.body(count: 4, prefix: "app.day"))),
            ("aturi.to/api/lexicons/new?window=30d", .init(status: 502, body: #"{"ok":false,"error":"upstream_error"}"#)),
        ]
    }

    private func makeModel(_ transport: NewLexiconsFakeTransport) -> NewLexiconsModel {
        NewLexiconsModel(http: HTTPClient(transport: transport))
    }

    func testTenRowsThenTwentyFive() async {
        let model = makeModel(NewLexiconsFakeTransport(routes()))
        XCTAssertTrue(model.answer.isIdle)
        XCTAssertNil(model.visible)

        await model.load().value

        XCTAssertEqual(model.visible?.count, NewLexiconsModel.resultCount)
        XCTAssertEqual(model.visible?.first, NewLexicon(nsid: "app.new1.thing", creates: 10, didsEstimate: 1))
        XCTAssertTrue(model.showsToggle)
        XCTAssertEqual(model.toggleLabel, "Show 25 of 30")

        model.expanded = true
        XCTAssertEqual(model.visible?.count, NewLexiconsModel.expandedCount)
        XCTAssertEqual(model.toggleLabel, "Show 10")
        XCTAssertNil(model.errorMessage)
        XCTAssertFalse(model.isRefreshing)
    }

    func testTheFirstSeenNote() async {
        let model = makeModel(NewLexiconsFakeTransport(routes()))
        XCTAssertNil(model.note, "no answer yet")
        await model.load().value
        XCTAssertEqual(
            model.note,
            "First seen: no activity from 2024-11-01, when UFOs\u{2019} history begins, to the window\u{2019}s start. Account counts are estimates; a few may be one developer testing."
        )

        let undated = makeModel(NewLexiconsFakeTransport([
            ("aturi.to/api/lexicons/new", .init(status: 200, body: Self.body(count: 2, historyBegins: nil))),
        ]))
        await undated.load().value
        XCTAssertEqual(undated.visible?.count, 2)
        XCTAssertNil(undated.note)
    }

    func testAWindowChosenBeforeLoadIsTheFirstFetch() async {
        let transport = NewLexiconsFakeTransport(routes())
        let model = makeModel(transport)
        model.window = .oneDay
        XCTAssertTrue(transport.urls.isEmpty)

        await model.load().value
        XCTAssertEqual(transport.urls, ["https://aturi.to/api/lexicons/new?window=1d"])
        XCTAssertEqual(model.visible?.map(\.nsid), ["app.day1.thing", "app.day2.thing", "app.day3.thing", "app.day4.thing"])
        XCTAssertFalse(model.showsToggle)
    }

    func testAWindowChangeRefetchesBehindTheRowsAlreadyUp() async {
        let transport = NewLexiconsFakeTransport(routes())
        let model = makeModel(transport)
        await model.load().value

        model.window = .oneDay
        XCTAssertTrue(model.isRefreshing)
        XCTAssertEqual(model.visible?.first?.nsid, "app.new1.thing", "the week's rows stay up meanwhile")

        await model.awaitPending()
        XCTAssertFalse(model.isRefreshing)
        XCTAssertEqual(model.visible?.first?.nsid, "app.day1.thing")
        XCTAssertEqual(transport.urls.count, 2)
    }

    func testAFailedWindowIsAnError() async {
        let model = makeModel(NewLexiconsFakeTransport(routes()))
        await model.load().value

        model.window = .thirtyDays
        await model.awaitPending()

        XCTAssertEqual(model.errorMessage, "Couldn\u{2019}t load new lexicons: \(AtmospherePulseModel.newUnavailableMessage)")
        XCTAssertNil(model.visible)
        XCTAssertNil(model.note)
        XCTAssertFalse(model.isRefreshing)
    }

    func testNothingNewIsAnEmptyList() async {
        let model = makeModel(NewLexiconsFakeTransport([
            ("aturi.to/api/lexicons/new", .init(status: 200, body: Self.body(count: 0))),
        ]))
        await model.load().value
        XCTAssertEqual(model.visible, [])
        XCTAssertFalse(model.showsToggle)
        XCTAssertEqual(NewLexiconsModel.emptyMessage, "Nothing new with 3+ accounts in this window.")
    }

    func testTheSectionCopy() {
        XCTAssertEqual(NewLexiconsModel.title, "New lexicons")
        XCTAssertEqual(NewLexiconsModel.subtitle, "First seen in this window, by 3+ accounts.")
        XCTAssertEqual(NewLexiconsModel.resultCount, 10)
        XCTAssertEqual(NewLexiconsModel.expandedCount, 25)
    }
}
