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

/// Routes by "host/path"; each route is a queue consumed in order so a
/// nonce retry can be scripted as two answers to the same endpoint.
private final class OAuthFakeTransport: HTTPTransport, @unchecked Sendable {
    typealias Answer = (status: Int, body: String, headers: [String: String])

    private let lock = NSLock()
    private var routes: [String: [Answer]]
    private(set) var requests: [URLRequest] = []

    init(_ routes: [String: [Answer]]) {
        self.routes = routes
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let answer = record(request) else {
            XCTFail("unscripted request to \(request.url!)")
            throw URLError(.cannotFindHost)
        }
        var headers = answer.headers
        headers["Content-Type"] = "application/json"
        let response = HTTPURLResponse(url: request.url!, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: headers)!
        return (Data(answer.body.utf8), response)
    }

    private func record(_ request: URLRequest) -> Answer? {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
        let url = request.url!
        let key = url.host! + url.path
        guard var queue = routes[key], !queue.isEmpty else { return nil }
        let answer = queue.removeFirst()
        routes[key] = queue
        return answer
    }

    func requests(to path: String) -> [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return requests.filter { $0.url!.path == path }
    }
}

private let resourceDocument = #"{"resource":"https://pds.test","authorization_servers":["https://auth.test"]}"#
private let serverDocument = #"{"issuer":"https://auth.test","authorization_endpoint":"https://auth.test/oauth/authorize","token_endpoint":"https://auth.test/oauth/token","pushed_authorization_request_endpoint":"https://auth.test/oauth/par","revocation_endpoint":"https://auth.test/oauth/revoke","response_types_supported":["code"],"code_challenge_methods_supported":["S256"],"dpop_signing_alg_values_supported":["ES256"],"client_id_metadata_document_supported":true}"#
private let parDocument = #"{"request_uri":"urn:ietf:params:oauth:request_uri:req-123","expires_in":299}"#
private let did = "did:plc:test123"
private let scope = "atproto rpc:*?aud=did:web:api.bsky.app%23bsky_appview repo:*?action=create blob:*/*"

