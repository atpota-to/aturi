import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Routes by path so discovery's two fetches can be scripted independently.
private final class DiscoveryFakeTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private let routes: [String: (Int, String)]
    private(set) var requests: [URLRequest] = []

    init(_ routes: [String: (Int, String)]) {
        self.routes = routes
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let (status, body) = record(request) else {
            throw URLError(.cannotFindHost)
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        return (Data(body.utf8), response)
    }

    private func record(_ request: URLRequest) -> (Int, String)? {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
        let url = request.url!
        return routes[url.host! + url.path]
    }
}

private let resourceDocument = #"{"resource":"https://pds.test","authorization_servers":["https://auth.test"],"scopes_supported":["atproto","transition:generic"],"bearer_methods_supported":["header"]}"#

private func serverDocument(issuer: String = "https://auth.test", extra: String = "") -> String {
    #"{"issuer":"\#(issuer)","authorization_endpoint":"https://auth.test/oauth/authorize","token_endpoint":"https://auth.test/oauth/token","pushed_authorization_request_endpoint":"https://auth.test/oauth/par","revocation_endpoint":"https://auth.test/oauth/revoke","scopes_supported":["atproto"],"response_types_supported":["code"],"grant_types_supported":["authorization_code","refresh_token"],"code_challenge_methods_supported":["S256"],"token_endpoint_auth_methods_supported":["none","private_key_jwt"],"dpop_signing_alg_values_supported":["ES256"],"require_pushed_authorization_requests":true,"authorization_response_iss_parameter_supported":true,"client_id_metadata_document_supported":true\#(extra)}"#
}

final class OAuthMetadataTests: XCTestCase {
    // MARK: Client metadata

    /// Pinned against `buildIosClientMetadata` in `src/lib/__tests__/iosApp.test.ts`.
    func testNativeMetadataMatchesTheSite() {
        let native = OAuthClientMetadata.native
        XCTAssertEqual(native.clientId, "https://aturi.to/oauth-client-metadata-ios.json")
        XCTAssertEqual(native.clientName, "Aturi for iOS")
        XCTAssertEqual(native.clientUri, "https://aturi.to")
        XCTAssertEqual(native.logoUri, "https://aturi.to/icon.svg")
        XCTAssertEqual(native.tosUri, "https://aturi.to/terms")
        XCTAssertEqual(native.policyUri, "https://aturi.to/terms")
        XCTAssertEqual(native.redirectUris, ["to.aturi:/oauth/callback"])
        XCTAssertEqual(native.redirectURI, "to.aturi:/oauth/callback")
        XCTAssertEqual(native.scope, Scopes.metadataScope)
        XCTAssertEqual(native.grantTypes, ["authorization_code", "refresh_token"])
        XCTAssertEqual(native.responseTypes, ["code"])
        XCTAssertEqual(native.tokenEndpointAuthMethod, "none")
        XCTAssertEqual(native.applicationType, "native")
        XCTAssertTrue(native.dpopBoundAccessTokens)
        XCTAssertEqual(OAuthClientMetadata.nativeRedirectURI, "to.aturi:/oauth/callback")
    }

    func testClientMetadataEncodesWithSnakeCaseKeys() throws {
        let data = try JSONEncoder().encode(OAuthClientMetadata.native)
        let json = try JSONValue.parse(data)
        XCTAssertEqual(json["client_id"]?.stringValue, "https://aturi.to/oauth-client-metadata-ios.json")
        XCTAssertEqual(json["redirect_uris"]?[0]?.stringValue, "to.aturi:/oauth/callback")
        XCTAssertEqual(json["application_type"]?.stringValue, "native")
        XCTAssertEqual(json["token_endpoint_auth_method"]?.stringValue, "none")
        XCTAssertEqual(json["dpop_bound_access_tokens"]?.boolValue, true)
        XCTAssertEqual(json["grant_types"]?.arrayValue?.compactMap(\.stringValue), ["authorization_code", "refresh_token"])
        XCTAssertEqual(
            Set(json.objectValue!.keys),
            ["client_id", "client_name", "client_uri", "logo_uri", "tos_uri", "policy_uri", "redirect_uris", "scope",
             "grant_types", "response_types", "token_endpoint_auth_method", "application_type", "dpop_bound_access_tokens"]
        )
        XCTAssertEqual(try JSONDecoder().decode(OAuthClientMetadata.self, from: data), OAuthClientMetadata.native)
    }

