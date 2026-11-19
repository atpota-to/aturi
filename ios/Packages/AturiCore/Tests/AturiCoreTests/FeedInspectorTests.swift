import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// Port of src/lib/tools/__tests__/feed.test.ts, plus the reads the web makes
// on its server (src/lib/tools/server/feed.ts) against a scripted transport.

private let did = "did:plc:z72i7hdynmk6r22z27h6tvur"
private let serviceDid = "did:web:feeds.example.com"
private let endpoint = "https://feeds.example.com"
private let feed = FeedInspector.feedUri(did: did, rkey: "whats-hot")

/// A feed where every step answers, to knock one part out of at a time.
private func probe(
    record: FeedInspector.RecordProbe? = nil,
    service: FeedInspector.ServiceProbe? = nil,
    noService: Bool = false,
    describe: FeedInspector.DescribeProbe? = nil,
    noDescribe: Bool = false,
    skeleton: FeedInspector.SkeletonProbe? = nil,
    noSkeleton: Bool = false
) -> FeedInspector.Probe {
    FeedInspector.Probe(
        feed: feed,
        record: record ?? .found(cid: "bafyreifeed", value: [
            "$type": "app.bsky.feed.generator",
            "did": .string(serviceDid),
            "displayName": "Discover",
            "createdAt": "2023-05-19T23:19:19.592Z",
        ]),
        service: noService ? nil : (service ?? FeedInspector.ServiceProbe(
            did: serviceDid,
            status: .resolved,
            services: [FeedInspector.ServiceEntry(id: "#bsky_fg", type: "BskyFeedGenerator", serviceEndpoint: endpoint)],
            endpoint: endpoint
        )),
        describe: noDescribe ? nil : (describe ?? FeedInspector.DescribeProbe(
            url: "\(endpoint)/xrpc/app.bsky.feed.describeFeedGenerator",
            status: .answered,
            httpStatus: 200,
            did: serviceDid,
            feedCount: 3,
            listsFeed: true
        )),
        skeleton: noSkeleton ? nil : (skeleton ?? FeedInspector.SkeletonProbe(
            url: "\(endpoint)/xrpc/app.bsky.feed.getFeedSkeleton?feed=x&limit=25",
            status: .answered,
            httpStatus: 200,
            items: [
                FeedInspector.SkeletonItem(post: "at://did:plc:a/app.bsky.feed.post/1"),
                FeedInspector.SkeletonItem(post: "at://did:plc:b/app.bsky.feed.post/2"),
            ],
            cursor: "next"
        ))
    )
}

private func evidence(
    probe value: FeedInspector.Probe? = nil,
    appview: ServiceStep<FeedInspector.AppView>? = nil
) -> FeedInspector.Evidence {
    FeedInspector.Evidence(
        authority: "bsky.app",
        rkey: "whats-hot",
        did: .done(did),
        probe: .done(value ?? probe()),
        appview: appview ?? .done(FeedInspector.AppView(displayName: "Discover", likeCount: 39616, isOnline: true, isValid: true))
    )
}

private func statuses(_ e: FeedInspector.Evidence) -> [String] {
    FeedInspector.buildChecks(e).map { "\($0.id):\($0.status.rawValue)" }
}

private func statusOf(_ e: FeedInspector.Evidence, _ id: String) -> ServiceCheckStatus? {
    FeedInspector.buildChecks(e).first { $0.id == id }?.status
}

private func checkOf(_ e: FeedInspector.Evidence, _ id: String) -> ServiceCheck? {
    FeedInspector.buildChecks(e).first { $0.id == id }
}

private func verdictOf(_ e: FeedInspector.Evidence) -> ServiceVerdict {
    FeedInspector.verdict(e, checks: FeedInspector.buildChecks(e), name: "Discover")
}

private func reason(_ raw: String) -> String {
    FeedInspector.parseInput(raw).reason ?? ""
}

private func assertMatches(_ text: String, _ pattern: String, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertNotNil(text.range(of: pattern, options: .regularExpression), "\(text) does not match \(pattern)", file: file, line: line)
}

