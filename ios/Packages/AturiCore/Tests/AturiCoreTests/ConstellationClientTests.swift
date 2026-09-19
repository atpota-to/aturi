import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Routed by URL substring, first match wins, anything else 404. Records
/// every request URL in order.
private final class ConstellationFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, reply: Reply)]
    private(set) var urls: [String] = []

    init(_ routes: [(String, Reply)]) {
        self.routes = routes.map { (pattern: $0.0, reply: $0.1) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        record(url)
        let reply = routes.first { url.absoluteString.contains($0.pattern) }?.reply
            ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
        let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: [:])!
        return (Data(reply.body.utf8), response)
    }

    /// Locking stays in a synchronous helper: NSLock is not async-safe.
    private func record(_ url: URL) {
        lock.lock(); defer { lock.unlock() }
        urls.append(url.absoluteString)
    }

    var requestCount: Int {
        lock.lock(); defer { lock.unlock() }
        return urls.count
    }
}

final class ConstellationClientTests: XCTestCase {
    private func client(_ transport: ConstellationFakeTransport) -> ConstellationClient {
        ConstellationClient(http: HTTPClient(transport: transport))
    }

    private func parse(_ json: String) throws -> BacklinkSourcesResponse {
        try JSONDecoder().decode(BacklinkSourcesResponse.self, from: Data(json.utf8))
    }

    // MARK: flattenSources

    func testFlattenSourcesStripsTheLeadingDotExceptForRootPaths() throws {
        let raw = try parse("""
        {"links":{
          "app.bsky.graph.follow":{".subject":{"records":12,"distinct_dids":11}},
          "sh.tangled.graph.vouch":{".":{"records":3,"distinct_dids":3}},
          "app.bsky.feed.like":{".subject.uri":{"records":40,"distinct_dids":39}}
        }}
        """)
        let sources = try XCTUnwrap(ConstellationClient.flattenSources(raw))
        XCTAssertEqual(sources.map(\.source), [
            "app.bsky.feed.like:subject.uri",
            "app.bsky.graph.follow:subject",
            "sh.tangled.graph.vouch:.",
        ])
        XCTAssertEqual(sources.map(\.path), [".subject.uri", ".subject", "."])
        XCTAssertEqual(sources.map(\.count), [40, 12, 3])
        XCTAssertEqual(sources.map(\.distinctDids), [39, 11, 3])
        XCTAssertEqual(sources[2].collection, "sh.tangled.graph.vouch")
    }

