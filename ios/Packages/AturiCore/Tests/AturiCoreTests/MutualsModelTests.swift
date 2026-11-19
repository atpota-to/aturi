import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport: a route matches when every one of its
/// fragments appears in the URL; the first match wins, the rest 404.
private final class MutualsFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var headers: [String: String] = [:]
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
        var headers = ["Content-Type": "application/json"]
        for (name, value) in reply.headers {
            headers[name] = value
        }
        let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: headers)!
        return (Data(reply.body.utf8), response)
    }

    private func route(for url: String) -> Reply {
        lock.lock()
        defer { lock.unlock() }
        recorded.append(url)
        return routes.first { $0.patterns.allSatisfy(url.contains) }?.reply
            ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
    }

    func count(containing fragment: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return recorded.filter { $0.contains(fragment) }.count
    }
}

/// The account, its mutuals Bob and Carl (Dana is followed but does not
/// follow back; Xavi follows but is not followed), and what they block.
private enum MutualsFixture {
    static let account = "did:plc:acct"
    static let bob = "did:plc:bobb"
    static let carl = "did:plc:carl"
    static let dana = "did:plc:dana"
    static let xavi = "did:plc:xavi"
    static let one = "did:plc:tone"
    static let two = "did:plc:ttwo"
    static let three = "did:plc:tthr"
    static let list = "at://did:plc:lmkr/app.bsky.graph.list/3kabc"

    static func encoded(_ did: String) -> String {
        did.replacingOccurrences(of: ":", with: "%3A")
    }

    static func profile(_ did: String, _ handle: String) -> String {
        #"{"did":"\#(did)","handle":"\#(handle)"}"#
    }

    static func records(_ collection: String, _ subjects: [String]) -> String {
        let items = subjects.enumerated().map { index, subject in
            #"{"uri":"at://x/\#(collection)/\#(index)","cid":"bafy","value":{"$type":"\#(collection)","subject":"\#(subject)","createdAt":"2026-01-01T00:00:00Z"}}"#
        }
        return #"{"records":[\#(items.joined(separator: ","))]}"#
    }

    static func listRecords(_ repo: String, _ collection: String) -> [String] {
        ["com.atproto.repo.listRecords", "repo=\(encoded(repo))", "collection=\(collection)&"]
    }

    typealias Route = ([String], MutualsFakeTransport.Reply)

