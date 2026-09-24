import XCTest
@testable import AturiCore

final class TTLCacheTests: XCTestCase {
    /// A clock the test advances by hand.
    private final class ManualClock: @unchecked Sendable {
        private let lock = NSLock()
        private var current = Date(timeIntervalSince1970: 1_700_000_000)
        var now: Date {
            lock.lock(); defer { lock.unlock() }
            return current
        }
        func advance(_ seconds: TimeInterval) {
            lock.lock(); defer { lock.unlock() }
            current = current.addingTimeInterval(seconds)
        }
    }

    func testSetThenGetWithinTTL() async {
        let clock = ManualClock()
        let cache = TTLCache<String, String>(ttl: 300) { clock.now }
        await cache.set("dame.is", "did:plc:example")
        clock.advance(299)
        let hit = await cache.get("dame.is")
        XCTAssertEqual(hit, "did:plc:example")
        let count = await cache.count
        XCTAssertEqual(count, 1)
    }

    func testEntryExpiresAfterTTL() async {
        let clock = ManualClock()
        let cache = TTLCache<String, Int>(ttl: 60) { clock.now }
        await cache.set("k", 1)
        clock.advance(60)
        let expired = await cache.get("k")
        XCTAssertNil(expired)
        let count = await cache.count
        XCTAssertEqual(count, 0)
    }

    func testSetRefreshesExpiry() async {
        let clock = ManualClock()
        let cache = TTLCache<String, Int>(ttl: 10) { clock.now }
        await cache.set("k", 1)
        clock.advance(8)
        await cache.set("k", 2)
        clock.advance(8)
        let value = await cache.get("k")
        XCTAssertEqual(value, 2)
    }

    func testRemoveAndClear() async {
        let cache = TTLCache<Int, String>(ttl: 100)
        await cache.set(1, "one")
        await cache.set(2, "two")
        await cache.remove(1)
        let one = await cache.get(1)
        let two = await cache.get(2)
        XCTAssertNil(one)
        XCTAssertEqual(two, "two")
        await cache.clear()
        let afterClear = await cache.get(2)
        XCTAssertNil(afterClear)
    }

    func testMissingKeyIsNil() async {
        let cache = TTLCache<String, String>(ttl: 5)
        let value = await cache.get("nope")
        XCTAssertNil(value)
    }

    func testRealClockExpiry() async throws {
        let cache = TTLCache<String, Int>(ttl: 0.05)
        await cache.set("k", 1)
        let before = await cache.get("k")
        XCTAssertEqual(before, 1)
        try await Task.sleep(nanoseconds: 120_000_000)
        let after = await cache.get("k")
        XCTAssertNil(after)
    }
}
