import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport for the calendar's reads: the first route
/// whose fragment appears in the URL answers, with headers when it gives
/// any; everything else is a 404.
final class ActivityFakeTransport: HTTPTransport, @unchecked Sendable {
    typealias Responder = @Sendable (URLRequest) -> (Int, String, [String: String])

    private let lock = NSLock()
    private let routes: [(pattern: String, respond: Responder)]
    private var recorded: [String] = []

    init(_ routes: [(String, Responder)]) {
        self.routes = routes.map { (pattern: $0.0, respond: $0.1) }
    }

    static func reply(_ status: Int, _ body: String, headers: [String: String] = [:]) -> Responder {
        { _ in (status, body, headers) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        record(url.absoluteString)
        let route = routes.first { url.absoluteString.contains($0.pattern) }
        let answer = route?.respond(request) ?? (404, #"{"error":"NotFound"}"#, [:])
        let response = HTTPURLResponse(url: url, statusCode: answer.0, httpVersion: "HTTP/1.1", headerFields: answer.2)!
        return (Data(answer.1.utf8), response)
    }

    private func record(_ url: String) {
        lock.lock(); defer { lock.unlock() }
        recorded.append(url)
    }

    var urls: [String] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }

    func count(containing fragment: String) -> Int {
        urls.filter { $0.contains(fragment) }.count
    }
}

/// One account on `pds.example` with three collections: posts that run
/// back past the window, a profile at `self`, and likes the test chooses.
enum ActivityFixture {
    static let did = "did:plc:activitycalendartestabcd"
    /// Thursday 12 November 2026, 15:00 in New York.
    static var now: Date { activityLocal(2026, 11, 12, 15) }

    static let document = ##"{"id":"did:plc:activitycalendartestabcd","alsoKnownAs":["at://alice.test"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}"##

    static func describe(_ collections: [String]) -> String {
        let names = collections.map { "\"\($0)\"" }.joined(separator: ",")
        return #"{"did":"\#(did)","handle":"alice.test","collections":[\#(names)]}"#
    }

