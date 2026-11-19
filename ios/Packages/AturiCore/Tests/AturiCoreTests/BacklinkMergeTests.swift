import Foundation
import XCTest
@testable import AturiCore

/// A fake index: each source's records newest first, served `limit` at a
/// time with the offset as the cursor. Records every call as
/// `source@cursor`, so a test can see which sources were asked and when.
private final class FakeBacklinkIndex: @unchecked Sendable {
    private let lock = NSLock()
    private let data: [String: [BacklinkRecord]]
    private let failing: Set<String>
    private var recorded: [String] = []

    init(_ data: [String: [BacklinkRecord]], failing: Set<String> = []) {
        self.data = data
        self.failing = failing
    }

    var calls: [String] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }

    func page(_ source: String, _ cursor: String?, _ limit: Int) -> BacklinkMergePage? {
        lock.lock(); defer { lock.unlock() }
        recorded.append("\(source)@\(cursor ?? "0")")
        if failing.contains(source) { return nil }
        let all = data[source] ?? []
        let start = min(cursor.flatMap { Int($0) } ?? 0, all.count)
        let end = min(start + limit, all.count)
        return BacklinkMergePage(records: Array(all[start..<end]), cursor: end < all.count ? String(end) : nil)
    }

    var fetcher: BacklinkPageFetcher {
        return { source, cursor, limit in
            self.page(source, cursor, limit)
        }
    }
}

/// A TID rkey for `minutes` after 2026-01-01T00:00:00Z: microseconds over
/// ten clock-id bits, in the sortable base32 alphabet. Shared by the
/// backlinks tests that order records by date.
func backlinkTestTid(_ minutes: Int) -> String {
    let base: UInt64 = 1_767_225_600_000
    var value = ((base + UInt64(minutes) * 60_000) * 1000) << 10
    let alphabet = Array(TID.alphabet)
    var out = ""
    for _ in 0..<13 {
        out = String(alphabet[Int(value & 31)]) + out
        value >>= 5
    }
    return out
}

/// Port of src/utils/atproto/__tests__/backlinkMerge.test.ts.
final class BacklinkMergeTests: XCTestCase {
    private func tid(_ minutes: Int) -> String {
        backlinkTestTid(minutes)
    }

    private func rec(_ did: String, _ collection: String, _ rkey: String) -> BacklinkRecord {
        BacklinkRecord(did: did, collection: collection, rkey: rkey)
    }

    func testTheTidHelperSpellsTheMinuteItWasGiven() throws {
        let date = try XCTUnwrap(TID.date(from: tid(100)))
        XCTAssertEqual(Formatting.isoTimestamp(date), "2026-01-01T01:40:00.000Z")
    }

    func testTakesTheNewestRecordAcrossSourcesFirst() async {
        let index = FakeBacklinkIndex([
            "a": [rec("did:plc:a1", "x.follow", tid(100)), rec("did:plc:a2", "x.follow", tid(80)), rec("did:plc:a3", "x.follow", tid(60))],
            "b": [rec("did:plc:b1", "y.follow", tid(90)), rec("did:plc:b2", "y.follow", tid(70))],
        ])
        let merge = BacklinkMerge(sources: ["a", "b"], fetchPage: index.fetcher)
        let batch = await merge.next(10)
        XCTAssertEqual(batch.items.map(\.did), ["did:plc:a1", "did:plc:b1", "did:plc:a2", "did:plc:b2", "did:plc:a3"])
        XCTAssertEqual(batch.items[1].source, "b")
        XCTAssertEqual(batch.items[0].uri, "at://did:plc:a1/x.follow/\(tid(100))")
        XCTAssertTrue(batch.isDone)
    }

    func testAsksASourceForItsNextPageOnlyWhenItsBufferRunsDry() async {
        let a = (0..<5).map { rec("did:plc:a\($0)", "x.follow", tid(100 - $0)) }
        let b = [rec("did:plc:b0", "y.follow", tid(1))]
        let index = FakeBacklinkIndex(["a": a, "b": b])
        let merge = BacklinkMerge(sources: ["a", "b"], pageSize: 2, fetchPage: index.fetcher)

        let first = await merge.next(2)
        XCTAssertEqual(first.items.map(\.did), ["did:plc:a0", "did:plc:a1"])
        // The first round asks both sources at once, so their order is the
        // scheduler's; the web's synchronous start records a@0 first.
        XCTAssertEqual(Set(index.calls), ["a@0", "b@0"])
        XCTAssertEqual(index.calls.count, 2)
        XCTAssertFalse(first.isDone)

        let second = await merge.next(10)
        XCTAssertEqual(second.items.map(\.did), ["did:plc:a2", "did:plc:a3", "did:plc:a4", "did:plc:b0"])
        XCTAssertEqual(Array(index.calls.dropFirst(2)), ["a@2", "a@4"])
        XCTAssertTrue(second.isDone)
    }

