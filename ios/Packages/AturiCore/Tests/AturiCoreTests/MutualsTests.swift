import Foundation
import XCTest
@testable import AturiCore

/// Port of `src/lib/tools/__tests__/mutuals.test.ts`, without the orbit
/// map and the session-storage snapshot, which the app does not have.
final class MutualsTests: XCTestCase {
    private func did(_ n: Int) -> String {
        let digits = String(n)
        return "did:plc:" + String(repeating: "a", count: max(0, 24 - digits.count)) + digits
    }

    /// A tally from blocked account to its blockers, built the way a scan builds it.
    private func tallyOf(_ blocks: [(mutual: Int, subjects: [Int])]) -> Mutuals.Tally {
        var tally: Mutuals.Tally = [:]
        for (mutual, subjects) in blocks {
            var seen = Set<String>()
            for subject in subjects {
                Mutuals.tallyBlock(&tally, seen: &seen, mutual: mutual, subject: did(subject))
            }
        }
        return tally
    }

    func testReadsAccountsAndRefusesEverythingElse() {
        XCTAssertEqual(Mutuals.parseAccountInput("alice.example.com"), .ok(actor: "alice.example.com"))
        XCTAssertEqual(Mutuals.parseAccountInput(did(1)), .ok(actor: did(1)))
        XCTAssertEqual(Mutuals.parseAccountInput("https://bsky.app/profile/alice.example.com"), .ok(actor: "alice.example.com"))
        let post = Mutuals.parseAccountInput("https://bsky.app/profile/alice.example.com/post/3n22yg6lg2k2f")
        guard case .invalid(let reason) = post else {
            return XCTFail("a post is not an account")
        }
        XCTAssertTrue(reason.contains("Mutuals belong to accounts"), reason)
        guard case .invalid = Mutuals.parseAccountInput("  ") else {
            return XCTFail("blank input is not an account")
        }
    }

    func testAThresholdIsAWholeNumberFromOne() {
        XCTAssertEqual(Mutuals.parseThreshold("3"), 3)
        XCTAssertNil(Mutuals.parseThreshold("0"))
        XCTAssertNil(Mutuals.parseThreshold("-2"))
        XCTAssertNil(Mutuals.parseThreshold("2.5"))
        XCTAssertNil(Mutuals.parseThreshold(""))
        XCTAssertNil(Mutuals.parseThreshold("123456"))
    }

    func testMutualsAreFoundTheCheaperWay() {
        // 600 followers is 6 pages; 800 follows is 27 relationship checks.
        XCTAssertEqual(Mutuals.mutualStrategy(follows: 800, followers: 600), .followers)
        // 200,000 followers would be 2,000 pages.
        XCTAssertEqual(Mutuals.mutualStrategy(follows: 500, followers: 200_000), .relationships)
        // Past what can be paged through, followers are never complete.
        XCTAssertEqual(Mutuals.mutualStrategy(follows: 100_000, followers: 30_000), .relationships)
        XCTAssertEqual(Mutuals.mutualStrategy(follows: 0, followers: 0), .followers)
    }

    func testAvatarURLsAreSwappedForThumbnailsOtherURLsLeftAlone() {
        XCTAssertEqual(
            Mutuals.avatarThumb("https://cdn.bsky.app/img/avatar/plain/did:plc:x/bafy@jpeg"),
            "https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:x/bafy@jpeg"
        )
        XCTAssertEqual(Mutuals.avatarThumb("https://example.com/a.png"), "https://example.com/a.png")
        XCTAssertNil(Mutuals.avatarThumb(nil))
        XCTAssertNil(Mutuals.cleanHandle("handle.invalid"))
        XCTAssertEqual(Mutuals.cleanHandle("alice.example.com"), "alice.example.com")
    }

    func testOnlyWellFormedBlockAndListblockRecordsAreRead() {
        XCTAssertEqual(Mutuals.readBlockSubject(["subject": .string(did(1)), "createdAt": ""]), did(1))
        XCTAssertNil(Mutuals.readBlockSubject(["subject": "alice.example.com"]))
        XCTAssertNil(Mutuals.readBlockSubject(["subject": 3]))
        XCTAssertNil(Mutuals.readBlockSubject(nil))
        XCTAssertNil(Mutuals.readBlockSubject(.null))
        let list = "at://\(did(2))/app.bsky.graph.list/3kabc"
        XCTAssertEqual(Mutuals.readListBlockSubject(["subject": .string(list)]), list)
        XCTAssertNil(Mutuals.readListBlockSubject(["subject": .string("at://\(did(2))/app.bsky.feed.post/3kabc")]))
    }

