import Foundation
import XCTest
@testable import AturiCore

/// A value two closures in a test can share.
final class MutualsTestBox<Value> {
    var value: Value

    init(_ value: Value) {
        self.value = value
    }
}

/// Writes recorded in order, failing on the batches `failOn` names.
final class MutualsWriteLog: @unchecked Sendable {
    struct Call: Equatable {
        var method: String
        var collection: String?
        var records: [JSONValue]
    }

    private let lock = NSLock()
    private var recorded: [Call] = []
    private var batch = 0
    private let failOn: [Int: Error]
    let listUri: String

    init(listUri: String, failOn: [Int: Error] = [:]) {
        self.listUri = listUri
        self.failOn = failOn
    }

    func createRecord(_ collection: String, _ record: JSONValue) throws -> String {
        lock.lock()
        defer { lock.unlock() }
        recorded.append(Call(method: "createRecord", collection: collection, records: [record]))
        return listUri
    }

    func createListItems(_ records: [JSONValue]) throws {
        lock.lock()
        let n = batch
        batch += 1
        recorded.append(Call(method: "createListItems", collection: nil, records: records))
        let failure = failOn[n]
        lock.unlock()
        if let failure { throw failure }
    }

    var calls: [Call] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func writer(did: String, batchSize: Int) -> MutualsListWriter {
        MutualsListWriter(
            did: did,
            batchSize: batchSize,
            createRecord: { collection, record in try self.createRecord(collection, record) },
            createListItems: { records in try self.createListItems(records) }
        )
    }
}

/// Port of `src/lib/tools/__tests__/mutualsSave.test.ts`.
@MainActor
final class MutualsSaveTests: XCTestCase {
    private nonisolated static let owner = "did:plc:oooooooooooooooooooooooo"
    private nonisolated static let list = "at://did:plc:oooooooooooooooooooooooo/app.bsky.graph.list/3kabc"

    /// A ledger on a throwaway suite, and the suite to remove afterwards.
    private func throttleSuite() -> (WriteThrottle, String) {
        let suite = "aturi.tests.mutuals.\(UUID().uuidString)"
        return (WriteThrottle(defaults: UserDefaults(suiteName: suite)!), suite)
    }

    private func removeSuite(_ suite: String) {
        UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
    }

    private func subjects(_ n: Int) -> [String] {
        (0..<n).map { i in
            let digits = String(i)
            return "did:plc:" + String(repeating: "a", count: 24 - digits.count) + digits
        }
    }

    private func add(
        _ log: MutualsWriteLog,
        _ subjects: [String],
        throttle: WriteThrottle,
        batchSize: Int = 200,
        stopAt: Int? = nil
    ) async -> (MutualsAddOutcome, [MutualsAddProgress]) {
        // Boxed, so the two closures share them without both capturing a var.
        let progress = MutualsTestBox<[MutualsAddProgress]>([])
        let stopped = MutualsTestBox(false)
        let outcome = await MutualsSave.addMembers(
            writer: log.writer(did: Self.owner, batchSize: batchSize),
            list: Self.list,
            subjects: subjects,
            throttle: throttle,
            sleep: { _ in },
            isStopped: { stopped.value },
            onProgress: { update in
                progress.value.append(update)
                if let stopAt, update.done == stopAt {
                    stopped.value = true
                }
            }
        )
        return (outcome, progress.value)
    }

    func testTheListIsCreatedAsAModerationListInTheSignedInRepository() async throws {
        let (throttle, suite) = throttleSuite()
        defer { removeSuite(suite) }
        let log = MutualsWriteLog(listUri: Self.list)
        let uri = try await MutualsSave.createModList(
            writer: log.writer(did: Self.owner, batchSize: 200),
            name: " Mine ",
            description: "Why",
            throttle: throttle
        )
        XCTAssertEqual(uri, Self.list)
        let call = try XCTUnwrap(log.calls.first)
        XCTAssertEqual(call.collection, "app.bsky.graph.list")
        XCTAssertEqual(call.records.first?["purpose"], "app.bsky.graph.defs#modlist")
        XCTAssertEqual(call.records.first?["name"], "Mine")
        XCTAssertEqual(throttle.pointsSpent(Self.owner), Mutuals.createPoints)
    }

