import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Answers by URL substring and, when asked, holds each request for a
/// moment while counting how many are in flight at once.
private final class SlingshotFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, reply: Reply)]
    private let holdNanoseconds: UInt64
    private(set) var urls: [String] = []
    private var inFlight = 0
    private(set) var maxInFlight = 0

    init(_ routes: [(String, Reply)], holdMilliseconds: UInt64 = 0) {
        self.routes = routes.map { (pattern: $0.0, reply: $0.1) }
        self.holdNanoseconds = holdMilliseconds * 1_000_000
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        enter(url)
        if holdNanoseconds > 0 {
            try? await Task.sleep(nanoseconds: holdNanoseconds)
        }
        leave()
        let reply = routes.first { url.absoluteString.contains($0.pattern) }?.reply
            ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
        let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: [:])!
        return (Data(reply.body.utf8), response)
    }

    private func enter(_ url: URL) {
        lock.lock(); defer { lock.unlock() }
        urls.append(url.absoluteString)
        inFlight += 1
        maxInFlight = max(maxInFlight, inFlight)
    }

    private func leave() {
        lock.lock(); defer { lock.unlock() }
        inFlight -= 1
    }

    var requestCount: Int {
        lock.lock(); defer { lock.unlock() }
        return urls.count
    }
}

/// Tracks concurrency for the generic helper without any HTTP involved.
private actor SlingshotConcurrencyMeter {
    private var inFlight = 0
    private(set) var peak = 0
    private(set) var started: [Int] = []

    func enter(_ index: Int) {
        inFlight += 1
        peak = max(peak, inFlight)
        started.append(index)
    }

    func leave() {
        inFlight -= 1
    }
}

private struct SlingshotTestFailure: Error, Equatable {
    let index: Int
}

final class SlingshotClientTests: XCTestCase {
    private func client(_ transport: SlingshotFakeTransport) -> SlingshotClient {
        SlingshotClient(http: HTTPClient(transport: transport))
    }

    // MARK: resolveMiniDoc

