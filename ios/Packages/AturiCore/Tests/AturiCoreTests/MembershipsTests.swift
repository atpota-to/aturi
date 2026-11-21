import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Port of `src/lib/tools/__tests__/memberships.test.ts`.
final class MembershipsTests: XCTestCase {
    private static let did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"
    private static let curator = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb"

    private func list(_ rkey: String, _ purpose: Memberships.ListPurpose) -> Memberships.ListInfo {
        Memberships.ListInfo(
            uri: "at://\(Self.curator)/app.bsky.graph.list/\(rkey)",
            name: "List \(rkey)",
            purpose: purpose,
            description: nil,
            avatar: nil,
            memberCount: 3,
            creator: Memberships.ListCreator(did: Self.curator, handle: "curator.example.com", displayName: nil)
        )
    }

    /// A membership of `info`; with no `info`, of a list that is gone
    /// unless `unread` says the item itself could not be read.
    private func membership(_ rkey: String, _ info: Memberships.ListInfo?, unread: Bool = false) -> Memberships.Membership {
        let listUri: String? = unread ? nil : (info?.uri ?? "at://\(Self.curator)/app.bsky.graph.list/gone-\(rkey)")
        return Memberships.Membership(
            itemUri: "at://\(Self.curator)/app.bsky.graph.listitem/\(rkey)",
            listUri: listUri,
            addedAt: nil,
            list: info
        )
    }

    func testParseAccountInputTakesAccountsAndTurnsPostsAway() {
        XCTAssertEqual(Memberships.parseAccountInput("@Alice.Example.com"), .ok(actor: "alice.example.com"))
        XCTAssertEqual(Memberships.parseAccountInput(Self.did), .ok(actor: Self.did))
        XCTAssertEqual(Memberships.parseAccountInput("https://bsky.app/profile/alice.example.com"), .ok(actor: "alice.example.com"))
        let post = Memberships.parseAccountInput("at://\(Self.did)/app.bsky.feed.post/3kabc")
        XCTAssertNil(post.actor)
        XCTAssertTrue(post.reason?.contains("belong to accounts") ?? false)
        // The label checker's wording about labels never leaks into this tool.
        let other = Memberships.parseAccountInput("at://\(Self.did)/app.bsky.graph.follow/3kabc")
        XCTAssertTrue(other.reason?.contains("belong to accounts") ?? false)
        XCTAssertNil(Memberships.parseAccountInput("  ").actor)
    }

    func testListPurposeReadsTheThreePurposesFromTheirTokens() {
        XCTAssertEqual(Memberships.listPurpose("app.bsky.graph.defs#curatelist"), .curate)
        XCTAssertEqual(Memberships.listPurpose("app.bsky.graph.defs#modlist"), .mod)
        XCTAssertEqual(Memberships.listPurpose("app.bsky.graph.defs#referencelist"), .reference)
        XCTAssertEqual(Memberships.listPurpose("app.example.defs#somethingelse"), .other)
        XCTAssertEqual(Memberships.listPurpose(nil), .other)
    }

    func testRecordedAtPrefersTheRecordsOwnDateAndFallsBackToItsKey() {
        XCTAssertEqual(Memberships.recordedAt(.string("2025-05-19T20:46:59.734Z"), rkey: "3lpkgxwe3gm2m"), "2025-05-19T20:46:59.734Z")
        // No usable createdAt: the TID in the record key carries the time.
        XCTAssertEqual(Memberships.recordedAt(.string("yesterday"), rkey: "3lpkgxwe3gm2m")?.prefix(10), "2025-05-19")
        XCTAssertEqual(Memberships.recordedAt(nil, rkey: "3lpkgxwe3gm2m")?.prefix(10), "2025-05-19")
        XCTAssertNil(Memberships.recordedAt(nil, rkey: "self"))
    }

    func testMergeMembershipsShowsAListOnceHoweverManyItemsNameIt() {
        let a = list("a", .curate)
        let first = [membership("1", a), membership("2", list("b", .mod))]
        let merged = Memberships.mergeMemberships(first, [membership("3", a), membership("4", list("c", .curate))])
        XCTAssertEqual(merged.map { $0.itemUri.split(separator: "/").last.map(String.init) }, ["1", "2", "4"])
        // Items whose list could not be read are told apart by their own record.
        let unread = Memberships.mergeMemberships([membership("5", nil, unread: true)], [membership("6", nil, unread: true)])
        XCTAssertEqual(unread.count, 2)
    }

