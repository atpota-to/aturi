import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Scripted transport for the AT Tags round trip: one canned answer, every
/// request recorded.
private final class SearchRoutingFakeTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private let status: Int
    private let body: String
    private let error: Error?
    private(set) var requests: [URLRequest] = []

    init(status: Int = 200, body: String = "", error: Error? = nil) {
        self.status = status
        self.body = body
        self.error = error
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        if let error { throw error }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
        return (Data(body.utf8), response)
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
}

/// Port of `extension/lib/__tests__/searchRouting.test.ts`. Space addresses
/// are the one departure: unsupported on iOS, they are refused rather than
/// routed to the space pages (see the file comment in SearchRouting.swift).
final class SearchRoutingTests: XCTestCase {
    private func target(_ input: String) -> SearchTarget? {
        SearchRouting.resolveSearchTarget(input)
    }

    private func path(_ input: String) -> String? {
        SearchRouting.resolveSearchPath(input)
    }

    // MARK: resolveSearchTarget

    func testAtUrisAreConfidentMatches() {
        XCTAssertEqual(target("at://did:plc:abc/app.bsky.feed.post/xyz"), .match(path: "/explore/did:plc:abc/app.bsky.feed.post/xyz"))
    }

    func testHandlesAndDidsAreConfidentMatches() {
        XCTAssertEqual(target("alice.bsky.social"), .match(path: "/explore/alice.bsky.social"))
        XCTAssertEqual(target("did:plc:abc123"), .match(path: "/explore/did:plc:abc123"))
        XCTAssertEqual(target("did:plc:abc123")?.isGuess, false)
    }

    func testKnownWaypointUrlIsAMatchNotAGuess() {
        let found = target("https://bsky.app/profile/alice.bsky.social")
        XCTAssertEqual(found?.isGuess, false)
        XCTAssertEqual(found?.path, "/explore/alice.bsky.social")
        XCTAssertEqual(target("https://bsky.app/profile/alice.bsky.social/post/3k")?.path, "/explore/alice.bsky.social/app.bsky.feed.post/3k")
        XCTAssertEqual(target("https://pdsls.dev/at://did:plc:abc/app.bsky.feed.post/xyz")?.path, "/explore/did:plc:abc/app.bsky.feed.post/xyz")
    }

    func testAturiLinksAreConfidentMatches() {
        XCTAssertEqual(
            target("https://aturi.to/profile/alice.bsky.social/app.bsky.feed.post/xyz"),
            .match(path: "/explore/alice.bsky.social/app.bsky.feed.post/xyz")
        )
        XCTAssertEqual(target("https://aturi.to/profile/alice.bsky.social/post/xyz")?.path, "/explore/alice.bsky.social/app.bsky.feed.post/xyz")
        XCTAssertEqual(target("https://aturi.to/profile/alice.bsky.social/lists/xyz")?.path, "/explore/alice.bsky.social/app.bsky.graph.list/xyz")
        XCTAssertEqual(target("https://aturi.to/profile/alice.bsky.social/list/xyz")?.path, "/explore/alice.bsky.social/app.bsky.graph.list/xyz")
        XCTAssertEqual(target("https://www.aturi.to/profile/did:plc:abc")?.path, "/explore/did:plc:abc")
        XCTAssertEqual(target("https://ATURI.to/explore/did:plc:abc/app.bsky.feed.post")?.path, "/explore/did:plc:abc/app.bsky.feed.post")
        XCTAssertEqual(target("https://aturi.to/explore/did:plc:abc/app.bsky.feed.post/xyz?tab=json#top")?.path, "/explore/did:plc:abc/app.bsky.feed.post/xyz")
        // Explorer sub-tools round-trip as themselves rather than becoming a PDS guess.
        XCTAssertEqual(target("https://aturi.to/explore/pds/bsky.social"), .match(path: "/explore/pds/bsky.social"))
        XCTAssertEqual(target("https://aturi.to/explore/lexicons"), .match(path: "/explore/lexicons"))
        // A bare aturi.to page is not a record; it falls through to the guess.
        XCTAssertEqual(target("https://aturi.to/about")?.isGuess, true)
    }