private func tokenDocument(sub: String = did, refresh: String? = "refresh-1", scope granted: String = scope, tokenType: String = "DPoP") -> String {
    let refreshField = refresh.map { #","refresh_token":"\#($0)""# } ?? ""
    return #"{"access_token":"access-1","token_type":"\#(tokenType)","expires_in":3600\#(refreshField),"scope":"\#(granted)","sub":"\#(sub)"}"#
}

private func discoveryRoutes() -> [String: [OAuthFakeTransport.Answer]] {
    [
        "pds.test/.well-known/oauth-protected-resource": [(200, resourceDocument, [:])],
        "auth.test/.well-known/oauth-authorization-server": [(200, serverDocument, [:])],
    ]
}

/// The form body as the server would read it.
private func formFields(_ request: URLRequest) -> [String: String] {
    guard let body = request.httpBody else { return [:] }
    var fields: [String: String] = [:]
    for pair in String(decoding: body, as: UTF8.self).split(separator: "&") {
        let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
        let key = String(parts[0]).removingPercentEncoding ?? String(parts[0])
        let value = parts.count > 1 ? (String(parts[1]).removingPercentEncoding ?? String(parts[1])) : ""
        fields[key] = value
    }
    return fields
}

private func proofPayload(_ request: URLRequest) -> JSONValue? {
    request.value(forHTTPHeaderField: "DPoP").flatMap(DPoPProof.decode)?.payload
}

final class OAuthClientTests: XCTestCase {
    private let key = FakeDPoPKey()
    private let pds = URL(string: "https://pds.test")!

    private func pendingRequest(nonce: String? = "par-nonce") -> AuthorizationRequest {
        AuthorizationRequest(
            authorizeURL: URL(string: "https://auth.test/oauth/authorize?client_id=x&request_uri=y")!,
            state: "state-abc",
            verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
            issuer: "https://auth.test",
            dpopNonce: nonce,
            did: did,
            handle: "alice.test",
            pds: pds,
            scope: scope,
            tokenEndpoint: URL(string: "https://auth.test/oauth/token")!,
            revocationEndpoint: URL(string: "https://auth.test/oauth/revoke")!
        )
    }

    private func session(refresh: String? = "refresh-1") -> OAuthSession {
        OAuthSession(
            did: did, handle: "alice.test", pds: pds, issuer: "https://auth.test",
            accessToken: "access-0", refreshToken: refresh, expiresAt: nil, scope: scope,
            dpopKey: DPoPKeySerialization(privateKey: Data(), publicJWK: key.publicJWK)
        )
    }

    // MARK: beginAuthorization

    func testBeginAuthorizationPushesTheRequestAndBuildsTheAuthorizeURL() async throws {
        var routes = discoveryRoutes()
        routes["auth.test/oauth/par"] = [(201, parDocument, ["DPoP-Nonce": "par-nonce"])]
        let transport = OAuthFakeTransport(routes)
        let client = OAuthClient(http: HTTPClient(transport: transport))

        let request = try await client.beginAuthorization(did: did, pds: pds, scope: scope, key: key, handleHint: "alice.test")

        let par = try XCTUnwrap(transport.requests(to: "/oauth/par").first)
        XCTAssertEqual(par.httpMethod, "POST")
        XCTAssertEqual(par.value(forHTTPHeaderField: "Content-Type"), "application/x-www-form-urlencoded")
        XCTAssertNil(par.value(forHTTPHeaderField: "Authorization"), "a public client authenticates with nothing but its id")
        let fields = formFields(par)
        XCTAssertEqual(fields["client_id"], "https://aturi.to/oauth-client-metadata-ios.json")
        XCTAssertEqual(fields["redirect_uri"], "to.aturi:/oauth/callback")
        XCTAssertEqual(fields["scope"], scope)
        XCTAssertEqual(fields["state"], request.state)
        XCTAssertEqual(fields["code_challenge"], PKCE.challenge(for: request.verifier))
        XCTAssertEqual(fields["code_challenge_method"], "S256")
        XCTAssertEqual(fields["response_type"], "code")
        XCTAssertEqual(fields["login_hint"], "alice.test")
        XCTAssertEqual(fields.count, 8)
        // The raw body keeps the scope's own %23 escaped, so the server
        // decodes it back to the literal token the metadata declares.
        XCTAssertTrue(String(decoding: par.httpBody!, as: UTF8.self).contains("%2523bsky_appview"))

        let proof = try XCTUnwrap(proofPayload(par))
        XCTAssertEqual(proof["htm"]?.stringValue, "POST")
        XCTAssertEqual(proof["htu"]?.stringValue, "https://auth.test/oauth/par")
        XCTAssertNil(proof["ath"], "no token yet")

        XCTAssertTrue(PKCE.isValidVerifier(request.verifier))
        XCTAssertEqual(request.state.count, 43)
        XCTAssertEqual(request.issuer, "https://auth.test")
        XCTAssertEqual(request.dpopNonce, "par-nonce")
        XCTAssertEqual(request.did, did)
        XCTAssertEqual(request.handle, "alice.test")
        XCTAssertEqual(request.pds, pds)
        XCTAssertEqual(request.scope, scope)
        XCTAssertEqual(request.tokenEndpoint.absoluteString, "https://auth.test/oauth/token")
        XCTAssertEqual(request.revocationEndpoint?.absoluteString, "https://auth.test/oauth/revoke")

        let components = try XCTUnwrap(URLComponents(url: request.authorizeURL, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.scheme, "https")
        XCTAssertEqual(components.host, "auth.test")
        XCTAssertEqual(components.path, "/oauth/authorize")
        let items = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(items, [
            "client_id": "https://aturi.to/oauth-client-metadata-ios.json",
            "request_uri": "urn:ietf:params:oauth:request_uri:req-123",
        ])
        XCTAssertEqual(transport.requests.map { $0.url!.path }, [
            "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server", "/oauth/par",
        ])
    }

    func testBeginAuthorizationFallsBackToTheDIDAsLoginHint() async throws {
        var routes = discoveryRoutes()
        routes["auth.test/oauth/par"] = [(201, parDocument, [:])]
        let transport = OAuthFakeTransport(routes)
        let request = try await OAuthClient(http: HTTPClient(transport: transport))
            .beginAuthorization(did: did, pds: pds, scope: scope, key: key, handleHint: nil)
        XCTAssertEqual(formFields(transport.requests(to: "/oauth/par")[0])["login_hint"], did)
        XCTAssertNil(request.handle)
        XCTAssertNil(request.dpopNonce)
    }

    func testBeginAuthorizationRetriesThePAROnceWithTheServerNonce() async throws {
        var routes = discoveryRoutes()
        routes["auth.test/oauth/par"] = [
            (400, #"{"error":"use_dpop_nonce","error_description":"Authorization server requires nonce in DPoP proof"}"#, ["DPoP-Nonce": "nonce-1"]),
            (201, parDocument, ["DPoP-Nonce": "nonce-2"]),
        ]
        let transport = OAuthFakeTransport(routes)
        let request = try await OAuthClient(http: HTTPClient(transport: transport))
            .beginAuthorization(did: did, pds: pds, scope: scope, key: key, handleHint: nil)
        let pars = transport.requests(to: "/oauth/par")
        XCTAssertEqual(pars.count, 2)
        XCTAssertNil(proofPayload(pars[0])?["nonce"])
        XCTAssertEqual(proofPayload(pars[1])?["nonce"]?.stringValue, "nonce-1")
        XCTAssertEqual(formFields(pars[0])["state"], formFields(pars[1])["state"], "the retry is the same request")
        XCTAssertEqual(request.dpopNonce, "nonce-2", "the nonce handed to the token exchange is the latest one")
    }

    func testBeginAuthorizationSurfacesPARErrors() async {
        var routes = discoveryRoutes()
        routes["auth.test/oauth/par"] = [(400, #"{"error":"invalid_scope","error_description":"unknown scope"}"#, [:])]
        let transport = OAuthFakeTransport(routes)
        do {
            _ = try await OAuthClient(http: HTTPClient(transport: transport))
                .beginAuthorization(did: did, pds: pds, scope: scope, key: key, handleHint: nil)
            XCTFail("expected a server error")
        } catch let error as OAuthError {
            XCTAssertEqual(error, .server(status: 400, error: "invalid_scope", description: "unknown scope"))
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testBeginAuthorizationRejectsAPARResponseWithoutRequestURI() async {
        var routes = discoveryRoutes()
        routes["auth.test/oauth/par"] = [(201, #"{"expires_in":60}"#, [:])]
        let transport = OAuthFakeTransport(routes)
        do {
            _ = try await OAuthClient(http: HTTPClient(transport: transport))
                .beginAuthorization(did: did, pds: pds, scope: scope, key: key, handleHint: nil)
            XCTFail("expected an invalid response")
        } catch let error as OAuthError {
            if case .invalidTokenResponse = error {} else { XCTFail("unexpected \(error)") }
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    // MARK: Callback parsing

    func testCallbackParametersParseQueryAndFragmentAndDecode() {
        let query = OAuthCallbackParameters(callbackString: "to.aturi:/oauth/callback?iss=https%3A%2F%2Fauth.test&state=state-abc&code=code-xyz")
        XCTAssertEqual(query.iss, "https://auth.test")
        XCTAssertEqual(query.state, "state-abc")
        XCTAssertEqual(query.code, "code-xyz")
        XCTAssertNil(query.error)

        let fragment = OAuthCallbackParameters(callbackString: "to.aturi:/oauth/callback#code=c&state=s&iss=https%3A%2F%2Fauth.test")
        XCTAssertEqual(fragment.code, "c")
        XCTAssertEqual(fragment.state, "s")
        XCTAssertEqual(fragment.iss, "https://auth.test")

        let denied = OAuthCallbackParameters(callbackString: "to.aturi:/oauth/callback?error=access_denied&error_description=The+user+said+no&state=s")
        XCTAssertEqual(denied.error, "access_denied")
        XCTAssertEqual(denied.errorDescription, "The user said no")
        XCTAssertEqual(denied.state, "s")

        let empty = OAuthCallbackParameters(callbackString: "to.aturi:/oauth/callback")
        XCTAssertNil(empty.code)
        XCTAssertNil(empty.state)

        let url = URL(string: "to.aturi:/oauth/callback?code=c&state=s&iss=https%3A%2F%2Fauth.test")!
        XCTAssertEqual(OAuthCallbackParameters(callback: url).code, "c")
    }

    // MARK: completeAuthorization

    func testCompleteAuthorizationExchangesTheCodeWithDPoPAndVerifier() async throws {
        let transport = OAuthFakeTransport([
            "auth.test/oauth/token": [(200, tokenDocument(), ["DPoP-Nonce": "token-nonce"])],
        ])
        let client = OAuthClient(http: HTTPClient(transport: transport))
        let callback = URL(string: "to.aturi:/oauth/callback?iss=https%3A%2F%2Fauth.test&state=state-abc&code=code-xyz")!
        let before = Date()
        let session = try await client.completeAuthorization(callback: callback, expected: pendingRequest(), key: key)

        let exchange = try XCTUnwrap(transport.requests(to: "/oauth/token").first)
        XCTAssertEqual(exchange.httpMethod, "POST")
        XCTAssertEqual(formFields(exchange), [
            "grant_type": "authorization_code",
            "code": "code-xyz",
            "redirect_uri": "to.aturi:/oauth/callback",
            "client_id": "https://aturi.to/oauth-client-metadata-ios.json",
            "code_verifier": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
        ])
        let proof = try XCTUnwrap(proofPayload(exchange))
        XCTAssertEqual(proof["htu"]?.stringValue, "https://auth.test/oauth/token")
        XCTAssertEqual(proof["htm"]?.stringValue, "POST")
        XCTAssertEqual(proof["nonce"]?.stringValue, "par-nonce", "the PAR's nonce is used straight away")
        XCTAssertNil(proof["ath"])
        XCTAssertEqual(transport.requests.count, 1, "no rediscovery: the pending request carries the token endpoint")

        XCTAssertEqual(session.did, did)
        XCTAssertEqual(session.handle, "alice.test")
        XCTAssertEqual(session.pds, pds)
        XCTAssertEqual(session.issuer, "https://auth.test")
        XCTAssertEqual(session.accessToken, "access-1")
        XCTAssertEqual(session.refreshToken, "refresh-1")
        XCTAssertEqual(session.scope, scope)
        XCTAssertEqual(session.tokenType, "DPoP")
        XCTAssertEqual(session.dpopKey.publicJWK, key.publicJWK)
        XCTAssertEqual(session.dpopKey.format, "opaque", "a fake key has no private material to store")
        let expiresAt = try XCTUnwrap(session.expiresAt)
        XCTAssertGreaterThanOrEqual(expiresAt.timeIntervalSince(before), 3590)
        XCTAssertLessThanOrEqual(expiresAt.timeIntervalSince(before), 3610)
        XCTAssertFalse(session.isExpired())
    }

    func testCompleteAuthorizationRetriesTheExchangeOnceOnNonce() async throws {
        let transport = OAuthFakeTransport([
            "auth.test/oauth/token": [
                (400, #"{"error":"use_dpop_nonce"}"#, ["DPoP-Nonce": "fresh"]),
                (200, tokenDocument(), [:]),
            ],
        ])
        let callback = URL(string: "to.aturi:/oauth/callback?iss=https%3A%2F%2Fauth.test&state=state-abc&code=code-xyz")!
        let session = try await OAuthClient(http: HTTPClient(transport: transport))
            .completeAuthorization(callback: callback, expected: pendingRequest(nonce: nil), key: key)
        XCTAssertEqual(session.accessToken, "access-1")
        let exchanges = transport.requests(to: "/oauth/token")
        XCTAssertEqual(exchanges.count, 2)
        XCTAssertNil(proofPayload(exchanges[0])?["nonce"])
        XCTAssertEqual(proofPayload(exchanges[1])?["nonce"]?.stringValue, "fresh")
    }

    private func expectCompletionFailure(
        callback: String,
        expected: AuthorizationRequest? = nil,
        token: String = tokenDocument(),
        file: StaticString = #filePath,
        line: UInt = #line
    ) async -> (OAuthError?, Int) {
        let transport = OAuthFakeTransport(["auth.test/oauth/token": [(200, token, [:])]])
        do {
            _ = try await OAuthClient(http: HTTPClient(transport: transport))
                .completeAuthorization(callback: URL(string: callback)!, expected: expected ?? pendingRequest(), key: key)
            XCTFail("expected a failure", file: file, line: line)
            return (nil, transport.requests.count)
        } catch let error as OAuthError {
            return (error, transport.requests.count)
        } catch {
            XCTFail("unexpected \(error)", file: file, line: line)
            return (nil, transport.requests.count)
        }
    }

    func testCompleteAuthorizationRejectsAWrongOrMissingState() async {
        let wrong = await expectCompletionFailure(callback: "to.aturi:/oauth/callback?iss=https%3A%2F%2Fauth.test&state=other&code=c")
        XCTAssertEqual(wrong.0, .stateMismatch)
        XCTAssertEqual(wrong.1, 0, "nothing is exchanged")
        let missing = await expectCompletionFailure(callback: "to.aturi:/oauth/callback?iss=https%3A%2F%2Fauth.test&code=c")
        XCTAssertEqual(missing.0, .invalidCallback("missing state"))
    }

    func testCompleteAuthorizationRejectsAWrongOrMissingIssuer() async {
        let wrong = await expectCompletionFailure(callback: "to.aturi:/oauth/callback?iss=https%3A%2F%2Fevil.test&state=state-abc&code=c")
        XCTAssertEqual(wrong.0, .issuerMismatch(expected: "https://auth.test", actual: "https://evil.test"))
        XCTAssertEqual(wrong.1, 0)
        let missing = await expectCompletionFailure(callback: "to.aturi:/oauth/callback?state=state-abc&code=c")
        XCTAssertEqual(missing.0, .invalidCallback("missing iss"))
    }

    func testCompleteAuthorizationReportsADeniedRequest() async {
        let denied = await expectCompletionFailure(callback: "to.aturi:/oauth/callback?state=state-abc&error=access_denied&error_description=nope")
        XCTAssertEqual(denied.0, .authorizationDenied(error: "access_denied", description: "nope"))
        XCTAssertEqual(denied.1, 0)
        // An error for a different state is not ours to report as a denial.
        let foreign = await expectCompletionFailure(callback: "to.aturi:/oauth/callback?state=other&error=access_denied")
        XCTAssertEqual(foreign.0, .stateMismatch)
    }

    func testCompleteAuthorizationRejectsAMissingCode() async {
        let result = await expectCompletionFailure(callback: "to.aturi:/oauth/callback?iss=https%3A%2F%2Fauth.test&state=state-abc")
        XCTAssertEqual(result.0, .invalidCallback("missing code"))
    }

    func testCompleteAuthorizationRejectsATokenForAnotherAccount() async {
        let result = await expectCompletionFailure(
            callback: "to.aturi:/oauth/callback?iss=https%3A%2F%2Fauth.test&state=state-abc&code=c",
            token: tokenDocument(sub: "did:plc:someoneelse")
        )
        XCTAssertEqual(result.0, .subjectMismatch(expected: did, actual: "did:plc:someoneelse"))
    }

    func testCompleteAuthorizationRejectsBearerTokensAndMissingAtprotoScope() async {
        let bearer = await expectCompletionFailure(
            callback: "to.aturi:/oauth/callback?iss=https%3A%2F%2Fauth.test&state=state-abc&code=c",
            token: tokenDocument(tokenType: "Bearer")
        )
        if case .invalidTokenResponse = bearer.0 ?? .stateMismatch {} else { XCTFail("unexpected \(String(describing: bearer.0))") }
        let noScope = await expectCompletionFailure(
            callback: "to.aturi:/oauth/callback?iss=https%3A%2F%2Fauth.test&state=state-abc&code=c",
            token: tokenDocument(scope: "repo:*?action=create")
        )
        if case .invalidTokenResponse = noScope.0 ?? .stateMismatch {} else { XCTFail("unexpected \(String(describing: noScope.0))") }
    }

    func testCompleteAuthorizationSurfacesTokenEndpointErrors() async {
        let transport = OAuthFakeTransport([
            "auth.test/oauth/token": [(400, #"{"error":"invalid_grant","error_description":"code expired"}"#, [:])],
        ])
        do {
            _ = try await OAuthClient(http: HTTPClient(transport: transport)).completeAuthorization(
                callback: URL(string: "to.aturi:/oauth/callback?iss=https%3A%2F%2Fauth.test&state=state-abc&code=c")!,
                expected: pendingRequest(),
                key: key
            )
            XCTFail("expected a server error")
        } catch let error as OAuthError {
            XCTAssertEqual(error, .server(status: 400, error: "invalid_grant", description: "code expired"))
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    // MARK: refresh

    func testRefreshPostsTheRefreshTokenAndRotatesIt() async throws {
        let transport = OAuthFakeTransport([
            "auth.test/.well-known/oauth-authorization-server": [(200, serverDocument, [:])],
            "auth.test/oauth/token": [
                (200, tokenDocument(refresh: "refresh-2").replacingOccurrences(of: "access-1", with: "access-2"), [:]),
                (200, tokenDocument(refresh: nil), [:]),
            ],
        ])
        let client = OAuthClient(http: HTTPClient(transport: transport))
        let refreshed = try await client.refresh(session(), key: key)

        let post = try XCTUnwrap(transport.requests(to: "/oauth/token").first)
        XCTAssertEqual(formFields(post), [
            "grant_type": "refresh_token",
            "refresh_token": "refresh-1",
            "client_id": "https://aturi.to/oauth-client-metadata-ios.json",
        ])
        XCTAssertEqual(proofPayload(post)?["htu"]?.stringValue, "https://auth.test/oauth/token")
        XCTAssertEqual(refreshed.accessToken, "access-2")
        XCTAssertEqual(refreshed.refreshToken, "refresh-2")
        XCTAssertEqual(refreshed.did, did)
        XCTAssertEqual(refreshed.handle, "alice.test")
        XCTAssertEqual(refreshed.pds, pds)
        XCTAssertEqual(refreshed.dpopKey, session().dpopKey)
        XCTAssertNotNil(refreshed.expiresAt)
        XCTAssertEqual(transport.requests.map { $0.url!.path }, ["/.well-known/oauth-authorization-server", "/oauth/token"])

        // The issuer metadata is cached: a second refresh skips discovery.
        let again = try await client.refresh(refreshed, key: key)
        XCTAssertEqual(again.accessToken, "access-1")
        XCTAssertEqual(again.refreshToken, "refresh-2")
        XCTAssertEqual(formFields(transport.requests(to: "/oauth/token")[1])["refresh_token"], "refresh-2")
        XCTAssertEqual(transport.requests(to: "/.well-known/oauth-authorization-server").count, 1)
    }

    func testRefreshKeepsTheOldRefreshTokenWhenNoneIsReturned() async throws {
        let transport = OAuthFakeTransport([
            "auth.test/.well-known/oauth-authorization-server": [(200, serverDocument, [:])],
            "auth.test/oauth/token": [(200, tokenDocument(refresh: nil), [:])],
        ])
        let refreshed = try await OAuthClient(http: HTTPClient(transport: transport)).refresh(session(), key: key)
        XCTAssertEqual(refreshed.refreshToken, "refresh-1")
        XCTAssertEqual(refreshed.accessToken, "access-1")
    }

    func testRefreshRetriesOnceOnNonceAndRejectsAForeignSubject() async throws {
        let transport = OAuthFakeTransport([
            "auth.test/.well-known/oauth-authorization-server": [(200, serverDocument, [:])],
            "auth.test/oauth/token": [
                (400, #"{"error":"use_dpop_nonce"}"#, ["DPoP-Nonce": "r-nonce"]),
                (200, tokenDocument(sub: "did:plc:other"), [:]),
            ],
        ])
        do {
            _ = try await OAuthClient(http: HTTPClient(transport: transport)).refresh(session(), key: key)
            XCTFail("expected a subject mismatch")
        } catch let error as OAuthError {
            XCTAssertEqual(error, .subjectMismatch(expected: did, actual: "did:plc:other"))
        } catch {
            XCTFail("unexpected \(error)")
        }
        let posts = transport.requests(to: "/oauth/token")
        XCTAssertEqual(posts.count, 2)
        XCTAssertEqual(proofPayload(posts[1])?["nonce"]?.stringValue, "r-nonce")
    }

    func testRefreshWithoutARefreshTokenFailsBeforeAnyRequest() async {
        let transport = OAuthFakeTransport([:])
        do {
            _ = try await OAuthClient(http: HTTPClient(transport: transport)).refresh(session(refresh: nil), key: key)
            XCTFail("expected missingRefreshToken")
        } catch let error as OAuthError {
            XCTAssertEqual(error, .missingRefreshToken)
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(transport.requests.count, 0)
    }

    func testRefreshSurfacesInvalidGrant() async {
        let transport = OAuthFakeTransport([
            "auth.test/.well-known/oauth-authorization-server": [(200, serverDocument, [:])],
            "auth.test/oauth/token": [(400, #"{"error":"invalid_grant","error_description":"revoked"}"#, [:])],
        ])
        do {
            _ = try await OAuthClient(http: HTTPClient(transport: transport)).refresh(session(), key: key)
            XCTFail("expected a server error")
        } catch let error as OAuthError {
            XCTAssertEqual(error, .server(status: 400, error: "invalid_grant", description: "revoked"))
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    // MARK: revoke

    func testRevokePostsTheRefreshTokenWithAHint() async throws {
        let transport = OAuthFakeTransport([
            "auth.test/.well-known/oauth-authorization-server": [(200, serverDocument, [:])],
            "auth.test/oauth/revoke": [(200, "{}", [:])],
        ])
        try await OAuthClient(http: HTTPClient(transport: transport)).revoke(session(), key: key)
        let post = try XCTUnwrap(transport.requests(to: "/oauth/revoke").first)
        XCTAssertEqual(formFields(post), [
            "token": "refresh-1",
            "token_type_hint": "refresh_token",
            "client_id": "https://aturi.to/oauth-client-metadata-ios.json",
        ])
        XCTAssertNotNil(post.value(forHTTPHeaderField: "DPoP"))
    }

    func testRevokeFallsBackToTheAccessToken() async throws {
        let transport = OAuthFakeTransport([
            "auth.test/.well-known/oauth-authorization-server": [(200, serverDocument, [:])],
            "auth.test/oauth/revoke": [(200, "", [:])],
        ])
        try await OAuthClient(http: HTTPClient(transport: transport)).revoke(session(refresh: nil), key: key)
        let fields = formFields(try XCTUnwrap(transport.requests(to: "/oauth/revoke").first))
        XCTAssertEqual(fields["token"], "access-0")
        XCTAssertEqual(fields["token_type_hint"], "access_token")
    }

    func testRevokeIsANoOpWithoutARevocationEndpoint() async throws {
        let transport = OAuthFakeTransport([
            "auth.test/.well-known/oauth-authorization-server": [
                (200, serverDocument.replacingOccurrences(of: #""revocation_endpoint":"https://auth.test/oauth/revoke","#, with: ""), [:]),
            ],
        ])
        try await OAuthClient(http: HTTPClient(transport: transport)).revoke(session(), key: key)
        XCTAssertEqual(transport.requests.count, 1)
    }

    // MARK: Helpers

    func testFormEncodingMatchesEncodeURIComponent() {
        XCTAssertEqual(
            OAuthClient.formEncode([("scope", "atproto rpc:*?aud=did:web:x%23y"), ("redirect_uri", "to.aturi:/oauth/callback")]),
            "scope=atproto%20rpc%3A*%3Faud%3Ddid%3Aweb%3Ax%2523y&redirect_uri=to.aturi%3A%2Foauth%2Fcallback"
        )
    }

    func testAppendingQueryKeepsAnExistingQuery() {
        let url = OAuthClient.appendingQuery(URL(string: "https://auth.test/authorize?tenant=a")!, [("request_uri", "urn:x:y")])
        XCTAssertEqual(url.absoluteString, "https://auth.test/authorize?tenant=a&request_uri=urn%3Ax%3Ay")
    }

    func testMetadataDefaultsToTheNativeClient() {
        XCTAssertEqual(OAuthClient(http: HTTPClient(transport: OAuthFakeTransport([:]))).metadata, .native)
    }
}
