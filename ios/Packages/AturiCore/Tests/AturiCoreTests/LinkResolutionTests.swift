import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport for the resolution pipeline: the first
/// pattern found in the URL answers, anything else is a 404. An optional
/// delay lets a test cancel a resolution mid-flight.
private final class LinkResolutionFakeTransport: HTTPTransport, @unchecked Sendable {
    enum Route {
        case reply(status: Int, body: String)
        case fail(Error)
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, route: Route)]
    private let delayNanoseconds: UInt64
    private var requests: [URLRequest] = []

    init(_ routes: [(String, Route)], delayNanoseconds: UInt64 = 0) {
        self.routes = routes.map { (pattern: $0.0, route: $0.1) }
        self.delayNanoseconds = delayNanoseconds
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        if delayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: delayNanoseconds)
        }
        let url = request.url!
        let route = routes.first { url.absoluteString.contains($0.pattern) }?.route
            ?? .reply(status: 404, body: #"{"error":"NotFound"}"#)
        switch route {
        case .fail(let error):
            throw error
        case .reply(let status, let body):
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
            return (Data(body.utf8), response)
        }
    }

    /// Locking stays in a synchronous helper: NSLock is not async-safe.
    private func record(_ request: URLRequest) {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
    }

    var requestCount: Int {
        lock.lock(); defer { lock.unlock() }
        return requests.count
    }

    func count(containing fragment: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        return requests.compactMap { $0.url?.absoluteString }.filter { $0.contains(fragment) }.count
    }
}

final class LinkResolutionTests: XCTestCase {
    private typealias Route = LinkResolutionFakeTransport.Route

    private static let resolveAppView = "public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle"
    private static let resolveFallback = "bsky.social/xrpc/com.atproto.identity.resolveHandle"
    private static let plcDocument = "plc.directory/did:plc:alice123"
    private static let pdsRecord = "pds.example/xrpc/com.atproto.repo.getRecord"
    private static let publicRecord = "public.api.bsky.app/xrpc/com.atproto.repo.getRecord"

    private static let did = "did:plc:alice123"
    private static let didDocument = ##"{"id":"did:plc:alice123","alsoKnownAs":["at://alice.test"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}"##
    private static let genericRecord = #"{"uri":"at://did:plc:alice123/com.example.thing/abc","cid":"c2","value":{"$type":"com.example.thing","title":"Hi"}}"#

