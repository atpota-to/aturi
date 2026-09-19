import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport; first matching route wins, the rest 404.
private final class CollectionRoutedTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var delayNanoseconds: UInt64 = 0
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, reply: Reply)]
    private(set) var requests: [URLRequest] = []

    init(_ routes: [(String, Reply)]) {
        self.routes = routes.map { (pattern: $0.0, reply: $0.1) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        let url = request.url!
        let reply = routes.first { url.absoluteString.contains($0.pattern) }?.reply
            ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
        if reply.delayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: reply.delayNanoseconds)
        }
        let response = HTTPURLResponse(
            url: url, statusCode: reply.status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (Data(reply.body.utf8), response)
    }

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

/// Records whether the live subscription was closed.
private final class LiveCloseFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var flag = false

    var closed: Bool {
        lock.lock(); defer { lock.unlock() }
        return flag
    }

    func set() {
        lock.lock(); defer { lock.unlock() }
        flag = true
    }
}

@MainActor
final class CollectionModelTests: XCTestCase {
    private nonisolated static let did = "did:plc:collectiontestacct001"
    private nonisolated static let handle = "alice.example"
    private nonisolated static let pds = "https://pds.example"
    private nonisolated static let collection = "app.bsky.feed.post"

    private func makeTid(_ date: Date) -> String {
        let micros = UInt64(date.timeIntervalSince1970 * 1_000_000)
        var value = (micros << 10) | 0x1F
        let alphabet = Array(TID.alphabet)
        var chars: [Character] = []
        for _ in 0..<13 {
            chars.append(alphabet[Int(value & 0x1F)])
            value >>= 5
        }
        return String(chars.reversed())
    }

