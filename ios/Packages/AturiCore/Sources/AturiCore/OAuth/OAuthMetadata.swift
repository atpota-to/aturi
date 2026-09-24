import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// OAuth client metadata (the client-id-metadata-document draft, as atproto
/// profiles it). Keys are the wire spelling so the struct round-trips the
/// document the site serves at `/oauth-client-metadata-ios.json`; see
/// `src/lib/iosApp.ts`, whose test pins the same values.
public struct OAuthClientMetadata: Codable, Hashable, Sendable {
    public var clientId: String
    public var clientName: String?
    public var clientUri: String?
    public var logoUri: String?
    public var tosUri: String?
    public var policyUri: String?
    public var redirectUris: [String]
    public var scope: String
    public var grantTypes: [String]
    public var responseTypes: [String]
    public var tokenEndpointAuthMethod: String
    public var applicationType: String
    public var dpopBoundAccessTokens: Bool

    public init(
        clientId: String,
        clientName: String? = nil,
        clientUri: String? = nil,
        logoUri: String? = nil,
        tosUri: String? = nil,
        policyUri: String? = nil,
        redirectUris: [String],
        scope: String,
        grantTypes: [String] = ["authorization_code", "refresh_token"],
        responseTypes: [String] = ["code"],
        tokenEndpointAuthMethod: String = "none",
        applicationType: String = "native",
        dpopBoundAccessTokens: Bool = true
    ) {
        self.clientId = clientId
        self.clientName = clientName
        self.clientUri = clientUri
        self.logoUri = logoUri
        self.tosUri = tosUri
        self.policyUri = policyUri
        self.redirectUris = redirectUris
        self.scope = scope
        self.grantTypes = grantTypes
        self.responseTypes = responseTypes
        self.tokenEndpointAuthMethod = tokenEndpointAuthMethod
        self.applicationType = applicationType
        self.dpopBoundAccessTokens = dpopBoundAccessTokens
    }

    private enum CodingKeys: String, CodingKey {
        case clientId = "client_id"
        case clientName = "client_name"
        case clientUri = "client_uri"
        case logoUri = "logo_uri"
        case tosUri = "tos_uri"
        case policyUri = "policy_uri"
        case redirectUris = "redirect_uris"
        case scope
        case grantTypes = "grant_types"
        case responseTypes = "response_types"
        case tokenEndpointAuthMethod = "token_endpoint_auth_method"
        case applicationType = "application_type"
        case dpopBoundAccessTokens = "dpop_bound_access_tokens"
    }

    /// The origin the metadata document lives on. atproto ties a client's
    /// identity to that URL, which is why the app's metadata is served by
    /// the site rather than bundled.
    public static let clientOrigin = "https://aturi.to"

    public static let nativeMetadataPath = "/oauth-client-metadata-ios.json"

    /// The reverse-domain custom scheme the spec requires of a native
    /// client whose client_id host is `aturi.to`. One slash, not two: a
    /// custom-scheme URI with an authority component fails the
    /// authorization server's redirect_uri validation.
    public static let nativeRedirectURI = "to.aturi:/oauth/callback"

    /// `buildIosClientMetadata('https://aturi.to')` from `src/lib/iosApp.ts`.
    public static let native = OAuthClientMetadata(
        clientId: clientOrigin + nativeMetadataPath,
        clientName: "Aturi for iOS",
        clientUri: clientOrigin,
        logoUri: clientOrigin + "/icon.svg",
        tosUri: clientOrigin + "/terms",
        policyUri: clientOrigin + "/terms",
        redirectUris: [nativeRedirectURI],
        scope: Scopes.metadataScope,
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        applicationType: "native",
        dpopBoundAccessTokens: true
    )

    /// The redirect the flow uses: the first registered one.
    public var redirectURI: String {
        redirectUris.first ?? ""
    }
}

