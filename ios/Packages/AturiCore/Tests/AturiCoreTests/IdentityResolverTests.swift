import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Port of the fetch stub in `src/utils/atproto/__tests__/identity.test.ts`:
/// a router keyed on a URL substring, recording every URL so a test can
/// assert on the calls that were *not* made. Unknown routes answer 404.
private final class IdentityRoutedTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var headers: [String: String] = [:]
    }

    enum Route {
        case reply(Reply)
        case fail(Error)
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, route: Route)]
    private let delayNanoseconds: UInt64
    private(set) var requests: [URLRequest] = []

    init(_ routes: [(String, Route)], delayNanoseconds: UInt64 = 0) {
        self.routes = routes.map { (pattern: $0.0, route: $0.1) }
        self.delayNanoseconds = delayNanoseconds
    }

    convenience init(replies: [(String, Reply)]) {
        self.init(replies.map { ($0.0, Route.reply($0.1)) })
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        if delayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: delayNanoseconds)
        }
        let url = request.url!
        let route = routes.first { url.absoluteString.contains($0.pattern) }?.route
            ?? .reply(Reply(status: 404, body: #"{"error":"NotFound"}"#))
        switch route {
        case .fail(let error):
            throw error
        case .reply(let reply):
            let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
            return (Data(reply.body.utf8), response)
        }
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

    func count(containing fragment: String) -> Int {
        urls.filter { $0.contains(fragment) }.count
    }
}

private final class ResolverClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current = Date(timeIntervalSince1970: 1_700_000_000)

    var now: Date {
        lock.lock(); defer { lock.unlock() }
        return current
    }

    func advance(_ seconds: TimeInterval) {
        lock.lock(); defer { lock.unlock() }
        current = current.addingTimeInterval(seconds)
    }
}

final class IdentityResolverTests: XCTestCase {
    private let pds = "https://pds.example"

    private func didDoc(_ did: String, handle: String, pdsEndpoint: String? = "https://pds.example") -> String {
        let service = pdsEndpoint.map {
            ##","service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"\##($0)"}]"##
        } ?? ""
        return #"{"id":"\#(did)","alsoKnownAs":["at://\#(handle)"]\#(service)}"#
    }

    private func resolver(_ transport: IdentityRoutedTransport, clock: ResolverClock = ResolverClock()) -> IdentityResolver {
        IdentityResolver(http: HTTPClient(transport: transport)) { clock.now }
    }

    private static let appviewResolve = "public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle"
    private static let fallbackResolve = "bsky.social/xrpc/com.atproto.identity.resolveHandle"

    // MARK: resolveHandle

    func testResolveHandleReturnsADIDUnchanged() async {
        let transport = IdentityRoutedTransport(replies: [])
        let did = await resolver(transport).resolveHandle("did:plc:x")
        XCTAssertEqual(did, "did:plc:x")
        XCTAssertTrue(transport.requests.isEmpty)
        let status = await resolver(transport).resolveHandleStatus("did:web:x.example")
        XCTAssertEqual(status, .did("did:web:x.example"))
    }

