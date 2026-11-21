import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A clock a test moves by hand.
private final class ChecksTestClock: @unchecked Sendable {
    var now: Date

    init(_ now: Date) {
        self.now = now
    }
}

@MainActor
final class AccountChecksModelTests: XCTestCase {
    private func store(_ transport: ChecksFakeTransport, clock: ChecksTestClock? = nil, grace: TimeInterval = 2) -> AccountChecksStore {
        let clock = clock ?? ChecksTestClock(ChecksFixture.now)
        return AccountChecksStore(http: HTTPClient(transport: transport), clock: { clock.now }, grace: grace)
    }

    private func labelRequests(_ transport: ChecksFakeTransport) -> Int {
        transport.count(containing: ChecksFixture.profileRoute) - visibilityProfileRequests(transport)
    }

    /// The visibility run's getProfile carries no labelers header.
    private func visibilityProfileRequests(_ transport: ChecksFakeTransport) -> Int {
        transport.requests(containing: ChecksFixture.profileRoute)
            .filter { $0.value(forHTTPHeaderField: "atproto-accept-labelers") == nil }
            .count
    }

    func testTheLabelCheckRunsFirstThenTheScanAndTheVisibilityCheck() async {
        let transport = ChecksFixture.transport()
        let model = store(transport).model(for: ChecksFixture.identity)
        XCTAssertEqual(model.labelState(now: ChecksFixture.now), .asking)
        XCTAssertEqual(model.visibilityState(now: ChecksFixture.now), .waiting)

        model.retain()
        XCTAssertEqual(model.base.status, .loading)
        XCTAssertEqual(model.visibility.status, .idle, "visibility waits for the first label answer")
        await model.waitForRuns()

        guard case .done(let summary, let progress, let stopped, _) = model.labelState(now: ChecksFixture.now) else {
            return XCTFail("the label check finished: \(model.labelState(now: ChecksFixture.now))")
        }
        XCTAssertEqual(summary.active, 1)
        XCTAssertEqual(AccountChecks.labelSourceWords(summary), "from 1 labeler")
        XCTAssertEqual(progress.total, 3)
        XCTAssertFalse(stopped)

        guard case .done(let visibility, _) = model.visibilityState(now: ChecksFixture.now) else {
            return XCTFail("the visibility check finished: \(model.visibilityState(now: ChecksFixture.now))")
        }
        XCTAssertEqual(visibility.tone, .pass)
        XCTAssertEqual(visibility.short, "Nothing hidden")
        XCTAssertEqual(visibility.done, 6)

        // Every visibility request came after the first label answer.
        let urls = transport.urls
        let firstLabel = urls.firstIndex { $0.contains(ChecksFixture.profileRoute) } ?? Int.max
        let firstVisibility = urls.firstIndex { $0.contains(ChecksFixture.listRecordsRoute) } ?? -1
        XCTAssertLessThan(firstLabel, firstVisibility)
        XCTAssertEqual(model.allLabels.map { $0.val }, ["cornerstone"])
        XCTAssertEqual(model.labelers[ChecksFixture.labeler]?.displayName, "Labeler One")
        XCTAssertEqual(model.labelers[Labels.blueskyModerationDid]?.handle, "moderation.bsky.app")
    }

    func testAnAccountWithNoBlueskyProfileSaysSoOnBothRowsAndSendsNoVisibilityRequests() async {
        let transport = ChecksFixture.transport([(ChecksFixture.profileRoute, ChecksFakeTransport.reply(400, ChecksFixture.notFound))])
        let model = store(transport).model(for: ChecksFixture.identity)
        model.retain()
        await model.waitForRuns()

        XCTAssertEqual(model.labelState(now: ChecksFixture.now), .absent(absence: .missing, message: "Profile not found"))
        XCTAssertEqual(model.visibilityState(now: ChecksFixture.now), .absent(.missing))
        XCTAssertEqual(transport.count(containing: ChecksFixture.listRecordsRoute), 0)
        XCTAssertEqual(transport.count(containing: ChecksFixture.repoStatusRoute), 0)
        // Nothing to scan for either.
        XCTAssertEqual(transport.count(containing: ChecksFixture.relayRoute), 0)
    }

    func testASuspendedAccountStillRunsTheVisibilityCheck() async {
        let takedown = #"{"error":"AccountTakedown","message":"Account has been suspended"}"#
        let transport = ChecksFixture.transport([(ChecksFixture.profileRoute, ChecksFakeTransport.reply(400, takedown))])
        let model = store(transport).model(for: ChecksFixture.identity)
        model.retain()
        await model.waitForRuns()

        XCTAssertEqual(model.labelState(now: ChecksFixture.now), .absent(absence: .suspended, message: "Account has been suspended"))
        guard case .done(let summary, _) = model.visibilityState(now: ChecksFixture.now) else {
            return XCTFail("a suspended account is still compared")
        }
        XCTAssertEqual(summary.short, "Suspended")
        XCTAssertEqual(summary.tone, .fail)
    }