    static func record(_ collection: String, _ rkey: String, createdAt: String? = nil) -> String {
        let value = createdAt.map { #"{"createdAt":"\#($0)"}"# } ?? "{}"
        return #"{"uri":"at://\#(did)/\#(collection)/\#(rkey)","cid":"c","value":\#(value)}"#
    }

    static func page(_ records: [String], cursor: String? = nil) -> String {
        let joined = records.joined(separator: ",")
        if let cursor {
            return #"{"records":[\#(joined)],"cursor":"\#(cursor)"}"#
        }
        return #"{"records":[\#(joined)]}"#
    }

    static let postsRoute = "collection=app.bsky.feed.post"
    static let profileRoute = "collection=app.bsky.actor.profile"
    static let likesRoute = "collection=app.bsky.feed.like"

    /// Two posts this week and one from before the window, which ends the read.
    static var posts: String {
        page([
            record("app.bsky.feed.post", activityTid(2026, 11, 12, 9)),
            record("app.bsky.feed.post", activityTid(2026, 11, 10, 9)),
            record("app.bsky.feed.post", activityTid(2025, 6, 1)),
        ], cursor: "more-posts")
    }

    static var profile: String {
        page([record("app.bsky.actor.profile", "self", createdAt: "2026-08-02T15:00:00.000Z")])
    }

    static func transport(
        collections: [String] = ["app.bsky.feed.post", "app.bsky.actor.profile", "app.bsky.feed.like"],
        likes: ActivityFakeTransport.Responder = ActivityFakeTransport.reply(200, #"{"records":[]}"#),
        overrides: [(String, ActivityFakeTransport.Responder)] = []
    ) -> ActivityFakeTransport {
        ActivityFakeTransport(overrides + [
            ("plc.directory/\(did)", ActivityFakeTransport.reply(200, document)),
            ("com.atproto.repo.describeRepo", ActivityFakeTransport.reply(200, describe(collections))),
            (postsRoute, ActivityFakeTransport.reply(200, posts)),
            (profileRoute, ActivityFakeTransport.reply(200, profile)),
            (likesRoute, likes),
        ])
    }
}

@MainActor
final class ActivityCalendarScanTests: XCTestCase {
    private func scan(
        _ transport: ActivityFakeTransport,
        store: ActivityCalendarStore,
        stopper: ActivityCalendarStopper = ActivityCalendarStopper(),
        published: ((ActivityCalendarScan.Snapshot) -> Void)? = nil
    ) async throws -> ActivityCalendarScan.Snapshot {
        let http = HTTPClient(transport: transport)
        return try await ActivityCalendarScan.scan(
            actor: ActivityFixture.did,
            http: http,
            resolver: IdentityResolver(http: http),
            store: store,
            stopper: stopper,
            now: ActivityFixture.now,
            calendar: activityNewYork
        ) { snapshot in
            published?(snapshot)
        }
    }

    private func collection(_ snapshot: ActivityCalendarScan.Snapshot, _ name: String) -> ActivityCalendar.CollectionScan? {
        snapshot.collections.first { $0.collection == name }
    }

    func testEveryCollectionIsReadNewestFirstAndAQuietOneCostsOneRequest() async throws {
        let transport = ActivityFixture.transport()
        var published: [ActivityCalendarScan.Snapshot] = []
        let result = try await scan(transport, store: ActivityCalendarStore()) { published.append($0) }

        XCTAssertEqual(result.did, ActivityFixture.did)
        XCTAssertEqual(result.handle, "alice.test")
        XCTAssertEqual(result.pds, "https://pds.example")
        XCTAssertEqual(result.phase, .done)
        XCTAssertNil(result.endedBy)
        XCTAssertEqual(result.collections.map { $0.collection }, ["app.bsky.feed.post", "app.bsky.actor.profile", "app.bsky.feed.like"])
        XCTAssertTrue(result.collections.allSatisfy { $0.state == .done })

        // The old post ends the read even though the page has a cursor.
        let posts = collection(result, "app.bsky.feed.post")
        XCTAssertEqual(posts?.days, ["2026-11-12": 1, "2026-11-10": 1])
        XCTAssertNil(posts?.cursor)
        XCTAssertEqual(transport.count(containing: ActivityFixture.postsRoute), 1)
        // A key with no time falls back to createdAt.
        XCTAssertEqual(collection(result, "app.bsky.actor.profile")?.days, ["2026-08-02": 1])
        XCTAssertEqual(result.pagesThisRun, 3)

        // listRecords is asked newest first, a full page at a time.
        let postsURL = transport.urls.first { $0.contains(ActivityFixture.postsRoute) } ?? ""
        XCTAssertTrue(postsURL.contains("limit=100"))
        XCTAssertFalse(postsURL.contains("reverse"))

        // The calendar fills in as it loads: a snapshot before any page, and
        // one after every page.
        XCTAssertGreaterThanOrEqual(published.count, 4)
        XCTAssertTrue(published.first?.collections.allSatisfy { $0.state == .waiting } ?? false)
        XCTAssertEqual(published.first?.phase, .reading)

        let summary = ActivityCalendar.summarize(ActivityCalendar.sumDays(result.collections), window: result.window)
        XCTAssertEqual(summary.total, 3)
    }

    func testACollectionLongerThanTheBudgetIsPartialAndReadingAgainResumesAtItsCursor() async throws {
        // Every page of likes is inside the window and has another after it.
        let likes: ActivityFakeTransport.Responder = { request in
            let url = request.url?.absoluteString ?? ""
            let n = url.components(separatedBy: "cursor=p").dropFirst().first.flatMap { Int($0) } ?? 0
            let body = ActivityFixture.page(
                [ActivityFixture.record("app.bsky.feed.like", activityTid(2026, 11, 1))],
                cursor: "p\(n + 1)"
            )
            return (200, body, [:])
        }
        let transport = ActivityFixture.transport(likes: likes)
        let store = ActivityCalendarStore()
        let first = try await scan(transport, store: store)

        XCTAssertEqual(first.phase, .partial)
        XCTAssertEqual(first.endedBy, .budget)
        let likesScan = collection(first, "app.bsky.feed.like")
        XCTAssertEqual(likesScan?.state, .partial)
        XCTAssertEqual(likesScan?.pages, ActivityCalendarScan.pagesPerCollection)
        XCTAssertEqual(likesScan?.counted, ActivityCalendarScan.pagesPerCollection)
        XCTAssertEqual(likesScan?.cursor, "p\(ActivityCalendarScan.pagesPerCollection)")
        XCTAssertEqual(transport.count(containing: ActivityFixture.likesRoute), ActivityCalendarScan.pagesPerCollection)

        // A second run asks only the collection left short, from where it stopped.
        let second = try await scan(transport, store: store)
        XCTAssertEqual(transport.count(containing: ActivityFixture.postsRoute), 1, "a finished collection is never read again")
        XCTAssertTrue(transport.urls.contains { $0.contains(ActivityFixture.likesRoute) && $0.contains("cursor=p50") })
        XCTAssertEqual(collection(second, "app.bsky.feed.like")?.pages, 2 * ActivityCalendarScan.pagesPerCollection)
        XCTAssertEqual(collection(second, "app.bsky.feed.like")?.counted, 2 * ActivityCalendarScan.pagesPerCollection)
        XCTAssertEqual(second.pagesThisRun, ActivityCalendarScan.pagesPerCollection)
    }

    func testStopEndsTheRunAndKeepsWhatItHas() async throws {
        let transport = ActivityFixture.transport()
        let stopper = ActivityCalendarStopper()
        stopper.stop()
        let result = try await scan(transport, store: ActivityCalendarStore(), stopper: stopper)
        XCTAssertEqual(result.phase, .partial)
        XCTAssertEqual(result.endedBy, .stop)
        XCTAssertTrue(result.collections.allSatisfy { $0.state == .partial && $0.pages == 0 })
        XCTAssertEqual(transport.count(containing: "com.atproto.repo.listRecords"), 0)
    }

    func testACollectionThatFailsIsRecordedOnItsOwnRowAndTheRestCarryOn() async throws {
        let transport = ActivityFixture.transport(likes: ActivityFakeTransport.reply(500, #"{"error":"InternalServerError"}"#))
        let result = try await scan(transport, store: ActivityCalendarStore())
        XCTAssertEqual(result.phase, .done)
        let likes = collection(result, "app.bsky.feed.like")
        XCTAssertEqual(likes?.state, .failed)
        XCTAssertEqual(likes?.error, "the PDS answered HTTP 500")
        XCTAssertEqual(collection(result, "app.bsky.feed.post")?.state, .done)
    }

    func testAPageTooLargeForTheCapIsAskedForAgainSmaller() async throws {
        let likes: ActivityFakeTransport.Responder = { request in
            let url = request.url?.absoluteString ?? ""
            if url.contains("limit=100") {
                return (200, "{}", ["Content-Length": "3000000"])
            }
            return (200, ActivityFixture.page([ActivityFixture.record("app.bsky.feed.like", activityTid(2026, 11, 3))]), [:])
        }
        let transport = ActivityFixture.transport(likes: likes)
        let result = try await scan(transport, store: ActivityCalendarStore())
        XCTAssertEqual(collection(result, "app.bsky.feed.like")?.days, ["2026-11-03": 1])
        XCTAssertTrue(transport.urls.contains { $0.contains(ActivityFixture.likesRoute) && $0.contains("limit=25") })
        // Both requests count against the budget.
        XCTAssertEqual(result.pagesThisRun, 4)
    }

    func testAnAccountThatCannotBeFoundOrListedThrows() async {
        let missing = ActivityFixture.transport(overrides: [
            ("plc.directory/\(ActivityFixture.did)", ActivityFakeTransport.reply(404, #"{"message":"DID not registered"}"#)),
        ])
        do {
            _ = try await scan(missing, store: ActivityCalendarStore())
            XCTFail("an account that does not resolve has no year to read")
        } catch {
            XCTAssertEqual(
                AccountCheckError.describe(error),
                "\(ActivityFixture.did) could not be resolved. Check the spelling, or try its DID."
            )
        }
    }

    func testTheModelKeepsTheCalendarWhileReadingFurtherBack() async throws {
        let transport = ActivityFixture.transport()
        let model = ActivityCalendarModel(
            http: HTTPClient(transport: transport),
            clock: { ActivityFixture.now },
            calendar: activityNewYork
        )
        XCTAssertEqual(model.status, .idle)
        model.load(ActivityFixture.did)
        XCTAssertEqual(model.status, .loading)
        await model.waitForRun()
        XCTAssertEqual(model.status, .done)
        XCTAssertEqual(model.scan?.phase, .done)

        // The same account again sends nothing.
        let requests = transport.urls.count
        model.load(ActivityFixture.did)
        XCTAssertEqual(transport.urls.count, requests)

        // Reading again keeps what is on screen until the new run publishes.
        model.rerun()
        XCTAssertEqual(model.status, .loading)
        XCTAssertNotNil(model.scan)
        await model.waitForRun()
        XCTAssertEqual(model.status, .done)
        XCTAssertEqual(transport.count(containing: "com.atproto.repo.listRecords"), 3, "every collection was finished the first time")
    }
}
