import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport for the identity surfaces: the first pattern
/// found in the URL answers, anything else is a 404. An optional delay lets
/// a test cancel a load mid-flight.
private final class IdentityFakeTransport: HTTPTransport, @unchecked Sendable {
    enum Route {
        case reply(status: Int, body: String)
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

    var urls: [String] {
        lock.lock(); defer { lock.unlock() }
        return requests.compactMap { $0.url?.absoluteString }
    }

    func count(containing fragment: String) -> Int {
        urls.filter { $0.contains(fragment) }.count
    }
}

@MainActor
final class IdentityModelTests: XCTestCase {
    private typealias Route = IdentityFakeTransport.Route

    nonisolated private static let did = "did:plc:alice123"
    nonisolated private static let auditPath = "plc.directory/did:plc:alice123/log/audit"
    nonisolated private static let documentPath = "plc.directory/did:plc:alice123"
    nonisolated private static let relay = "relay1.us-east.bsky.network"
    nonisolated private static let resolveAppView = "public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle"
    nonisolated private static let resolveFallback = "bsky.social/xrpc/com.atproto.identity.resolveHandle"
    /// 2026-01-01T00:00:00Z, clock id 5.
    nonisolated private static let revTid = "3mbd3542k2227"
    nonisolated private static let revDate = Date(timeIntervalSince1970: 1_767_225_600)

    nonisolated private static let document = ##"{"@context":["https://www.w3.org/ns/did/v1"],"id":"did:plc:alice123","alsoKnownAs":["at://alice.test","https://alice.example"],"verificationMethod":[{"id":"did:plc:alice123#atproto","type":"Multikey","controller":"did:plc:alice123","publicKeyMultibase":"zQ3shKey"}],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}"##
    nonisolated private static let auditLog = #"[{"did":"did:plc:alice123","operation":{"type":"create","prev":null,"alsoKnownAs":["at://alice.test"],"services":{"atproto_pds":{"type":"AtprotoPersonalDataServer","endpoint":"https://pds.example"}},"rotationKeys":["did:key:k1"],"sig":"s1"},"cid":"cid1","nullified":false,"createdAt":"2024-01-01T00:00:00.000Z"},{"did":"did:plc:alice123","operation":{"type":"plc_operation","prev":"cid1","alsoKnownAs":["at://alice.new"],"services":{"atproto_pds":{"type":"AtprotoPersonalDataServer","endpoint":"https://pds.example"}},"rotationKeys":["did:key:k1","did:key:k2"],"sig":"s2"},"cid":"cid2","nullified":false,"createdAt":"2024-06-01T00:00:00.000Z"}]"#