final class FeedInspectorTests: XCTestCase {
    func testParseInputReadsFeedLinksAndAtUris() {
        XCTAssertEqual(FeedInspector.parseInput("https://bsky.app/profile/bsky.app/feed/whats-hot"), .ok(authority: "bsky.app", rkey: "whats-hot"))
        XCTAssertEqual(FeedInspector.parseInput("bsky.app/profile/\(did)/feed/whats-hot?x=1"), .ok(authority: did, rkey: "whats-hot"))
        XCTAssertEqual(FeedInspector.parseInput(" \(feed) "), .ok(authority: did, rkey: "whats-hot"))
        XCTAssertEqual(FeedInspector.parseInput("at://Bsky.App/app.bsky.feed.generator/whats-hot"), .ok(authority: "bsky.app", rkey: "whats-hot"))
        // The same path on another client's host.
        XCTAssertEqual(FeedInspector.parseInput("https://deer.social/profile/bsky.app/feed/whats-hot"), .ok(authority: "bsky.app", rkey: "whats-hot"))
        // This site's own record links spell the collection out.
        XCTAssertEqual(
            FeedInspector.parseInput("https://aturi.to/explore/\(did)/app.bsky.feed.generator/whats-hot"),
            .ok(authority: did, rkey: "whats-hot")
        )
    }

