import Foundation
import XCTest
@testable import AturiCore

/// Port of `src/lib/tools/__tests__/accountChecks.test.ts`, plus `keptFor`.
final class AccountChecksTests: XCTestCase {
    private typealias Label = Labels.Label
    private typealias Evidence = Shadowban.Evidence

    private static let did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"
    private static let other = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb"
    private static let third = "did:plc:cccccccccccccccccccccccc"
    /// 2026-11-18T12:00:00Z, `Date.UTC(2026, 10, 18, 12, 0, 0)`.
    private static let nowMs: Int64 = 1_795_003_200_000
    private static let hourMs: Int64 = 60 * 60_000

    private var now: Date { toolsDate(ms: Self.nowMs) }

    private func label(_ src: String, _ val: String, cts: String = "2026-01-01T00:00:00.000Z", exp: String? = nil, neg: Bool = false) -> Label {
        Label(src: src, uri: Self.did, val: val, cts: cts, exp: exp, neg: neg)
    }

    private func post(_ ageMs: Int64, reply: Shadowban.ReplyRef? = nil) -> Shadowban.RepoPost {
        let rkey = toolsTid(ms: Self.nowMs - ageMs)
        return Shadowban.RepoPost(
            uri: "at://\(Self.did)/app.bsky.feed.post/\(rkey)",
            rkey: rkey,
            text: "hello",
            writtenAt: toolsDate(ms: Self.nowMs - ageMs),
            reply: reply
        )
    }

    private static var parent: String {
        "at://\(other)/app.bsky.feed.post/\(toolsTid(ms: nowMs - 10 * hourMs))"
    }

    /// Everything shown: the shadowban checker's clean account.
    private func clean() -> Evidence {
        let ref = Shadowban.ReplyRef(parent: Self.parent, root: Self.parent)
        let posts = [post(2 * Self.hourMs), post(3 * Self.hourMs, reply: ref), post(5 * Self.hourMs)]
        return Evidence(
            target: .account(actor: Self.did),
            appview: Shadowban.defaultAppView,
            checkedAt: now,
            identity: Shadowban.Identity(did: Self.did, handle: "alice.example.com", pds: "https://pds.example.com"),
            repo: .active,
            profile: .found(Shadowban.FoundProfile(handle: "alice.example.com", displayName: "Alice", avatar: nil, labels: [])),
            posts: .ok(posts),
            shown: .ok(posts.map { $0.uri }),
            replies: .ok([Shadowban.ReplyProbe(uri: posts[1].uri, parent: Self.parent, root: Self.parent, thread: .shown)]),
            actorSearch: .ok(Shadowban.ActorSearch(inSearch: true, inTypeahead: true)),
            postSearch: .ok(posts.map { $0.uri }),
            done: true
        )
    }

    // MARK: No Bluesky profile

    func testProfileAbsenceReadsTheAppViewsWordsForAnUnknownSuspendedOrDeactivatedAccount() {
        XCTAssertEqual(AccountChecks.profileAbsence("Profile not found"), .missing)
        XCTAssertEqual(AccountChecks.profileAbsence("Account has been suspended"), .suspended)
        XCTAssertEqual(AccountChecks.profileAbsence("Account is deactivated"), .deactivated)
        XCTAssertEqual(AccountChecks.profileAbsence("something else entirely"), .missing)
    }

    func testTheVisibilityCheckRunsForASuspendedAccountNotForOneBlueskyNeverHad() {
        XCTAssertTrue(AccountChecks.visibilityApplies(nil))
        XCTAssertTrue(AccountChecks.visibilityApplies(.suspended))
        XCTAssertFalse(AccountChecks.visibilityApplies(.missing))
        XCTAssertFalse(AccountChecks.visibilityApplies(.deactivated))
    }

    // MARK: Labels

    func testLabelSummaryCountsLabelsInForceAndTheAccountsBehindThem() {
        let summary = AccountChecks.labelSummary(
            [label(Self.other, "cornerstone"), label(Self.other, "teambsky"), label(Self.third, "bluesky-elder")],
            subjectDid: Self.did,
            now: now
        )
        XCTAssertEqual(summary.active, 3)
        XCTAssertEqual(summary.sources, 2)
        XCTAssertFalse(summary.selfLabelled)
        XCTAssertEqual(summary.moderation, [])
        XCTAssertEqual(AccountChecks.labelSourceWords(summary), "from 2 labelers")
    }

    func testLabelSummaryLeavesOutWithdrawnAndExpiredLabels() {
        let summary = AccountChecks.labelSummary(
            [
                label(Self.other, "spam", neg: true),
                label(Self.third, "old", exp: "2026-01-02T00:00:00.000Z"),
                label(Self.third, "current", exp: "2027-01-01T00:00:00.000Z"),
            ],
            subjectDid: Self.did,
            now: now
        )
        XCTAssertEqual(summary.active, 1)
        XCTAssertEqual(summary.sources, 1)
        XCTAssertEqual(AccountChecks.labelSourceWords(summary), "from 1 labeler")
    }

    func testLabelsFromBlueskysModerationServiceArePickedOutNewestFirst() {
        let summary = AccountChecks.labelSummary(
            [
                label(Labels.blueskyModerationDid, "!warn", cts: "2026-03-01T00:00:00.000Z"),
                label(Labels.blueskyModerationDid, "spam", cts: "2026-05-01T00:00:00.000Z"),
                label(Self.other, "cornerstone"),
            ],
            subjectDid: Self.did,
            now: now
        )
        XCTAssertEqual(summary.moderation, ["spam", "!warn"])
    }