    static func routes(profileStatus: Int = 200) -> [Route] {
        let block = Mutuals.blockCollection
        let listBlock = Mutuals.listBlockCollection
        return [
            (["getProfile?actor=\(encoded(account))"], .init(
                status: profileStatus,
                body: profileStatus == 200
                    ? #"{"did":"\#(account)","handle":"alice.example.com","followsCount":3,"followersCount":3}"#
                    : #"{"error":"InvalidRequest","message":"Profile not found"}"#
            )),
            (["app.bsky.graph.getFollows"], .init(status: 200, body: #"{"follows":[\#(profile(bob, "bob.example.com")),\#(profile(carl, "carl.example.com")),\#(profile(dana, "dana.example.com"))]}"#)),
            (["app.bsky.graph.getFollowers"], .init(status: 200, body: #"{"followers":[{"did":"\#(bob)"},{"did":"\#(carl)"},{"did":"\#(xavi)"}]}"#)),
            (["resolveMiniDoc"], .init(status: 200, body: #"{"did":"did:plc:any","pds":"https://pds.example.com"}"#)),
            (listRecords(bob, block), .init(status: 200, body: records(block, [one, two, account]))),
            (listRecords(carl, block), .init(status: 200, body: records(block, [one, three, one]))),
            (listRecords(account, block), .init(status: 200, body: records(block, [two]))),
            (listRecords(bob, listBlock), .init(status: 200, body: records(listBlock, [list]))),
            (listRecords(carl, listBlock), .init(status: 200, body: records(listBlock, [list, "not a list"]))),
            (listRecords(account, listBlock), .init(status: 200, body: #"{"records":[]}"#)),
            (["app.bsky.actor.getProfiles"], .init(status: 200, body: #"{"profiles":[\#(profile(one, "one.example.com")),\#(profile(two, "two.example.com"))]}"#)),
            (["app.bsky.graph.getList"], .init(status: 200, body: #"{"list":{"uri":"\#(list)","name":"Spam","listItemCount":40,"creator":\#(profile("did:plc:lmkr", "lists.example.com"))}}"#)),
        ]
    }
}

@MainActor
final class MutualsModelTests: XCTestCase {
    private typealias F = MutualsFixture

    private func makeModel(_ transport: MutualsFakeTransport, suite: String) -> MutualsModel {
        MutualsModel(
            client: MutualsClient(http: HTTPClient(transport: transport), sleep: { _ in }),
            throttle: WriteThrottle(defaults: UserDefaults(suiteName: suite)!),
            sleep: { _ in }
        )
    }

    private func newSuite() -> String {
        "aturi.tests.mutualsmodel.\(UUID().uuidString)"
    }

    private func until(_ condition: () -> Bool, timeout: TimeInterval = 5) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition(), Date() < deadline {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
    }

    func testAScanFindsTheMutualsAndTalliesWhatTheyBlock() async throws {
        let suite = newSuite()
        defer { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }
        let transport = MutualsFakeTransport(F.routes())
        let model = makeModel(transport, suite: suite)
        model.start(F.account)
        XCTAssertTrue(model.isRunning)
        try await until { !model.isRunning }

        XCTAssertEqual(model.phase, .done, model.runError ?? "")
        XCTAssertEqual(model.account?.handle, "alice.example.com")
        XCTAssertEqual(model.strategy, .followers, "three followers are one page")
        XCTAssertEqual(model.mutuals.map(\.did), [F.bob, F.carl])
        XCTAssertEqual(model.follows, [F.bob, F.carl, F.dana])
        XCTAssertEqual(model.ownBlocks, [F.two])
        XCTAssertEqual(model.states, [.done(blocks: 2, listBlocks: 1), .done(blocks: 2, listBlocks: 1)])
        XCTAssertEqual(model.blocksRead, 6)
        XCTAssertEqual(model.tally[F.one]?.sorted(), [0, 1])
        XCTAssertNil(model.tally[F.account], "the scanned account is never counted against itself")
        XCTAssertEqual(model.counts, Mutuals.histogram(model.tally))
        XCTAssertEqual(model.counts, [0, 2, 1])
        XCTAssertEqual(model.mutualsRead, 2)
        XCTAssertEqual(model.threshold, 2)
        XCTAssertEqual(model.ranked.map(\.did), [F.one])
        XCTAssertEqual(model.doneTitle, "1 account is blocked by at least 2 of 2 mutuals")
        XCTAssertEqual(model.doneDetail, "@alice.example.com has 2 mutuals.")
        XCTAssertEqual(transport.count(containing: "getRelationships"), 0)

        try await until { model.described && !model.lists.isEmpty }
        XCTAssertEqual(model.listSubscriptions.map(\.uri), [F.list])
        XCTAssertEqual(model.listSubscriptions.first?.subscribers.count, 2)
        guard case .available(let info)? = model.lists[F.list] else {
            return XCTFail("the list was not described")
        }
        XCTAssertEqual(info.name, "Spam")
        XCTAssertEqual(info.memberCount, 40)
    }

    func testTheThresholdMovesTheRankingAndAccountsThatAreGoneAreLeftOut() async throws {
        let suite = newSuite()
        defer { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }
        let model = makeModel(MutualsFakeTransport(F.routes()), suite: suite)
        model.start(F.account, min: "1")
        try await until { !model.isRunning }
        XCTAssertEqual(model.threshold, 1)
        XCTAssertEqual(model.ranked.map(\.did), [F.one, F.three, F.two])
        try await until { model.described }

        XCTAssertEqual(model.missingProfiles, [F.three])
        XCTAssertEqual(model.present.map(\.did), [F.one, F.two])
        XCTAssertEqual(model.goneCount, 1)
        XCTAssertTrue(model.flags(F.two).blocked)
        XCTAssertTrue(model.isTicked(F.two), "an account already blocked stays ticked")
        XCTAssertFalse(model.isTicked(F.three), "an account that is gone starts unticked")
        XCTAssertEqual(model.selected, [F.one, F.two])

        model.tick(F.one, false)
        XCTAssertEqual(model.selected, [F.two])
        model.tickAll(true)
        XCTAssertEqual(model.selected, [F.one, F.two])
        model.resetTicks()

        model.setFocus(1)
        XCTAssertEqual(model.shownCandidates.map(\.did), [F.one, F.three])
        model.setFocus(nil)

        model.setThreshold(2)
        XCTAssertEqual(model.ranked.map(\.did), [F.one])
        XCTAssertEqual(model.matching, 1)
    }

    func testSavingWritesTheListItsMembersAndTheBlock() async throws {
        let suite = newSuite()
        defer { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }
        let model = makeModel(MutualsFakeTransport(F.routes()), suite: suite)
        model.start(F.account, min: "1")
        try await until { !model.isRunning }
        try await until { model.described }

        let created = "at://\(F.account)/app.bsky.graph.list/3knew"
        let log = MutualsWriteLog(listUri: created)
        model.listName = "  My list "
        model.blockAfterSaving = true
        XCTAssertEqual(model.saveCollections.count, 3)
        XCTAssertEqual(model.savePoints, (1 + 2 + 1) * Mutuals.createPoints)
        XCTAssertTrue(model.listDescription.contains("at least one of the 2 mutuals"), model.listDescription)
        model.save(with: log.writer(did: F.account, batchSize: 1))
        try await until { model.saving?.running == false }

        let saving = try XCTUnwrap(model.saving)
        XCTAssertNil(saving.error)
        XCTAssertTrue(saving.finished)
        XCTAssertTrue(saving.blocked)
        XCTAssertEqual(saving.listUri, created)
        XCTAssertEqual(saving.outcome?.added, 2)
        let calls = log.calls
        XCTAssertEqual(calls.map(\.method), ["createRecord", "createListItems", "createListItems", "createRecord"])
        XCTAssertEqual(calls.first?.records.first?["name"], "My list")
        XCTAssertEqual(calls.last?.collection, Mutuals.listBlockCollection)
        XCTAssertEqual(calls.last?.records.first?["subject"], .string(created))
        XCTAssertEqual(calls[1].records.first?["subject"], .string(F.one))
    }

    func testAnAccountTheAppViewDoesNotKnowIsAFailedScan() async throws {
        let suite = newSuite()
        defer { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }
        let model = makeModel(MutualsFakeTransport(F.routes(profileStatus: 400)), suite: suite)
        model.start(F.account)
        try await until { !model.isRunning }
        XCTAssertEqual(model.phase, .failed)
        XCTAssertEqual(model.runError, "Bluesky\u{2019}s AppView has no profile for this account, so it cannot say who its mutuals are.")
    }

    func testAPostIsNotAnAccount() {
        let suite = newSuite()
        defer { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }
        let model = makeModel(MutualsFakeTransport([]), suite: suite)
        model.start("https://bsky.app/profile/alice.example.com/post/3n22yg6lg2k2f")
        XCTAssertNil(model.actor)
        XCTAssertEqual(model.inputError, "Mutuals belong to accounts. Enter a handle or a DID.")
        XCTAssertFalse(model.isRunning)
    }

    func testStopKeepsWhatWasReadAndSaysTheScanWasStopped() async throws {
        let suite = newSuite()
        defer { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }
        let model = makeModel(MutualsFakeTransport(F.routes()), suite: suite)
        model.start(F.account)
        model.stop()
        XCTAssertTrue(model.isStopping)
        try await until { !model.isRunning }
        XCTAssertEqual(model.phase, .done)
        XCTAssertTrue(model.stopped)
        XCTAssertFalse(model.isStopping)
        XCTAssertFalse(model.partialMutuals, "a stopped scan is not called partial")
    }

    func testAPDSThatRefusesIsSkippedWithItsReason() async throws {
        let suite = newSuite()
        defer { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }
        var routes = F.routes()
        routes.insert((F.listRecords(F.carl, Mutuals.blockCollection), .init(status: 400, body: #"{"error":"RepoDeactivated","message":"Repo has been deactivated"}"#)), at: 0)
        let model = makeModel(MutualsFakeTransport(routes), suite: suite)
        model.start(F.account)
        try await until { !model.isRunning }
        XCTAssertEqual(model.states.last, .skipped(blocks: 0, reason: "the account is deactivated", stopped: false))
        XCTAssertEqual(model.unreadableCount, 1)
        XCTAssertEqual(model.mutualsRead, 1)
        XCTAssertEqual(model.doneDetail, "@alice.example.com has 2 mutuals; 1 could not be read.")
    }

    func testABusyPDSIsWaitedOutThenReadAgain() async throws {
        // Two tries: busy, then the page. `sleep` is a no-op, so the wait is instant.
        let transport = MutualsFlakyTransport()
        let client = MutualsClient(http: HTTPClient(transport: transport), sleep: { _ in })
        let pds = try XCTUnwrap(URL(string: "https://pds.example.com"))
        var subjects: [String] = []
        try await client.readCollection(pds: pds, did: F.bob, collection: Mutuals.blockCollection, stopper: MutualsStopper()) { values in
            subjects.append(contentsOf: values.compactMap { Mutuals.readBlockSubject($0) })
        }
        XCTAssertEqual(subjects, [F.one])
        XCTAssertEqual(transport.calls, 2)
    }
}

/// Busy the first time, the page the second.
private final class MutualsFlakyTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    var calls: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.lock()
        count += 1
        let first = count == 1
        lock.unlock()
        let url = request.url!
        if first {
            let response = HTTPURLResponse(url: url, statusCode: 429, httpVersion: "HTTP/1.1", headerFields: ["retry-after": "2"])!
            return (Data(#"{"error":"RateLimitExceeded"}"#.utf8), response)
        }
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!
        return (Data(MutualsFixture.records(Mutuals.blockCollection, [MutualsFixture.one]).utf8), response)
    }
}
