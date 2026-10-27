import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum OAuthError: Error, Equatable {
    /// A metadata document was missing something the atproto profile requires.
    case invalidMetadata(String)
    /// A document or callback named an issuer other than the one it came from.
    case issuerMismatch(expected: String, actual: String)
    case missingEndpoint(String)
    /// The redirect back into the app carried no usable parameters.
    case invalidCallback(String)
    /// The callback's `state` is not the one this flow sent.
    case stateMismatch
    /// The user or the server refused: the OAuth `error` and its description.
    case authorizationDenied(error: String, description: String?)
    case invalidTokenResponse(String)
    /// The token was issued for an account other than the one being signed in.
    case subjectMismatch(expected: String, actual: String)
    /// A non-2xx answer from an OAuth endpoint after the nonce retry.
    case server(status: Int, error: String?, description: String?)
    case missingRefreshToken
}

/// Everything `completeAuthorization` needs to finish a flow that
/// `beginAuthorization` started: the URL to open, the secrets bound to it,
/// and the identity it is for. Codable so the app can survive being
/// suspended while the browser sheet is up.
public struct AuthorizationRequest: Codable, Hashable, Sendable {
    public var authorizeURL: URL
    public var state: String
    /// The PKCE verifier; the challenge went out in the PAR.
    public var verifier: String
    public var issuer: String
    /// The nonce the authorization server handed back with the PAR
    /// response, so the token exchange can carry it straight away.
    public var dpopNonce: String?
    public var did: String
    public var handle: String?
    public var pds: URL
    /// The scope that was requested; the token response says what was granted.
    public var scope: String
    public var tokenEndpoint: URL
    public var revocationEndpoint: URL?

    public init(
        authorizeURL: URL,
        state: String,
        verifier: String,
        issuer: String,
        dpopNonce: String? = nil,
        did: String,
        handle: String? = nil,
        pds: URL,
        scope: String,
        tokenEndpoint: URL,
        revocationEndpoint: URL? = nil
    ) {
        self.authorizeURL = authorizeURL
        self.state = state
        self.verifier = verifier
        self.issuer = issuer
        self.dpopNonce = dpopNonce
        self.did = did
        self.handle = handle
        self.pds = pds
        self.scope = scope
        self.tokenEndpoint = tokenEndpoint
        self.revocationEndpoint = revocationEndpoint
    }
}

/// The token endpoint's answer (RFC 6749 section 5.1 plus `sub`, which
/// atproto requires so the client can confirm whose token it holds).
public struct OAuthTokenResponse: Codable, Hashable, Sendable {
    public var accessToken: String
    public var tokenType: String
    public var expiresIn: Double?
    public var refreshToken: String?
    public var scope: String?
    public var sub: String?

    public init(
        accessToken: String,
        tokenType: String,
        expiresIn: Double? = nil,
        refreshToken: String? = nil,
        scope: String? = nil,
        sub: String? = nil
    ) {
        self.accessToken = accessToken
        self.tokenType = tokenType
        self.expiresIn = expiresIn
        self.refreshToken = refreshToken
        self.scope = scope
        self.sub = sub
    }

    private enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case refreshToken = "refresh_token"
        case scope
        case sub
    }
}

/// The parameters the authorization server sends back on the redirect.
/// Parsed by hand: Foundation's `URLComponents` is unreliable for
/// custom-scheme URLs with a single-slash path (`to.aturi:/oauth/callback`)
/// on some platforms, and the shape is simple. The query is read first and
/// the fragment second, so a server using `response_mode=fragment` works too.
public struct OAuthCallbackParameters: Hashable, Sendable {
    public var code: String?
    public var state: String?
    public var iss: String?
    public var error: String?
    public var errorDescription: String?

    public init(callback: URL) {
        self.init(callbackString: callback.absoluteString)
    }