    func testMembersAreAddedInBatchesOf200InOrder() async {
        let (throttle, suite) = throttleSuite()
        defer { removeSuite(suite) }
        let log = MutualsWriteLog(listUri: Self.list)
        let (outcome, progress) = await add(log, subjects(450), throttle: throttle)
        XCTAssertEqual(outcome, MutualsAddOutcome(added: 450, remaining: []))
        let batches = log.calls.map(\.records)
        XCTAssertEqual(batches.map(\.count), [200, 200, 50])
        XCTAssertEqual(batches.joined().compactMap { $0["subject"]?.stringValue }, subjects(450))
        XCTAssertTrue(batches.joined().allSatisfy { $0["list"]?.stringValue == Self.list })
        XCTAssertTrue(batches.joined().allSatisfy { $0["$type"]?.stringValue == "app.bsky.graph.listitem" })
        XCTAssertEqual(progress.last?.done, 450)
        XCTAssertEqual(throttle.pointsSpent(Self.owner), 450 * Mutuals.createPoints)
    }

    func testAWriterThatTakesOneAtATimeIsCalledOncePerAccount() async {
        let (throttle, suite) = throttleSuite()
        defer { removeSuite(suite) }
        let log = MutualsWriteLog(listUri: Self.list)
        let (outcome, _) = await add(log, subjects(5), throttle: throttle, batchSize: 1)
        XCTAssertEqual(outcome.added, 5)
        XCTAssertEqual(log.calls.map(\.records.count), [1, 1, 1, 1, 1])
    }

    func testARefusedBatchStopsTheRunAndLeavesItAndEverythingAfterToAddAgain() async {
        let (throttle, suite) = throttleSuite()
        defer { removeSuite(suite) }
        let limited = HTTPError(status: 429, body: #"{"error":"RateLimitExceeded","message":"Rate Limit Exceeded"}"#, url: URL(string: "https://pds.example.com")!)
        let (outcome, _) = await add(MutualsWriteLog(listUri: Self.list, failOn: [1: limited]), subjects(450), throttle: throttle)
        XCTAssertEqual(outcome.added, 200)
        XCTAssertEqual(outcome.endedBy, .rateLimit)
        XCTAssertEqual(outcome.remaining, Array(subjects(450)[200...]))

        let invalid = HTTPError(status: 400, body: #"{"error":"InvalidRequest","message":"InvalidRequest"}"#, url: URL(string: "https://pds.example.com")!)
        let (failed, _) = await add(MutualsWriteLog(listUri: Self.list, failOn: [0: invalid]), subjects(10), throttle: throttle)
        XCTAssertEqual(failed.endedBy, .error)
        XCTAssertEqual(failed.error, "InvalidRequest")
        XCTAssertEqual(failed.remaining, subjects(10))
    }

    func testStopEndsTheRunAfterTheBatchInFlight() async {
        let (throttle, suite) = throttleSuite()
        defer { removeSuite(suite) }
        let log = MutualsWriteLog(listUri: Self.list)
        let (outcome, _) = await add(log, subjects(450), throttle: throttle, stopAt: 200)
        XCTAssertEqual(log.calls.count, 1)
        XCTAssertEqual(outcome.added, 200)
        XCTAssertEqual(outcome.endedBy, .stop)
        XCTAssertEqual(outcome.remaining.count, 250)
    }

    func testAnExhaustedBudgetWaitsAndSaysHowLong() async {
        let (throttle, suite) = throttleSuite()
        defer { removeSuite(suite) }
        // Spend all but five creates' worth, so the second batch has to wait.
        throttle.recordSpend(Self.owner, points: WriteThrottle.throttlePointBudget - 15)
        let log = MutualsWriteLog(listUri: Self.list)
        let waits = MutualsTestBox<[Int]>([])
        let outcome = await MutualsSave.addMembers(
            writer: log.writer(did: Self.owner, batchSize: 5),
            list: Self.list,
            subjects: subjects(10),
            throttle: throttle,
            sleep: { _ in },
            isStopped: { waits.value.count >= 3 },
            onProgress: { update in
                if let seconds = update.waitingSeconds {
                    waits.value.append(seconds)
                }
            }
        )
        XCTAssertEqual(outcome.added, 5)
        XCTAssertEqual(outcome.endedBy, .stop)
        XCTAssertFalse(waits.value.isEmpty)
        XCTAssertTrue(waits.value.allSatisfy { $0 > 0 })
    }
}
