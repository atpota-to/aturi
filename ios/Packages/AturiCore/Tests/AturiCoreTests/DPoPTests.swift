import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A key whose signature is a function of the input alone, so a proof can be
/// checked byte for byte: sha256(input) || sha256(sha256(input)).
private struct FakeDPoPKey: DPoPKey {
    var x = OAuthBase64URL.encode(Data((1...32).map { UInt8($0) }))
    var y = OAuthBase64URL.encode(Data((33...64).map { UInt8($0) }))

    var publicJWK: [String: String] {
        ["kty": "EC", "crv": "P-256", "x": x, "y": y]
    }

    func sign(_ data: Data) throws -> Data {
        let first = OAuthSHA256.hash(data)
        return first + OAuthSHA256.hash(first)
    }
}

private struct ShortSignatureKey: DPoPKey {
    var publicJWK: [String: String] { FakeDPoPKey().publicJWK }
    func sign(_ data: Data) throws -> Data { Data([1, 2, 3]) }
}

private struct BadJWKKey: DPoPKey {
    var publicJWK: [String: String] { ["kty": "EC", "crv": "P-256", "x": "short", "y": "short"] }
    func sign(_ data: Data) throws -> Data { Data(repeating: 0, count: 64) }
}

private final class DPoPFakeTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var outcomes: [(Data, HTTPURLResponse)]
    private(set) var requests: [URLRequest] = []

    init(_ outcomes: [(Data, HTTPURLResponse)]) {
        self.outcomes = outcomes
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let outcome = record(request) else {
            XCTFail("more requests than scripted")
            throw URLError(.unknown)
        }
        return outcome
    }

    private func record(_ request: URLRequest) -> (Data, HTTPURLResponse)? {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
        return outcomes.isEmpty ? nil : outcomes.removeFirst()
    }
}

private func dpopResponse(_ status: Int, url: URL, headers: [String: String] = [:]) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
}

private func proofNonce(in request: URLRequest) -> String? {
    guard let proof = request.value(forHTTPHeaderField: "DPoP"),
        let decoded = DPoPProof.decode(proof) else { return nil }
    return decoded.payload["nonce"]?.stringValue
}

final class DPoPTests: XCTestCase {
    private let key = FakeDPoPKey()
    private let now = Date(timeIntervalSince1970: 1_700_000_000.75)

    func testProofHeaderCarriesTypeAlgorithmAndPublicJWKOnly() throws {
        let proof = try DPoPProof.make(
            key: key, htm: "POST", htu: URL(string: "https://auth.test/oauth/par")!, now: now, jti: "jti-1"
        )
        let decoded = try XCTUnwrap(DPoPProof.decode(proof))
        XCTAssertEqual(decoded.header["typ"]?.stringValue, "dpop+jwt")
        XCTAssertEqual(decoded.header["alg"]?.stringValue, "ES256")
        XCTAssertEqual(decoded.header["jwk"]?["kty"]?.stringValue, "EC")
        XCTAssertEqual(decoded.header["jwk"]?["crv"]?.stringValue, "P-256")
        XCTAssertEqual(decoded.header["jwk"]?["x"]?.stringValue, key.x)
        XCTAssertEqual(decoded.header["jwk"]?["y"]?.stringValue, key.y)
        XCTAssertNil(decoded.header["jwk"]?["d"], "the private scalar must never be in the header")
        XCTAssertEqual(decoded.header["jwk"]?.objectValue?.count, 4)
    }

    func testProofPayloadHasTheRequiredClaimsAndNoOptionalOnes() throws {
        let proof = try DPoPProof.make(
            key: key, htm: "post", htu: URL(string: "https://auth.test/oauth/par")!, now: now, jti: "jti-1"
        )
        let decoded = try XCTUnwrap(DPoPProof.decode(proof))
        XCTAssertEqual(decoded.payload["jti"]?.stringValue, "jti-1")
        XCTAssertEqual(decoded.payload["htm"]?.stringValue, "POST", "method is upper-cased")
        XCTAssertEqual(decoded.payload["htu"]?.stringValue, "https://auth.test/oauth/par")
        XCTAssertEqual(decoded.payload["iat"]?.intValue, 1_700_000_000, "iat is whole seconds")
        XCTAssertNil(decoded.payload["nonce"])
        XCTAssertNil(decoded.payload["ath"])
        XCTAssertEqual(decoded.payload.objectValue?.count, 4)
    }

