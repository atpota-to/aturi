import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private final class ServerRoutedTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var headers: [String: String] = [:]
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, reply: Reply)]
    private(set) var requests: [URLRequest] = []

    init(_ routes: [(String, Reply)]) {
        self.routes = routes.map { (pattern: $0.0, reply: $0.1) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        let url = request.url!
        let reply = routes.first { url.absoluteString.contains($0.pattern) }?.reply
            ?? Reply(status: 404, body: "Not Found")
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

final class PDSServerTests: XCTestCase {
    private func server(_ transport: ServerRoutedTransport) -> PDSServer {
        PDSServer(http: HTTPClient(transport: transport))
    }

    // MARK: normalizePdsBase

    func testNormalizePdsBaseAddsSchemeAndStripsTrailingSlash() {
        XCTAssertEqual(PDSServer.normalizePdsBase("pds.example"), "https://pds.example")
        XCTAssertEqual(PDSServer.normalizePdsBase("https://pds.example/"), "https://pds.example")
        XCTAssertEqual(PDSServer.normalizePdsBase("  http://localhost:2583/  "), "http://localhost:2583")
        XCTAssertEqual(PDSServer.normalizePdsBase("HTTPS://Pds.Example/"), "HTTPS://Pds.Example")
        XCTAssertEqual(PDSServer.normalizePdsBase("pds.example/xrpc/"), "https://pds.example/xrpc")
    }

    // MARK: pdsHostname

    func testPdsHostnameExtractsTheHostFromURLsAndHostnames() {
        XCTAssertEqual(PDSServer.pdsHostname("https://pds.example/xrpc/com.atproto.server.describeServer"), "pds.example")
        XCTAssertEqual(PDSServer.pdsHostname("pds.example"), "pds.example")
        XCTAssertEqual(PDSServer.pdsHostname("PDS.Example/"), "pds.example")
        XCTAssertEqual(PDSServer.pdsHostname("http://localhost:2583/"), "localhost:2583")
        XCTAssertEqual(PDSServer.pdsHostname("pds.example:3000"), "pds.example:3000")
    }

    func testPdsHostnameFallsBackToStrippingWhenTheInputIsNotAURL() {
        XCTAssertEqual(PDSServer.pdsHostname("not a host/with/path"), "not a host")
        XCTAssertEqual(PDSServer.pdsHostname("https://also not/x"), "also not")
    }

    // MARK: describeServer

    func testDescribeServerBuildsTheURLAndDecodesNestedFields() async throws {
        let body = """
        {"did":"did:web:pds.example","availableUserDomains":[".pds.example"],"inviteCodeRequired":true,"phoneVerificationRequired":false,"links":{"privacyPolicy":"https://pds.example/privacy","termsOfService":"https://pds.example/tos"},"contact":{"email":"admin@pds.example"}}
        """
        let transport = ServerRoutedTransport([("describeServer", .init(status: 200, body: body))])
        let description = try await server(transport).describeServer(pds: "pds.example")

        XCTAssertEqual(transport.urls, ["https://pds.example/xrpc/com.atproto.server.describeServer"])
        XCTAssertEqual(description.did, "did:web:pds.example")
        XCTAssertEqual(description.availableUserDomains, [".pds.example"])
        XCTAssertEqual(description.inviteCodeRequired, true)
        XCTAssertEqual(description.phoneVerificationRequired, false)
        XCTAssertEqual(description.links?.privacyPolicy, "https://pds.example/privacy")
        XCTAssertEqual(description.links?.termsOfService, "https://pds.example/tos")
        XCTAssertEqual(description.contact?.email, "admin@pds.example")
    }

    func testDescribeServerWithAMinimalBody() async throws {
        let transport = ServerRoutedTransport([("describeServer", .init(status: 200, body: #"{"availableUserDomains":[]}"#))])
        let description = try await server(transport).describeServer(pds: "https://pds.example/")
        XCTAssertNil(description.did)
        XCTAssertEqual(description.availableUserDomains, [])
        XCTAssertNil(description.links)
        XCTAssertNil(description.contact)
    }

    // MARK: serverHealth

    func testServerHealthReadsTheVersion() async throws {
        let transport = ServerRoutedTransport([("_health", .init(status: 200, body: #"{"version":"0.4.219"}"#))])
        let health = try await server(transport).serverHealth(pds: "pds.example")
        XCTAssertEqual(transport.urls, ["https://pds.example/xrpc/_health"])
        XCTAssertEqual(health.version, "0.4.219")
    }

    func testServerHealth404IsAnHTTPErrorForTheCallerToTreatAsUnknown() async {
        let transport = ServerRoutedTransport([])
        do {
            _ = try await server(transport).serverHealth(pds: "pds.example")
            XCTFail("expected HTTPError")
        } catch let error as HTTPError {
            XCTAssertEqual(error.status, 404)
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    // MARK: listRepos

    func testListReposDefaultsAndDecoding() async throws {
        let body = """
        {"cursor":"did:plc:next","repos":[{"did":"did:plc:a","head":"bafyhead","rev":"3lbrev","active":true},{"did":"did:plc:b","active":false,"status":"deactivated"}]}
        """
        let transport = ServerRoutedTransport([("listRepos", .init(status: 200, body: body))])
        let page = try await server(transport).listRepos(pds: "pds.example")

        XCTAssertEqual(transport.urls, ["https://pds.example/xrpc/com.atproto.sync.listRepos?limit=50"])
        XCTAssertEqual(page.cursor, "did:plc:next")
        XCTAssertEqual(page.repos, [
            PDSServer.RepoEntry(did: "did:plc:a", head: "bafyhead", rev: "3lbrev", active: true),
            PDSServer.RepoEntry(did: "did:plc:b", active: false, status: "deactivated"),
        ])
    }

    func testListReposPassesLimitAndCursor() async throws {
        let transport = ServerRoutedTransport([("listRepos", .init(status: 200, body: #"{"repos":[]}"#))])
        let page = try await server(transport).listRepos(pds: "pds.example", limit: 10, cursor: "did:plc:next")
        XCTAssertEqual(transport.urls, ["https://pds.example/xrpc/com.atproto.sync.listRepos?limit=10&cursor=did%3Aplc%3Anext"])
        XCTAssertNil(page.cursor)
        XCTAssertEqual(page.repos, [])
    }

    func testListReposToleratesAMissingReposArray() async throws {
        let transport = ServerRoutedTransport([("listRepos", .init(status: 200, body: "{}"))])
        let page = try await server(transport).listRepos(pds: "pds.example")
        XCTAssertEqual(page.repos, [])
    }

    // MARK: redirects

    func testEveryReadRefusesRedirects() async throws {
        let transport = ServerRoutedTransport([
            ("describeServer", .init(status: 200, body: "{}")),
            ("_health", .init(status: 200, body: "{}")),
            ("listRepos", .init(status: 200, body: #"{"repos":[]}"#)),
        ])
        let s = server(transport)
        _ = try await s.describeServer(pds: "pds.example")
        _ = try await s.serverHealth(pds: "pds.example")
        _ = try await s.listRepos(pds: "pds.example")
        XCTAssertEqual(transport.requests.count, 3)
        for request in transport.requests {
            XCTAssertEqual(request.value(forHTTPHeaderField: URLSessionTransport.noRedirectHeader), "1")
        }
    }

    func testARedirectIsRefusedNotFollowed() async {
        let transport = ServerRoutedTransport([
            ("describeServer", .init(status: 301, body: "", headers: ["Location": "http://127.0.0.1/"])),
        ])
        do {
            _ = try await server(transport).describeServer(pds: "pds.example")
            XCTFail("expected redirectRefused")
        } catch HTTPFailure.redirectRefused(let location) {
            XCTAssertEqual(location.absoluteString, "http://127.0.0.1/")
        } catch {
            XCTFail("unexpected error \(error)")
        }
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testAnUnusableHostIsRefusedBeforeAnyRequest() async {
        let transport = ServerRoutedTransport([])
        do {
            _ = try await server(transport).listRepos(pds: " ")
            XCTFail("expected invalidBase")
        } catch PDSClientError.invalidBase {
            // expected
        } catch {
            XCTFail("unexpected error \(error)")
        }
        XCTAssertTrue(transport.requests.isEmpty)
    }
}
