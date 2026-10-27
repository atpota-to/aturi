import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport for the record page: the first pattern found
/// in the URL answers, anything else is a 404. An optional delay lets a
/// test cancel a load mid-flight.
private final class RecordFakeTransport: HTTPTransport, @unchecked Sendable {
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
final class RecordModelTests: XCTestCase {
    private typealias Route = RecordFakeTransport.Route

    // Route keys: one per hop of the page.
    nonisolated private static let resolveAppView = "public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle"
    nonisolated private static let resolveFallback = "bsky.social/xrpc/com.atproto.identity.resolveHandle"
    nonisolated private static let plcDocument = "plc.directory/did:plc:alice123"
    nonisolated private static let describeRepo = "pds.example/xrpc/com.atproto.repo.describeRepo"
    nonisolated private static let pdsRecord = "pds.example/xrpc/com.atproto.repo.getRecord"
    nonisolated private static let thread = "app.bsky.feed.getPostThread"
    nonisolated private static let profile = "app.bsky.actor.getProfile"
    nonisolated private static let usageStats = "ufos-api.microcosm.blue/collections/stats"
    nonisolated private static let usageSeries = "ufos-api.microcosm.blue/timeseries"
    nonisolated private static let backlinkSources = "constellation.microcosm.blue/links/all"
    nonisolated private static let backlinkPage = "blue.microcosm.links.getBacklinks"

    nonisolated private static let did = "did:plc:alice123"
    nonisolated private static let didDocument = ##"{"id":"did:plc:alice123","alsoKnownAs":["at://alice.test"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}"##
    nonisolated private static let repoDescription = #"{"did":"did:plc:alice123","handle":"alice.test","collections":["app.bsky.feed.post"],"handleIsCorrect":true}"#
    nonisolated private static let postRecord = #"{"uri":"at://did:plc:alice123/app.bsky.feed.post/3kabc","cid":"c1","value":{"$type":"app.bsky.feed.post","text":"hello","createdAt":"2026-01-01T00:00:00Z"}}"#
    nonisolated private static let postThread = #"{"thread":{"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"at://did:plc:alice123/app.bsky.feed.post/3kabc","cid":"c1","author":{"did":"did:plc:alice123","handle":"alice.test"},"record":{"$type":"app.bsky.feed.post","text":"hello","createdAt":"2026-01-01T00:00:00Z"},"replyCount":1,"repostCount":2,"likeCount":3,"quoteCount":4,"indexedAt":"2026-01-01T00:00:01Z"},"parent":{"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"at://did:plc:bob/app.bsky.feed.post/3kparent","cid":"c0","author":{"did":"did:plc:bob","handle":"bob.test"},"record":{"$type":"app.bsky.feed.post","text":"root","createdAt":"2025-12-31T00:00:00Z"},"indexedAt":"2025-12-31T00:00:01Z"}}}}"#
    nonisolated private static let aliceProfile = #"{"did":"did:plc:alice123","handle":"alice.test","displayName":"Alice","followersCount":10,"followsCount":20,"postsCount":30}"#
    nonisolated private static let statsBody = #"{"app.bsky.feed.post":{"creates":5000,"updates":1,"deletes":0,"dids_estimate":1234}}"#
    nonisolated private static let seriesBody = #"{"range":["2026-01-01T00:00:00Z","2026-01-01T12:00:00Z"],"series":{"app.bsky.feed.post":[{"creates":1,"updates":0,"deletes":0,"dids_estimate":1},{"creates":0,"updates":0,"deletes":0,"dids_estimate":0}]}}"#
    nonisolated private static let sourcesBody = #"{"links":{"app.bsky.feed.like":{".subject.uri":{"records":2,"distinct_dids":2}}}}"#
    nonisolated private static let pageBody = #"{"linking_records":[{"did":"did:plc:bob","collection":"app.bsky.feed.like","rkey":"3k1"}]}"#

