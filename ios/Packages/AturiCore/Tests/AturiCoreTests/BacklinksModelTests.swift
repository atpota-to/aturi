import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport for the backlinks panel: the first pattern
/// found in the URL answers, anything else is a 404. An optional delay lets
/// a test cancel a load mid-flight.
private final class BacklinksFakeTransport: HTTPTransport, @unchecked Sendable {
    enum Route {
        case reply(status: Int, body: String)
        case fail(Error)
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, route: Route)]
    private let delayNanoseconds: UInt64
    private(set) var requests: [URLRequest] = []

    init(_ routes: [(String, Route)], delayNanoseconds: UInt64 = 0) {
        self.routes = routes.map { (pattern: $0.0, route: $0.1) }
        self.delayNanoseconds = delayNanoseconds
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        if delayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: delayNanoseconds)
        }
        let url = request.url!
        let route = routes.first { url.absoluteString.contains($0.pattern) }?.route
            ?? .reply(status: 404, body: #"{"error":"NotFound"}"#)
        switch route {
        case .fail(let error):
            throw error
        case .reply(let status, let body):
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
            return (Data(body.utf8), response)
        }
    }

    /// Locking stays in a synchronous helper: NSLock is not async-safe.
    private func record(_ request: URLRequest) {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
    }

    var urls: [String] {
        lock.lock(); defer { lock.unlock() }
        return requests.compactMap { $0.url?.absoluteString }
    }

    func count(containing fragment: String) -> Int {
        urls.filter { $0.contains(fragment) }.count
    }
}

@MainActor
final class BacklinksModelTests: XCTestCase {
    private typealias Route = BacklinksFakeTransport.Route

    // MARK: Fixtures

    nonisolated private static let target = "at://did:plc:alice123/app.bsky.feed.post/3kabc"
    nonisolated private static let account = "did:plc:alice123"
    nonisolated private static let sourcesPath = "/links/all"
    nonisolated private static let profilesPath = "app.bsky.actor.getProfiles"
    nonisolated private static let backlinksPath = "blue.microcosm.links.getBacklinks"
    nonisolated private static let likeSource = "app.bsky.feed.like:subject.uri"
    nonisolated private static let repostSource = "app.bsky.feed.repost:subject.uri"
    nonisolated private static let likePage = "source=app.bsky.feed.like%3Asubject.uri"
    nonisolated private static let repostPage = "source=app.bsky.feed.repost%3Asubject.uri"
    nonisolated private static let vouchPage = "source=sh.tangled.graph.vouch%3A."
    nonisolated private static let bskyFollowSource = "app.bsky.graph.follow:subject"
    nonisolated private static let tangledFollowSource = "sh.tangled.graph.follow:subject"
    nonisolated private static let bskyFollowPage = "source=app.bsky.graph.follow%3Asubject"
    nonisolated private static let tangledFollowPage = "source=sh.tangled.graph.follow%3Asubject"

    nonisolated private static let sourcesBody = #"{"links":{"app.bsky.feed.like":{".subject.uri":{"records":1200,"distinct_dids":900}},"app.bsky.feed.repost":{".subject.uri":{"records":3,"distinct_dids":3}},"sh.tangled.graph.vouch":{".":{"records":2}}}}"#
    nonisolated private static let accountSourcesBody = #"{"links":{"app.bsky.graph.follow":{".subject":{"records":1000,"distinct_dids":990}},"sh.tangled.graph.follow":{".subject":{"records":20,"distinct_dids":20}},"app.bsky.feed.post":{".facets[].features[app.bsky.richtext.facet#mention].did":{"records":30,"distinct_dids":9},".facets[].features[com.atproto.richtext.facet#mention].did":{"records":2,"distinct_dids":2}},"app.bsky.graph.block":{".subject":{"records":40,"distinct_dids":40}}}}"#
    nonisolated private static let profilesBody = #"{"profiles":[{"did":"did:plc:bob","handle":"bob.test","displayName":"Bob","avatar":"https://cdn.bsky.app/img/avatar/plain/did:plc:bob/a@jpeg"},{"did":"did:plc:alice123","handle":"alice.test"}]}"#

