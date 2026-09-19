import Foundation
import XCTest
@testable import AturiCore

final class SessionStateTests: XCTestCase {
    private func session(handle: String? = "alice.test") -> OAuthSession {
        OAuthSession(
            did: "did:plc:alice",
            handle: handle,
            pds: URL(string: "https://pds.example")!,
            issuer: "https://pds.example",
            accessToken: "token",
            dpopKey: DPoPKeySerialization(format: "opaque", privateKey: Data(), publicJWK: ["kty": "EC"])
        )
    }

    func testSignedOutHasNoIdentity() {
        let state = SessionState.signedOut
        XCTAssertNil(state.did)
        XCTAssertNil(state.handle)
        XCTAssertNil(state.pds)
        XCTAssertNil(state.displayIdentifier)
        XCTAssertFalse(state.isSignedIn)
    }

    func testSignedInExposesTheAccount() {
        let state = SessionState.signedIn(session())
        XCTAssertEqual(state.did, "did:plc:alice")
        XCTAssertEqual(state.handle, "alice.test")
        XCTAssertEqual(state.pds, URL(string: "https://pds.example"))
        XCTAssertEqual(state.displayIdentifier, "alice.test")
        XCTAssertTrue(state.isSignedIn)
    }

    func testDisplayIdentifierFallsBackToTheDID() {
        XCTAssertEqual(SessionState.signedIn(session(handle: nil)).displayIdentifier, "did:plc:alice")
        XCTAssertEqual(SessionState.signedIn(session(handle: "")).displayIdentifier, "did:plc:alice")
        XCTAssertEqual(SessionState.signedIn(session(handle: "")).handle, "", "the raw handle is passed through untouched")
    }
}
