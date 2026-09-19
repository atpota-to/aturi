import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private final class CredBlueFakeTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private let status: Int
    private let body: String
    private(set) var requests: [URLRequest] = []

    init(status: Int, body: String) {
        self.status = status
        self.body = body
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [:])!
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

final class CredBlueClientTests: XCTestCase {
    private let scoreBody = """
    {"handle":"alice.example","did":"did:plc:x","scores":{"combined":71,"bluesky":68.5,"atproto":74},"cachedAt":"2025-01-01T00:00:00.000Z","version":"1.2","source":"memory","ageMs":12345}
    """

    private func client(_ transport: CredBlueFakeTransport) -> CredBlueClient {
        CredBlueClient(http: HTTPClient(transport: transport))
    }

    func testScoreURLStripsOneLeadingAtAndEncodesTheIdentifier() {
        XCTAssertEqual(CredBlueClient.scoreURL(for: "@alice.example")?.absoluteString, "https://api.cred.blue/api/score/alice.example")
        XCTAssertEqual(CredBlueClient.scoreURL(for: "did:plc:x")?.absoluteString, "https://api.cred.blue/api/score/did%3Aplc%3Ax")
        XCTAssertEqual(CredBlueClient.scoreURL(for: "@@twice")?.absoluteString, "https://api.cred.blue/api/score/%40twice")
        XCTAssertNil(CredBlueClient.scoreURL(for: ""))
    }

    func testProfileURLMatchesTheBadgeLink() {
        XCTAssertEqual(CredBlueClient.profileURL(for: "@dame.is").absoluteString, "https://cred.blue/dame.is")
        XCTAssertEqual(CredBlueClient.profileURL(for: "did:plc:x").absoluteString, "https://cred.blue/did%3Aplc%3Ax")
    }

    func testFetchCachedScoreDecodesAndSendsTheAcceptHeader() async {
        let transport = CredBlueFakeTransport(status: 200, body: scoreBody)
        let score = await client(transport).fetchCachedScore("@alice.example")
        XCTAssertEqual(transport.urls, ["https://api.cred.blue/api/score/alice.example"])
        XCTAssertEqual(transport.requests.first?.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertEqual(score, CredBlueScore(
            handle: "alice.example",
            did: "did:plc:x",
            scores: .init(combined: 71, bluesky: 68.5, atproto: 74),
            cachedAt: "2025-01-01T00:00:00.000Z",
            version: "1.2",
            source: "memory",
            ageMs: 12345
        ))
    }

    func testFetchCachedScoreToleratesMissingOptionalFields() async {
        let transport = CredBlueFakeTransport(status: 200, body: #"{"handle":"a.example","did":"did:plc:a","scores":{"combined":1,"bluesky":2,"atproto":3}}"#)
        let score = await client(transport).fetchCachedScore("a.example")
        XCTAssertEqual(score?.scores.combined, 1)
        XCTAssertNil(score?.cachedAt)
        XCTAssertNil(score?.source)
        XCTAssertNil(score?.ageMs)
    }

    func testFetchCachedScoreIsNilOn204And404AndErrors() async {
        for status in [204, 404, 400, 500] {
            let transport = CredBlueFakeTransport(status: status, body: status == 204 ? "" : #"{"error":"x"}"#)
            let score = await client(transport).fetchCachedScore("alice.example")
            XCTAssertNil(score, "status \(status)")
            XCTAssertEqual(transport.urls.count, 1, "status \(status)")
        }
    }

    func testFetchCachedScoreIsNilOnAMalformedBody() async {
        let transport = CredBlueFakeTransport(status: 200, body: #"{"handle":"a.example"}"#)
        let score = await client(transport).fetchCachedScore("a.example")
        XCTAssertNil(score)
    }

    func testFetchCachedScoreOfAnEmptyIdentifierMakesNoRequest() async {
        let transport = CredBlueFakeTransport(status: 200, body: scoreBody)
        let score = await client(transport).fetchCachedScore("")
        XCTAssertNil(score)
        XCTAssertTrue(transport.urls.isEmpty)
    }

    func testCredBlueScoreRoundTripsThroughCodable() throws {
        let score = CredBlueScore(handle: "a.example", did: "did:plc:a", scores: .init(combined: 50, bluesky: 40, atproto: 60), ageMs: 10)
        let data = try JSONEncoder().encode(score)
        XCTAssertEqual(try JSONDecoder().decode(CredBlueScore.self, from: data), score)
    }
}
