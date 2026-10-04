import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport that also gates describeRepo requests: while
/// the gate is closed they wait, and the number waiting at once is
/// recorded, which is how the lookup cap is observed.
private final class PDSRoutedTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var delayNanoseconds: UInt64 = 0
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, reply: Reply)]
    private(set) var requests: [URLRequest] = []
    private var gateOpen = true
    private var inFlightLookups = 0
    private(set) var maxInFlightLookups = 0

    init(_ routes: [(String, Reply)], gated: Bool = false) {
        self.routes = routes.map { (pattern: $0.0, reply: $0.1) }
        gateOpen = !gated
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        let url = request.url!
        let isLookup = url.absoluteString.contains("describeRepo")
        if isLookup {
            enterLookup()
            defer { leaveLookup() }
            while !isGateOpen {
                try await Task.sleep(nanoseconds: 2_000_000)
            }
            return try await answer(url)
        }
        return try await answer(url)
    }

    private func answer(_ url: URL) async throws -> (Data, HTTPURLResponse) {
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

    private func enterLookup() {
        lock.lock(); defer { lock.unlock() }
        inFlightLookups += 1
        maxInFlightLookups = max(maxInFlightLookups, inFlightLookups)
    }

    private func leaveLookup() {
        lock.lock(); defer { lock.unlock() }
        inFlightLookups -= 1
    }

    var inFlight: Int {
        lock.lock(); defer { lock.unlock() }
        return inFlightLookups
    }

    private var isGateOpen: Bool {
        lock.lock(); defer { lock.unlock() }
        return gateOpen
    }

    func openGate() {
        lock.lock(); defer { lock.unlock() }
        gateOpen = true
    }

    var urls: [String] {
        lock.lock(); defer { lock.unlock() }
        return requests.compactMap { $0.url?.absoluteString }
    }

    func count(containing fragment: String) -> Int {
        urls.filter { $0.contains(fragment) }.count
    }

    /// The DIDs describeRepo was asked about, in request order.
    var lookupOrder: [String] {
        urls.compactMap { url in
            guard let range = url.range(of: "describeRepo?repo=") else { return nil }
            return String(url[range.upperBound...]).removingPercentEncoding
        }
    }
}

@MainActor
final class PDSModelTests: XCTestCase {
    private nonisolated static let host = "pds.example"
    private nonisolated static let headDate = Date(timeIntervalSince1970: 1_709_294_400)

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

    private func did(_ i: Int) -> String { "did:plc:pdsrepotest000000\(i)" }
    private func handle(_ i: Int) -> String { "user\(i).example" }