    func testProofStripsQueryAndFragmentFromHTU() throws {
        let url = URL(string: "https://PDS.test/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Ax&rkey=self#frag")!
        let proof = try DPoPProof.make(key: key, htm: "GET", htu: url, now: now, jti: "j")
        let decoded = try XCTUnwrap(DPoPProof.decode(proof))
        XCTAssertEqual(decoded.payload["htu"]?.stringValue, "https://pds.test/xrpc/com.atproto.repo.getRecord")
        XCTAssertEqual(try DPoPProof.targetURI(URL(string: "https://a.test:8443/p?q")!), "https://a.test:8443/p")
    }

    func testProofCarriesNonceAndAccessTokenHash() throws {
        let proof = try DPoPProof.make(
            key: key,
            htm: "GET",
            htu: URL(string: "https://pds.test/xrpc/x")!,
            nonce: "server-nonce",
            accessToken: "access-token",
            now: now,
            jti: "j"
        )
        let decoded = try XCTUnwrap(DPoPProof.decode(proof))
        XCTAssertEqual(decoded.payload["nonce"]?.stringValue, "server-nonce")
        XCTAssertEqual(decoded.payload["ath"]?.stringValue, DPoPProof.accessTokenHash("access-token"))
        XCTAssertEqual(
            decoded.payload["ath"]?.stringValue,
            OAuthBase64URL.encode(OAuthSHA256.hash(Data("access-token".utf8)))
        )
        // An empty nonce is no nonce.
        let bare = try DPoPProof.make(key: key, htm: "GET", htu: URL(string: "https://pds.test/xrpc/x")!, nonce: "", now: now, jti: "j")
        XCTAssertNil(DPoPProof.decode(bare)?.payload["nonce"])
    }

    func testSignatureIsOverTheSigningInput() throws {
        let proof = try DPoPProof.make(key: key, htm: "GET", htu: URL(string: "https://pds.test/x")!, now: now, jti: "j")
        let parts = proof.split(separator: ".")
        XCTAssertEqual(parts.count, 3)
        let signingInput = Data((parts[0] + "." + parts[1]).utf8)
        let expected = try key.sign(signingInput)
        XCTAssertEqual(OAuthBase64URL.decode(String(parts[2])), expected)
        XCTAssertEqual(expected.count, 64)
        // Deterministic key and inputs give a deterministic proof.
        XCTAssertEqual(proof, try DPoPProof.make(key: key, htm: "GET", htu: URL(string: "https://pds.test/x")!, now: now, jti: "j"))
    }

    func testProofSegmentsAreUnpaddedBase64URLJSON() throws {
        let proof = try DPoPProof.make(key: key, htm: "GET", htu: URL(string: "https://pds.test/x")!, now: now, jti: "j")
        XCTAssertFalse(proof.contains("="))
        XCTAssertFalse(proof.contains("+"))
        XCTAssertFalse(proof.contains("/"))
        let headerJSON = try XCTUnwrap(OAuthBase64URL.decode(String(proof.split(separator: ".")[0])))
        XCTAssertEqual(
            String(decoding: headerJSON, as: UTF8.self),
            #"{"alg":"ES256","jwk":{"crv":"P-256","kty":"EC","x":"\#(key.x)","y":"\#(key.y)"},"typ":"dpop+jwt"}"#
        )
    }