    func testEveryViewOfAnAccountJoinsTheSameRuns() async {
        let transport = ChecksFixture.transport()
        let shared = store(transport)
        let card = shared.model(for: ChecksFixture.identity)
        let tab = shared.model(for: ChecksFixture.identity)
        XCTAssertTrue(card === tab)

        card.retain()
        tab.retain()
        await card.waitForRuns()
        tab.retain()
        await tab.waitForRuns()

        // One first answer and one scan batch; one visibility run.
        XCTAssertEqual(labelRequests(transport), 2)
        XCTAssertEqual(visibilityProfileRequests(transport), 1)
        XCTAssertEqual(transport.count(containing: ChecksFixture.listRecordsRoute), 1)
        XCTAssertEqual(shared.count, 1)
    }

    func testAResultIsKeptForTenMinutesThenAskedAgain() async {
        let transport = ChecksFixture.transport()
        let clock = ChecksTestClock(ChecksFixture.now)
        let shared = store(transport, clock: clock)
        let model = shared.model(for: ChecksFixture.identity)
        model.retain()
        await model.waitForRuns()
        model.release()

        clock.now = ChecksFixture.now.addingTimeInterval(9 * 60)
        guard case .done(_, _, _, let settledAt) = model.labelState(now: clock.now) else {
            return XCTFail("the label check finished")
        }
        XCTAssertEqual(AccountChecks.keptFor(settledAt, now: clock.now), "9 min ago")
        model.retain()
        await model.waitForRuns()
        XCTAssertEqual(labelRequests(transport), 2, "kept: no new requests")
        model.release()

        clock.now = ChecksFixture.now.addingTimeInterval(AccountChecksModel.ttl + 60)
        // Past the TTL with nobody watching, the store lets the account go
        // and the next view starts over.
        let fresh = shared.model(for: ChecksFixture.identity)
        XCTAssertFalse(fresh === model)
        fresh.retain()
        await fresh.waitForRuns()
        XCTAssertEqual(labelRequests(transport), 4)
        XCTAssertEqual(transport.count(containing: ChecksFixture.listRecordsRoute), 2)
    }

    func testAFailedScanKeepsTheFirstAnswerAndOffersARetry() async {
        let transport = ChecksFixture.transport([(ChecksFixture.relayRoute, ChecksFakeTransport.reply(500, "oops"))])
        let model = store(transport).model(for: ChecksFixture.identity)
        model.retain()
        await model.waitForRuns()

        guard case .error(let message, let summary) = model.labelState(now: ChecksFixture.now) else {
            return XCTFail("the scan failed")
        }
        XCTAssertEqual(message, "The relay answered HTTP 500")
        XCTAssertEqual(summary?.active, 0)
        // The visibility check does not depend on the scan.
        XCTAssertEqual(model.visibility.status, .done)

        model.retryLabels()
        XCTAssertEqual(model.scan.status, .loading)
        XCTAssertEqual(model.base.status, .done, "retry starts only the part that failed")
        await model.waitForRuns()
        XCTAssertEqual(transport.count(containing: ChecksFixture.relayRoute), 2)
    }

    func testAnUnwatchedRunIsCancelledAfterTheGraceAndStartsOverWhenWatchedAgain() async throws {
        let transport = ChecksFixture.transport(delayNanoseconds: 2_000_000_000)
        let model = store(transport, grace: 0.05).model(for: ChecksFixture.identity)
        model.retain()
        XCTAssertEqual(model.base.status, .loading)
        model.release()
        // Wait for the abort rather than a fixed beat, so a slow CI host
        // cannot outrun the 50ms grace; the 2s transport delay bounds it.
        let deadline = Date().addingTimeInterval(3)
        while model.isRunning, Date() < deadline {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertEqual(model.base.status, .idle)
        XCTAssertFalse(model.isRunning)

        model.retain()
        XCTAssertEqual(model.base.status, .loading)
        model.restart()
        XCTAssertEqual(model.base.status, .loading)
    }

    func testAViewThatComesBackWithinTheGraceKeepsTheRun() async throws {
        let transport = ChecksFixture.transport(delayNanoseconds: 300_000_000)
        let model = store(transport, grace: 0.1).model(for: ChecksFixture.identity)
        model.retain()
        model.release()
        model.retain()
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(model.base.status, .loading, "still the first run")
        await model.waitForRuns()
        XCTAssertEqual(labelRequests(transport), 2)
    }
}