    private func reposBody(_ range: Range<Int>, cursor: String? = nil) -> String {
        let repos = range.map { i -> String in
            let status = i == 2 ? #","active":false,"status":"takendown""# : #","active":true"#
            return #"{"did":"\#(did(i))","head":"bafyhead\#(i)","rev":"\#(makeTid(Self.headDate.addingTimeInterval(Double(-i) * 3600)))"\#(status)}"#
        }.joined(separator: ",")
        let cursorField = cursor.map { #""cursor":"\#($0)","# } ?? ""
        return #"{\#(cursorField)"repos":[\#(repos)]}"#
    }

    private func lookupRoutes(_ range: Range<Int>, delay: (Int) -> UInt64 = { _ in 0 }) -> [(String, PDSRoutedTransport.Reply)] {
        range.map { i in
            (
                "describeRepo?repo=\(URIEncoding.encodeComponent(did(i)))",
                PDSRoutedTransport.Reply(
                    status: 200,
                    body: #"{"handle":"\#(handle(i))","did":"\#(did(i))","collections":[]}"#,
                    delayNanoseconds: delay(i)
                )
            )
        }
    }

    private func serverRoutes() -> [(String, PDSRoutedTransport.Reply)] {
        [
            ("com.atproto.server.describeServer", .init(status: 200, body: """
                {"did":"did:web:pds.example","availableUserDomains":[".pds.example"],"inviteCodeRequired":true,\
                "links":{"privacyPolicy":"https://pds.example/privacy"},"contact":{"email":"admin@pds.example"}}
                """)),
            ("xrpc/_health", .init(status: 200, body: #"{"version":"0.4.1"}"#)),
        ]
    }

    private func makeModel(_ transport: PDSRoutedTransport, host: String = PDSModelTests.host) -> PDSModel {
        PDSModel(host: host, http: HTTPClient(transport: transport))
    }

    private func waitUntil(_ condition: @escaping () -> Bool, timeout: TimeInterval = 2) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
        return condition()
    }

    // MARK: Rows

    func testRepoRowLabelsStatusAndRevDate() async {
        let tid = makeTid(Self.headDate)
        let entry = PDSServer.RepoEntry(did: did(1), head: "bafy", rev: tid, active: true)
        var row = PDSRepoRow(entry: entry)
        XCTAssertEqual(row.id, did(1))
        XCTAssertEqual(row.label, shortDid(did(1)))
        XCTAssertEqual(row.secondaryLabel, "")
        XCTAssertEqual(row.revDate, TID.date(from: tid))
        XCTAssertEqual(row.updatedLabel(now: Self.headDate.addingTimeInterval(90)), "updated 1m ago")
        XCTAssertTrue(row.revTitle?.hasPrefix("rev \(tid) · 2024-03-01T12:00:00") ?? false)
        XCTAssertFalse(row.showStatus)
        XCTAssertNil(row.statusLabel)
        XCTAssertNil(row.statusBadge)
        XCTAssertEqual(row.explorePath, "/explore/\(did(1))")

        row.handle = "user1.example"
        XCTAssertEqual(row.label, "@user1.example")
        XCTAssertEqual(row.secondaryLabel, did(1))
        XCTAssertEqual(row.explorePath, "/explore/user1.example")

        let inactive = PDSRepoRow(entry: PDSServer.RepoEntry(did: did(2), active: false))
        XCTAssertTrue(inactive.showStatus)
        XCTAssertEqual(inactive.statusBadge, "inactive")
        XCTAssertNil(inactive.revDate)
        XCTAssertNil(inactive.updatedLabel())

        let takendown = PDSRepoRow(entry: PDSServer.RepoEntry(did: did(3), rev: "self", active: false, status: "takendown"))
        XCTAssertEqual(takendown.statusBadge, "takendown")
        XCTAssertNil(takendown.revDate, "a non-TID rev has no date")

        let activeLabel = PDSRepoRow(entry: PDSServer.RepoEntry(did: did(4), active: true, status: "active"))
        XCTAssertFalse(activeLabel.showStatus)
        XCTAssertNil(activeLabel.statusBadge)
        XCTAssertEqual(activeLabel.statusLabel, "active")
    }

    // MARK: Loading

    func testLoadFetchesServerHealthAndTheFirstPageThenHydratesHandles() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<6, cursor: "c1"))))
        // Later DIDs answer first, so completion order is the reverse of page order.
        routes.append(contentsOf: lookupRoutes(0..<6) { UInt64(6 - $0) * 4_000_000 })
        let transport = PDSRoutedTransport(routes)
        let model = makeModel(transport)
        XCTAssertEqual(model.pdsBase, "https://pds.example")
        XCTAssertEqual(model.sharePath, "/explore/pds/pds.example")
        XCTAssertNil(model.searchStatusLabel)
        XCTAssertEqual(model.loadedLabel, "0+ loaded")

        await model.load().value

        XCTAssertEqual(model.server.value?.did, "did:web:pds.example")
        XCTAssertEqual(model.server.value?.availableUserDomains, [".pds.example"])
        XCTAssertEqual(model.server.value?.inviteCodeRequired, true)
        XCTAssertEqual(model.server.value?.links?.privacyPolicy, "https://pds.example/privacy")
        XCTAssertEqual(model.server.value?.contact?.email, "admin@pds.example")
        XCTAssertEqual(model.version, "0.4.1")
        XCTAssertNil(model.serverErrorMessage)

        XCTAssertEqual(model.repos.count, 6)
        XCTAssertEqual(model.cursor, "c1")
        XCTAssertFalse(model.done)
        XCTAssertTrue(model.canLoadMore)
        XCTAssertFalse(model.showsSkeleton)
        XCTAssertNil(model.emptyMessage)
        XCTAssertEqual(model.loadedLabel, "6+ loaded")
        XCTAssertEqual(model.searchStatusLabel, "6+")
        XCTAssertEqual(model.rows.map(\.did), (0..<6).map(did), "page order is kept while handles are pending")
        XCTAssertEqual(model.rows[2].statusBadge, "takendown")

        await model.finishHandleLookups()
        XCTAssertEqual(model.handles.count, 6)
        for i in 0..<6 {
            XCTAssertEqual(model.rows[i].handle, handle(i), "row \(i) got its own handle despite out-of-order answers")
            XCTAssertEqual(model.rows[i].explorePath, "/explore/\(handle(i))")
        }
        XCTAssertEqual(model.rows.map(\.did), (0..<6).map(did))
        XCTAssertEqual(transport.count(containing: "describeRepo"), 6)
        XCTAssertLessThanOrEqual(transport.maxInFlightLookups, PDSModel.handleLookupConcurrency)
        let first = transport.urls.first { $0.contains("listRepos") }!
        XCTAssertTrue(first.contains("limit=50"))
        XCTAssertFalse(first.contains("cursor="))
    }

    func testHandleLookupsAreCappedAndHandedOutInPageOrder() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<7))))
        routes.append(contentsOf: lookupRoutes(0..<7))
        let transport = PDSRoutedTransport(routes, gated: true)
        let model = makeModel(transport)
        await model.load().value
        XCTAssertTrue(model.done)

        let filled = await waitUntil { transport.inFlight == PDSModel.handleLookupConcurrency }
        XCTAssertTrue(filled, "the cap's worth of lookups start at once")
        try? await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertEqual(transport.inFlight, PDSModel.handleLookupConcurrency, "no fifth lookup starts while the gate holds four")
        XCTAssertEqual(Set(transport.lookupOrder), Set((0..<4).map(did)), "the first slots go to the first rows")
        XCTAssertTrue(model.handles.isEmpty)

        transport.openGate()
        await model.finishHandleLookups()
        XCTAssertEqual(model.handles.count, 7)
        XCTAssertEqual(transport.maxInFlightLookups, PDSModel.handleLookupConcurrency)
        XCTAssertEqual(transport.lookupOrder.count, 7)
        XCTAssertEqual(Set(transport.lookupOrder[4...]), Set((4..<7).map(did)), "freed slots go to the queued DIDs")
    }

    func testLoadMoreAppendsAndOnlyHydratesNewRows() async {
        var routes = serverRoutes()
        routes.append(("cursor=c1", .init(status: 200, body: reposBody(6..<8))))
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<6, cursor: "c1"))))
        routes.append(contentsOf: lookupRoutes(0..<8))
        let transport = PDSRoutedTransport(routes)
        let model = makeModel(transport)
        await model.load().value
        await model.finishHandleLookups()
        XCTAssertEqual(transport.count(containing: "describeRepo"), 6)

        await model.loadMore()?.value
        XCTAssertEqual(model.repos.count, 8)
        XCTAssertEqual(model.rows.map(\.did), (0..<8).map(did))
        XCTAssertTrue(model.done, "no cursor on the last page")
        XCTAssertNil(model.cursor)
        XCTAssertFalse(model.canLoadMore)
        XCTAssertNil(model.loadMore())
        XCTAssertTrue(transport.urls.contains { $0.contains("listRepos") && $0.contains("cursor=c1") })

        await model.finishHandleLookups()
        XCTAssertEqual(model.handles.count, 8)
        XCTAssertEqual(transport.count(containing: "describeRepo"), 8, "already-resolved rows are not looked up again")
        XCTAssertEqual(model.loadedLabel, "8 loaded")
        XCTAssertEqual(model.searchStatusLabel, "8")
    }

    func testLoadMoreWhileAPageIsInFlightIsANoOp() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<3, cursor: "c1"), delayNanoseconds: 30_000_000)))
        let model = makeModel(PDSRoutedTransport(routes))
        let task = model.load()
        XCTAssertTrue(model.isLoadingRepos)
        XCTAssertTrue(model.showsSkeleton)
        XCTAssertNil(model.loadMore())
        await task.value
        XCTAssertEqual(model.repos.count, 3)
    }

    func testAnEmptyBatchWithACursorEndsPagination() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: #"{"cursor":"c1","repos":[]}"#)))
        let model = makeModel(PDSRoutedTransport(routes))
        await model.load().value
        XCTAssertTrue(model.done)
        XCTAssertEqual(model.emptyMessage, "No repos reported by this PDS.")
        XCTAssertNil(model.noMatchMessage)
        XCTAssertFalse(model.canLoadMore)
        XCTAssertEqual(model.loadedLabel, "0 loaded")
    }

    // MARK: Search

    func testFilterMatchesDidsAndResolvedHandles() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<6, cursor: "c1"))))
        routes.append(contentsOf: lookupRoutes(0..<6))
        let transport = PDSRoutedTransport(routes, gated: true)
        let model = makeModel(transport)
        await model.load().value

        model.filter = " USER3 "
        XCTAssertTrue(model.visibleRows.isEmpty, "handles are not searchable before they resolve")
        XCTAssertEqual(model.noMatchMessage, "No loaded repos match USER3. Load more to search further.")
        XCTAssertEqual(model.loadedLabel, "0 of 6 shown")
        XCTAssertEqual(model.searchStatusLabel, "0/6")

        transport.openGate()
        await model.finishHandleLookups()
        XCTAssertEqual(model.visibleRows.map(\.did), [did(3)])
        XCTAssertNil(model.noMatchMessage)
        XCTAssertEqual(model.loadedLabel, "1 of 6 shown")
        XCTAssertEqual(model.searchStatusLabel, "1/6")

        model.filter = "PDSREPOTEST0000005"
        XCTAssertEqual(model.visibleRows.map(\.did), [did(5)])

        model.filter = ""
        XCTAssertEqual(model.visibleRows.count, 6)
    }

    // MARK: Degraded servers

    func testMissingHealthEndpointLeavesTheVersionOff() async {
        var routes = serverRoutes()
        routes.removeAll { $0.0.contains("_health") }
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<1))))
        let model = makeModel(PDSRoutedTransport(routes))
        await model.load().value
        XCTAssertNotNil(model.server.value)
        XCTAssertNil(model.health)
        XCTAssertNil(model.version)
        XCTAssertEqual(model.repos.count, 1)
    }

    func testDescribeServerFailureExplainsItselfAndReposStillLoad() async {
        var routes = serverRoutes()
        routes.removeAll { $0.0.contains("describeServer") }
        routes.append(("com.atproto.server.describeServer", .init(status: 500, body: "down")))
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<2))))
        let model = makeModel(PDSRoutedTransport(routes))
        await model.load().value
        XCTAssertTrue(model.server.errorMessage?.hasPrefix("HTTP 500 for https://pds.example/xrpc/com.atproto.server.describeServer") ?? false)
        XCTAssertEqual(
            model.serverErrorMessage,
            "Couldn’t reach https://pds.example/xrpc/com.atproto.server.describeServer. The PDS may not implement that endpoint, or it’s temporarily unavailable."
        )
        XCTAssertEqual(model.version, "0.4.1")
        XCTAssertEqual(model.repos.count, 2)
        XCTAssertTrue(model.done)
    }

    func testListReposFailureIsAnErrorNotAnEmptyState() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 502, body: "bad gateway")))
        let model = makeModel(PDSRoutedTransport(routes))
        await model.load().value
        XCTAssertTrue(model.reposError?.hasPrefix("HTTP 502 for https://pds.example/xrpc/com.atproto.sync.listRepos") ?? false)
        XCTAssertNil(model.emptyMessage)
        XCTAssertFalse(model.showsSkeleton)
        XCTAssertFalse(model.done)
        XCTAssertTrue(model.repos.isEmpty)
        XCTAssertNil(model.searchStatusLabel)
    }

    func testAHostThatIsNotAHostFailsBeforeAnyRequest() async {
        let transport = PDSRoutedTransport([])
        let model = makeModel(transport, host: "not a host")
        await model.load().value
        XCTAssertEqual(model.server.errorMessage, "Not a valid PDS host: https://not a host")
        XCTAssertEqual(model.reposError, "Not a valid PDS host: https://not a host")
        XCTAssertTrue(transport.requests.isEmpty)
        XCTAssertEqual(model.sharePath, "/explore/pds/not%20a%20host")
    }

    // MARK: Reload and cancel

    func testLoadAgainClearsTheFilterAndHandles() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<2))))
        routes.append(contentsOf: lookupRoutes(0..<2))
        let transport = PDSRoutedTransport(routes)
        let model = makeModel(transport)
        await model.load().value
        await model.finishHandleLookups()
        model.filter = "user"
        XCTAssertEqual(model.handles.count, 2)

        let reload = model.load()
        XCTAssertEqual(model.filter, "")
        XCTAssertTrue(model.handles.isEmpty)
        XCTAssertTrue(model.server.isLoading)
        await reload.value
        await model.finishHandleLookups()
        XCTAssertEqual(model.handles.count, 2)
        XCTAssertEqual(transport.count(containing: "describeRepo"), 4)
    }

    func testCancelStopsPendingHandleLookups() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<7))))
        routes.append(contentsOf: lookupRoutes(0..<7))
        let transport = PDSRoutedTransport(routes, gated: true)
        let model = makeModel(transport)
        await model.load().value
        let filled = await waitUntil { transport.inFlight == PDSModel.handleLookupConcurrency }
        XCTAssertTrue(filled)

        model.cancel()
        transport.openGate()
        await model.finishHandleLookups()
        try? await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertTrue(model.handles.isEmpty, "answers to cancelled lookups are dropped")
        XCTAssertEqual(transport.count(containing: "describeRepo"), 4, "the queued three never start")
        XCTAssertEqual(model.repos.count, 7, "the page itself stays")
    }
}