    func testOnePersonBlockingAnAccountTwiceCountsOnce() {
        var tally: Mutuals.Tally = [:]
        var seen = Set<String>()
        XCTAssertTrue(Mutuals.tallyBlock(&tally, seen: &seen, mutual: 0, subject: did(9)))
        XCTAssertFalse(Mutuals.tallyBlock(&tally, seen: &seen, mutual: 0, subject: did(9)))
        var other = Set<String>()
        XCTAssertTrue(Mutuals.tallyBlock(&tally, seen: &other, mutual: 1, subject: did(9)))
        XCTAssertEqual(tally[did(9)], [0, 1])
    }

    func testTheDistributionCountsAccountsByHowManyMutualsBlockThem() {
        let tally = tallyOf([(0, [1, 2, 3]), (1, [1, 2]), (2, [1]), (3, [4])])
        // did(1): 3 blockers; did(2): 2; did(3), did(4): 1 each.
        let counts = Mutuals.histogram(tally)
        XCTAssertEqual(counts, [0, 2, 1, 1])
        XCTAssertEqual(Mutuals.countAtLeast(counts, 1), 4)
        XCTAssertEqual(Mutuals.countAtLeast(counts, 2), 2)
        XCTAssertEqual(Mutuals.countAtLeast(counts, 4), 0)
        XCTAssertEqual(Mutuals.highestCount(counts), 3)
        XCTAssertEqual(Mutuals.highestCount([0]), 0)
        XCTAssertEqual(Mutuals.histogram(tally, exclude: [did(1)]), [0, 2, 1])
    }

    func testBinsHoldOneCountEachUntilThereAreTooMany() {
        XCTAssertEqual(Mutuals.histogramBins([0, 5, 0, 2]), [
            Mutuals.Bin(from: 1, to: 1, count: 5),
            Mutuals.Bin(from: 2, to: 2, count: 0),
            Mutuals.Bin(from: 3, to: 3, count: 2),
        ])
        let wide = [0] + Array(repeating: 1, count: 100)
        let bins = Mutuals.histogramBins(wide, maxBins: 40)
        XCTAssertLessThanOrEqual(bins.count, 40)
        XCTAssertEqual(bins.first?.from, 1)
        XCTAssertEqual(bins.last?.to, 100)
        XCTAssertEqual(bins.reduce(0) { $0 + $1.count }, 100)
        XCTAssertEqual(Mutuals.histogramBins([0]), [])
    }

    func testTheSuggestedThresholdGrowsWithTheMutualsAndNeverEmptiesTheList() {
        let many = [0, 500, 200, 100, 50, 25, 12, 6, 3, 2, 1, 1]
        XCTAssertEqual(Mutuals.suggestThreshold(mutualsRead: 40, counts: many), 2)
        XCTAssertEqual(Mutuals.suggestThreshold(mutualsRead: 100, counts: many), 5)
        XCTAssertEqual(Mutuals.suggestThreshold(mutualsRead: 1000, counts: many), 10)
        // Nobody is blocked by more than two of them.
        XCTAssertEqual(Mutuals.suggestThreshold(mutualsRead: 300, counts: [0, 40, 3]), 2)
        XCTAssertEqual(Mutuals.suggestThreshold(mutualsRead: 300, counts: [0, 40]), 1)
        XCTAssertEqual(Mutuals.suggestThreshold(mutualsRead: 300, counts: [0]), 1)
    }

    func testCandidatesAreRankedByBlockersThenByDID() {
        let tally = tallyOf([(0, [1, 2, 3]), (1, [3, 2]), (2, [3])])
        let ranked = Mutuals.rankCandidates(tally, threshold: 2)
        XCTAssertEqual(ranked.map(\.did), [did(3), did(2)])
        XCTAssertEqual(ranked.map(\.blockers.count), [3, 2])
        XCTAssertEqual(Mutuals.rankCandidates(tally, threshold: 1, exclude: [did(3)]).map(\.did), [did(2), did(1)])
    }