    func testResolveMiniDocBuildsTheURLAndDecodes() async {
        let transport = SlingshotFakeTransport([
            ("resolveMiniDoc", .init(status: 200, body: #"{"did":"did:plc:x","handle":"alice.example","pds":"https://pds.example","signing_key":"zQ3sh"}"#)),
        ])
        let doc = await client(transport).resolveMiniDoc("alice.example")
        XCTAssertEqual(transport.urls, ["https://slingshot.microcosm.blue/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=alice.example"])
        XCTAssertEqual(doc, MiniDoc(did: "did:plc:x", handle: "alice.example", pds: "https://pds.example", signingKey: "zQ3sh"))
    }

    func testResolveMiniDocEncodesADIDAndToleratesANullHandle() async {
        let transport = SlingshotFakeTransport([
            ("resolveMiniDoc", .init(status: 200, body: #"{"did":"did:plc:x","handle":null,"pds":"https://pds.example"}"#)),
        ])
        let doc = await client(transport).resolveMiniDoc("did:plc:x")
        XCTAssertEqual(transport.urls, ["https://slingshot.microcosm.blue/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=did%3Aplc%3Ax"])
        XCTAssertEqual(doc?.did, "did:plc:x")
        XCTAssertNil(doc?.handle)
        XCTAssertNil(doc?.signingKey)
    }

    func testResolveMiniDocIsNilWithoutADIDOrOnFailure() async {
        let noDid = SlingshotFakeTransport([("resolveMiniDoc", .init(status: 200, body: #"{"handle":"x.example","pds":"https://pds.example"}"#))])
        let missing = await client(noDid).resolveMiniDoc("x.example")
        XCTAssertNil(missing)

        let emptyDid = SlingshotFakeTransport([("resolveMiniDoc", .init(status: 200, body: #"{"did":"","pds":"https://pds.example"}"#))])
        let blank = await client(emptyDid).resolveMiniDoc("x.example")
        XCTAssertNil(blank)

        let failing = SlingshotFakeTransport([("resolveMiniDoc", .init(status: 400, body: #"{"error":"InvalidRequest"}"#))])
        let failed = await client(failing).resolveMiniDoc("x.example")
        XCTAssertNil(failed)
    }

    func testResolveMiniDocOfAnEmptyIdentifierMakesNoRequest() async {
        let transport = SlingshotFakeTransport([])
        let doc = await client(transport).resolveMiniDoc("")
        XCTAssertNil(doc)
        XCTAssertEqual(transport.requestCount, 0)
    }

    // MARK: getRecordByUri

    func testGetRecordByUriBuildsTheURLAndDecodesTheValue() async {
        let transport = SlingshotFakeTransport([
            ("getRecordByUri", .init(status: 200, body: #"{"uri":"at://did:plc:x/app.bsky.feed.post/3k","cid":"bafyrec","value":{"$type":"app.bsky.feed.post","text":"hi"}}"#)),
        ])
        let record = await client(transport).getRecordByUri("at://did:plc:x/app.bsky.feed.post/3k")
        XCTAssertEqual(transport.urls, ["https://slingshot.microcosm.blue/xrpc/blue.microcosm.repo.getRecordByUri?at_uri=at%3A%2F%2Fdid%3Aplc%3Ax%2Fapp.bsky.feed.post%2F3k"])
        XCTAssertEqual(record?.uri, "at://did:plc:x/app.bsky.feed.post/3k")
        XCTAssertEqual(record?.cid, "bafyrec")
        XCTAssertEqual(record?.value["text"]?.stringValue, "hi")
        XCTAssertEqual(record?.atRecord, AtRecord(uri: "at://did:plc:x/app.bsky.feed.post/3k", cid: "bafyrec", value: ["$type": "app.bsky.feed.post", "text": "hi"]))
    }

    func testGetRecordByUriIsNilWithoutAValue() async {
        let noValue = SlingshotFakeTransport([("getRecordByUri", .init(status: 200, body: #"{"uri":"at://did:plc:x/a.b.c/r","cid":"c"}"#))])
        let missing = await client(noValue).getRecordByUri("at://did:plc:x/a.b.c/r")
        XCTAssertNil(missing)

        let nullValue = SlingshotFakeTransport([("getRecordByUri", .init(status: 200, body: #"{"uri":"at://did:plc:x/a.b.c/r","cid":"c","value":null}"#))])
        let null = await client(nullValue).getRecordByUri("at://did:plc:x/a.b.c/r")
        XCTAssertNil(null)

        let emptyObject = SlingshotFakeTransport([("getRecordByUri", .init(status: 200, body: #"{"uri":"at://did:plc:x/a.b.c/r","cid":"c","value":{}}"#))])
        let empty = await client(emptyObject).getRecordByUri("at://did:plc:x/a.b.c/r")
        XCTAssertEqual(empty?.value, .object([:]), "an empty object is truthy in JavaScript")
    }

    func testGetRecordByUriSwallowsFailuresAndSkipsEmptyInput() async {
        let failing = SlingshotFakeTransport([("getRecordByUri", .init(status: 404, body: #"{"error":"RecordNotFound"}"#))])
        let failed = await client(failing).getRecordByUri("at://did:plc:x/a.b.c/r")
        XCTAssertNil(failed)

        let transport = SlingshotFakeTransport([])
        let none = await client(transport).getRecordByUri("")
        XCTAssertNil(none)
        XCTAssertEqual(transport.requestCount, 0)
    }

    func testFetchedRecordRoundTripsThroughCodable() throws {
        let record = FetchedRecord(uri: "at://did:plc:x/a.b.c/r", cid: "bafy", value: ["n": [1, 2], "s": "x"])
        let data = try JSONEncoder().encode(record)
        XCTAssertEqual(try JSONDecoder().decode(FetchedRecord.self, from: data), record)
    }

    // MARK: mapWithConcurrency

    func testMapWithConcurrencyKeepsInputOrderWhateverFinishesFirst() async throws {
        let items = Array(0..<10)
        let results = try await SlingshotClient.mapWithConcurrency(items, limit: 4) { item, index -> String in
            // Later items finish first, so the result order is not the
            // completion order.
            try? await Task.sleep(nanoseconds: UInt64(10 - item) * 5_000_000)
            return "\(item)@\(index)"
        }
        XCTAssertEqual(results, items.map { "\($0)@\($0)" })
    }

    func testMapWithConcurrencyNeverExceedsTheLimit() async throws {
        let meter = SlingshotConcurrencyMeter()
        let items = Array(0..<20)
        let results = try await SlingshotClient.mapWithConcurrency(items, limit: 3) { item, index -> Int in
            await meter.enter(index)
            try? await Task.sleep(nanoseconds: 20_000_000)
            await meter.leave()
            return item * 2
        }
        XCTAssertEqual(results, items.map { $0 * 2 })
        let peak = await meter.peak
        XCTAssertLessThanOrEqual(peak, 3)
        XCTAssertGreaterThan(peak, 1, "work should overlap")
        let started = await meter.started
        XCTAssertEqual(started.sorted(), items, "every index runs exactly once")
    }

    func testMapWithConcurrencyHandlesEmptyInputAndSmallLimits() async throws {
        let none = try await SlingshotClient.mapWithConcurrency([Int](), limit: 8) { item, _ in item }
        XCTAssertEqual(none, [])

        let meter = SlingshotConcurrencyMeter()
        let serial = try await SlingshotClient.mapWithConcurrency([1, 2, 3], limit: 0) { item, index -> Int in
            await meter.enter(index)
            try? await Task.sleep(nanoseconds: 5_000_000)
            await meter.leave()
            return item
        }
        XCTAssertEqual(serial, [1, 2, 3])
        let peak = await meter.peak
        XCTAssertEqual(peak, 1, "a limit below one runs serially rather than not at all")
    }

    func testMapWithConcurrencyPropagatesTheFirstFailure() async {
        do {
            _ = try await SlingshotClient.mapWithConcurrency([0, 1, 2, 3], limit: 2) { item, index -> Int in
                if item == 1 { throw SlingshotTestFailure(index: index) }
                try? await Task.sleep(nanoseconds: 5_000_000)
                return item
            }
            XCTFail("expected the failure to propagate")
        } catch let failure as SlingshotTestFailure {
            XCTAssertEqual(failure, SlingshotTestFailure(index: 1))
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    // MARK: getRecordsByUris

    private func recordBody(_ rkey: String) -> String {
        #"{"uri":"at://did:plc:x/a.b.c/\#(rkey)","cid":"cid-\#(rkey)","value":{"rkey":"\#(rkey)"}}"#
    }

    func testGetRecordsByUrisKeysByURIDedupesAndDropsFailures() async {
        let transport = SlingshotFakeTransport([
            ("a.b.c%2F1", .init(status: 200, body: recordBody("1"))),
            ("a.b.c%2F2", .init(status: 200, body: recordBody("2"))),
            ("a.b.c%2F3", .init(status: 404, body: #"{"error":"RecordNotFound"}"#)),
        ])
        let records = await client(transport).getRecordsByUris([
            "at://did:plc:x/a.b.c/1", "", "at://did:plc:x/a.b.c/2", "at://did:plc:x/a.b.c/1", "at://did:plc:x/a.b.c/3",
        ])
        XCTAssertEqual(Set(records.keys), ["at://did:plc:x/a.b.c/1", "at://did:plc:x/a.b.c/2"])
        XCTAssertEqual(records["at://did:plc:x/a.b.c/2"]?.cid, "cid-2")
        XCTAssertEqual(transport.requestCount, 3, "duplicates and empty strings are never fetched")
    }

    func testGetRecordsByUrisRunsAtMostEightAtOnce() async {
        let uris = (0..<24).map { "at://did:plc:x/a.b.c/\($0)" }
        let routes = (0..<24).map { ("a.b.c%2F\($0)", SlingshotFakeTransport.Reply(status: 200, body: recordBody("\($0)"))) }
        let transport = SlingshotFakeTransport(routes, holdMilliseconds: 20)
        let records = await client(transport).getRecordsByUris(uris)
        XCTAssertEqual(records.count, 24)
        XCTAssertLessThanOrEqual(transport.maxInFlight, 8)
        XCTAssertGreaterThan(transport.maxInFlight, 1)
        XCTAssertEqual(SlingshotClient.defaultConcurrency, 8)
    }

    func testGetRecordsByUrisHonoursACustomConcurrency() async {
        let uris = (0..<6).map { "at://did:plc:x/a.b.c/\($0)" }
        let routes = (0..<6).map { ("a.b.c%2F\($0)", SlingshotFakeTransport.Reply(status: 200, body: recordBody("\($0)"))) }
        let transport = SlingshotFakeTransport(routes, holdMilliseconds: 20)
        let records = await client(transport).getRecordsByUris(uris, concurrency: 2)
        XCTAssertEqual(records.count, 6)
        XCTAssertLessThanOrEqual(transport.maxInFlight, 2)
    }

    func testGetRecordsByUrisWithNothingToFetchIsEmpty() async {
        let transport = SlingshotFakeTransport([])
        let records = await client(transport).getRecordsByUris(["", ""])
        XCTAssertEqual(records, [:])
        XCTAssertEqual(transport.requestCount, 0)
    }
}