    func testGroupMembershipsSplitsByPurposeAndKeepsTheUnavailableApart() {
        let groups = Memberships.groupMemberships([
            membership("1", list("a", .curate)),
            membership("2", list("b", .mod)),
            membership("3", list("c", .reference)),
            membership("4", list("d", .other)),
            membership("5", nil),
        ])
        XCTAssertEqual(
            [groups.curate.count, groups.mod.count, groups.reference.count, groups.unavailable.count],
            [2, 1, 1, 1]
        )
    }

    func testVerificationStandingFollowsTheAppViewThenTheIssuer() {
        let uri = "at://\(Self.curator)/app.bsky.graph.verification/3kabc"
        XCTAssertEqual(Memberships.verificationStanding(uri, issuerTrusted: true, appview: [.init(uri: uri, isValid: true)]), .valid)
        XCTAssertEqual(Memberships.verificationStanding(uri, issuerTrusted: true, appview: [.init(uri: uri, isValid: false)]), .stale)
        XCTAssertEqual(Memberships.verificationStanding(uri, issuerTrusted: true, appview: []), .unlisted)
        XCTAssertEqual(Memberships.verificationStanding(uri, issuerTrusted: false, appview: []), .untrusted)
    }

    func testSortVerificationsListsTheOnesThatCountFirstThenNewestFirst() {
        func make(_ id: String, _ standing: Memberships.VerificationStanding, _ createdAt: String) -> Memberships.Verification {
            Memberships.Verification(
                uri: "at://\(Self.curator)/app.bsky.graph.verification/\(id)",
                issuer: Memberships.Issuer(did: Self.curator, handle: nil, displayName: nil, avatar: nil),
                issuerTrusted: standing != .untrusted,
                displayName: nil,
                handle: nil,
                createdAt: createdAt,
                standing: standing
            )
        }
        let sorted = Memberships.sortVerifications([
            make("old-untrusted", .untrusted, "2025-01-01T00:00:00.000Z"),
            make("new-untrusted", .untrusted, "2026-01-01T00:00:00.000Z"),
            make("stale", .stale, "2025-06-01T00:00:00.000Z"),
            make("valid", .valid, "2024-01-01T00:00:00.000Z"),
        ])
        XCTAssertEqual(
            sorted.map { $0.uri.split(separator: "/").last.map(String.init) },
            ["valid", "stale", "new-untrusted", "old-untrusted"]
        )
    }

    func testMembershipSummaryReadsNaturallyAtZeroOneAndMany() {
        XCTAssertEqual(Memberships.membershipSummary(lists: 0, verifications: 0), "is on no lists and has no verifications")
        XCTAssertEqual(Memberships.membershipSummary(lists: 1, verifications: 1), "is on 1 list and has 1 verification")
        XCTAssertEqual(Memberships.membershipSummary(lists: 12, verifications: 2), "is on 12 lists and has 2 verifications")
        XCTAssertEqual(Memberships.membershipSummary(lists: 3, verifications: nil), "is on 3 lists")
        // A count that could not be made is left out, not guessed at.
        XCTAssertEqual(Memberships.membershipSummary(lists: nil, verifications: 2), "has 2 verifications")
        XCTAssertEqual(Memberships.membershipSummary(lists: nil, verifications: nil), "could not be looked up")
        XCTAssertEqual(Memberships.membershipSummary(lists: 12_345, verifications: nil), "is on 12,345 lists")
    }
}

// MARK: - The requests

/// One account on two lists (one of them twice, one deleted) with two
/// verifications, one from a trusted verifier the AppView accepts.
private enum MembershipsFixture {
    static let did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"
    static let curator = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb"
    static let verifier = "did:plc:cccccccccccccccccccccccc"
    static let stranger = "did:plc:dddddddddddddddddddddddd"

    static let listA = "at://\(curator)/app.bsky.graph.list/aaa"
    static let listGone = "at://\(curator)/app.bsky.graph.list/gone"
    static let trusted = "at://\(verifier)/app.bsky.graph.verification/3lpkgxwe3gm2m"
    static let untrusted = "at://\(stranger)/app.bsky.graph.verification/3lpkgxwe3gm2n"

    static let listItemsRoute = "source=app.bsky.graph.listitem"
    static let verificationsRoute = "source=app.bsky.graph.verification"
    static let getListRoute = "app.bsky.graph.getList?"
    static let profileRoute = "app.bsky.actor.getProfile?"
    static let profilesRoute = "app.bsky.actor.getProfiles?"
    static let slingshotRoute = "blue.microcosm.repo.getRecordByUri"