    func testWhatAPersonAlreadyChoseStartsOutUnticked() {
        let none = Mutuals.CandidateFlags()
        XCTAssertTrue(Mutuals.selectedByDefault(none))
        XCTAssertTrue(Mutuals.selectedByDefault(Mutuals.CandidateFlags(blocked: true)))
        XCTAssertFalse(Mutuals.selectedByDefault(Mutuals.CandidateFlags(followed: true)))
        XCTAssertFalse(Mutuals.selectedByDefault(Mutuals.CandidateFlags(mutual: true)))
        XCTAssertFalse(Mutuals.selectedByDefault(Mutuals.CandidateFlags(missing: true)))
    }

    func testBlockListsAreRankedBySubscribers() {
        let a = "at://\(did(1))/app.bsky.graph.list/a"
        let b = "at://\(did(1))/app.bsky.graph.list/b"
        let ranked = Mutuals.rankListBlocks([a: [0], b: [0, 1, 2]])
        XCTAssertEqual(ranked.map(\.uri), [b, a])
        XCTAssertEqual(Mutuals.rankListBlocks([a: [0]], min: 2), [])
    }

    func testListNamesAndDescriptionsAreHeldToTheLexicon() {
        XCTAssertNil(Mutuals.listNameProblem("Blocked by my mutuals"))
        XCTAssertTrue(Mutuals.listNameProblem("   ")?.contains("name") ?? false)
        XCTAssertTrue(Mutuals.listNameProblem(String(repeating: "x", count: 65))?.contains("too long") ?? false)
        // 64 bytes is the limit, not 64 characters: each of these is four.
        XCTAssertTrue(Mutuals.listNameProblem(String(repeating: "\u{1F642}", count: 17))?.contains("too long") ?? false)
        XCTAssertNil(Mutuals.listNameProblem(String(repeating: "\u{1F642}", count: 16)))
        XCTAssertNil(Mutuals.listDescriptionProblem(String(repeating: "a", count: 300)))
        XCTAssertTrue(Mutuals.listDescriptionProblem(String(repeating: "a", count: 301))?.contains("301") ?? false)
        let date = Date(timeIntervalSince1970: 1_795_003_200)  // 2026-11-18T12:00:00Z
        XCTAssertNil(Mutuals.listDescriptionProblem(Mutuals.defaultListDescription(threshold: 3, mutualsRead: 1234, date: date)))
    }

    func testTheDefaultDescriptionSaysWhatTheListIs() {
        let date = Date(timeIntervalSince1970: 1_795_003_200)  // 2026-11-18T12:00:00Z
        let text = Mutuals.defaultListDescription(threshold: 3, mutualsRead: 1234, date: date)
        XCTAssertTrue(text.contains("at least 3 of the 1,234 mutuals"), text)
        XCTAssertTrue(text.contains("2026-11-18"), text)
        XCTAssertTrue(Mutuals.defaultListDescription(threshold: 1, mutualsRead: 5, date: date).contains("at least one of the 5"))
    }

    func testTheListAndItsMembersAreWrittenAsModerationListRecords() {
        XCTAssertEqual(Mutuals.listRecord(name: "  Mine ", description: " ", createdAt: "2026-11-18T00:00:00.000Z"), [
            "$type": "app.bsky.graph.list",
            "purpose": "app.bsky.graph.defs#modlist",
            "name": "Mine",
            "createdAt": "2026-11-18T00:00:00.000Z",
        ])
        XCTAssertEqual(Mutuals.listRecord(name: "Mine", description: "Why", createdAt: "")["description"], "Why")

        let list = "at://\(did(1))/app.bsky.graph.list/3kabc"
        let writes = Mutuals.listItemWrites(list: list, subjects: [did(2), did(3)], createdAt: "2026-11-18T00:00:00.000Z")
        XCTAssertEqual(writes.count, 2)
        XCTAssertEqual(writes[0], [
            "$type": "com.atproto.repo.applyWrites#create",
            "collection": "app.bsky.graph.listitem",
            "value": [
                "$type": "app.bsky.graph.listitem",
                "subject": .string(did(2)),
                "list": .string(list),
                "createdAt": "2026-11-18T00:00:00.000Z",
            ],
        ])
        XCTAssertEqual(Mutuals.listBlockRecord(list: list, createdAt: "x"), [
            "$type": "app.bsky.graph.listblock",
            "subject": .string(list),
            "createdAt": "x",
        ])
    }