    func testUnrecognizedHttpUrlIsAGuessCarryingTheOriginalUrl() {
        let found = target("https://someones-blog.example/posts/hello")
        XCTAssertEqual(found?.isGuess, true)
        if case .pdsGuess(let path, let url) = found {
            // The full URL survives so the AT Tags lookup can fetch the actual
            // page, not just its host.
            XCTAssertEqual(url, "https://someones-blog.example/posts/hello")
            XCTAssertEqual(path, "/explore/pds/someones-blog.example")
        } else {
            XCTFail("expected a pds guess, got \(String(describing: found))")
        }
        XCTAssertEqual(target("http://pds.example:3000/xrpc/com.atproto.server.describeServer")?.path, "/explore/pds/pds.example%3A3000")
    }

    func testBarePdsHostnamesRouteStraightToThePdsView() {
        XCTAssertEqual(target("pds.atpota.to"), .match(path: "/explore/pds/pds.atpota.to"))
        XCTAssertEqual(target("PDS.bsky.network"), .match(path: "/explore/pds/PDS.bsky.network"))
        // Not enough labels, or a path: a handle, or a DID.
        XCTAssertEqual(target("pds.example"), .match(path: "/explore/pds.example"))
        XCTAssertTrue(SearchRouting.looksLikeBarePdsHostname("pds.atpota.to"))
        XCTAssertFalse(SearchRouting.looksLikeBarePdsHostname("pds.atpota.to/xrpc"))
        XCTAssertFalse(SearchRouting.looksLikeBarePdsHostname("did:plc:x"))
        XCTAssertFalse(SearchRouting.looksLikeBarePdsHostname("at://pds.x.y"))
    }

    func testEmptyInputIsNil() {
        XCTAssertNil(target(""))
        XCTAssertNil(target("   "))
        XCTAssertNil(target("\n\t"))
    }

    func testQuestionMarkAndHashInAHandleAreEscaped() {
        XCTAssertEqual(path("weird?name#x"), "/explore/weird%3Fname%23x")
    }

    // MARK: resolveSearchPath (sync behaviour preserved)

    func testResolveSearchPathReturnsTheSamePathsItAlwaysDid() {
        XCTAssertEqual(path("at://did:plc:abc/app.bsky.feed.post/xyz"), "/explore/did:plc:abc/app.bsky.feed.post/xyz")
        XCTAssertEqual(path("alice.bsky.social"), "/explore/alice.bsky.social")
        XCTAssertEqual(path("https://someones-blog.example/posts/hello"), "/explore/pds/someones-blog.example")
        XCTAssertNil(path(""))
    }

    // MARK: Space addresses (refused on iOS)

    func testSpaceAtUrisAreRefusedRatherThanTruncated() {
        // The web routes these to the space pages; this port has none, so an
        // at:// space address routes nowhere. Either way it is never rewritten
        // into `/explore/<did>/space/<type>`, which would read as a record in
        // a collection called `space`.
        XCTAssertNil(target("at://did:plc:x/space/com.example.forum/skey1"))
        XCTAssertNil(target("at://did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc"))
        XCTAssertNil(target("at://alice.example.com/space/com.example.foo/self"))
        XCTAssertNil(target("at://did:plc:x/space/foo/self"))
    }

    func testAturiSpaceUrlsAreNeverConfidentMatches() {
        let inputs = [
            "https://aturi.to/explore/did:plc:x/space/com.example.forum/skey1",
            "https://aturi.to/explore/did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc",
            "https://aturi.to/explore/did:plc:x/space",
            "https://aturi.to/explore/did:plc:x/space/com.example.forum",
            "https://aturi.to/explore/alice.bsky.social/space",
            "https://aturi.to/explore/alice.bsky.social/space/com.example.forum/skey1",
            "https://aturi.to/explore/did:plc:x/space/com.example.forum/skey1/alice.example.com/app.bsky.feed.post/abc",
            "https://aturi.to/explore/did:plc:x/space/com.example.forum/skey1/did:plc:y",
        ]
        for input in inputs {
            let found = target(input)
            XCTAssertNotEqual(found?.isGuess, false, input)
            XCTAssertFalse(found?.path.contains("/space") ?? false, "\(input) must not be rewritten into a space path")
        }
    }

    func testACollectionNsidThatStartsWithSpaceIsLeftAlone() {
        XCTAssertEqual(target("at://did:plc:x/space.example.thing/abc"), .match(path: "/explore/did:plc:x/space.example.thing/abc"))
        XCTAssertEqual(target("https://aturi.to/explore/did:plc:x/space.example.thing/abc")?.path, "/explore/did:plc:x/space.example.thing/abc")
    }

    // MARK: at:// ladder