    public init(callbackString: String) {
        var fields: [String: String] = [:]
        let queryPart: Substring
        let fragmentPart: Substring
        let noFragment: Substring
        if let hash = callbackString.firstIndex(of: "#") {
            noFragment = callbackString[..<hash]
            fragmentPart = callbackString[callbackString.index(after: hash)...]
        } else {
            noFragment = callbackString[...]
            fragmentPart = ""
        }
        if let question = noFragment.firstIndex(of: "?") {
            queryPart = noFragment[noFragment.index(after: question)...]
        } else {
            queryPart = ""
        }
        for part in [queryPart, fragmentPart] {
            for pair in part.split(separator: "&") {
                let keyValue = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
                guard let rawKey = keyValue.first, !rawKey.isEmpty else { continue }
                let key = Self.formDecode(String(rawKey))
                let value = keyValue.count > 1 ? Self.formDecode(String(keyValue[1])) : ""
                if fields[key] == nil {
                    fields[key] = value
                }
            }
        }
        code = fields["code"]
        state = fields["state"]
        iss = fields["iss"]
        error = fields["error"]
        errorDescription = fields["error_description"]
    }

    private static func formDecode(_ value: String) -> String {
        value.replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? value
    }
}

/// The atproto OAuth flow for a native client, as `@atproto/oauth-client`
/// runs it in the web app and its browser sheet: pushed authorization
/// request, PKCE S256, DPoP-bound tokens, `use_dpop_nonce` retried once,
/// issuer and state checked on the way back, refresh and revoke against the
/// same issuer. Signing is behind `DPoPKey`; every request goes through
/// `HTTPClient.send`, so the whole flow runs against a fake transport.
public final class OAuthClient: Sendable {
    public let metadata: OAuthClientMetadata
    private let http: HTTPClient
    private let nonces: DPoPNonceStore
    /// Issuer metadata rarely changes; caching it saves a fetch per refresh.
    private let serverMetadataCache = TTLCache<String, AuthorizationServerMetadata>(ttl: 3600)

    public init(
        http: HTTPClient = .shared,
        metadata: OAuthClientMetadata = .native,
        nonces: DPoPNonceStore = DPoPNonceStore()
    ) {
        self.http = http
        self.metadata = metadata
        self.nonces = nonces
    }

    // MARK: Authorization

    /// Discover the account's authorization server, push the authorization
    /// request, and hand back the URL to open in the browser sheet along
    /// with what the callback will be checked against.
    public func beginAuthorization(
        did: String,
        pds: URL,
        scope: String,
        key: DPoPKey,
        handleHint: String? = nil
    ) async throws -> AuthorizationRequest {
        let server = try await OAuthDiscovery.discover(pds: pds, http: http)
        await serverMetadataCache.set(server.issuer, server)

        guard let parEndpoint = server.pushedAuthorizationRequestEndpoint.flatMap(URL.init(string:)) else {
            throw OAuthError.missingEndpoint("pushed_authorization_request_endpoint")
        }
        guard let authorizationEndpoint = URL(string: server.authorizationEndpoint) else {
            throw OAuthError.missingEndpoint("authorization_endpoint")
        }
        guard let tokenEndpoint = URL(string: server.tokenEndpoint) else {
            throw OAuthError.missingEndpoint("token_endpoint")
        }

        let state = OAuthRandom.token(bytes: 32)
        let verifier = PKCE.generateVerifier()
        let challenge = PKCE.challenge(for: verifier)

        // login_hint is whatever identifies the account to the server's
        // sign-in page: the handle when we have one, else the DID, which is
        // what the reference client sends (the user's own input).
        let loginHint = (handleHint?.isEmpty == false) ? handleHint! : did
        let form: [(String, String)] = [
            ("client_id", metadata.clientId),
            ("redirect_uri", metadata.redirectURI),
            ("scope", scope),
            ("state", state),
            ("code_challenge", challenge),
            ("code_challenge_method", PKCE.challengeMethod),
            ("response_type", "code"),
            ("login_hint", loginHint),
        ]

        let (data, response) = try await postForm(form, to: parEndpoint, key: key)
        try Self.throwOnFailure(data: data, response: response)

        let body = try JSONValue.parse(data)
        guard let requestURI = body["request_uri"]?.stringValue, !requestURI.isEmpty else {
            throw OAuthError.invalidTokenResponse("PAR response has no request_uri")
        }

        let authorizeURL = Self.appendingQuery(
            authorizationEndpoint,
            [("client_id", metadata.clientId), ("request_uri", requestURI)]
        )
        let nonce = HTTPClient.header(DPoPRequestSender.nonceHeader, in: response)
        return AuthorizationRequest(
            authorizeURL: authorizeURL,
            state: state,
            verifier: verifier,
            issuer: server.issuer,
            dpopNonce: nonce,
            did: did,
            handle: handleHint,
            pds: pds,
            scope: scope,
            tokenEndpoint: tokenEndpoint,
            revocationEndpoint: server.revocationEndpoint.flatMap(URL.init(string:))
        )
    }