    func testClientMetadataDecodesTheDocumentTheSiteServes() throws {
        let served = #"{"client_id":"https://aturi.to/oauth-client-metadata-ios.json","client_name":"Aturi for iOS","client_uri":"https://aturi.to","logo_uri":"https://aturi.to/icon.svg","tos_uri":"https://aturi.to/terms","policy_uri":"https://aturi.to/terms","redirect_uris":["to.aturi:/oauth/callback"],"scope":"\#(Scopes.metadataScope)","grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none","application_type":"native","dpop_bound_access_tokens":true}"#
        XCTAssertEqual(try JSONDecoder().decode(OAuthClientMetadata.self, from: Data(served.utf8)), OAuthClientMetadata.native)
    }

    // MARK: Server documents

    func testProtectedResourceMetadataDecodes() throws {
        let decoded = try JSONDecoder().decode(ProtectedResourceMetadata.self, from: Data(resourceDocument.utf8))
        XCTAssertEqual(decoded.resource, "https://pds.test")
        XCTAssertEqual(decoded.authorizationServers, ["https://auth.test"])
        XCTAssertEqual(decoded.scopesSupported, ["atproto", "transition:generic"])
        XCTAssertEqual(decoded.bearerMethodsSupported, ["header"])
        XCTAssertNil(decoded.resourceDocumentation)
    }

    func testAuthorizationServerMetadataDecodesAndRoundTrips() throws {
        let decoded = try JSONDecoder().decode(AuthorizationServerMetadata.self, from: Data(serverDocument().utf8))
        XCTAssertEqual(decoded.issuer, "https://auth.test")
        XCTAssertEqual(decoded.pushedAuthorizationRequestEndpoint, "https://auth.test/oauth/par")
        XCTAssertEqual(decoded.tokenEndpoint, "https://auth.test/oauth/token")
        XCTAssertEqual(decoded.authorizationEndpoint, "https://auth.test/oauth/authorize")
        XCTAssertEqual(decoded.revocationEndpoint, "https://auth.test/oauth/revoke")
        XCTAssertEqual(decoded.codeChallengeMethodsSupported, ["S256"])
        XCTAssertEqual(decoded.dpopSigningAlgValuesSupported, ["ES256"])
        XCTAssertEqual(decoded.requirePushedAuthorizationRequests, true)
        XCTAssertEqual(decoded.authorizationResponseIssParameterSupported, true)
        XCTAssertEqual(decoded.clientIdMetadataDocumentSupported, true)
        let reencoded = try JSONEncoder().encode(decoded)
        XCTAssertEqual(try JSONDecoder().decode(AuthorizationServerMetadata.self, from: reencoded), decoded)
        XCTAssertEqual(try JSONValue.parse(reencoded)["pushed_authorization_request_endpoint"]?.stringValue, "https://auth.test/oauth/par")
    }

