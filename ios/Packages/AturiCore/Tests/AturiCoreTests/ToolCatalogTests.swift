import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The tool catalog is a hand port of `src/lib/tools/catalog.ts`; the drift
/// test reads the web file from the checkout, as `CatalogDriftTests` reads
/// the waypoint catalog, and skips outside the repository.
final class ToolCatalogTests: XCTestCase {
    private var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // AturiCoreTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // AturiCore
            .deletingLastPathComponent() // Packages
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // repo root
    }

    func testSlugsMatchTheWebCatalogInOrder() throws {
        let file = repoRoot.appendingPathComponent("src/lib/tools/catalog.ts")
        guard let source = try? String(contentsOf: file, encoding: .utf8) else {
            throw XCTSkip("web tool catalog not available at \(file.path)")
        }
        let web = source.matches(of: #/slug: '([^']+)'/#).map { String($0.1) }
        XCTAssertFalse(web.isEmpty)
        XCTAssertEqual(ToolCatalog.tools.map(\.slug), web, "ToolCatalog.tools must list the web's tools in the web's order")
    }

    func testGroupsAndLookups() {
        XCTAssertEqual(ToolCatalog.groups.map(\.id), ToolGroupID.allCases)
        XCTAssertEqual(ToolCatalog.tool("handle")?.title, "Handle debugger")
        XCTAssertEqual(ToolCatalog.tool("handle")?.path, "/tools/handle")
        XCTAssertNil(ToolCatalog.tool("nope"))
        XCTAssertEqual(Set(ToolCatalog.tools.map(\.slug)).count, ToolCatalog.tools.count, "slugs are unique")

        let grouped = ToolCatalog.byGroup()
        XCTAssertEqual(grouped.map(\.group.id), [.network, .identity, .accounts, .records, .services])
        XCTAssertEqual(grouped.first?.tools.map(\.slug), ["stream", "xrpc", "relay"])
        XCTAssertEqual(grouped.flatMap(\.tools).count, ToolCatalog.tools.count)
    }

    // Port of src/lib/tools/__tests__/recordLinks.test.ts.

    func testRecordLinksGoToTheToolForThatKindOfRecord() {
        let did = "did:plc:z72i7hdynmk6r22z27h6tvur"
        let post = ToolLinks.forRecord(collection: "app.bsky.feed.post", atUri: "at://\(did)/app.bsky.feed.post/3n22yg6lg2k2f", rkey: "3n22yg6lg2k2f")
        XCTAssertEqual(post.map(\.slug), ["post"])
        XCTAssertEqual(post.first?.query["post"], "at://\(did)/app.bsky.feed.post/3n22yg6lg2k2f")

        let feed = ToolLinks.forRecord(collection: "app.bsky.feed.generator", atUri: "at://\(did)/app.bsky.feed.generator/whats-hot", rkey: "whats-hot")
        XCTAssertEqual(feed.map(\.slug), ["feed"])

        let schema = ToolLinks.forRecord(collection: "com.atproto.lexicon.schema", atUri: "at://\(did)/com.atproto.lexicon.schema/app.bsky.feed.post", rkey: "app.bsky.feed.post")
        XCTAssertEqual(schema.first?.query["nsid"], "app.bsky.feed.post", "a schema record's key is the NSID it defines")

        XCTAssertEqual(ToolLinks.forRecord(collection: "app.bsky.feed.like", atUri: "at://\(did)/app.bsky.feed.like/3k", rkey: "3k"), [])
    }

    func testAccountLinksCarryTheDidAndNameCatalogTools() {
        let did = "did:plc:z72i7hdynmk6r22z27h6tvur"
        let links = ToolLinks.forAccount(did: did)
        XCTAssertFalse(links.isEmpty)
        for link in links {
            XCTAssertEqual(Array(link.query.values), [did])
            XCTAssertNotNil(ToolCatalog.tool(link.slug), "\(link.slug) is in the catalog")
        }
    }

    func testCopyDoesNotSendTheReaderToABrowser() {
        for tool in ToolCatalog.tools {
            XCTAssertFalse(tool.desc.contains("browser"), "\(tool.slug): \(tool.desc)")
            XCTAssertFalse(tool.lead.contains("browser"), "\(tool.slug): \(tool.lead)")
        }
    }
}

private final class TxtFakeTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private let status: Int
    private let body: String
    private var recorded: [URLRequest] = []

    init(status: Int, body: String) {
        self.status = status
        self.body = body
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
        return (Data(body.utf8), response)
    }

    private func record(_ request: URLRequest) {
        lock.lock(); defer { lock.unlock() }
        recorded.append(request)
    }

    var requests: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return recorded
    }
}

final class DNSTXTTests: XCTestCase {
    func testUnquoteJoinsQuotedStringsAndUnescapes() {
        XCTAssertEqual(DNSTXT.unquote(#""did=did:plc:abc""#), "did=did:plc:abc")
        XCTAssertEqual(DNSTXT.unquote(#""did=did:plc:" "abc""#), "did=did:plc:abc", "a long record arrives as several strings")
        XCTAssertEqual(DNSTXT.unquote(#""a \"quoted\" word""#), #"a "quoted" word"#)
        XCTAssertEqual(DNSTXT.unquote("bare"), "bare", "text without quotes is kept as found")
    }

    func testReadAnswer() throws {
        let found = try JSONValue.parse(Data(#"{"Status":0,"Answer":[{"type":16,"data":"\"did=did:plc:abc\""},{"type":5,"data":"cname.example."}]}"#.utf8))
        XCTAssertEqual(DNSTXT.readAnswer(name: "_atproto.alice.test", body: found),
                       TxtProbe(name: "_atproto.alice.test", status: .found, records: ["did=did:plc:abc"]))

        let nxdomain = try JSONValue.parse(Data(#"{"Status":3}"#.utf8))
        XCTAssertEqual(DNSTXT.readAnswer(name: "x", body: nxdomain).status, .none)

        let servfail = try JSONValue.parse(Data(#"{"Status":2}"#.utf8))
        let probe = DNSTXT.readAnswer(name: "x", body: servfail)
        XCTAssertEqual(probe.status, .error)
        XCTAssertEqual(probe.error, "the name's DNS returned an error (code 2)")
        XCTAssertEqual(DNSTXT.readAnswer(name: "x", body: nil).error, "the name's DNS returned an error (code unknown)")
    }

    func testLookupAsksTheResolverForTXT() async {
        let transport = TxtFakeTransport(status: 200, body: #"{"Status":0,"Answer":[{"type":16,"data":"\"did=did:plc:abc\""}]}"#)
        let probe = await DNSTXTClient(http: HTTPClient(transport: transport)).lookup("_atproto.alice.test")
        XCTAssertEqual(probe.records, ["did=did:plc:abc"])
        XCTAssertEqual(transport.requests.first?.url?.absoluteString, "https://dns.google/resolve?name=_atproto.alice.test&type=TXT")
        XCTAssertEqual(transport.requests.first?.value(forHTTPHeaderField: "Accept"), "application/dns-json")
    }

    func testAFailedLookupIsAnErrorProbe() async {
        let transport = TxtFakeTransport(status: 503, body: "down")
        let probe = await DNSTXTClient(http: HTTPClient(transport: transport)).lookup("x")
        XCTAssertEqual(probe.status, .error)
        XCTAssertEqual(probe.error, "the resolver answered HTTP 503")
    }
}