    /// Check the redirect against the pending request and exchange its code
    /// for tokens. `iss` is required: every atproto authorization server
    /// sends it, and without it the client cannot tell which server
    /// answered.
    public func completeAuthorization(
        callback: URL,
        expected: AuthorizationRequest,
        key: DPoPKey
    ) async throws -> OAuthSession {
        let params = OAuthCallbackParameters(callback: callback)

        // State first: an error response for someone else's flow is still
        // someone else's flow.
        guard let state = params.state, !state.isEmpty else {
            throw OAuthError.invalidCallback("missing state")
        }
        guard state == expected.state else {
            throw OAuthError.stateMismatch
        }
        if let error = params.error {
            throw OAuthError.authorizationDenied(error: error, description: params.errorDescription)
        }
        guard let iss = params.iss, !iss.isEmpty else {
            throw OAuthError.invalidCallback("missing iss")
        }
        guard iss == expected.issuer else {
            throw OAuthError.issuerMismatch(expected: expected.issuer, actual: iss)
        }
        guard let code = params.code, !code.isEmpty else {
            throw OAuthError.invalidCallback("missing code")
        }

        let form: [(String, String)] = [
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", metadata.redirectURI),
            ("client_id", metadata.clientId),
            ("code_verifier", expected.verifier),
        ]
        let (data, response) = try await postForm(form, to: expected.tokenEndpoint, key: key, initialNonce: expected.dpopNonce)
        try Self.throwOnFailure(data: data, response: response)
        let token = try Self.decodeTokenResponse(data, expectedSubject: expected.did)

        return OAuthSession(
            did: expected.did,
            handle: expected.handle,
            pds: expected.pds,
            issuer: expected.issuer,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresAt: token.expiresIn.map { Date().addingTimeInterval($0) },
            scope: token.scope,
            tokenType: token.tokenType,
            dpopKey: try Self.serialize(key)
        )
    }

    // MARK: Refresh and revoke

