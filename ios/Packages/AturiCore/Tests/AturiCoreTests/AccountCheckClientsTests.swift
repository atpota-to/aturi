import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport for the account checks: the first pattern
/// found in the URL answers, through a closure so a route can read the
/// request (the label requests' `atproto-accept-labelers` header). Anything
/// unrouted is a 404. An optional delay lets a test leave a run in flight.
final class ChecksFakeTransport: HTTPTransport, @unchecked Sendable {
    typealias Responder = @Sendable (URLRequest) -> (Int, String)

    private let lock = NSLock()
    private let routes: [(pattern: String, respond: Responder)]
    private let delayNanoseconds: UInt64
    private var requests: [URLRequest] = []

    init(_ routes: [(String, Responder)], delayNanoseconds: UInt64 = 0) {
        self.routes = routes.map { (pattern: $0.0, respond: $0.1) }
        self.delayNanoseconds = delayNanoseconds
    }

    static func reply(_ status: Int, _ body: String) -> Responder {
        { _ in (status, body) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        if delayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: delayNanoseconds)
        }
        let url = request.url!
        let route = routes.first { url.absoluteString.contains($0.pattern) }
        let answer = route?.respond(request) ?? (404, #"{"error":"NotFound"}"#)
        let response = HTTPURLResponse(url: url, statusCode: answer.0, httpVersion: "HTTP/1.1", headerFields: nil)!
        return (Data(answer.1.utf8), response)
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

    func requests(containing fragment: String) -> [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return requests.filter { $0.url?.absoluteString.contains(fragment) == true }
    }

    func count(containing fragment: String) -> Int {
        urls.filter { $0.contains(fragment) }.count
    }
}

/// One account the services show in full, shared by the client and model
/// tests: three recent posts, one of them a reply that appears in its
/// thread, found by both searches, and one label from a labeler only the
/// scan asks.
enum ChecksFixture {
    static let did = "did:plc:alice123"
    static let labeler = "did:plc:labeler1"
    static let quiet = "did:plc:labeler2"
    static let pds = "https://pds.example"
    /// 2026-11-18T12:00:00Z.
    static let nowMs: Int64 = 1_795_003_200_000
    static let hourMs: Int64 = 60 * 60_000
    static var now: Date { toolsDate(ms: nowMs) }

    static let identity = IdentityBundle(did: did, handle: "alice.test", pds: pds)

    static var p1: String { "at://\(did)/app.bsky.feed.post/\(toolsTid(ms: nowMs - 2 * hourMs))" }
    static var p2: String { "at://\(did)/app.bsky.feed.post/\(toolsTid(ms: nowMs - 3 * hourMs))" }
    static var p3: String { "at://\(did)/app.bsky.feed.post/\(toolsTid(ms: nowMs - 5 * hourMs))" }
    static var bobPost: String { "at://did:plc:bob/app.bsky.feed.post/\(toolsTid(ms: nowMs - 10 * hourMs))" }

    // Route keys. `://api.bsky.app/` keeps the label AppView apart from
    // public.api.bsky.app, which answers labeler definitions.
    static let profileRoute = "://api.bsky.app/xrpc/app.bsky.actor.getProfile"
    static let postsRoute = "://api.bsky.app/xrpc/app.bsky.feed.getPosts"
    static let threadRoute = "app.bsky.feed.getPostThread"
    static let searchActorsRoute = "app.bsky.actor.searchActors?"
    static let typeaheadRoute = "app.bsky.actor.searchActorsTypeahead"
    static let searchPostsRoute = "app.bsky.feed.searchPosts"
    static let servicesRoute = "public.api.bsky.app/xrpc/app.bsky.labeler.getServices"
    static let relayRoute = "relay1.us-east.bsky.network/xrpc/com.atproto.sync.listReposByCollection"
    static let repoStatusRoute = "pds.example/xrpc/com.atproto.sync.getRepoStatus"
    static let listRecordsRoute = "pds.example/xrpc/com.atproto.repo.listRecords"
    static let slingshotRoute = "slingshot.microcosm.blue/xrpc/blue.microcosm.repo.getRecordByUri"
    static let constellationRoute = "constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks"

    static var recordsBody: String {
        """
        {"records":[
          {"uri":"\(p1)","cid":"c1","value":{"$type":"app.bsky.feed.post","text":"one","createdAt":"2026-11-18T10:00:00.000Z"}},
          {"uri":"\(p2)","cid":"c2","value":{"$type":"app.bsky.feed.post","text":"two","reply":{"parent":{"uri":"\(bobPost)","cid":"b"},"root":{"uri":"\(bobPost)","cid":"b"}}}},
          {"uri":"\(p3)","cid":"c3","value":{"$type":"app.bsky.feed.post","text":"three"}}
        ]}
        """
    }

