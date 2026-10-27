import Foundation
import XCTest
@testable import AturiCore

/// A clock the tests move by hand, so the rate maths is deterministic.
private final class JetstreamTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date

    init(_ start: Date) {
        current = start
    }

    var now: Date {
        lock.lock(); defer { lock.unlock() }
        return current
    }

    func advance(by seconds: TimeInterval) {
        lock.lock(); defer { lock.unlock() }
        current = current.addingTimeInterval(seconds)
    }
}

/// Records how often a fake source was opened and closed, and with what.
private final class JetstreamSourceLog: @unchecked Sendable {
    private let lock = NSLock()
    private var opened: [JetstreamOptions] = []
    private var closedCount = 0

    func recordOpen(_ options: JetstreamOptions) {
        lock.lock(); defer { lock.unlock() }
        opened.append(options)
    }

    func recordClose() {
        lock.lock(); defer { lock.unlock() }
        closedCount += 1
    }

    var openedOptions: [JetstreamOptions] {
        lock.lock(); defer { lock.unlock() }
        return opened
    }

    var closes: Int {
        lock.lock(); defer { lock.unlock() }
        return closedCount
    }
}

@MainActor
final class JetstreamModelTests: XCTestCase {
    private nonisolated static let start = Date(timeIntervalSince1970: 1_736_294_400)
    private nonisolated static let did = "did:plc:abcdefghijklmnopqrstuvwx"
    private nonisolated static let post = "app.bsky.feed.post"

    private nonisolated static func commit(
        _ rkey: String,
        did: String = JetstreamModelTests.did,
        collection: String = JetstreamModelTests.post,
        op: JetstreamOperation = .create,
        timeUs: Int = 1_736_294_400_000_000,
        record: JSONValue? = .object(["text": .string("hello")])
    ) -> JetstreamCommit {
        JetstreamCommit(did: did, timeUs: timeUs, commit: .init(operation: op, collection: collection, rkey: rkey, record: op == .delete ? nil : record, cid: "bafy"))
    }

    /// A model that never flushes on its own, so each test drives `flush()`.
    private func makeModel(
        collections: [String] = [],
        ops: [JetstreamOperation] = [],
        maxRows: Int = JetstreamModel.defaultMaxRows,
        clock: JetstreamTestClock = JetstreamTestClock(JetstreamModelTests.start),
        source: JetstreamFeedSource = JetstreamFeedSource { _ in (AsyncStream { $0.finish() }, {}) }
    ) -> JetstreamModel {
        JetstreamModel(collections: collections, ops: ops, maxRows: maxRows, source: source, flushInterval: 3600, clock: { clock.now })
    }

