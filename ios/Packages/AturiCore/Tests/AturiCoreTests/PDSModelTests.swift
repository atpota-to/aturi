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

    /// One listRepos entry: a rev `daysAgo` before the head date (or the
    /// given non-TID rev), and its standing.
    private func repoJSON(_ i: Int, daysAgo: Double?, rev: String? = nil, active: Bool = true, status: String? = nil) -> String {
        let revValue = rev ?? daysAgo.map { makeTid(Self.headDate.addingTimeInterval(-$0 * 86_400)) } ?? ""
        let statusField = status.map { #","status":"\#($0)""# } ?? ""
        return #"{"did":"\#(did(i))","head":"bafyhead\#(i)","rev":"\#(revValue)","active":\#(active)\#(statusField)}"#
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

    /// The server's reads, and an AppView that knows the `profiles` given
    /// (none by default, so every name comes from the host).
    private func serverRoutes(profiles: [String] = []) -> [(String, PDSRoutedTransport.Reply)] {
        [
            ("com.atproto.server.describeServer", .init(status: 200, body: """
                {"did":"did:web:pds.example","availableUserDomains":[".pds.example"],"inviteCodeRequired":true,\
                "links":{"privacyPolicy":"https://pds.example/privacy"},"contact":{"email":"admin@pds.example"}}
                """)),
            ("xrpc/_health", .init(status: 200, body: #"{"version":"0.4.1"}"#)),
            ("app.bsky.actor.getProfiles", .init(status: 200, body: #"{"profiles":[\#(profiles.joined(separator: ","))]}"#)),
        ]
    }

    private func makeModel(
        _ transport: PDSRoutedTransport,
        host: String = PDSModelTests.host,
        now: Date? = nil
    ) -> PDSModel {
        guard let now else {
            return PDSModel(host: host, http: HTTPClient(transport: transport))
        }
        return PDSModel(host: host, http: HTTPClient(transport: transport), clock: { now })
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
        XCTAssertEqual(row.initial, "")
        XCTAssertEqual(row.revDate, TID.date(from: tid))
        XCTAssertEqual(row.updatedLabel(now: Self.headDate.addingTimeInterval(90)), "updated 1m ago")
        XCTAssertEqual(row.commitLabel(now: Self.headDate.addingTimeInterval(90)), "1m ago")
        XCTAssertTrue(row.commitTitle.hasPrefix("Last commit 2024-03-01T12:00:00"))
        XCTAssertTrue(row.commitTitle.hasSuffix(" · rev \(tid)"))
        XCTAssertTrue(row.revTitle?.hasPrefix("rev \(tid) · 2024-03-01T12:00:00") ?? false)
        XCTAssertFalse(row.isDormant(now: Self.headDate.addingTimeInterval(90)))
        XCTAssertTrue(row.isDormant(now: Self.headDate.addingTimeInterval(400 * 86_400)))
        XCTAssertEqual(row.standing, "active")
        XCTAssertEqual(row.standingLabel, "Active")
        XCTAssertEqual(row.standingTone, .good)
        XCTAssertFalse(row.showStatus)
        XCTAssertNil(row.statusLabel)
        XCTAssertNil(row.statusBadge)
        XCTAssertEqual(row.explorePath, "/explore/\(did(1))")

        row.handle = "user1.example"
        XCTAssertEqual(row.label, "@user1.example")
        XCTAssertEqual(row.secondaryLabel, did(1))
        XCTAssertEqual(row.initial, "U")
        XCTAssertEqual(row.explorePath, "/explore/user1.example")

        let inactive = PDSRepoRow(entry: PDSServer.RepoEntry(did: did(2), active: false))
        XCTAssertEqual(inactive.standing, "inactive")
        XCTAssertTrue(inactive.showStatus)
        XCTAssertEqual(inactive.statusBadge, "inactive")
        XCTAssertNil(inactive.revDate)
        XCTAssertNil(inactive.updatedLabel())
        XCTAssertNil(inactive.commitLabel())
        XCTAssertEqual(inactive.commitTitle, "No commit listed")

        let takendown = PDSRepoRow(entry: PDSServer.RepoEntry(did: did(3), rev: "self", active: false, status: "takendown"))
        XCTAssertEqual(takendown.statusBadge, "takendown")
        XCTAssertEqual(takendown.standingLabel, "Taken down")
        XCTAssertEqual(takendown.standingTone, .bad)
        XCTAssertNil(takendown.revDate, "a non-TID rev has no date")
        XCTAssertEqual(takendown.commitTitle, "rev self isn’t a timestamp")

        let activeLabel = PDSRepoRow(entry: PDSServer.RepoEntry(did: did(4), active: true, status: "active"))
        XCTAssertFalse(activeLabel.showStatus)
        XCTAssertNil(activeLabel.statusBadge)
        XCTAssertEqual(activeLabel.statusLabel, "active")

        let named = PDSRepoRow(entry: entry, index: 3, handle: "alice.example", displayName: "Alice", nameSettled: true)
        XCTAssertTrue(named.matches("alice"))
        XCTAssertTrue(named.matches("pdsrepotest"))
        XCTAssertFalse(named.matches("bob"))
        XCTAssertEqual(named.sortable, PDSExplorer.SortableAccount(index: 3, standing: "active", date: TID.date(from: tid), handle: "alice.example"))
    }

    func testAnAppViewProfileIsReadWithItsBlanksDropped() {
        let profile = BskyProfile(json: ["did": "did:plc:x", "handle": "handle.invalid", "displayName": "  Alice  ", "avatar": ""])
        XCTAssertNotNil(profile)
        guard let profile else { return }
        let name = PDSAccountName(profile: profile)
        XCTAssertNil(name.handle, "handle.invalid is no handle")
        XCTAssertEqual(name.displayName, "Alice")
        XCTAssertNil(name.avatar)
        XCTAssertNil(PDSAccountName.usable(""))
        XCTAssertEqual(PDSAccountName.usable("alice.example"), "alice.example")
    }

    // MARK: Loading

    func testLoadFetchesServerHealthAndTheFirstPageThenHydratesHandles() async {
        var routes = serverRoutes()
        // The first page is short, so the one after it is asked for too;
        // that one is short as well but isn't followed again.
        routes.append(("cursor=c1", .init(status: 200, body: reposBody(6..<8, cursor: "c2"))))
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<6, cursor: "c1"))))
        // Later DIDs answer first, so completion order is the reverse of page order.
        routes.append(contentsOf: lookupRoutes(0..<8) { UInt64(8 - $0) * 4_000_000 })
        let transport = PDSRoutedTransport(routes)
        let model = makeModel(transport)
        XCTAssertEqual(model.pdsBase, "https://pds.example")
        XCTAssertEqual(model.hostname, "pds.example")
        XCTAssertEqual(model.sharePath, "/explore/pds/pds.example")
        XCTAssertNil(model.searchStatusLabel)
        XCTAssertEqual(model.loadedLabel, "", "no count before anything is listed")

        await model.load().value

        XCTAssertEqual(model.server.value?.did, "did:web:pds.example")
        XCTAssertEqual(model.server.value?.availableUserDomains, [".pds.example"])
        XCTAssertEqual(model.server.value?.inviteCodeRequired, true)
        XCTAssertEqual(model.server.value?.links?.privacyPolicy, "https://pds.example/privacy")
        XCTAssertEqual(model.server.value?.contact?.email, "admin@pds.example")
        XCTAssertEqual(model.version, "0.4.1")
        XCTAssertNil(model.serverErrorMessage)
        XCTAssertNil(model.authServers, "a PDS that says nothing of OAuth")
        XCTAssertTrue(model.signIn.isEmpty)

        XCTAssertEqual(model.repos.count, 8)
        XCTAssertEqual(model.cursor, "c2")
        XCTAssertFalse(model.done)
        XCTAssertFalse(model.isLoadingRepos)
        XCTAssertTrue(model.canLoadMore)
        XCTAssertFalse(model.showsSkeleton)
        XCTAssertNil(model.emptyMessage)
        XCTAssertFalse(model.firstPageFailed)
        XCTAssertEqual(model.loadedLabel, "8+ listed")
        XCTAssertEqual(model.footerLabel, "8 listed, more on the host")
        XCTAssertEqual(model.searchStatusLabel, "8")
        XCTAssertEqual(model.rows.map(\.did), (0..<8).map(did), "page order is kept while names are pending")
        XCTAssertEqual(model.rows.map(\.index), Array(0..<8))
        XCTAssertEqual(model.rows[2].statusBadge, "takendown")

        await model.finishHandleLookups()
        XCTAssertEqual(model.handles.count, 8)
        for i in 0..<8 {
            XCTAssertEqual(model.rows[i].handle, handle(i), "row \(i) got its own handle despite out-of-order answers")
            XCTAssertEqual(model.rows[i].explorePath, "/explore/\(handle(i))")
            XCTAssertTrue(model.rows[i].nameSettled)
        }
        XCTAssertEqual(model.rows.map(\.did), (0..<8).map(did))
        XCTAssertEqual(transport.count(containing: "app.bsky.actor.getProfiles"), 2, "one round a page")
        XCTAssertEqual(transport.count(containing: "describeRepo"), 8)
        XCTAssertLessThanOrEqual(transport.maxInFlightLookups, PDSModel.handleLookupConcurrency)
        let pages = transport.urls.filter { $0.contains("listRepos") }
        XCTAssertEqual(pages.count, 2, "a short page is followed once, not again")
        XCTAssertTrue(pages[0].contains("limit=1000"))
        XCTAssertFalse(pages[0].contains("cursor="))
        XCTAssertTrue(pages[1].contains("cursor=c1"))
    }

    func testHandleLookupsAreCappedAndHandedOutInPageOrder() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<7))))
        routes.append(contentsOf: lookupRoutes(0..<7))
        let transport = PDSRoutedTransport(routes, gated: true)
        let model = makeModel(transport)
        await model.load().value
        XCTAssertTrue(model.done)
        XCTAssertEqual(model.footerLabel, "All 7 listed")

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
        routes.append(("cursor=c1", .init(status: 200, body: reposBody(6..<8, cursor: "c2"))))
        routes.append(("cursor=c2", .init(status: 200, body: reposBody(8..<10))))
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<6, cursor: "c1"))))
        routes.append(contentsOf: lookupRoutes(0..<10))
        let transport = PDSRoutedTransport(routes)
        let model = makeModel(transport)
        await model.load().value
        await model.finishHandleLookups()
        XCTAssertEqual(model.cursor, "c2")
        XCTAssertEqual(transport.count(containing: "describeRepo"), 8)
        XCTAssertEqual(transport.count(containing: "app.bsky.actor.getProfiles"), 2)

        await model.loadMore()?.value
        XCTAssertEqual(model.repos.count, 10)
        XCTAssertEqual(model.rows.map(\.did), (0..<10).map(did))
        XCTAssertEqual(model.rows.map(\.index), Array(0..<10))
        XCTAssertTrue(model.done, "no cursor on the last page")
        XCTAssertNil(model.cursor)
        XCTAssertFalse(model.canLoadMore)
        XCTAssertNil(model.loadMore())
        XCTAssertTrue(transport.urls.contains { $0.contains("listRepos") && $0.contains("cursor=c2") })

        await model.finishHandleLookups()
        XCTAssertEqual(model.handles.count, 10)
        XCTAssertEqual(transport.count(containing: "describeRepo"), 10, "already-resolved rows are not looked up again")
        XCTAssertEqual(transport.count(containing: "app.bsky.actor.getProfiles"), 3, "the AppView is asked only about the new page")
        XCTAssertEqual(model.loadedLabel, "10 listed")
        XCTAssertEqual(model.searchStatusLabel, "10")
    }

    func testOverlappingPagesListAnAccountOnceAndAStuckCursorEndsPaging() async {
        var routes = serverRoutes()
        routes.append(("cursor=c1", .init(status: 200, body: reposBody(2..<5, cursor: "c1"))))
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<3, cursor: "c1"))))
        let transport = PDSRoutedTransport(routes)
        let model = makeModel(transport)
        // The short first page is followed by the overlapping one.
        await model.load().value
        XCTAssertEqual(model.repos.map(\.did), (0..<5).map(did))
        XCTAssertEqual(model.rows.map(\.index), Array(0..<5))
        XCTAssertTrue(model.done, "a cursor that does not move would page forever")
        XCTAssertFalse(model.canLoadMore)
        XCTAssertNil(model.loadMore())
        XCTAssertEqual(transport.count(containing: "listRepos"), 2)
    }

    func testLoadMoreWhileAPageIsInFlightIsANoOp() async {
        var routes = serverRoutes()
        routes.append(("cursor=c1", .init(status: 200, body: reposBody(3..<5, cursor: "c2"), delayNanoseconds: 100_000_000)))
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<3, cursor: "c1"), delayNanoseconds: 30_000_000)))
        let model = makeModel(PDSRoutedTransport(routes))
        let task = model.load()
        XCTAssertTrue(model.isLoadingRepos)
        XCTAssertTrue(model.showsSkeleton)
        XCTAssertNil(model.loadMore())

        // The short first page is in and the page after it is on its way.
        let firstIn = await waitUntil { model.repos.count == 3 }
        XCTAssertTrue(firstIn)
        XCTAssertTrue(model.isLoadingRepos, "still loading between a short page and the one after it")
        XCTAssertFalse(model.showsSkeleton)
        XCTAssertNil(model.loadMore())

        await task.value
        XCTAssertEqual(model.repos.count, 5)
        XCTAssertFalse(model.isLoadingRepos)
        XCTAssertTrue(model.canLoadMore)
    }

    func testAnEmptyBatchWithACursorEndsPagination() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: #"{"cursor":"c1","repos":[]}"#)))
        let model = makeModel(PDSRoutedTransport(routes))
        await model.load().value
        XCTAssertTrue(model.done)
        XCTAssertEqual(model.emptyMessage, "No accounts reported by this PDS.")
        XCTAssertNil(model.noMatchMessage)
        XCTAssertFalse(model.canLoadMore)
        XCTAssertEqual(model.loadedLabel, "")
    }

    // MARK: Names

    func testNamesComeFromTheAppViewAndTheHostFillsInTheRest() async {
        let profiles = [
            #"{"did":"\#(did(0))","handle":"zero.example","displayName":"User Zero","avatar":"https://cdn.example/0.jpg"}"#,
            #"{"did":"\#(did(1))","handle":"handle.invalid","displayName":"  Someone  "}"#,
        ]
        var routes = serverRoutes(profiles: profiles)
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<3))))
        routes.append(contentsOf: lookupRoutes(0..<3))
        let transport = PDSRoutedTransport(routes)
        let model = makeModel(transport)
        await model.load().value
        await model.finishHandleLookups()

        let rows = model.rows
        XCTAssertEqual(rows[0].handle, "zero.example", "the AppView's handle comes first")
        XCTAssertEqual(rows[0].displayName, "User Zero")
        XCTAssertEqual(rows[0].avatar, "https://cdn.example/0.jpg")
        XCTAssertEqual(rows[1].handle, handle(1), "an unusable AppView handle is asked of the host")
        XCTAssertEqual(rows[1].displayName, "Someone")
        XCTAssertNil(rows[1].avatar)
        XCTAssertEqual(rows[2].handle, handle(2), "an account the AppView doesn't know is asked of the host")
        XCTAssertNil(rows[2].displayName)
        XCTAssertEqual(model.name(for: did(2)), PDSAccountName(handle: handle(2)))
        XCTAssertNil(model.name(for: "did:plc:notlisted"))
        XCTAssertEqual(Set(transport.lookupOrder), [did(1), did(2)])
        XCTAssertEqual(transport.count(containing: "app.bsky.actor.getProfiles"), 1)

        model.filter = "SOMEONE"
        XCTAssertEqual(model.visibleRows.map(\.did), [did(1)], "found by display name")
        model.filter = "zero.ex"
        XCTAssertEqual(model.visibleRows.map(\.did), [did(0)], "found by handle")
    }

    func testAFailedAppViewRoundLeavesNamesUnknownAndAsksTheHostNothing() async {
        var routes = serverRoutes()
        routes.removeAll { $0.0.contains("getProfiles") }
        routes.append(("app.bsky.actor.getProfiles", .init(status: 500, body: "down")))
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<3))))
        routes.append(contentsOf: lookupRoutes(0..<3))
        let transport = PDSRoutedTransport(routes)
        let model = makeModel(transport)
        await model.load().value
        await model.finishHandleLookups()
        XCTAssertTrue(model.handles.isEmpty)
        XCTAssertFalse(model.rows.contains { $0.nameSettled })
        XCTAssertEqual(transport.count(containing: "describeRepo"), 0)

        // A new order tries the AppView again.
        model.setOrder(.handle, desc: false)
        await model.finishHandleLookups()
        XCTAssertEqual(transport.count(containing: "app.bsky.actor.getProfiles"), 2)
    }

    // MARK: Search

    func testFilterMatchesDidsAndResolvedHandles() async {
        var routes = serverRoutes()
        routes.append(("cursor=c1", .init(status: 200, body: reposBody(6..<8, cursor: "c2"))))
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<6, cursor: "c1"))))
        routes.append(contentsOf: lookupRoutes(0..<8))
        let transport = PDSRoutedTransport(routes, gated: true)
        let model = makeModel(transport)
        await model.load().value
        // The AppView has answered and the host lookups are queued.
        let queued = await waitUntil { transport.inFlight == PDSModel.handleLookupConcurrency }
        XCTAssertTrue(queued)

        model.filter = " USER3 "
        XCTAssertTrue(model.visibleRows.isEmpty, "handles are not searchable before they resolve")
        XCTAssertEqual(model.noMatchMessage, "No listed account matches USER3. Load more to look further.")
        XCTAssertEqual(model.loadedLabel, "0 of 8 shown")
        XCTAssertEqual(model.searchStatusLabel, "0/8")

        transport.openGate()
        await model.finishHandleLookups()
        XCTAssertEqual(model.visibleRows.map(\.did), [did(3)])
        XCTAssertNil(model.noMatchMessage)
        XCTAssertEqual(model.loadedLabel, "1 of 8 shown")
        XCTAssertEqual(model.searchStatusLabel, "1/8")

        model.filter = "PDSREPOTEST0000005"
        XCTAssertEqual(model.visibleRows.map(\.did), [did(5)])

        model.filter = ""
        XCTAssertEqual(model.visibleRows.count, 8)
    }

    // MARK: Filters, counts and orders

    /// Five accounts: active a half-day, twenty days and (no readable rev)
    /// ago, one deactivated three days ago and one taken down 500 days ago.
    private func mixedListing() -> String {
        let repos = [
            repoJSON(0, daysAgo: 0.5),
            repoJSON(1, daysAgo: 20),
            repoJSON(2, daysAgo: 3, active: false, status: "deactivated"),
            repoJSON(3, daysAgo: 500, active: false, status: "takendown"),
            repoJSON(4, daysAgo: nil, rev: "self"),
        ]
        return #"{"repos":[\#(repos.joined(separator: ","))]}"#
    }

    func testStatusAndCommitFiltersCountAsFacets() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: mixedListing())))
        let model = makeModel(PDSRoutedTransport(routes), now: Self.headDate)
        await model.load().value

        var facets = model.facets
        XCTAssertEqual(model.statusChoices(facets).map(\.value), ["all", "active", "inactive", "deactivated", "takendown"])
        XCTAssertEqual(model.statusChoices(facets).map(\.count), [5, 3, 2, 1, 1])
        XCTAssertEqual(model.statusChoices(facets).map(\.label), ["All accounts", "Active", "Inactive", "Deactivated", "Taken down"])
        XCTAssertEqual(model.commitChoices(facets).map(\.count), [5, 1, 2, 3, 3, 1])
        XCTAssertEqual(model.commitChoices(facets).first?.label, "Any time")
        XCTAssertEqual(model.statusTitle, "All")
        XCTAssertEqual(model.commitTitle, "Any time")

        model.status = "inactive"
        XCTAssertEqual(model.listing.ordered.map(\.did), [did(2), did(3)])
        XCTAssertEqual(model.loadedLabel, "2 of 5 shown")
        XCTAssertEqual(model.sharePath, "/explore/pds/pds.example?status=inactive")
        XCTAssertEqual(model.statusTitle, "Inactive")
        facets = model.facets
        XCTAssertEqual(model.commitChoices(facets).map(\.count), [2, 0, 1, 1, 1, 1], "the commit counts honour the status")
        XCTAssertEqual(model.statusChoices(facets).first?.count, 5, "the status counts don't honour their own choice")

        model.status = "all"
        model.commit = .month
        XCTAssertEqual(model.listing.ordered.map(\.did), [did(0), did(1), did(2)])
        XCTAssertEqual(model.sharePath, "/explore/pds/pds.example?commit=30d")
        XCTAssertEqual(model.commitTitle, "Past 30 days")
        facets = model.facets
        XCTAssertEqual(model.statusChoices(facets).map(\.value), ["all", "active", "inactive", "deactivated"])
        XCTAssertEqual(model.statusChoices(facets).map(\.count), [3, 2, 1, 1])

        model.commit = nil
        model.status = "suspended"
        facets = model.facets
        XCTAssertEqual(model.statusChoices(facets).last, PDSStatusChoice(value: "suspended", label: "Suspended", count: 0, isStatus: true))
        XCTAssertTrue(model.listing.visible.isEmpty)
        XCTAssertEqual(model.noMatchMessage, "No listed account matches these filters.")
        model.filter = "nobody"
        XCTAssertEqual(model.noMatchMessage, "No listed account matches nobody with these filters.")
    }

    func testOrdersFollowTheWebAndTheAddressCarriesThem() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: mixedListing())))
        let model = makeModel(PDSRoutedTransport(routes), now: Self.headDate)
        await model.load().value
        XCTAssertEqual(model.sortTitle, "As listed")

        model.setOrder(.commit, desc: true)
        XCTAssertEqual(model.listing.ordered.map(\.did), [did(0), did(2), did(1), did(3), did(4)], "no readable commit goes last")
        XCTAssertEqual(model.sharePath, "/explore/pds/pds.example?sort=commit")
        XCTAssertEqual(model.sortTitle, "Newest commit")

        model.setOrder(PDSExplorer.SortChoice(sort: .commit, desc: false, label: "Oldest commit"))
        XCTAssertEqual(model.listing.ordered.map(\.did), [did(3), did(1), did(2), did(0), did(4)])
        XCTAssertEqual(model.sharePath, "/explore/pds/pds.example?sort=commit&dir=asc")

        model.setOrder(.status, desc: false)
        XCTAssertEqual(model.listing.ordered.map(\.did), [did(0), did(1), did(4), did(2), did(3)])

        model.setOrder(.listed, desc: true)
        XCTAssertEqual(model.listing.ordered.map(\.did), (0..<5).reversed().map(did))
        XCTAssertEqual(model.sharePath, "/explore/pds/pds.example?dir=desc")

        let rows = model.rows
        XCTAssertNil(rows[4].commitLabel(now: Self.headDate))
        XCTAssertTrue(rows[3].isDormant(now: Self.headDate))
        XCTAssertEqual(rows[2].standingLabel, "Deactivated")
        XCTAssertEqual(rows[2].standingTone, .warn)
    }

    // MARK: Drawing

    func testRowsAreDrawnAFewHundredAtATimeAndOnlyDrawnRowsAskTheHost() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<450))))
        routes.append(("describeRepo", .init(status: 200, body: #"{"did":"did:plc:x","collections":[]}"#)))
        let transport = PDSRoutedTransport(routes)
        let model = makeModel(transport)
        await model.load().value
        await model.finishHandleLookups()

        var listing = model.listing
        XCTAssertEqual(listing.total, 450)
        XCTAssertEqual(listing.drawn.count, PDSModel.drawStep)
        XCTAssertTrue(listing.hasMoreToDraw)
        XCTAssertEqual(listing.nextDraw(step: PDSModel.drawStep), 200)
        XCTAssertEqual(transport.count(containing: "app.bsky.actor.getProfiles"), 18, "450 accounts, 25 a request")
        XCTAssertEqual(transport.count(containing: "describeRepo"), 200, "the host is asked only about drawn rows")

        model.showMore()
        await model.finishHandleLookups()
        listing = model.listing
        XCTAssertEqual(listing.drawn.count, 400)
        XCTAssertEqual(listing.nextDraw(step: PDSModel.drawStep), 50)
        XCTAssertEqual(transport.count(containing: "describeRepo"), 400)

        model.showMore()
        await model.finishHandleLookups()
        listing = model.listing
        XCTAssertEqual(listing.drawn.count, 450)
        XCTAssertFalse(listing.hasMoreToDraw)
        XCTAssertEqual(transport.count(containing: "describeRepo"), 450)

        model.filter = "pdsrepotest"
        XCTAssertEqual(model.drawLimit, PDSModel.drawStep, "a new filter draws from the top again")
        await model.finishHandleLookups()
        XCTAssertEqual(transport.count(containing: "describeRepo"), 450, "an account is asked about once")
    }

    // MARK: The server and the relays

    func testSignInAndTheRelaysAreRead() async {
        var routes = serverRoutes()
        routes.append(("/.well-known/oauth-protected-resource", .init(status: 200, body: #"{"resource":"https://pds.example","authorization_servers":["https://entryway.example/",7,"ftp://nope"]}"#)))
        routes.append(("com.atproto.sync.getHostStatus", .init(status: 200, body: #"{"hostname":"pds.example","status":"active","accountCount":12,"seq":3400}"#)))
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<1))))
        let transport = PDSRoutedTransport(routes)
        let model = makeModel(transport)
        await model.load().value
        await model.relays.finish()

        XCTAssertEqual(model.authServers, ["https://entryway.example/"])
        XCTAssertEqual(model.signIn, [.through(host: "entryway.example")])
        XCTAssertEqual(model.relays.hostname, "pds.example")
        XCTAssertEqual(model.relays.results.count, RelayCheck.relays.count)
        XCTAssertFalse(model.relays.isLoading)
        XCTAssertTrue(model.relays.results.allSatisfy { $0.answer == .known(status: "active", accountCount: 12, seq: 3400) })
        XCTAssertEqual(model.relays.accountCount, 12)
        XCTAssertEqual(transport.count(containing: "getHostStatus?hostname=pds.example"), RelayCheck.relays.count)
        for relay in RelayCheck.relays {
            XCTAssertTrue(transport.urls.contains("https://\(relay.host)/xrpc/com.atproto.sync.getHostStatus?hostname=pds.example"), relay.host)
        }
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
        let transport = PDSRoutedTransport(routes)
        let model = makeModel(transport)
        await model.load().value
        XCTAssertTrue(model.server.errorMessage?.hasPrefix("HTTP 500 for https://pds.example/xrpc/com.atproto.server.describeServer") ?? false)
        XCTAssertEqual(
            model.serverErrorMessage,
            "Couldn’t reach https://pds.example/xrpc/com.atproto.server.describeServer. The PDS may not implement that endpoint, or it’s temporarily unavailable."
        )
        XCTAssertEqual(model.version, "0.4.1")
        XCTAssertEqual(model.repos.count, 2)
        XCTAssertTrue(model.done)
        XCTAssertTrue(model.relays.results.isEmpty, "a host that doesn't answer as a PDS isn't asked of the relays")
        XCTAssertEqual(transport.count(containing: "getHostStatus"), 0)
    }

    func testListReposFailureIsAnErrorNotAnEmptyState() async {
        var routes = serverRoutes()
        routes.append(("com.atproto.sync.listRepos", .init(status: 502, body: "bad gateway")))
        let model = makeModel(PDSRoutedTransport(routes))
        await model.load().value
        XCTAssertTrue(model.reposError?.hasPrefix("HTTP 502 for https://pds.example/xrpc/com.atproto.sync.listRepos") ?? false)
        XCTAssertTrue(model.firstPageFailed)
        XCTAssertEqual(
            model.firstPageFailedMessage,
            "Couldn’t list the accounts on this PDS. It may be offline, or it may not allow listing."
        )
        XCTAssertNil(model.emptyMessage)
        XCTAssertFalse(model.showsSkeleton)
        XCTAssertFalse(model.done)
        XCTAssertTrue(model.repos.isEmpty)
        XCTAssertNil(model.searchStatusLabel)
        XCTAssertEqual(model.loadedLabel, "")
    }

    func testALaterPageFailingKeepsTheListAndSaysSo() async {
        var routes = serverRoutes()
        routes.append(("cursor=c1", .init(status: 200, body: reposBody(2..<4, cursor: "c2"))))
        routes.append(("cursor=c2", .init(status: 502, body: "bad gateway")))
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<2, cursor: "c1"))))
        let model = makeModel(PDSRoutedTransport(routes))
        await model.load().value
        XCTAssertNil(model.reposError)
        XCTAssertEqual(model.footerLabel, "4 listed, more on the host")

        await model.loadMore()?.value
        XCTAssertEqual(model.repos.count, 4)
        XCTAssertFalse(model.firstPageFailed)
        XCTAssertTrue(model.canLoadMore, "the next page can be tried again")
        XCTAssertEqual(model.footerLabel, "4 listed, more on the host. The last page didn’t load.")
    }

    func testAShortPageWhoseNextPageIsEmptyListsEverything() async {
        var routes = serverRoutes()
        routes.append(("cursor=c1", .init(status: 200, body: #"{"repos":[]}"#)))
        routes.append(("com.atproto.sync.listRepos", .init(status: 200, body: reposBody(0..<3, cursor: "c1"))))
        let transport = PDSRoutedTransport(routes)
        let model = makeModel(transport)
        await model.load().value
        XCTAssertEqual(model.repos.count, 3)
        XCTAssertTrue(model.done, "the cursor led to nothing more")
        XCTAssertFalse(model.isLoadingRepos)
        XCTAssertFalse(model.canLoadMore)
        XCTAssertNil(model.loadMore())
        XCTAssertNil(model.emptyMessage)
        XCTAssertEqual(model.footerLabel, "All 3 listed")
        XCTAssertEqual(model.loadedLabel, "3 listed")
        XCTAssertEqual(transport.count(containing: "listRepos"), 2)
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
