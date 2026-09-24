import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Answers each request through a handler and records what was asked, so
/// query strings and chunking can be asserted without a network.
private final class AppViewFakeTransport: HTTPTransport, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) throws -> (Data, HTTPURLResponse)

    private let lock = NSLock()
    private let handler: Handler
    private(set) var requests: [URLRequest] = []

    init(_ handler: @escaping Handler) {
        self.handler = handler
    }

    /// Every request gets `status` with `body`.
    convenience init(status: Int = 200, body: String) {
        self.init { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
            return (Data(body.utf8), response)
        }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        return try handler(request)
    }

    private func record(_ request: URLRequest) {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
    }

    var urls: [String] {
        lock.lock(); defer { lock.unlock() }
        return requests.compactMap { $0.url?.absoluteString }
    }
}

private func appViewOK(_ request: URLRequest, _ body: String) -> (Data, HTTPURLResponse) {
    (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!)
}

final class AppViewClientTests: XCTestCase {
    private func client(_ transport: AppViewFakeTransport) -> AppViewClient {
        AppViewClient(client: HTTPClient(transport: transport))
    }

    private let profileBody = #"{"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app","displayName":"Bluesky","followersCount":10}"#

    private let postBody = #"{"uri":"at://did:plc:a/app.bsky.feed.post/3k","cid":"c","author":{"did":"did:plc:a","handle":"a.test"},"record":{"$type":"app.bsky.feed.post","text":"hi","createdAt":"2026-01-01T00:00:00Z"},"likeCount":4,"indexedAt":"2026-01-01T00:00:01Z"}"#

    // MARK: Profiles

    func testGetProfileBuildsTheUrlAndDecodes() async {
        let transport = AppViewFakeTransport(body: profileBody)
        let profile = await client(transport).getProfile("bsky.app")
        XCTAssertEqual(profile?.did, "did:plc:z72i7hdynmk6r22z27h6tvur")
        XCTAssertEqual(profile?.followersCount, 10)
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=bsky.app"])
    }

    func testGetProfileEncodesTheActor() async {
        let transport = AppViewFakeTransport(body: profileBody)
        _ = await client(transport).getProfile("did:plc:z72i7hdynmk6r22z27h6tvur")
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=did%3Aplc%3Az72i7hdynmk6r22z27h6tvur"])
    }

    func testGetProfileIsNilForAnEmptyActorWithoutARequest() async {
        let transport = AppViewFakeTransport(body: profileBody)
        let profile = await client(transport).getProfile("")
        XCTAssertNil(profile)
        XCTAssertEqual(transport.requests.count, 0)
    }

