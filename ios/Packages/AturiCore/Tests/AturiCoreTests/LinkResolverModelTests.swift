import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport for the universal-link pipeline: the first
/// pattern found in the URL answers, anything else is a 404. An optional
/// delay lets a test cancel a resolution mid-flight.
private final class LinkResolverFakeTransport: HTTPTransport, @unchecked Sendable {
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
final class LinkResolverModelTests: XCTestCase {
    private typealias Route = LinkResolverFakeTransport.Route

    // Route keys: one per hop of the pipeline.
    nonisolated private static let resolveAppView = "public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle"
    nonisolated private static let resolveFallback = "bsky.social/xrpc/com.atproto.identity.resolveHandle"
    nonisolated private static let plcDocument = "plc.directory/did:plc:alice123"
    nonisolated private static let describeRepo = "pds.example/xrpc/com.atproto.repo.describeRepo"
    nonisolated private static let profile = "app.bsky.actor.getProfile"
    nonisolated private static let thread = "app.bsky.feed.getPostThread"
    nonisolated private static let pdsRecord = "pds.example/xrpc/com.atproto.repo.getRecord"
    nonisolated private static let publicRecord = "public.api.bsky.app/xrpc/com.atproto.repo.getRecord"

    nonisolated private static let did = "did:plc:alice123"
    nonisolated private static let didDocument = ##"{"id":"did:plc:alice123","alsoKnownAs":["at://alice.test"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}"##
    nonisolated private static let repoDescription = #"{"did":"did:plc:alice123","handle":"alice.test","collections":["app.bsky.feed.post"],"handleIsCorrect":true}"#
    nonisolated private static let aliceProfile = #"{"did":"did:plc:alice123","handle":"alice.test","displayName":"Alice","avatar":"https://cdn.example/a.jpg","followersCount":3}"#
    nonisolated private static let postThread = #"{"thread":{"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"at://did:plc:alice123/app.bsky.feed.post/3kabc","cid":"c1","author":{"did":"did:plc:alice123","handle":"alice.test"},"record":{"$type":"app.bsky.feed.post","text":"hello","createdAt":"2026-01-01T00:00:00Z"},"likeCount":2,"indexedAt":"2026-01-01T00:00:01Z"},"parent":{"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"at://did:plc:bob/app.bsky.feed.post/3kparent","cid":"c0","author":{"did":"did:plc:bob","handle":"bob.test"},"record":{"$type":"app.bsky.feed.post","text":"root","createdAt":"2025-12-31T00:00:00Z"},"indexedAt":"2025-12-31T00:00:01Z"}}}}"#
    nonisolated private static let genericRecord = #"{"uri":"at://did:plc:alice123/com.example.thing/abc","cid":"c2","value":{"$type":"com.example.thing","title":"Hi"}}"#

