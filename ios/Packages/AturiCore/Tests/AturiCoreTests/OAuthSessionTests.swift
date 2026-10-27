import XCTest
@testable import AturiCore

final class OAuthSessionTests: XCTestCase {
    private let key = DPoPKeySerialization(
        privateKey: Data([1, 2, 3, 4]),
        publicJWK: ["kty": "EC", "crv": "P-256", "x": "eA", "y": "eQ"]
    )

    private func session(expiresAt: Date?) -> OAuthSession {
        OAuthSession(
            did: "did:plc:test123",
            handle: "alice.test",
            pds: URL(string: "https://pds.test")!,
            issuer: "https://auth.test",
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt: expiresAt,
            scope: "atproto rpc:*?aud=did:web:api.bsky.app%23bsky_appview repo:*?action=create",
            dpopKey: key
        )
    }

    func testIsExpiredUsesALeewayBeforeTheDeadline() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        XCTAssertFalse(session(expiresAt: now.addingTimeInterval(3600)).isExpired(now: now))
        XCTAssertTrue(session(expiresAt: now.addingTimeInterval(-1)).isExpired(now: now))
        XCTAssertTrue(session(expiresAt: now.addingTimeInterval(59)).isExpired(now: now), "inside the minute of leeway")
        XCTAssertTrue(session(expiresAt: now.addingTimeInterval(60)).isExpired(now: now))
        XCTAssertFalse(session(expiresAt: now.addingTimeInterval(61)).isExpired(now: now))
        XCTAssertFalse(session(expiresAt: now.addingTimeInterval(5)).isExpired(now: now, leeway: 0))
        XCTAssertTrue(session(expiresAt: now.addingTimeInterval(5)).isExpired(now: now, leeway: 10))
    }

    func testNoExpiryIsNeverExpiredHere() {
        XCTAssertFalse(session(expiresAt: nil).isExpired())
    }

    func testCanRefreshNeedsANonEmptyRefreshToken() {
        var s = session(expiresAt: nil)
        XCTAssertTrue(s.canRefresh)
        s.refreshToken = ""
        XCTAssertFalse(s.canRefresh)
        s.refreshToken = nil
        XCTAssertFalse(s.canRefresh)
    }

    func testDefaultTokenTypeIsDPoP() {
        XCTAssertEqual(session(expiresAt: nil).tokenType, "DPoP")
    }

    func testGrantedScopeIdsComeFromTheScopeClaim() {
        XCTAssertEqual(session(expiresAt: nil).grantedScopeIds, [.create])
        var s = session(expiresAt: nil)
        s.scope = nil
        XCTAssertEqual(s.grantedScopeIds, [])
    }

    func testCodableRoundTripKeepsEveryField() throws {
        let original = session(expiresAt: Date(timeIntervalSince1970: 1_700_000_000))
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(OAuthSession.self, from: data)
        XCTAssertEqual(decoded, original)
        let json = try JSONValue.parse(data)
        XCTAssertEqual(json["did"]?.stringValue, "did:plc:test123")
        XCTAssertEqual(json["pds"]?.stringValue, "https://pds.test")
        XCTAssertEqual(json["dpopKey"]?["privateKey"]?.stringValue, Data([1, 2, 3, 4]).base64EncodedString())
        XCTAssertEqual(json["dpopKey"]?["publicJWK"]?["x"]?.stringValue, "eA")
    }

    func testOptionalFieldsDecodeWhenAbsent() throws {
        let minimal = #"{"did":"did:plc:x","pds":"https://pds.test","issuer":"https://auth.test","accessToken":"a","tokenType":"DPoP","dpopKey":{"format":"pkcs8","privateKey":"","publicJWK":{}}}"#
        let decoded = try JSONDecoder().decode(OAuthSession.self, from: Data(minimal.utf8))
        XCTAssertNil(decoded.handle)
        XCTAssertNil(decoded.refreshToken)
        XCTAssertNil(decoded.expiresAt)
        XCTAssertNil(decoded.scope)
        XCTAssertFalse(decoded.canRefresh)
        XCTAssertFalse(decoded.isExpired())
    }

    func testSessionStateAccessors() {
        let s = session(expiresAt: nil)
        XCTAssertNil(SessionState.signedOut.session)
        XCTAssertFalse(SessionState.signedOut.isSignedIn)
        XCTAssertEqual(SessionState.signedIn(s).session, s)
        XCTAssertTrue(SessionState.signedIn(s).isSignedIn)
        XCTAssertNotEqual(SessionState.signedIn(s), .signedOut)
    }
}