    func testMembersGoInBatchesApplyWritesAcceptsAndCostThreePointsEach() {
        let subjects = (0..<450).map { did($0) }
        let batches = Mutuals.chunk(subjects, size: Mutuals.applyWritesMax)
        XCTAssertEqual(batches.map(\.count), [200, 200, 50])
        XCTAssertEqual(Array(batches.joined()), subjects)
        XCTAssertEqual(Mutuals.savePoints(members: 450, block: false), 451 * Mutuals.createPoints)
        XCTAssertEqual(Mutuals.savePoints(members: 450, block: true), 452 * Mutuals.createPoints)
    }

    func testAListURIBecomesItsBlueskyPage() {
        XCTAssertEqual(
            Mutuals.bskyListUrl("at://\(did(1))/app.bsky.graph.list/3kabc"),
            "https://bsky.app/profile/\(did(1))/lists/3kabc"
        )
        XCTAssertNil(Mutuals.bskyListUrl("at://\(did(1))/app.bsky.feed.post/3kabc"))
    }

    func testTheSummaryReadsAsASentence() {
        XCTAssertEqual(Mutuals.summary(matching: 1204, threshold: 3, mutualsRead: 312), "1,204 accounts are blocked by at least 3 of 312 mutuals")
        XCTAssertEqual(Mutuals.summary(matching: 1, threshold: 1, mutualsRead: 1), "1 account is blocked by at least one of 1 mutual")
    }

    func testAScopeAllowsTheListOnlyWhenItAllowsCreatingEachRecord() {
        let both = ["app.bsky.graph.list", "app.bsky.graph.listitem"]
        XCTAssertEqual(Mutuals.scopeAllowsCreate("atproto repo:*?action=create repo:*?action=delete", collections: both), true)
        XCTAssertEqual(Mutuals.scopeAllowsCreate("atproto transition:generic", collections: both), true)
        XCTAssertEqual(Mutuals.scopeAllowsCreate("atproto repo:*", collections: both), true)
        XCTAssertEqual(Mutuals.scopeAllowsCreate("atproto repo:*?action=delete", collections: both), false)
        XCTAssertEqual(Mutuals.scopeAllowsCreate("atproto repo:app.bsky.graph.list?action=create", collections: both), false)
        XCTAssertEqual(
            Mutuals.scopeAllowsCreate("atproto repo?collection=app.bsky.graph.list&collection=app.bsky.graph.listitem&action=create", collections: both),
            true
        )
        XCTAssertEqual(Mutuals.scopeAllowsCreate("atproto", collections: both), false)
        XCTAssertNil(Mutuals.scopeAllowsCreate(nil, collections: both))
        // What the app's own sign-in grants when Create is ticked.
        XCTAssertEqual(Mutuals.scopeAllowsCreate(Scopes.buildScopeString([.create]), collections: both), true)
        XCTAssertEqual(Mutuals.scopeAllowsCreate(Scopes.buildScopeString([.delete]), collections: both), false)
    }

    func testAMutualsMarkSaysWhereItsReadingGotTo() {
        let person = MutualsPerson(did: did(1), handle: "b.example.com")
        XCTAssertEqual(MutualsReadState.queued.title(for: person), "@b.example.com: waiting")
        XCTAssertEqual(MutualsReadState.done(blocks: 1, listBlocks: 2).title(for: person), "@b.example.com: 1 block, 2 block lists")
        XCTAssertEqual(
            MutualsReadState.skipped(blocks: 0, reason: "its PDS did not answer", stopped: false).title(for: person),
            "@b.example.com: not read, its PDS did not answer"
        )
        XCTAssertTrue(MutualsReadState.skipped(blocks: 3, reason: "stopped", stopped: true).countsAsRead)
        XCTAssertFalse(MutualsReadState.skipped(blocks: 0, reason: "stopped", stopped: true).countsAsRead)
        XCTAssertFalse(MutualsReadState.reading(blocks: 0).countsAsRead)
    }

    func testAProfileViewBecomesAPerson() throws {
        let view = try JSONValue.parse(Data(#"{"did":"did:plc:abc","handle":"handle.invalid","displayName":"  ","avatar":"https://cdn.bsky.app/img/avatar/plain/x"}"#.utf8))
        XCTAssertEqual(
            MutualsPerson(profile: view),
            MutualsPerson(did: "did:plc:abc", handle: nil, displayName: nil, avatar: "https://cdn.bsky.app/img/avatar_thumbnail/plain/x")
        )
        XCTAssertNil(MutualsPerson(profile: ["handle": "x"]))
    }
}
