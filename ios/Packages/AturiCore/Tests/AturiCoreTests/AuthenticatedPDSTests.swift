import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private struct FakeDPoPKey: DPoPKey {
    var publicJWK: [String: String] {
        [
            "kty": "EC", "crv": "P-256",
            "x": OAuthBase64URL.encode(Data((1...32).map { UInt8($0) })),
            "y": OAuthBase64URL.encode(Data((33...64).map { UInt8($0) })),
        ]
    }

    func sign(_ data: Data) throws -> Data {
        let first = OAuthSHA256.hash(data)
        return first + OAuthSHA256.hash(first)
    }
}

/// Answers in order regardless of route and records every request.
private final class PDSFakeTransport: HTTPTransport, @unchecked Sendable {
    typealias Answer = (status: Int, body: String, headers: [String: String])

    private let lock = NSLock()
    private var answers: [Answer]
    private(set) var requests: [URLRequest] = []

    init(_ answers: [Answer]) {
        self.answers = answers
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let answer = record(request) else {
            XCTFail("more requests than scripted: \(request.url!)")
            throw URLError(.unknown)
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: answer.headers)!
        return (Data(answer.body.utf8), response)
    }

    private func record(_ request: URLRequest) -> Answer? {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
        return answers.isEmpty ? nil : answers.removeFirst()
    }
}

private func proofPayload(_ request: URLRequest) -> JSONValue? {
    request.value(forHTTPHeaderField: "DPoP").flatMap(DPoPProof.decode)?.payload
}

private func requestBody(_ request: URLRequest) -> JSONValue? {
    request.httpBody.flatMap { try? JSONValue.parse($0) }
}

private let recordNotFound = #"{"error":"RecordNotFound","message":"Could not locate record: at://did:plc:test123/to.aturi.actor.preferences/self"}"#

final class AuthenticatedPDSTests: XCTestCase {
    private let key = FakeDPoPKey()
    private let session = OAuthSession(
        did: "did:plc:test123",
        handle: "alice.test",
        pds: URL(string: "https://pds.test")!,
        issuer: "https://auth.test",
        accessToken: "access-token-1",
        refreshToken: "refresh-1",
        expiresAt: nil,
        scope: "atproto",
        dpopKey: DPoPKeySerialization(privateKey: Data(), publicJWK: [:])
    )

    private func pds(_ transport: PDSFakeTransport, nonces: DPoPNonceStore = DPoPNonceStore()) -> AuthenticatedPDS {
        AuthenticatedPDS(session: session, key: key, http: HTTPClient(transport: transport), nonces: nonces)
    }

    // MARK: Headers

    func testGetRecordSendsAuthorizationAndABoundProof() async throws {
        let transport = PDSFakeTransport([
            (200, #"{"uri":"at://did:plc:test123/app.bsky.actor.profile/self","cid":"bafy1","value":{"$type":"app.bsky.actor.profile","displayName":"Alice"}}"#, [:]),
        ])
        let record = try await pds(transport).getRecord(collection: "app.bsky.actor.profile", rkey: "self")
        XCTAssertEqual(record.uri, "at://did:plc:test123/app.bsky.actor.profile/self")
        XCTAssertEqual(record.cid, "bafy1")
        XCTAssertEqual(record.value["displayName"]?.stringValue, "Alice")

        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(
            request.url?.absoluteString,
            "https://pds.test/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Atest123&collection=app.bsky.actor.profile&rkey=self"
        )
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "DPoP access-token-1")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertNotNil(request.value(forHTTPHeaderField: URLSessionTransport.noRedirectHeader), "PDS calls refuse redirects")
        XCTAssertNil(request.httpBody)

        let proof = try XCTUnwrap(proofPayload(request))
        XCTAssertEqual(proof["htm"]?.stringValue, "GET")
        XCTAssertEqual(proof["htu"]?.stringValue, "https://pds.test/xrpc/com.atproto.repo.getRecord", "no query in htu")
        XCTAssertEqual(proof["ath"]?.stringValue, DPoPProof.accessTokenHash("access-token-1"))
        XCTAssertNil(proof["nonce"])
    }

