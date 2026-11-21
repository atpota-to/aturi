import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport: a route matches when every one of its
/// fragments appears in the URL; the first match wins, the rest 404.
final class SchemaLookupFakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
    }

    private let lock = NSLock()
    private let routes: [(patterns: [String], reply: Reply)]
    private var recorded: [String] = []

    init(_ routes: [([String], Reply)]) {
        self.routes = routes.map { (patterns: $0.0, reply: $0.1) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        let reply = route(for: url.absoluteString)
        let response = HTTPURLResponse(
            url: url, statusCode: reply.status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (Data(reply.body.utf8), response)
    }

    private func route(for url: String) -> Reply {
        lock.lock(); defer { lock.unlock() }
        recorded.append(url)
        return routes.first { $0.patterns.allSatisfy(url.contains) }?.reply
            ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
    }

    func count(containing fragment: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        return recorded.filter { $0.contains(fragment) }.count
    }

    var total: Int {
        lock.lock(); defer { lock.unlock() }
        return recorded.count
    }
}

/// A clock the test moves by hand.
private final class SchemaLookupClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current = Date(timeIntervalSince1970: 1_800_000_000)

    var now: Date {
        lock.lock(); defer { lock.unlock() }
        return current
    }

    func advance(_ seconds: TimeInterval) {
        lock.lock(); defer { lock.unlock() }
        current = current.addingTimeInterval(seconds)
    }
}

/// Bodies the lookup tests (and the validator's run tests) share.
enum SchemaLookupFixtures {
    static let nsid = "com.example.blog.post"
    static let did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"
    static let pds = "https://pds.example.com"

    static func dnsFound(_ did: String) -> String {
        #"{"Status":0,"Answer":[{"name":"_lexicon.x","type":16,"data":"\"did=\#(did)\""}]}"#
    }

    static let dnsNone = #"{"Status":3}"#

    static func miniDoc(_ did: String, handle: String = "example.com", pds: String = SchemaLookupFixtures.pds) -> String {
        #"{"did":"\#(did)","handle":"\#(handle)","pds":"\#(pds)"}"#
    }

    static func record(_ nsid: String, did: String = SchemaLookupFixtures.did, doc: String) -> String {
        #"{"uri":"at://\#(did)/com.atproto.lexicon.schema/\#(nsid)","cid":"bafyreia","value":\#(doc)}"#
    }

    static func lexicon(_ id: String, defs: String) -> String {
        #"{"$type":"com.atproto.lexicon.schema","lexicon":1,"id":"\#(id)","defs":\#(defs)}"#
    }

    static let postDoc = lexicon(nsid, defs: #"{"main":{"type":"record","key":"tid","record":{"type":"object","required":["text"],"properties":{"text":{"type":"string","maxLength":10}}}}}"#)
}

final class LexiconSchemaLookupTests: XCTestCase {
    private typealias F = SchemaLookupFixtures

    private func makeLookup(_ transport: SchemaLookupFakeTransport, clock: SchemaLookupClock = SchemaLookupClock()) -> LexiconSchemaLookup {
        LexiconSchemaLookup(http: HTTPClient(transport: transport), clock: { clock.now })
    }

    func testPureHelpers() {
        XCTAssertEqual(LexiconSchemaLookup.authorityDomain("com.atmoboards.forum"), "atmoboards.com")
        XCTAssertEqual(LexiconSchemaLookup.authorityDomain("app.bsky.feed.post"), "feed.bsky.app")
        XCTAssertNil(LexiconSchemaLookup.authorityDomain("bsky.app"))
        XCTAssertEqual(LexiconSchemaLookup.didFromLexiconRecords(["v=spf1 -all", "did=did:plc:abc"]), "did:plc:abc")
        XCTAssertNil(LexiconSchemaLookup.didFromLexiconRecords(["did = did:plc:abc"]), "the record must read exactly did=<did>")
        XCTAssertNil(LexiconSchemaLookup.didFromLexiconRecords(["did=did:plc:abc; extra"]))
        XCTAssertEqual(
            LexiconSchemaLookup.schemaRecordUri(did: F.did, nsid: F.nsid),
            "at://\(F.did)/com.atproto.lexicon.schema/\(F.nsid)"
        )
    }

    func testFoundThroughTheDNSRecordAndSlingshot() async {
        let transport = SchemaLookupFakeTransport([
            (["dns.google", "_lexicon.blog.example.com"], .init(status: 200, body: F.dnsFound(F.did))),
            (["getRecordByUri", F.nsid], .init(status: 200, body: F.record(F.nsid, doc: F.postDoc))),
        ])
        let answer = await makeLookup(transport).lookup(F.nsid)
        XCTAssertEqual(answer.status, .found)
        XCTAssertEqual(answer.authority, LexiconSchemaLookup.Authority(did: F.did, via: .dns))
        XCTAssertEqual(answer.doc?["id"]?.stringValue, F.nsid)
        if case .found(_, _, let uri, let cid, _) = answer {
            XCTAssertEqual(uri, "at://\(F.did)/com.atproto.lexicon.schema/\(F.nsid)")
            XCTAssertEqual(cid, "bafyreia")
        } else {
            XCTFail("expected a found answer")
        }
        XCTAssertEqual(transport.count(containing: "resolveMiniDoc"), 0, "the DNS record is enough")
    }