    nonisolated private static func page(_ records: [(did: String, collection: String, rkey: String)], cursor: String? = nil) -> String {
        let items = records.map { #"{"did":"\#($0.did)","collection":"\#($0.collection)","rkey":"\#($0.rkey)"}"# }
        let tail = cursor.map { #","cursor":"\#($0)""# } ?? ""
        return #"{"linking_records":[\#(items.joined(separator: ","))]\#(tail)}"#
    }

    /// Reposts: bob's, then the author's own.
    nonisolated private static var repostBody: String {
        page([
            ("did:plc:bob", "app.bsky.feed.repost", backlinkTestTid(30)),
            ("did:plc:alice123", "app.bsky.feed.repost", backlinkTestTid(20)),
        ])
    }

    /// Likes, first page: a full batch (bob, carol and eighteen fans),
    /// with more to come. A batch follows a source's cursor until it has
    /// `pageSize` records, so a shorter first page would pull the second
    /// one into the same batch.
    nonisolated private static var likeBody: String {
        var records: [(did: String, collection: String, rkey: String)] = [
            ("did:plc:bob", "app.bsky.feed.like", backlinkTestTid(50)),
            ("did:plc:carol", "app.bsky.feed.like", backlinkTestTid(49)),
        ]
        for index in 0..<18 {
            records.append((did: "did:plc:fan\(index)", collection: "app.bsky.feed.like", rkey: backlinkTestTid(48 - index)))
        }
        return page(records, cursor: "c1")
    }

    /// Likes, second and last page: dave.
    nonisolated private static var likeMoreBody: String {
        page([("did:plc:dave", "app.bsky.feed.like", backlinkTestTid(10))])
    }

    nonisolated private static var bskyFollowBody: String {
        page([
            ("did:plc:bob", "app.bsky.graph.follow", backlinkTestTid(50)),
            ("did:plc:alice123", "app.bsky.graph.follow", backlinkTestTid(5)),
        ])
    }

    nonisolated private static var tangledFollowBody: String {
        page([("did:plc:carol", "sh.tangled.graph.follow", backlinkTestTid(30))])
    }

    /// The happy-path routes, with per-test overrides taking precedence.
    /// The cursor route sits before the bare page route so the second page
    /// is matched by its cursor first.
    private func transport(overrides: [(String, Route)] = [], delayNanoseconds: UInt64 = 0) -> BacklinksFakeTransport {
        let base: [(String, Route)] = [
            (Self.sourcesPath, .reply(status: 200, body: Self.sourcesBody)),
            ("cursor=c1", .reply(status: 200, body: Self.likeMoreBody)),
            (Self.likePage, .reply(status: 200, body: Self.likeBody)),
            (Self.repostPage, .reply(status: 200, body: Self.repostBody)),
            (Self.vouchPage, .reply(status: 200, body: #"{"linking_records":[]}"#)),
            (Self.bskyFollowPage, .reply(status: 200, body: Self.bskyFollowBody)),
            (Self.tangledFollowPage, .reply(status: 200, body: Self.tangledFollowBody)),
            (Self.profilesPath, .reply(status: 200, body: Self.profilesBody)),
        ]
        return BacklinksFakeTransport(overrides + base, delayNanoseconds: delayNanoseconds)
    }

    private func accountTransport(overrides: [(String, Route)] = []) -> BacklinksFakeTransport {
        transport(overrides: overrides + [(Self.sourcesPath, .reply(status: 200, body: Self.accountSourcesBody))])
    }

    private func makeModel(_ transport: BacklinksFakeTransport, target: String = BacklinksModelTests.target, hydrates: Bool = true) -> BacklinksModel {
        BacklinksModel(target: target, http: HTTPClient(transport: transport), hydrates: hydrates)
    }

    /// Load the sources and the first relationship's first batch.
    private func loaded(_ transport: BacklinksFakeTransport, target: String = BacklinksModelTests.target, hydrates: Bool = true) async -> BacklinksModel {
        let model = makeModel(transport, target: target, hydrates: hydrates)
        await model.loadAndWait(target: target)
        await model.awaitActiveList()
        return model
    }

    // MARK: Sources

    func testSourcesLoadSortedWithTotals() async {
        let transport = transport()
        let model = makeModel(transport)
        XCTAssertTrue(model.sources.isIdle)
        XCTAssertEqual(model.summaryText, "loading\u{2026}")
        XCTAssertEqual(model.countText, "\u{2014}")

        await model.loadAndWait(target: Self.target)

        XCTAssertEqual(model.sourceList.map(\.source), [Self.likeSource, Self.repostSource, "sh.tangled.graph.vouch:."])
        XCTAssertEqual(model.sourceList.map(\.count), [1200, 3, 2])
        XCTAssertEqual(model.sourceList.map(\.path), [".subject.uri", ".subject.uri", "."])
        XCTAssertEqual(model.sourceList.first?.distinctDids, 900)
        XCTAssertNil(model.sourceList.last?.distinctDids)
        XCTAssertEqual(model.totals, BacklinkTotals(records: 1205, accounts: 903, sources: 3))
        XCTAssertEqual(model.countText, "1,205")
        XCTAssertEqual(model.summaryText, "across 3 sources \u{00B7} from 903 accounts")
        XCTAssertFalse(model.isUnavailable)
        XCTAssertFalse(model.isEmpty)
        XCTAssertEqual(transport.count(containing: "https://constellation.microcosm.blue/links/all?target=at%3A%2F%2Fdid%3Aplc%3Aalice123%2Fapp.bsky.feed.post%2F3kabc"), 1)
    }

    func testSingularSummaryWithoutAccounts() async {
        let transport = transport(overrides: [(Self.sourcesPath, .reply(status: 200, body: #"{"links":{"sh.tangled.graph.vouch":{".":{"records":1}}}}"#))])
        let model = makeModel(transport)
        await model.loadAndWait(target: Self.target)
        XCTAssertEqual(model.summaryText, "across 1 source")
        XCTAssertEqual(model.countText, "1")
        XCTAssertEqual(model.totals?.accounts, nil, "no source reported distinct DIDs, so the accounts figure is hidden")
    }

    func testSourcesWithNoLinksAreDropped() async {
        let body = #"{"links":{"app.bsky.feed.like":{".subject.uri":{"records":4,"distinct_dids":4}},"app.bsky.feed.repost":{".subject.uri":{"records":0,"distinct_dids":0}}}}"#
        let transport = transport(overrides: [(Self.sourcesPath, .reply(status: 200, body: body))])
        let model = makeModel(transport)
        await model.loadAndWait(target: Self.target)
        XCTAssertEqual(model.sourceList.map(\.source), [Self.likeSource])
        XCTAssertEqual(model.summaryText, "across 1 source \u{00B7} from 4 accounts")
        XCTAssertEqual(model.groups.map(\.key), ["like"], "a dropped source makes no relationship")
    }

    func testUnavailableIndexIsAFailure() async {
        let transport = transport(overrides: [(Self.sourcesPath, .reply(status: 503, body: "down"))])
        let model = makeModel(transport)
        await model.loadAndWait(target: Self.target)
        XCTAssertEqual(model.sources, .failed(BacklinksModel.unavailableMessage))
        XCTAssertTrue(model.isUnavailable)
        XCTAssertFalse(model.isEmpty)
        XCTAssertEqual(model.summaryText, "unavailable")
        XCTAssertEqual(model.countText, "\u{2014}")
        XCTAssertNil(model.totals)
        XCTAssertTrue(model.sourceList.isEmpty)
        XCTAssertTrue(model.groups.isEmpty)
        XCTAssertNil(model.selectedGroup)
    }

    func testNoSourcesIsARealEmptyAnswer() async {
        let transport = transport(overrides: [(Self.sourcesPath, .reply(status: 200, body: #"{"links":{}}"#))])
        let model = makeModel(transport)
        await model.loadAndWait(target: Self.target)
        XCTAssertEqual(model.sources, .loaded([]))
        XCTAssertTrue(model.isEmpty)
        XCTAssertFalse(model.isUnavailable)
        XCTAssertEqual(model.summaryText, "no records reference this yet")
        XCTAssertEqual(model.countText, "0")
        XCTAssertEqual(model.totals, BacklinkTotals(records: 0, accounts: nil, sources: 0))
        XCTAssertTrue(model.groups.isEmpty)
        XCTAssertNil(model.activeList)
        XCTAssertFalse(model.isListLoading)
        XCTAssertEqual(transport.count(containing: Self.backlinksPath), 0)
    }

    func testEmptyTargetStaysIdle() async {
        let transport = transport()
        let model = BacklinksModel(http: HTTPClient(transport: transport))
        await model.loadAndWait(target: "")
        XCTAssertTrue(model.sources.isIdle)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    // MARK: Relationships

    func testARecordsSourcesBecomeItsRelationships() async {
        let model = await loaded(transport(), hydrates: false)
        XCTAssertEqual(model.kind, .record(collection: "app.bsky.feed.post"))
        XCTAssertEqual(model.selfDid, "did:plc:alice123")
        XCTAssertEqual(model.selfLabel, "author")
        XCTAssertEqual(model.groups.map(\.key), ["repost", "like", "other"])
        XCTAssertEqual(model.groups.map(\.label), ["Reposts", "Likes", "Other links"])
        XCTAssertEqual(model.selectedGroup?.key, "repost", "the first relationship opens")
        XCTAssertNil(model.selectedRelation)

        let like = model.groups[1]
        XCTAssertEqual(like.about, "Likes, stars, votes and recommendations.")
        XCTAssertEqual(like.count, 1200)
        XCTAssertEqual(like.countText, "1,200")
        XCTAssertEqual(like.compactCountText, "1.2k")
        XCTAssertEqual(like.subtitle, "900 accounts")
        XCTAssertEqual(like.hint, "1,200 links through 1 source.")
        XCTAssertEqual(like.sourcesTitle, "1 source behind likes")
        XCTAssertEqual(like.apps.map(\.app.name), ["Bluesky"])

        let other = model.groups[2]
        XCTAssertEqual(other.subtitle, "1 source", "no accounts reported: the tile counts sources")
        XCTAssertEqual(other.apps.map(\.app.key), ["tangled.sh"])
    }

    func testAnAccountsSourcesBecomeItsRelationships() async {
        let model = await loaded(accountTransport(), target: Self.account, hydrates: false)
        XCTAssertEqual(model.kind, .account)
        XCTAssertEqual(model.selfDid, Self.account)
        XCTAssertEqual(model.selfLabel, "this account")
        XCTAssertEqual(model.groups.map(\.key), ["follow", "mention", "block"])

        let follow = model.groups[0]
        XCTAssertEqual(follow.label, "Followers")
        XCTAssertEqual(follow.count, 1020)
        XCTAssertEqual(follow.accounts, 1010)
        XCTAssertEqual(follow.sources.map(\.source), [Self.bskyFollowSource, Self.tangledFollowSource])
        XCTAssertEqual(follow.apps.map(\.app.name), ["Bluesky", "Tangled"])
        XCTAssertEqual(follow.subtitle, "\(UFOsFormat.formatCount(1010)) accounts \u{00B7} 2 apps")
        XCTAssertEqual(follow.hint, "1,020 links through 2 sources. Accounts are counted per source, so one account linking through two counts twice.")
        XCTAssertEqual(follow.sourcesTitle, "2 sources behind followers")
        XCTAssertTrue(model.showsAppFilter)
        XCTAssertTrue(model.showsAppOnRows)
    }

    func testTheFirstRelationshipsListLoadsAndHydrates() async {
        let transport = transport()
        let model = await loaded(transport)
        guard let list = model.activeList else { return XCTFail("expected the reposts list") }
        XCTAssertFalse(list.isLoading)
        XCTAssertTrue(list.isDone)
        XCTAssertFalse(list.canLoadMore)
        XCTAssertTrue(list.failed.isEmpty)

        let rows = model.rows
        XCTAssertEqual(rows.map(\.uri), [
            "at://did:plc:bob/app.bsky.feed.repost/\(backlinkTestTid(30))",
            "at://did:plc:alice123/app.bsky.feed.repost/\(backlinkTestTid(20))",
        ])
        XCTAssertEqual(rows[0].title, "Bob")
        XCTAssertEqual(rows[0].handle, "@bob.test")
        XCTAssertFalse(rows[0].titleIsIdentifier)
        XCTAssertFalse(rows[0].isPending)
        XCTAssertEqual(rows[0].avatar, "https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:bob/a@jpeg")
        XCTAssertNil(rows[0].selfLabel)
        XCTAssertNil(rows[0].context, "a repost has no words")
        XCTAssertNil(rows[0].app, "one app: no marks on the rows")
        XCTAssertNil(rows[0].linksLabel)
        XCTAssertEqual(rows[0].date, TID.date(from: backlinkTestTid(30)))
        XCTAssertEqual(rows[1].title, "alice.test", "no display name: the handle leads")
        XCTAssertNil(rows[1].handle)
        XCTAssertEqual(rows[1].selfLabel, "author")
        XCTAssertEqual(model.footerText, "2 shown \u{00B7} 3 links in all")

        XCTAssertEqual(transport.count(containing: "getBacklinks?subject=at%3A%2F%2Fdid%3Aplc%3Aalice123%2Fapp.bsky.feed.post%2F3kabc&source=app.bsky.feed.repost%3Asubject.uri&limit=20"), 1)
        XCTAssertEqual(transport.count(containing: Self.backlinksPath), 1, "only the open relationship is fetched")
        XCTAssertEqual(transport.count(containing: Self.profilesPath), 1)
        XCTAssertEqual(transport.count(containing: "slingshot"), 0, "reposts are never fetched for context")
    }

    func testSelectingARelationshipLoadsItsListOnceAndKeepsTheOther() async {
        let transport = transport()
        let model = await loaded(transport)

        model.select(relation: "like")
        XCTAssertEqual(model.selectedGroup?.key, "like")
        XCTAssertTrue(model.isListLoading)
        await model.awaitActiveList()

        let rows = model.rows
        XCTAssertEqual(rows.count, BacklinksModel.pageSize)
        XCTAssertEqual(rows.prefix(2).map(\.title), ["Bob", "did:plc:carol"])
        XCTAssertTrue(rows[1].titleIsIdentifier)
        XCTAssertTrue(rows[1].hasNoProfile, "the AppView answered without carol")
        XCTAssertFalse(rows[1].isPending)
        XCTAssertEqual(model.activeList?.canLoadMore, true)
        XCTAssertEqual(model.footerText, "20 shown \u{00B7} 1,200 links in all")
        XCTAssertEqual(transport.count(containing: "cursor=c1"), 0, "a full first page is a full batch")
        XCTAssertEqual(transport.count(containing: Self.profilesPath), 2, "bob was known; the rest were asked about")

        model.select(relation: "repost")
        XCTAssertEqual(model.rows.count, 2)
        XCTAssertFalse(model.isListLoading)
        XCTAssertEqual(transport.count(containing: Self.repostPage), 1, "the reposts list was kept")
    }

    func testShowMoreAppendsTheNextBatch() async {
        let transport = transport()
        let model = await loaded(transport)
        model.select(relation: "like")
        await model.awaitActiveList()

        model.loadMore()
        XCTAssertEqual(model.activeList?.isLoading, true)
        XCTAssertEqual(model.rows.count, 20, "the first batch stays while the next loads")
        await model.awaitActiveList()

        XCTAssertEqual(model.rows.count, 21)
        XCTAssertEqual(model.rows.last?.item.did, "did:plc:dave")
        XCTAssertEqual(model.activeList?.isDone, true)
        XCTAssertEqual(model.footerText, "21 shown \u{00B7} 1,200 links in all")
        XCTAssertEqual(transport.count(containing: "cursor=c1"), 1)

        model.loadMore()
        await model.awaitActiveList()
        XCTAssertEqual(transport.count(containing: Self.likePage), 2, "a finished list is never asked again")
    }

    func testARecordThatLinksTwiceIsOneRowWithACount() async {
        let twice = Self.page([
            ("did:plc:bob", "app.bsky.feed.repost", backlinkTestTid(30)),
            ("did:plc:bob", "app.bsky.feed.repost", backlinkTestTid(30)),
        ])
        let model = await loaded(transport(overrides: [(Self.repostPage, .reply(status: 200, body: twice))]), hydrates: false)
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(model.rows.first?.item.links, 2)
        XCTAssertEqual(model.rows.first?.linksLabel, "\u{00D7}2 links")
        XCTAssertEqual(model.footerText, "1 shown \u{00B7} 3 links in all")
    }

    func testAFailedListSaysSo() async {
        let transport = transport(overrides: [(Self.repostPage, .reply(status: 500, body: "boom"))])
        let model = await loaded(transport)
        guard let list = model.activeList else { return XCTFail("expected a list") }
        XCTAssertTrue(list.items.isEmpty)
        XCTAssertFalse(list.isLoading)
        XCTAssertTrue(list.isDone)
        XCTAssertEqual(list.failed, [Self.repostSource])
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertNil(model.footerText)
        XCTAssertEqual(model.listEmptyMessage, BacklinksModel.recordsErrorMessage)
        XCTAssertEqual(transport.count(containing: Self.profilesPath), 0)
    }

    func testAnEmptyListSaysSo() async {
        let model = await loaded(transport(), hydrates: false)
        model.select(relation: "other")
        await model.awaitActiveList()
        XCTAssertEqual(model.activeList?.items.isEmpty, true)
        XCTAssertEqual(model.activeList?.isDone, true)
        XCTAssertEqual(model.listEmptyMessage, BacklinksModel.noRecordsMessage)
    }

    // MARK: Narrowing

    func testTheAppFilterNarrowsToOneApp() async {
        let transport = accountTransport()
        let model = await loaded(transport, target: Self.account)
        XCTAssertEqual(model.rows.map(\.item.did), ["did:plc:bob", "did:plc:carol", "did:plc:alice123"], "two sources, merged by date")
        XCTAssertEqual(model.rows.map { $0.app?.key }, ["bsky.app", "tangled.sh", "bsky.app"])
        XCTAssertEqual(model.rows[2].selfLabel, "this account")
        XCTAssertEqual(model.footerText, "3 shown \u{00B7} 1,020 links in all")
        XCTAssertTrue(model.isShowingAll)

        model.narrow(toApp: "tangled.sh")
        XCTAssertEqual(model.narrowedApp, "tangled.sh")
        XCTAssertFalse(model.isShowingAll)
        XCTAssertFalse(model.showsAppOnRows)
        XCTAssertEqual(model.activeSources.map(\.source), [Self.tangledFollowSource])
        await model.awaitActiveList()
        XCTAssertEqual(model.rows.map(\.item.did), ["did:plc:carol"])
        XCTAssertNil(model.rows.first?.app)
        XCTAssertEqual(model.footerText, "1 shown \u{00B7} 20 links in all")

        model.showAll()
        XCTAssertTrue(model.isShowingAll)
        XCTAssertEqual(model.rows.count, 3, "the merged list was kept")
        XCTAssertEqual(transport.count(containing: Self.bskyFollowPage), 1)
        XCTAssertEqual(transport.count(containing: Self.tangledFollowPage), 2, "the narrowed list is a merge of its own")
    }

    func testNarrowingToOneSourceAndBack() async {
        let model = await loaded(accountTransport(), target: Self.account, hydrates: false)
        XCTAssertEqual(model.sourceRows.map(\.id), [Self.bskyFollowSource, Self.tangledFollowSource])
        XCTAssertEqual(model.sourceRows.map(\.pathLabel), [".subject", ".subject"])
        XCTAssertEqual(model.sourceRows.map(\.app.name), ["Bluesky", "Tangled"])
        XCTAssertNil(model.narrowedSource)

        model.toggleSource(Self.bskyFollowSource)
        XCTAssertEqual(model.narrowedSource?.source, Self.bskyFollowSource)
        XCTAssertEqual(model.narrowedSource.map { BacklinksModel.sourceText($0) }, "app.bsky.graph.follow.subject")
        XCTAssertEqual(model.sourceRows.map(\.isNarrowed), [true, false])
        XCTAssertEqual(model.activeTotal, 1000)
        await model.awaitActiveList()
        XCTAssertEqual(model.rows.map(\.item.did), ["did:plc:bob", "did:plc:alice123"])

        model.toggleSource(Self.bskyFollowSource)
        XCTAssertNil(model.narrowedSource)
        XCTAssertTrue(model.isShowingAll)
        XCTAssertEqual(model.rows.count, 3)
    }

    func testPathLabelsKeepTheNamespaceWhereTwoWouldReadTheSame() async {
        let model = await loaded(accountTransport(), target: Self.account, hydrates: false)
        model.select(relation: "mention")
        XCTAssertEqual(model.sourceRows.map(\.pathLabel), [
            ".facets[].features[app.bsky\u{2026}#mention].did",
            ".facets[].features[com.atproto\u{2026}#mention].did",
        ])
        XCTAssertEqual(model.selectedGroup?.sourcesTitle, "2 sources behind mentions")
        XCTAssertFalse(model.showsAppFilter, "both sources are Bluesky's")
    }

    func testANarrowingBelongsToTheRelationshipItWasMadeIn() async {
        let model = await loaded(accountTransport(), target: Self.account, hydrates: false)
        model.narrow(toApp: "tangled.sh")
        model.select(relation: "block")
        XCTAssertNil(model.activeNarrowing, "another relationship starts whole")
        XCTAssertTrue(model.isShowingAll)
        XCTAssertEqual(model.activeSources.map(\.collection), ["app.bsky.graph.block"])

        model.select(relation: "follow")
        XCTAssertEqual(model.narrowedApp, "tangled.sh", "coming back finds it as it was left")
    }

    // MARK: Rows

    func testAListItemSeenFromItsListIsAboutTheAccountItAdds() async {
        let listUri = "at://did:plc:owner/app.bsky.graph.list/3kl"
        let sources = #"{"links":{"app.bsky.graph.listitem":{".list":{"records":1,"distinct_dids":1}}}}"#
        let items = Self.page([("did:plc:owner", "app.bsky.graph.listitem", "3li")])
        let listItem = #"{"uri":"at://did:plc:owner/app.bsky.graph.listitem/3li","cid":"c","value":{"$type":"app.bsky.graph.listitem","subject":"did:plc:member","list":"at://did:plc:owner/app.bsky.graph.list/3kl","createdAt":"2026-01-01T00:00:00Z"}}"#
        let list = #"{"uri":"at://did:plc:owner/app.bsky.graph.list/3kl","cid":"c","value":{"$type":"app.bsky.graph.list","name":"Good people","purpose":"app.bsky.graph.defs#curatelist","createdAt":"2026-01-01T00:00:00Z"}}"#
        let profiles = #"{"profiles":[{"did":"did:plc:owner","handle":"owner.test"},{"did":"did:plc:member","handle":"member.test","displayName":"Member"}]}"#
        let transport = transport(overrides: [
            (Self.sourcesPath, .reply(status: 200, body: sources)),
            ("source=app.bsky.graph.listitem%3Alist", .reply(status: 200, body: items)),
            ("at_uri=at%3A%2F%2Fdid%3Aplc%3Aowner%2Fapp.bsky.graph.listitem%2F3li", .reply(status: 200, body: listItem)),
            ("at_uri=at%3A%2F%2Fdid%3Aplc%3Aowner%2Fapp.bsky.graph.list%2F3kl", .reply(status: 200, body: list)),
            (Self.profilesPath, .reply(status: 200, body: profiles)),
        ])
        let model = await loaded(transport, target: listUri)
        XCTAssertEqual(model.groups.map(\.key), ["item"])
        XCTAssertEqual(model.selfDid, "did:plc:owner")

        guard let row = model.rows.first else { return XCTFail("expected a row") }
        XCTAssertEqual(row.subjectDid, "did:plc:member")
        XCTAssertEqual(row.title, "Member")
        XCTAssertEqual(row.handle, "@member.test")
        XCTAssertNil(row.context, "every item names the same list, so the line is left out")
        XCTAssertNil(row.selfLabel, "the owner wrote it, but the row is about the member")
        XCTAssertNil(row.date, "not a TID")
        XCTAssertEqual(model.details.context(for: row.uri)?.text, "Good people")
        XCTAssertEqual(transport.count(containing: Self.profilesPath), 2, "the owner, then the member")
    }

    func testHydrationCanBeSwitchedOff() async {
        let transport = transport()
        let model = await loaded(transport, hydrates: false)
        let rows = model.rows
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].title, shortDid("did:plc:bob"))
        XCTAssertTrue(rows[0].titleIsIdentifier)
        XCTAssertFalse(rows[0].isPending, "nothing is on its way")
        XCTAssertEqual(rows[1].selfLabel, "author", "the pill needs no profile")
        XCTAssertEqual(transport.count(containing: "public.api.bsky.app"), 0)
        XCTAssertEqual(transport.count(containing: "slingshot"), 0)
    }

    // MARK: Lifecycle

    func testANewTargetResetsTheLists() async {
        let transport = transport()
        let model = await loaded(transport)
        model.select(relation: "like")
        model.narrow(toApp: "bsky.app")
        await model.awaitActiveList()
        XCTAssertEqual(model.lists.count, 2)

        model.load(target: Self.account)
        XCTAssertEqual(model.target, Self.account)
        XCTAssertTrue(model.sources.isLoading)
        XCTAssertTrue(model.groups.isEmpty)
        XCTAssertTrue(model.lists.isEmpty)
        XCTAssertNil(model.selectedRelation)
        XCTAssertNil(model.narrowing)
        XCTAssertNotNil(model.details.profile(for: "did:plc:bob"), "profiles belong to the linking records, not the target")

        await model.awaitLoad()
        XCTAssertEqual(model.groups.map(\.key), ["endorse", "other"], "the same sources, read as an account's")
        XCTAssertEqual(transport.count(containing: "links/all?target=did%3Aplc%3Aalice123"), 1)

        model.reload()
        XCTAssertTrue(model.sources.isLoading)
        await model.awaitLoad()
        XCTAssertEqual(model.sourceList.count, 3)
    }

    func testCancelLeavesALoadUnsettled() async {
        let transport = transport(delayNanoseconds: 30_000_000)
        let model = makeModel(transport)
        model.load()
        XCTAssertTrue(model.sources.isLoading)
        model.cancel()
        await model.awaitLoad()
        XCTAssertTrue(model.sources.isLoading, "a cancelled load never settles")

        model.load()
        model.load(target: Self.account)
        await model.awaitLoad()
        XCTAssertEqual(model.target, Self.account)
        XCTAssertEqual(model.sourceList.count, 3)
    }

    func testCancelDropsAListCutOffMidBatch() async {
        let transport = transport(delayNanoseconds: 20_000_000)
        let model = makeModel(transport, hydrates: false)
        await model.loadAndWait(target: Self.target)
        XCTAssertEqual(model.activeList?.isLoading, true)

        model.cancel()
        XCTAssertNil(model.activeList)
        XCTAssertTrue(model.isListLoading, "the list is still to come")

        model.loadActiveList()
        await model.awaitActiveList()
        XCTAssertEqual(model.rows.count, 2)
        XCTAssertEqual(model.activeList?.isLoading, false)
    }

    func testCompactCountsMatchTheLexiconsFormatter() {
        XCTAssertEqual(BacklinksModel.compactCount(2400), UFOsFormat.formatCount(2400))
        XCTAssertEqual(BacklinksModel.compactCount(12), "12")
        XCTAssertEqual(BacklinksModel.pageSize, 20)
    }
}