/// RFC 9728 protected resource metadata, served by a PDS at
/// `/.well-known/oauth-protected-resource`. Names the authorization server
/// (the entryway) that issues tokens for it.
public struct ProtectedResourceMetadata: Codable, Hashable, Sendable {
    public var resource: String
    public var authorizationServers: [String]
    public var scopesSupported: [String]?
    public var bearerMethodsSupported: [String]?
    public var resourceDocumentation: String?

    public init(
        resource: String,
        authorizationServers: [String],
        scopesSupported: [String]? = nil,
        bearerMethodsSupported: [String]? = nil,
        resourceDocumentation: String? = nil
    ) {
        self.resource = resource
        self.authorizationServers = authorizationServers
        self.scopesSupported = scopesSupported
        self.bearerMethodsSupported = bearerMethodsSupported
        self.resourceDocumentation = resourceDocumentation
    }

    private enum CodingKeys: String, CodingKey {
        case resource
        case authorizationServers = "authorization_servers"
        case scopesSupported = "scopes_supported"
        case bearerMethodsSupported = "bearer_methods_supported"
        case resourceDocumentation = "resource_documentation"
    }
}

/// RFC 8414 authorization server metadata with the fields atproto adds,
/// served at `/.well-known/oauth-authorization-server` on the issuer.
public struct AuthorizationServerMetadata: Codable, Hashable, Sendable {
    public var issuer: String
    public var authorizationEndpoint: String
    public var tokenEndpoint: String
    public var pushedAuthorizationRequestEndpoint: String?
    public var revocationEndpoint: String?
    public var introspectionEndpoint: String?
    public var scopesSupported: [String]?
    public var responseTypesSupported: [String]?
    public var responseModesSupported: [String]?
    public var grantTypesSupported: [String]?
    public var codeChallengeMethodsSupported: [String]?
    public var tokenEndpointAuthMethodsSupported: [String]?
    public var dpopSigningAlgValuesSupported: [String]?
    public var requirePushedAuthorizationRequests: Bool?
    public var authorizationResponseIssParameterSupported: Bool?
    public var clientIdMetadataDocumentSupported: Bool?
    public var protectedResources: [String]?

    public init(
        issuer: String,
        authorizationEndpoint: String,
        tokenEndpoint: String,
        pushedAuthorizationRequestEndpoint: String? = nil,
        revocationEndpoint: String? = nil,
        introspectionEndpoint: String? = nil,
        scopesSupported: [String]? = nil,
        responseTypesSupported: [String]? = nil,
        responseModesSupported: [String]? = nil,
        grantTypesSupported: [String]? = nil,
        codeChallengeMethodsSupported: [String]? = nil,
        tokenEndpointAuthMethodsSupported: [String]? = nil,
        dpopSigningAlgValuesSupported: [String]? = nil,
        requirePushedAuthorizationRequests: Bool? = nil,
        authorizationResponseIssParameterSupported: Bool? = nil,
        clientIdMetadataDocumentSupported: Bool? = nil,
        protectedResources: [String]? = nil
    ) {
        self.issuer = issuer
        self.authorizationEndpoint = authorizationEndpoint
        self.tokenEndpoint = tokenEndpoint
        self.pushedAuthorizationRequestEndpoint = pushedAuthorizationRequestEndpoint
        self.revocationEndpoint = revocationEndpoint
        self.introspectionEndpoint = introspectionEndpoint
        self.scopesSupported = scopesSupported
        self.responseTypesSupported = responseTypesSupported
        self.responseModesSupported = responseModesSupported
        self.grantTypesSupported = grantTypesSupported
        self.codeChallengeMethodsSupported = codeChallengeMethodsSupported
        self.tokenEndpointAuthMethodsSupported = tokenEndpointAuthMethodsSupported
        self.dpopSigningAlgValuesSupported = dpopSigningAlgValuesSupported
        self.requirePushedAuthorizationRequests = requirePushedAuthorizationRequests
        self.authorizationResponseIssParameterSupported = authorizationResponseIssParameterSupported
        self.clientIdMetadataDocumentSupported = clientIdMetadataDocumentSupported
        self.protectedResources = protectedResources
    }