    private func waitUntil(_ condition: @escaping @MainActor () -> Bool, timeout: TimeInterval = 2) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
        return condition()
    }

    // MARK: Row model

    func testRowDerivesFieldsAndPreview() async {
        let received = Date(timeIntervalSince1970: 1_736_294_401)
        let row = JetstreamRow(commit: Self.commit("3lxyz", timeUs: 1_736_294_400_500_000), receivedAt: received)
        XCTAssertEqual(row.uri, "at://\(Self.did)/app.bsky.feed.post/3lxyz")
        XCTAssertEqual(row.id, "at://\(Self.did)/app.bsky.feed.post/3lxyz|create|1736294400500000")
        XCTAssertEqual(row.did, Self.did)
        XCTAssertEqual(row.collection, Self.post)
        XCTAssertEqual(row.rkey, "3lxyz")
        XCTAssertEqual(row.op, .create)
        XCTAssertEqual(row.timeUs, 1_736_294_400_500_000)
        XCTAssertEqual(row.time, Date(timeIntervalSince1970: 1_736_294_400.5))
        XCTAssertEqual(row.receivedAt, received)
        XCTAssertEqual(row.didLabel, shortDid(Self.did))
        XCTAssertEqual(row.collectionTail, "feed.post")
        XCTAssertEqual(row.explorerPath, "/explore/\(Self.did)/app.bsky.feed.post/3lxyz")
        XCTAssertEqual(row.preview, "hello")
        XCTAssertEqual(row.opSymbol, "+")
        XCTAssertEqual(row.opTitle, "create")

        let update = JetstreamRow(commit: Self.commit("3lxyz", op: .update, record: .object(["displayName": .string("Alice")])))
        XCTAssertEqual(update.opSymbol, "~")
        XCTAssertEqual(update.opTitle, "update")
        XCTAssertEqual(update.preview, "Alice")

        let delete = JetstreamRow(commit: Self.commit("3lxyz", op: .delete))
        XCTAssertEqual(delete.opSymbol, "\u{00D7}")
        XCTAssertEqual(delete.value, .object([:]), "a delete carries no record")
        XCTAssertEqual(delete.preview, "")

        let odd = JetstreamRow(commit: Self.commit("k", collection: "single"))
        XCTAssertEqual(odd.collectionTail, "single")
        let deep = JetstreamRow(commit: Self.commit("k", collection: "net.anisota.harvest.minigame"))
        XCTAssertEqual(deep.collectionTail, "harvest.minigame")
        let spaced = JetstreamRow(commit: Self.commit("with space"))
        XCTAssertEqual(spaced.explorerPath, "/explore/\(Self.did)/app.bsky.feed.post/with%20space", "the rkey is percent-encoded like the web's link builders")
    }

    // MARK: Flush

    func testFlushSurfacesTheNewestSixNewestFirstAndDropsTheRest() async {
        let model = makeModel()
        XCTAssertTrue(model.showsSkeleton)
        XCTAssertEqual(JetstreamModel.title, "Live across the Atmosphere")
        for i in 0..<10 {
            model.ingest(Self.commit("r\(i)"))
        }
        XCTAssertEqual(model.pendingCount, 10)
        XCTAssertTrue(model.rows.isEmpty, "nothing surfaces before a flush")

        model.flush()
        XCTAssertEqual(model.rows.map(\.rkey), ["r9", "r8", "r7", "r6", "r5", "r4"])
        XCTAssertEqual(model.pendingCount, 0, "the older arrivals are dropped, not queued")
        XCTAssertFalse(model.showsSkeleton)

        model.ingest(Self.commit("r10"))
        model.ingest(Self.commit("r11"))
        model.flush()
        XCTAssertEqual(model.rows.map(\.rkey), ["r11", "r10", "r9", "r8", "r7", "r6", "r5", "r4"])

        model.flush()
        XCTAssertEqual(model.rows.count, 8, "an empty flush changes nothing")
    }

    func testFlushDedupesByUriOpAndTimestamp() async {
        let model = makeModel(ops: [.create, .update, .delete])
        let same = Self.commit("r1")
        model.ingest(same)
        model.ingest(same)
        model.flush()
        XCTAssertEqual(model.rows.count, 1, "the same commit cannot show twice")

        model.ingest(same)
        model.ingest(Self.commit("r1", op: .update))
        model.ingest(Self.commit("r1", timeUs: 1_736_294_400_000_001))
        model.flush()
        XCTAssertEqual(model.rows.map(\.id).count, Set(model.rows.map(\.id)).count)
        XCTAssertEqual(model.rows.count, 3, "a later op or a later commit of the same URI is a new row")
        XCTAssertEqual(model.rows.map(\.op), [.create, .update, .create])
    }

    func testRowsAreCappedAtMaxRows() async {
        let model = makeModel(maxRows: 10)
        XCTAssertEqual(model.maxRows, 10)
        var next = 0
        for _ in 0..<5 {
            for _ in 0..<6 {
                model.ingest(Self.commit("r\(next)"))
                next += 1
            }
            model.flush()
        }
        XCTAssertEqual(model.rows.count, 10)
        XCTAssertEqual(model.rows.first?.rkey, "r29")
        XCTAssertEqual(model.rows.last?.rkey, "r20")
        XCTAssertEqual(makeModel(maxRows: 0).maxRows, 1, "clamped to at least one row")
    }

    func testBufferIsBoundedSoMemoryStaysFlat() async {
        let model = makeModel()
        for i in 0..<450 {
            model.ingest(Self.commit("r\(i)"))
        }
        XCTAssertEqual(model.pendingCount, JetstreamModel.bufferCap)
        model.flush()
        XCTAssertEqual(model.rows.first?.rkey, "r449")
        XCTAssertEqual(model.stats.total, 450, "every arrival is counted even when the buffer dropped it")
    }

    // MARK: Pause

    func testPauseHoldsRowsWhileCountingAndResumeShowsTheLatest() async {
        let model = makeModel()
        XCTAssertFalse(model.isPaused)
        XCTAssertEqual(model.pauseButtonLabel, "Pause")
        for i in 0..<3 {
            model.ingest(Self.commit("r\(i)"))
        }
        model.pause()
        XCTAssertTrue(model.isPaused)
        XCTAssertEqual(model.pauseButtonLabel, "Resume")
        model.flush()
        XCTAssertTrue(model.rows.isEmpty, "paused: nothing surfaces")
        XCTAssertEqual(model.pendingCount, 3, "the buffer is kept")
        XCTAssertEqual(model.stats.total, 3, "the counters keep sampling")
        XCTAssertEqual(model.eventsPerSecond, 1)

        for i in 3..<8 {
            model.ingest(Self.commit("r\(i)"))
        }
        XCTAssertEqual(model.pendingCount, 8)
        model.resume()
        XCTAssertFalse(model.isPaused)
        model.flush()
        XCTAssertEqual(model.rows.map(\.rkey), ["r7", "r6", "r5", "r4", "r3", "r2"], "resuming shows the latest activity, not a backlog")
        XCTAssertEqual(model.pendingCount, 0)

        model.togglePaused()
        XCTAssertTrue(model.isPaused)
        model.togglePaused()
        XCTAssertFalse(model.isPaused)
    }

    // MARK: Filters

    func testIngestHonoursTheOpAndCollectionFilters() async {
        let creates = makeModel()
        XCTAssertEqual(creates.allowedOps, [.create], "empty means creates only")
        creates.ingest(Self.commit("r1", op: .update))
        creates.ingest(Self.commit("r2", op: .delete))
        creates.ingest(Self.commit("r3"))
        XCTAssertEqual(creates.pendingCount, 1)
        creates.flush()
        XCTAssertEqual(creates.stats.total, 1)

        let all = makeModel(ops: [.create, .update, .delete])
        XCTAssertEqual(all.allowedOps, [.create, .update, .delete])
        all.ingest(Self.commit("r1", op: .update))
        all.ingest(Self.commit("r2", op: .delete))
        XCTAssertEqual(all.pendingCount, 2)

        let posts = makeModel(collections: ["app.bsky.feed.post", "app.bsky.graph.*"])
        posts.ingest(Self.commit("r1"))
        posts.ingest(Self.commit("r2", collection: "app.bsky.feed.like"))
        posts.ingest(Self.commit("r3", collection: "app.bsky.graph.follow"))
        posts.ingest(Self.commit("r4", collection: "sh.tangled.repo"))
        posts.flush()
        XCTAssertEqual(posts.rows.map(\.rkey), ["r3", "r1"])
        XCTAssertEqual(posts.stats.uniqueCollections, 2)

        XCTAssertTrue(JetstreamModel.matchesCollectionFilter("anything.at.all", filters: []))
        XCTAssertTrue(JetstreamModel.matchesCollectionFilter("app.bsky.feed.post", filters: ["app.bsky.feed.post"]))
        XCTAssertFalse(JetstreamModel.matchesCollectionFilter("app.bsky.feed.post", filters: ["app.bsky.feed"]))
        XCTAssertTrue(JetstreamModel.matchesCollectionFilter("app.bsky.feed.post", filters: ["app.bsky.*"]))
        XCTAssertFalse(JetstreamModel.matchesCollectionFilter("app.bskyx.feed.post", filters: ["app.bsky.*"]))
        XCTAssertTrue(JetstreamModel.matchesCollectionFilter("x.y.z", filters: ["*"]))
    }

    // MARK: Stats and rate

    func testStatsAndRatesArePublishedOnFlush() async {
        let clock = JetstreamTestClock(Self.start)
        let model = makeModel(ops: [.create, .update, .delete], clock: clock)
        let other = "did:plc:zyxwvutsrqponmlkjihgfedc"
        model.ingest(Self.commit("r0"))
        model.ingest(Self.commit("r1", did: other))
        model.ingest(Self.commit("r2", collection: "app.bsky.feed.like"))
        model.ingest(Self.commit("r3", collection: "sh.tangled.repo", op: .update))
        model.ingest(Self.commit("r4", op: .update))
        model.ingest(Self.commit("r5", op: .delete))
        for i in 6..<10 {
            model.ingest(Self.commit("r\(i)"))
        }
        XCTAssertEqual(model.stats, .empty, "counters are sampled on the flush, not per event")
        XCTAssertEqual(model.eventsPerSecond, 0)
        XCTAssertNil(model.rateLabel)

        model.flush()
        XCTAssertEqual(model.stats, JetstreamStats(total: 10, creates: 7, updates: 2, deletes: 1, uniqueDids: 2, uniqueCollections: 3))
        XCTAssertEqual(model.eventsPerSecond, 2, "ten arrivals over the five-second window")
        XCTAssertEqual(model.eventsPerMinute, 10)
        XCTAssertEqual(model.rateLabel, "~2/s")
        XCTAssertEqual(model.statItems.map(\.label), ["total", "users", "lexicons"])
        XCTAssertEqual(model.statItems.map(\.value), ["10", "2", "3"])
        XCTAssertEqual(model.statItems.map(\.id), ["total", "users", "lexicons"])
        XCTAssertEqual(model.statItems[0].hint, "Events received since the feed loaded")
        XCTAssertEqual(model.statItems[1].hint, "Distinct DIDs spotted")
        XCTAssertEqual(model.statItems[2].hint, "Distinct NSIDs spotted")

        clock.advance(by: 3)
        for i in 10..<15 {
            model.ingest(Self.commit("r\(i)"))
        }
        model.flush()
        XCTAssertEqual(model.eventsPerSecond, 3, "fifteen arrivals within the window")
        XCTAssertEqual(model.eventsPerMinute, 15)

        clock.advance(by: 10)
        model.flush()
        XCTAssertEqual(model.eventsPerSecond, 0, "nothing arrived in the last five seconds")
        XCTAssertNil(model.rateLabel)
        XCTAssertEqual(model.eventsPerMinute, 15, "still within the minute")
        XCTAssertEqual(model.stats.total, 15)

        clock.advance(by: 60)
        model.flush()
        XCTAssertEqual(model.eventsPerMinute, 0)
        XCTAssertEqual(model.stats.total, 15, "totals never roll off")
    }

    func testGroupedFormatsThousands() async {
        XCTAssertEqual(JetstreamModel.grouped(0), "0")
        XCTAssertEqual(JetstreamModel.grouped(999), "999")
        XCTAssertEqual(JetstreamModel.grouped(1000), "1,000")
        XCTAssertEqual(JetstreamModel.grouped(12_345), "12,345")
        XCTAssertEqual(JetstreamModel.grouped(1_234_567), "1,234,567")
        XCTAssertEqual(JetstreamModel.grouped(-1234), "-1,234")

        let clock = JetstreamTestClock(Self.start)
        let model = makeModel(clock: clock)
        for i in 0..<6000 {
            model.ingest(Self.commit("r\(i)"))
        }
        model.flush()
        XCTAssertEqual(model.rateLabel, "~1,200/s")
        XCTAssertEqual(model.statItems[0].value, "6,000")
    }

    // MARK: Lifecycle

    func testStartConsumesTheSourceAndStopClosesIt() async {
        let log = JetstreamSourceLog()
        let (stream, continuation) = AsyncStream<JetstreamCommit>.makeStream()
        let source = JetstreamFeedSource { options in
            log.recordOpen(options)
            return (stream, { log.recordClose() })
        }
        let model = makeModel(collections: ["app.bsky.feed.post"], ops: [.create, .delete], source: source)
        XCTAssertFalse(model.isRunning)
        model.stop()
        XCTAssertEqual(log.closes, 0, "stopping a model that never started is a no-op")

        model.start()
        XCTAssertTrue(model.isRunning)
        model.start()
        XCTAssertEqual(log.openedOptions.count, 1, "starting twice opens once")
        XCTAssertEqual(log.openedOptions[0], JetstreamOptions(wantedCollections: ["app.bsky.feed.post"], wantedOps: [.create, .delete]))

        continuation.yield(Self.commit("r0"))
        continuation.yield(Self.commit("r1", op: .delete))
        continuation.yield(Self.commit("r2", op: .update))
        continuation.yield(Self.commit("r3", collection: "sh.tangled.repo"))
        continuation.yield(Self.commit("r4"))
        let arrived = await waitUntil { model.pendingCount == 3 }
        XCTAssertTrue(arrived, "the update and the foreign collection are filtered on ingest")
        model.flush()
        XCTAssertEqual(model.rows.map(\.rkey), ["r4", "r1", "r0"])
        XCTAssertEqual(model.eventsPerSecond, 1)

        continuation.yield(Self.commit("r5"))
        let pending = await waitUntil { model.pendingCount == 1 }
        XCTAssertTrue(pending)
        model.stop()
        XCTAssertFalse(model.isRunning)
        XCTAssertEqual(log.closes, 1)
        XCTAssertEqual(model.pendingCount, 0, "the buffer is dropped with the socket")
        XCTAssertEqual(model.rows.count, 3, "the rows stay")
        XCTAssertEqual(model.eventsPerSecond, 0)
        XCTAssertEqual(model.eventsPerMinute, 0)
        model.flush()
        XCTAssertEqual(model.stats.total, 4, "the counters stay")
        continuation.finish()
    }

    func testChangingTheSubscriptionRestartsOnlyWhileRunning() async {
        let log = JetstreamSourceLog()
        let source = JetstreamFeedSource { options in
            log.recordOpen(options)
            return (AsyncStream { _ in }, { log.recordClose() })
        }
        let model = makeModel(source: source)
        model.setOps([.create, .update])
        XCTAssertEqual(model.ops, [.create, .update])
        XCTAssertEqual(log.openedOptions.count, 0, "not running: nothing to reconnect")

        model.start()
        model.ingest(Self.commit("r0"))
        model.flush()
        XCTAssertEqual(model.rows.count, 1)
        model.setOps([.create, .update])
        XCTAssertEqual(log.openedOptions.count, 1, "the same value again does not reconnect")

        model.setOps([.create, .update, .delete])
        XCTAssertEqual(log.closes, 1)
        XCTAssertEqual(log.openedOptions.count, 2)
        XCTAssertEqual(log.openedOptions[1].wantedOps, [.create, .update, .delete])
        XCTAssertTrue(model.isRunning)
        XCTAssertEqual(model.rows.count, 1, "rows survive a reconnect")
        XCTAssertEqual(model.allowedOps, [.create, .update, .delete])

        model.setCollections(["sh.tangled.*"])
        XCTAssertEqual(log.closes, 2)
        XCTAssertEqual(log.openedOptions[2], JetstreamOptions(wantedCollections: ["sh.tangled.*"], wantedOps: [.create, .update, .delete]))
        XCTAssertEqual(model.collections, ["sh.tangled.*"])
        model.ingest(Self.commit("r1"))
        XCTAssertEqual(model.pendingCount, 0, "the new filter applies on ingest")
        model.ingest(Self.commit("r2", collection: "sh.tangled.repo", op: .delete))
        XCTAssertEqual(model.pendingCount, 1)

        model.stop()
        XCTAssertEqual(log.closes, 3)
    }

    func testAutomaticFlushRunsOnTheInterval() async {
        let (stream, continuation) = AsyncStream<JetstreamCommit>.makeStream()
        let source = JetstreamFeedSource { _ in (stream, {}) }
        let model = JetstreamModel(source: source, flushInterval: 0.02)
        model.start()
        continuation.yield(Self.commit("r0"))
        continuation.yield(Self.commit("r1"))
        let flushed = await waitUntil { model.rows.count == 2 }
        XCTAssertTrue(flushed)
        XCTAssertEqual(model.rows.map(\.rkey), ["r1", "r0"])
        XCTAssertEqual(model.stats.total, 2)
        model.stop()
        continuation.finish()
    }
}
