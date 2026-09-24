import XCTest
@testable import AturiCore

final class ScopesTests: XCTestCase {
    /// Pinned against `IOS_METADATA_SCOPE` in `src/lib/__tests__/iosApp.test.ts`.
    /// If either side changes, the other must, or sign-in fails PAR
    /// validation with an unknown-scope error.
    func testMetadataScopeMatchesTheWebPin() {
        XCTAssertEqual(
            Scopes.metadataScope,
            "atproto rpc:*?aud=did:web:api.bsky.app%23bsky_appview repo:*?action=create repo:*?action=update repo:*?action=delete blob:*/*"
        )
    }

    func testBaseScopeIsAtprotoPlusAppViewRPC() {
        XCTAssertEqual(Scopes.baseScope, "atproto rpc:*?aud=did:web:api.bsky.app%23bsky_appview")
        XCTAssertTrue(Scopes.baseScope.hasPrefix("atproto "))
    }

    func testTableHasTheFourNonSpaceRowsInPickerOrder() {
        XCTAssertEqual(Scopes.granular.map(\.id), [.create, .update, .delete, .blob])
        XCTAssertEqual(Scopes.granular.map(\.scope), [
            "repo:*?action=create", "repo:*?action=update", "repo:*?action=delete", "blob:*/*",
        ])
        XCTAssertEqual(Scopes.granular.map(\.label), ["Create", "Update", "Delete", "Upload"])
        XCTAssertTrue(Scopes.granular.allSatisfy(\.defaultOn))
        XCTAssertFalse(Scopes.granular.contains { $0.scope.hasPrefix("space:") })
    }

    func testDefaultsAreEverythingBecauseNoSpaceRowsRemain() {
        XCTAssertEqual(Scopes.defaultScopeIds, Set(ScopeId.allCases))
        XCTAssertEqual(Scopes.allScopeIds, Set(ScopeId.allCases))
    }

    func testBuildScopeStringWithEverythingEqualsTheMetadataScope() {
        // The runtime request must be a subset of the metadata string; with
        // every row ticked it is the same string.
        XCTAssertEqual(Scopes.buildScopeString(Scopes.defaultScopeIds), Scopes.metadataScope)
    }

    func testBuildScopeStringFollowsTableOrderNotSelectionOrder() {
        XCTAssertEqual(
            Scopes.buildScopeString([.blob, .create]),
            "atproto rpc:*?aud=did:web:api.bsky.app%23bsky_appview repo:*?action=create blob:*/*"
        )
    }

    func testBuildScopeStringWithNothingSelectedIsTheBaseScope() {
        XCTAssertEqual(Scopes.buildScopeString([]), Scopes.baseScope)
    }

    func testEveryRuntimeTokenIsDeclaredInTheMetadata() {
        let declared = Set(Scopes.metadataScope.split(separator: " "))
        for selection in [Set<ScopeId>([.create]), [.update, .delete], [.blob], Scopes.allScopeIds] {
            for token in Scopes.buildScopeString(selection).split(separator: " ") {
                XCTAssertTrue(declared.contains(token), "\(token) is not advertised")
            }
        }
    }

    func testGrantedScopeIdsReadsBackTheTokenScopeClaim() {
        XCTAssertEqual(
            Scopes.grantedScopeIds(from: "atproto rpc:*?aud=did:web:api.bsky.app%23bsky_appview repo:*?action=create blob:*/*"),
            [.create, .blob]
        )
        XCTAssertEqual(Scopes.grantedScopeIds(from: "atproto"), [])
        XCTAssertEqual(Scopes.grantedScopeIds(from: nil), [])
        XCTAssertEqual(Scopes.grantedScopeIds(from: ""), [])
        // A narrowed or rewritten token is not a granted row.
        XCTAssertEqual(Scopes.grantedScopeIds(from: "atproto repo:app.bsky.feed.post?action=create"), [])
    }

    func testHasBaseScope() {
        XCTAssertTrue(Scopes.hasBaseScope("atproto"))
        XCTAssertTrue(Scopes.hasBaseScope("repo:*?action=create atproto"))
        XCTAssertFalse(Scopes.hasBaseScope("atprotocol"))
        XCTAssertFalse(Scopes.hasBaseScope(nil))
        XCTAssertFalse(Scopes.hasBaseScope(""))
    }

    func testScopeIdRawValuesMatchTheWebIds() {
        XCTAssertEqual(ScopeId.allCases.map(\.rawValue), ["create", "update", "delete", "blob"])
    }
}