    func testUnknownServerFieldsAreIgnored() throws {
        let decoded = try JSONDecoder().decode(
            AuthorizationServerMetadata.self,
            from: Data(serverDocument(extra: #","jwks_uri":"https://auth.test/jwks","ui_locales_supported":["en-US"]"#).utf8)
        )
        XCTAssertEqual(decoded.issuer, "https://auth.test")
    }

    // MARK: Origins

    func testOriginNormalizesSchemeHostAndDefaultPort() {
        XCTAssertEqual(OAuthDiscovery.origin(of: URL(string: "https://Bsky.Social/")!), "https://bsky.social")
        XCTAssertEqual(OAuthDiscovery.origin(of: URL(string: "https://bsky.social:443/xrpc/x?y#z")!), "https://bsky.social")
        XCTAssertEqual(OAuthDiscovery.origin(of: URL(string: "https://pds.test:8443/")!), "https://pds.test:8443")
        XCTAssertEqual(OAuthDiscovery.origin(of: URL(string: "http://localhost:2583")!), "http://localhost:2583")
        XCTAssertNil(OAuthDiscovery.origin(of: URL(string: "http://pds.test")!), "plain http is only for loopback")
        XCTAssertNil(OAuthDiscovery.origin(of: URL(string: "at://example.test/app.bsky.feed.post/3k")!))
        XCTAssertNil(OAuthDiscovery.origin(of: URL(string: "relative")!))
    }

    func testValidateChecksIssuerAndRequiredCapabilities() throws {
        let good = try JSONDecoder().decode(AuthorizationServerMetadata.self, from: Data(serverDocument().utf8))
        XCTAssertNoThrow(try OAuthDiscovery.validate(good, fetchedFrom: "https://auth.test"))

        var wrongIssuer = good
        wrongIssuer.issuer = "https://evil.test"
        XCTAssertThrowsError(try OAuthDiscovery.validate(wrongIssuer, fetchedFrom: "https://auth.test")) { error in
            XCTAssertEqual(error as? OAuthError, .issuerMismatch(expected: "https://auth.test", actual: "https://evil.test"))
        }

        var pathIssuer = good
        pathIssuer.issuer = "https://auth.test/oauth"
        XCTAssertThrowsError(try OAuthDiscovery.validate(pathIssuer, fetchedFrom: "https://auth.test"))

        var trailingSlash = good
        trailingSlash.issuer = "https://auth.test/"
        XCTAssertNoThrow(try OAuthDiscovery.validate(trailingSlash, fetchedFrom: "https://auth.test"))

        var noPAR = good
        noPAR.pushedAuthorizationRequestEndpoint = nil
        XCTAssertThrowsError(try OAuthDiscovery.validate(noPAR, fetchedFrom: "https://auth.test")) { error in
            XCTAssertEqual(error as? OAuthError, .missingEndpoint("pushed_authorization_request_endpoint"))
        }

        var noClientMetadata = good
        noClientMetadata.clientIdMetadataDocumentSupported = nil
        XCTAssertThrowsError(try OAuthDiscovery.validate(noClientMetadata, fetchedFrom: "https://auth.test"))

        var plainOnly = good
        plainOnly.codeChallengeMethodsSupported = ["plain"]
        XCTAssertThrowsError(try OAuthDiscovery.validate(plainOnly, fetchedFrom: "https://auth.test"))

        var rsaOnly = good
        rsaOnly.dpopSigningAlgValuesSupported = ["RS256"]
        XCTAssertThrowsError(try OAuthDiscovery.validate(rsaOnly, fetchedFrom: "https://auth.test"))

        var unspecified = good
        unspecified.codeChallengeMethodsSupported = nil
        unspecified.dpopSigningAlgValuesSupported = nil
        unspecified.responseTypesSupported = nil
        XCTAssertNoThrow(try OAuthDiscovery.validate(unspecified, fetchedFrom: "https://auth.test"), "absent lists are not refusals")
    }

    // MARK: Discovery

    func testDiscoverFetchesResourceThenIssuerRefusingRedirects() async throws {
        let transport = DiscoveryFakeTransport([
            "pds.test/.well-known/oauth-protected-resource": (200, resourceDocument),
            "auth.test/.well-known/oauth-authorization-server": (200, serverDocument()),
        ])
        let server = try await OAuthDiscovery.discover(pds: URL(string: "https://pds.test/")!, http: HTTPClient(transport: transport))
        XCTAssertEqual(server.issuer, "https://auth.test")
        XCTAssertEqual(server.pushedAuthorizationRequestEndpoint, "https://auth.test/oauth/par")
        XCTAssertEqual(transport.requests.map { $0.url!.absoluteString }, [
            "https://pds.test/.well-known/oauth-protected-resource",
            "https://auth.test/.well-known/oauth-authorization-server",
        ])
        for request in transport.requests {
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
            XCTAssertNotNil(request.value(forHTTPHeaderField: URLSessionTransport.noRedirectHeader), "metadata fetches refuse redirects")
        }
    }

    func testDiscoverRejectsAResourceDocumentForAnotherHost() async {
        let transport = DiscoveryFakeTransport([
            "pds.test/.well-known/oauth-protected-resource": (200, resourceDocument.replacingOccurrences(of: #""resource":"https://pds.test""#, with: #""resource":"https://other.test""#)),
        ])
        do {
            _ = try await OAuthDiscovery.discover(pds: URL(string: "https://pds.test")!, http: HTTPClient(transport: transport))
            XCTFail("expected a resource mismatch")
        } catch let error as OAuthError {
            XCTAssertEqual(error, .issuerMismatch(expected: "https://pds.test", actual: "https://other.test"))
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testDiscoverRejectsAnIssuerDocumentClaimingAnotherIssuer() async {
        let transport = DiscoveryFakeTransport([
            "pds.test/.well-known/oauth-protected-resource": (200, resourceDocument),
            "auth.test/.well-known/oauth-authorization-server": (200, serverDocument(issuer: "https://impostor.test")),
        ])
        do {
            _ = try await OAuthDiscovery.discover(pds: URL(string: "https://pds.test")!, http: HTTPClient(transport: transport))
            XCTFail("expected an issuer mismatch")
        } catch let error as OAuthError {
            XCTAssertEqual(error, .issuerMismatch(expected: "https://auth.test", actual: "https://impostor.test"))
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testDiscoverRejectsAResourceWithoutAuthorizationServers() async {
        let transport = DiscoveryFakeTransport([
            "pds.test/.well-known/oauth-protected-resource": (200, #"{"resource":"https://pds.test","authorization_servers":[]}"#),
        ])
        do {
            _ = try await OAuthDiscovery.discover(pds: URL(string: "https://pds.test")!, http: HTTPClient(transport: transport))
            XCTFail("expected invalid metadata")
        } catch let error as OAuthError {
            if case .invalidMetadata = error {} else { XCTFail("unexpected \(error)") }
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testDiscoverRejectsANonHTTPSIssuer() async {
        let transport = DiscoveryFakeTransport([
            "pds.test/.well-known/oauth-protected-resource": (200, resourceDocument.replacingOccurrences(of: "https://auth.test", with: "http://auth.test")),
        ])
        do {
            _ = try await OAuthDiscovery.discover(pds: URL(string: "https://pds.test")!, http: HTTPClient(transport: transport))
            XCTFail("expected invalid metadata")
        } catch let error as OAuthError {
            if case .invalidMetadata = error {} else { XCTFail("unexpected \(error)") }
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(transport.requests.count, 1, "nothing is fetched from an http issuer")
    }

    func testDiscoverSurfacesHTTPErrors() async {
        let transport = DiscoveryFakeTransport([
            "pds.test/.well-known/oauth-protected-resource": (503, "down"),
        ])
        do {
            _ = try await OAuthDiscovery.discover(pds: URL(string: "https://pds.test")!, http: HTTPClient(transport: transport))
            XCTFail("expected HTTPError")
        } catch let error as HTTPError {
            XCTAssertEqual(error.status, 503)
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(transport.requests.count, 1, "only a 404 triggers the entryway fallback")
    }

    func testDiscoverTreatsAnEntrywayAsItsOwnIssuerWhenTheResourceDocumentIs404() async throws {
        // bsky.social answers 404 for the protected resource document (it is
        // not a PDS) but serves authorization server metadata.
        let transport = DiscoveryFakeTransport([
            "auth.test/.well-known/oauth-protected-resource": (404, "Cannot GET /.well-known/oauth-protected-resource"),
            "auth.test/.well-known/oauth-authorization-server": (200, serverDocument()),
        ])
        let server = try await OAuthDiscovery.discover(pds: URL(string: "https://auth.test")!, http: HTTPClient(transport: transport))
        XCTAssertEqual(server.issuer, "https://auth.test")
        XCTAssertEqual(transport.requests.map { $0.url!.path }, [
            "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server",
        ])
    }

    func testDiscoverReportsTheOriginal404WhenTheFallbackFailsToo() async {
        let transport = DiscoveryFakeTransport([
            "pds.test/.well-known/oauth-protected-resource": (404, "nope"),
            "pds.test/.well-known/oauth-authorization-server": (404, "nope"),
        ])
        do {
            _ = try await OAuthDiscovery.discover(pds: URL(string: "https://pds.test")!, http: HTTPClient(transport: transport))
            XCTFail("expected HTTPError")
        } catch let error as HTTPError {
            XCTAssertEqual(error.status, 404)
            XCTAssertEqual(error.url.path, "/.well-known/oauth-protected-resource")
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(transport.requests.count, 2)
    }

    /// Live: bsky.social is both a PDS entryway and the authorization server
    /// for every bsky.social-hosted account.
    func testLiveDiscoveryAgainstBskySocial() async throws {
        let server: AuthorizationServerMetadata
        do {
            server = try await OAuthDiscovery.discover(pds: URL(string: "https://bsky.social")!)
        } catch let error as HTTPError where error.status >= 500 {
            throw XCTSkip("bsky.social answered \(error.status); skipping the live check")
        } catch let error as HTTPError {
            // A 4xx is a real answer: the endpoints moved, or the fallback broke.
            XCTFail("bsky.social answered \(error.status) for \(error.url)")
            return
        } catch let error as OAuthError {
            XCTFail("live metadata failed validation: \(error)")
            return
        } catch {
            throw XCTSkip("network unavailable: \(error)")
        }
        XCTAssertEqual(server.issuer, "https://bsky.social")
        XCTAssertEqual(server.pushedAuthorizationRequestEndpoint, "https://bsky.social/oauth/par")
        XCTAssertTrue(server.tokenEndpoint.hasPrefix("https://bsky.social/"))
        XCTAssertEqual(server.clientIdMetadataDocumentSupported, true)
        XCTAssertTrue(server.dpopSigningAlgValuesSupported?.contains("ES256") ?? false)
        XCTAssertTrue(server.codeChallengeMethodsSupported?.contains("S256") ?? false)
        XCTAssertTrue(server.scopesSupported?.contains("atproto") ?? false)
    }
}