    func testFlattenSourcesAcceptsTheBareMapShape() throws {
        let raw = try parse(#"{"app.bsky.feed.repost":{".subject.uri":{"count":7,"distinctDids":5}}}"#)
        let sources = try XCTUnwrap(ConstellationClient.flattenSources(raw))
        XCTAssertEqual(sources, [
            BacklinkSource(collection: "app.bsky.feed.repost", path: ".subject.uri", source: "app.bsky.feed.repost:subject.uri", count: 7, distinctDids: 5),
        ])
    }

    func testFlattenSourcesPrefersRecordsOverCountAndDefaultsToZero() throws {
        let raw = try parse("""
        {"links":{
          "a.b.c":{".x":{"records":2,"count":9}},
          "d.e.f":{".y":{"count":4}},
          "g.h.i":{".z":{}},
          "j.k.l":{".w":null}
        }}
        """)
        let sources = try XCTUnwrap(ConstellationClient.flattenSources(raw))
        XCTAssertEqual(sources.map(\.source), ["d.e.f:y", "a.b.c:x", "g.h.i:z", "j.k.l:w"])
        XCTAssertEqual(sources.map(\.count), [4, 2, 0, 0])
        XCTAssertEqual(sources.map(\.distinctDids), [nil, nil, nil, nil])
    }

    func testFlattenSourcesSkipsCollectionsWhoseValueIsNotAnObject() throws {
        let raw = try parse(#"{"links":{"a.b.c":"nope","d.e.f":5,"g.h.i":{".p":{"records":1}}}}"#)
        let sources = try XCTUnwrap(ConstellationClient.flattenSources(raw))
        XCTAssertEqual(sources.map(\.source), ["g.h.i:p"])
    }

    func testFlattenSourcesSortsByCountDescendingThenBySourceName() throws {
        let raw = try parse(#"{"links":{"z.z.z":{".a":{"records":5}},"a.a.a":{".b":{"records":5},".c":{"records":50}}}}"#)
        let sources = try XCTUnwrap(ConstellationClient.flattenSources(raw))
        XCTAssertEqual(sources.map(\.source), ["a.a.a:c", "a.a.a:b", "z.z.z:a"])
    }

    func testFlattenSourcesOfNilIsNilAndOfEmptyIsEmpty() throws {
        XCTAssertNil(ConstellationClient.flattenSources(nil))
        XCTAssertEqual(ConstellationClient.flattenSources(try parse("{}")), [])
        XCTAssertEqual(ConstellationClient.flattenSources(try parse(#"{"links":{}}"#)), [])
    }

    func testANullLinksMemberFallsBackToTheWholeDocument() throws {
        // `raw.links || raw` with a null `links`: the document itself is the
        // map, and its `links` entry is skipped for not being an object.
        let raw = try parse(#"{"links":null,"a.b.c":{".s":{"records":1}}}"#)
        XCTAssertEqual(ConstellationClient.flattenSources(raw)?.map(\.source), ["a.b.c:s"])
    }

    func testSourcesResponseRoundTripsThroughCodable() throws {
        let raw = try parse(#"{"links":{"a.b.c":{".s":{"records":1,"distinct_dids":1}}}}"#)
        let data = try JSONEncoder().encode(raw)
        XCTAssertEqual(try JSONDecoder().decode(BacklinkSourcesResponse.self, from: data), raw)
    }

    // MARK: backlinks page normalisation

    func testBacklinksPageReadsRecordsOrLinkingRecords() throws {
        let records = try JSONDecoder().decode(BacklinksPage.self, from: Data(#"{"records":[{"did":"did:plc:a","collection":"x.y.z","rkey":"1"}],"cursor":"c1"}"#.utf8))
        XCTAssertEqual(records.backlinks, [BacklinkRecord(did: "did:plc:a", collection: "x.y.z", rkey: "1")])
        XCTAssertEqual(records.cursor, "c1")

        let linking = try JSONDecoder().decode(BacklinksPage.self, from: Data(#"{"linking_records":[{"did":"did:plc:b","collection":"x.y.z","rkey":"2"}]}"#.utf8))
        XCTAssertEqual(linking.backlinks.map(\.rkey), ["2"])
        XCTAssertNil(linking.records)
        XCTAssertNil(linking.cursor)

        let neither = try JSONDecoder().decode(BacklinksPage.self, from: Data(#"{"cursor":null}"#.utf8))
        XCTAssertEqual(neither.backlinks, [])
        XCTAssertEqual(ConstellationClient.backlinks(from: nil), [])
        XCTAssertEqual(ConstellationClient.backlinks(from: records).count, 1)
    }

    func testRecordsWinOverLinkingRecordsWhenBothArePresent() throws {
        let page = try JSONDecoder().decode(BacklinksPage.self, from: Data(#"{"records":[],"linking_records":[{"did":"d","collection":"c","rkey":"r"}]}"#.utf8))
        XCTAssertEqual(page.backlinks, [])
    }

    func testBacklinkRecordAtUri() {
        XCTAssertEqual(BacklinkRecord(did: "did:plc:a", collection: "app.bsky.feed.like", rkey: "3k").atUri, "at://did:plc:a/app.bsky.feed.like/3k")
    }

    // MARK: getBacklinkSources

    func testGetBacklinkSourcesBuildsTheURLAndDecodes() async throws {
        let transport = ConstellationFakeTransport([
            ("/links/all", .init(status: 200, body: #"{"links":{"app.bsky.graph.follow":{".subject":{"records":2,"distinct_dids":2}}}}"#)),
        ])
        let raw = await client(transport).getBacklinkSources(target: "at://did:plc:x/a.b.c/r")
        XCTAssertEqual(transport.urls, ["https://constellation.microcosm.blue/links/all?target=at%3A%2F%2Fdid%3Aplc%3Ax%2Fa.b.c%2Fr"])
        XCTAssertEqual(raw?.links["app.bsky.graph.follow"]?[".subject"]?.effectiveCount, 2)
    }

    func testGetBacklinkSourcesOfAnEmptyTargetMakesNoRequest() async {
        let transport = ConstellationFakeTransport([])
        let raw = await client(transport).getBacklinkSources(target: "")
        XCTAssertNil(raw)
        XCTAssertEqual(transport.requestCount, 0)
    }

    func testGetBacklinkSourcesSwallowsFailures() async {
        let transport = ConstellationFakeTransport([("/links/all", .init(status: 503, body: "down"))])
        let raw = await client(transport).getBacklinkSources(target: "did:plc:x")
        XCTAssertNil(raw)
        XCTAssertNil(ConstellationClient.flattenSources(raw))

        let garbage = ConstellationFakeTransport([("/links/all", .init(status: 200, body: "not json"))])
        let none = await client(garbage).getBacklinkSources(target: "did:plc:x")
        XCTAssertNil(none)
    }

    func testSourcesForTargetFlattensInOneCall() async {
        let transport = ConstellationFakeTransport([
            ("/links/all", .init(status: 200, body: #"{"links":{"a.b.c":{".s":{"records":1}}}}"#)),
        ])
        let sources = await client(transport).sources(for: "did:plc:x")
        XCTAssertEqual(sources?.map(\.source), ["a.b.c:s"])

        let empty = ConstellationFakeTransport([("/links/all", .init(status: 200, body: #"{"links":{}}"#))])
        let none = await client(empty).sources(for: "did:plc:x")
        XCTAssertEqual(none, [])
    }

    // MARK: getBacklinks

    func testGetBacklinksBuildsTheURLWithDefaultsAndDecodes() async {
        let transport = ConstellationFakeTransport([
            ("getBacklinks", .init(status: 200, body: #"{"records":[{"did":"did:plc:a","collection":"app.bsky.graph.follow","rkey":"1"}],"cursor":"next"}"#)),
        ])
        let page = await client(transport).getBacklinks(target: "did:plc:x", source: "app.bsky.graph.follow:subject")
        XCTAssertEqual(transport.urls, [
            "https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks?subject=did%3Aplc%3Ax&source=app.bsky.graph.follow%3Asubject&limit=25",
        ])
        XCTAssertEqual(page?.backlinks.map(\.did), ["did:plc:a"])
        XCTAssertEqual(page?.cursor, "next")
    }

    func testGetBacklinksAppendsLimitAndCursor() async {
        let transport = ConstellationFakeTransport([("getBacklinks", .init(status: 200, body: #"{"linking_records":[]}"#))])
        let page = await client(transport).getBacklinks(target: "did:plc:x", source: "sh.tangled.graph.vouch:.", limit: 10, cursor: "abc")
        XCTAssertEqual(transport.urls, [
            "https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks?subject=did%3Aplc%3Ax&source=sh.tangled.graph.vouch%3A.&limit=10&cursor=abc",
        ])
        XCTAssertEqual(page?.backlinks, [])
    }

    func testGetBacklinksRequiresBothTargetAndSource() async {
        let transport = ConstellationFakeTransport([])
        let c = client(transport)
        let noTarget = await c.getBacklinks(target: "", source: "a.b.c:s")
        let noSource = await c.getBacklinks(target: "did:plc:x", source: "")
        XCTAssertNil(noTarget)
        XCTAssertNil(noSource)
        XCTAssertEqual(transport.requestCount, 0)
    }

    func testGetBacklinksSwallowsA500() async {
        let transport = ConstellationFakeTransport([("getBacklinks", .init(status: 500, body: "boom"))])
        let page = await client(transport).getBacklinks(target: "did:plc:x", source: "a.b.c:s")
        XCTAssertNil(page)
    }

    // MARK: getAllBacklinks

    func testGetAllBacklinksFollowsTheCursorAndStopsWhenItEnds() async {
        let transport = ConstellationFakeTransport([
            ("cursor=p2", .init(status: 200, body: #"{"records":[{"did":"did:plc:c","collection":"x.y.z","rkey":"3"}]}"#)),
            ("getBacklinks", .init(status: 200, body: #"{"records":[{"did":"did:plc:a","collection":"x.y.z","rkey":"1"},{"did":"did:plc:b","collection":"x.y.z","rkey":"2"}],"cursor":"p2"}"#)),
        ])
        let all = await client(transport).getAllBacklinks(target: "did:plc:x", source: "x.y.z:s")
        XCTAssertEqual(all?.map(\.rkey), ["1", "2", "3"])
        XCTAssertEqual(transport.urls, [
            "https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks?subject=did%3Aplc%3Ax&source=x.y.z%3As&limit=100",
            "https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks?subject=did%3Aplc%3Ax&source=x.y.z%3As&limit=100&cursor=p2",
        ])
    }

    func testGetAllBacklinksCapsAtMaxAndShrinksTheLastPage() async {
        let transport = ConstellationFakeTransport([
            ("cursor=p2", .init(status: 200, body: #"{"records":[{"did":"did:plc:c","collection":"x.y.z","rkey":"3"}],"cursor":"p3"}"#)),
            ("getBacklinks", .init(status: 200, body: #"{"records":[{"did":"did:plc:a","collection":"x.y.z","rkey":"1"},{"did":"did:plc:b","collection":"x.y.z","rkey":"2"}],"cursor":"p2"}"#)),
        ])
        let all = await client(transport).getAllBacklinks(target: "did:plc:x", source: "x.y.z:s", max: 3)
        XCTAssertEqual(all?.count, 3)
        XCTAssertEqual(transport.urls.count, 2)
        XCTAssertTrue(transport.urls[0].hasSuffix("limit=3"))
        XCTAssertTrue(transport.urls[1].hasSuffix("limit=1&cursor=p2"))
    }

    func testGetAllBacklinksPassesReverseAndRepeatsDid() async {
        let transport = ConstellationFakeTransport([("getBacklinks", .init(status: 200, body: #"{"records":[]}"#))])
        _ = await client(transport).getAllBacklinks(target: "did:plc:x", source: "x.y.z:s", max: 50, reverse: true, dids: ["did:plc:a", "did:plc:b"])
        XCTAssertEqual(transport.urls, [
            "https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks?subject=did%3Aplc%3Ax&source=x.y.z%3As&limit=50&reverse=true&did=did%3Aplc%3Aa&did=did%3Aplc%3Ab",
        ])
    }

    func testGetAllBacklinksIsNilOnFirstPageFailureAndPartialOnLater() async {
        let firstFails = ConstellationFakeTransport([("getBacklinks", .init(status: 502, body: ""))])
        let none = await client(firstFails).getAllBacklinks(target: "did:plc:x", source: "x.y.z:s")
        XCTAssertNil(none)

        let laterFails = ConstellationFakeTransport([
            ("cursor=p2", .init(status: 502, body: "")),
            ("getBacklinks", .init(status: 200, body: #"{"records":[{"did":"did:plc:a","collection":"x.y.z","rkey":"1"}],"cursor":"p2"}"#)),
        ])
        let partial = await client(laterFails).getAllBacklinks(target: "did:plc:x", source: "x.y.z:s")
        XCTAssertEqual(partial?.map(\.rkey), ["1"])
    }

    func testGetAllBacklinksStopsOnAnEmptyPageEvenWithACursor() async {
        let transport = ConstellationFakeTransport([("getBacklinks", .init(status: 200, body: #"{"records":[],"cursor":"loop"}"#))])
        let all = await client(transport).getAllBacklinks(target: "did:plc:x", source: "x.y.z:s")
        XCTAssertEqual(all, [])
        XCTAssertEqual(transport.requestCount, 1)
    }

    func testGetAllBacklinksWithZeroMaxAsksNothing() async {
        let transport = ConstellationFakeTransport([])
        let all = await client(transport).getAllBacklinks(target: "did:plc:x", source: "x.y.z:s", max: 0)
        XCTAssertEqual(all, [])
        XCTAssertEqual(transport.requestCount, 0)
    }

    // MARK: getManyToMany

    func testGetManyToManyPagesItems() async {
        let transport = ConstellationFakeTransport([
            ("cursor=m2", .init(status: 200, body: #"{"items":[{"linkRecord":{"did":"did:plc:b","collection":"app.userinput.pin","rkey":"2"},"otherSubject":"at://did:plc:t/x.y.z/2"}],"cursor":null}"#)),
            ("getManyToMany", .init(status: 200, body: #"{"items":[{"linkRecord":{"did":"did:plc:a","collection":"app.userinput.pin","rkey":"1"},"otherSubject":"at://did:plc:t/x.y.z/1"}],"cursor":"m2"}"#)),
        ])
        let items = await client(transport).getManyToMany(target: "at://did:plc:s/space/1", source: "app.userinput.pin:space.uri", pathToOther: "subject.uri")
        XCTAssertEqual(items?.map(\.otherSubject), ["at://did:plc:t/x.y.z/1", "at://did:plc:t/x.y.z/2"])
        XCTAssertEqual(items?.first?.linkRecord.rkey, "1")
        XCTAssertEqual(transport.urls.first, "https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getManyToMany?subject=at%3A%2F%2Fdid%3Aplc%3As%2Fspace%2F1&source=app.userinput.pin%3Aspace.uri&pathToOther=subject.uri&limit=100")
        XCTAssertTrue(transport.urls[1].hasSuffix("&cursor=m2"))
    }

    func testGetManyToManyRequiresEveryArgument() async {
        let transport = ConstellationFakeTransport([])
        let missing = await client(transport).getManyToMany(target: "t", source: "s", pathToOther: "")
        XCTAssertNil(missing)
        XCTAssertEqual(transport.requestCount, 0)
    }

    // MARK: counts and totals

    func testGetBacklinkCountsIsKeyedBySource() async {
        let transport = ConstellationFakeTransport([
            ("/links/all", .init(status: 200, body: #"{"links":{"app.bsky.feed.like":{".subject.uri":{"records":9,"distinct_dids":8}},"app.bsky.feed.repost":{".subject.uri":{"records":1}}}}"#)),
        ])
        let counts = await client(transport).getBacklinkCounts(target: "at://did:plc:x/app.bsky.feed.post/1")
        XCTAssertEqual(counts?["app.bsky.feed.like:subject.uri"]?.count, 9)
        XCTAssertEqual(counts?["app.bsky.feed.repost:subject.uri"]?.distinctDids, nil)
        XCTAssertEqual(counts?.count, 2)

        let failing = ConstellationFakeTransport([("/links/all", .init(status: 500, body: ""))])
        let none = await client(failing).getBacklinkCounts(target: "did:plc:x")
        XCTAssertNil(none)
    }

    func testTotalsSumCountsAndOnlyReportAccountsWhenKnown() {
        let withAccounts = ConstellationClient.totals(of: [
            BacklinkSource(collection: "a", path: ".s", source: "a:s", count: 10, distinctDids: 4),
            BacklinkSource(collection: "b", path: ".s", source: "b:s", count: 5, distinctDids: nil),
        ])
        XCTAssertEqual(withAccounts, BacklinkTotals(records: 15, accounts: 4, sources: 2))

        let withoutAccounts = ConstellationClient.totals(of: [
            BacklinkSource(collection: "a", path: ".s", source: "a:s", count: 3, distinctDids: nil),
        ])
        XCTAssertEqual(withoutAccounts, BacklinkTotals(records: 3, accounts: nil, sources: 1))
        XCTAssertEqual(ConstellationClient.totals(of: []), BacklinkTotals(records: 0, accounts: nil, sources: 0))
    }

    // MARK: live

    func testLiveBacklinkSourcesForBskyAppTeamAccount() async throws {
        let did = "did:plc:z72i7hdynmk6r22z27h6tvur"
        let raw = await ConstellationClient().getBacklinkSources(target: did)
        guard let raw else {
            // The client swallows every failure; ask the transport directly
            // to tell an outage or an unreachable network from a bad decode.
            let url = makeURL(Endpoints.constellation, path: "/links/all", query: [("target", did)])
            do {
                _ = try await HTTPClient.shared.get(url)
            } catch let error as HTTPError {
                if error.status == 429 || error.status >= 500 {
                    throw XCTSkip("constellation answered \(error.status)")
                }
                XCTFail("constellation answered \(error.status): \(error.body.prefix(200))")
                return
            } catch {
                throw XCTSkip("network unavailable: \(error)")
            }
            XCTFail("constellation answered 2xx but the payload did not decode")
            return
        }
        let sources = try XCTUnwrap(ConstellationClient.flattenSources(raw))
        XCTAssertFalse(sources.isEmpty, "the bsky.app account has inbound follows")
        XCTAssertTrue(sources.contains { $0.source == "app.bsky.graph.follow:subject" }, "\(sources.prefix(5))")
        XCTAssertTrue(sources.allSatisfy { $0.count >= 0 })
        XCTAssertEqual(sources, sources.sorted { $0.count > $1.count || ($0.count == $1.count && $0.source < $1.source) })
    }
}