    static var profile: String {
        #"{"did":"\#(did)","handle":"alice.test","displayName":" Alice ","verification":{"verifiedStatus":"valid","trustedVerifierStatus":"none","verifications":[{"issuer":"\#(verifier)","uri":"\#(trusted)","isValid":true,"createdAt":"2025-05-19T20:46:59.734Z"}]}}"#
    }

    static var listItems: String {
        #"{"total":3,"cursor":"next-page","records":[{"did":"\#(curator)","collection":"app.bsky.graph.listitem","rkey":"i1"},{"did":"\#(curator)","collection":"app.bsky.graph.listitem","rkey":"i2"},{"did":"\#(curator)","collection":"app.bsky.graph.listitem","rkey":"i3"}]}"#
    }

    static var verifications: String {
        #"{"total":2,"records":[{"did":"\#(stranger)","collection":"app.bsky.graph.verification","rkey":"3lpkgxwe3gm2n"},{"did":"\#(verifier)","collection":"app.bsky.graph.verification","rkey":"3lpkgxwe3gm2m"}]}"#
    }

    /// The list items name list A twice and the deleted list once; the
    /// verifications say who they vouched for.
    static let slingshot: ChecksFakeTransport.Responder = { request in
        let url = request.url?.absoluteString.removingPercentEncoding ?? ""
        if url.contains("listitem/i1") || url.contains("listitem/i3") {
            return (200, #"{"uri":"x","cid":"c","value":{"list":"\#(MembershipsFixture.listA)","createdAt":"2026-02-01T00:00:00.000Z"}}"#)
        }
        if url.contains("listitem/i2") {
            return (200, #"{"uri":"x","cid":"c","value":{"list":"\#(MembershipsFixture.listGone)"}}"#)
        }
        if url.contains("verification/") {
            return (200, #"{"uri":"x","cid":"c","value":{"handle":"alice.test","displayName":"Alice","createdAt":"2025-05-19T20:46:59.734Z"}}"#)
        }
        return (404, #"{"error":"RecordNotFound"}"#)
    }

    static let getList: ChecksFakeTransport.Responder = { request in
        let url = request.url?.absoluteString.removingPercentEncoding ?? ""
        if url.contains("list/aaa") {
            return (200, #"{"list":{"uri":"\#(MembershipsFixture.listA)","cid":"c","name":"Friends","purpose":"app.bsky.graph.defs#curatelist","listItemCount":12,"creator":{"did":"\#(MembershipsFixture.curator)","handle":"curator.test"}},"items":[]}"#)
        }
        return (400, #"{"error":"InvalidRequest","message":"List not found"}"#)
    }

    static var profiles: String {
        #"{"profiles":[{"did":"\#(verifier)","handle":"verifier.test","displayName":"Verifier","verification":{"trustedVerifierStatus":"valid"}},{"did":"\#(stranger)","handle":"handle.invalid"}]}"#
    }

    static func transport(_ overrides: [(String, ChecksFakeTransport.Responder)] = []) -> ChecksFakeTransport {
        ChecksFakeTransport(overrides + [
            (listItemsRoute, ChecksFakeTransport.reply(200, listItems)),
            (verificationsRoute, ChecksFakeTransport.reply(200, verifications)),
            (slingshotRoute, slingshot),
            (getListRoute, getList),
            (profilesRoute, ChecksFakeTransport.reply(200, profiles)),
            (profileRoute, ChecksFakeTransport.reply(200, profile)),
        ])
    }
}

final class MembershipsClientTests: XCTestCase {
    func testLoadAccountReadsTheVerificationStateFromTheProfile() async throws {
        let client = MembershipsClient(http: HTTPClient(transport: MembershipsFixture.transport()))
        let account = try await client.loadAccount(MembershipsFixture.did)
        XCTAssertEqual(account.handle, "alice.test")
        XCTAssertEqual(account.displayName, "Alice")
        XCTAssertTrue(account.onBluesky)
        XCTAssertTrue(account.verified)
        XCTAssertFalse(account.trustedVerifier)
        XCTAssertEqual(account.considered, [Memberships.Considered(uri: MembershipsFixture.trusted, isValid: true)])
    }

    func testAnAccountWithNoBlueskyProfileFallsBackToItsIdentity() async throws {
        let transport = MembershipsFixture.transport([
            (MembershipsFixture.profileRoute, ChecksFakeTransport.reply(400, #"{"error":"InvalidRequest","message":"Profile not found"}"#)),
            ("blue.microcosm.identity.resolveMiniDoc", ChecksFakeTransport.reply(200, #"{"did":"\#(MembershipsFixture.did)","handle":"alice.test","pds":"https://pds.example"}"#)),
        ])
        let account = try await MembershipsClient(http: HTTPClient(transport: transport)).loadAccount(MembershipsFixture.did)
        XCTAssertFalse(account.onBluesky)
        XCTAssertEqual(account.handle, "alice.test")
        XCTAssertFalse(account.verified)
        XCTAssertEqual(account.considered, [])
    }

    func testAListPageReadsEachItemForItsListAndDescribesEachListOnce() async throws {
        let transport = MembershipsFixture.transport()
        let page = try await MembershipsClient(http: HTTPClient(transport: transport)).loadListPage(MembershipsFixture.did, cursor: nil)
        XCTAssertEqual(page.total, 3)
        XCTAssertEqual(page.cursor, "next-page")
        XCTAssertEqual(page.items.map { $0.listUri }, [MembershipsFixture.listA, MembershipsFixture.listGone, MembershipsFixture.listA])
        XCTAssertEqual(page.items[0].list?.name, "Friends")
        XCTAssertEqual(page.items[0].list?.purpose, .curate)
        XCTAssertEqual(page.items[0].list?.memberCount, 12)
        XCTAssertEqual(page.items[0].addedAt, "2026-02-01T00:00:00.000Z")
        // A list the AppView will not describe is kept, without a description.
        XCTAssertNil(page.items[1].list)
        // Two lists, each asked about once.
        XCTAssertEqual(transport.count(containing: MembershipsFixture.getListRoute), 2)
        XCTAssertTrue(transport.urls.contains { $0.contains("limit=25") && $0.contains(MembershipsFixture.listItemsRoute) })

        let merged = Memberships.mergeMemberships(page.items, [])
        XCTAssertEqual(merged.count, 2)
    }

    func testVerificationsAreRankedByStanding() async throws {
        let transport = MembershipsFixture.transport()
        let client = MembershipsClient(http: HTTPClient(transport: transport))
        let list = try await client.loadVerifications(
            MembershipsFixture.did,
            considered: [Memberships.Considered(uri: MembershipsFixture.trusted, isValid: true)]
        )
        // All of them fit on one page, so the rows are the count.
        XCTAssertEqual(list.total, 2)
        XCTAssertEqual(list.items.map { $0.uri }, [MembershipsFixture.trusted, MembershipsFixture.untrusted])
        XCTAssertEqual(list.items.map { $0.standing }, [.valid, .untrusted])
        XCTAssertEqual(list.items[0].issuer.displayName, "Verifier")
        XCTAssertTrue(list.items[0].issuerTrusted)
        XCTAssertEqual(list.items[0].displayName, "Alice")
        XCTAssertEqual(list.items[0].handle, "alice.test")
        XCTAssertNil(list.items[1].issuer.handle, "handle.invalid names nobody")
    }

    func testConstellationNotAnsweringIsSaidSo() async {
        let transport = MembershipsFixture.transport([(MembershipsFixture.listItemsRoute, ChecksFakeTransport.reply(503, "down"))])
        do {
            _ = try await MembershipsClient(http: HTTPClient(transport: transport)).loadListPage(MembershipsFixture.did, cursor: nil)
            XCTFail("no page without Constellation")
        } catch {
            XCTAssertEqual(AccountCheckError.describe(error), "Constellation did not answer. Try again in a moment.")
        }
    }

    @MainActor
    func testTheModelLoadsBothLookupsAndFurtherPagesOnRequest() async {
        let transport = MembershipsFixture.transport()
        let model = MembershipsModel(http: HTTPClient(transport: transport))
        model.load(MembershipsFixture.did)
        XCTAssertTrue(model.account.isLoading)
        await model.waitForRuns()

        XCTAssertTrue(model.isSettled)
        XCTAssertEqual(model.account.value?.handle, "alice.test")
        XCTAssertEqual(model.listTotal, 3)
        XCTAssertEqual(model.items.count, 2)
        XCTAssertEqual(model.groups.curate.count, 1)
        XCTAssertEqual(model.groups.unavailable.count, 1)
        XCTAssertEqual(model.verifications.value?.total, 2)
        XCTAssertEqual(model.cursor, "next-page")

        model.loadMore()
        XCTAssertTrue(model.isLoadingMore)
        await model.waitForRuns()
        XCTAssertFalse(model.isLoadingMore)
        XCTAssertTrue(transport.urls.contains { $0.contains("cursor=next-page") })
        XCTAssertEqual(model.loadedRecords, 6)
        // The second page repeats the first's lists, which show once.
        XCTAssertEqual(model.items.count, 2)
    }
}