    func testFailuresBecomeNil() async {
        let status = AppViewFakeTransport(status: 400, body: #"{"error":"InvalidRequest"}"#)
        let malformed = AppViewFakeTransport(body: "<html>")
        let transportError = AppViewFakeTransport { _ in throw URLError(.notConnectedToInternet) }
        let wrongShape = AppViewFakeTransport(body: #"{"handle":"no-did.test"}"#)

        let fromStatus = await client(status).getProfile("x.test")
        let fromMalformed = await client(malformed).getProfile("x.test")
        let fromTransport = await client(transportError).getProfile("x.test")
        let fromShape = await client(wrongShape).getProfile("x.test")
        XCTAssertNil(fromStatus)
        XCTAssertNil(fromMalformed)
        XCTAssertNil(fromTransport)
        XCTAssertNil(fromShape)
        XCTAssertEqual(transportError.requests.count, 2, "the client retries a transport failure once")
    }

    func testGetProfilesChunksBy25AndDedupes() async {
        let transport = AppViewFakeTransport { request in
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let actors = query.filter { $0.name == "actors" }.compactMap { $0.value }
            let profiles = actors.map { #"{"did":"\#($0)","handle":"\#($0.replacingOccurrences(of: "did:plc:", with: "")).test"}"# }
            return appViewOK(request, #"{"profiles":[\#(profiles.joined(separator: ","))]}"#)
        }
        var actors = (0..<30).map { "did:plc:actor\($0)" }
        actors.append("did:plc:actor0")
        actors.append("")
        let result = await client(transport).getProfilesResult(actors)
        XCTAssertFalse(result.failed)
        XCTAssertEqual(result.profiles.count, 30)
        XCTAssertEqual(result.profiles["did:plc:actor29"]?.handle, "actor29.test")
        XCTAssertEqual(transport.requests.count, 2)
        let counts = transport.requests.map { request -> Int in
            (URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []).filter { $0.name == "actors" }.count
        }
        XCTAssertEqual(counts.sorted(), [5, 25])
        XCTAssertTrue(transport.urls.allSatisfy { $0.hasPrefix("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?actors=") })
    }

    func testGetProfilesReportsAFailedChunk() async {
        let transport = AppViewFakeTransport { request in
            let url = request.url!.absoluteString
            if url.contains("actor25") {
                return (Data(), HTTPURLResponse(url: request.url!, statusCode: 502, httpVersion: "HTTP/1.1", headerFields: nil)!)
            }
            return appViewOK(request, #"{"profiles":[{"did":"did:plc:actor0","handle":"a.test"}]}"#)
        }
        let actors = (0..<26).map { "did:plc:actor\($0)" }
        let result = await client(transport).getProfilesResult(actors)
        XCTAssertTrue(result.failed)
        XCTAssertEqual(result.profiles.count, 1)
        let plain = await client(transport).getProfiles(actors)
        XCTAssertEqual(plain.count, 1)
    }

    func testGetProfilesWithNoActorsMakesNoRequest() async {
        let transport = AppViewFakeTransport(body: "{}")
        let result = await client(transport).getProfilesResult(["", ""])
        XCTAssertTrue(result.profiles.isEmpty)
        XCTAssertFalse(result.failed)
        XCTAssertEqual(transport.requests.count, 0)
    }

    // MARK: Typeahead

    func testSearchActorsTypeahead() async {
        let transport = AppViewFakeTransport(body: #"{"actors":[{"did":"did:plc:d","handle":"dame.is","displayName":"dame","avatar":"https://cdn/a"},{"handle":"no-did"}]}"#)
        let results = await client(transport).searchActorsTypeahead("dam")
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0], ActorTypeaheadResult(did: "did:plc:d", handle: "dame.is", displayName: "dame", avatar: "https://cdn/a"))
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead?q=dam&limit=8"])
    }

    func testSearchActorsTypeaheadIsEmptyOnFailureAndEmptyQuery() async {
        let failing = AppViewFakeTransport(status: 500, body: "")
        let fromFailure = await client(failing).searchActorsTypeahead("dam", limit: 3)
        XCTAssertEqual(fromFailure, [])
        XCTAssertEqual(failing.urls, ["https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead?q=dam&limit=3"])

        let notAsked = AppViewFakeTransport(body: "{}")
        let fromEmpty = await client(notAsked).searchActorsTypeahead("")
        XCTAssertEqual(fromEmpty, [])
        XCTAssertEqual(notAsked.requests.count, 0)

        let noArray = AppViewFakeTransport(body: #"{"actors":"nope"}"#)
        let fromShape = await client(noArray).searchActorsTypeahead("dam")
        XCTAssertEqual(fromShape, [])
    }

    /// Port of extension/lib/__tests__/handleTypeahead.test.ts.
    func testShouldQueryHandleTypeahead() {
        XCTAssertEqual(AppViewClient.handleTypeaheadMinLength, 3)

        XCTAssertTrue(AppViewClient.shouldQueryHandleTypeahead("dam"))
        XCTAssertTrue(AppViewClient.shouldQueryHandleTypeahead("dame.bsky.social"))
        XCTAssertTrue(AppViewClient.shouldQueryHandleTypeahead("alice"))

        XCTAssertFalse(AppViewClient.shouldQueryHandleTypeahead(""))
        XCTAssertFalse(AppViewClient.shouldQueryHandleTypeahead("d"))
        XCTAssertFalse(AppViewClient.shouldQueryHandleTypeahead("da"))

        XCTAssertFalse(AppViewClient.shouldQueryHandleTypeahead("  da  "))
        XCTAssertTrue(AppViewClient.shouldQueryHandleTypeahead("  dam  "))

        XCTAssertFalse(AppViewClient.shouldQueryHandleTypeahead("did:plc:ewvi7nxzyoun6zhxrhs64oiz"))
        XCTAssertFalse(AppViewClient.shouldQueryHandleTypeahead("did:web:example.com"))

        XCTAssertFalse(AppViewClient.shouldQueryHandleTypeahead("at://did:plc:x/app.bsky.feed.post/a"))
        XCTAssertFalse(AppViewClient.shouldQueryHandleTypeahead("example.com/alice"))

        XCTAssertFalse(AppViewClient.shouldQueryHandleTypeahead("alice smith"))

        // A handle the AppView has never indexed is still a handle.
        XCTAssertTrue(AppViewClient.shouldQueryHandleTypeahead("dame.spaces"))
        XCTAssertTrue(AppViewClient.shouldQueryHandleTypeahead("alice.self-hosted.example"))
    }

    func testSearchActors() async {
        let transport = AppViewFakeTransport(body: #"{"actors":[{"did":"did:plc:a","handle":"a.test"}],"cursor":"next"}"#)
        let page = await client(transport).searchActors("a", limit: 5, cursor: "c1")
        XCTAssertEqual(page?.actors.map { $0.did }, ["did:plc:a"])
        XCTAssertEqual(page?.cursor, "next")
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=a&limit=5&cursor=c1"])
        let none = await client(transport).searchActors("")
        XCTAssertNil(none)
    }

    // MARK: Threads and posts

    func testGetPostThreadReturnsAnchorAndParent() async {
        let body = """
        {"thread":{"$type":"app.bsky.feed.defs#threadViewPost",
          "post":{"uri":"at://did:plc:a/app.bsky.feed.post/child","cid":"c1","author":{"did":"did:plc:a","handle":"a.test"},
                  "record":{"$type":"app.bsky.feed.post","text":"reply","createdAt":"2026-01-02T00:00:00Z","reply":{"root":{"uri":"at://did:plc:b/app.bsky.feed.post/parent","cid":"c0"},"parent":{"uri":"at://did:plc:b/app.bsky.feed.post/parent","cid":"c0"}}},
                  "replyCount":0,"indexedAt":"2026-01-02T00:00:01Z"},
          "parent":{"$type":"app.bsky.feed.defs#threadViewPost",
            "post":{"uri":"at://did:plc:b/app.bsky.feed.post/parent","cid":"c0","author":{"did":"did:plc:b","handle":"b.test","displayName":"B"},
                    "record":{"$type":"app.bsky.feed.post","text":"original","createdAt":"2026-01-01T00:00:00Z"},"likeCount":9,"indexedAt":"2026-01-01T00:00:01Z"}},
          "replies":[]}}
        """
        let transport = AppViewFakeTransport(body: body)
        let thread = await client(transport).getPostThread("at://did:plc:a/app.bsky.feed.post/child")
        XCTAssertEqual(thread?.post.uri, "at://did:plc:a/app.bsky.feed.post/child")
        XCTAssertEqual(thread?.post.record.text, "reply")
        XCTAssertEqual(thread?.post.isReply, true)
        XCTAssertEqual(thread?.parent?.uri, "at://did:plc:b/app.bsky.feed.post/parent")
        XCTAssertEqual(thread?.parent?.record.text, "original")
        XCTAssertEqual(thread?.parent?.likeCount, 9)
        XCTAssertEqual(thread?.raw["thread"]?["replies"]?.arrayValue?.count, 0)
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=at%3A%2F%2Fdid%3Aplc%3Aa%2Fapp.bsky.feed.post%2Fchild&depth=0&parentHeight=1"])
    }

    func testGetPostThreadWithoutAParent() async {
        let transport = AppViewFakeTransport(body: #"{"thread":{"$type":"app.bsky.feed.defs#threadViewPost","post":\#(postBody)}}"#)
        let thread = await client(transport).getPostThread("at://did:plc:a/app.bsky.feed.post/3k", depth: 2, parentHeight: 0)
        XCTAssertEqual(thread?.post.likeCount, 4)
        XCTAssertNil(thread?.parent)
        XCTAssertTrue(transport.urls[0].hasSuffix("&depth=2&parentHeight=0"))
    }

    func testGetPostThreadIsNilForNotFoundBlockedAndEmptyUri() async {
        let notFound = AppViewFakeTransport(body: #"{"thread":{"$type":"app.bsky.feed.defs#notFoundPost","uri":"at://did:plc:a/app.bsky.feed.post/gone","notFound":true}}"#)
        let fromNotFound = await client(notFound).getPostThread("at://did:plc:a/app.bsky.feed.post/gone")
        XCTAssertNil(fromNotFound)

        let blocked = AppViewFakeTransport(body: #"{"thread":{"$type":"app.bsky.feed.defs#blockedPost","uri":"at://did:plc:a/app.bsky.feed.post/b","blocked":true,"author":{"did":"did:plc:a"}}}"#)
        let fromBlocked = await client(blocked).getPostThread("at://did:plc:a/app.bsky.feed.post/b")
        XCTAssertNil(fromBlocked)

        let unasked = AppViewFakeTransport(body: "{}")
        let fromEmpty = await client(unasked).getPostThread("")
        XCTAssertNil(fromEmpty)
        XCTAssertEqual(unasked.requests.count, 0)
    }

    func testGetPostsRepeatsTheUrisParameter() async {
        let transport = AppViewFakeTransport(body: #"{"posts":[\#(postBody),{"uri":"no-author"}]}"#)
        let posts = await client(transport).getPosts(["at://did:plc:a/app.bsky.feed.post/3k", "at://did:plc:a/app.bsky.feed.post/3j"])
        XCTAssertEqual(posts?.count, 1, "an undecodable post is dropped, not fatal")
        XCTAssertEqual(posts?.first?.uri, "at://did:plc:a/app.bsky.feed.post/3k")
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=at%3A%2F%2Fdid%3Aplc%3Aa%2Fapp.bsky.feed.post%2F3k&uris=at%3A%2F%2Fdid%3Aplc%3Aa%2Fapp.bsky.feed.post%2F3j"])

        let empty = await client(transport).getPosts([])
        XCTAssertNil(empty)
        let failing = AppViewFakeTransport(status: 503, body: "")
        let fromFailure = await client(failing).getPosts(["at://did:plc:a/app.bsky.feed.post/3k"])
        XCTAssertNil(fromFailure)
    }

    func testGetAuthorFeed() async {
        let body = #"{"feed":[{"post":\#(postBody),"reason":{"$type":"app.bsky.feed.defs#reasonRepost","by":{"did":"did:plc:r","handle":"r.test"},"indexedAt":"2026-01-03T00:00:00Z"}},{"post":\#(postBody),"reply":{"root":{},"parent":{}}},{"post":{"uri":"broken"}}],"cursor":"page2"}"#
        let transport = AppViewFakeTransport(body: body)
        let page = await client(transport).getAuthorFeed(actor: "bsky.app", filter: .postsWithMedia, limit: 5, cursor: "page1")
        XCTAssertEqual(page?.items.count, 2)
        XCTAssertEqual(page?.items[0].reason?.isRepost, true)
        XCTAssertEqual(page?.items[0].reason?.by?.handle, "r.test")
        XCTAssertEqual(page?.items[0].isReply, false)
        XCTAssertNil(page?.items[1].reason)
        XCTAssertEqual(page?.items[1].isReply, true)
        XCTAssertEqual(page?.cursor, "page2")
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=bsky.app&limit=5&filter=posts_with_media&cursor=page1"])

        let defaults = AppViewFakeTransport(body: #"{"feed":[]}"#)
        let empty = await client(defaults).getAuthorFeed(actor: "bsky.app")
        XCTAssertEqual(empty?.items, [])
        XCTAssertNil(empty?.cursor)
        XCTAssertEqual(defaults.urls, ["https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=bsky.app&limit=30"])
        let none = await client(defaults).getAuthorFeed(actor: "")
        XCTAssertNil(none)
    }

    func testGetFeedAndGetListFeed() async {
        let transport = AppViewFakeTransport(body: #"{"feed":[{"post":\#(postBody),"feedContext":"ctx"}]}"#)
        let feed = await client(transport).getFeed(feed: "at://did:plc:f/app.bsky.feed.generator/g", limit: 3)
        XCTAssertEqual(feed?.items.first?.feedContext, "ctx")
        let list = await client(transport).getListFeed(list: "at://did:plc:l/app.bsky.graph.list/x", cursor: "c")
        XCTAssertEqual(list?.items.count, 1)
        XCTAssertEqual(transport.urls, [
            "https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=at%3A%2F%2Fdid%3Aplc%3Af%2Fapp.bsky.feed.generator%2Fg&limit=3",
            "https://public.api.bsky.app/xrpc/app.bsky.feed.getListFeed?list=at%3A%2F%2Fdid%3Aplc%3Al%2Fapp.bsky.graph.list%2Fx&limit=25&cursor=c",
        ])
    }

    func testSearchPostsSetsOnlyTheGivenFilters() async {
        let transport = AppViewFakeTransport(body: #"{"posts":[\#(postBody)],"cursor":"n","hitsTotal":1}"#)
        let page = await client(transport).searchPosts(q: "hello world", sort: .latest, since: "2026-01-01", author: "bsky.app", lang: "en", limit: 10)
        XCTAssertEqual(page?.posts.count, 1)
        XCTAssertEqual(page?.hitsTotal, 1)
        XCTAssertEqual(page?.cursor, "n")
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=hello%20world&limit=10&sort=latest&since=2026-01-01&author=bsky.app&lang=en"])
        let none = await client(transport).searchPosts(q: "")
        XCTAssertNil(none)
    }

    func testGetPostEngagementPicksTheMethod() async {
        let likes = AppViewFakeTransport(body: #"{"uri":"at://did:plc:a/app.bsky.feed.post/3k","likes":[{"actor":{"did":"did:plc:l","handle":"l.test"},"createdAt":"2026-01-01T00:00:00Z","indexedAt":"2026-01-01T00:00:01Z"},{"createdAt":"no actor"}],"cursor":"x"}"#)
        let likesPage = await client(likes).getPostEngagement(uri: "at://did:plc:a/app.bsky.feed.post/3k", kind: .likes, limit: 2, cursor: "prev")
        XCTAssertEqual(likesPage?.kind, .likes)
        XCTAssertEqual(likesPage?.likes.count, 1)
        XCTAssertEqual(likesPage?.likes.first?.actor.handle, "l.test")
        XCTAssertEqual(likesPage?.likes.first?.createdAt, "2026-01-01T00:00:00Z")
        XCTAssertEqual(likesPage?.uri, "at://did:plc:a/app.bsky.feed.post/3k")
        XCTAssertEqual(likesPage?.cursor, "x")
        XCTAssertEqual(likes.urls, ["https://public.api.bsky.app/xrpc/app.bsky.feed.getLikes?uri=at%3A%2F%2Fdid%3Aplc%3Aa%2Fapp.bsky.feed.post%2F3k&limit=2&cursor=prev"])

        let reposts = AppViewFakeTransport(body: #"{"repostedBy":[{"did":"did:plc:r","handle":"r.test"}]}"#)
        let repostsPage = await client(reposts).getPostEngagement(uri: "at://did:plc:a/app.bsky.feed.post/3k", kind: .reposts)
        XCTAssertEqual(repostsPage?.repostedBy.map { $0.did }, ["did:plc:r"])
        XCTAssertTrue(reposts.urls[0].contains("/xrpc/app.bsky.feed.getRepostedBy?"))
        XCTAssertTrue(reposts.urls[0].hasSuffix("&limit=25"))

        let quotes = AppViewFakeTransport(body: #"{"posts":[\#(postBody)]}"#)
        let quotesPage = await client(quotes).getPostEngagement(uri: "at://did:plc:a/app.bsky.feed.post/3k", kind: .quotes)
        XCTAssertEqual(quotesPage?.posts.count, 1)
        XCTAssertTrue(quotes.urls[0].contains("/xrpc/app.bsky.feed.getQuotes?"))

        let none = await client(quotes).getPostEngagement(uri: "", kind: .quotes)
        XCTAssertNil(none)
    }

    // MARK: Trends, feeds, graph, lists

    func testGetTrends() async {
        let transport = AppViewFakeTransport(body: #"{"trends":[{"topic":"apples","displayName":"Apples","link":"/profile/trending.bsky.app/feed/apples","startedAt":"2026-09-09T15:00:00Z","postCount":1200,"status":"hot","category":"tech","actors":[{"did":"did:plc:z","handle":"bsky.app"}]},{"noTopic":true}]}"#)
        let trends = await client(transport).getTrends(limit: 3)
        XCTAssertEqual(trends?.count, 1)
        XCTAssertEqual(trends?.first?.topic, "apples")
        XCTAssertEqual(trends?.first?.displayName, "Apples")
        XCTAssertEqual(trends?.first?.postCount, 1200)
        XCTAssertEqual(trends?.first?.status, "hot")
        XCTAssertEqual(trends?.first?.actors.first?.handle, "bsky.app")
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends?limit=3"])

        let failing = AppViewFakeTransport(status: 404, body: "")
        let unavailable = await client(failing).getTrends()
        XCTAssertNil(unavailable)
        XCTAssertTrue(failing.urls[0].hasSuffix("?limit=10"))
    }

    func testListFeedGeneratorsSources() async {
        let transport = AppViewFakeTransport(body: #"{"feeds":[{"uri":"at://did:plc:f/app.bsky.feed.generator/g","cid":"c","did":"did:web:feeds.example","creator":{"did":"did:plc:f","handle":"f.test"},"displayName":"G","likeCount":3}],"cursor":"more"}"#)
        let byActor = await client(transport).listFeedGenerators(source: .actor("bsky.app"), limit: 50, cursor: "c")
        XCTAssertEqual(byActor?.feeds.first?.displayName, "G")
        XCTAssertEqual(byActor?.feeds.first?.creator?.handle, "f.test")
        XCTAssertEqual(byActor?.feeds.first?.likeCount, 3)
        XCTAssertEqual(byActor?.cursor, "more")
        _ = await client(transport).listFeedGenerators(source: .popular(query: "cats"))
        _ = await client(transport).listFeedGenerators(source: .popular())
        _ = await client(transport).listFeedGenerators(source: .suggested, limit: 50)
        _ = await client(transport).listFeedGenerators(source: .suggested, limit: 10)
        let noActor = await client(transport).listFeedGenerators(source: .actor(""))
        XCTAssertNil(noActor)
        XCTAssertEqual(transport.urls, [
            "https://public.api.bsky.app/xrpc/app.bsky.feed.getActorFeeds?limit=50&cursor=c&actor=bsky.app",
            "https://public.api.bsky.app/xrpc/app.bsky.unspecced.getPopularFeedGenerators?limit=25&query=cats",
            "https://public.api.bsky.app/xrpc/app.bsky.unspecced.getPopularFeedGenerators?limit=25",
            "https://public.api.bsky.app/xrpc/app.bsky.unspecced.getSuggestedFeeds?limit=25",
            "https://public.api.bsky.app/xrpc/app.bsky.unspecced.getSuggestedFeeds?limit=10",
        ])
    }

    func testGetFeedGenerators() async {
        let transport = AppViewFakeTransport(body: #"{"feeds":[]}"#)
        let page = await client(transport).getFeedGenerators(["at://did:plc:f/app.bsky.feed.generator/a", "at://did:plc:f/app.bsky.feed.generator/b"])
        XCTAssertEqual(page?.feeds, [])
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.feed.getFeedGenerators?feeds=at%3A%2F%2Fdid%3Aplc%3Af%2Fapp.bsky.feed.generator%2Fa&feeds=at%3A%2F%2Fdid%3Aplc%3Af%2Fapp.bsky.feed.generator%2Fb"])
        let none = await client(transport).getFeedGenerators([])
        XCTAssertNil(none)
    }

    func testGetSocialGraph() async {
        let follows = AppViewFakeTransport(body: #"{"subject":{"did":"did:plc:s","handle":"s.test"},"follows":[{"did":"did:plc:1","handle":"one.test"},{"did":"did:plc:2","handle":"two.test"}],"cursor":"c2"}"#)
        let page = await client(follows).getSocialGraph(actor: "s.test", direction: .follows, limit: 2, cursor: "c1")
        XCTAssertEqual(page?.direction, .follows)
        XCTAssertEqual(page?.subject?.did, "did:plc:s")
        XCTAssertEqual(page?.actors.map { $0.handle }, ["one.test", "two.test"])
        XCTAssertEqual(page?.cursor, "c2")
        XCTAssertEqual(follows.urls, ["https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?actor=s.test&limit=2&cursor=c1"])

        let followers = AppViewFakeTransport(body: #"{"followers":[{"did":"did:plc:3","handle":"three.test"}]}"#)
        let fpage = await client(followers).getSocialGraph(actor: "s.test", direction: .followers)
        XCTAssertEqual(fpage?.direction, .followers)
        XCTAssertEqual(fpage?.actors.map { $0.did }, ["did:plc:3"])
        XCTAssertNil(fpage?.subject)
        XCTAssertEqual(followers.urls, ["https://public.api.bsky.app/xrpc/app.bsky.graph.getFollowers?actor=s.test&limit=50"])

        let none = await client(followers).getSocialGraph(actor: "", direction: .followers)
        XCTAssertNil(none)
    }

    func testGetListAndGetLists() async {
        let transport = AppViewFakeTransport(body: #"{"list":{"uri":"at://did:plc:l/app.bsky.graph.list/x","cid":"c","name":"Friends","purpose":"app.bsky.graph.defs#curatelist","listItemCount":2,"creator":{"did":"did:plc:l","handle":"l.test"}},"items":[{"uri":"at://did:plc:l/app.bsky.graph.listitem/1","subject":{"did":"did:plc:m","handle":"m.test"}},{"uri":"no subject"}],"cursor":"z"}"#)
        let page = await client(transport).getList(list: "at://did:plc:l/app.bsky.graph.list/x", limit: 10)
        XCTAssertEqual(page?.list?.name, "Friends")
        XCTAssertEqual(page?.list?.purpose, "app.bsky.graph.defs#curatelist")
        XCTAssertEqual(page?.list?.listItemCount, 2)
        XCTAssertEqual(page?.list?.creator?.handle, "l.test")
        XCTAssertEqual(page?.items.count, 1)
        XCTAssertEqual(page?.items.first?.subject.handle, "m.test")
        XCTAssertEqual(page?.cursor, "z")
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/app.bsky.graph.getList?list=at%3A%2F%2Fdid%3Aplc%3Al%2Fapp.bsky.graph.list%2Fx&limit=10"])

        let lists = AppViewFakeTransport(body: #"{"lists":[{"uri":"at://did:plc:l/app.bsky.graph.list/x","cid":"c","name":"A"},{"uri":"at://did:plc:l/app.bsky.graph.list/y","cid":"c","name":"B"}]}"#)
        let listsPage = await client(lists).getLists(actor: "l.test")
        XCTAssertEqual(listsPage?.lists.map { $0.name }, ["A", "B"])
        XCTAssertEqual(lists.urls, ["https://public.api.bsky.app/xrpc/app.bsky.graph.getLists?actor=l.test&limit=25"])

        let noList = await client(lists).getList(list: "")
        XCTAssertNil(noList)
        let noActor = await client(lists).getLists(actor: "")
        XCTAssertNil(noActor)
    }

    func testCustomBaseUrl() async {
        let transport = AppViewFakeTransport(body: profileBody)
        let custom = AppViewClient(client: HTTPClient(transport: transport), baseURL: URL(string: "https://appview.example/prefix")!)
        _ = await custom.getProfile("x.test")
        XCTAssertEqual(transport.urls, ["https://appview.example/prefix/xrpc/app.bsky.actor.getProfile?actor=x.test"])
        XCTAssertEqual(custom.xrpcURL("app.bsky.feed.getPosts").absoluteString, "https://appview.example/prefix/xrpc/app.bsky.feed.getPosts")
    }

    // MARK: Live

    /// Distinguishes "the network is not reachable" (skip) from a real
    /// decoding problem (fail) by probing the endpoint with the raw client.
    private func skipUnlessAppViewReachable(_ appView: AppViewClient, _ method: String, query: [(String, String)]) async throws {
        do {
            _ = try await appView.client.getJSONValue(from: appView.xrpcURL(method, query: query))
        } catch let error as HTTPError {
            if error.status == 429 || error.status >= 500 {
                throw XCTSkip("public.api.bsky.app answered \(error.status); nothing to assert on")
            }
            throw error
        } catch {
            throw XCTSkip("network unavailable: \(error)")
        }
    }

    func testLiveGetProfileOfBskyApp() async throws {
        let appView = AppViewClient()
        try await skipUnlessAppViewReachable(appView, "app.bsky.actor.getProfile", query: [("actor", "bsky.app")])
        let profile = await appView.getProfile("bsky.app")
        let decoded = try XCTUnwrap(profile, "bsky.app should decode")
        XCTAssertEqual(decoded.handle, "bsky.app")
        XCTAssertEqual(decoded.did, "did:plc:z72i7hdynmk6r22z27h6tvur")
        XCTAssertNotNil(decoded.displayName)
        XCTAssertNotNil(decoded.avatar)
        XCTAssertGreaterThan(decoded.followersCount ?? 0, 0)
        XCTAssertNotNil(decoded.createdAtDate)
        XCTAssertEqual(decoded.raw["did"]?.stringValue, decoded.did)
    }

    func testLiveGetPostThreadOfARecentBskyAppPost() async throws {
        let appView = AppViewClient()
        try await skipUnlessAppViewReachable(appView, "app.bsky.feed.getAuthorFeed", query: [("actor", "bsky.app"), ("limit", "5")])
        let feed = await appView.getAuthorFeed(actor: "bsky.app", filter: .postsNoReplies, limit: 5)
        let page = try XCTUnwrap(feed, "the author feed should decode")
        let own = try XCTUnwrap(page.items.first { $0.reason == nil }?.post, "expected at least one of bsky.app's own posts")
        XCTAssertEqual(own.author.did, "did:plc:z72i7hdynmk6r22z27h6tvur")
        XCTAssertTrue(own.uri.hasPrefix("at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/"))

        let thread = await appView.getPostThread(own.uri)
        let decoded = try XCTUnwrap(thread, "the thread for \(own.uri) should decode")
        XCTAssertEqual(decoded.post.uri, own.uri)
        XCTAssertEqual(decoded.post.cid, own.cid)
        XCTAssertEqual(decoded.post.author.handle, "bsky.app")
        XCTAssertEqual(decoded.post.record.type, "app.bsky.feed.post")
        XCTAssertNotNil(decoded.post.createdAtDate)
        XCTAssertNotNil(decoded.post.likeCount)
        XCTAssertNil(decoded.parent, "a posts_no_replies item has no parent")
        XCTAssertEqual(decoded.raw["thread"]?["post"]?["uri"]?.stringValue, own.uri)
        // Whatever the post carries, the embed either decoded or is absent;
        // an unknown type is still a decoded value.
        if let raw = decoded.post.raw["embed"], raw.objectValue != nil, raw["$type"]?.stringValue != nil {
            XCTAssertNotNil(decoded.post.embed)
        }
    }
}