    private func recordsBody(_ range: Range<Int>, cursor: String? = nil, text: String = "post") -> String {
        let records = range.map { i in
            #"{"uri":"at://\#(Self.did)/\#(Self.collection)/rkey\#(i)","cid":"bafy\#(i)","value":{"$type":"\#(Self.collection)","text":"\#(text) \#(i)"}}"#
        }.joined(separator: ",")
        let cursorField = cursor.map { #","cursor":"\#($0)""# } ?? ""
        return #"{"records":[\#(records)]\#(cursorField)}"#
    }

    private func identityRoutes() -> [(String, CollectionRoutedTransport.Reply)] {
        [
            ("plc.directory/\(Self.did)", .init(status: 200, body: """
                {"id":"\(Self.did)","alsoKnownAs":["at://\(Self.handle)"],\
                "service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"\(Self.pds)"}]}
                """)),
            ("com.atproto.repo.describeRepo", .init(status: 200, body: #"{"handle":"\#(Self.handle)","did":"\#(Self.did)","collections":["app.bsky.feed.post"]}"#)),
        ]
    }

    private func makeModel(_ transport: CollectionRoutedTransport, repo: String = CollectionModelTests.did, liveSource: CollectionLiveSource? = nil) -> CollectionModel {
        CollectionModel(
            repo: repo,
            collection: Self.collection,
            http: HTTPClient(transport: transport),
            liveSource: liveSource ?? CollectionLiveSource { _ in (AsyncStream { $0.finish() }, {}) }
        )
    }

    private func waitUntil(_ condition: @escaping @MainActor () -> Bool, timeout: TimeInterval = 2) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
        return condition()
    }

    // MARK: formatCount

    func testFormatCountMatchesTheCompactFormatter() async {
        XCTAssertEqual(CollectionModel.formatCount(0), "0")
        XCTAssertEqual(CollectionModel.formatCount(999), "999")
        XCTAssertEqual(CollectionModel.formatCount(1000), "1k")
        XCTAssertEqual(CollectionModel.formatCount(1400), "1.4k")
        XCTAssertEqual(CollectionModel.formatCount(1250), "1.3k")
        XCTAssertEqual(CollectionModel.formatCount(12_300), "12.3k")
        XCTAssertEqual(CollectionModel.formatCount(123_456), "123.5k")
        XCTAssertEqual(CollectionModel.formatCount(999_950), "1m")
        XCTAssertEqual(CollectionModel.formatCount(1_000_000), "1m")
        XCTAssertEqual(CollectionModel.formatCount(2_500_000), "2.5m")
        XCTAssertEqual(CollectionModel.formatCount(1_000_000_000), "1b")
        XCTAssertEqual(CollectionModel.formatCount(3_200_000_000_000), "3.2t")
    }

    // MARK: CollectionRow

    func testRowDerivesRkeyDateAndPreview() async {
        let date = Date(timeIntervalSince1970: 1_709_294_400)
        let tid = makeTid(date)
        let record = AtRecord(uri: "at://\(Self.did)/\(Self.collection)/\(tid)", cid: "bafy", value: ["text": "Hello Mushrooms", "$type": "app.bsky.feed.post"])
        let row = CollectionRow(record: record)
        XCTAssertEqual(row.id, record.uri)
        XCTAssertEqual(row.rkey, tid)
        XCTAssertEqual(row.tidDate, TID.date(from: tid))
        XCTAssertEqual(row.relativeTime(now: date.addingTimeInterval(3 * 3600)), "3h ago")
        XCTAssertTrue(row.isoTimestamp?.hasPrefix("2024-03-01T12:00:00") ?? false)
        XCTAssertEqual(row.preview, "Hello Mushrooms")
        XCTAssertTrue(row.searchText.hasPrefix(tid.lowercased() + "\n"))
        XCTAssertTrue(row.searchText.contains("hello mushrooms"))
        XCTAssertEqual(row.explorePath(repoSegment: "alice.example", collection: Self.collection), "/explore/alice.example/app.bsky.feed.post/\(tid)")

        let singleton = CollectionRow(record: AtRecord(uri: "at://\(Self.did)/app.bsky.actor.profile/self", cid: "", value: ["displayName": "Alice"]))
        XCTAssertEqual(singleton.rkey, "self")
        XCTAssertNil(singleton.tidDate)
        XCTAssertNil(singleton.relativeTime())
        XCTAssertEqual(singleton.preview, "Alice")

        let odd = CollectionRow(record: AtRecord(uri: "at://\(Self.did)/a.b.c/with space", cid: "", value: .null))
        XCTAssertEqual(odd.explorePath(repoSegment: "r", collection: "a.b.c"), "/explore/r/a.b.c/with%20space")
        XCTAssertEqual(odd.preview, "")
    }

    // MARK: Pagination

    func testFirstPageThenLoadMoreUntilAPartialPage() async {
        var routes = identityRoutes()
        routes.append(("cursor=c1", .init(status: 200, body: recordsBody(100..<140))))
        routes.append(("com.atproto.repo.listRecords", .init(status: 200, body: recordsBody(0..<100, cursor: "c1"))))
        let transport = CollectionRoutedTransport(routes)
        let model = makeModel(transport)

        XCTAssertEqual(model.countLabel, "Loading…")
        XCTAssertNil(model.searchStatusLabel)
        await model.load().value

        XCTAssertEqual(model.identity.value?.handle, Self.handle)
        XCTAssertEqual(model.records.count, 100)
        XCTAssertEqual(model.rows.count, 100)
        XCTAssertEqual(model.cursor, "c1")
        XCTAssertFalse(model.done)
        XCTAssertTrue(model.canLoadMore)
        XCTAssertFalse(model.awaitingFirstPage)
        XCTAssertFalse(model.isEmpty)
        XCTAssertEqual(model.countLabel, "100 records")
        XCTAssertEqual(model.searchStatusLabel, "100+")
        XCTAssertEqual(model.repoSegment, "alice.example")
        XCTAssertEqual(model.sharePath, "/explore/alice.example/app.bsky.feed.post")

        let first = transport.urls.first { $0.contains("listRecords") }!
        XCTAssertTrue(first.contains("limit=100"))
        XCTAssertFalse(first.contains("cursor="))
        XCTAssertFalse(first.contains("reverse="))

        await model.loadMore()?.value
        XCTAssertEqual(model.records.count, 140)
        XCTAssertEqual(model.rows.last?.rkey, "rkey139")
        XCTAssertTrue(model.done, "a partial page ends pagination")
        XCTAssertFalse(model.canLoadMore)
        XCTAssertEqual(model.countLabel, "140 records")
        XCTAssertEqual(model.searchStatusLabel, "140")
        XCTAssertNil(model.loadMore(), "nothing more to fetch")
        XCTAssertEqual(transport.count(containing: "listRecords"), 2)
        XCTAssertTrue(transport.urls.last!.contains("cursor=c1"))
    }

    func testAPartialPageWithACursorStillEndsPagination() async {
        var routes = identityRoutes()
        routes.append(("com.atproto.repo.listRecords", .init(status: 200, body: recordsBody(0..<5, cursor: "more"))))
        let model = makeModel(CollectionRoutedTransport(routes))
        await model.load().value
        XCTAssertEqual(model.records.count, 5)
        XCTAssertEqual(model.cursor, "more")
        XCTAssertTrue(model.done)
        XCTAssertNil(model.loadMore())
    }

    func testFullPageWithoutACursorEndsPagination() async {
        var routes = identityRoutes()
        routes.append(("com.atproto.repo.listRecords", .init(status: 200, body: recordsBody(0..<100, cursor: ""))))
        let model = makeModel(CollectionRoutedTransport(routes))
        await model.load().value
        XCTAssertEqual(model.records.count, 100)
        XCTAssertNil(model.cursor, "an empty cursor reads as none")
        XCTAssertTrue(model.done)
    }

    func testEmptyCollectionIsOnlyClaimedOnceExhausted() async {
        var routes = identityRoutes()
        routes.append(("com.atproto.repo.listRecords", .init(status: 200, body: #"{"records":[]}"#)))
        let model = makeModel(CollectionRoutedTransport(routes))
        XCTAssertTrue(model.awaitingFirstPage)
        XCTAssertFalse(model.isEmpty)
        await model.load().value
        XCTAssertTrue(model.done)
        XCTAssertTrue(model.isEmpty)
        XCTAssertFalse(model.awaitingFirstPage)
        XCTAssertEqual(model.countLabel, "0 records")
        XCTAssertNil(model.singleRecordRkey)
    }

    func testSingleRecordCollectionOffersTheRecordKey() async {
        var routes = identityRoutes()
        routes.append(("com.atproto.repo.listRecords", .init(status: 200, body: recordsBody(7..<8))))
        let model = makeModel(CollectionRoutedTransport(routes))
        await model.load().value
        XCTAssertEqual(model.singleRecordRkey, "rkey7")
        XCTAssertEqual(model.countLabel, "1 record")
        model.startLive()
        XCTAssertNil(model.singleRecordRkey, "not while streaming")
        model.stopLive()
        XCTAssertEqual(model.singleRecordRkey, "rkey7")
    }

    func testReverseRefetchesFromTheStartInTheOtherOrder() async {
        var routes = identityRoutes()
        routes.append(("reverse=true", .init(status: 200, body: recordsBody(0..<3, text: "oldest"))))
        routes.append(("com.atproto.repo.listRecords", .init(status: 200, body: recordsBody(0..<100, cursor: "c1"))))
        let transport = CollectionRoutedTransport(routes)
        let model = makeModel(transport)
        await model.load().value
        model.filter = "oldest"
        XCTAssertEqual(model.records.count, 100)

        XCTAssertNil(model.setReverse(false), "no change, no refetch")
        await model.setReverse(true)?.value
        XCTAssertTrue(model.reverse)
        XCTAssertEqual(model.records.count, 3)
        XCTAssertTrue(model.done)
        XCTAssertNil(model.cursor)
        XCTAssertEqual(model.filter, "oldest", "the search survives a reorder")
        XCTAssertEqual(model.visibleRows.count, 3)
        XCTAssertTrue(transport.urls.last!.contains("reverse=true"))
        XCTAssertFalse(transport.urls.last!.contains("cursor="))

        await model.setReverse(false)?.value
        XCTAssertEqual(model.records.count, 100)
        XCTAssertEqual(model.cursor, "c1")
    }

    func testReverseBeforeIdentityResolvesAppliesToTheFirstPage() async {
        var routes = identityRoutes()
        routes.append(("reverse=true", .init(status: 200, body: recordsBody(0..<2))))
        routes.append(("com.atproto.repo.listRecords", .init(status: 500, body: "wrong order")))
        let model = makeModel(CollectionRoutedTransport(routes))
        XCTAssertNil(model.setReverse(true))
        await model.load().value
        XCTAssertEqual(model.records.count, 2)
        XCTAssertNil(model.pageError)
    }

    // MARK: Search

    func testFilterSearchesRkeyAndBody() async {
        var routes = identityRoutes()
        routes.append(("com.atproto.repo.listRecords", .init(status: 200, body: """
            {"records":[\
            {"uri":"at://\(Self.did)/\(Self.collection)/aaa","cid":"1","value":{"text":"Hello Mushrooms"}},\
            {"uri":"at://\(Self.did)/\(Self.collection)/bbb","cid":"2","value":{"text":"Plain"}},\
            {"uri":"at://\(Self.did)/\(Self.collection)/ccc","cid":"3","value":{"embed":{"external":{"uri":"https://mushroom.example/"}}}}\
            ],"cursor":"c1"}
            """)))
        let model = makeModel(CollectionRoutedTransport(routes))
        await model.load().value
        XCTAssertTrue(model.done, "three rows with a cursor is still a partial page")
        XCTAssertEqual(model.records.count, 3)

        model.filter = " MUSHROOM "
        XCTAssertEqual(model.visibleRows.map(\.rkey), ["aaa", "ccc"], "matches a value and a nested URL")
        XCTAssertEqual(model.countLabel, "2 of 3")
        XCTAssertEqual(model.searchStatusLabel, "2/3")
        XCTAssertNil(model.noMatchMessage)

        model.filter = "BBB"
        XCTAssertEqual(model.visibleRows.map(\.rkey), ["bbb"], "matches the rkey")

        model.filter = "zzz"
        XCTAssertTrue(model.visibleRows.isEmpty)
        XCTAssertEqual(model.noMatchMessage, "No loaded records match zzz.")
        XCTAssertEqual(model.countLabel, "0 of 3")
    }

    func testNoMatchMessageMentionsRemainingPages() async {
        var routes = identityRoutes()
        routes.append(("com.atproto.repo.listRecords", .init(status: 200, body: recordsBody(0..<100, cursor: "c1"))))
        let model = makeModel(CollectionRoutedTransport(routes))
        await model.load().value
        model.filter = "zzz"
        XCTAssertEqual(model.noMatchMessage, "No loaded records match zzz. Fetch more to search further.")
        XCTAssertEqual(model.searchStatusLabel, "0/100")
    }

    // MARK: Errors

    func testUnresolvableRepoProducesTheNotFoundCopy() async {
        let transport = CollectionRoutedTransport([
            ("com.atproto.identity.resolveHandle", .init(status: 400, body: #"{"error":"InvalidRequest"}"#)),
        ])
        let model = makeModel(transport, repo: "nobody.example")
        await model.load().value
        XCTAssertEqual(model.identity.errorMessage, "Could not resolve nobody.example")
        XCTAssertEqual(
            model.notFoundMessage,
            "We tried to resolve \"nobody.example\" and the AT Protocol resolver returned: Could not resolve nobody.example. Try another handle, DID, or AT URI below."
        )
        XCTAssertEqual(model.repoSegment, "nobody.example")
        XCTAssertTrue(model.records.isEmpty)
        XCTAssertNil(model.loadMore())
        XCTAssertEqual(transport.count(containing: "listRecords"), 0)
    }

    func testPageErrorIsSurfacedAndRetryable() async {
        var routes = identityRoutes()
        routes.append(("com.atproto.repo.listRecords", .init(status: 500, body: "boom")))
        let transport = CollectionRoutedTransport(routes)
        let model = makeModel(transport)
        await model.load().value
        XCTAssertNotNil(model.identity.value)
        XCTAssertTrue(model.pageError?.hasPrefix("HTTP 500 for https://pds.example/xrpc/com.atproto.repo.listRecords") ?? false)
        XCTAssertTrue(model.pageError?.hasSuffix(":: boom") ?? false)
        XCTAssertFalse(model.awaitingFirstPage)
        XCTAssertFalse(model.isEmpty)
        XCTAssertFalse(model.done)
        XCTAssertFalse(model.isLoadingPage)

        // loadMore with no cursor retries the first page.
        await model.loadMore()?.value
        XCTAssertEqual(transport.count(containing: "listRecords"), 2)
        XCTAssertNotNil(model.pageError)
    }

    // MARK: Live mode

    func testLiveCommitsArePrependedDedupedAndCapped() async {
        var routes = identityRoutes()
        routes.append(("com.atproto.repo.listRecords", .init(status: 200, body: recordsBody(0..<2))))
        let (stream, continuation) = AsyncStream<JetstreamCommit>.makeStream()
        let closed = LiveCloseFlag()
        let source = CollectionLiveSource { options in
            XCTAssertEqual(options.wantedCollections, [CollectionModelTests.collection])
            XCTAssertEqual(options.wantedDids, [CollectionModelTests.did])
            return (stream, { closed.set() })
        }
        let model = makeModel(CollectionRoutedTransport(routes), liveSource: source)
        await model.load().value
        XCTAssertEqual(model.records.count, 2)

        model.startLive()
        XCTAssertTrue(model.isLive)
        model.startLive()

        func commit(_ rkey: String, did: String = CollectionModelTests.did, collection: String = CollectionModelTests.collection) -> JetstreamCommit {
            JetstreamCommit(did: did, timeUs: 1, commit: .init(operation: .create, collection: collection, rkey: rkey, record: .object(["text": .string("live \(rkey)")]), cid: "bafylive"))
        }
        continuation.yield(commit("fresh"))
        continuation.yield(commit("rkey0"))
        continuation.yield(commit("other", collection: "app.bsky.feed.like"))
        continuation.yield(commit("elsewhere", did: "did:plc:someoneelse00000000001"))
        continuation.yield(commit("second"))

        let arrived = await waitUntil { model.records.count == 4 }
        XCTAssertTrue(arrived)
        XCTAssertEqual(model.rows.map(\.rkey), ["second", "fresh", "rkey0", "rkey1"])
        XCTAssertEqual(model.rows[0].preview, "live second")
        XCTAssertEqual(model.rows[0].cid, "bafylive")

        for i in 0..<300 {
            model.insertLive(commit("bulk\(i)"))
        }
        XCTAssertEqual(model.records.count, CollectionModel.liveWindow)
        XCTAssertEqual(model.rows.first?.rkey, "bulk299")

        model.toggleLive()
        XCTAssertFalse(model.isLive)
        XCTAssertTrue(closed.closed)
        continuation.finish()
    }

    func testInsertLiveNeedsAnIdentity() async {
        let model = makeModel(CollectionRoutedTransport([]))
        model.insertLive(JetstreamCommit(did: Self.did, timeUs: 1, commit: .init(operation: .create, collection: Self.collection, rkey: "x")))
        XCTAssertTrue(model.records.isEmpty)
        model.startLive()
        XCTAssertFalse(model.isLive)
    }

    // MARK: Cancellation

    func testLoadResetsAndSupersedesAnInFlightLoad() async {
        var routes = identityRoutes()
        routes[0].1.delayNanoseconds = 40_000_000
        routes.append(("com.atproto.repo.listRecords", .init(status: 200, body: recordsBody(0..<3))))
        let model = makeModel(CollectionRoutedTransport(routes))
        let first = model.load()
        model.filter = "stale"
        let second = model.load()
        XCTAssertTrue(first.isCancelled)
        XCTAssertEqual(model.filter, "")
        await second.value
        await first.value
        XCTAssertEqual(model.records.count, 3)
        XCTAssertTrue(model.done)
    }

    func testCancelKeepsTheLoadingState() async {
        var routes = identityRoutes()
        routes[0].1.delayNanoseconds = 40_000_000
        routes.append(("com.atproto.repo.listRecords", .init(status: 200, body: recordsBody(0..<3))))
        let model = makeModel(CollectionRoutedTransport(routes))
        let task = model.load()
        model.cancel()
        await task.value
        XCTAssertTrue(model.identity.isLoading)
        XCTAssertTrue(model.records.isEmpty)
        XCTAssertFalse(model.isLoadingPage)
    }
}