    func testFoldsRepeatLinksToOneRecordIntoACount() async {
        let pack = rec("did:plc:p", "x.starterpack", tid(50))
        let index = FakeBacklinkIndex([
            "a": [pack, pack, pack, rec("did:plc:q", "x.starterpack", tid(40))],
            "b": [pack],
        ])
        let merge = BacklinkMerge(sources: ["a", "b"], fetchPage: index.fetcher)
        let batch = await merge.next(10)
        XCTAssertEqual(batch.items.map(\.did), ["did:plc:p", "did:plc:q"])
        XCTAssertEqual(batch.items.map(\.links), [4, 1])
        XCTAssertTrue(batch.relinked.isEmpty, "every fold landed on a record of this batch")
    }

    /// The web bumps the row object it already handed out; here the later
    /// batch reports the new count instead.
    func testARepeatOfARecordFromAnEarlierBatchIsReportedAsRelinked() async {
        let pack = rec("did:plc:p", "x.starterpack", tid(50))
        let index = FakeBacklinkIndex([
            "a": [pack, rec("did:plc:q", "x.starterpack", tid(40))],
            "b": [pack, rec("did:plc:r", "y.card", tid(30))],
        ])
        let merge = BacklinkMerge(sources: ["a", "b"], fetchPage: index.fetcher)
        let first = await merge.next(1)
        XCTAssertEqual(first.items.map(\.did), ["did:plc:p"])
        XCTAssertEqual(first.items.map(\.links), [1])

        let second = await merge.next(10)
        XCTAssertEqual(second.items.map(\.did), ["did:plc:q", "did:plc:r"])
        XCTAssertEqual(second.relinked, [pack.atUri: 2])
    }

    func testAFailingSourceIsReportedAndTheRestStillMerge() async {
        let index = FakeBacklinkIndex(["a": [rec("did:plc:a", "x.follow", tid(5))]], failing: ["b"])
        let merge = BacklinkMerge(sources: ["a", "b"], fetchPage: index.fetcher)
        let batch = await merge.next(10)
        XCTAssertEqual(batch.items.map(\.did), ["did:plc:a"])
        XCTAssertEqual(batch.failed, ["b"])
        XCTAssertTrue(batch.isDone)
    }

    func testANonTidRkeyKeepsItsPlaceInItsOwnSource() async {
        let index = FakeBacklinkIndex([
            "a": [rec("did:plc:a1", "x.card", tid(100)), rec("did:plc:a2", "x.card", "self"), rec("did:plc:a3", "x.card", tid(20))],
            "b": [rec("did:plc:b1", "y.card", tid(60))],
        ])
        let merge = BacklinkMerge(sources: ["a", "b"], fetchPage: index.fetcher)
        let batch = await merge.next(10)
        XCTAssertEqual(batch.items.map(\.did), ["did:plc:a1", "did:plc:a2", "did:plc:b1", "did:plc:a3"])
    }

    func testAnUndatedHeadRidesWithTheNextDatedRecordOfItsSource() async {
        let index = FakeBacklinkIndex([
            "a": [rec("did:plc:a1", "x.profile", "self"), rec("did:plc:a2", "x.card", tid(40))],
            "b": [rec("did:plc:b1", "y.card", tid(60)), rec("did:plc:b2", "y.card", tid(30))],
        ])
        let merge = BacklinkMerge(sources: ["a", "b"], fetchPage: index.fetcher)
        let batch = await merge.next(10)
        XCTAssertEqual(batch.items.map(\.did), ["did:plc:b1", "did:plc:a1", "did:plc:a2", "did:plc:b2"])
    }

    func testASourceWithNoDatesSortsAfterTheDatedOnes() async {
        let index = FakeBacklinkIndex([
            "a": [rec("did:plc:a1", "x.profile", "self")],
            "b": [rec("did:plc:b1", "y.card", tid(60)), rec("did:plc:b2", "y.card", tid(1))],
        ])
        let merge = BacklinkMerge(sources: ["a", "b"], fetchPage: index.fetcher)
        let batch = await merge.next(10)
        XCTAssertEqual(batch.items.map(\.did), ["did:plc:b1", "did:plc:b2", "did:plc:a1"])
    }

    func testAnEmptySourceSetIsDoneAtOnce() async {
        let merge = BacklinkMerge(sources: [], fetchPage: { _, _, _ in nil })
        let batch = await merge.next(5)
        XCTAssertEqual(batch, BacklinkMergeBatch(items: [], relinked: [:], isDone: true, failed: []))
    }
}