    func testDrillsDownAsFarAsTheUriAllows() {
        XCTAssertEqual(path("at://did:plc:abc/app.bsky.feed.post/xyz"), "/explore/did:plc:abc/app.bsky.feed.post/xyz")
        XCTAssertEqual(path("at://did:plc:abc/app.bsky.feed.post"), "/explore/did:plc:abc/app.bsky.feed.post")
        XCTAssertEqual(path("at://did:plc:abc"), "/explore/did:plc:abc")
        XCTAssertEqual(path("at://alice.bsky.social/app.bsky.feed.post/xyz"), "/explore/alice.bsky.social/app.bsky.feed.post/xyz")
        XCTAssertNil(path("at://"))
    }

    func testStripsAQueryOrFragmentHungOffTheAuthority() {
        XCTAssertEqual(path("at://did:plc:abc123?x=1"), "/explore/did:plc:abc123")
        XCTAssertEqual(path("at://did:plc:abc123#frag"), "/explore/did:plc:abc123")
    }

    // MARK: explorePath(fromParsed:)

    func testExplorePathFromParsedWalksTheLadder() {
        XCTAssertEqual(SearchRouting.explorePath(fromParsed: parseURI(handle: "alice.test")), "/explore/alice.test")
        XCTAssertEqual(SearchRouting.explorePath(fromParsed: parseURI(handle: "did:plc:a", collection: "app.bsky.feed.post", rkey: "r/k")), "/explore/did:plc:a/app.bsky.feed.post/r%2Fk")
        XCTAssertEqual(SearchRouting.explorePath(fromParsed: ParsedURI(type: .unknown, uri: "", handle: "a.b", collection: "x.y.z")), "/explore/a.b/x.y.z")
    }

    // MARK: SearchDestination

    func testDestinationDecodesExplorerPaths() {
        XCTAssertEqual(SearchDestination(explorePath: "/explore/alice.test"), .repo("alice.test"))
        XCTAssertEqual(SearchDestination(explorePath: "/explore/did:plc:abc/app.bsky.feed.post"), .collection(repo: "did:plc:abc", collection: "app.bsky.feed.post"))
        XCTAssertEqual(SearchDestination(explorePath: "/explore/did:plc:abc/app.bsky.feed.post/r%2Fk"), .record(repo: "did:plc:abc", collection: "app.bsky.feed.post", rkey: "r/k"))
        XCTAssertEqual(SearchDestination(explorePath: "/explore/pds/pds.example%3A3000"), .pds(host: "pds.example:3000"))
        XCTAssertEqual(SearchDestination(explorePath: "/explore/lexicons/app.bsky.feed.post"), .lexicon(nsid: "app.bsky.feed.post"))
        XCTAssertEqual(SearchDestination(explorePath: "/explore/lexicons/group/app.bsky"), .lexiconGroup(prefix: "app.bsky"))
        XCTAssertEqual(SearchDestination(explorePath: "/explore/lexicons"), .explorer(path: "/explore/lexicons"))
        XCTAssertEqual(SearchDestination(explorePath: "/explore/spaces"), .explorer(path: "/explore/spaces"))
        XCTAssertEqual(SearchDestination(explorePath: "/explore/pds"), .explorer(path: "/explore/pds"))
        XCTAssertEqual(SearchDestination(explorePath: "/explore/nodots"), .repo("nodots"), "any unreserved first segment is a repo, as the search box routes it")
        XCTAssertEqual(SearchDestination(explorePath: "/explore/did:plc:x/space/com.example.forum"), .explorer(path: "/explore/did:plc:x/space/com.example.forum"))
        XCTAssertEqual(SearchDestination(explorePath: "/explore"), .explorer(path: "/explore"))
        XCTAssertEqual(SearchDestination(explorePath: "/account"), .explorer(path: "/account"))
        XCTAssertEqual(SearchDestination(explorePath: "/explore/weird%3Fname"), .repo("weird?name"))
    }

    func testDestinationRoundTripsToTheCanonicalPath() {
        let paths = [
            "/explore/alice.test",
            "/explore/did:plc:abc/app.bsky.feed.post",
            "/explore/did:plc:abc/app.bsky.feed.post/r%2Fk",
            "/explore/pds/pds.example%3A3000",
            "/explore/lexicons/app.bsky.feed.post",
            "/explore/lexicons/group/app.bsky",
            "/explore/lexicons",
            "/explore/weird%3Fname%23x",
        ]
        for path in paths {
            XCTAssertEqual(SearchDestination(explorePath: path).explorePath, path)
        }
        XCTAssertEqual(SearchDestination.repo("alice.test").repo, "alice.test")
        XCTAssertEqual(SearchDestination.record(repo: "did:plc:a", collection: "c.d.e", rkey: "r").repo, "did:plc:a")
        XCTAssertNil(SearchDestination.pds(host: "x").repo)
    }