    func testResolveHandleEmptyIsNil() async {
        let transport = IdentityRoutedTransport(replies: [])
        let did = await resolver(transport).resolveHandle("")
        XCTAssertNil(did)
        let status = await resolver(transport).resolveHandleStatus("")
        XCTAssertEqual(status, .notFound)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testResolveHandleUsesTheAppViewFirst() async {
        let transport = IdentityRoutedTransport(replies: [
            (Self.appviewResolve, .init(status: 200, body: #"{"did":"did:plc:fromappview"}"#)),
            (Self.fallbackResolve, .init(status: 200, body: #"{"did":"did:plc:fromfallback"}"#)),
        ])
        let did = await resolver(transport).resolveHandle("alice.example")
        XCTAssertEqual(did, "did:plc:fromappview")
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=alice.example"])
    }

    func testResolveHandleFallsBackToBskySocialWhenTheAppViewSaysNo() async {
        let transport = IdentityRoutedTransport(replies: [
            (Self.appviewResolve, .init(status: 400, body: #"{"error":"InvalidRequest","message":"Unable to resolve handle"}"#)),
            (Self.fallbackResolve, .init(status: 200, body: #"{"did":"did:plc:fromfallback"}"#)),
        ])
        let status = await resolver(transport).resolveHandleStatus("dns-only.example")
        XCTAssertEqual(status, .did("did:plc:fromfallback"))
        XCTAssertEqual(transport.urls, [
            "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=dns-only.example",
            "https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=dns-only.example",
        ])
    }

    func testResolveHandleFallsBackWhenTheAppViewAnswersWithoutADID() async {
        let transport = IdentityRoutedTransport(replies: [
            (Self.appviewResolve, .init(status: 200, body: "{}")),
            (Self.fallbackResolve, .init(status: 200, body: #"{"did":"did:plc:fromfallback"}"#)),
        ])
        let did = await resolver(transport).resolveHandle("alice.example")
        XCTAssertEqual(did, "did:plc:fromfallback")
    }

    func testResolveHandleNotFoundOnlyWhenBothResolversSaySo() async {
        let transport = IdentityRoutedTransport(replies: [
            (Self.appviewResolve, .init(status: 400, body: #"{"error":"InvalidRequest"}"#)),
            (Self.fallbackResolve, .init(status: 400, body: #"{"error":"InvalidRequest"}"#)),
        ])
        let r = resolver(transport)
        let status = await r.resolveHandleStatus("nobody.example")
        XCTAssertEqual(status, .notFound)
        let did = await r.resolveHandle("nobody.example")
        XCTAssertNil(did)
        XCTAssertEqual(transport.count(containing: "resolveHandle"), 4, "misses are not cached")
    }

    func testResolveHandleUnavailableWhenAResolverIsDown() async {
        let appviewDown = IdentityRoutedTransport(replies: [
            (Self.appviewResolve, .init(status: 503, body: "upstream")),
            (Self.fallbackResolve, .init(status: 400, body: #"{"error":"InvalidRequest"}"#)),
        ])
        let fromAppviewDown = await resolver(appviewDown).resolveHandleStatus("alice.example")
        XCTAssertEqual(fromAppviewDown, .unavailable)

        let fallbackDown = IdentityRoutedTransport(replies: [
            (Self.appviewResolve, .init(status: 400, body: #"{"error":"InvalidRequest"}"#)),
            (Self.fallbackResolve, .init(status: 502, body: "bad gateway")),
        ])
        let fromFallbackDown = await resolver(fallbackDown).resolveHandleStatus("alice.example")
        XCTAssertEqual(fromFallbackDown, .unavailable)
    }

    func testResolveHandleTransportFailureIsUnavailableAndStillTriesTheFallback() async {
        let transport = IdentityRoutedTransport([
            (Self.appviewResolve, .fail(URLError(.timedOut))),
            (Self.fallbackResolve, .reply(.init(status: 200, body: #"{"did":"did:plc:fromfallback"}"#))),
        ])
        let did = await resolver(transport).resolveHandle("alice.example")
        XCTAssertEqual(did, "did:plc:fromfallback")
        // HTTPClient retries a transport failure once before giving up.
        XCTAssertEqual(transport.count(containing: "public.api.bsky.app"), 2)
        XCTAssertEqual(transport.count(containing: "bsky.social"), 1)

        let allDown = IdentityRoutedTransport([
            (Self.appviewResolve, .fail(URLError(.notConnectedToInternet))),
            (Self.fallbackResolve, .fail(URLError(.notConnectedToInternet))),
        ])
        let status = await resolver(allDown).resolveHandleStatus("alice.example")
        XCTAssertEqual(status, .unavailable)
    }

    func testResolveHandleCachesForFiveMinutes() async {
        let clock = ResolverClock()
        let transport = IdentityRoutedTransport(replies: [
            (Self.appviewResolve, .init(status: 200, body: #"{"did":"did:plc:cached"}"#)),
        ])
        let r = resolver(transport, clock: clock)
        _ = await r.resolveHandle("alice.example")
        clock.advance(5 * 60 - 1)
        let hit = await r.resolveHandle("alice.example")
        XCTAssertEqual(hit, "did:plc:cached")
        XCTAssertEqual(transport.requests.count, 1)

        clock.advance(2)
        _ = await r.resolveHandle("alice.example")
        XCTAssertEqual(transport.requests.count, 2, "expired after five minutes")
    }

    func testResolveHandleEncodesTheHandle() async {
        let transport = IdentityRoutedTransport(replies: [
            (Self.appviewResolve, .init(status: 200, body: #"{"did":"did:plc:x"}"#)),
        ])
        _ = await resolver(transport).resolveHandle("caf\u{E9}.example")
        XCTAssertEqual(transport.urls, ["https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=caf%C3%A9.example"])
    }

    // MARK: DID documents

    func testLoadDIDDocumentForDidPlcUsesPlcDirectoryAndRefusesRedirects() async throws {
        let transport = IdentityRoutedTransport(replies: [
            ("plc.directory", .init(status: 200, body: didDoc("did:plc:x", handle: "alice.example"))),
        ])
        let doc = try await resolver(transport).loadDIDDocument("did:plc:x")
        XCTAssertEqual(doc.id, "did:plc:x")
        XCTAssertEqual(doc.handle, "alice.example")
        XCTAssertEqual(transport.urls, ["https://plc.directory/did:plc:x"])
        XCTAssertEqual(transport.requests[0].value(forHTTPHeaderField: URLSessionTransport.noRedirectHeader), "1")
    }

    func testLoadDIDDocumentForDidWebUsesTheWellKnownPathAndRefusesRedirects() async throws {
        let transport = IdentityRoutedTransport(replies: [
            ("x.example/.well-known/did.json", .init(status: 200, body: didDoc("did:web:x.example", handle: "x.example"))),
        ])
        let doc = try await resolver(transport).loadDIDDocument("did:web:x.example")
        XCTAssertEqual(doc.id, "did:web:x.example")
        XCTAssertEqual(transport.urls, ["https://x.example/.well-known/did.json"])
        XCTAssertEqual(transport.requests[0].value(forHTTPHeaderField: URLSessionTransport.noRedirectHeader), "1")
    }

    func testDidWebDocumentURLHandlesPortsAndPaths() {
        XCTAssertEqual(IdentityResolver.didWebDocumentURL(for: "did:web:x.example")?.absoluteString, "https://x.example/.well-known/did.json")
        XCTAssertEqual(IdentityResolver.didWebDocumentURL(for: "did:web:localhost%3A3000")?.absoluteString, "https://localhost:3000/.well-known/did.json")
        XCTAssertEqual(IdentityResolver.didWebDocumentURL(for: "did:web:x.example:user:alice")?.absoluteString, "https://x.example/user/alice/did.json")
        XCTAssertEqual(IdentityResolver.didWebDocumentURL(for: "did:web:x.example%3A8443:dids:alice")?.absoluteString, "https://x.example:8443/dids/alice/did.json")
        XCTAssertNil(IdentityResolver.didWebDocumentURL(for: "did:web:"))
        XCTAssertNil(IdentityResolver.didWebDocumentURL(for: "did:web:x.example::alice"), "an empty path segment is not a did:web")
        XCTAssertNil(IdentityResolver.didWebDocumentURL(for: "did:web:x.example%2Fetc"), "a decoded slash would escape the host")
        XCTAssertNil(IdentityResolver.didWebDocumentURL(for: "did:plc:x"))
    }

    func testLoadDIDDocumentRejectsUnsupportedMethodsAndBadDidWebs() async {
        let transport = IdentityRoutedTransport(replies: [])
        let r = resolver(transport)
        do {
            _ = try await r.loadDIDDocument("did:key:z6Mk")
            XCTFail("expected unsupportedDIDMethod")
        } catch IdentityResolverError.unsupportedDIDMethod(let method) {
            XCTAssertEqual(method, "key")
        } catch {
            XCTFail("unexpected error \(error)")
        }
        do {
            _ = try await r.loadDIDDocument("did:web:")
            XCTFail("expected invalidDIDWeb")
        } catch IdentityResolverError.invalidDIDWeb {
            // expected
        } catch {
            XCTFail("unexpected error \(error)")
        }
        let none = await r.fetchDIDDocument("not-a-did")
        XCTAssertNil(none)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testFetchDIDDocumentFoldsEveryFailureToNil() async {
        let transport = IdentityRoutedTransport(replies: [
            ("did:plc:redirected", .init(status: 302, body: "", headers: ["Location": "https://elsewhere.example/doc"])),
            ("did:plc:missing", .init(status: 404, body: #"{"message":"DID not registered"}"#)),
            ("did:plc:garbage", .init(status: 200, body: "<html>")),
        ])
        let r = resolver(transport)
        let redirected = await r.fetchDIDDocument("did:plc:redirected")
        let missing = await r.fetchDIDDocument("did:plc:missing")
        let garbage = await r.fetchDIDDocument("did:plc:garbage")
        XCTAssertNil(redirected)
        XCTAssertNil(missing)
        XCTAssertNil(garbage)
        XCTAssertEqual(transport.requests.count, 3, "a refused redirect is never followed")
    }

    // MARK: resolvePDS

    func testResolvePDSFromAHandle() async {
        let transport = IdentityRoutedTransport(replies: [
            (Self.appviewResolve, .init(status: 200, body: #"{"did":"did:plc:x"}"#)),
            ("plc.directory", .init(status: 200, body: didDoc("did:plc:x", handle: "alice.example", pdsEndpoint: "https://pds.example/"))),
        ])
        let resolved = await resolver(transport).resolvePDS("alice.example")
        XCTAssertEqual(resolved?.did, "did:plc:x")
        XCTAssertEqual(resolved?.pdsEndpoint, "https://pds.example/", "verbatim from the document")
        XCTAssertEqual(resolved?.didDoc.handle, "alice.example")
    }

    func testResolvePDSIsNilWithoutAHandleOrAPDS() async {
        let noHandle = IdentityRoutedTransport(replies: [
            (Self.appviewResolve, .init(status: 400, body: "{}")),
            (Self.fallbackResolve, .init(status: 400, body: "{}")),
        ])
        let unresolved = await resolver(noHandle).resolvePDS("nobody.example")
        XCTAssertNil(unresolved)
        XCTAssertEqual(noHandle.count(containing: "plc.directory"), 0)

        let noPDS = IdentityRoutedTransport(replies: [
            ("plc.directory", .init(status: 200, body: didDoc("did:plc:x", handle: "alice.example", pdsEndpoint: nil))),
        ])
        let missingPDS = await resolver(noPDS).resolvePDS("did:plc:x")
        XCTAssertNil(missingPDS)
    }

    // MARK: resolveIdentifier (port of identity.test.ts)

    func testATakenDownRepoReportsItsStatusAndKeepsTheDIDDocumentHandle() async throws {
        let did = "did:plc:takendownaccount00000001"
        let transport = IdentityRoutedTransport(replies: [
            ("plc.directory", .init(status: 200, body: didDoc(did, handle: "gone.example"))),
            ("com.atproto.repo.describeRepo", .init(status: 400, body: #"{"error":"RepoTakendown","message":"Repo has been takendown: \#(did)"}"#)),
            ("com.atproto.sync.getRepoStatus", .init(status: 200, body: #"{"did":"\#(did)","active":false,"status":"takendown"}"#)),
        ])
        let identity = try await resolver(transport).resolveIdentifier(did)
        // describeRepo is the only source of the handle on the happy path, and
        // it just refused; the DID document has to cover for it.
        XCTAssertEqual(identity.handle, "gone.example")
        XCTAssertEqual(identity.pds, pds)
        XCTAssertEqual(identity.did, did)
        XCTAssertEqual(identity.repoStatus?.status, "takendown")
        XCTAssertTrue(identity.repoStatus?.error.contains("RepoTakendown") ?? false)
        XCTAssertTrue(transport.urls.contains { $0.contains("com.atproto.sync.getRepoStatus") })
    }

    func testAPDSThatNeverAnswersIsNotLabelledWithAStatus() async throws {
        let did = "did:plc:unreachablepds000000001"
        let transport = IdentityRoutedTransport(replies: [
            ("plc.directory", .init(status: 200, body: didDoc(did, handle: "quiet.example"))),
            ("com.atproto.repo.describeRepo", .init(status: 502, body: #"{"error":"BadGateway"}"#)),
            ("com.atproto.sync.getRepoStatus", .init(status: 502, body: #"{"error":"BadGateway"}"#)),
        ])
        let identity = try await resolver(transport).resolveIdentifier(did)
        // A host that's down says nothing about the account. Guessing
        // "inactive" here would put a takedown banner on an account that has none.
        XCTAssertNil(identity.repoStatus)
        XCTAssertEqual(identity.handle, "quiet.example")
    }

    func testAnActiveRepoCostsNoExtraRequest() async throws {
        let did = "did:plc:livehealthyaccount00001"
        let transport = IdentityRoutedTransport(replies: [
            ("plc.directory", .init(status: 200, body: didDoc(did, handle: "alive.example"))),
            ("com.atproto.repo.describeRepo", .init(status: 200, body: #"{"did":"\#(did)","handle":"alive.example","collections":["app.bsky.feed.post"]}"#)),
        ])
        let identity = try await resolver(transport).resolveIdentifier(did)
        XCTAssertNil(identity.repoStatus)
        XCTAssertEqual(identity.handle, "alive.example")
        // The status lookup hangs off the failure path only: every repo in the
        // network is the healthy case, and none of them should pay for it.
        XCTAssertFalse(transport.urls.contains { $0.contains("com.atproto.sync.getRepoStatus") })
    }

    func testAnActiveRepoThatReportsActiveAfterAFailedReadHasNoStatus() async throws {
        let did = "did:plc:livehealthyaccount00001"
        let transport = IdentityRoutedTransport(replies: [
            ("plc.directory", .init(status: 200, body: didDoc(did, handle: "alive.example"))),
            ("com.atproto.repo.describeRepo", .init(status: 500, body: "oops")),
            ("com.atproto.sync.getRepoStatus", .init(status: 200, body: #"{"did":"\#(did)","active":true}"#)),
        ])
        let identity = try await resolver(transport).resolveIdentifier(did)
        XCTAssertNil(identity.repoStatus, "only an affirmative inactive answer becomes a status")
        XCTAssertEqual(identity.handle, "alive.example")
    }

    func testResolveIdentifierAcceptsHandlesWithAtPrefixAndAtURIs() async throws {
        let did = "did:plc:livehealthyaccount00001"
        let transport = IdentityRoutedTransport(replies: [
            (Self.appviewResolve, .init(status: 200, body: #"{"did":"\#(did)"}"#)),
            ("plc.directory", .init(status: 200, body: didDoc(did, handle: "alive.example", pdsEndpoint: "https://pds.example/"))),
            ("com.atproto.repo.describeRepo", .init(status: 200, body: #"{"did":"\#(did)","handle":"alive.example","collections":[]}"#)),
        ])
        let r = resolver(transport)

        let fromAt = try await r.resolveIdentifier("  @alive.example ")
        XCTAssertEqual(fromAt.did, did)
        XCTAssertEqual(fromAt.pds, "https://pds.example", "trailing slash stripped")
        XCTAssertTrue(transport.urls[0].hasSuffix("handle=alive.example"), "the @ never reaches the resolver")

        let fromURI = try await r.resolveIdentifier("at://\(did)/app.bsky.feed.post/3k7abc")
        XCTAssertEqual(fromURI.did, did)
        XCTAssertEqual(fromURI.handle, "alive.example")

        let fromHandleURI = try await r.resolveIdentifier("at://alive.example")
        XCTAssertEqual(fromHandleURI.did, did)
        XCTAssertEqual(transport.count(containing: "resolveHandle"), 1, "the handle -> DID answer is cached")
    }

    func testResolveIdentifierThrowsOnEmptyAndUnresolvableInput() async {
        let transport = IdentityRoutedTransport(replies: [
            (Self.appviewResolve, .init(status: 400, body: "{}")),
            (Self.fallbackResolve, .init(status: 400, body: "{}")),
        ])
        let r = resolver(transport)
        do {
            _ = try await r.resolveIdentifier("   ")
            XCTFail("expected emptyInput")
        } catch IdentityResolverError.emptyInput {
            // expected
        } catch {
            XCTFail("unexpected error \(error)")
        }
        do {
            _ = try await r.resolveIdentifier("nobody.example")
            XCTFail("expected unresolvable")
        } catch IdentityResolverError.unresolvable(let input) {
            XCTAssertEqual(input, "nobody.example")
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testResolveIdentifierTreatsAnEmptyDescribeRepoHandleAsNone() async throws {
        let did = "did:plc:livehealthyaccount00001"
        let transport = IdentityRoutedTransport(replies: [
            ("plc.directory", .init(status: 200, body: didDoc(did, handle: "alive.example"))),
            ("com.atproto.repo.describeRepo", .init(status: 200, body: #"{"did":"\#(did)","handle":"","collections":[]}"#)),
        ])
        let identity = try await resolver(transport).resolveIdentifier(did)
        XCTAssertNil(identity.handle)
    }

    // MARK: resolveDIDHandle

    func testResolveDIDHandleReadsAlsoKnownAsAndCachesForThirtyMinutes() async {
        let clock = ResolverClock()
        let transport = IdentityRoutedTransport(replies: [
            ("plc.directory", .init(status: 200, body: didDoc("did:plc:x", handle: "alice.example"))),
        ])
        let r = resolver(transport, clock: clock)
        let first = await r.resolveDIDHandle("did:plc:x")
        XCTAssertEqual(first, "alice.example")
        clock.advance(30 * 60 - 1)
        let second = await r.resolveDIDHandle("did:plc:x")
        XCTAssertEqual(second, "alice.example")
        XCTAssertEqual(transport.requests.count, 1)
        clock.advance(2)
        _ = await r.resolveDIDHandle("did:plc:x")
        XCTAssertEqual(transport.requests.count, 2)
    }

    func testResolveDIDHandleCachesAMissAsWell() async {
        let transport = IdentityRoutedTransport(replies: [
            ("plc.directory", .init(status: 200, body: #"{"id":"did:plc:x"}"#)),
        ])
        let r = resolver(transport)
        let first = await r.resolveDIDHandle("did:plc:x")
        let second = await r.resolveDIDHandle("did:plc:x")
        XCTAssertNil(first)
        XCTAssertNil(second)
        XCTAssertEqual(transport.requests.count, 1, "\"no handle\" is an answer worth remembering")

        let notADID = await r.resolveDIDHandle("alice.example")
        XCTAssertNil(notADID)
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testResolveDIDHandleDeduplicatesConcurrentLookups() async {
        let transport = IdentityRoutedTransport(
            [("plc.directory", .reply(.init(status: 200, body: didDoc("did:plc:x", handle: "alice.example"))))],
            delayNanoseconds: 50_000_000
        )
        let r = resolver(transport)
        async let a = r.resolveDIDHandle("did:plc:x")
        async let b = r.resolveDIDHandle("did:plc:x")
        async let c = r.resolveDIDHandle("did:plc:x")
        let results = await [a, b, c]
        XCTAssertEqual(results, ["alice.example", "alice.example", "alice.example"])
        XCTAssertEqual(transport.requests.count, 1)
    }

    // MARK: inactiveRepoRev

    func testInactiveRepoRevAsksTheRelayAndCaches() async {
        let clock = ResolverClock()
        let transport = IdentityRoutedTransport(replies: [
            ("relay1.us-east.bsky.network", .init(status: 200, body: #"{"did":"did:plc:x","active":false,"status":"takendown","rev":"3lbrev"}"#)),
        ])
        let r = resolver(transport, clock: clock)
        let rev = await r.inactiveRepoRev("did:plc:x")
        XCTAssertEqual(rev, "3lbrev")
        XCTAssertEqual(transport.urls, ["https://relay1.us-east.bsky.network/xrpc/com.atproto.sync.getRepoStatus?did=did%3Aplc%3Ax"])
        _ = await r.inactiveRepoRev("did:plc:x")
        XCTAssertEqual(transport.requests.count, 1)
        clock.advance(5 * 60 + 1)
        _ = await r.inactiveRepoRev("did:plc:x")
        XCTAssertEqual(transport.requests.count, 2)
    }

    func testInactiveRepoRevIsNilOnFailureOrWithoutARev() async {
        let transport = IdentityRoutedTransport(replies: [
            ("did%3Aplc%3Anorev", .init(status: 200, body: #"{"did":"did:plc:norev","active":false}"#)),
            ("did%3Aplc%3Agone", .init(status: 404, body: #"{"error":"RepoNotFound"}"#)),
        ])
        let r = resolver(transport)
        let noRev = await r.inactiveRepoRev("did:plc:norev")
        let gone = await r.inactiveRepoRev("did:plc:gone")
        XCTAssertNil(noRev)
        XCTAssertNil(gone)
        _ = await r.inactiveRepoRev("did:plc:gone")
        XCTAssertEqual(transport.requests.count, 2, "a null answer is cached too")
    }

    func testInactiveRepoRevDeduplicatesConcurrentLookups() async {
        let transport = IdentityRoutedTransport(
            [("relay1", .reply(.init(status: 200, body: #"{"did":"did:plc:x","active":false,"rev":"3lbrev"}"#)))],
            delayNanoseconds: 50_000_000
        )
        let r = resolver(transport)
        async let a = r.inactiveRepoRev("did:plc:x")
        async let b = r.inactiveRepoRev("did:plc:x")
        let results = await [a, b]
        XCTAssertEqual(results, ["3lbrev", "3lbrev"])
        XCTAssertEqual(transport.requests.count, 1)
    }

    // MARK: fetchRepoCollections

    func testFetchRepoCollectionsReturnsTheDescribeRepoList() async {
        let transport = IdentityRoutedTransport(replies: [
            ("plc.directory", .init(status: 200, body: didDoc("did:plc:x", handle: "alice.example", pdsEndpoint: "https://pds.example/"))),
            ("com.atproto.repo.describeRepo", .init(status: 200, body: #"{"did":"did:plc:x","collections":["app.bsky.feed.post","sh.tangled.repo"]}"#)),
        ])
        let collections = await resolver(transport).fetchRepoCollections("did:plc:x")
        XCTAssertEqual(collections, ["app.bsky.feed.post", "sh.tangled.repo"])
        XCTAssertTrue(transport.urls.contains("https://pds.example/xrpc/com.atproto.repo.describeRepo?repo=did%3Aplc%3Ax"))
    }

    func testFetchRepoCollectionsKeepsAnEmptyListAndFoldsFailuresToNil() async {
        let empty = IdentityRoutedTransport(replies: [
            ("plc.directory", .init(status: 200, body: didDoc("did:plc:x", handle: "alice.example"))),
            ("com.atproto.repo.describeRepo", .init(status: 200, body: #"{"did":"did:plc:x","collections":[]}"#)),
        ])
        let none = await resolver(empty).fetchRepoCollections("did:plc:x")
        XCTAssertEqual(none, [], "an empty repo is a real answer")

        let failing = IdentityRoutedTransport(replies: [
            ("plc.directory", .init(status: 200, body: didDoc("did:plc:x", handle: "alice.example"))),
            ("com.atproto.repo.describeRepo", .init(status: 400, body: #"{"error":"RepoDeactivated"}"#)),
        ])
        let unknown = await resolver(failing).fetchRepoCollections("did:plc:x")
        XCTAssertNil(unknown)

        let notADID = await resolver(IdentityRoutedTransport(replies: [])).fetchRepoCollections("alice.example")
        XCTAssertNil(notADID)
    }

    // MARK: live

    func testLiveResolvesAturiToItsDIDAndPDS() async throws {
        let r = IdentityResolver.shared
        let resolution = await r.resolveHandleStatus("aturi.to")
        guard case .did(let did) = resolution else {
            if resolution == .unavailable { throw XCTSkip("handle resolver unavailable") }
            XCTFail("aturi.to should resolve to a DID")
            return
        }
        XCTAssertTrue(did.hasPrefix("did:"), did)

        let doc: DIDDocument
        do {
            doc = try await r.loadDIDDocument(did)
        } catch let error as HTTPError where error.status == 429 || error.status >= 500 {
            throw XCTSkip("DID directory answered \(error.status)")
        } catch let error as HTTPError {
            throw error
        } catch {
            throw XCTSkip("network unavailable: \(error)")
        }
        XCTAssertEqual(doc.id, did)
        XCTAssertEqual(doc.handle, "aturi.to")
        let endpoint = try XCTUnwrap(doc.pdsEndpoint)
        XCTAssertTrue(endpoint.hasPrefix("https://"), endpoint)

        let resolved = await r.resolvePDS("aturi.to")
        XCTAssertEqual(resolved?.did, did)
        XCTAssertEqual(resolved?.pdsEndpoint, endpoint)

        let bundle: IdentityBundle
        do {
            bundle = try await r.resolveIdentifier("@aturi.to")
        } catch {
            throw XCTSkip("resolveIdentifier could not complete: \(error)")
        }
        XCTAssertEqual(bundle.did, did)
        XCTAssertEqual(bundle.pds, endpoint.hasSuffix("/") ? String(endpoint.dropLast()) : endpoint)
        if bundle.repoStatus == nil {
            XCTAssertEqual(bundle.handle, "aturi.to")
        }

        let reverse = await r.resolveDIDHandle(did)
        XCTAssertEqual(reverse, "aturi.to")
    }
}
