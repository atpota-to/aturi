import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private final class PLCRoutedTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
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
            ?? Reply(status: 404, body: #"{"message":"DID not registered: x"}"#)
        let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: nil)!
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

private final class SteppingClock: @unchecked Sendable {
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

final class PLCClientTests: XCTestCase {
    private let did = "did:plc:livehealthyaccount00001"

    private let document = """
    {"@context":["https://www.w3.org/ns/did/v1","https://w3id.org/security/multikey/v1"],"id":"did:plc:livehealthyaccount00001","alsoKnownAs":["at://alive.example"],"verificationMethod":[{"id":"did:plc:livehealthyaccount00001#atproto","type":"Multikey","controller":"did:plc:livehealthyaccount00001","publicKeyMultibase":"zQ3shExample"}],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}
    """

    private let audit = """
    [{"did":"did:plc:livehealthyaccount00001","operation":{"sig":"sig1","prev":null,"type":"plc_operation","services":{"atproto_pds":{"type":"AtprotoPersonalDataServer","endpoint":"https://pds.example"}},"alsoKnownAs":["at://old.example"],"rotationKeys":["did:key:zRot1"],"verificationMethods":{"atproto":"did:key:zVer1"}},"cid":"bafyop1","nullified":false,"createdAt":"2025-12-28T03:05:51.521Z"},{"did":"did:plc:livehealthyaccount00001","operation":{"sig":"sig2","prev":"bafyop1","type":"plc_operation","services":{"atproto_pds":{"type":"AtprotoPersonalDataServer","endpoint":"https://pds.example"}},"alsoKnownAs":["at://alive.example"],"rotationKeys":["did:key:zRot1"],"verificationMethods":{"atproto":"did:key:zVer1"}},"cid":"bafyop2","nullified":false,"createdAt":"2025-12-28T03:17:07.689Z"}]
    """

    private func client(_ transport: PLCRoutedTransport, clock: SteppingClock = SteppingClock()) -> PLCClient {
        PLCClient(http: HTTPClient(transport: transport)) { clock.now }
    }

    // MARK: document

