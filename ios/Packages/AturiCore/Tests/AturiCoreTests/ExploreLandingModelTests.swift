import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport: the first pattern found in the URL answers,
/// anything else is a 404. Every request is recorded so tests can assert on
/// what was (and was not) asked.
private final class ExploreLandingFakeTransport: HTTPTransport, @unchecked Sendable {
    enum Route {
        case reply(status: Int, body: String)
        case fail(Error)
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, route: Route)]
    private(set) var requests: [URLRequest] = []

    init(_ routes: [(String, Route)]) {
        self.routes = routes.map { (pattern: $0.0, route: $0.1) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
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
final class ExploreLandingModelTests: XCTestCase {
    nonisolated private static let typeaheadRoute = "app.bsky.actor.searchActorsTypeahead"
    nonisolated private static let profileRoute = "app.bsky.actor.getProfile"
    nonisolated private static let atTagsRoute = "aturi.to/api/at-tags"

    nonisolated private static let aliceTypeahead = #"{"actors":[{"did":"did:plc:alice","handle":"alice.test","displayName":"Alice","avatar":"https://cdn.example/alice.jpg"}]}"#
    nonisolated private static let aliceProfile = #"{"did":"did:plc:alice","handle":"alice.test","displayName":"Alice","avatar":"https://cdn.example/alice.jpg"}"#
    nonisolated private static let blogTags = #"{"ok":true,"primary":"at://did:plc:blog/site.standard.document/abc","tags":{},"count":1}"#

    nonisolated(unsafe) private var suiteName = ""
    nonisolated(unsafe) private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "AturiCoreTests.exploreLanding.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        XCTAssertNotNil(defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    private func transport(
        typeahead: ExploreLandingFakeTransport.Route = .reply(status: 200, body: ExploreLandingModelTests.aliceTypeahead),
        profile: ExploreLandingFakeTransport.Route = .reply(status: 200, body: ExploreLandingModelTests.aliceProfile),
        atTags: ExploreLandingFakeTransport.Route = .reply(status: 200, body: ExploreLandingModelTests.blogTags)
    ) -> ExploreLandingFakeTransport {
        ExploreLandingFakeTransport([
            (Self.typeaheadRoute, typeahead),
            (Self.profileRoute, profile),
            (Self.atTagsRoute, atTags),
        ])
    }

    private func makeModel(_ transport: ExploreLandingFakeTransport, session: SessionState = .signedOut, debounce: TimeInterval = 0.01) -> ExploreLandingModel {
        ExploreLandingModel(
            history: SearchHistoryStore(defaults: defaults),
            http: HTTPClient(transport: transport),
            session: session,
            typeaheadDebounce: debounce
        )
    }

    private func signedIn(_ did: String) -> SessionState {
        .signedIn(OAuthSession(
            did: did,
            pds: URL(string: "https://pds.example")!,
            issuer: "https://pds.example",
            accessToken: "token",
            dpopKey: DPoPKeySerialization(format: "opaque", privateKey: Data(), publicJWK: [:])
        ))
    }

    // MARK: Typeahead

    func testShouldQueryTypeaheadSkipsBlankShortDidAndAtUriInput() async {
        XCTAssertFalse(ExploreLandingModel.shouldQueryTypeahead(""))
        XCTAssertFalse(ExploreLandingModel.shouldQueryTypeahead("   "))
        XCTAssertFalse(ExploreLandingModel.shouldQueryTypeahead("a"))
        XCTAssertFalse(ExploreLandingModel.shouldQueryTypeahead("did:plc:abc"))
        XCTAssertFalse(ExploreLandingModel.shouldQueryTypeahead("at://did:plc:abc"))
        XCTAssertTrue(ExploreLandingModel.shouldQueryTypeahead("al"))
        XCTAssertTrue(ExploreLandingModel.shouldQueryTypeahead(" al "))
        XCTAssertTrue(ExploreLandingModel.shouldQueryTypeahead("https://x.example/y"))
    }

    func testTypeaheadIsIdleForInputNotWorthAsking() async {
        let transport = transport()
        let model = makeModel(transport)
        for input in ["a", "did:plc:x", "at://x", "  "] {
            model.query = input
            await model.awaitPendingTypeahead()
            XCTAssertEqual(model.typeahead, .idle, input)
            XCTAssertFalse(model.isTypeaheadPending, input)
            XCTAssertTrue(model.suggestions.isEmpty, input)
        }
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testTypeaheadDebouncesThenLoadsSuggestions() async {
        let transport = transport()
        let model = makeModel(transport)
        model.query = "al"
        XCTAssertTrue(model.isTypeaheadPending)
        XCTAssertTrue(model.isFocused, "typing opens the suggestion area")
        XCTAssertTrue(model.suggestions.isEmpty, "nothing until the lookup answers")
        await model.awaitPendingTypeahead()
        XCTAssertEqual(model.suggestions.map(\.handle), ["alice.test"])
        XCTAssertEqual(model.suggestions.first?.displayName, "Alice")
        XCTAssertFalse(model.isTypeaheadPending)
        XCTAssertEqual(model.highlightIndex, -1)
        XCTAssertTrue(model.showsSuggestionList)
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead?q=al&limit=8"])
    }

    func testOnlyTheLatestKeystrokeReachesTheAppView() async {
        let transport = transport()
        let model = makeModel(transport)
        model.query = "al"
        model.query = "ali"
        model.query = "alic"
        await model.awaitPendingTypeahead()
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead?q=alic&limit=8"])
        XCTAssertEqual(model.suggestions.count, 1)
    }

    func testClearingTheQueryDropsSuggestionsAndSuggestionsSurviveTyping() async {
        let transport = transport()
        let model = makeModel(transport)
        model.query = "al"
        await model.awaitPendingTypeahead()
        XCTAssertEqual(model.suggestions.count, 1)
        model.query = "ali"
        XCTAssertEqual(model.suggestions.count, 1, "the previous list stays while the next lookup is pending")
        XCTAssertTrue(model.isTypeaheadPending)
        await model.awaitPendingTypeahead()
        model.query = ""
        XCTAssertEqual(model.typeahead, .idle)
        XCTAssertTrue(model.suggestions.isEmpty)
        XCTAssertFalse(model.showsSuggestionList)
    }

    func testTypeaheadFailureIsAnEmptyList() async {
        let transport = transport(typeahead: .fail(URLError(.notConnectedToInternet)))
        let model = makeModel(transport)
        model.query = "al"
        await model.awaitPendingTypeahead()
        XCTAssertEqual(model.typeahead, .loaded([]))
        XCTAssertFalse(model.isTypeaheadPending)
    }

    func testCancelStopsThePendingLookup() async {
        let transport = transport()
        let model = makeModel(transport, debounce: 0.05)
        model.query = "al"
        model.cancel()
        await model.awaitPendingTypeahead()
        XCTAssertEqual(model.typeahead, .idle)
        XCTAssertFalse(model.isTypeaheadPending)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    // MARK: Highlight and submit

    func testHighlightWrapsAndSubmitPicksTheHighlightedActor() async {
        let transport = transport()
        let model = makeModel(transport)
        model.highlightNext()
        XCTAssertEqual(model.highlightIndex, -1, "nothing to highlight yet")
        model.query = "al"
        await model.awaitPendingTypeahead()
        model.highlightNext()
        XCTAssertEqual(model.highlightIndex, 0)
        model.highlightNext()
        XCTAssertEqual(model.highlightIndex, 0, "wraps around a one-row list")
        model.highlightPrevious()
        XCTAssertEqual(model.highlightIndex, 0)
        model.setHighlight(5)
        XCTAssertEqual(model.highlightIndex, -1)
        model.setHighlight(0)
        XCTAssertEqual(model.highlightedSuggestion?.handle, "alice.test")

        let destination = await model.submit()
        XCTAssertEqual(destination, .repo("alice.test"))
        XCTAssertFalse(model.isFocused)
        XCTAssertEqual(transport.count(containing: "at-tags"), 0, "a pick never routes the free text")

        let entries = model.history.entries
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries.first?.path, "/explore/alice.test")
        XCTAssertEqual(entries.first?.label, "Alice")
        XCTAssertEqual(entries.first?.sublabel, "@alice.test")
        XCTAssertEqual(entries.first?.avatar, "https://cdn.example/alice.jpg")
        XCTAssertEqual(entries.first?.did, "did:plc:alice")
        XCTAssertEqual(entries.first?.count, 1)
    }

    func testSubmitRoutesFreeTextAndRecordsTheQuery() async {
        let transport = transport()
        let model = makeModel(transport)
        model.query = "alice.test"
        let first = await model.submit()
        XCTAssertEqual(first, .repo("alice.test"))
        XCTAssertFalse(model.isResolving)
        XCTAssertFalse(model.isFocused)
        XCTAssertEqual(model.history.entries.map(\.path), ["/explore/alice.test"])
        XCTAssertEqual(model.history.entries.first?.label, "alice.test")
        XCTAssertNil(model.history.entries.first?.avatar, "a free-text search captures no avatar")

        let second = await model.submit()
        XCTAssertEqual(second, .repo("alice.test"))
        XCTAssertEqual(model.history.entries.first?.count, 2)
        XCTAssertEqual(transport.count(containing: "at-tags"), 0, "a handle is a confident match")

        model.query = "did:plc:abc"
        let did = await model.submit()
        XCTAssertEqual(did, .repo("did:plc:abc"))
        model.query = "at://did:plc:abc/app.bsky.feed.post/xyz"
        let record = await model.submit()
        XCTAssertEqual(record, .record(repo: "did:plc:abc", collection: "app.bsky.feed.post", rkey: "xyz"))
        model.query = "pds.atpota.to"
        let pds = await model.submit()
        XCTAssertEqual(pds, .pds(host: "pds.atpota.to"))
    }

    func testSubmitOfBlankInputRoutesNowhere() async {
        let transport = transport()
        let model = makeModel(transport)
        let empty = await model.submit()
        XCTAssertNil(empty)
        model.query = "   "
        let blank = await model.submit()
        XCTAssertNil(blank)
        XCTAssertTrue(model.history.entries.isEmpty)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testSubmitConsultsAtTagsForAnUnrecognizedUrl() async {
        let transport = transport()
        let model = makeModel(transport)
        model.query = "https://someones-blog.example/posts/hello"
        let destination = await model.submit()
        XCTAssertEqual(destination, .record(repo: "did:plc:blog", collection: "site.standard.document", rkey: "abc"))
        XCTAssertEqual(transport.count(containing: "at-tags?url=https%3A%2F%2Fsomeones-blog.example%2Fposts%2Fhello"), 1)
        XCTAssertEqual(model.history.entries.first?.path, "/explore/did:plc:blog/site.standard.document/abc")
        XCTAssertEqual(model.history.entries.first?.label, "https://someones-blog.example/posts/hello")
    }

    func testSubmitFallsBackToThePdsGuessWhenAtTagsFail() async {
        let transport = transport(atTags: .reply(status: 500, body: "nope"))
        let model = makeModel(transport)
        model.query = "https://someones-blog.example/posts/hello"
        let destination = await model.submit()
        XCTAssertEqual(destination, .pds(host: "someones-blog.example"))
        XCTAssertEqual(model.history.entries.first?.path, "/explore/pds/someones-blog.example")
    }

    // MARK: Recommendations

    func testRecommendationsShowOnlyOnAnEmptyFocusedInput() async {
        let transport = transport()
        let model = makeModel(transport)
        XCTAssertFalse(model.showsRecommendations, "nothing to recommend yet")
        model.focus()
        XCTAssertTrue(model.isFocused)
        XCTAssertFalse(model.showsRecommendations, "still nothing to recommend")

        model.history.recordQueryVisit("alice.test", path: "/explore/alice.test")
        XCTAssertTrue(model.showsRecommendations)
        XCTAssertEqual(model.recents.map(\.path), ["/explore/alice.test"])
        XCTAssertTrue(model.frequent.isEmpty, "one visit is not frequent")

        model.query = "x"
        XCTAssertFalse(model.showsRecommendations, "typing hands over to the typeahead")
        model.query = ""
        XCTAssertTrue(model.showsRecommendations)
        model.dismissSuggestions()
        XCTAssertFalse(model.showsRecommendations)

        model.history.recordQueryVisit("alice.test", path: "/explore/alice.test")
        XCTAssertEqual(model.frequent.map(\.path), ["/explore/alice.test"])
    }

    func testRecommendationsHideBehindALoadedSuggestionList() async {
        let transport = transport()
        let model = makeModel(transport)
        model.history.recordQueryVisit("alice.test", path: "/explore/alice.test")
        model.query = "al"
        await model.awaitPendingTypeahead()
        XCTAssertTrue(model.showsSuggestionList)
        XCTAssertFalse(model.showsRecommendations)
    }

    func testPickingAnEntryBumpsItsCountAndReturnsItsDestination() async {
        let transport = transport()
        let model = makeModel(transport)
        model.history.recordQueryVisit("alice.test", path: "/explore/alice.test")
        model.history.recordQueryVisit("pds.example", path: "/explore/pds/pds.example")
        model.focus()
        let entry = model.recents.first { $0.path == "/explore/alice.test" }!
        let destination = model.pick(entry: entry)
        XCTAssertEqual(destination, .repo("alice.test"))
        XCTAssertFalse(model.isFocused)
        XCTAssertEqual(model.history.entries.first { $0.path == "/explore/alice.test" }?.count, 2)

        let pdsEntry = model.recents.first { $0.path == "/explore/pds/pds.example" }!
        XCTAssertEqual(model.pick(entry: pdsEntry), .pds(host: "pds.example"))
    }

    func testFocusReloadsHistoryWrittenByAnotherProcess() async {
        let transport = transport()
        let model = makeModel(transport)
        let other = SearchHistoryStore(defaults: defaults)
        other.recordQueryVisit("bob.test", path: "/explore/bob.test")
        XCTAssertTrue(model.recents.isEmpty)
        model.focus()
        XCTAssertEqual(model.recents.map(\.path), ["/explore/bob.test"])
    }

    // MARK: Avatar backfill

    func testEnrichmentBackfillsAvatarsOncePerActor() async {
        let transport = transport()
        let model = makeModel(transport)
        model.history.recordQueryVisit("alice.test", path: "/explore/alice.test")
        model.history.recordQueryVisit("pds.example", path: "/explore/pds/pds.example")

        let changed = await model.enrichRecommendationAvatars()
        XCTAssertTrue(changed)
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=alice.test"])
        let alice = model.history.entries.first { $0.path == "/explore/alice.test" }
        XCTAssertEqual(alice?.avatar, "https://cdn.example/alice.jpg")
        XCTAssertEqual(alice?.label, "Alice")
        XCTAssertEqual(alice?.sublabel, "@alice.test")
        XCTAssertEqual(alice?.did, "did:plc:alice")
        XCTAssertEqual(alice?.handle, "alice.test")
        XCTAssertEqual(alice?.count, 1, "enrichment never touches the visit count")
        let pds = model.history.entries.first { $0.path == "/explore/pds/pds.example" }
        XCTAssertNil(pds?.avatar, "PDS entries have no actor")

        let again = await model.enrichRecommendationAvatars()
        XCTAssertFalse(again)
        XCTAssertEqual(transport.requests.count, 1, "already enriched entries are never re-fetched")
    }

    func testEnrichmentSkipsActorsTheAppViewDoesNotKnowAndDoesNotRetry() async {
        let transport = transport(profile: .reply(status: 400, body: #"{"error":"InvalidRequest"}"#))
        let model = makeModel(transport)
        model.history.recordQueryVisit("nobody.test", path: "/explore/nobody.test")
        let changed = await model.enrichRecommendationAvatars()
        XCTAssertFalse(changed)
        XCTAssertNil(model.history.entries.first?.avatar)
        XCTAssertEqual(model.history.entries.first?.label, "nobody.test")
        let again = await model.enrichRecommendationAvatars()
        XCTAssertFalse(again)
        XCTAssertEqual(transport.count(containing: "getProfile"), 1)
    }

    func testEnrichmentLeavesEntriesThatAlreadyHaveAnAvatarAlone() async {
        let transport = transport()
        let model = makeModel(transport)
        model.history.recordActorVisit(did: "did:plc:alice", handle: "alice.test", displayName: "Alice", avatar: "https://cdn.example/alice.jpg")
        let changed = await model.enrichRecommendationAvatars()
        XCTAssertFalse(changed)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    // MARK: Session

    func testSessionProfileUpgradesTheDidToAHandle() async {
        let transport = transport()
        let model = makeModel(transport, session: signedIn("did:plc:alice"))
        XCTAssertEqual(model.myRepo, "did:plc:alice", "the DID renders immediately")
        await model.awaitSessionProfile()
        XCTAssertEqual(model.sessionProfile?.handle, "alice.test")
        XCTAssertEqual(model.myRepo, "alice.test")
        XCTAssertEqual(model.otherExampleRepos, ExploreLandingModel.exampleRepos)
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=did%3Aplc%3Aalice"])

        model.session = .signedOut
        XCTAssertNil(model.myRepo)
        XCTAssertNil(model.sessionProfile)
        XCTAssertEqual(model.otherExampleRepos, ExploreLandingModel.exampleRepos)
    }

    func testOwnRepoIsNotListedTwiceAmongTheExamples() async {
        let dame = #"{"did":"did:plc:dame","handle":"dame.is","displayName":"Dame"}"#
        let transport = transport(profile: .reply(status: 200, body: dame))
        let model = makeModel(transport)
        XCTAssertEqual(model.otherExampleRepos, ["dame.is", "anisota.net", "aturi.to", "atpota.to"])
        model.session = signedIn("did:plc:dame")
        await model.awaitSessionProfile()
        XCTAssertEqual(model.myRepo, "dame.is")
        XCTAssertEqual(model.otherExampleRepos, ["anisota.net", "aturi.to", "atpota.to"])
    }

    func testSessionProfileFallsBackToTheDidWhenTheAppViewDoesNotAnswer() async {
        let transport = transport(profile: .reply(status: 503, body: "down"))
        let model = makeModel(transport, session: signedIn("did:plc:alice"))
        await model.awaitSessionProfile()
        XCTAssertNil(model.sessionProfile)
        XCTAssertEqual(model.myRepo, "did:plc:alice")
    }
}
