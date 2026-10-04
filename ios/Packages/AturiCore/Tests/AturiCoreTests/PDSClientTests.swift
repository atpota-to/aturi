import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A transport routed by URL substring: the first pattern the request URL
/// contains wins, anything else is a 404. Records every request so tests can
/// assert on the calls that were made (and on the ones that were not).
private final class PDSRoutedTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var headers: [String: String] = [:]
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, outcome: Result<Reply, Error>)]
    private(set) var requests: [URLRequest] = []

    init(_ routes: [(String, Result<Reply, Error>)]) {
        self.routes = routes.map { (pattern: $0.0, outcome: $0.1) }
    }

    convenience init(replies: [(String, Reply)]) {
        self.init(replies.map { ($0.0, Result<Reply, Error>.success($0.1)) })
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        let url = request.url!
        let text = url.absoluteString
        let outcome = routes.first { text.contains($0.pattern) }?.outcome
            ?? .success(Reply(status: 404, body: #"{"error":"NotFound"}"#))
        let reply = try outcome.get()
        let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
        return (Data(reply.body.utf8), response)
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

final class PDSClientTests: XCTestCase {
    private let pds = "https://pds.example"
    private let did = "did:plc:livehealthyaccount00001"

    private func client(_ transport: PDSRoutedTransport) -> PDSClient {
        PDSClient(http: HTTPClient(transport: transport))
    }

    // MARK: describeRepo

    func testDescribeRepoBuildsTheXRPCURLAndDecodes() async throws {
        let body = """
        {"handle":"alive.example","did":"\(did)","didDoc":{"id":"\(did)"},"collections":["app.bsky.feed.post","app.bsky.actor.profile"],"handleIsCorrect":true}
        """
        let transport = PDSRoutedTransport(replies: [("describeRepo", .init(status: 200, body: body))])
        let description = try await client(transport).describeRepo(pds: pds, repo: did)

        XCTAssertEqual(transport.urls, ["https://pds.example/xrpc/com.atproto.repo.describeRepo?repo=did%3Aplc%3Alivehealthyaccount00001"])
        XCTAssertEqual(description.handle, "alive.example")
        XCTAssertEqual(description.did, did)
        XCTAssertEqual(description.collections, ["app.bsky.feed.post", "app.bsky.actor.profile"])
        XCTAssertEqual(description.handleIsCorrect, true)
        XCTAssertEqual(description.didDoc?["id"]?.stringValue, did)
    }

    func testDescribeRepoToleratesMissingOptionalFields() async throws {
        let transport = PDSRoutedTransport(replies: [("describeRepo", .init(status: 200, body: #"{"did":"did:plc:x"}"#))])
        let description = try await client(transport).describeRepo(pds: pds, repo: "did:plc:x")
        XCTAssertNil(description.handle)
        XCTAssertEqual(description.collections, [])
        XCTAssertNil(description.didDoc)
        XCTAssertNil(description.handleIsCorrect)
    }

    func testDescribeRepoSurfacesA400AsHTTPErrorWithTheBody() async {
        let transport = PDSRoutedTransport(replies: [
            ("describeRepo", .init(status: 400, body: #"{"error":"RepoTakendown","message":"Repo has been takendown"}"#)),
        ])
        do {
            _ = try await client(transport).describeRepo(pds: pds, repo: did)
            XCTFail("expected HTTPError")
        } catch let error as HTTPError {
            XCTAssertEqual(error.status, 400)
            XCTAssertTrue(error.body.contains("RepoTakendown"))
            XCTAssertEqual(error.url.host, "pds.example")
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testEveryReadRefusesRedirects() async throws {
        let transport = PDSRoutedTransport(replies: [
            ("describeRepo", .init(status: 200, body: #"{"did":"did:plc:x","collections":[]}"#)),
            ("getLatestCommit", .init(status: 200, body: #"{"cid":"bafy","rev":"3k7qwertyuiop"}"#)),
            ("getRepoStatus", .init(status: 200, body: #"{"did":"did:plc:x","active":true}"#)),
            ("listRecords", .init(status: 200, body: #"{"records":[]}"#)),
            ("getRecord", .init(status: 200, body: #"{"uri":"at://did:plc:x/a.b.c/r","cid":"bafy","value":{}}"#)),
        ])
        let c = client(transport)
        _ = try await c.describeRepo(pds: pds, repo: "did:plc:x")
        _ = try await c.getLatestCommit(pds: pds, did: "did:plc:x")
        _ = try await c.getRepoStatus(host: pds, did: "did:plc:x")
        _ = try await c.listRecordsPage(pds: pds, repo: "did:plc:x", collection: "a.b.c")
        _ = try await c.listRecords(pds: pds, repo: "did:plc:x", collection: "a.b.c")
        _ = try await c.getRecord(pds: pds, repo: "did:plc:x", collection: "a.b.c", rkey: "r")

        XCTAssertEqual(transport.requests.count, 6)
        for request in transport.requests {
            XCTAssertEqual(
                request.value(forHTTPHeaderField: URLSessionTransport.noRedirectHeader), "1",
                "\(request.url!.absoluteString) must refuse redirects"
            )
        }
    }

    func testARedirectFromThePDSIsRefused() async {
        let transport = PDSRoutedTransport(replies: [
            ("describeRepo", .init(status: 302, body: "", headers: ["Location": "https://169.254.169.254/latest/meta-data"])),
        ])
        do {
            _ = try await client(transport).describeRepo(pds: pds, repo: did)
            XCTFail("expected redirectRefused")
        } catch HTTPFailure.redirectRefused(let location) {
            XCTAssertEqual(location.host, "169.254.169.254")
        } catch {
            XCTFail("unexpected error \(error)")
        }
        XCTAssertEqual(transport.requests.count, 1, "the redirect is never followed")
    }

    // MARK: getLatestCommit / getRepoStatus

    func testGetLatestCommit() async throws {
        let transport = PDSRoutedTransport(replies: [("getLatestCommit", .init(status: 200, body: #"{"cid":"bafyhead","rev":"3lbqwertyuiop"}"#))])
        let commit = try await client(transport).getLatestCommit(pds: pds, did: did)
        XCTAssertEqual(transport.urls, ["https://pds.example/xrpc/com.atproto.sync.getLatestCommit?did=did%3Aplc%3Alivehealthyaccount00001"])
        XCTAssertEqual(commit, LatestCommit(cid: "bafyhead", rev: "3lbqwertyuiop"))
    }

    func testGetRepoStatusAcceptsAPDSOrARelayHost() async throws {
        let transport = PDSRoutedTransport(replies: [
            ("relay1.us-east.bsky.network", .init(status: 200, body: #"{"did":"did:plc:x","active":false,"status":"takendown","rev":"3lbrev"}"#)),
            ("pds.example", .init(status: 200, body: #"{"did":"did:plc:x","active":true}"#)),
        ])
        let c = client(transport)
        let fromPDS = try await c.getRepoStatus(host: pds, did: "did:plc:x")
        let fromRelay = try await c.getRepoStatus(host: Endpoints.relay.absoluteString, did: "did:plc:x")

        XCTAssertEqual(fromPDS, RepoStatus(did: "did:plc:x", active: true))
        XCTAssertEqual(fromRelay, RepoStatus(did: "did:plc:x", active: false, status: "takendown", rev: "3lbrev"))
        XCTAssertEqual(transport.urls, [
            "https://pds.example/xrpc/com.atproto.sync.getRepoStatus?did=did%3Aplc%3Ax",
            "https://relay1.us-east.bsky.network/xrpc/com.atproto.sync.getRepoStatus?did=did%3Aplc%3Ax",
        ])
    }

    // MARK: listRecords

    private let pageOne = """
    {"records":[{"uri":"at://did:plc:x/a.b.c/1","cid":"c1","value":{"text":"one","n":1}},{"uri":"at://did:plc:x/a.b.c/2","cid":"c2","value":{"text":"two"}}],"cursor":"3k7cursor"}
    """

    func testListRecordsPageDefaultsAndDecoding() async throws {
        let transport = PDSRoutedTransport(replies: [("listRecords", .init(status: 200, body: pageOne))])
        let page = try await client(transport).listRecordsPage(pds: pds, repo: "did:plc:x", collection: "a.b.c")

        XCTAssertEqual(transport.urls, ["https://pds.example/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Ax&collection=a.b.c&limit=50"])
        XCTAssertEqual(page.cursor, "3k7cursor")
        XCTAssertEqual(page.records.count, 2)
        XCTAssertEqual(page.records[0].uri, "at://did:plc:x/a.b.c/1")
        XCTAssertEqual(page.records[0].cid, "c1")
        XCTAssertEqual(page.records[0].value, ["text": "one", "n": 1])
        XCTAssertEqual(page.records[1].value["text"]?.stringValue, "two")
    }

    func testListRecordsPageAddsReverseAndCursorOnlyWhenSet() async throws {
        let transport = PDSRoutedTransport(replies: [("listRecords", .init(status: 200, body: #"{"records":[]}"#))])
        let page = try await client(transport).listRecordsPage(
            pds: pds, repo: "did:plc:x", collection: "a.b.c", limit: 10, cursor: "abc def", reverse: true
        )
        XCTAssertEqual(transport.urls, ["https://pds.example/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Ax&collection=a.b.c&limit=10&reverse=true&cursor=abc%20def"])
        XCTAssertNil(page.cursor)
        XCTAssertEqual(page.records, [])
    }

    func testListRecordsPageToleratesAMissingRecordsArray() async throws {
        let transport = PDSRoutedTransport(replies: [("listRecords", .init(status: 200, body: "{}"))])
        let page = try await client(transport).listRecordsPage(pds: pds, repo: "did:plc:x", collection: "a.b.c")
        XCTAssertEqual(page.records, [])
        XCTAssertNil(page.cursor)
    }

    func testListRecordsFollowsTheCursorUntilItStops() async throws {
        let transport = PDSRoutedTransport(replies: [
            ("cursor=3k7cursor", .init(status: 200, body: #"{"records":[{"uri":"at://did:plc:x/a.b.c/3","cid":"c3","value":{}}]}"#)),
            ("listRecords", .init(status: 200, body: pageOne)),
        ])
        let records = try await client(transport).listRecords(pds: pds, repo: "did:plc:x", collection: "a.b.c")
        XCTAssertEqual(records.map(\.cid), ["c1", "c2", "c3"])
        XCTAssertEqual(transport.urls, [
            "https://pds.example/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Ax&collection=a.b.c&limit=100",
            "https://pds.example/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Ax&collection=a.b.c&limit=100&cursor=3k7cursor",
        ])
    }

    func testListRecordsCapsAtMaxAndShrinksTheLastPage() async throws {
        let transport = PDSRoutedTransport(replies: [
            ("cursor=3k7cursor", .init(status: 200, body: #"{"records":[{"uri":"at://did:plc:x/a.b.c/3","cid":"c3","value":{}}],"cursor":"more"}"#)),
            ("listRecords", .init(status: 200, body: pageOne)),
        ])
        let records = try await client(transport).listRecords(pds: pds, repo: "did:plc:x", collection: "a.b.c", limit: 2, max: 3)
        XCTAssertEqual(records.count, 3)
        // Second page asks for exactly the remainder, and the "more" cursor
        // is never followed because max was reached.
        XCTAssertEqual(transport.urls.count, 2)
        XCTAssertTrue(transport.urls[1].hasSuffix("limit=1&cursor=3k7cursor"))
    }

    func testListRecordsStopsOnAnEmptyBatchEvenWithACursor() async throws {
        let transport = PDSRoutedTransport(replies: [
            ("listRecords", .init(status: 200, body: #"{"records":[],"cursor":"loop"}"#)),
        ])
        let records = try await client(transport).listRecords(pds: pds, repo: "did:plc:x", collection: "a.b.c")
        XCTAssertEqual(records, [])
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testListRecordsPassesReverseOnEveryPage() async throws {
        let transport = PDSRoutedTransport(replies: [
            ("cursor=3k7cursor", .init(status: 200, body: #"{"records":[]}"#)),
            ("listRecords", .init(status: 200, body: pageOne)),
        ])
        _ = try await client(transport).listRecords(pds: pds, repo: "did:plc:x", collection: "a.b.c", reverse: true)
        for url in transport.urls {
            XCTAssertTrue(url.contains("reverse=true"), url)
        }
    }

    // MARK: getRecord

    func testGetRecordBuildsTheURLAndDecodesTheValue() async throws {
        let body = #"{"uri":"at://did:plc:x/app.bsky.feed.post/3k7abc","cid":"bafyrec","value":{"$type":"app.bsky.feed.post","text":"hi","langs":["en"]}}"#
        let transport = PDSRoutedTransport(replies: [("getRecord", .init(status: 200, body: body))])
        let record = try await client(transport).getRecord(pds: pds, repo: "did:plc:x", collection: "app.bsky.feed.post", rkey: "3k7abc")

        XCTAssertEqual(transport.urls, ["https://pds.example/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Ax&collection=app.bsky.feed.post&rkey=3k7abc"])
        XCTAssertEqual(record.uri, "at://did:plc:x/app.bsky.feed.post/3k7abc")
        XCTAssertEqual(record.cid, "bafyrec")
        XCTAssertEqual(record.value["$type"]?.stringValue, "app.bsky.feed.post")
        XCTAssertEqual(record.value["langs"], ["en"])
    }

    func testGetRecordWithoutACIDDecodesToAnEmptyCID() async throws {
        let transport = PDSRoutedTransport(replies: [("getRecord", .init(status: 200, body: #"{"uri":"at://did:plc:x/a.b.c/r","value":{"k":true}}"#))])
        let record = try await client(transport).getRecord(pds: pds, repo: "did:plc:x", collection: "a.b.c", rkey: "r")
        XCTAssertEqual(record.cid, "")
        XCTAssertEqual(record.value["k"]?.boolValue, true)
    }

    func testGetRecord404IsAnHTTPError() async {
        let transport = PDSRoutedTransport(replies: [("getRecord", .init(status: 400, body: #"{"error":"RecordNotFound"}"#))])
        do {
            _ = try await client(transport).getRecord(pds: pds, repo: "did:plc:x", collection: "a.b.c", rkey: "nope")
            XCTFail("expected HTTPError")
        } catch let error as HTTPError {
            XCTAssertEqual(error.status, 400)
            XCTAssertTrue(error.body.contains("RecordNotFound"))
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    // MARK: URL builders

    func testRecordURLAndRepoURL() throws {
        let record = try PDSClient.recordURL(pds: "https://pds.example/", repo: "did:plc:x", collection: "a.b.c", rkey: "r?k")
        XCTAssertEqual(record.absoluteString, "https://pds.example/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Ax&collection=a.b.c&rkey=r%3Fk")

        let repo = try PDSClient.repoURL(pds: "pds.example", did: "did:web:host.example")
        XCTAssertEqual(repo.absoluteString, "https://pds.example/xrpc/com.atproto.sync.getRepo?did=did%3Aweb%3Ahost.example")
    }

    func testBaseWithoutASchemeOrWithATrailingSlashIsNormalized() async throws {
        let transport = PDSRoutedTransport(replies: [("describeRepo", .init(status: 200, body: #"{"did":"did:plc:x","collections":[]}"#))])
        let c = client(transport)
        _ = try await c.describeRepo(pds: "pds.example/", repo: "did:plc:x")
        _ = try await c.describeRepo(pds: "http://localhost:2583", repo: "did:plc:x")
        XCTAssertEqual(transport.urls, [
            "https://pds.example/xrpc/com.atproto.repo.describeRepo?repo=did%3Aplc%3Ax",
            "http://localhost:2583/xrpc/com.atproto.repo.describeRepo?repo=did%3Aplc%3Ax",
        ])
    }

    func testAnUnusableBaseIsNamedRatherThanSent() async {
        let transport = PDSRoutedTransport(replies: [])
        do {
            _ = try await client(transport).describeRepo(pds: "not a host", repo: "did:plc:x")
            XCTFail("expected invalidBase")
        } catch PDSClientError.invalidBase(let base) {
            XCTAssertEqual(base, "not a host")
        } catch {
            XCTFail("unexpected error \(error)")
        }
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testAtRecordRoundTripsThroughCodable() throws {
        let record = AtRecord(uri: "at://did:plc:x/a.b.c/r", cid: "bafy", value: ["text": "hi", "n": [1, 2]])
        let data = try JSONEncoder().encode(record)
        let decoded = try JSONDecoder().decode(AtRecord.self, from: data)
        XCTAssertEqual(decoded, record)
    }

    // MARK: live

    func testLiveDescribeRepoForAturiTo() async throws {
        let resolution = await IdentityResolver.shared.resolveHandleStatus("aturi.to")
        guard case .did(let did) = resolution else {
            if resolution == .unavailable { throw XCTSkip("handle resolver unavailable") }
            XCTFail("aturi.to should resolve")
            return
        }
        guard let pdsEndpoint = await IdentityResolver.shared.resolvePDS(did)?.pdsEndpoint else {
            throw XCTSkip("DID document unavailable")
        }
        let description: DescribeRepoResponse
        do {
            description = try await PDSClient().describeRepo(pds: pdsEndpoint, repo: did)
        } catch let error as HTTPError where error.status == 429 || error.status >= 500 {
            throw XCTSkip("PDS answered \(error.status)")
        } catch let error as HTTPError {
            throw error
        } catch {
            throw XCTSkip("network unavailable: \(error)")
        }
        XCTAssertEqual(description.did, did)
        XCTAssertEqual(description.handle, "aturi.to")
        XCTAssertFalse(description.collections.isEmpty)
    }
}