    func testDefaultJTIIsRandomAndIatIsNow() throws {
        let before = Date().timeIntervalSince1970.rounded(.down)
        let a = try XCTUnwrap(DPoPProof.decode(try DPoPProof.make(key: key, htm: "GET", htu: URL(string: "https://pds.test/x")!)))
        let b = try XCTUnwrap(DPoPProof.decode(try DPoPProof.make(key: key, htm: "GET", htu: URL(string: "https://pds.test/x")!)))
        XCTAssertNotEqual(a.payload["jti"]?.stringValue, b.payload["jti"]?.stringValue)
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(a.payload["iat"]?.doubleValue), before)
    }

    func testRejectsBadKeys() {
        XCTAssertThrowsError(try DPoPProof.make(key: ShortSignatureKey(), htm: "GET", htu: URL(string: "https://pds.test/x")!)) { error in
            XCTAssertEqual(error as? DPoPError, .invalidSignatureLength(3))
        }
        XCTAssertThrowsError(try DPoPProof.make(key: BadJWKKey(), htm: "GET", htu: URL(string: "https://pds.test/x")!)) { error in
            XCTAssertEqual(error as? DPoPError, .invalidPublicJWK)
        }
        XCTAssertThrowsError(try DPoPProof.targetURI(URL(string: "relative/path")!)) { error in
            XCTAssertEqual(error as? DPoPError, .invalidTargetURL("relative/path"))
        }
    }

    func testDecodeRejectsMalformedProofs() {
        XCTAssertNil(DPoPProof.decode("a.b"))
        XCTAssertNil(DPoPProof.decode("!!!.!!!.!!!"))
        XCTAssertNil(DPoPProof.decode(OAuthBase64URL.encode(Data("nope".utf8)) + ".e30.AA"))
    }

    // MARK: Serialization

    func testKeySerializationRoundTripsThroughJSON() throws {
        let stored = DPoPKeySerialization(privateKey: Data([9, 8, 7]), publicJWK: key.publicJWK)
        let data = try JSONEncoder().encode(stored)
        let json = try JSONValue.parse(data)
        XCTAssertEqual(json["format"]?.stringValue, "pkcs8")
        XCTAssertEqual(json["privateKey"]?.stringValue, Data([9, 8, 7]).base64EncodedString())
        XCTAssertEqual(json["publicJWK"]?["x"]?.stringValue, key.x)
        XCTAssertEqual(try JSONDecoder().decode(DPoPKeySerialization.self, from: data), stored)
    }

    // MARK: Nonce store

    func testNonceStoreIsPerOriginAndClearsOnEmpty() async {
        let store = DPoPNonceStore()
        await store.set("n1", for: "https://a.test")
        await store.set("n2", for: "https://b.test")
        let a = await store.nonce(for: "https://a.test")
        let b = await store.nonce(for: "https://b.test")
        XCTAssertEqual(a, "n1")
        XCTAssertEqual(b, "n2")
        await store.set("", for: "https://a.test")
        let cleared = await store.nonce(for: "https://a.test")
        XCTAssertNil(cleared)
        await store.clear()
        let gone = await store.nonce(for: "https://b.test")
        XCTAssertNil(gone)
    }

    // MARK: Signed sends

    func testSendAttachesProofAndRemembersTheServerNonce() async throws {
        let url = URL(string: "https://auth.test/oauth/par")!
        let transport = DPoPFakeTransport([
            (Data("{}".utf8), dpopResponse(201, url: url, headers: ["DPoP-Nonce": "fresh"])),
            (Data("{}".utf8), dpopResponse(201, url: url)),
        ])
        let store = DPoPNonceStore()
        var request = URLRequest(url: url)
        request.httpMethod = "POST"

        let (_, first) = try await DPoPRequestSender.send(request, http: HTTPClient(transport: transport), key: key, nonces: store)
        XCTAssertEqual(first.statusCode, 201)
        XCTAssertNil(proofNonce(in: transport.requests[0]), "no nonce known yet")
        let remembered = await store.nonce(for: "https://auth.test")
        XCTAssertEqual(remembered, "fresh")

        _ = try await DPoPRequestSender.send(request, http: HTTPClient(transport: transport), key: key, nonces: store)
        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertEqual(proofNonce(in: transport.requests[1]), "fresh", "the next request carries the remembered nonce")
    }

    func testSendRetriesOnceOn400UseDpopNonce() async throws {
        let url = URL(string: "https://auth.test/oauth/token")!
        let transport = DPoPFakeTransport([
            (Data(#"{"error":"use_dpop_nonce","error_description":"nonce required"}"#.utf8),
             dpopResponse(400, url: url, headers: ["DPoP-Nonce": "n-1"])),
            (Data(#"{"ok":true}"#.utf8), dpopResponse(200, url: url, headers: ["DPoP-Nonce": "n-2"])),
        ])
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let store = DPoPNonceStore()
        let (data, response) = try await DPoPRequestSender.send(request, http: HTTPClient(transport: transport), key: key, nonces: store)
        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(String(decoding: data, as: UTF8.self), #"{"ok":true}"#)
        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertNil(proofNonce(in: transport.requests[0]))
        XCTAssertEqual(proofNonce(in: transport.requests[1]), "n-1")
        let latest = await store.nonce(for: "https://auth.test")
        XCTAssertEqual(latest, "n-2", "the success response's nonce replaces the retry one")
    }

    func testSendRetriesOnceOn401Challenge() async throws {
        let url = URL(string: "https://pds.test/xrpc/com.atproto.repo.putRecord")!
        let transport = DPoPFakeTransport([
            (Data(#"{"error":"use_dpop_nonce","message":"Authorization server requires nonce in DPoP proof"}"#.utf8),
             dpopResponse(401, url: url, headers: [
                "DPoP-Nonce": "pds-nonce",
                "WWW-Authenticate": #"DPoP error="use_dpop_nonce", error_description="Authorization server requires nonce in DPoP proof""#,
             ])),
            (Data("{}".utf8), dpopResponse(200, url: url)),
        ])
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let (_, response) = try await DPoPRequestSender.send(
            request, http: HTTPClient(transport: transport), key: key, nonces: DPoPNonceStore(), accessToken: "tok"
        )
        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertEqual(proofNonce(in: transport.requests[1]), "pds-nonce")
        let retried = try XCTUnwrap(DPoPProof.decode(transport.requests[1].value(forHTTPHeaderField: "DPoP")!))
        XCTAssertEqual(retried.payload["ath"]?.stringValue, DPoPProof.accessTokenHash("tok"))
    }

    func testSendDoesNotRetryTwiceNorWithoutANonceHeader() async throws {
        let url = URL(string: "https://auth.test/oauth/token")!
        let nonceError = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
        let twice = DPoPFakeTransport([
            (nonceError, dpopResponse(400, url: url, headers: ["DPoP-Nonce": "n-1"])),
            (nonceError, dpopResponse(400, url: url, headers: ["DPoP-Nonce": "n-2"])),
        ])
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let (_, second) = try await DPoPRequestSender.send(request, http: HTTPClient(transport: twice), key: key, nonces: DPoPNonceStore())
        XCTAssertEqual(second.statusCode, 400)
        XCTAssertEqual(twice.requests.count, 2)

        let noHeader = DPoPFakeTransport([
            (nonceError, dpopResponse(400, url: url)),
        ])
        let (_, unchanged) = try await DPoPRequestSender.send(request, http: HTTPClient(transport: noHeader), key: key, nonces: DPoPNonceStore())
        XCTAssertEqual(unchanged.statusCode, 400)
        XCTAssertEqual(noHeader.requests.count, 1, "without a nonce to use there is nothing to retry with")
    }

    func testSendDoesNotRetryOtherErrors() async throws {
        let url = URL(string: "https://auth.test/oauth/token")!
        let transport = DPoPFakeTransport([
            (Data(#"{"error":"invalid_grant"}"#.utf8), dpopResponse(400, url: url, headers: ["DPoP-Nonce": "n-1"])),
        ])
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let (_, response) = try await DPoPRequestSender.send(request, http: HTTPClient(transport: transport), key: key, nonces: DPoPNonceStore())
        XCTAssertEqual(response.statusCode, 400)
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testInitialNonceIsUsedBeforeTheStore() async throws {
        let url = URL(string: "https://auth.test/oauth/token")!
        let transport = DPoPFakeTransport([(Data("{}".utf8), dpopResponse(200, url: url))])
        let store = DPoPNonceStore()
        await store.set("stored", for: "https://auth.test")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        _ = try await DPoPRequestSender.send(request, http: HTTPClient(transport: transport), key: key, nonces: store, initialNonce: "handed")
        XCTAssertEqual(proofNonce(in: transport.requests[0]), "handed")
    }
}