    nonisolated(unsafe) private var suiteName = ""
    nonisolated(unsafe) private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "AturiCoreTests.recordModel.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        XCTAssertNotNil(defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    /// The happy-path routes, with per-test overrides taking precedence.
    private func transport(overrides: [(String, Route)] = [], delayNanoseconds: UInt64 = 0) -> RecordFakeTransport {
        let base: [(String, Route)] = [
            (Self.resolveAppView, .reply(status: 200, body: #"{"did":"did:plc:alice123"}"#)),
            (Self.resolveFallback, .reply(status: 400, body: #"{"error":"InvalidRequest"}"#)),
            (Self.plcDocument, .reply(status: 200, body: Self.didDocument)),
            (Self.describeRepo, .reply(status: 200, body: Self.repoDescription)),
            (Self.pdsRecord, .reply(status: 200, body: Self.postRecord)),
            (Self.thread, .reply(status: 200, body: Self.postThread)),
            (Self.profile, .reply(status: 200, body: Self.aliceProfile)),
            (Self.usageStats, .reply(status: 200, body: Self.statsBody)),
            (Self.usageSeries, .reply(status: 200, body: Self.seriesBody)),
            (Self.backlinkSources, .reply(status: 200, body: Self.sourcesBody)),
            (Self.backlinkPage, .reply(status: 200, body: Self.pageBody)),
        ]
        return RecordFakeTransport(overrides + base, delayNanoseconds: delayNanoseconds)
    }

    private func makeModel(
        _ transport: RecordFakeTransport,
        repo: String = "alice.test",
        collection: String = "app.bsky.feed.post",
        rkey: String = "3kabc",
        session: SessionState = .signedOut
    ) -> RecordModel {
        RecordModel(
            repo: repo,
            collection: collection,
            rkey: rkey,
            preferences: PreferencesStore(defaults: defaults, debounce: 0),
            http: HTTPClient(transport: transport),
            session: session,
            hydratesBacklinks: false
        )
    }

    private func signedIn(as did: String) -> SessionState {
        .signedIn(OAuthSession(
            did: did,
            handle: "alice.test",
            pds: URL(string: "https://pds.example")!,
            issuer: "https://pds.example",
            accessToken: "token",
            dpopKey: DPoPKeySerialization(privateKey: Data(), publicJWK: [:])
        ))
    }

    // MARK: Posts

    func testPostLoadsTheCardUsageAndBacklinks() async {
        let transport = transport()
        let model = makeModel(transport)
        XCTAssertEqual(model.decodedRkey, "3kabc")
        XCTAssertTrue(model.isPost)
        XCTAssertTrue(model.hasRichCard)
        XCTAssertFalse(model.isEngagementApplicable)
        await model.loadAndWait()

        XCTAssertEqual(model.identity, .loaded(IdentityBundle(did: Self.did, handle: "alice.test", pds: "https://pds.example")))
        XCTAssertEqual(model.did, Self.did)
        XCTAssertEqual(model.handleOrDid, "alice.test")
        XCTAssertEqual(model.atUri, "at://did:plc:alice123/app.bsky.feed.post/3kabc")
        XCTAssertEqual(model.recordValue?.cid, "c1")
        XCTAssertEqual(model.recordValue?.value["text"]?.stringValue, "hello")
        XCTAssertNil(model.failure)

        guard case .loaded(let thread?) = model.postThread else { return XCTFail("expected a thread, got \(model.postThread)") }
        XCTAssertEqual(thread.post.likeCount, 3)
        XCTAssertEqual(thread.parent?.uri, "at://did:plc:bob/app.bsky.feed.post/3kparent")
        XCTAssertEqual(model.richCard, .post(thread.post, parent: thread.parent))
        XCTAssertTrue(model.engagement.isIdle, "a post's counts live on its card")
        XCTAssertEqual(RecordModel.engagementStats(of: thread.post).map(\.value), [1, 2, 3, 4])

        guard let usage = model.lexiconUsage.value else { return XCTFail("expected usage, got \(model.lexiconUsage)") }
        XCTAssertEqual(usage.collection, "app.bsky.feed.post")
        XCTAssertEqual(usage.counts.creates, 5000)
        XCTAssertEqual(usage.counts.didsEstimate, 1234)
        XCTAssertEqual(usage.series, [1, 0])
        XCTAssertTrue(usage.hasSparkline)
        XCTAssertEqual(usage.createsText, UFOsFormat.formatCount(5000))
        XCTAssertEqual(usage.reposText, UFOsFormat.formatCount(1234))
        XCTAssertEqual(usage.lexiconPath, NSID.lexiconPathFor("app.bsky.feed.post"))
        XCTAssertEqual(usage.title, "Explore usage of app.bsky.feed.post across the atmosphere")

        XCTAssertEqual(model.backlinks.target, model.atUri)
        XCTAssertEqual(model.backlinks.sourceList.map(\.source), ["app.bsky.feed.like:subject.uri"])
        XCTAssertEqual(model.backlinks.countText, "2")

        guard let copyRow = model.copyRow else { return XCTFail("expected a copy row") }
        XCTAssertEqual(copyRow.atUri, model.atUri)
        XCTAssertEqual(copyRow.did, Self.did)
        XCTAssertEqual(copyRow.pds, "https://pds.example")
        XCTAssertEqual(copyRow.universalPath, "/profile/alice.test/app.bsky.feed.post/3kabc")
        XCTAssertEqual(copyRow.universalLink, "https://aturi.to/profile/alice.test/app.bsky.feed.post/3kabc")
        XCTAssertEqual(copyRow.pdsRecordURL?.absoluteString, "https://pds.example/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Aalice123&collection=app.bsky.feed.post&rkey=3kabc")
        guard let json = copyRow.recordJSON else { return XCTFail("expected the record JSON") }
        XCTAssertTrue(json.contains("\"cid\""), json)
        XCTAssertTrue(json.contains("\"uri\""), json)
        XCTAssertTrue(json.contains("hello"), json)
        XCTAssertTrue(json.contains("\n  "), "two-space indented")

        XCTAssertEqual(model.sections.map(\.id), ["richPreview", "structuredJson", "rawJson", "copyRow", "lexiconUsage", "backlinks", "signIn"])
        XCTAssertEqual(model.sections.map(\.hidden), [false, false, true, false, false, false, false])
        XCTAssertEqual(model.sections.map(\.isDataView), [true, true, true, false, false, false, false])
        XCTAssertEqual(model.sections[2].toggleLabel, "Show raw JSON")
        XCTAssertEqual(model.sections[0].toggleLabel, "Hide rich preview")
        XCTAssertEqual(model.sections[1].toggleLabel, "Hide rich JSON preview")
        XCTAssertNil(model.sections[3].toggleLabel)
        XCTAssertFalse(model.canEdit)
        XCTAssertTrue(model.showsSignInPrompt)
        XCTAssertEqual(model.signInDefaultInput, "alice.test")

        XCTAssertEqual(model.waypointType, .post)
        XCTAssertTrue(model.waypoints.flatMap { $0.waypoints.map(\.id) }.contains("bluesky"))
        XCTAssertEqual(model.recommended?.waypoints.map(\.id), ["bluesky", "anisota", "blacksky"])
        XCTAssertEqual(model.featured?.id, "bluesky")
        XCTAssertEqual(model.url(for: WaypointCatalog.all["bluesky"]!), "https://bsky.app/profile/alice.test/post/3kabc")

        XCTAssertEqual(transport.count(containing: Self.thread), 1, "the card's thread; no engagement strip for a post")
        XCTAssertEqual(transport.count(containing: Self.profile), 0)
        XCTAssertEqual(transport.count(containing: "getRecord?repo=did%3Aplc%3Aalice123&collection=app.bsky.feed.post&rkey=3kabc"), 1)
        XCTAssertEqual(transport.count(containing: "collections/stats?collection=app.bsky.feed.post&since="), 1)
        XCTAssertEqual(transport.count(containing: "timeseries?collection=app.bsky.feed.post&step=43200&since="), 1)
    }

    func testPostWithoutAThreadHasNoCard() async {
        let transport = transport(overrides: [(Self.thread, .reply(status: 404, body: #"{"error":"NotFound"}"#))])
        let model = makeModel(transport)
        await model.loadAndWait()
        XCTAssertEqual(model.postThread, .loaded(nil))
        XCTAssertNil(model.richCard)
        XCTAssertTrue(model.hasRichCard, "the section still exists; the card is just empty")
        XCTAssertEqual(model.sections.first?.id, "richPreview")
    }

    // MARK: Other records

    func testGenericRecordHasNoCardAndNoCounts() async {
        let record = #"{"uri":"at://did:plc:alice123/com.example.thing/abc","cid":"c2","value":{"$type":"com.example.thing","title":"Hi"}}"#
        let transport = transport(overrides: [
            (Self.pdsRecord, .reply(status: 200, body: record)),
            (Self.usageStats, .reply(status: 200, body: "{}")),
            (Self.usageSeries, .reply(status: 200, body: #"{"range":[],"series":{}}"#)),
        ])
        let model = makeModel(transport, collection: "com.example.thing", rkey: "abc")
        await model.loadAndWait()

        XCTAssertFalse(model.hasRichCard)
        XCTAssertNil(model.marginType)
        XCTAssertNil(model.richCard)
        XCTAssertTrue(model.postThread.isIdle)
        XCTAssertTrue(model.isEngagementApplicable)
        XCTAssertEqual(model.engagement, .loaded([]), "no source of counts for this lexicon")
        XCTAssertEqual(model.lexiconUsage.value, LexiconUsageSummary(collection: "com.example.thing", counts: .zero, series: []))
        XCTAssertEqual(model.lexiconUsage.value?.hasSparkline, false)
        XCTAssertEqual(model.sections.map(\.id), ["structuredJson", "rawJson", "engagement", "copyRow", "lexiconUsage", "backlinks", "signIn"])
        XCTAssertEqual(model.waypointType, .record)
        XCTAssertEqual(model.recommended?.waypoints.map(\.id), ["aturiExplore", "pdsls", "atptools", "taproot"])
        XCTAssertEqual(transport.count(containing: Self.thread), 0)
        XCTAssertEqual(transport.count(containing: Self.profile), 0)
    }

    func testFeedRecordCountsComeFromTheThread() async {
        let like = #"{"uri":"at://did:plc:alice123/app.bsky.feed.like/3klike","cid":"c3","value":{"$type":"app.bsky.feed.like","subject":{"uri":"at://did:plc:bob/app.bsky.feed.post/x","cid":"y"},"createdAt":"2026-01-01T00:00:00Z"}}"#
        let transport = transport(overrides: [(Self.pdsRecord, .reply(status: 200, body: like))])
        let model = makeModel(transport, collection: "app.bsky.feed.like", rkey: "3klike")
        await model.loadAndWait()
        XCTAssertFalse(model.isPost)
        XCTAssertTrue(model.postThread.isIdle)
        XCTAssertEqual(model.engagement.value?.map(\.kind), [.replies, .reposts, .likes, .quotes])
        XCTAssertEqual(model.engagement.value?.map(\.value), [1, 2, 3, 4])
        XCTAssertEqual(model.engagement.value?.map(\.label), ["replies", "reposts", "likes", "quotes"])
        XCTAssertEqual(transport.count(containing: "getPostThread?uri=at%3A%2F%2Fdid%3Aplc%3Aalice123%2Fapp.bsky.feed.like%2F3klike"), 1)

        let silent = self.transport(overrides: [
            (Self.pdsRecord, .reply(status: 200, body: like)),
            (Self.thread, .reply(status: 400, body: #"{"error":"InvalidRequest"}"#)),
        ])
        let silentModel = makeModel(silent, collection: "app.bsky.feed.like", rkey: "3klike")
        await silentModel.loadAndWait()
        XCTAssertEqual(silentModel.engagement, .loaded([]), "no thread, no strip")
    }

    func testProfileRecordCountsComeFromTheProfile() async {
        let profileRecord = #"{"uri":"at://did:plc:alice123/app.bsky.actor.profile/self","cid":"c4","value":{"$type":"app.bsky.actor.profile","displayName":"Alice"}}"#
        let transport = transport(overrides: [(Self.pdsRecord, .reply(status: 200, body: profileRecord))])
        let model = makeModel(transport, collection: "app.bsky.actor.profile", rkey: "self")
        await model.loadAndWait()
        XCTAssertEqual(model.engagement.value?.map(\.kind), [.followers, .following, .posts])
        XCTAssertEqual(model.engagement.value?.map(\.value), [10, 20, 30])
        XCTAssertEqual(transport.count(containing: "getProfile?actor=did%3Aplc%3Aalice123"), 1)
        XCTAssertEqual(transport.count(containing: Self.thread), 0)

        let sparse = BskyProfile(did: Self.did, handle: "alice.test", postsCount: 7)
        XCTAssertEqual(RecordModel.engagementStats(of: sparse), [RecordEngagementStat(kind: .posts, value: 7)], "absent counts are skipped")
    }

    func testMarginRecordHasAMarginCard() async {
        let annotation = #"{"uri":"at://did:plc:alice123/at.margin.annotation/3kann","cid":"c5","value":{"$type":"at.margin.annotation","text":"note","url":"https://example.com"}}"#
        let transport = transport(overrides: [(Self.pdsRecord, .reply(status: 200, body: annotation))])
        let model = makeModel(transport, collection: "at.margin.annotation", rkey: "3kann")
        await model.loadAndWait()
        XCTAssertTrue(model.hasRichCard)
        XCTAssertEqual(model.marginType, .annotation)
        guard let record = model.recordValue else { return XCTFail("expected the record") }
        XCTAssertEqual(model.richCard, .margin(.annotation, record))
        XCTAssertTrue(model.postThread.isIdle)
        XCTAssertEqual(model.sections.first?.id, "richPreview")

        let unlisted = makeModel(transport, collection: "at.margin.unknown", rkey: "x")
        XCTAssertFalse(unlisted.hasRichCard, "an unlisted margin lexicon has no bespoke card")
    }

    // MARK: Failures

    func testRecordNotFoundShowsThePanelAndStillLoadsBacklinks() async {
        let transport = transport(overrides: [(Self.pdsRecord, .reply(status: 400, body: #"{"error":"RecordNotFound","message":"Could not locate record"}"#))])
        let model = makeModel(transport)
        await model.loadAndWait()

        XCTAssertNotNil(model.identity.value)
        XCTAssertTrue(model.record.isFailed)
        guard let failure = model.failure else { return XCTFail("expected a failure") }
        XCTAssertTrue(failure.isNotFound)
        XCTAssertFalse(failure.isSchema)
        XCTAssertEqual(failure.status, 400)
        XCTAssertEqual(failure.code, "RecordNotFound")
        XCTAssertEqual(failure.eyebrow, "Not found")
        XCTAssertEqual(failure.headline, "This record doesn\u{2019}t exist")
        XCTAssertEqual(failure.body, "We couldn\u{2019}t find a app.bsky.feed.post record with key 3kabc in @alice.test\u{2019}s repository. It may have been deleted, or the link may be incorrect.")
        XCTAssertNil(failure.lexiconPath)
        XCTAssertTrue(failure.raw.hasPrefix("HTTP 400 "), failure.raw)
        XCTAssertTrue(failure.raw.contains(" for https://pds.example/xrpc/com.atproto.repo.getRecord?"), failure.raw)
        XCTAssertTrue(failure.raw.hasSuffix(":: {\"error\":\"RecordNotFound\",\"message\":\"Could not locate record\"}"), failure.raw)

        XCTAssertTrue(model.sections.isEmpty, "the error layout is fixed")
        XCTAssertNotNil(model.copyRow)
        XCTAssertNil(model.copyRow?.recordJSON)
        XCTAssertEqual(model.backlinks.sourceList.count, 1, "backlinks still render under the error panel")
        XCTAssertTrue(model.postThread.isIdle)
        XCTAssertTrue(model.engagement.isIdle)
        XCTAssertTrue(model.lexiconUsage.isIdle)
        XCTAssertEqual(transport.count(containing: Self.thread), 0)
        XCTAssertEqual(transport.count(containing: Self.usageStats), 0)
    }

    func testUnpublishedSchemaPointsAtTheLexiconPage() async {
        let transport = transport(overrides: [(Self.pdsRecord, .reply(status: 404, body: "not here"))])
        let model = makeModel(transport, collection: "com.atproto.lexicon.schema", rkey: "app.example.thing")
        XCTAssertEqual(model.lexiconUsageCollection, "app.example.thing", "the usage card is about the lexicon the schema names")
        await model.loadAndWait()
        guard let failure = model.failure else { return XCTFail("expected a failure") }
        XCTAssertTrue(failure.isNotFound, "a 404 counts even without an XRPC code")
        XCTAssertTrue(failure.isSchema)
        XCTAssertEqual(failure.status, 404)
        XCTAssertNil(failure.code)
        XCTAssertEqual(failure.headline, "No schema published for this lexicon")
        XCTAssertTrue(failure.body.hasPrefix("app.example.thing is used across the network, but @alice.test hasn\u{2019}t published a com.atproto.lexicon.schema record"), failure.body)
        XCTAssertEqual(failure.lexiconPath, NSID.lexiconPathFor("app.example.thing"))
        XCTAssertEqual(failure.lexiconLinkLabel, "See how app.example.thing is used across the atmosphere")
    }

    func testServerErrorIsAGenericLoadFailure() async {
        let transport = transport(overrides: [(Self.pdsRecord, .reply(status: 502, body: "bad gateway"))])
        let model = makeModel(transport)
        await model.loadAndWait()
        guard let failure = model.failure else { return XCTFail("expected a failure") }
        XCTAssertFalse(failure.isNotFound)
        XCTAssertEqual(failure.status, 502)
        XCTAssertNil(failure.code)
        XCTAssertEqual(failure.eyebrow, "Error")
        XCTAssertEqual(failure.headline, "Couldn\u{2019}t load this record")
        XCTAssertEqual(failure.body, "The PDS returned an error (HTTP 502) while fetching this record. It might be a temporary problem. Try again in a moment.")
        XCTAssertNil(failure.lexiconPath)
    }

    func testTransportFailureHasNoStatus() async {
        let transport = transport(overrides: [(Self.pdsRecord, .fail(URLError(.timedOut)))])
        let model = makeModel(transport)
        await model.loadAndWait()
        guard let failure = model.failure else { return XCTFail("expected a failure") }
        XCTAssertFalse(failure.isNotFound)
        XCTAssertNil(failure.status)
        XCTAssertEqual(failure.body, "The PDS returned an error while fetching this record. It might be a temporary problem. Try again in a moment.")
        XCTAssertFalse(failure.raw.isEmpty)
    }

    func testSubstringDetectionCatchesATruncatedBody() {
        let truncated = RecordFailure(raw: "HTTP 400 Bad Request for https://x :: {\"error\":\"RecordNotFound\",\"mess", collection: "a.b.c", rkey: "r", handle: "h")
        XCTAssertTrue(truncated.isNotFound)
        XCTAssertEqual(truncated.status, 400)
        XCTAssertNil(truncated.code, "the JSON is cut off, so the code comes from the substring")
        let clean = RecordFailure(raw: "HTTP 400 Bad Request for https://x :: {\"error\":\"InvalidRequest\"}", collection: "a.b.c", rkey: "r", handle: "h")
        XCTAssertFalse(clean.isNotFound)
        XCTAssertEqual(clean.code, "InvalidRequest")
        XCTAssertEqual(RecordFailure.detailsLabel, "Technical details")
    }

    func testUnresolvableRepoIsAnIdentityFailure() async {
        let transport = transport(overrides: [(Self.resolveAppView, .reply(status: 400, body: #"{"error":"InvalidRequest","message":"Unable to resolve handle"}"#))])
        let model = makeModel(transport, repo: "nobody.test")
        await model.loadAndWait()
        XCTAssertEqual(model.identity, .failed("Could not resolve nobody.test"))
        XCTAssertEqual(model.identityFailureBody, "We tried to resolve \"nobody.test\" and the AT Protocol resolver returned: Could not resolve nobody.test. Try another handle, DID, or AT URI below.")
        XCTAssertTrue(model.record.isIdle)
        XCTAssertNil(model.copyRow)
        XCTAssertNil(model.atUri)
        XCTAssertTrue(model.sections.isEmpty)
        XCTAssertTrue(model.waypoints.isEmpty)
        XCTAssertNil(model.recommended)
        XCTAssertNil(model.url(for: WaypointCatalog.all["bluesky"]!))
        XCTAssertTrue(model.backlinks.sources.isIdle)
        XCTAssertEqual(transport.count(containing: Self.describeRepo), 0)
        XCTAssertEqual(transport.count(containing: Self.pdsRecord), 0)
        XCTAssertEqual(RecordModel.identityFailureEyebrow, "Couldn\u{2019}t resolve")
        XCTAssertEqual(RecordModel.identityFailureHeadline, "That handle didn\u{2019}t resolve.")
    }

    // MARK: Lexicon usage

    func testUsageHidesWhenStatsFailAndKeepsGoingWithoutASeries() async {
        let statsDown = transport(overrides: [(Self.usageStats, .reply(status: 500, body: "down"))])
        let hidden = makeModel(statsDown)
        await hidden.loadAndWait()
        XCTAssertEqual(hidden.lexiconUsage, .failed(RecordModel.lexiconUsageUnavailable))

        let seriesDown = transport(overrides: [(Self.usageSeries, .reply(status: 500, body: "down"))])
        let flat = makeModel(seriesDown)
        await flat.loadAndWait()
        guard let usage = flat.lexiconUsage.value else { return XCTFail("expected usage, got \(flat.lexiconUsage)") }
        XCTAssertEqual(usage.counts.creates, 5000)
        XCTAssertEqual(usage.series, [])
        XCTAssertFalse(usage.hasSparkline)

        let zeros = transport(overrides: [(Self.usageSeries, .reply(status: 200, body: #"{"range":["a"],"series":{"app.bsky.feed.post":[{"creates":0,"updates":0,"deletes":0,"dids_estimate":0}]}}"#))])
        let quiet = makeModel(zeros)
        await quiet.loadAndWait()
        XCTAssertEqual(quiet.lexiconUsage.value?.series, [0])
        XCTAssertEqual(quiet.lexiconUsage.value?.hasSparkline, false, "a flat line is not drawn")
        XCTAssertEqual(LexiconUsageSummary.heading, "Lexicon usage \u{00B7} across the atmosphere \u{00B7} 7d")
    }

    // MARK: Sections and preferences

    func testSectionSwitchesPersistAndKeepOneDataView() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.loadAndWait()

        XCTAssertFalse(model.isRichPreviewHidden)
        model.toggleRichPreview()
        XCTAssertTrue(model.isRichPreviewHidden)
        XCTAssertEqual(model.sections.first, RecordSection(id: "richPreview", hidden: true, isDataView: true))
        XCTAssertEqual(model.sections.first?.toggleLabel, "Show rich preview")
        XCTAssertTrue(ExploreSections.sectionHidden(model.preferences.prefs.recordSections, id: "richPreview"), "saved to preferences")
        model.toggleRichPreview()
        XCTAssertFalse(model.isRichPreviewHidden)

        // Defaults: field table shown, raw JSON hidden. Hiding the table
        // reveals the raw JSON so one data view always stays visible.
        XCTAssertFalse(model.isStructuredJSONHidden)
        XCTAssertTrue(model.isRawJSONHidden)
        model.toggleStructuredJSON()
        XCTAssertTrue(model.isStructuredJSONHidden)
        XCTAssertFalse(model.isRawJSONHidden)
        model.toggleRawJSON()
        XCTAssertFalse(model.isStructuredJSONHidden)
        XCTAssertTrue(model.isRawJSONHidden)

        // The render guard: both hidden in storage still shows the table.
        model.preferences.update {
            $0.setSections(page: .record, sections: $0.recordSections.map { SectionConfig(id: $0.id, hidden: $0.id == "structuredJson" || $0.id == "rawJson") })
        }
        XCTAssertTrue(model.isRawJSONHidden)
        XCTAssertFalse(model.isStructuredJSONHidden, "at least one data view must stay visible")
        XCTAssertEqual(model.sections.first { $0.id == "structuredJson" }?.hidden, false)

        // Hidden helpers disappear; hidden data views keep their switch.
        model.preferences.update { $0.setSectionHidden(page: .record, id: "copyRow", hidden: true) }
        XCTAssertFalse(model.sections.map(\.id).contains("copyRow"))
        XCTAssertTrue(model.sections.map(\.id).contains("rawJson"))

        // The user's order is honoured.
        model.preferences.update { $0.setSections(page: .record, sections: [SectionConfig(id: "backlinks", hidden: false), SectionConfig(id: "rawJson", hidden: false)]) }
        XCTAssertEqual(model.sections.map(\.id).prefix(2), ["backlinks", "rawJson"])
    }

    func testEditingFollowsTheSession() async {
        let transport = transport()
        let owner = makeModel(transport, session: signedIn(as: Self.did))
        await owner.loadAndWait()
        XCTAssertTrue(owner.canEdit)
        XCTAssertFalse(owner.showsSignInPrompt)
        XCTAssertFalse(owner.isSectionApplicable("signIn"))
        XCTAssertFalse(owner.sections.map(\.id).contains("signIn"))

        owner.session = signedIn(as: "did:plc:somebodyelse")
        XCTAssertFalse(owner.canEdit, "signed in, but not as the repo's owner")
        XCTAssertFalse(owner.showsSignInPrompt)

        owner.session = .signedOut
        XCTAssertFalse(owner.canEdit)
        XCTAssertTrue(owner.showsSignInPrompt)
        XCTAssertTrue(owner.sections.map(\.id).contains("signIn"))
        XCTAssertEqual(RecordModel.signInPrompt, "Sign in with your handle to edit your own records.")
    }

    func testPersonalisationNarrowsTheOutboundWaypoints() async {
        let transport = transport()
        let model = makeModel(transport)
        await model.loadAndWait()
        // A custom waypoint with no template cannot build a URL for the
        // record, so it is dropped the way the picker drops it.
        let blank = CustomWaypoint(id: "custom:blank", name: "Blank", supportedTypes: [.post], templates: [:])
        model.preferences.update {
            $0.customWaypoints = [blank]
            $0.setWaypointGroups([WaypointGroup(id: "mine", name: "Mine", waypointIds: ["pdsls", "bluesky", "custom:blank"])])
        }
        XCTAssertEqual(model.waypoints.map(\.category.name), ["Mine"])
        XCTAssertEqual(model.waypoints.flatMap { $0.waypoints.map(\.id) }, ["pdsls", "bluesky"], "a waypoint without a URL for this record is dropped")
        XCTAssertEqual(model.recommended?.waypoints.map(\.id), ["bluesky"])
        XCTAssertEqual(model.featured?.id, "bluesky")
        model.preferences.update { $0.setWaypointGroups([]) }
        XCTAssertTrue(model.waypoints.isEmpty)
        XCTAssertNil(model.featured)
    }

    // MARK: Route segments

    func testEncodedRkeyIsDecodedBeforeTheRead() async {
        let record = #"{"uri":"at://did:plc:alice123/com.example.thing/a:b","cid":"c6","value":{"$type":"com.example.thing"}}"#
        let transport = transport(overrides: [(Self.pdsRecord, .reply(status: 200, body: record))])
        let model = makeModel(transport, collection: "com.example.thing", rkey: "a%3Ab")
        XCTAssertEqual(model.rkey, "a%3Ab")
        XCTAssertEqual(model.decodedRkey, "a:b")
        await model.loadAndWait()
        XCTAssertEqual(model.atUri, "at://did:plc:alice123/com.example.thing/a:b")
        XCTAssertEqual(model.copyRow?.universalPath, "/profile/alice.test/com.example.thing/a%3Ab")
        XCTAssertEqual(transport.count(containing: "collection=com.example.thing&rkey=a%3Ab"), 1)
        XCTAssertEqual(model.backlinks.target, "at://did:plc:alice123/com.example.thing/a:b")

        let malformed = makeModel(transport, collection: "com.example.thing", rkey: "%zz")
        XCTAssertEqual(malformed.decodedRkey, "%zz", "an undecodable segment is used as is")
    }

    func testDidRepoPrintsTheHandleFromDescribeRepo() async {
        let transport = transport()
        let model = makeModel(transport, repo: "did:plc:alice123")
        await model.loadAndWait()
        XCTAssertEqual(model.handleOrDid, "alice.test")
        XCTAssertEqual(model.copyRow?.universalLink, "https://aturi.to/profile/alice.test/app.bsky.feed.post/3kabc")
        XCTAssertEqual(transport.count(containing: "resolveHandle"), 0)

        let anonymous = self.transport(overrides: [(Self.describeRepo, .reply(status: 200, body: #"{"did":"did:plc:alice123","collections":[]}"#))])
        let bare = makeModel(anonymous, repo: "did:plc:alice123")
        await bare.loadAndWait()
        XCTAssertEqual(bare.handleOrDid, Self.did, "no handle from the PDS: the DID stands in")
        XCTAssertEqual(bare.copyRow?.universalPath, "/profile/did:plc:alice123/app.bsky.feed.post/3kabc")
        XCTAssertEqual(bare.signInDefaultInput, "")
    }

    // MARK: Reload and cancellation

    func testReloadCancelsTheLoadInFlight() async {
        let transport = transport(delayNanoseconds: 30_000_000)
        let model = makeModel(transport)
        model.load()
        XCTAssertTrue(model.identity.isLoading)
        XCTAssertTrue(model.record.isIdle)
        model.cancel()
        await model.awaitLoad()
        XCTAssertTrue(model.identity.isLoading, "a cancelled load never settles")

        model.load()
        model.reload()
        await model.awaitLoad()
        await model.backlinks.awaitLoad()
        XCTAssertNotNil(model.identity.value)
        XCTAssertNotNil(model.recordValue)
        XCTAssertEqual(model.backlinks.sourceList.count, 1)
    }
}