    func testFallsBackToTheHandleAndThenTheAuthoritysPDS() async {
        let transport = SchemaLookupFakeTransport([
            (["dns.google"], .init(status: 200, body: F.dnsNone)),
            // `com.example.blog.post` reverses to the handle example.com.
            (["resolveMiniDoc", "identifier=example.com"], .init(status: 200, body: F.miniDoc(F.did))),
            (["resolveMiniDoc", "identifier=did"], .init(status: 200, body: F.miniDoc(F.did))),
            // Slingshot has never been asked for it.
            (["getRecordByUri"], .init(status: 404, body: #"{"error":"RecordNotFound"}"#)),
            (["pds.example.com", "com.atproto.repo.getRecord", "rkey=\(F.nsid)"], .init(status: 200, body: F.record(F.nsid, doc: F.postDoc))),
        ])
        let answer = await makeLookup(transport).lookup(F.nsid)
        XCTAssertEqual(answer.status, .found)
        XCTAssertEqual(answer.authority?.via, .handle)
        XCTAssertEqual(transport.count(containing: "pds.example.com"), 1)
    }

    func testNobodyAnswersForTheNamespace() async {
        let transport = SchemaLookupFakeTransport([
            (["dns.google"], .init(status: 200, body: F.dnsNone)),
        ])
        let answer = await makeLookup(transport).lookup(F.nsid)
        XCTAssertEqual(answer, .noAuthority(nsid: F.nsid, domain: "blog.example.com", publisher: "example.com"))
        XCTAssertEqual(
            RecordValidator.noSchemaReason(answer),
            "Nobody answers for this namespace: there is no _lexicon record on blog.example.com, and no account at example.com."
        )
    }

    func testAnOwnerWithNoSchemaRecordIsUnpublished() async {
        let transport = SchemaLookupFakeTransport([
            (["dns.google"], .init(status: 200, body: F.dnsFound(F.did))),
            (["getRecordByUri"], .init(status: 404, body: #"{"error":"RecordNotFound"}"#)),
            (["resolveMiniDoc"], .init(status: 200, body: F.miniDoc(F.did))),
            (["com.atproto.repo.getRecord"], .init(status: 400, body: #"{"error":"RecordNotFound"}"#)),
        ])
        let answer = await makeLookup(transport).lookup(F.nsid)
        XCTAssertEqual(answer, .unpublished(nsid: F.nsid, authority: .init(did: F.did, via: .dns)))
    }

    func testSomethingThatIsNotAnNSIDAsksNobody() async {
        let transport = SchemaLookupFakeTransport([])
        let answer = await makeLookup(transport).lookup("bsky.app")
        XCTAssertEqual(answer, .invalid(nsid: "bsky.app"))
        XCTAssertEqual(transport.total, 0)
    }

    func testAFoundSchemaIsKeptAnHourAndAMissOnlyFiveMinutes() async {
        let clock = SchemaLookupClock()
        let transport = SchemaLookupFakeTransport([
            (["dns.google", "_lexicon.blog.example.com"], .init(status: 200, body: F.dnsFound(F.did))),
            (["getRecordByUri", F.nsid], .init(status: 200, body: F.record(F.nsid, doc: F.postDoc))),
            (["dns.google", "_lexicon.missing.example.com"], .init(status: 200, body: F.dnsNone)),
        ])
        let lookup = makeLookup(transport, clock: clock)

        _ = await lookup.lookup(F.nsid)
        _ = await lookup.lookup("com.example.missing.thing")
        let cached = await lookup.cached(F.nsid)
        XCTAssertEqual(cached?.status, .found)
        XCTAssertEqual(transport.count(containing: "_lexicon.blog.example.com"), 1)

        clock.advance(6 * 60)
        _ = await lookup.lookup(F.nsid)
        _ = await lookup.lookup("com.example.missing.thing")
        XCTAssertEqual(transport.count(containing: "_lexicon.blog.example.com"), 1, "found is kept an hour")
        XCTAssertEqual(transport.count(containing: "_lexicon.missing.example.com"), 2, "a miss is asked again after five minutes")

        clock.advance(60 * 60)
        _ = await lookup.lookup(F.nsid)
        XCTAssertEqual(transport.count(containing: "_lexicon.blog.example.com"), 2)
    }

    func testConcurrentCallersShareOneLookup() async {
        let transport = SchemaLookupFakeTransport([
            (["dns.google"], .init(status: 200, body: F.dnsFound(F.did))),
            (["getRecordByUri", F.nsid], .init(status: 200, body: F.record(F.nsid, doc: F.postDoc))),
        ])
        let lookup = makeLookup(transport)
        async let first = lookup.lookup(F.nsid)
        async let second = lookup.lookup(F.nsid)
        let one = await first
        let two = await second
        XCTAssertEqual([one.status, two.status], [.found, .found])
        XCTAssertEqual(transport.count(containing: "dns.google"), 1)
    }
}