    func testResolveSearchDestination() {
        XCTAssertEqual(SearchRouting.resolveSearchDestination("at://did:plc:abc/app.bsky.feed.post/xyz"), .record(repo: "did:plc:abc", collection: "app.bsky.feed.post", rkey: "xyz"))
        XCTAssertEqual(SearchRouting.resolveSearchDestination("pds.atpota.to"), .pds(host: "pds.atpota.to"))
        XCTAssertNil(SearchRouting.resolveSearchDestination(" "))
    }

    // MARK: resolveSearchPathAsync

    func testAsyncRoutingReturnsMatchesWithoutANetworkCall() async {
        let transport = SearchRoutingFakeTransport(body: #"{"ok":true,"primary":"at://did:plc:never/x.y.z/1"}"#)
        let http = HTTPClient(transport: transport)
        let resolved = await SearchRouting.resolveSearchPathAsync("https://bsky.app/profile/alice.test", http: http)
        XCTAssertEqual(resolved, "/explore/alice.test")
        let handle = await SearchRouting.resolveSearchPathAsync("alice.test", http: http)
        XCTAssertEqual(handle, "/explore/alice.test")
        let empty = await SearchRouting.resolveSearchPathAsync("  ", http: http)
        XCTAssertNil(empty)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testAsyncRoutingUpgradesAGuessThroughAtTags() async {
        let transport = SearchRoutingFakeTransport(body: #"{"ok":true,"url":"https://someones-blog.example/posts/hello","primary":"at://did:plc:blog/site.standard.document/abc","tags":{},"count":1}"#)
        let resolved = await SearchRouting.resolveSearchPathAsync("https://someones-blog.example/posts/hello", http: HTTPClient(transport: transport))
        XCTAssertEqual(resolved, "/explore/did:plc:blog/site.standard.document/abc")
        XCTAssertEqual(transport.urls, ["https://aturi.to/api/at-tags?url=https%3A%2F%2Fsomeones-blog.example%2Fposts%2Fhello"])
        XCTAssertEqual(SearchRouting.atTagsURL(for: "https://x.example/a b").absoluteString, "https://aturi.to/api/at-tags?url=https%3A%2F%2Fx.example%2Fa%20b")
    }

    func testAsyncRoutingFallsBackToTheGuess() async {
        let noTags = SearchRoutingFakeTransport(body: #"{"ok":true,"primary":null,"tags":{},"count":0}"#)
        let fromNoTags = await SearchRouting.resolveSearchPathAsync("https://someones-blog.example/posts/hello", http: HTTPClient(transport: noTags))
        XCTAssertEqual(fromNoTags, "/explore/pds/someones-blog.example")

        let fetchFailed = SearchRoutingFakeTransport(body: #"{"ok":false,"reason":"fetch-failed"}"#)
        let fromFetchFailed = await SearchRouting.resolveSearchPathAsync("https://someones-blog.example/posts/hello", http: HTTPClient(transport: fetchFailed))
        XCTAssertEqual(fromFetchFailed, "/explore/pds/someones-blog.example")

        let serverError = SearchRoutingFakeTransport(status: 500, body: "nope")
        let fromServerError = await SearchRouting.resolveSearchPathAsync("https://someones-blog.example/posts/hello", http: HTTPClient(transport: serverError))
        XCTAssertEqual(fromServerError, "/explore/pds/someones-blog.example")

        let offline = SearchRoutingFakeTransport(error: URLError(.notConnectedToInternet))
        let fromOffline = await SearchRouting.resolveSearchPathAsync("https://someones-blog.example/posts/hello", http: HTTPClient(transport: offline))
        XCTAssertEqual(fromOffline, "/explore/pds/someones-blog.example")

        let malformedPrimary = SearchRoutingFakeTransport(body: #"{"ok":true,"primary":"not-an-at-uri"}"#)
        let fromMalformed = await SearchRouting.resolveSearchPathAsync("https://someones-blog.example/posts/hello", http: HTTPClient(transport: malformedPrimary))
        XCTAssertEqual(fromMalformed, "/explore/pds/someones-blog.example")
    }
}