    private enum CodingKeys: String, CodingKey {
        case issuer
        case authorizationEndpoint = "authorization_endpoint"
        case tokenEndpoint = "token_endpoint"
        case pushedAuthorizationRequestEndpoint = "pushed_authorization_request_endpoint"
        case revocationEndpoint = "revocation_endpoint"
        case introspectionEndpoint = "introspection_endpoint"
        case scopesSupported = "scopes_supported"
        case responseTypesSupported = "response_types_supported"
        case responseModesSupported = "response_modes_supported"
        case grantTypesSupported = "grant_types_supported"
        case codeChallengeMethodsSupported = "code_challenge_methods_supported"
        case tokenEndpointAuthMethodsSupported = "token_endpoint_auth_methods_supported"
        case dpopSigningAlgValuesSupported = "dpop_signing_alg_values_supported"
        case requirePushedAuthorizationRequests = "require_pushed_authorization_requests"
        case authorizationResponseIssParameterSupported = "authorization_response_iss_parameter_supported"
        case clientIdMetadataDocumentSupported = "client_id_metadata_document_supported"
        case protectedResources = "protected_resources"
    }
}

/// Locating the authorization server for a PDS, the way
/// `@atproto/oauth-client` does: the PDS names its issuer in its protected
/// resource metadata, and the issuer's own metadata names the endpoints.
/// Both fetches refuse redirects, and both documents are checked against
/// the origin they came from so a compromised or misconfigured host cannot
/// point the flow at an issuer of its choosing (the mix-up attack RFC 8414
/// section 2 and the OAuth 2.1 draft warn about).
public enum OAuthDiscovery {
    public static let protectedResourcePath = "/.well-known/oauth-protected-resource"
    public static let authorizationServerPath = "/.well-known/oauth-authorization-server"

    /// PDS -> protected resource metadata -> first authorization server ->
    /// its validated metadata.
    ///
    /// An entryway such as bsky.social is an authorization server but not a
    /// resource server, so it has no protected resource document (404). The
    /// reference client then tries the input as the issuer itself, and so
    /// does this; any other failure, and a failed fallback, surface the
    /// original error.
    public static func discover(pds: URL, http: HTTPClient = .shared) async throws -> AuthorizationServerMetadata {
        let resource: ProtectedResourceMetadata
        do {
            resource = try await protectedResource(pds: pds, http: http)
        } catch let error as HTTPError where error.status == 404 {
            guard let origin = origin(of: pds),
                let server = try? await authorizationServer(issuer: origin, http: http)
            else {
                throw error
            }
            return server
        }
        guard let issuer = resource.authorizationServers.first, !issuer.isEmpty else {
            throw OAuthError.invalidMetadata("protected resource metadata names no authorization server")
        }
        return try await authorizationServer(issuer: issuer, http: http)
    }

    /// The PDS's `/.well-known/oauth-protected-resource`, checked to
    /// describe the origin it was fetched from.
    public static func protectedResource(pds: URL, http: HTTPClient = .shared) async throws -> ProtectedResourceMetadata {
        guard let pdsOrigin = origin(of: pds) else {
            throw OAuthError.invalidMetadata("PDS URL has no origin: \(pds.absoluteString)")
        }
        let url = makeURL(URL(string: pdsOrigin)!, path: protectedResourcePath)
        let metadata = try await http.getJSON(
            ProtectedResourceMetadata.self,
            from: url,
            headers: ["Accept": "application/json"],
            refuseRedirects: true
        )
        guard let declared = URL(string: metadata.resource).flatMap(origin(of:)), declared == pdsOrigin else {
            throw OAuthError.issuerMismatch(expected: pdsOrigin, actual: metadata.resource)
        }
        return metadata
    }