    func testGetRecordAcceptsAnotherRepoAndACid() async throws {
        let transport = PDSFakeTransport([(200, #"{"uri":"at://x/y/z","cid":"c","value":{}}"#, [:])])
        _ = try await pds(transport).getRecord(collection: "app.bsky.feed.post", rkey: "3k", repo: "did:plc:other", cid: "bafyc")
        XCTAssertEqual(
            transport.requests[0].url?.absoluteString,
            "https://pds.test/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Aother&collection=app.bsky.feed.post&rkey=3k&cid=bafyc"
        )
    }

    // MARK: Nonce retry

    func testRetriesOnceOn401UseDpopNonceThenRemembersIt() async throws {
        let store = DPoPNonceStore()
        let transport = PDSFakeTransport([
            (401, #"{"error":"use_dpop_nonce","message":"Authorization server requires nonce in DPoP proof"}"#,
             ["DPoP-Nonce": "pds-nonce-1", "WWW-Authenticate": #"DPoP error="use_dpop_nonce""#]),
            (200, #"{"uri":"at://did:plc:test123/c/r","cid":"bafy2"}"#, ["DPoP-Nonce": "pds-nonce-2"]),
            (200, #"{"uri":"at://did:plc:test123/c/r","cid":"bafy3"}"#, [:]),
        ])
        let helper = pds(transport, nonces: store)
        let first = try await helper.putRecord(collection: "c", rkey: "r", record: ["a": 1])
        XCTAssertEqual(first.cid, "bafy2")
        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertNil(proofPayload(transport.requests[0])?["nonce"])
        XCTAssertEqual(proofPayload(transport.requests[1])?["nonce"]?.stringValue, "pds-nonce-1")
        XCTAssertEqual(requestBody(transport.requests[0]), requestBody(transport.requests[1]), "the retry resends the same body")

        let second = try await helper.putRecord(collection: "c", rkey: "r", record: ["a": 2])
        XCTAssertEqual(second.cid, "bafy3")
        XCTAssertEqual(transport.requests.count, 3, "the remembered nonce avoids a second round trip")
        XCTAssertEqual(proofPayload(transport.requests[2])?["nonce"]?.stringValue, "pds-nonce-2")
    }

    func testRetriesOnceOn400UseDpopNonce() async throws {
        let transport = PDSFakeTransport([
            (400, #"{"error":"use_dpop_nonce","message":"nonce"}"#, ["DPoP-Nonce": "n400"]),
            (200, #"{"uri":"at://did:plc:test123/c/r","cid":"bafy"}"#, [:]),
        ])
        _ = try await pds(transport).createRecord(collection: "c", record: ["a": 1])
        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertEqual(proofPayload(transport.requests[1])?["nonce"]?.stringValue, "n400")
    }

    func testDoesNotRetryTwice() async {
        let transport = PDSFakeTransport([
            (401, #"{"error":"use_dpop_nonce"}"#, ["DPoP-Nonce": "n1"]),
            (401, #"{"error":"use_dpop_nonce"}"#, ["DPoP-Nonce": "n2"]),
        ])
        do {
            _ = try await pds(transport).deleteRecord(collection: "c", rkey: "r")
            XCTFail("expected HTTPError")
        } catch let error as HTTPError {
            XCTAssertEqual(error.status, 401)
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(transport.requests.count, 2)
    }

    // MARK: Write bodies

    func testCreateRecordBodyStampsTheTypeAndOmitsOptionalFields() async throws {
        let transport = PDSFakeTransport([
            (200, #"{"uri":"at://did:plc:test123/app.bsky.feed.post/3kabc","cid":"bafyp","validationStatus":"valid"}"#, [:]),
        ])
        let result = try await pds(transport).createRecord(collection: "app.bsky.feed.post", record: ["text": "hi"])
        XCTAssertEqual(result, PDSWriteResult(uri: "at://did:plc:test123/app.bsky.feed.post/3kabc", cid: "bafyp", validationStatus: "valid"))

        let request = transport.requests[0]
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.absoluteString, "https://pds.test/xrpc/com.atproto.repo.createRecord")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(requestBody(request), [
            "repo": "did:plc:test123",
            "collection": "app.bsky.feed.post",
            "record": ["$type": "app.bsky.feed.post", "text": "hi"],
        ])
        XCTAssertEqual(proofPayload(request)?["htm"]?.stringValue, "POST")
        XCTAssertEqual(proofPayload(request)?["htu"]?.stringValue, "https://pds.test/xrpc/com.atproto.repo.createRecord")
    }

    func testCreateRecordPassesRkeyAndValidateWhenGiven() async throws {
        let transport = PDSFakeTransport([(200, #"{"uri":"u","cid":"c"}"#, [:])])
        _ = try await pds(transport).createRecord(
            collection: "c", record: ["$type": "other.type", "a": 1], rkey: "custom", validate: false
        )
        XCTAssertEqual(requestBody(transport.requests[0]), [
            "repo": "did:plc:test123",
            "collection": "c",
            "rkey": "custom",
            "validate": false,
            "record": ["$type": "other.type", "a": 1],
        ])
    }

    func testPutRecordBody() async throws {
        let transport = PDSFakeTransport([(200, #"{"uri":"at://did:plc:test123/c/r","cid":"bafy"}"#, [:])])
        let result = try await pds(transport).putRecord(collection: "c", rkey: "r", record: ["a": [1, 2]], swapRecord: "bafyold")
        XCTAssertEqual(result.uri, "at://did:plc:test123/c/r")
        XCTAssertNil(result.validationStatus)
        XCTAssertEqual(transport.requests[0].url?.absoluteString, "https://pds.test/xrpc/com.atproto.repo.putRecord")
        XCTAssertEqual(requestBody(transport.requests[0]), [
            "repo": "did:plc:test123",
            "collection": "c",
            "rkey": "r",
            "swapRecord": "bafyold",
            "record": ["$type": "c", "a": [1, 2]],
        ])
    }

    func testDeleteRecordBody() async throws {
        let transport = PDSFakeTransport([(200, "{}", [:])])
        try await pds(transport).deleteRecord(collection: "c", rkey: "r")
        XCTAssertEqual(transport.requests[0].url?.absoluteString, "https://pds.test/xrpc/com.atproto.repo.deleteRecord")
        XCTAssertEqual(requestBody(transport.requests[0]), ["repo": "did:plc:test123", "collection": "c", "rkey": "r"])
    }

    func testNonObjectRecordsAreSentUnchanged() async throws {
        let transport = PDSFakeTransport([(200, #"{"uri":"u","cid":"c"}"#, [:])])
        _ = try await pds(transport).createRecord(collection: "c", record: "just a string")
        XCTAssertEqual(requestBody(transport.requests[0])?["record"], "just a string")
    }

    // MARK: Errors

    func testNon2xxBecomesHTTPErrorWithTheBody() async {
        let transport = PDSFakeTransport([(400, #"{"error":"InvalidRequest","message":"bad rkey"}"#, [:])])
        do {
            _ = try await pds(transport).putRecord(collection: "c", rkey: "bad", record: [:])
            XCTFail("expected HTTPError")
        } catch let error as HTTPError {
            XCTAssertEqual(error.status, 400)
            XCTAssertEqual(error.body, #"{"error":"InvalidRequest","message":"bad rkey"}"#)
            XCTAssertEqual(error.url.absoluteString, "https://pds.test/xrpc/com.atproto.repo.putRecord")
            XCTAssertFalse(AuthenticatedPDS.isRecordNotFound(error))
            XCTAssertFalse(AuthenticatedPDS.isAuthenticationError(error))
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testRedirectsAreRefused() async {
        let transport = PDSFakeTransport([(302, "", ["Location": "https://elsewhere.test/xrpc/com.atproto.repo.getRecord"])])
        do {
            _ = try await pds(transport).getRecord(collection: "c", rkey: "r")
            XCTFail("expected a refused redirect")
        } catch HTTPFailure.redirectRefused(let location) {
            XCTAssertEqual(location.absoluteString, "https://elsewhere.test/xrpc/com.atproto.repo.getRecord")
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testAuthenticationErrorDetection() {
        let url = URL(string: "https://pds.test/xrpc/x")!
        XCTAssertTrue(AuthenticatedPDS.isAuthenticationError(HTTPError(status: 401, body: #"{"error":"InvalidToken"}"#, url: url)))
        XCTAssertTrue(AuthenticatedPDS.isAuthenticationError(HTTPError(status: 400, body: #"{"error":"ExpiredToken","message":"Token has expired"}"#, url: url)))
        XCTAssertTrue(AuthenticatedPDS.isAuthenticationError(HTTPError(status: 400, body: #"{"error":"InvalidToken"}"#, url: url)))
        XCTAssertFalse(AuthenticatedPDS.isAuthenticationError(HTTPError(status: 400, body: #"{"error":"InvalidRequest"}"#, url: url)))
        XCTAssertFalse(AuthenticatedPDS.isAuthenticationError(HTTPError(status: 500, body: "", url: url)))
    }

    // MARK: Preferences record

    func testReadPreferencesRecordReturnsTheValue() async throws {
        let transport = PDSFakeTransport([
            (200, #"{"uri":"at://did:plc:test123/to.aturi.actor.preferences/self","cid":"bafy","value":{"$type":"to.aturi.actor.preferences","colorScheme":"ember","autoRedirect":true,"updatedAt":"2025-01-01T00:00:00.000Z"}}"#, [:]),
        ])
        let value = try await pds(transport).readPreferencesRecord()
        XCTAssertEqual(value?["colorScheme"]?.stringValue, "ember")
        XCTAssertEqual(value?["autoRedirect"]?.boolValue, true)
        XCTAssertEqual(
            transport.requests[0].url?.absoluteString,
            "https://pds.test/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Atest123&collection=to.aturi.actor.preferences&rkey=self"
        )
    }

    func testReadPreferencesRecordIsNilOnlyForRecordNotFound() async throws {
        let missing = PDSFakeTransport([(400, recordNotFound, [:])])
        let value = try await pds(missing).readPreferencesRecord()
        XCTAssertNil(value)

        let messageOnly = PDSFakeTransport([(400, #"{"error":"InvalidRequest","message":"Could not locate record"}"#, [:])])
        let byMessage = try await pds(messageOnly).readPreferencesRecord()
        XCTAssertNil(byMessage)

        // A bare 400 must not read as "missing": the caller would overwrite
        // the user's saved preferences on that answer.
        let transient = PDSFakeTransport([(400, #"{"error":"InvalidRequest","message":"rate limited"}"#, [:])])
        do {
            _ = try await pds(transient).readPreferencesRecord()
            XCTFail("expected HTTPError")
        } catch let error as HTTPError {
            XCTAssertEqual(error.status, 400)
        } catch {
            XCTFail("unexpected \(error)")
        }

        let outage = PDSFakeTransport([(502, "bad gateway", [:])])
        do {
            _ = try await pds(outage).readPreferencesRecord()
            XCTFail("expected HTTPError")
        } catch let error as HTTPError {
            XCTAssertEqual(error.status, 502)
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testIsRecordNotFoundMatchesNameOrMessageCaseInsensitively() {
        let url = URL(string: "https://pds.test/xrpc/x")!
        XCTAssertTrue(AuthenticatedPDS.isRecordNotFound(HTTPError(status: 400, body: recordNotFound, url: url)))
        XCTAssertTrue(AuthenticatedPDS.isRecordNotFound(HTTPError(status: 400, body: #"{"error":"recordnotfound"}"#, url: url)))
        XCTAssertTrue(AuthenticatedPDS.isRecordNotFound(HTTPError(status: 404, body: "RecordNotFound", url: url)))
        XCTAssertFalse(AuthenticatedPDS.isRecordNotFound(HTTPError(status: 400, body: #"{"error":"RepoNotFound"}"#, url: url)))
        XCTAssertFalse(AuthenticatedPDS.isRecordNotFound(HTTPError(status: 500, body: "", url: url)))
    }

    func testWritePreferencesRecordPutsSelfWithTheType() async throws {
        let transport = PDSFakeTransport([(200, #"{"uri":"at://did:plc:test123/to.aturi.actor.preferences/self","cid":"bafyw"}"#, [:])])
        let value: JSONValue = [
            "colorScheme": "tide",
            "waypointGroups": [["id": "g", "name": "Group", "waypointIds": ["bluesky"]]],
            "autoRedirect": false,
            "updatedAt": "2025-01-01T00:00:00.000Z",
        ]
        let result = try await pds(transport).writePreferencesRecord(value)
        XCTAssertEqual(result.uri, "at://did:plc:test123/to.aturi.actor.preferences/self")
        XCTAssertEqual(transport.requests[0].url?.absoluteString, "https://pds.test/xrpc/com.atproto.repo.putRecord")
        let body = try XCTUnwrap(requestBody(transport.requests[0]))
        XCTAssertEqual(body["repo"]?.stringValue, "did:plc:test123")
        XCTAssertEqual(body["collection"]?.stringValue, "to.aturi.actor.preferences")
        XCTAssertEqual(body["rkey"]?.stringValue, "self")
        XCTAssertEqual(body["record"]?["$type"]?.stringValue, "to.aturi.actor.preferences")
        XCTAssertEqual(body["record"]?["colorScheme"]?.stringValue, "tide")
        XCTAssertEqual(body["record"]?["waypointGroups"]?[0]?["waypointIds"]?[0]?.stringValue, "bluesky")
        XCTAssertNil(body["validate"])
        XCTAssertEqual(AuthenticatedPDS.preferencesCollection, "to.aturi.actor.preferences")
        XCTAssertEqual(AuthenticatedPDS.preferencesRkey, "self")
    }

    func testWritePreferencesRecordKeepsAnExplicitType() async throws {
        let transport = PDSFakeTransport([(200, #"{"uri":"u","cid":"c"}"#, [:])])
        _ = try await pds(transport).writePreferencesRecord(["$type": "to.aturi.actor.preferences", "colorScheme": "moss"])
        XCTAssertEqual(requestBody(transport.requests[0])?["record"], ["$type": "to.aturi.actor.preferences", "colorScheme": "moss"])
    }
}
