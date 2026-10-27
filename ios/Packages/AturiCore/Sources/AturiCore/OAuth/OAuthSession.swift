import Foundation

/// A signed-in account: the DPoP-bound token pair the authorization server
/// issued, where to spend it, and the key it is bound to. Codable so the
/// app can keep the whole thing as one Keychain item (the `dpopKey` blob is
/// the private key, so this must never be written anywhere less protected).
///
/// The web keeps the equivalent inside `@atproto/oauth-client-browser`'s
/// IndexedDB session store; the fields here are the ones its
/// `OAuthSession.getTokenInfo()` exposes plus the key material.
public struct OAuthSession: Codable, Hashable, Sendable {
    public var did: String
    public var handle: String?
    /// The PDS the account lives on; the resource server every
    /// authenticated XRPC call goes to.
    public var pds: URL
    /// The authorization server the tokens came from. Refresh and revoke go
    /// back to it, and a callback from any other issuer is a mix-up attack.
    public var issuer: String
    public var accessToken: String
    public var refreshToken: String?
    /// When the access token stops working; nil when the server did not say.
    public var expiresAt: Date?
    /// The granted scope as the server reported it, which can be narrower
    /// than what was requested.
    public var scope: String?
    /// Always `DPoP` for an atproto token; kept so a session reveals what
    /// kind of Authorization header it needs.
    public var tokenType: String
    /// The key the tokens are bound to, in its at-rest form.
    public var dpopKey: DPoPKeySerialization

    public init(
        did: String,
        handle: String? = nil,
        pds: URL,
        issuer: String,
        accessToken: String,
        refreshToken: String? = nil,
        expiresAt: Date? = nil,
        scope: String? = nil,
        tokenType: String = "DPoP",
        dpopKey: DPoPKeySerialization
    ) {
        self.did = did
        self.handle = handle
        self.pds = pds
        self.issuer = issuer
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.scope = scope
        self.tokenType = tokenType
        self.dpopKey = dpopKey
    }

    /// Whether the access token should be refreshed before use. The leeway
    /// mirrors the reference client, which refreshes a token that expires
    /// within the next minute rather than racing the server's clock. A
    /// session with no `expiresAt` is never considered expired here; the
    /// server's 401 is the signal in that case.
    public func isExpired(now: Date = Date(), leeway: TimeInterval = 60) -> Bool {
        guard let expiresAt else { return false }
        return expiresAt.timeIntervalSince(now) <= leeway
    }

    /// Whether a refresh is even possible.
    public var canRefresh: Bool {
        guard let refreshToken else { return false }
        return !refreshToken.isEmpty
    }

    /// The granular scopes the server actually granted.
    public var grantedScopeIds: Set<ScopeId> {
        Scopes.grantedScopeIds(from: scope)
    }
}

/// What the app's session layer publishes to the view models: either
/// nobody is signed in or one account is. The models never see the key
/// material beyond what the session struct carries.
public enum SessionState: Hashable, Sendable {
    case signedOut
    case signedIn(OAuthSession)

    public var session: OAuthSession? {
        if case .signedIn(let session) = self { return session }
        return nil
    }

    public var isSignedIn: Bool {
        session != nil
    }
}