    /// The issuer's `/.well-known/oauth-authorization-server`, checked for
    /// the issuer match and the capabilities the atproto profile requires
    /// of every server (PAR, S256, ES256 DPoP, client metadata documents).
    public static func authorizationServer(issuer: String, http: HTTPClient = .shared) async throws -> AuthorizationServerMetadata {
        guard let issuerURL = URL(string: issuer), let issuerOrigin = origin(of: issuerURL),
            isPlainOrigin(issuerURL)
        else {
            throw OAuthError.invalidMetadata("issuer must be an https origin without a path: \(issuer)")
        }
        let url = makeURL(URL(string: issuerOrigin)!, path: authorizationServerPath)
        let metadata = try await http.getJSON(
            AuthorizationServerMetadata.self,
            from: url,
            headers: ["Accept": "application/json"],
            refuseRedirects: true
        )
        try validate(metadata, fetchedFrom: issuerOrigin)
        return metadata
    }

    /// The checks `discover` applies; separate so cached metadata can be
    /// re-validated and so tests can exercise them without a transport.
    public static func validate(_ metadata: AuthorizationServerMetadata, fetchedFrom issuerOrigin: String) throws {
        guard let declared = URL(string: metadata.issuer), isPlainOrigin(declared),
            let declaredOrigin = origin(of: declared), declaredOrigin == issuerOrigin
        else {
            throw OAuthError.issuerMismatch(expected: issuerOrigin, actual: metadata.issuer)
        }
        guard let par = metadata.pushedAuthorizationRequestEndpoint, !par.isEmpty, URL(string: par) != nil else {
            throw OAuthError.missingEndpoint("pushed_authorization_request_endpoint")
        }
        guard URL(string: metadata.authorizationEndpoint) != nil else {
            throw OAuthError.missingEndpoint("authorization_endpoint")
        }
        guard URL(string: metadata.tokenEndpoint) != nil else {
            throw OAuthError.missingEndpoint("token_endpoint")
        }
        // atproto clients are identified by a metadata document URL; a
        // server that does not resolve those cannot know this client.
        guard metadata.clientIdMetadataDocumentSupported == true else {
            throw OAuthError.invalidMetadata("authorization server does not support client_id_metadata_document")
        }
        if let methods = metadata.codeChallengeMethodsSupported, !methods.contains(PKCE.challengeMethod) {
            throw OAuthError.invalidMetadata("authorization server does not support S256 PKCE")
        }
        if let algs = metadata.dpopSigningAlgValuesSupported, !algs.contains(DPoPProof.algorithm) {
            throw OAuthError.invalidMetadata("authorization server does not support ES256 DPoP proofs")
        }
        if let types = metadata.responseTypesSupported, !types.contains("code") {
            throw OAuthError.invalidMetadata("authorization server does not support the code response type")
        }
    }

    /// `scheme://host[:port]`, lowercased, with a default port dropped; nil
    /// when the URL has no scheme or host. https only, except that the
    /// loopback shortcut the spec allows for development keeps http.
    public static func origin(of url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: true),
            let scheme = components.scheme?.lowercased(),
            let host = components.host?.lowercased(), !host.isEmpty
        else {
            return nil
        }
        let loopback = host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
        guard scheme == "https" || (scheme == "http" && loopback) else { return nil }
        var origin = scheme + "://" + host
        if let port = components.port, !(scheme == "https" && port == 443), !(scheme == "http" && port == 80) {
            origin += ":" + String(port)
        }
        return origin
    }

    /// An issuer identifier carries nothing but its origin: no path beyond
    /// an optional trailing slash, no query, no fragment, no credentials.
    static func isPlainOrigin(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: true) else { return false }
        let path = components.percentEncodedPath
        return (path.isEmpty || path == "/")
            && components.query == nil && components.fragment == nil
            && components.user == nil && components.password == nil
    }
}