    nonisolated(unsafe) private var suiteName = ""
    nonisolated(unsafe) private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "AturiCoreTests.linkResolver.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        XCTAssertNotNil(defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    /// The happy-path routes, with per-test overrides taking precedence.
    private func transport(overrides: [(String, Route)] = [], delayNanoseconds: UInt64 = 0) -> LinkResolverFakeTransport {
        let base: [(String, Route)] = [
            (Self.resolveAppView, .reply(status: 200, body: #"{"did":"did:plc:alice123"}"#)),
            (Self.resolveFallback, .reply(status: 400, body: #"{"error":"InvalidRequest"}"#)),
            (Self.plcDocument, .reply(status: 200, body: Self.didDocument)),
            (Self.describeRepo, .reply(status: 200, body: Self.repoDescription)),
            (Self.profile, .reply(status: 200, body: Self.aliceProfile)),
            (Self.thread, .reply(status: 200, body: Self.postThread)),
            (Self.pdsRecord, .reply(status: 200, body: Self.genericRecord)),
            (Self.publicRecord, .reply(status: 404, body: #"{"error":"RecordNotFound"}"#)),
        ]
        return LinkResolverFakeTransport(overrides + base, delayNanoseconds: delayNanoseconds)
    }

    private func makeModel(_ transport: LinkResolverFakeTransport) -> LinkResolverModel {
        LinkResolverModel(preferences: PreferencesStore(defaults: defaults, debounce: 0), http: HTTPClient(transport: transport))
    }

    private func waypointIds(_ model: LinkResolverModel) -> [String] {
        model.waypoints.flatMap { $0.waypoints.map(\.id) }
    }

    // MARK: Posts

    func testPostLinkLoadsTheThreadAndParent() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.resolve("https://bsky.app/profile/alice.test/post/3kabc")

        guard let link = model.link else { return XCTFail("expected a resolved link") }
        XCTAssertEqual(link.type, .post)
        XCTAssertEqual(link.did, Self.did)
        XCTAssertEqual(link.handle, "alice.test")
        XCTAssertEqual(link.displayName, "@alice.test")
        XCTAssertEqual(link.collection, "app.bsky.feed.post")
        XCTAssertEqual(link.rkey, "3kabc")
        XCTAssertEqual(link.atUri, "at://did:plc:alice123/app.bsky.feed.post/3kabc")
        XCTAssertEqual(link.aturiLink, "https://aturi.to/profile/alice.test/post/3kabc")
        XCTAssertEqual(model.shareLink, link.aturiLink)
        XCTAssertTrue(link.isRecord)
        XCTAssertEqual(link.autoRedirectContext, AutoRedirectContext(type: .post, handle: "alice.test", did: Self.did, collection: "app.bsky.feed.post", rkey: "3kabc"))

        guard case .loaded(.post(let post, let parent)) = model.state else { return XCTFail("expected a post, got \(model.state)") }
        XCTAssertEqual(post.uri, "at://did:plc:alice123/app.bsky.feed.post/3kabc")
        XCTAssertEqual(post.record.text, "hello")
        XCTAssertEqual(post.likeCount, 2)
        XCTAssertEqual(parent?.uri, "at://did:plc:bob/app.bsky.feed.post/3kparent")

        XCTAssertEqual(model.contextText, "Open post by @alice.test on...")
        XCTAssertNil(model.repoCollections, "record pages do not scan the repo")
        XCTAssertTrue(model.hasWaypoints)
        XCTAssertTrue(waypointIds(model).contains("bluesky"))
        XCTAssertEqual(model.recommended?.waypoints.map(\.id), ["bluesky", "anisota", "blacksky"])
        XCTAssertFalse(model.recommended?.label.isEmpty ?? true)
        XCTAssertEqual(model.featured?.id, "bluesky")
        XCTAssertEqual(model.url(for: WaypointCatalog.all["bluesky"]!), "https://bsky.app/profile/alice.test/post/3kabc")

        XCTAssertEqual(transport.count(containing: "resolveHandle?handle=alice.test"), 1)
        XCTAssertEqual(transport.count(containing: "getPostThread?uri=at%3A%2F%2Fdid%3Aplc%3Aalice123%2Fapp.bsky.feed.post%2F3kabc&depth=0&parentHeight=1"), 1)
        XCTAssertEqual(transport.count(containing: "plc.directory"), 0, "a handle input never needs the DID document")
        XCTAssertEqual(transport.count(containing: "describeRepo"), 0)
    }

    func testPostFallsBackToTheRecordWhenTheThreadIsMissing() async {
        let transport = transport(overrides: [(Self.thread, .reply(status: 404, body: #"{"error":"NotFound"}"#))])
        let model = makeModel(transport)
        await model.resolve("at://alice.test/app.bsky.feed.post/abc")
        guard case .loaded(.record(let record, let identity)) = model.state else { return XCTFail("expected a record, got \(model.state)") }
        XCTAssertEqual(record.uri, "at://did:plc:alice123/com.example.thing/abc")
        XCTAssertEqual(identity, IdentityBundle(did: Self.did, handle: "alice.test", pds: "https://pds.example"))
        XCTAssertEqual(model.link?.type, .post)
        XCTAssertEqual(transport.count(containing: "getRecord?repo=did%3Aplc%3Aalice123&collection=app.bsky.feed.post&rkey=abc"), 1)
    }

    func testPostWithNoPreviewIsUnavailableButThePickerStillRenders() async {
        let transport = transport(overrides: [
            (Self.thread, .reply(status: 502, body: "bad gateway")),
            (Self.pdsRecord, .reply(status: 400, body: #"{"error":"RecordNotFound"}"#)),
        ])
        let model = makeModel(transport)
        await model.resolve("https://bsky.app/profile/alice.test/post/3kgone")
        XCTAssertEqual(model.state, .loaded(.unavailable(LinkResolverModel.unavailableMessage(for: .post))))
        XCTAssertNotNil(model.link)
        XCTAssertTrue(model.hasWaypoints)
        XCTAssertFalse(model.waypoints.isEmpty)
        XCTAssertEqual(transport.count(containing: Self.publicRecord), 1, "the public API is tried after the PDS")
    }

    // MARK: Profiles

    func testProfileLinkLoadsTheProfileAndCollections() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.resolve("alice.test")

        guard case .loaded(.profile(let profile, let collections)) = model.state else { return XCTFail("expected a profile, got \(model.state)") }
        XCTAssertEqual(profile.handle, "alice.test")
        XCTAssertEqual(profile.displayName, "Alice")
        XCTAssertEqual(collections, ["app.bsky.feed.post"])
        XCTAssertEqual(model.repoCollections, ["app.bsky.feed.post"])

        guard let link = model.link else { return XCTFail("expected a resolved link") }
        XCTAssertEqual(link.type, .profile)
        XCTAssertFalse(link.isRecord)
        XCTAssertEqual(link.atUri, "at://did:plc:alice123")
        XCTAssertEqual(link.aturiLink, "https://aturi.to/profile/alice.test")
        XCTAssertEqual(model.contextText, "Open profile for @alice.test on...")

        let ids = waypointIds(model)
        XCTAssertTrue(ids.contains("bluesky"), "app.bsky. records are present")
        XCTAssertTrue(ids.contains("pdsls"), "generic explorers declare no expectations and are never hidden")
        XCTAssertFalse(ids.contains("tangled"), "no sh.tangled.* records in the repo")
        XCTAssertFalse(ids.contains("margin"))
        XCTAssertEqual(model.recommended?.waypoints.map(\.id), ["bluesky", "anisota"])
        XCTAssertEqual(model.featured?.id, "bluesky")
        XCTAssertTrue(model.availableWaypoints.map(\.id).contains("bluesky"))
        XCTAssertFalse(model.availableWaypoints.map(\.id).contains("tangled"))

        XCTAssertEqual(transport.count(containing: "getProfile?actor=did%3Aplc%3Aalice123"), 1)
        XCTAssertEqual(transport.count(containing: "describeRepo?repo=did%3Aplc%3Aalice123"), 1)
    }

    func testProfileTheAppViewDoesNotKnowIsUnavailableButKeepsTheScan() async {
        let transport = transport(overrides: [(Self.profile, .reply(status: 400, body: #"{"error":"InvalidRequest","message":"Profile not found"}"#))])
        let model = makeModel(transport)
        await model.resolve("alice.test")
        XCTAssertEqual(model.state, .loaded(.unavailable(LinkResolverModel.unavailableMessage(for: .profile))))
        XCTAssertEqual(model.repoCollections, ["app.bsky.feed.post"])
        XCTAssertNotNil(model.link)
        XCTAssertTrue(model.hasWaypoints)
    }

    func testFailedRepoScanLeavesEveryWaypointVisible() async {
        let transport = transport(overrides: [(Self.describeRepo, .fail(URLError(.timedOut)))])
        let model = makeModel(transport)
        await model.resolve("alice.test")
        XCTAssertNil(model.repoCollections)
        guard case .loaded(.profile(_, let collections)) = model.state else { return XCTFail("expected a profile, got \(model.state)") }
        XCTAssertNil(collections)
        XCTAssertTrue(waypointIds(model).contains("tangled"))
    }

    func testDidInputResolvesTheDisplayHandleFromTheDidDocument() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.resolve("did:plc:alice123")
        XCTAssertEqual(model.link?.handle, "alice.test")
        XCTAssertEqual(model.link?.displayName, "@alice.test")
        XCTAssertEqual(model.link?.parsed.handle, "did:plc:alice123")
        XCTAssertEqual(model.link?.parsed.did, "did:plc:alice123")
        XCTAssertEqual(model.link?.aturiLink, "https://aturi.to/profile/alice.test")
        XCTAssertEqual(transport.count(containing: "resolveHandle"), 0, "a DID needs no handle resolution")
        XCTAssertGreaterThanOrEqual(transport.count(containing: "plc.directory"), 1)
    }

    func testDidInputWithoutAHandleKeepsTheDid() async {
        let bareDocument = ##"{"id":"did:plc:alice123","service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}"##
        let transport = transport(overrides: [(Self.plcDocument, .reply(status: 200, body: bareDocument))])
        let model = makeModel(transport)
        await model.resolve("https://aturi.to/profile/did:plc:alice123")
        XCTAssertEqual(model.link?.handle, "did:plc:alice123")
        XCTAssertEqual(model.link?.displayName, "@did:plc:alice123...")
        XCTAssertEqual(model.contextText, "Open profile for @did:plc:alice123... on...")
    }

    func testAtPrefixedHandleIsStripped() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.resolve("@alice.test")
        XCTAssertEqual(model.link?.handle, "alice.test")
        XCTAssertEqual(model.link?.components.identifier, "alice.test")
        XCTAssertEqual(transport.count(containing: "resolveHandle?handle=alice.test"), 1)
    }

    // MARK: Generic records and lists

    func testGenericRecordLoadsFromThePds() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.resolve("at://alice.test/com.example.thing/abc")
        guard case .loaded(.record(let record, let identity)) = model.state else { return XCTFail("expected a record, got \(model.state)") }
        XCTAssertEqual(record.cid, "c2")
        XCTAssertEqual(record.value["title"]?.stringValue, "Hi")
        XCTAssertEqual(identity.pds, "https://pds.example")
        XCTAssertEqual(identity.handle, "alice.test")
        XCTAssertEqual(model.link?.type, .record)
        XCTAssertEqual(model.link?.aturiLink, "https://aturi.to/profile/alice.test/com.example.thing/abc")
        XCTAssertEqual(model.contextText, "Open record from @alice.test on...")
        XCTAssertEqual(model.recommended?.waypoints.map(\.id), ["aturiExplore", "pdsls", "atptools", "taproot"])
        XCTAssertEqual(transport.count(containing: "getPostThread"), 0)
        XCTAssertEqual(transport.count(containing: "com.atproto.repo.getRecord?repo=did%3Aplc%3Aalice123&collection=com.example.thing&rkey=abc"), 1)
    }

    func testRecordFallsBackToThePublicApiWhenThePdsRefuses() async {
        let transport = transport(overrides: [
            (Self.pdsRecord, .reply(status: 400, body: #"{"error":"RepoTakendown"}"#)),
            (Self.publicRecord, .reply(status: 200, body: Self.genericRecord)),
        ])
        let model = makeModel(transport)
        await model.resolve("at://did:plc:alice123/com.example.thing/abc")
        guard case .loaded(.record(let record, let identity)) = model.state else { return XCTFail("expected a record, got \(model.state)") }
        XCTAssertEqual(record.uri, "at://did:plc:alice123/com.example.thing/abc")
        XCTAssertEqual(identity.pds, "https://public.api.bsky.app")
        XCTAssertEqual(identity.handle, "alice.test", "the display handle came from the DID document")
    }

    func testListLinkIsTypedAsAList() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.resolve("https://bsky.app/profile/alice.test/lists/3klist")
        XCTAssertEqual(model.link?.type, .list)
        XCTAssertEqual(model.link?.collection, "app.bsky.graph.list")
        XCTAssertEqual(model.link?.aturiLink, "https://aturi.to/profile/alice.test/lists/3klist")
        XCTAssertEqual(model.contextText, "Open list by @alice.test on...")
        guard case .loaded(.record) = model.state else { return XCTFail("expected a record preview, got \(model.state)") }
        XCTAssertEqual(model.recommended?.waypoints.map(\.id), ["bluesky", "anisota"])
    }

    // MARK: Failures

    func testUnknownHandleIsNotFound() async {
        let transport = transport(overrides: [(Self.resolveAppView, .reply(status: 400, body: #"{"error":"InvalidRequest","message":"Unable to resolve handle"}"#))])
        let model = makeModel(transport)
        await model.resolve("nobody.test")
        XCTAssertEqual(model.state, .loaded(.notFound))
        XCTAssertNil(model.link)
        XCTAssertTrue(model.waypoints.isEmpty)
        XCTAssertNil(model.recommended)
        XCTAssertNil(model.featured)
        XCTAssertFalse(model.hasWaypoints)
        XCTAssertNil(model.autoRedirectTarget)
        XCTAssertEqual(model.contextText, "")
        XCTAssertEqual(transport.count(containing: "resolveHandle"), 2, "both resolvers must say no")
    }

    func testResolverOutageIsARetryableFailureNotANotFound() async {
        let transport = transport(overrides: [
            (Self.resolveAppView, .reply(status: 503, body: "upstream")),
            (Self.resolveFallback, .fail(URLError(.notConnectedToInternet))),
        ])
        let model = makeModel(transport)
        await model.resolve("alice.test")
        guard case .failed(let message) = model.state else { return XCTFail("expected a failure, got \(model.state)") }
        XCTAssertTrue(message.contains("resolver"), message)
        XCTAssertTrue(message.contains("alice.test"), message)
        XCTAssertNil(model.link)
        XCTAssertEqual(model.input, "alice.test")

        // A retry with the resolver back lands on the profile.
        let recovered = self.transport()
        let again = LinkResolverModel(preferences: PreferencesStore(defaults: defaults, debounce: 0), http: HTTPClient(transport: recovered))
        await again.resolve("alice.test")
        XCTAssertNotNil(again.link)
    }

    func testInputThatNamesNothingFails() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.resolve("not a link")
        guard case .failed(let message) = model.state else { return XCTFail("expected a failure, got \(model.state)") }
        XCTAssertTrue(message.contains("at://"), message)
        XCTAssertNil(model.link)
        XCTAssertTrue(transport.requests.isEmpty)

        await model.resolve("at://did:plc:alice123/space/com.example.forum")
        XCTAssertEqual(model.state, .failed("Space URIs are not public records"))
        XCTAssertTrue(transport.requests.isEmpty)

        await model.resolve("   ")
        XCTAssertEqual(model.state, .idle)
        XCTAssertNil(model.link)
    }

    // MARK: Reload and cancellation

    func testANewLoadReplacesTheEarlierResolution() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.resolve("alice.test")
        XCTAssertEqual(model.link?.type, .profile)
        XCTAssertNotNil(model.repoCollections)
        await model.resolve("https://bsky.app/profile/alice.test/post/3kabc")
        XCTAssertEqual(model.link?.type, .post)
        XCTAssertNil(model.repoCollections, "the previous scan does not leak into a record page")
        XCTAssertEqual(model.input, "https://bsky.app/profile/alice.test/post/3kabc")

        model.reload()
        XCTAssertTrue(model.state.isLoading)
        await model.awaitLoad()
        XCTAssertEqual(model.link?.type, .post)
    }

    func testLoadCancelsTheResolutionInFlight() async {
        let transport = transport(delayNanoseconds: 30_000_000)
        let model = makeModel(transport)
        model.load("alice.test")
        XCTAssertTrue(model.state.isLoading)
        model.load("did:plc:alice123")
        await model.awaitLoad()
        XCTAssertEqual(model.link?.parsed.handle, "did:plc:alice123")
        guard case .loaded(.profile) = model.state else { return XCTFail("expected the second load's profile, got \(model.state)") }

        model.load("alice.test")
        model.cancel()
        await model.awaitLoad()
        XCTAssertTrue(model.state.isLoading, "a cancelled load never settles")
        XCTAssertNil(model.link)
    }

    // MARK: Preferences

    func testPersonalisationHidesWaypointsInNoGroup() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.resolve("https://bsky.app/profile/alice.test/post/3kabc")
        model.preferences.update { $0.setWaypointGroups([WaypointGroup(id: "mine", name: "Mine", waypointIds: ["pdsls", "bluesky"])]) }
        XCTAssertEqual(model.waypoints.map(\.category.name), ["Mine"])
        XCTAssertEqual(waypointIds(model), ["pdsls", "bluesky"])
        XCTAssertEqual(model.recommended?.waypoints.map(\.id), ["bluesky"], "recommendations are narrowed to surfaced waypoints")
        XCTAssertEqual(model.availableWaypoints.map(\.id), ["pdsls", "bluesky"])

        model.preferences.update { $0.setWaypointGroups([]) }
        XCTAssertTrue(model.waypoints.isEmpty)
        XCTAssertEqual(model.recommended?.waypoints.isEmpty, true)
        XCTAssertNil(model.featured)
        XCTAssertFalse(model.hasWaypoints)
    }

    func testCustomWaypointsRenderThroughTheirTemplates() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.resolve("https://bsky.app/profile/alice.test/post/3kabc")
        let custom = CustomWaypoint(
            id: "custom:one",
            name: "Mine",
            supportedTypes: [.post],
            templates: [.post: "https://viewer.example/{did}/{rkey}"]
        )
        model.preferences.update {
            $0.customWaypoints = [custom]
            $0.setWaypointGroups([WaypointGroup(id: "g", name: "Custom", waypointIds: ["custom:one"])])
        }
        XCTAssertEqual(waypointIds(model), ["custom:one"])
        // `expandTemplate` keeps the web's `did%3A` spelling for the colons
        // after the method, so the app and the site emit identical links.
        XCTAssertEqual(model.url(for: model.waypoints.first!.waypoints.first!), "https://viewer.example/did:plc%3Aalice123/3kabc")
        XCTAssertEqual(model.availableWaypoints.map(\.id), ["custom:one"])
        XCTAssertEqual(LinkResolverModel.waypointName("custom:one", customWaypoints: [custom]), "Mine")
        XCTAssertEqual(LinkResolverModel.waypointName("bluesky", customWaypoints: []), "Bluesky")
        XCTAssertEqual(LinkResolverModel.waypointName("gone", customWaypoints: []), "your preferred client")
    }

    func testLayoutSwitchIsSavedToPreferences() async {
        let transport = transport()
        let model = makeModel(transport)
        XCTAssertEqual(model.layout, .dense)
        model.setLayout(.grid)
        XCTAssertEqual(model.layout, .grid)
        XCTAssertEqual(model.preferences.prefs.waypointLayout, .grid)
        let updatedAt = model.preferences.prefs.updatedAt
        model.setLayout(.grid)
        XCTAssertEqual(model.preferences.prefs.updatedAt, updatedAt, "setting the same layout is a no-op")
    }

    func testNewWaypointBannerAddsOrDismisses() async {
        let transport = transport()
        let model = makeModel(transport)
        XCTAssertTrue(model.newWaypoints.isEmpty, "a fresh install knows every built-in")

        model.preferences.update { $0.knownWaypointIds = ["bluesky"] }
        XCTAssertEqual(model.newWaypoints.count, WaypointCatalog.order.count - 1)
        model.dismissNewWaypoints()
        XCTAssertTrue(model.newWaypoints.isEmpty)
        XCTAssertEqual(Set(model.preferences.prefs.knownWaypointIds), Set(WaypointCatalog.order))

        model.preferences.update {
            $0.knownWaypointIds = ["bluesky"]
            $0.setWaypointGroups([])
        }
        model.addNewWaypoints()
        XCTAssertTrue(model.newWaypoints.isEmpty)
        XCTAssertFalse(model.preferences.prefs.waypointGroups.isEmpty, "the default groups were recreated")
        XCTAssertTrue(model.preferences.prefs.waypointGroups.flatMap(\.waypointIds).contains("tangled"))
    }

    // MARK: Auto-redirect

    func testAutoRedirectFollowsTheFavouriteAndCountsDown() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.resolve("https://bsky.app/profile/alice.test/post/3kabc")
        XCTAssertNil(model.autoRedirectTarget, "off by default")
        XCTAssertNil(model.autoRedirectTargetName)
        XCTAssertNil(model.armAutoRedirect(after: 0))
        XCTAssertFalse(model.isAutoRedirectArmed)

        model.preferences.update {
            $0.setAutoRedirect(true)
            $0.setFavorite(for: .blueskySocial, waypointId: "bluesky")
        }
        let target = model.autoRedirectTarget
        XCTAssertEqual(target?.waypointId, "bluesky")
        XCTAssertEqual(target?.family, .blueskySocial)
        XCTAssertEqual(target?.url, "https://bsky.app/profile/alice.test/post/3kabc")
        XCTAssertEqual(model.autoRedirectTargetName, "Bluesky")
        XCTAssertEqual(model.autoRedirectFamilyName, WaypointCatalog.compatFamilies[.blueskySocial]?.name)

        XCTAssertEqual(model.armAutoRedirect(after: 0.01), target)
        XCTAssertTrue(model.isAutoRedirectArmed)
        XCTAssertNil(model.autoRedirectFired)
        try? await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertFalse(model.isAutoRedirectArmed)
        XCTAssertEqual(model.autoRedirectFired, target)
        XCTAssertEqual(model.consumeAutoRedirect(), target)
        XCTAssertNil(model.consumeAutoRedirect(), "consumed once")

        // Interaction cancels the countdown before it fires.
        XCTAssertNotNil(model.armAutoRedirect(after: 0.02))
        model.cancelAutoRedirect()
        XCTAssertFalse(model.isAutoRedirectArmed)
        try? await Task.sleep(nanoseconds: 80_000_000)
        XCTAssertNil(model.autoRedirectFired)
    }

    func testAutoRedirectIgnoresAFavouriteThatCannotRenderThePage() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.resolve("at://alice.test/com.example.thing/abc")
        model.preferences.update {
            $0.setAutoRedirect(true)
            $0.setFavorite(for: .blueskySocial, waypointId: "bluesky")
        }
        XCTAssertNil(model.autoRedirectTarget, "Bluesky claims app.bsky.* only")
        model.preferences.update { $0.setFavorite(for: .atprotoExplorer, waypointId: "pdsls") }
        XCTAssertEqual(model.autoRedirectTarget?.waypointId, "pdsls")
        model.preferences.update { $0.setFavorite(for: .atprotoExplorer, waypointId: "aturiExplore") }
        XCTAssertNil(model.autoRedirectTarget, "a favourite served from aturi.to cannot loop back")
    }

    func testANewLoadCancelsAnArmedRedirect() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.resolve("https://bsky.app/profile/alice.test/post/3kabc")
        model.preferences.update {
            $0.setAutoRedirect(true)
            $0.setFavorite(for: .blueskySocial, waypointId: "bluesky")
        }
        XCTAssertNotNil(model.armAutoRedirect(after: 0.02))
        await model.resolve("alice.test")
        XCTAssertFalse(model.isAutoRedirectArmed)
        try? await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertNil(model.autoRedirectFired)
    }
}