    func testSelfLabelsChangeTheWordingSourcesOrSetByTheAccount() {
        let both = AccountChecks.labelSummary([label(Self.did, "!no-unauthenticated"), label(Self.other, "cornerstone")], subjectDid: Self.did, now: now)
        XCTAssertEqual(AccountChecks.labelSourceWords(both), "from 2 sources")
        let selfOnly = AccountChecks.labelSummary([label(Self.did, "!no-unauthenticated")], subjectDid: Self.did, now: now)
        XCTAssertEqual(AccountChecks.labelSourceWords(selfOnly), "set by the account")
        XCTAssertEqual(AccountChecks.labelSourceWords(AccountChecks.labelSummary([], subjectDid: Self.did, now: now)), "")
    }

    // MARK: Visibility

    func testACleanAccountIsNothingHiddenWithSixPassingOrGreyDots() {
        let summary = AccountChecks.visibilitySummary(clean(), now: now)
        XCTAssertEqual(summary.tone, .pass)
        XCTAssertEqual(summary.short, "Nothing hidden")
        XCTAssertEqual(summary.dots.count, 6)
        XCTAssertEqual(summary.done, 6)
        XCTAssertTrue(summary.dots.allSatisfy { $0.state == .pass || $0.state == .skip })
    }

    func testWhileChecksRunTheDotsSayWhichAreBackAndTheWordsCountThem() {
        var rest = clean()
        rest.shown = nil
        rest.replies = nil
        rest.actorSearch = nil
        rest.postSearch = nil
        rest.done = false
        let summary = AccountChecks.visibilitySummary(rest, now: now)
        XCTAssertEqual(summary.tone, .pending)
        XCTAssertEqual(summary.dots[0].state, .pass)
        XCTAssertEqual(summary.dots[1].state, .pass)
        XCTAssertEqual(summary.dots[2].state, .run)
        XCTAssertEqual(summary.short, "\(summary.done) of 6 checks")

        let fresh = AccountChecks.visibilitySummary(Evidence(target: rest.target, appview: rest.appview), now: now)
        XCTAssertEqual(fresh.done, 0)
        XCTAssertEqual(fresh.short, "Reading the PDS")
    }

    func testLeftOutOfSearchButFoundByTypeaheadIsAFailureTheCardNames() {
        var evidence = clean()
        evidence.actorSearch = .ok(Shadowban.ActorSearch(inSearch: false, inTypeahead: true))
        let summary = AccountChecks.visibilitySummary(evidence, now: now)
        XCTAssertEqual(summary.tone, .fail)
        XCTAssertEqual(summary.short, "Left out of search")
        XCTAssertEqual(summary.dots.first(where: { $0.id == .actorSearch })?.state, .fail)
    }

    func testMoreThanOneFailureKeepsTheFirstAndCountsTheRest() {
        var evidence = clean()
        evidence.actorSearch = .ok(Shadowban.ActorSearch(inSearch: false, inTypeahead: true))
        evidence.shown = .ok([])
        let summary = AccountChecks.visibilitySummary(evidence, now: now)
        XCTAssertEqual(summary.tone, .fail)
        XCTAssertEqual(summary.short, "Posts missing")
        XCTAssertGreaterThanOrEqual(summary.more, 1)
    }

    func testASuspensionADeactivationAndAProfileBlueskyNeverHadEachGetTheirOwnWords() {
        var suspended = clean()
        suspended.profile = .suspended(message: "Account has been suspended")
        let suspendedSummary = AccountChecks.visibilitySummary(suspended, now: now)
        XCTAssertEqual(suspendedSummary.tone, .fail)
        XCTAssertEqual(suspendedSummary.short, "Suspended")

        var deactivated = clean()
        deactivated.profile = .deactivated(message: "Account is deactivated")
        XCTAssertEqual(AccountChecks.visibilitySummary(deactivated, now: now).short, "Deactivated")
        XCTAssertEqual(AccountChecks.visibilitySummary(deactivated, now: now).tone, .info)

        var missing = clean()
        missing.profile = .missing(message: "Profile not found")
        XCTAssertEqual(AccountChecks.visibilitySummary(missing, now: now).short, "No profile on Bluesky")
    }

    func testModerationLabelsOnTheProfileAreAWarningNamedAsBlueskys() {
        var evidence = clean()
        evidence.profile = .found(Shadowban.FoundProfile(
            handle: "alice.example.com",
            displayName: "Alice",
            avatar: nil,
            labels: [Shadowban.ProfileLabel(val: "!warn", src: Labels.blueskyModerationDid)]
        ))
        let summary = AccountChecks.visibilitySummary(evidence, now: now)
        XCTAssertEqual(summary.tone, .warn)
        XCTAssertEqual(summary.short, "Labelled by Bluesky")
    }

    func testAnAccountItsPDSHasSwitchedOffIsNotTheAppViewsDoing() {
        var evidence = clean()
        evidence.repo = .inactive(status: "takendown")
        let summary = AccountChecks.visibilitySummary(evidence, now: now)
        XCTAssertEqual(summary.tone, .warn)
        XCTAssertEqual(summary.short, "Not active on its PDS")
    }

    // MARK: Kept results

    func testKeptForSaysHowOldAKeptResultIsAndNothingForAFreshOne() {
        XCTAssertNil(AccountChecks.keptFor(nil, now: now))
        XCTAssertNil(AccountChecks.keptFor(now.addingTimeInterval(-59), now: now))
        XCTAssertEqual(AccountChecks.keptFor(now.addingTimeInterval(-4 * 60 - 30), now: now), "4 min ago")
    }
}