    private func transport(overrides: [(String, Route)] = [], delayNanoseconds: UInt64 = 0) -> IdentityFakeTransport {
        let base: [(String, Route)] = [
            (Self.auditPath, .reply(status: 200, body: Self.auditLog)),
            (Self.documentPath, .reply(status: 200, body: Self.document)),
            (Self.relay, .reply(status: 200, body: #"{"did":"did:plc:alice123","active":false,"status":"takendown","rev":"\#(Self.revTid)"}"#)),
            (Self.resolveAppView, .reply(status: 200, body: #"{"did":"did:plc:alice123"}"#)),
            (Self.resolveFallback, .reply(status: 400, body: #"{"error":"InvalidRequest"}"#)),
        ]
        return IdentityFakeTransport(overrides + base, delayNanoseconds: delayNanoseconds)
    }

    private func identity(handle: String? = "alice.test", status: InactiveRepo? = nil, did: String = IdentityModelTests.did) -> IdentityBundle {
        IdentityBundle(did: did, handle: handle, pds: "https://pds.example", repoStatus: status)
    }

    private func makeModel(_ identity: IdentityBundle, transport: IdentityFakeTransport, now: Date = IdentityModelTests.revDate.addingTimeInterval(3 * 86_400)) -> IdentityModel {
        IdentityModel(identity: identity, http: HTTPClient(transport: transport), now: { now })
    }

    // MARK: Identity tab

    func testPlcDocumentIsSplitIntoSections() async {
        let transport = transport()
        let model = makeModel(identity(), transport: transport)
        XCTAssertTrue(model.isPlc)
        XCTAssertTrue(model.document.isIdle)
        await model.loadAndWait()

        XCTAssertEqual(model.document.value?.id, Self.did)
        XCTAssertEqual(model.alsoKnownAs, ["at://alice.test", "https://alice.example"])
        XCTAssertEqual(model.services.map(\.id), ["#atproto_pds"])
        XCTAssertEqual(model.services.first?.type, "AtprotoPersonalDataServer")
        XCTAssertEqual(model.services.first?.serviceEndpoint, "https://pds.example")
        XCTAssertEqual(model.verificationMethods.map(\.id), ["did:plc:alice123#atproto"])
        XCTAssertEqual(model.verificationMethods.first?.type, "Multikey")
        XCTAssertEqual(model.verificationMethods.first?.publicKeyMultibase, "zQ3shKey")
        guard let raw = model.rawDocumentJSON else { return XCTFail("expected the raw document") }
        XCTAssertTrue(raw.contains("\"@context\""), raw)
        XCTAssertTrue(raw.contains("did:plc:alice123"), raw)
        XCTAssertTrue(raw.contains("\n"), "pretty printed")

        XCTAssertEqual(transport.count(containing: Self.documentPath), 2, "the document and the log")
        XCTAssertEqual(transport.count(containing: Self.auditPath), 1)
        XCTAssertEqual(transport.count(containing: Self.relay), 0, "an active repo has no status facts")
        XCTAssertEqual(transport.count(containing: "resolveHandle"), 0)
        XCTAssertTrue(model.relayRev.isIdle)
        XCTAssertTrue(model.handleVerification.isIdle)
        XCTAssertFalse(model.hasStatusNotice)
        XCTAssertNil(model.statusNoticeCopy)
    }

    func testEmptyDocumentSectionsReadAsEmpty() async {
        let transport = transport(overrides: [(Self.documentPath, .reply(status: 200, body: #"{"id":"did:plc:alice123"}"#))])
        let model = makeModel(identity(), transport: transport)
        await model.loadAndWait()
        XCTAssertEqual(model.document.value?.id, Self.did)
        XCTAssertTrue(model.alsoKnownAs.isEmpty)
        XCTAssertTrue(model.services.isEmpty)
        XCTAssertTrue(model.verificationMethods.isEmpty)
    }

    // MARK: Audit tab

    func testAuditEntriesAreNewestFirstWithDiffs() async {
        let transport = transport()
        let model = makeModel(identity(), transport: transport)
        await model.loadAndWait()

        XCTAssertEqual(model.auditLog.value?.count, 2, "the log itself stays oldest first")
        XCTAssertFalse(model.hasNoOperations)
        let entries = model.auditEntries
        XCTAssertEqual(entries.map(\.id), ["cid2", "cid1"])
        XCTAssertEqual(entries.map(\.type), ["plc_operation", "create"])
        XCTAssertEqual(entries[0].changes, ["+ handle at://alice.new", "\u{2212} handle at://alice.test", "keys rotated"])
        XCTAssertEqual(entries[1].changes, ["+ handle at://alice.test", "services updated", "keys rotated"])
        XCTAssertEqual(entries[0].createdAt, "2024-06-01T00:00:00.000Z")
        XCTAssertEqual(entries[0].timestamp, Formatting.isoDate("2024-06-01T00:00:00.000Z"))
        XCTAssertFalse(entries[0].isNullified)
        XCTAssertTrue(entries[0].rawJSON.contains("\"prev\""), entries[0].rawJSON)
        XCTAssertTrue(entries[0].rawJSON.contains("cid1"), "the raw operation carries the prev pointer")
        XCTAssertTrue(entries[1].rawJSON.contains("did:key:k1"))
    }

    func testMissingTypeFallsBackOnPrev() async {
        let log = #"[{"did":"did:plc:alice123","operation":{"prev":null,"alsoKnownAs":["at://a"]},"createdAt":"2024-01-01T00:00:00Z"},{"did":"did:plc:alice123","operation":{"prev":"x","alsoKnownAs":["at://a"]},"createdAt":"2024-01-02T00:00:00Z"}]"#
        let transport = transport(overrides: [(Self.auditPath, .reply(status: 200, body: log))])
        let model = makeModel(identity(), transport: transport)
        await model.loadAndWait()
        let entries = model.auditEntries
        XCTAssertEqual(entries.map(\.type), ["update", "create"])
        XCTAssertEqual(entries.map(\.id), ["2024-01-02T00:00:00Z-0", "2024-01-01T00:00:00Z-1"], "entries without a CID are keyed by time and position")
        XCTAssertEqual(entries[0].changes, [], "same handle, no services, no keys")
        XCTAssertEqual(entries[1].changes, ["+ handle at://a"])
    }

    func testEmptyAuditLogIsNoOperations() async {
        let transport = transport(overrides: [(Self.auditPath, .reply(status: 200, body: "[]"))])
        let model = makeModel(identity(), transport: transport)
        await model.loadAndWait()
        XCTAssertEqual(model.auditLog, .loaded([]))
        XCTAssertTrue(model.hasNoOperations)
        XCTAssertTrue(model.auditEntries.isEmpty)
        XCTAssertEqual(IdentityModel.noOperationsMessage, "No PLC operations recorded.")
    }

    func testDirectoryErrorsSurfaceAsMessages() async {
        let transport = transport(overrides: [
            (Self.auditPath, .reply(status: 500, body: "boom")),
            (Self.documentPath, .reply(status: 404, body: #"{"message":"DID not registered"}"#)),
        ])
        let model = makeModel(identity(), transport: transport)
        await model.loadAndWait()
        guard let documentError = model.document.errorMessage else { return XCTFail("expected the document to fail") }
        XCTAssertTrue(documentError.hasPrefix("HTTP 404 "), documentError)
        XCTAssertTrue(documentError.hasSuffix(":: {\"message\":\"DID not registered\"}"), documentError)
        guard let logError = model.auditLog.errorMessage else { return XCTFail("expected the log to fail") }
        XCTAssertTrue(logError.hasPrefix("HTTP 500 "), logError)
        XCTAssertTrue(logError.hasSuffix(":: boom"), logError)
        XCTAssertTrue(model.alsoKnownAs.isEmpty)
        XCTAssertTrue(model.auditEntries.isEmpty)
        XCTAssertFalse(model.hasNoOperations, "a failed log is not an empty one")
    }

    func testTransportFailureIsDescribed() async {
        let transport = transport(overrides: [(Self.documentPath, .fail(URLError(.notConnectedToInternet)))])
        let model = makeModel(identity(), transport: transport)
        await model.loadAndWait()
        XCTAssertTrue(model.document.isFailed)
        XCTAssertFalse(model.document.errorMessage?.isEmpty ?? true)
    }

    func testNonPlcDidHasNoDirectoryData() async {
        let transport = transport()
        let model = makeModel(identity(did: "did:web:alice.example"), transport: transport)
        XCTAssertFalse(model.isPlc)
        await model.loadAndWait()
        XCTAssertTrue(model.document.isIdle)
        XCTAssertTrue(model.auditLog.isIdle)
        XCTAssertTrue(model.auditEntries.isEmpty)
        XCTAssertTrue(transport.requests.isEmpty)
        XCTAssertEqual(IdentityModel.identityNotPlcMessage(for: "did:web:alice.example"), "did:web:alice.example isn\u{2019}t a did:plc:. PLC directory data isn\u{2019}t available for this method.")
        XCTAssertEqual(IdentityModel.auditNotPlcMessage, "Audit log only available for did:plc: DIDs.")
    }

    // MARK: Repo status notice

    func testStatusNoticeCopyAndFacts() async {
        let transport = transport()
        let inactive = InactiveRepo(status: "takendown", error: "HTTP 400 for https://pds.example/xrpc/com.atproto.repo.describeRepo :: {\"error\":\"RepoTakendown\"}")
        let model = makeModel(identity(status: inactive), transport: transport)
        XCTAssertTrue(model.hasStatusNotice)
        XCTAssertEqual(model.statusLabel, "takendown")
        XCTAssertEqual(model.statusNoticeCopy, IdentityModel.statusCopy["takendown"])
        XCTAssertEqual(model.statusNoticeCopy?.headline, "This repo has been taken down.")
        XCTAssertEqual(model.statusAccessibilityLabel, "Repo status: takendown")
        XCTAssertEqual(model.pdsHostname, "pds.example")
        XCTAssertEqual(model.handleValue, "@alice.test")

        model.load()
        XCTAssertEqual(model.handleNote, "checking\u{2026}")
        XCTAssertEqual(model.revNote, "checking\u{2026}")
        XCTAssertNil(model.revValue)
        await model.awaitLoad()

        XCTAssertEqual(model.relayRev, .loaded(Self.revTid))
        XCTAssertEqual(model.revValue, Self.revTid)
        XCTAssertEqual(model.revDate, Self.revDate)
        XCTAssertEqual(model.revNote, "last rev seen by the relay \u{00B7} 3d ago")
        XCTAssertEqual(model.revTitle, "2026-01-01T00:00:00.000Z")
        XCTAssertEqual(model.handleVerification, .loaded(.verified))
        XCTAssertEqual(model.handleNote, "still resolves to this DID")
        XCTAssertEqual(transport.count(containing: "getRepoStatus?did=did%3Aplc%3Aalice123"), 1)
        XCTAssertEqual(transport.count(containing: "resolveHandle?handle=alice.test"), 1)
        XCTAssertEqual(model.document.value?.id, Self.did, "the document and log load alongside the facts")
        XCTAssertFalse(IdentityModel.identityUntouchedNote.isEmpty)
    }

    func testHandleThatMovedIsFlagged() async {
        let transport = transport(overrides: [(Self.resolveAppView, .reply(status: 200, body: #"{"did":"did:plc:somebodyelse"}"#))])
        let model = makeModel(identity(status: InactiveRepo(status: "suspended", error: "x")), transport: transport)
        await model.loadAndWait()
        XCTAssertEqual(model.handleVerification, .loaded(.mismatch))
        XCTAssertEqual(model.handleNote, "now resolves to a different DID")
        XCTAssertEqual(model.statusNoticeCopy?.headline, "This repo is suspended.")
    }

    func testUnverifiableHandleIsSaidSo() async {
        let transport = transport(overrides: [
            (Self.resolveAppView, .reply(status: 503, body: "down")),
            (Self.resolveFallback, .reply(status: 503, body: "down")),
        ])
        let model = makeModel(identity(status: InactiveRepo(status: "deactivated", error: "x")), transport: transport)
        await model.loadAndWait()
        XCTAssertEqual(model.handleVerification, .loaded(.unverified))
        XCTAssertEqual(model.handleNote, "claimed in the DID document, could not be verified")
        XCTAssertEqual(model.statusNoticeCopy?.headline, "This account is deactivated.")
    }

    func testDocumentWithoutAHandleSkipsTheCheck() async {
        let transport = transport()
        let model = makeModel(identity(handle: nil, status: InactiveRepo(status: "deleted", error: "x")), transport: transport)
        await model.loadAndWait()
        XCTAssertEqual(model.handleValue, "\u{2014}")
        XCTAssertEqual(model.handleNote, "no at:// entry in the DID document")
        XCTAssertEqual(model.handleVerification, .loaded(.unverified))
        XCTAssertEqual(transport.count(containing: "resolveHandle"), 0)
        XCTAssertEqual(model.statusNoticeCopy?.headline, "This repo has been deleted.")

        let blank = makeModel(identity(handle: "", status: InactiveRepo(status: "deleted", error: "x")), transport: transport)
        XCTAssertEqual(blank.handleNote, "no at:// entry in the DID document", "an empty handle is no handle")
    }

    func testUnknownAndMissingStatusesFallBack() async {
        let transport = transport()
        let frozen = makeModel(identity(status: InactiveRepo(status: "frozen", error: "x")), transport: transport)
        XCTAssertEqual(frozen.statusLabel, "frozen")
        XCTAssertEqual(frozen.statusNoticeCopy, RepoStatusCopy(headline: "This repo is marked frozen.", detail: "Its host refuses record reads while the repo is in this state."))

        let unnamed = makeModel(identity(status: InactiveRepo(status: nil, error: "x")), transport: transport)
        XCTAssertEqual(unnamed.statusLabel, "inactive")
        XCTAssertEqual(unnamed.statusNoticeCopy?.headline, "This repo is marked inactive.")
        XCTAssertEqual(unnamed.statusAccessibilityLabel, "Repo status: inactive")

        let empty = makeModel(identity(status: InactiveRepo(status: "", error: "x")), transport: transport)
        XCTAssertEqual(empty.statusLabel, "inactive")
    }

    func testRevNotesWhenTheRelayHasNoneOrANonTid() async {
        let none = transport(overrides: [(Self.relay, .reply(status: 200, body: #"{"did":"did:plc:alice123","active":false}"#))])
        let noneModel = makeModel(identity(status: InactiveRepo(status: "takendown", error: "x")), transport: none)
        await noneModel.loadAndWait()
        XCTAssertEqual(noneModel.relayRev, .loaded(nil))
        XCTAssertNil(noneModel.revValue)
        XCTAssertNil(noneModel.revDate)
        XCTAssertEqual(noneModel.revNote, "no rev available")
        XCTAssertNil(noneModel.revTitle)

        let opaque = transport(overrides: [(Self.relay, .reply(status: 200, body: #"{"did":"did:plc:alice123","active":false,"rev":"not-a-tid"}"#))])
        let opaqueModel = makeModel(identity(status: InactiveRepo(status: "takendown", error: "x")), transport: opaque)
        await opaqueModel.loadAndWait()
        XCTAssertEqual(opaqueModel.revValue, "not-a-tid", "the value is printed as the relay sent it")
        XCTAssertNil(opaqueModel.revDate)
        XCTAssertEqual(opaqueModel.revNote, "no rev available")

        let down = transport(overrides: [(Self.relay, .reply(status: 502, body: "bad gateway"))])
        let downModel = makeModel(identity(status: InactiveRepo(status: "takendown", error: "x")), transport: down)
        await downModel.loadAndWait()
        XCTAssertEqual(downModel.relayRev, .loaded(nil))
        XCTAssertEqual(downModel.revNote, "no rev available")
    }

    func testPdsHostnameFallsBackToTheRawValue() {
        let transport = transport()
        let bare = IdentityModel(identity: IdentityBundle(did: Self.did, handle: nil, pds: "pds.example"), http: HTTPClient(transport: transport))
        XCTAssertEqual(bare.pdsHostname, "pds.example")
        let withPort = IdentityModel(identity: IdentityBundle(did: Self.did, handle: nil, pds: "https://pds.example:8443/"), http: HTTPClient(transport: transport))
        XCTAssertEqual(withPort.pdsHostname, "pds.example")
    }

    // MARK: Reload and cancellation

    func testReloadReplacesTheLoadInFlight() async {
        let transport = transport(delayNanoseconds: 30_000_000)
        let model = makeModel(identity(status: InactiveRepo(status: "takendown", error: "x")), transport: transport)
        model.load()
        XCTAssertTrue(model.document.isLoading)
        XCTAssertTrue(model.auditLog.isLoading)
        XCTAssertTrue(model.relayRev.isLoading)
        XCTAssertTrue(model.handleVerification.isLoading)
        model.cancel()
        await model.awaitLoad()
        XCTAssertTrue(model.document.isLoading, "a cancelled load never settles")

        model.reload()
        await model.awaitLoad()
        XCTAssertEqual(model.document.value?.id, Self.did)
        XCTAssertEqual(model.auditEntries.count, 2)
        XCTAssertEqual(model.revValue, Self.revTid)
        XCTAssertEqual(model.handleVerification, .loaded(.verified))
    }
}