    /// Trade the refresh token for a new pair. The server rotates the
    /// refresh token; when it does not send a new one the old one stays.
    public func refresh(_ session: OAuthSession, key: DPoPKey) async throws -> OAuthSession {
        guard let refreshToken = session.refreshToken, !refreshToken.isEmpty else {
            throw OAuthError.missingRefreshToken
        }
        let server = try await serverMetadata(issuer: session.issuer)
        guard let tokenEndpoint = URL(string: server.tokenEndpoint) else {
            throw OAuthError.missingEndpoint("token_endpoint")
        }
        let form: [(String, String)] = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refreshToken),
            ("client_id", metadata.clientId),
        ]
        let (data, response) = try await postForm(form, to: tokenEndpoint, key: key)
        try Self.throwOnFailure(data: data, response: response)
        let token = try Self.decodeTokenResponse(data, expectedSubject: session.did)

        var refreshed = session
        refreshed.accessToken = token.accessToken
        refreshed.refreshToken = token.refreshToken ?? session.refreshToken
        refreshed.expiresAt = token.expiresIn.map { Date().addingTimeInterval($0) }
        refreshed.scope = token.scope ?? session.scope
        refreshed.tokenType = token.tokenType
        return refreshed
    }

    /// RFC 7009 revocation of the refresh token (which invalidates the
    /// whole grant) or, without one, the access token. A server without a
    /// revocation endpoint simply cannot be told; the caller still forgets
    /// the session.
    public func revoke(_ session: OAuthSession, key: DPoPKey) async throws {
        let server = try await serverMetadata(issuer: session.issuer)
        guard let endpoint = server.revocationEndpoint.flatMap(URL.init(string:)) else {
            return
        }
        let token = session.refreshToken?.isEmpty == false ? session.refreshToken! : session.accessToken
        let hint = session.refreshToken?.isEmpty == false ? "refresh_token" : "access_token"
        let form: [(String, String)] = [
            ("token", token),
            ("token_type_hint", hint),
            ("client_id", metadata.clientId),
        ]
        let (data, response) = try await postForm(form, to: endpoint, key: key)
        try Self.throwOnFailure(data: data, response: response)
    }

    /// Cached issuer metadata, fetched and validated on a miss.
    public func serverMetadata(issuer: String) async throws -> AuthorizationServerMetadata {
        if let cached = await serverMetadataCache.get(issuer) {
            return cached
        }
        let fetched = try await OAuthDiscovery.authorizationServer(issuer: issuer, http: http)
        await serverMetadataCache.set(issuer, fetched)
        return fetched
    }

    // MARK: Plumbing

    private func postForm(
        _ form: [(String, String)],
        to endpoint: URL,
        key: DPoPKey,
        initialNonce: String? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.httpBody = Data(Self.formEncode(form).utf8)
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await DPoPRequestSender.send(
            request, http: http, key: key, nonces: nonces, initialNonce: initialNonce
        )
    }

    /// `application/x-www-form-urlencoded` with `encodeURIComponent`
    /// escaping, which servers decode identically to what `URLSearchParams`
    /// produces; every scope token survives the round trip byte for byte.
    static func formEncode(_ form: [(String, String)]) -> String {
        form.map { URIEncoding.encodeComponent($0.0) + "=" + URIEncoding.encodeComponent($0.1) }
            .joined(separator: "&")
    }

    static func appendingQuery(_ url: URL, _ query: [(String, String)]) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: true) else { return url }
        let encoded = formEncode(query)
        if let existing = components.percentEncodedQuery, !existing.isEmpty {
            components.percentEncodedQuery = existing + "&" + encoded
        } else {
            components.percentEncodedQuery = encoded
        }
        return components.url ?? url
    }

    static func decodeTokenResponse(_ data: Data, expectedSubject: String) throws -> OAuthTokenResponse {
        let token: OAuthTokenResponse
        do {
            token = try JSONDecoder().decode(OAuthTokenResponse.self, from: data)
        } catch {
            throw OAuthError.invalidTokenResponse("token response is not the expected JSON: \(error)")
        }
        guard token.tokenType.lowercased() == "dpop" else {
            throw OAuthError.invalidTokenResponse("token_type must be DPoP, got \(token.tokenType)")
        }
        guard let sub = token.sub, !sub.isEmpty else {
            throw OAuthError.invalidTokenResponse("token response has no sub")
        }
        guard sub == expectedSubject else {
            throw OAuthError.subjectMismatch(expected: expectedSubject, actual: sub)
        }
        guard Scopes.hasBaseScope(token.scope) else {
            throw OAuthError.invalidTokenResponse("token response lacks the atproto scope")
        }
        return token
    }

    static func throwOnFailure(data: Data, response: HTTPURLResponse) throws {
        guard !(200..<300).contains(response.statusCode) else { return }
        let body = try? JSONValue.parse(data)
        throw OAuthError.server(
            status: response.statusCode,
            error: body?["error"]?.stringValue,
            description: body?["error_description"]?.stringValue
                ?? body?["message"]?.stringValue
                ?? (body == nil && !data.isEmpty ? String(decoding: data, as: UTF8.self) : nil)
        )
    }

    /// Keys reach the session in their at-rest form; a fake key in tests
    /// serializes what it can describe.
    static func serialize(_ key: DPoPKey) throws -> DPoPKeySerialization {
        if let serializable = key as? DPoPKeySerializable {
            return serializable.serialized
        }
        return DPoPKeySerialization(format: "opaque", privateKey: Data(), publicJWK: key.publicJWK)
    }
}

/// A key that can describe itself for storage. `P256DPoPKey` conforms; the
/// protocol is separate from `DPoPKey` so a hardware-backed key that cannot
/// be exported still signs.
public protocol DPoPKeySerializable: DPoPKey {
    var serialized: DPoPKeySerialization { get }
}

#if canImport(CryptoKit)
extension P256DPoPKey: DPoPKeySerializable {}
#endif
