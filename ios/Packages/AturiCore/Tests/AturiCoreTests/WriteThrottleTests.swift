import Foundation
import XCTest
@testable import AturiCore

final class WriteThrottleTests: XCTestCase {
    private let did = "did:plc:throttletestacct0001"
    private var suite = ""
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suite = "aturi.tests.throttle.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        super.tearDown()
    }

    func testConstantsMatchTheWeb() {
        XCTAssertEqual(WriteThrottle.pointsWindow, 3600)
        XCTAssertEqual(WriteThrottle.hourlyPointBudget, 5000)
        XCTAssertEqual(WriteThrottle.throttlePointBudget, 4500)
        XCTAssertEqual(WriteThrottle.deletePointCost, 1)
        XCTAssertEqual(WriteThrottle.storageKey(did), "aturi:writeSpend:\(did)")
    }

    func testFreshLedgerHasTheWholeBudget() {
        let throttle = WriteThrottle(defaults: defaults)
        XCTAssertEqual(throttle.pointsSpent(did), 0)
        XCTAssertEqual(throttle.pointsAvailable(did), 4500)
        XCTAssertEqual(throttle.secondsUntilBudget(did, needed: 200), 0)
    }

    func testSpendsAccumulateAndAgeOutOfTheWindow() {
        let throttle = WriteThrottle(defaults: defaults)
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        throttle.recordSpend(did, points: 1000, now: start)
        throttle.recordSpend(did, points: 500, now: start.addingTimeInterval(60))
        throttle.recordSpend(did, points: 0, now: start.addingTimeInterval(61))
        XCTAssertEqual(throttle.pointsSpent(did, now: start.addingTimeInterval(120)), 1500)
        XCTAssertEqual(throttle.pointsAvailable(did, now: start.addingTimeInterval(120)), 3000)
        // The first spend falls out of the trailing hour before the second.
        XCTAssertEqual(throttle.pointsSpent(did, now: start.addingTimeInterval(3601)), 500)
        XCTAssertEqual(throttle.pointsSpent(did, now: start.addingTimeInterval(3661)), 0)
    }

    func testWaitIsUntilEnoughOldSpendsHaveFreed() {
        let throttle = WriteThrottle(defaults: defaults)
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        throttle.recordSpend(did, points: 2000, now: start)
        throttle.recordSpend(did, points: 2000, now: start.addingTimeInterval(600))
        let now = start.addingTimeInterval(1200)
        // 4000 spent; 400 more fits, 600 does not until the first spend ages out.
        XCTAssertEqual(throttle.secondsUntilBudget(did, needed: 400, now: now), 0)
        XCTAssertEqual(throttle.secondsUntilBudget(did, needed: 600, now: now), 3600 - 1200, accuracy: 0.001)
        // Needing more than the first spend frees waits for the second too.
        XCTAssertEqual(throttle.secondsUntilBudget(did, needed: 2600, now: now), 600 + 3600 - 1200, accuracy: 0.001)
    }

    func testLedgersAreKeyedByDidAndSurviveAFreshInstance() {
        let throttle = WriteThrottle(defaults: defaults)
        throttle.recordSpend(did, points: 10)
        throttle.recordSpend("did:plc:someoneelse0000000001", points: 20)
        XCTAssertEqual(WriteThrottle(defaults: defaults).pointsSpent(did), 10)
        XCTAssertEqual(WriteThrottle(defaults: defaults).pointsSpent("did:plc:someoneelse0000000001"), 20)
        throttle.clear(did)
        XCTAssertEqual(throttle.pointsSpent(did), 0)
        XCTAssertEqual(throttle.pointsSpent("did:plc:someoneelse0000000001"), 20)
    }

    func testAMalformedLedgerReadsAsEmpty() {
        defaults.set("not json".data(using: .utf8), forKey: WriteThrottle.storageKey(did))
        XCTAssertEqual(WriteThrottle(defaults: defaults).pointsSpent(did), 0)
    }
}