    func testParseInputSaysWhySomethingIsNotAFeed() {
        assertMatches(reason(""), "Enter a feed")
        assertMatches(reason("at://\(did)/app.bsky.feed.post/3abc"), #"app\.bsky\.feed\.post record"#)
        assertMatches(reason("at://\(did)/app.bsky.feed.generator"), "three parts")
        assertMatches(reason("https://bsky.app/profile/bsky.app/post/3abc"), "post inspector")
        assertMatches(reason("https://bsky.app/profile/bsky.app/lists/3abc"), "list, not a feed")
        assertMatches(reason("https://example.com/"), "does not point at a feed")
        assertMatches(reason("at://not a handle/app.bsky.feed.generator/x"), "not a handle or a DID")
    }

    func testAFeedWhereEveryStepAnswersPasses() {
        let e = evidence()
        XCTAssertEqual(statuses(e), ["record:pass", "service:pass", "describe:pass", "skeleton:pass", "appview:pass"])
        let verdict = verdictOf(e)
        XCTAssertEqual(verdict.tone, .pass)
        assertMatches(verdict.text, #"returned 2 posts and a cursor.*feeds\.example\.com"#)
    }

    func testAMissingRecordFailsAndSkipsTheRest() {
        let e = evidence(probe: FeedInspector.Probe(feed: feed, record: .missing))
        XCTAssertEqual(statuses(e), ["record:fail", "service:skip", "describe:skip", "skeleton:skip", "appview:pass"])
        assertMatches(verdictOf(e).title, "no readable feed record")
    }

    func testARecordWithoutADidOrMissingRequiredFieldsIsCaught() {
        let noDid = evidence(probe: FeedInspector.Probe(feed: feed, record: .found(cid: "x", value: ["displayName": "A"])))
        XCTAssertEqual(statusOf(noDid, "record"), .fail)
        let thin = probe(record: .found(cid: "x", value: ["$type": "app.bsky.feed.generator", "did": .string(serviceDid)]))
        XCTAssertEqual(statusOf(evidence(probe: thin), "record"), .warn)
    }

    func testAServiceWithNoBskyFgEntryFailsWithWhatToAdd() {
        let e = evidence(probe: probe(
            service: FeedInspector.ServiceProbe(
                did: serviceDid,
                status: .resolved,
                services: [FeedInspector.ServiceEntry(id: "#atproto_pds", type: "X", serviceEndpoint: endpoint)],
                endpoint: nil
            ),
            noDescribe: true,
            noSkeleton: true
        ))
        let check = checkOf(e, "service")
        XCTAssertEqual(check?.status, .fail)
        assertMatches(check?.fix.first ?? "", "#bsky_fg.*BskyFeedGenerator")
        XCTAssertEqual(statusOf(e, "skeleton"), .skip)
        assertMatches(verdictOf(e).title, "service that cannot be found")

        let wrongType = probe(service: FeedInspector.ServiceProbe(
            did: serviceDid,
            status: .resolved,
            services: [FeedInspector.ServiceEntry(id: "#bsky_fg", type: "Other", serviceEndpoint: endpoint)],
            endpoint: endpoint
        ))
        XCTAssertEqual(statusOf(evidence(probe: wrongType), "service"), .warn)

        let unresolved = probe(service: FeedInspector.ServiceProbe(did: serviceDid, status: .error, error: "the host has no DNS record"))
        XCTAssertEqual(statusOf(evidence(probe: unresolved), "service"), .fail)
    }

    func testAGeneratorThatDoesNotImplementDescribeIsANoteNotAFailure() {
        let quiet = probe(describe: FeedInspector.DescribeProbe(url: "u", status: .answered, httpStatus: 404))
        let e = evidence(probe: quiet)
        XCTAssertEqual(statusOf(e, "describe"), .info)
        XCTAssertEqual(verdictOf(e).tone, .pass)

        let unlisted = probe(describe: FeedInspector.DescribeProbe(url: "u", status: .answered, httpStatus: 200, did: serviceDid, feedCount: 10, listsFeed: false))
        XCTAssertEqual(statusOf(evidence(probe: unlisted), "describe"), .warn)

        let otherDid = probe(describe: FeedInspector.DescribeProbe(url: "u", status: .answered, httpStatus: 200, did: "did:web:other.example", feedCount: 1, listsFeed: true))
        XCTAssertEqual(statusOf(evidence(probe: otherDid), "describe"), .warn)
    }

    func testAPersonalisedFeedIsReportedAsNeedingAViewerNotAsBroken() {
        let personal = FeedInspector.SkeletonProbe(url: "u", status: .answered, httpStatus: 401, xrpcError: "AuthRequiredError", message: "log in")
        let e = evidence(probe: probe(skeleton: personal))
        XCTAssertEqual(statusOf(e, "skeleton"), .info)
        let verdict = verdictOf(e)
        XCTAssertEqual(verdict.tone, .info)
        assertMatches(verdict.title, "signed-in viewer")
        XCTAssertTrue(FeedInspector.needsViewer(personal))
        XCTAssertFalse(FeedInspector.needsViewer(httpStatus: 400, xrpcError: "UnknownFeed"))
        XCTAssertFalse(FeedInspector.needsViewer(nil))
    }

    func testAGeneratorThatFailsToReturnASkeletonFailsTheFeed() {
        let unknown = probe(skeleton: FeedInspector.SkeletonProbe(url: "u", status: .answered, httpStatus: 400, xrpcError: "UnknownFeed"))
        let check = checkOf(evidence(probe: unknown), "skeleton")
        XCTAssertEqual(check?.status, .fail)
        assertMatches(check?.summary ?? "", "does not know this feed")

        let down = probe(skeleton: FeedInspector.SkeletonProbe(url: "u", status: .error, error: "the host did not answer in time"))
        XCTAssertEqual(statusOf(evidence(probe: down), "skeleton"), .fail)
        assertMatches(verdictOf(evidence(probe: down)).title, "not answering")

        let garbage = probe(skeleton: FeedInspector.SkeletonProbe(url: "u", status: .answered, httpStatus: 200, unreadable: true))
        XCTAssertEqual(statusOf(evidence(probe: garbage), "skeleton"), .fail)

        let empty = probe(skeleton: FeedInspector.SkeletonProbe(url: "u", status: .answered, httpStatus: 200, items: []))
        XCTAssertEqual(statusOf(evidence(probe: empty), "skeleton"), .warn)
    }

    func testTheAppViewNotKnowingTheFeedOrCallingItOfflineIsAWarning() {
        XCTAssertEqual(statusOf(evidence(appview: .done(FeedInspector.AppView(error: "could not find feed"))), "appview"), .warn)
        XCTAssertEqual(statusOf(evidence(appview: .failed), "appview"), .warn)
        let offline = evidence(appview: .done(FeedInspector.AppView(likeCount: 1, isOnline: false, isValid: true)))
        let check = checkOf(offline, "appview")
        XCTAssertEqual(check?.status, .warn)
        assertMatches(check?.summary ?? "", #"offline\. It has 1 like\."#)
        XCTAssertEqual(verdictOf(offline).tone, .warn)
    }

    func testStepsNotYetObservedArePendingAndAnUnresolvedHandleStopsEverything() {
        let waiting = FeedInspector.Evidence(authority: "bsky.app", rkey: "whats-hot")
        XCTAssertTrue(FeedInspector.buildChecks(waiting).allSatisfy { $0.status == .pending })
        XCTAssertEqual(FeedInspector.verdict(waiting, checks: FeedInspector.buildChecks(waiting), name: "x").tone, .pending)

        // The AppView can answer before the generator does.
        let half = FeedInspector.Evidence(
            authority: "bsky.app",
            rkey: "whats-hot",
            did: .done(did),
            appview: .done(FeedInspector.AppView(isOnline: true, isValid: true))
        )
        XCTAssertEqual(statusOf(half, "appview"), .pass)
        XCTAssertEqual(statusOf(half, "record"), .pending)

        let lost = FeedInspector.Evidence(authority: "nobody.example", rkey: "x", did: .failed)
        XCTAssertEqual(FeedInspector.buildChecks(lost).map(\.status), [.fail, .skip, .skip, .skip, .skip])

        let noService = FeedInspector.Evidence(
            authority: "bsky.app",
            rkey: "x",
            did: .done(did),
            probe: .failed,
            probeError: "The lookup service did not answer."
        )
        XCTAssertEqual(statusOf(noService, "record"), .fail)
        XCTAssertEqual(statusOf(noService, "appview"), .pending)
    }

    func testReasonLabelNamesASkeletonReason() {
        XCTAssertEqual(FeedInspector.reasonLabel("app.bsky.feed.defs#skeletonReasonRepost"), "Repost")
        XCTAssertEqual(FeedInspector.reasonLabel("app.bsky.feed.defs#skeletonReasonPin"), "Pin")
        XCTAssertEqual(FeedInspector.reasonLabel("com.example#other"), "Other")
    }

    func testTheSkeletonGoesBackIntoTheLexiconsShape() {
        let skeleton = FeedInspector.SkeletonProbe(
            url: "u",
            status: .answered,
            httpStatus: 200,
            items: [FeedInspector.SkeletonItem(post: "at://a", reason: FeedInspector.SkeletonReason(type: "app.bsky.feed.defs#skeletonReasonRepost", repost: "at://r"))],
            cursor: "c"
        )
        XCTAssertEqual(skeleton.json, [
            "feed": [["post": "at://a", "reason": ["$type": "app.bsky.feed.defs#skeletonReasonRepost", "repost": "at://r"]]],
            "cursor": "c",
        ])
    }
}

// MARK: - The reads

/// Answers by URL prefix; anything else is a 404. Records each request.
private final class FeedFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var headers: [String: String] = ["Content-Type": "application/json"]
    }

    private let lock = NSLock()
    private let replies: [(String, Reply)]
    private var recorded: [URLRequest] = []

    init(_ replies: [(String, Reply)]) {
        self.replies = replies
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.lock()
        recorded.append(request)
        lock.unlock()
        let url = request.url!.absoluteString
        let reply = replies.first { url.hasPrefix($0.0) }?.1 ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
        return (Data(reply.body.utf8), response)
    }

    var urls: [String] {
        lock.lock(); defer { lock.unlock() }
        return recorded.compactMap { $0.url?.absoluteString }
    }
}

private func client(_ transport: FeedFakeTransport) -> FeedInspectorClient {
    FeedInspectorClient(http: HTTPClient(transport: transport), fetcher: ServiceFetcher(transport: transport))
}

private let generatorRecord = #"{"uri":"at://\#(did)/app.bsky.feed.generator/whats-hot","cid":"bafyfeed","value":{"$type":"app.bsky.feed.generator","did":"\#(serviceDid)","displayName":"Discover","createdAt":"2023-05-19T23:19:19.592Z"}}"#
private let generatorDocument = ##"{"id":"\##(serviceDid)","service":[{"id":"#bsky_fg","type":"BskyFeedGenerator","serviceEndpoint":"\##(endpoint)/"}]}"##

final class FeedInspectorClientTests: XCTestCase {
    func testTheProbeFollowsTheRecordToTheGenerator() async {
        let transport = FeedFakeTransport([
            ("https://slingshot.microcosm.blue/xrpc/blue.microcosm.repo.getRecordByUri", .init(status: 200, body: generatorRecord)),
            ("https://feeds.example.com/.well-known/did.json", .init(status: 200, body: generatorDocument)),
            ("https://feeds.example.com/xrpc/app.bsky.feed.describeFeedGenerator", .init(status: 200, body: #"{"did":"\#(serviceDid)","feeds":[{"uri":"\#(feed)"},{"uri":"at://x"}]}"#)),
            ("https://feeds.example.com/xrpc/app.bsky.feed.getFeedSkeleton", .init(status: 200, body: #"{"feed":[{"post":"at://did:plc:a/app.bsky.feed.post/1","reason":{"$type":"app.bsky.feed.defs#skeletonReasonRepost","repost":"at://r"}},{"nope":1},{"post":"at://did:plc:b/app.bsky.feed.post/2","feedContext":"ctx"}],"cursor":""}"#)),
        ])
        let probe = await client(transport).probe(did: did, rkey: "whats-hot")
        XCTAssertEqual(probe.feed, feed)
        XCTAssertEqual(probe.record.value?["displayName"], "Discover")
        XCTAssertEqual(probe.service?.status, .resolved)
        XCTAssertEqual(probe.service?.endpoint, endpoint, "the trailing slash is trimmed")
        XCTAssertEqual(probe.describe?.feedCount, 2)
        XCTAssertEqual(probe.describe?.listsFeed, true)
        XCTAssertEqual(probe.skeleton?.items?.map(\.post), ["at://did:plc:a/app.bsky.feed.post/1", "at://did:plc:b/app.bsky.feed.post/2"])
        XCTAssertEqual(probe.skeleton?.items?.first?.reason?.repost, "at://r")
        XCTAssertEqual(probe.skeleton?.items?.last?.feedContext, "ctx")
        XCTAssertNil(probe.skeleton?.cursor, "an empty cursor means no next page")
        XCTAssertTrue(transport.urls.contains { $0.hasPrefix("https://feeds.example.com/xrpc/app.bsky.feed.getFeedSkeleton?feed=at%3A%2F%2F") && $0.hasSuffix("&limit=25") })

        let evidence = FeedInspector.Evidence(authority: did, rkey: "whats-hot", did: .done(did), probe: .done(probe), appview: .done(FeedInspector.AppView(isOnline: true, isValid: true)))
        XCTAssertTrue(FeedInspector.buildChecks(evidence).allSatisfy { $0.status == .pass })
    }

    func testAGeneratorErrorIsReadAsAnXrpcAnswer() async {
        let transport = FeedFakeTransport([
            ("https://slingshot.microcosm.blue/", .init(status: 200, body: generatorRecord)),
            ("https://feeds.example.com/.well-known/did.json", .init(status: 200, body: generatorDocument)),
            ("https://feeds.example.com/xrpc/app.bsky.feed.getFeedSkeleton", .init(status: 401, body: #"{"error":"AuthRequiredError","message":"log in"}"#)),
        ])
        let probe = await client(transport).probe(did: did, rkey: "whats-hot")
        XCTAssertEqual(probe.describe?.httpStatus, 404)
        XCTAssertEqual(probe.skeleton?.httpStatus, 401)
        XCTAssertEqual(probe.skeleton?.xrpcError, "AuthRequiredError")
        XCTAssertEqual(probe.skeleton?.message, "log in")
        XCTAssertTrue(FeedInspector.needsViewer(probe.skeleton))
    }

    func testAServiceOnAPrivateHostIsNotAsked() async {
        let record = #"{"uri":"u","cid":"c","value":{"did":"did:web:feeds.local"}}"#
        let transport = FeedFakeTransport([("https://slingshot.microcosm.blue/", .init(status: 200, body: record))])
        let probe = await client(transport).probe(did: did, rkey: "whats-hot")
        XCTAssertEqual(probe.service?.status, .error)
        XCTAssertEqual(probe.service?.error, "the address is not a public https host")
        XCTAssertFalse(transport.urls.contains { $0.contains("feeds.local") })
    }

    func testAMissingRecordIsReadFromThePDS() async {
        let transport = FeedFakeTransport([
            ("https://slingshot.microcosm.blue/", .init(status: 404, body: "{}")),
            ("https://plc.directory/\(did)", .init(status: 200, body: ##"{"id":"\##(did)","service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example.com"}]}"##)),
            ("https://pds.example.com/xrpc/com.atproto.repo.getRecord", .init(status: 400, body: #"{"error":"RecordNotFound"}"#)),
        ])
        let probe = await client(transport).probe(did: did, rkey: "gone")
        XCTAssertEqual(probe.record, .missing)
        XCTAssertNil(probe.service)
    }

    func testTheAppViewsAnswerAndItsRefusal() async {
        let ok = FeedFakeTransport([
            ("https://public.api.bsky.app/xrpc/app.bsky.feed.getFeedGenerator", .init(status: 200, body: #"{"view":{"uri":"\#(feed)","cid":"c","did":"\#(serviceDid)","displayName":"Discover","likeCount":5},"isOnline":true,"isValid":false}"#)),
        ])
        let answer = await client(ok).appViewFeed(feed)
        XCTAssertEqual(answer.appview, FeedInspector.AppView(displayName: "Discover", likeCount: 5, isOnline: true, isValid: false))
        XCTAssertEqual(answer.view?.displayName, "Discover")

        let refused = FeedFakeTransport([
            ("https://public.api.bsky.app/", .init(status: 400, body: #"{"error":"InvalidRequest","message":"could not find feed"}"#)),
        ])
        let missing = await client(refused).appViewFeed(feed)
        XCTAssertEqual(missing.appview.error, "could not find feed")
        XCTAssertNil(missing.view)
    }
}

@MainActor
final class FeedInspectorModelTests: XCTestCase {
    func testARunFillsTheEvidenceAndThePosts() async {
        let transport = FeedFakeTransport([
            ("https://slingshot.microcosm.blue/", .init(status: 200, body: generatorRecord)),
            ("https://feeds.example.com/.well-known/did.json", .init(status: 200, body: generatorDocument)),
            ("https://feeds.example.com/xrpc/app.bsky.feed.describeFeedGenerator", .init(status: 200, body: #"{"did":"\#(serviceDid)","feeds":[{"uri":"\#(feed)"}]}"#)),
            ("https://feeds.example.com/xrpc/app.bsky.feed.getFeedSkeleton", .init(status: 200, body: #"{"feed":[{"post":"at://did:plc:a/app.bsky.feed.post/1"}],"cursor":"page2"}"#)),
            ("https://public.api.bsky.app/xrpc/app.bsky.feed.getFeedGenerator", .init(status: 200, body: #"{"view":{"uri":"\#(feed)","cid":"c","did":"\#(serviceDid)","displayName":"Discover"},"isOnline":true,"isValid":true}"#)),
            ("https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts", .init(status: 200, body: #"{"posts":[]}"#)),
        ])
        let model = FeedInspectorModel(client: client(transport))
        await model.run(feed)?.value
        XCTAssertFalse(model.isRunning)
        XCTAssertEqual(model.name, "Discover")
        XCTAssertEqual(model.verdict?.tone, .pass)
        XCTAssertTrue(model.hasSkeleton)
        XCTAssertEqual(model.posts, [:])
        XCTAssertEqual(model.feedUri, feed)

        await model.nextPage()?.value
        XCTAssertEqual(model.cursor, "page2")
        XCTAssertTrue(transport.urls.contains { $0.contains("&cursor=page2") })
        XCTAssertEqual(model.skeletonMeta, "1 post, a later page")
    }

    func testAnInputThatIsNotAFeedSaysWhyWithoutARun() {
        let model = FeedInspectorModel(client: client(FeedFakeTransport([])))
        XCTAssertNil(model.run("https://bsky.app/profile/bsky.app/lists/3abc"))
        XCTAssertEqual(model.input?.reason, "That is a list, not a feed.")
        XCTAssertNil(model.verdict)
    }
}