    static var postsBody: String {
        #"{"posts":[{"uri":"\#(p1)"},{"uri":"\#(p2)"},{"uri":"\#(p3)"}]}"#
    }

    static var threadBody: String {
        #"{"thread":{"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"\#(bobPost)"},"replies":[{"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"\#(p2)"}}]}}"#
    }

    static let actorsBody = #"{"actors":[{"did":"did:plc:alice123","handle":"alice.test"}]}"#
    static let notFound = #"{"error":"InvalidRequest","message":"Profile not found"}"#

    /// The profile with the labels of whichever labelers the request names:
    /// `labeler` has one; Bluesky's and `quiet` have none.
    static let profile: ChecksFakeTransport.Responder = { request in
        let header = request.value(forHTTPHeaderField: "atproto-accept-labelers") ?? ""
        let labels = header.contains("did:plc:labeler1")
            ? #"[{"src":"did:plc:labeler1","uri":"did:plc:alice123","val":"cornerstone","cts":"2026-01-01T00:00:00.000Z"}]"#
            : "[]"
        return (200, #"{"did":"did:plc:alice123","handle":"alice.test","displayName":"Alice","labels":\#(labels)}"#)
    }

    static let relay: ChecksFakeTransport.Responder = { request in
        if request.url?.absoluteString.contains("cursor=c1") == true {
            return (200, #"{"repos":[]}"#)
        }
        return (200, #"{"repos":[{"did":"did:plc:labeler1"},{"did":"did:plc:labeler2"}],"cursor":"c1"}"#)
    }

    /// Service views for whichever of the two known labelers the request names.
    static let services: ChecksFakeTransport.Responder = { request in
        let url = request.url?.absoluteString ?? ""
        var views: [String] = []
        if url.contains("labeler1") {
            views.append(#"{"creator":{"did":"did:plc:labeler1","handle":"labeler.test","displayName":"Labeler One"},"policies":{"labelValueDefinitions":[{"identifier":"cornerstone","severity":"inform","blurs":"none","locales":[{"lang":"en","name":"Cornerstone","description":"An early account."}]}]}}"#)
        }
        if url.contains("ar7c4by46qjdydhdevvrndac") {
            views.append(#"{"creator":{"did":"did:plc:ar7c4by46qjdydhdevvrndac","handle":"moderation.bsky.app","displayName":"Bluesky Moderation Service"}}"#)
        }
        let joined = views.joined(separator: ",")
        return (200, #"{"views":[\#(joined)]}"#)
    }

    /// The routes for the clean account, with per-test overrides first.
    static func transport(_ overrides: [(String, ChecksFakeTransport.Responder)] = [], delayNanoseconds: UInt64 = 0) -> ChecksFakeTransport {
        let base: [(String, ChecksFakeTransport.Responder)] = [
            (profileRoute, profile),
            (postsRoute, ChecksFakeTransport.reply(200, postsBody)),
            (threadRoute, ChecksFakeTransport.reply(200, threadBody)),
            (searchActorsRoute, ChecksFakeTransport.reply(200, actorsBody)),
            (typeaheadRoute, ChecksFakeTransport.reply(200, actorsBody)),
            (searchPostsRoute, ChecksFakeTransport.reply(200, postsBody)),
            (servicesRoute, services),
            (relayRoute, relay),
            (repoStatusRoute, ChecksFakeTransport.reply(200, #"{"did":"did:plc:alice123","active":true}"#)),
            (listRecordsRoute, ChecksFakeTransport.reply(200, recordsBody)),
        ]
        return ChecksFakeTransport(overrides + base, delayNanoseconds: delayNanoseconds)
    }
}

// MARK: - Labels

final class LabelsClientTests: XCTestCase {
    func testFetchLabelsAsksTheLabelAppViewNamingTheLabelers() async throws {
        let transport = ChecksFixture.transport()
        let client = LabelsClient(http: HTTPClient(transport: transport))
        let answer = try await client.fetchLabels(
            subject: .account(did: ChecksFixture.did),
            labelers: [Labels.blueskyModerationDid, ChecksFixture.labeler, "not-a-did"]
        )
        XCTAssertEqual(answer.labels.map { $0.val }, ["cornerstone"])
        XCTAssertEqual(answer.view.handle, "alice.test")
        XCTAssertEqual(answer.view.displayName, "Alice")

        let request = transport.requests(containing: ChecksFixture.profileRoute).first
        XCTAssertEqual(request?.url?.absoluteString, "https://api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=did%3Aplc%3Aalice123")
        // The malformed entry never reaches the header.
        XCTAssertEqual(
            request?.value(forHTTPHeaderField: "atproto-accept-labelers"),
            "\(Labels.blueskyModerationDid), \(ChecksFixture.labeler)"
        )
    }

    func testFetchLabelsReadsA400AsTheSubjectBeingUnavailable() async {
        let transport = ChecksFixture.transport([(ChecksFixture.profileRoute, ChecksFakeTransport.reply(400, ChecksFixture.notFound))])
        let client = LabelsClient(http: HTTPClient(transport: transport))
        do {
            _ = try await client.fetchLabels(subject: .account(did: ChecksFixture.did), labelers: [Labels.blueskyModerationDid])
            XCTFail("a 400 is not an answer with labels")
        } catch {
            XCTAssertEqual(error as? SubjectUnavailable, SubjectUnavailable(message: "Profile not found"))
        }
    }

    func testFetchLabelsSaysWhichStatusAnOutageAnswered() async {
        let transport = ChecksFixture.transport([(ChecksFixture.profileRoute, ChecksFakeTransport.reply(502, "bad gateway"))])
        let client = LabelsClient(http: HTTPClient(transport: transport))
        do {
            _ = try await client.fetchLabels(subject: .account(did: ChecksFixture.did), labelers: [])
            XCTFail("a 502 is not an answer")
        } catch {
            XCTAssertEqual(AccountCheckError.describe(error), "The AppView answered HTTP 502")
        }
    }

    func testFetchLabelsForAPostThatIsGoneIsUnavailable() async {
        let transport = ChecksFixture.transport([(ChecksFixture.postsRoute, ChecksFakeTransport.reply(200, #"{"posts":[]}"#))])
        let client = LabelsClient(http: HTTPClient(transport: transport))
        do {
            _ = try await client.fetchLabels(
                subject: .post(did: ChecksFixture.did, uri: ChecksFixture.p1),
                labelers: [Labels.blueskyModerationDid]
            )
            XCTFail("a post the AppView does not return has no labels to read")
        } catch {
            XCTAssertEqual((error as? SubjectUnavailable)?.message, "The AppView has no such post. It may have been deleted.")
        }
    }

    func testListLabelerDidsPagesTheRelaysCollectionDirectory() async throws {
        let transport = ChecksFixture.transport()
        let client = LabelsClient(http: HTTPClient(transport: transport))
        let dids = try await client.listLabelerDids()
        XCTAssertEqual(dids, [ChecksFixture.labeler, ChecksFixture.quiet])
        let urls = transport.urls.filter { $0.contains(ChecksFixture.relayRoute) }
        XCTAssertEqual(urls.count, 2)
        XCTAssertTrue(urls[0].contains("collection=app.bsky.labeler.service"))
        XCTAssertTrue(urls[0].contains("limit=1000"))
        XCTAssertTrue(urls[1].contains("cursor=c1"))
    }

    func testFetchLabelerInfoAsksTwentyFiveAtATimeAndReadsDefinitions() async {
        let transport = ChecksFixture.transport()
        let client = LabelsClient(http: HTTPClient(transport: transport))
        let dids = [ChecksFixture.labeler] + (0..<29).map { "did:plc:other\($0)" }
        let info = await client.fetchLabelerInfo(dids)
        XCTAssertEqual(transport.count(containing: ChecksFixture.servicesRoute), 2)
        XCTAssertTrue(transport.urls.first?.contains("detailed=true") == true)
        XCTAssertEqual(info[ChecksFixture.labeler]?.displayName, "Labeler One")
        XCTAssertEqual(info[ChecksFixture.labeler]?.handle, "labeler.test")
        XCTAssertEqual(info[ChecksFixture.labeler]?.definitions.map { $0.identifier }, ["cornerstone"])
    }

    func testCheckBaseAsksBlueskyFirstAndNamesWhoItAsked() async throws {
        let transport = ChecksFixture.transport()
        let client = LabelsClient(http: HTTPClient(transport: transport))
        let base = try await client.checkBase(target: .account(actor: ChecksFixture.did))
        XCTAssertEqual(base.subject, .account(did: ChecksFixture.did))
        XCTAssertEqual(base.asked, [Labels.blueskyModerationDid])
        XCTAssertNil(base.unavailable)
        XCTAssertEqual(base.labels, [])
        XCTAssertEqual(base.view?.handle, "alice.test")
        XCTAssertEqual(base.labelers[Labels.blueskyModerationDid]?.handle, "moderation.bsky.app")
        XCTAssertEqual(
            transport.requests(containing: ChecksFixture.profileRoute).first?.value(forHTTPHeaderField: "atproto-accept-labelers"),
            Labels.blueskyModerationDid
        )
    }

    func testCheckBaseKeepsProfileNotFoundAsAnAnswer() async throws {
        let transport = ChecksFixture.transport([(ChecksFixture.profileRoute, ChecksFakeTransport.reply(400, ChecksFixture.notFound))])
        let client = LabelsClient(http: HTTPClient(transport: transport))
        let base = try await client.checkBase(target: .account(actor: ChecksFixture.did))
        XCTAssertEqual(base.unavailable, "Profile not found")
        XCTAssertNil(base.view)
    }

    @MainActor
    func testTheScanAsksEveryLabelerAndNamesTheOnesThatLabelled() async throws {
        let transport = ChecksFixture.transport()
        let client = LabelsClient(http: HTTPClient(transport: transport))
        let base = try await client.checkBase(target: .account(actor: ChecksFixture.did))
        var published: [LabelsClient.ScanResult] = []
        let result = try await client.scanEveryLabeler(base: base, control: LabelScanControl()) { snapshot in
            published.append(snapshot)
        }
        XCTAssertEqual(result.progress, Labels.ScanProgress(total: 3, checked: 3, failed: 0))
        XCTAssertEqual(result.labels.map { $0.val }, ["cornerstone"])
        XCTAssertEqual(result.labelers[ChecksFixture.labeler]?.displayName, "Labeler One")
        XCTAssertFalse(result.stopped)
        XCTAssertFalse(result.running)
        XCTAssertEqual(published.first?.progress.checked, 0)
        XCTAssertTrue(published.allSatisfy { $0.running })

        // One batch of three: Bluesky's labeler and the two the relay listed.
        let header = transport.requests(containing: ChecksFixture.profileRoute).last?.value(forHTTPHeaderField: "atproto-accept-labelers")
        XCTAssertEqual(header, "\(Labels.blueskyModerationDid), \(ChecksFixture.labeler), \(ChecksFixture.quiet)")
    }

    @MainActor
    func testAStoppedScanSaysSoAndCountsNothingCutOff() async throws {
        let transport = ChecksFixture.transport()
        let client = LabelsClient(http: HTTPClient(transport: transport))
        let base = try await client.checkBase(target: .account(actor: ChecksFixture.did))
        let control = LabelScanControl()
        control.stop()
        let result = try await client.scanEveryLabeler(base: base, control: control) { _ in }
        XCTAssertTrue(result.stopped)
        XCTAssertEqual(result.progress.total, 3)
        XCTAssertEqual(result.progress.checked + result.progress.failed, 0)
    }
}

// MARK: - Visibility

final class ShadowbanClientTests: XCTestCase {
    @MainActor
    func testACleanAccountIsInvestigatedInFullAndPublishedStepByStep() async throws {
        let transport = ChecksFixture.transport()
        let client = ShadowbanClient(http: HTTPClient(transport: transport))
        var published: [Shadowban.Evidence] = []
        let evidence = try await client.investigate(
            target: .account(actor: ChecksFixture.did),
            identity: Shadowban.Identity(bundle: ChecksFixture.identity),
            now: ChecksFixture.now
        ) { snapshot in
            published.append(snapshot)
        }
        XCTAssertTrue(evidence.done)
        XCTAssertEqual(evidence.checkedAt, ChecksFixture.now)
        XCTAssertEqual(evidence.repo, .active)
        XCTAssertEqual(evidence.posts?.value?.count, 3)
        XCTAssertEqual(evidence.shown?.value?.count, 3)
        XCTAssertEqual(evidence.replies?.value?.map { $0.thread }, [.shown])
        XCTAssertEqual(evidence.actorSearch?.value, Shadowban.ActorSearch(inSearch: true, inTypeahead: true))
        XCTAssertEqual(evidence.profile?.found?.handle, "alice.test")

        let checks = Shadowban.buildAccountChecks(evidence, now: ChecksFixture.now)
        XCTAssertEqual(checks.map { $0.status }, [.pass, .pass, .pass, .pass, .pass, .pass])
        XCTAssertEqual(Shadowban.shadowbanVerdict(evidence, checks: checks).title, "No shadowban found on Bluesky")

        // The first snapshot has nothing in it; each answer adds one part.
        XCTAssertNil(published.first?.repo)
        XCTAssertGreaterThanOrEqual(published.count, 8)
        XCTAssertEqual(published.filter { $0.done }.count, 1)
        // A reply the thread shows needs no gate or block lookups, and an
        // identity in hand needs no resolution.
        XCTAssertEqual(transport.count(containing: ChecksFixture.slingshotRoute), 0)
        XCTAssertEqual(transport.count(containing: ChecksFixture.constellationRoute), 0)
        XCTAssertEqual(transport.count(containing: "plc.directory"), 0)
        // The AppView is asked at api.bsky.app, never the cached public host.
        XCTAssertTrue(transport.urls.filter { $0.contains("/xrpc/app.bsky.feed.") }.allSatisfy { $0.hasPrefix("https://api.bsky.app/") })
    }

    @MainActor
    func testAReplyMissingFromItsThreadLooksUpTheGateAndTheBlocks() async throws {
        let emptyThread = #"{"thread":{"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"x"},"replies":[]}}"#
        let transport = ChecksFixture.transport([
            (ChecksFixture.threadRoute, ChecksFakeTransport.reply(200, emptyThread)),
            (ChecksFixture.slingshotRoute, ChecksFakeTransport.reply(404, #"{"error":"RecordNotFound"}"#)),
            (ChecksFixture.constellationRoute, ChecksFakeTransport.reply(200, #"{"total":0,"records":[]}"#)),
        ])
        let client = ShadowbanClient(http: HTTPClient(transport: transport))
        let evidence = try await client.investigate(
            target: .account(actor: ChecksFixture.did),
            identity: Shadowban.Identity(bundle: ChecksFixture.identity),
            now: ChecksFixture.now
        ) { _ in }
        let probe = evidence.replies?.value?.first
        XCTAssertEqual(probe?.thread, .absent)
        XCTAssertEqual(probe?.gate, .answered(Shadowban.ThreadGate(restricted: false, hidden: false)))
        XCTAssertEqual(probe?.block, .answered(Shadowban.BlockLookup(found: false)))
        // The gate sits beside the thread's root.
        XCTAssertTrue(transport.urls.contains { $0.contains("app.bsky.feed.threadgate") })
        // A block either way between the replier and bob.
        XCTAssertEqual(transport.count(containing: ChecksFixture.constellationRoute), 2)

        let summary = AccountChecks.visibilitySummary(evidence, now: ChecksFixture.now)
        XCTAssertEqual(summary.tone, .fail)
        XCTAssertEqual(summary.short, "Replies missing")
    }

    @MainActor
    func testATakedownIsReadFromTheAppViewsWords() async throws {
        let takedown = #"{"error":"AccountTakedown","message":"Account has been suspended"}"#
        let transport = ChecksFixture.transport([(ChecksFixture.profileRoute, ChecksFakeTransport.reply(400, takedown))])
        let client = ShadowbanClient(http: HTTPClient(transport: transport))
        let evidence = try await client.investigate(
            target: .account(actor: ChecksFixture.did),
            identity: Shadowban.Identity(bundle: ChecksFixture.identity),
            now: ChecksFixture.now
        ) { _ in }
        XCTAssertEqual(evidence.profile, .suspended(message: "Account has been suspended"))
        XCTAssertEqual(AccountChecks.visibilitySummary(evidence, now: ChecksFixture.now).short, "Suspended")
    }

    func testResolveIdentityReadsTheDidDocumentForItsPDS() async throws {
        let document = ##"{"id":"did:plc:alice123","alsoKnownAs":["at://Alice.Test"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example/"}]}"##
        let transport = ChecksFixture.transport([
            ("plc.directory/did:plc:alice123", ChecksFakeTransport.reply(200, document)),
            ("com.atproto.identity.resolveHandle", ChecksFakeTransport.reply(200, #"{"did":"did:plc:alice123"}"#)),
        ])
        let client = ShadowbanClient(http: HTTPClient(transport: transport))

        let byDid = try await client.resolveIdentity(ChecksFixture.did)
        XCTAssertEqual(byDid, Shadowban.Identity(did: ChecksFixture.did, handle: "alice.test", pds: "https://pds.example"))

        let byHandle = try await client.resolveIdentity("alice.test")
        XCTAssertEqual(byHandle.handle, "alice.test")
        XCTAssertEqual(byHandle.did, ChecksFixture.did)
    }
}