    func testDocumentFetchesFromPlcDirectoryAndDecodes() async throws {
        let transport = PLCRoutedTransport([(did, .init(status: 200, body: document))])
        let doc = try await client(transport).document(did: did)

        XCTAssertEqual(transport.urls, ["https://plc.directory/did:plc:livehealthyaccount00001"])
        XCTAssertEqual(doc.id, did)
        XCTAssertEqual(doc.context, ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"])
        XCTAssertEqual(doc.alsoKnownAs, ["at://alive.example"])
        XCTAssertEqual(doc.verificationMethod?.first?.publicKeyMultibase, "zQ3shExample")
        XCTAssertEqual(doc.service?.first?.serviceEndpoint, "https://pds.example")
        XCTAssertEqual(doc.didDocument.pdsEndpoint, "https://pds.example")
        XCTAssertEqual(doc.didDocument.handle, "alive.example")
    }

    func testDocumentIsCachedForThirtySeconds() async throws {
        let clock = SteppingClock()
        let transport = PLCRoutedTransport([(did, .init(status: 200, body: document))])
        let plc = client(transport, clock: clock)

        _ = try await plc.document(did: did)
        clock.advance(29)
        _ = try await plc.document(did: did)
        XCTAssertEqual(transport.requests.count, 1, "second read within the TTL is served from cache")

        clock.advance(2)
        _ = try await plc.document(did: did)
        XCTAssertEqual(transport.requests.count, 2, "expired entries are refetched")
    }

    func testDocumentRequiresADid() async {
        let transport = PLCRoutedTransport([])
        do {
            _ = try await client(transport).document(did: "")
            XCTFail("expected missingDid")
        } catch PLCClientError.missingDid {
            // expected
        } catch {
            XCTFail("unexpected error \(error)")
        }
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testDocument404IsAnHTTPErrorAndNotCached() async {
        let transport = PLCRoutedTransport([])
        let plc = client(transport)
        for _ in 0..<2 {
            do {
                _ = try await plc.document(did: "did:plc:unregistered0000000000")
                XCTFail("expected HTTPError")
            } catch let error as HTTPError {
                XCTAssertEqual(error.status, 404)
                XCTAssertTrue(error.body.contains("not registered"))
            } catch {
                XCTFail("unexpected error \(error)")
            }
        }
        XCTAssertEqual(transport.requests.count, 2, "failures are not cached")
    }

    // MARK: auditLog

    func testAuditLogFetchesAndDecodesInOrder() async throws {
        let transport = PLCRoutedTransport([("/log/audit", .init(status: 200, body: audit))])
        let log = try await client(transport).auditLog(did: did)

        XCTAssertEqual(transport.urls, ["https://plc.directory/did:plc:livehealthyaccount00001/log/audit"])
        XCTAssertEqual(log.count, 2)
        XCTAssertEqual(log[0].did, did)
        XCTAssertEqual(log[0].cid, "bafyop1")
        XCTAssertEqual(log[0].nullified, false)
        XCTAssertEqual(log[0].createdAt, "2025-12-28T03:05:51.521Z")
        XCTAssertEqual(log[0].createdDate, Formatting.isoDate("2025-12-28T03:05:51.521Z"))
        XCTAssertNil(log[0].operation.prev, "JSON null decodes as absent")
        XCTAssertEqual(log[0].operation.type, "plc_operation")
        XCTAssertEqual(log[0].operation.alsoKnownAs, ["at://old.example"])
        XCTAssertEqual(log[0].operation.services, ["atproto_pds": PlcOperation.ServiceEntry(type: "AtprotoPersonalDataServer", endpoint: "https://pds.example")])
        XCTAssertEqual(log[0].operation.rotationKeys, ["did:key:zRot1"])
        XCTAssertEqual(log[0].operation.verificationMethods, ["atproto": "did:key:zVer1"])
        XCTAssertEqual(log[0].operation.sig, "sig1")
        XCTAssertEqual(log[1].operation.prev, "bafyop1")
        XCTAssertEqual(log[1].operation.alsoKnownAs, ["at://alive.example"])
    }

    func testAuditLogIsCachedForThirtySeconds() async throws {
        let clock = SteppingClock()
        let transport = PLCRoutedTransport([("/log/audit", .init(status: 200, body: audit))])
        let plc = client(transport, clock: clock)
        _ = try await plc.auditLog(did: did)
        _ = try await plc.auditLog(did: did)
        XCTAssertEqual(transport.requests.count, 1)
        clock.advance(31)
        _ = try await plc.auditLog(did: did)
        XCTAssertEqual(transport.requests.count, 2)
    }

    func testAuditLogRequiresADid() async {
        let transport = PLCRoutedTransport([])
        do {
            _ = try await client(transport).auditLog(did: "")
            XCTFail("expected missingDid")
        } catch PLCClientError.missingDid {
            // expected
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testAuditLogDecodesLegacyAndTombstoneEntriesLeniently() async throws {
        // A legacy `create` op carries none of the plc_operation fields, a
        // tombstone carries only prev and sig, and a hostile or future
        // directory might change a field's type. None of that should take
        // the whole log down.
        let legacy = """
        [{"did":"did:plc:x","operation":{"type":"create","signingKey":"did:key:zSign","recoveryKey":"did:key:zRec","handle":"old.example","service":"https://bsky.social","prev":null,"sig":"s"},"cid":"bafylegacy","nullified":false,"createdAt":"2023-01-01T00:00:00.000Z"},{"did":"did:plc:x","operation":{"type":"plc_tombstone","prev":"bafylegacy","sig":"t"},"cid":"bafytomb","nullified":true,"createdAt":"2024-01-01T00:00:00.000Z"},{"did":"did:plc:x","operation":{"type":42,"services":"not a map","alsoKnownAs":"not an array","rotationKeys":[1,2],"verificationMethods":["nope"]},"createdAt":123}]
        """
        let transport = PLCRoutedTransport([("/log/audit", .init(status: 200, body: legacy))])
        let log = try await client(transport).auditLog(did: "did:plc:x")

        XCTAssertEqual(log.count, 3)
        XCTAssertEqual(log[0].operation.type, "create")
        XCTAssertNil(log[0].operation.services)
        XCTAssertNil(log[0].operation.alsoKnownAs)
        XCTAssertEqual(log[1].operation.type, "plc_tombstone")
        XCTAssertEqual(log[1].operation.prev, "bafylegacy")
        XCTAssertEqual(log[1].nullified, true)
        XCTAssertNil(log[2].operation.type)
        XCTAssertNil(log[2].operation.services)
        XCTAssertNil(log[2].operation.alsoKnownAs)
        XCTAssertNil(log[2].operation.rotationKeys)
        XCTAssertNil(log[2].operation.verificationMethods)
        XCTAssertEqual(log[2].createdAt, "")
        XCTAssertNil(log[2].createdDate)
        XCTAssertNil(log[2].cid)
    }

    // MARK: diffOps

    func testDiffOpsWithNoNextIsEmpty() {
        XCTAssertEqual(PLCClient.diffOps(prev: PlcOperation(alsoKnownAs: ["at://a.example"]), next: nil), [])
    }

    func testDiffOpsFirstOperationAddsEverything() {
        let first = PlcOperation(
            alsoKnownAs: ["at://a.example"],
            services: ["atproto_pds": .init(type: "AtprotoPersonalDataServer", endpoint: "https://pds.example")],
            rotationKeys: ["did:key:zRot1"]
        )
        XCTAssertEqual(PLCClient.diffOps(prev: nil, next: first), ["+ handle at://a.example", "services updated", "keys rotated"])
    }

    func testDiffOpsHandleChanges() {
        let prev = PlcOperation(alsoKnownAs: ["at://old.example", "at://kept.example"])
        let next = PlcOperation(alsoKnownAs: ["at://kept.example", "at://new.example"])
        XCTAssertEqual(PLCClient.diffOps(prev: prev, next: next), ["+ handle at://new.example", "\u{2212} handle at://old.example"])
    }

    func testDiffOpsIdenticalOperationsProduceNothing() {
        let op = PlcOperation(
            alsoKnownAs: ["at://a.example"],
            services: ["atproto_pds": .init(type: "AtprotoPersonalDataServer", endpoint: "https://pds.example")],
            rotationKeys: ["did:key:zRot1"],
            verificationMethods: ["atproto": "did:key:zVer1"]
        )
        XCTAssertEqual(PLCClient.diffOps(prev: op, next: op), [])
    }

    func testDiffOpsServicesUpdated() {
        let prev = PlcOperation(services: ["atproto_pds": .init(type: "AtprotoPersonalDataServer", endpoint: "https://old.example")])
        let next = PlcOperation(services: ["atproto_pds": .init(type: "AtprotoPersonalDataServer", endpoint: "https://new.example")])
        XCTAssertEqual(PLCClient.diffOps(prev: prev, next: next), ["services updated"])

        let added = PlcOperation(services: [
            "atproto_pds": .init(type: "AtprotoPersonalDataServer", endpoint: "https://old.example"),
            "atproto_labeler": .init(type: "AtprotoLabeler", endpoint: "https://labeler.example"),
        ])
        XCTAssertEqual(PLCClient.diffOps(prev: prev, next: added), ["services updated"])
        XCTAssertEqual(PLCClient.diffOps(prev: PlcOperation(services: [:]), next: PlcOperation()), [], "absent and empty are the same map")
    }

    func testDiffOpsKeysRotatedWhenRotationKeysChange() {
        let prev = PlcOperation(rotationKeys: ["did:key:zRot1"], verificationMethods: ["atproto": "did:key:zVer1"])
        let rotated = PlcOperation(rotationKeys: ["did:key:zRot2"], verificationMethods: ["atproto": "did:key:zVer1"])
        XCTAssertEqual(PLCClient.diffOps(prev: prev, next: rotated), ["keys rotated"])

        // rotationKeys wins over verificationMethods, as `a || b` does: a
        // signing-key change alone is invisible while rotationKeys is set.
        let signingOnly = PlcOperation(rotationKeys: ["did:key:zRot1"], verificationMethods: ["atproto": "did:key:zVer2"])
        XCTAssertEqual(PLCClient.diffOps(prev: prev, next: signingOnly), [])
    }

    func testDiffOpsKeysRotatedFallsBackToVerificationMethods() {
        let prev = PlcOperation(verificationMethods: ["atproto": "did:key:zVer1"])
        let next = PlcOperation(verificationMethods: ["atproto": "did:key:zVer2"])
        XCTAssertEqual(PLCClient.diffOps(prev: prev, next: next), ["keys rotated"])
        XCTAssertEqual(PLCClient.diffOps(prev: prev, next: prev), [])
    }

    func testDiffOpsRepresentationSwitchesReadAsRotationLikeTheWeb() {
        // "[]" vs "{}" differ once stringified, so an empty rotationKeys array
        // against nothing counts as a rotation; "{}" vs "{}" does not.
        XCTAssertEqual(PLCClient.diffOps(prev: PlcOperation(rotationKeys: []), next: PlcOperation()), ["keys rotated"])
        XCTAssertEqual(PLCClient.diffOps(prev: PlcOperation(verificationMethods: [:]), next: PlcOperation()), [])
        XCTAssertEqual(
            PLCClient.diffOps(prev: PlcOperation(verificationMethods: ["atproto": "k"]), next: PlcOperation(rotationKeys: ["k"])),
            ["keys rotated"]
        )
    }

    func testDiffOpsAgainstTheFixtureLog() async throws {
        let transport = PLCRoutedTransport([("/log/audit", .init(status: 200, body: audit))])
        let log = try await client(transport).auditLog(did: did)
        XCTAssertEqual(PLCClient.diffOps(prev: log[0].operation, next: log[1].operation), ["+ handle at://alive.example", "\u{2212} handle at://old.example"])
    }

    // MARK: extractPds

    func testExtractPdsPrefersTheAtprotoPdsId() {
        let doc = PlcDocument(id: "did:plc:x", service: [
            .init(id: "#atproto_labeler", type: "AtprotoLabeler", serviceEndpoint: "https://labeler.example"),
            .init(id: "#other", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://typed.example"),
            .init(id: "#atproto_pds", type: "Whatever", serviceEndpoint: "https://byid.example/"),
        ])
        XCTAssertEqual(PLCClient.extractPds(from: doc), "https://byid.example", "trailing slash stripped")
    }

    func testExtractPdsFallsBackToTypeThenFirstService() {
        let byType = PlcDocument(id: "did:plc:x", service: [
            .init(id: "#atproto_labeler", type: "AtprotoLabeler", serviceEndpoint: "https://labeler.example"),
            .init(id: "#other", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://typed.example"),
        ])
        XCTAssertEqual(PLCClient.extractPds(from: byType), "https://typed.example")

        let first = PlcDocument(id: "did:plc:x", service: [
            .init(id: "#atproto_labeler", type: "AtprotoLabeler", serviceEndpoint: "https://labeler.example"),
        ])
        XCTAssertEqual(PLCClient.extractPds(from: first), "https://labeler.example")

        let emptyThenTyped = PlcDocument(id: "did:plc:x", service: [
            .init(id: "#atproto_pds", type: "Something", serviceEndpoint: ""),
            .init(id: "#other", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://typed.example"),
        ])
        XCTAssertEqual(PLCClient.extractPds(from: emptyThenTyped), "https://typed.example", "an empty endpoint is skipped like a falsy one")
    }

    func testExtractPdsIsNilWithoutServices() {
        XCTAssertNil(PLCClient.extractPds(from: PlcDocument(id: "did:plc:x")))
        XCTAssertNil(PLCClient.extractPds(from: PlcDocument(id: "did:plc:x", service: [])))
        XCTAssertNil(PLCClient.extractPds(from: PlcDocument(id: "did:plc:x", service: [.init(id: "#a", type: "b", serviceEndpoint: "")])))
    }

    func testPlcDocumentRoundTripsWithContextKey() throws {
        let doc = try JSONDecoder().decode(PlcDocument.self, from: Data(document.utf8))
        let data = try JSONEncoder().encode(doc)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertNotNil(object?["@context"], "encodes back under the JSON-LD key")
        XCTAssertEqual(try JSONDecoder().decode(PlcDocument.self, from: data), doc)
    }

    // MARK: live

    func testLiveAuditLogForAturiTo() async throws {
        let resolution = await IdentityResolver.shared.resolveHandleStatus("aturi.to")
        guard case .did(let did) = resolution else {
            if resolution == .unavailable { throw XCTSkip("handle resolver unavailable") }
            XCTFail("aturi.to should resolve")
            return
        }
        guard did.hasPrefix("did:plc:") else { throw XCTSkip("aturi.to is not a did:plc; nothing to audit") }

        let log: [PlcAuditEntry]
        let doc: PlcDocument
        do {
            log = try await PLCClient.shared.auditLog(did: did)
            doc = try await PLCClient.shared.document(did: did)
        } catch let error as HTTPError where error.status == 429 || error.status >= 500 {
            throw XCTSkip("plc.directory answered \(error.status)")
        } catch let error as HTTPError {
            throw error
        } catch {
            throw XCTSkip("network unavailable: \(error)")
        }

        XCTAssertEqual(doc.id, did)
        XCTAssertEqual(doc.didDocument.handle, "aturi.to")
        XCTAssertNotNil(PLCClient.extractPds(from: doc))
        XCTAssertFalse(log.isEmpty)
        XCTAssertTrue(log.allSatisfy { $0.did == did })
        XCTAssertNil(log[0].operation.prev, "the genesis op has no prev")
        XCTAssertNotNil(log[0].createdDate)
        XCTAssertEqual(log.last?.operation.alsoKnownAs?.first, "at://aturi.to")
    }
}