    private func transport(overrides: [(String, Route)] = [], delayNanoseconds: UInt64 = 0) -> LinkResolutionFakeTransport {
        let base: [(String, Route)] = [
            (Self.resolveAppView, .reply(status: 200, body: #"{"did":"did:plc:alice123"}"#)),
            (Self.resolveFallback, .reply(status: 400, body: #"{"error":"InvalidRequest"}"#)),
            (Self.plcDocument, .reply(status: 200, body: Self.didDocument)),
            (Self.pdsRecord, .reply(status: 200, body: Self.genericRecord)),
            (Self.publicRecord, .reply(status: 404, body: #"{"error":"RecordNotFound"}"#)),
        ]
        return LinkResolutionFakeTransport(overrides + base, delayNanoseconds: delayNanoseconds)
    }

    private func resolver(_ transport: LinkResolutionFakeTransport) -> IdentityResolver {
        IdentityResolver(http: HTTPClient(transport: transport))
    }

    private func resolvedLink(_ resolution: LinkResolution, file: StaticString = #filePath, line: UInt = #line) -> ResolvedLink? {
        guard case .resolved(let link) = resolution else {
            XCTFail("expected a resolved link, got \(resolution)", file: file, line: line)
            return nil
        }
        return link
    }

    // MARK: Resolution

    func testPostLinkResolvesToTheCanonicalAddresses() async throws {
        let transport = transport()
        let resolution = try await LinkResolution.resolve("  https://bsky.app/profile/alice.test/post/3kabc\n", identity: resolver(transport))
        guard let link = resolvedLink(resolution) else { return }
        XCTAssertEqual(link.type, .post)
        XCTAssertEqual(link.did, Self.did)
        XCTAssertEqual(link.handle, "alice.test")
        XCTAssertEqual(link.displayName, "@alice.test")
        XCTAssertEqual(link.collection, "app.bsky.feed.post")
        XCTAssertEqual(link.rkey, "3kabc")
        XCTAssertEqual(link.atUri, "at://did:plc:alice123/app.bsky.feed.post/3kabc")
        XCTAssertEqual(link.aturiLink, "https://aturi.to/profile/alice.test/post/3kabc")
        XCTAssertEqual(transport.count(containing: "plc.directory"), 0, "a handle input needs no DID document")
    }

    func testDidInputIsShownByTheHandleItsDocumentNames() async throws {
        let transport = transport()
        let resolution = try await LinkResolution.resolve("did:plc:alice123", identity: resolver(transport))
        guard let link = resolvedLink(resolution) else { return }
        XCTAssertEqual(link.type, .profile)
        XCTAssertEqual(link.handle, "alice.test")
        XCTAssertEqual(link.atUri, "at://did:plc:alice123")
        XCTAssertEqual(link.aturiLink, "https://aturi.to/profile/alice.test")
        XCTAssertEqual(transport.count(containing: "resolveHandle"), 0, "a DID needs no handle resolution")
    }

    func testAtPrefixedHandleIsStripped() async throws {
        let transport = transport()
        let resolution = try await LinkResolution.resolve("@alice.test", identity: resolver(transport))
        XCTAssertEqual(resolvedLink(resolution)?.handle, "alice.test")
        XCTAssertEqual(transport.count(containing: "resolveHandle?handle=alice.test"), 1)
    }

    func testInputThatNamesNothingIsInvalidWithoutAnyRequest() async throws {
        let transport = transport()
        let identity = resolver(transport)
        let unreadable = try await LinkResolution.resolve("not a link", identity: identity)
        XCTAssertEqual(unreadable, .invalid(LinkResolution.unreadableInputMessage))
        let space = try await LinkResolution.resolve("at://did:plc:alice123/space/com.example.forum", identity: identity)
        XCTAssertEqual(space, .invalid("Space URIs are not public records"))
        let blank = try await LinkResolution.resolve("   ", identity: identity)
        XCTAssertEqual(blank, .invalid(LinkResolution.unreadableInputMessage))
        XCTAssertEqual(transport.requestCount, 0)
    }

    func testUnknownHandleIsNotFound() async throws {
        let transport = transport(overrides: [(Self.resolveAppView, .reply(status: 400, body: #"{"error":"InvalidRequest","message":"Unable to resolve handle"}"#))])
        let resolution = try await LinkResolution.resolve("nobody.test", identity: resolver(transport))
        XCTAssertEqual(resolution, .notFound(handle: "nobody.test"))
    }

    func testResolverOutageIsUnavailableNotNotFound() async throws {
        let transport = transport(overrides: [
            (Self.resolveAppView, .reply(status: 503, body: "upstream")),
            (Self.resolveFallback, .fail(URLError(.notConnectedToInternet))),
        ])
        let resolution = try await LinkResolution.resolve("alice.test", identity: resolver(transport))
        guard case .unavailable(let message) = resolution else { return XCTFail("expected unavailable, got \(resolution)") }
        XCTAssertTrue(message.contains("resolver"), message)
        XCTAssertTrue(message.contains("alice.test"), message)
    }

    func testCancellationBetweenHopsThrows() async {
        let transport = transport(delayNanoseconds: 50_000_000)
        let identity = resolver(transport)
        let task = Task {
            try await LinkResolution.resolve("alice.test", identity: identity)
        }
        task.cancel()
        do {
            let resolution = try await task.value
            XCTFail("expected cancellation, got \(resolution)")
        } catch {
            XCTAssertTrue(error is CancellationError, "\(error)")
        }
    }

    // MARK: Records

    func testRecordIsReadFromTheAccountsPds() async throws {
        let transport = transport()
        let identity = resolver(transport)
        let resolution = try await LinkResolution.resolve("at://alice.test/com.example.thing/abc", identity: identity)
        guard let link = resolvedLink(resolution) else { return }
        let fetched = await link.fetchRecord(identity: identity, pds: PDSClient(http: HTTPClient(transport: transport)))
        guard let (record, bundle) = fetched else { return XCTFail("expected a record") }
        XCTAssertEqual(record.cid, "c2")
        XCTAssertEqual(record.value["title"]?.stringValue, "Hi")
        XCTAssertEqual(bundle.pds, "https://pds.example")
        XCTAssertEqual(bundle.handle, "alice.test")
    }

    func testRecordFallsBackToThePublicApiWhenThePdsRefuses() async throws {
        let transport = transport(overrides: [
            (Self.pdsRecord, .reply(status: 400, body: #"{"error":"RepoTakendown"}"#)),
            (Self.publicRecord, .reply(status: 200, body: Self.genericRecord)),
        ])
        let identity = resolver(transport)
        let resolution = try await LinkResolution.resolve("at://did:plc:alice123/com.example.thing/abc", identity: identity)
        guard let link = resolvedLink(resolution) else { return }
        let fetched = await link.fetchRecord(identity: identity, pds: PDSClient(http: HTTPClient(transport: transport)))
        guard let (record, bundle) = fetched else { return XCTFail("expected a record") }
        XCTAssertEqual(record.uri, "at://did:plc:alice123/com.example.thing/abc")
        XCTAssertEqual(bundle.pds, "https://public.api.bsky.app")
    }

    func testAProfileLinkHasNoRecordToFetch() async throws {
        let transport = transport()
        let identity = resolver(transport)
        let resolution = try await LinkResolution.resolve("alice.test", identity: identity)
        guard let link = resolvedLink(resolution) else { return }
        let before = transport.requestCount
        let fetched = await link.fetchRecord(identity: identity, pds: PDSClient(http: HTTPClient(transport: transport)))
        XCTAssertNil(fetched)
        XCTAssertEqual(transport.requestCount, before, "no request for a link without a record")
    }
}
