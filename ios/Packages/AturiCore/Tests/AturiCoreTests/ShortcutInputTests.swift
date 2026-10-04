import XCTest
@testable import AturiCore

final class ShortcutInputTests: XCTestCase {
    // MARK: Normalisation

    func testSpokenHandlesAreRewritten() {
        XCTAssertEqual(ShortcutInput.normalized("dame dot is"), "dame.is")
        XCTAssertEqual(ShortcutInput.normalized("  Alice dot B sky dot Social "), "alice.bsky.social")
        XCTAssertEqual(ShortcutInput.normalized("at dame dot is"), "dame.is", "a leading 'at' is the spoken @")
        XCTAssertEqual(ShortcutInput.normalized("at dot proto dot com"), "at.proto.com", "unless it is the first label")
    }

    func testTypedInputIsOnlyTrimmed() {
        XCTAssertEqual(ShortcutInput.normalized("  alice.bsky.social\n"), "alice.bsky.social")
        XCTAssertEqual(ShortcutInput.normalized("did:plc:alice123"), "did:plc:alice123")
        XCTAssertEqual(ShortcutInput.normalized("https://bsky.app/profile/dot.dot"), "https://bsky.app/profile/dot.dot")
        XCTAssertEqual(ShortcutInput.normalized("dot com"), "dot com", "too short to be a spoken handle")
        XCTAssertEqual(ShortcutInput.normalized("dame dot"), "dame dot")
        XCTAssertEqual(ShortcutInput.normalized("search for cats"), "search for cats")
    }

    // MARK: Accounts

    func testAccountIdentifierReadsEverySpelling() {
        XCTAssertEqual(ShortcutInput.accountIdentifier(from: "alice.bsky.social"), "alice.bsky.social")
        XCTAssertEqual(ShortcutInput.accountIdentifier(from: "@Alice.Bsky.Social"), "alice.bsky.social", "@ dropped, handle lowercased")
        XCTAssertEqual(ShortcutInput.accountIdentifier(from: "did:plc:alice123"), "did:plc:alice123")
        XCTAssertEqual(ShortcutInput.accountIdentifier(from: "at://did:plc:alice123/app.bsky.feed.post/3kabc"), "did:plc:alice123")
        XCTAssertEqual(ShortcutInput.accountIdentifier(from: "https://bsky.app/profile/alice.test/post/3kabc"), "alice.test")
        XCTAssertEqual(ShortcutInput.accountIdentifier(from: "https://aturi.to/profile/did:plc:alice123"), "did:plc:alice123")
        XCTAssertEqual(ShortcutInput.accountIdentifier(from: "dame dot is"), "dame.is")
    }

    func testAccountIdentifierRefusesWhatIsNotOne() {
        XCTAssertNil(ShortcutInput.accountIdentifier(from: ""))
        XCTAssertNil(ShortcutInput.accountIdentifier(from: "not a link"))
        XCTAssertNil(ShortcutInput.accountIdentifier(from: "alice"))
        XCTAssertNil(ShortcutInput.accountIdentifier(from: "https://example.com/"))
    }

    // MARK: aturi.to links

    func testAturiLinkIsBuiltOfflineFromTheInput() {
        XCTAssertEqual(ShortcutInput.aturiLink(from: "https://bsky.app/profile/alice.test/post/3kabc"), "https://aturi.to/profile/alice.test/post/3kabc")
        XCTAssertEqual(ShortcutInput.aturiLink(from: "https://bsky.app/profile/alice.test/lists/3klist"), "https://aturi.to/profile/alice.test/lists/3klist")
        XCTAssertEqual(ShortcutInput.aturiLink(from: "at://did:plc:alice123/com.example.thing/abc"), "https://aturi.to/profile/did:plc:alice123/com.example.thing/abc")
        XCTAssertEqual(ShortcutInput.aturiLink(from: "@alice.test"), "https://aturi.to/profile/alice.test")
        XCTAssertEqual(ShortcutInput.aturiLink(from: "did:plc:alice123"), "https://aturi.to/profile/did:plc:alice123")
    }

    func testAturiLinkRefusesInputThatNamesNothing() {
        XCTAssertNil(ShortcutInput.aturiLink(from: ""))
        XCTAssertNil(ShortcutInput.aturiLink(from: "not a link"))
        XCTAssertNil(ShortcutInput.aturiLink(from: "at://did:plc:alice123/space/com.example.forum"), "a space address has no public page")
    }

    // MARK: Lexicons

    func testLexiconTargets() {
        XCTAssertEqual(ShortcutInput.lexiconTarget(from: " app.bsky.feed.post "), .lexicon(nsid: "app.bsky.feed.post"))
        XCTAssertEqual(ShortcutInput.lexiconTarget(from: "app.bsky.feed.*"), .group(prefix: "app.bsky.feed"))
        XCTAssertEqual(ShortcutInput.lexiconTarget(from: "app.bsky"), .group(prefix: "app.bsky"))
        XCTAssertEqual(ShortcutInput.lexiconTarget(from: "app dot bsky dot feed dot post"), .lexicon(nsid: "app.bsky.feed.post"))
    }

    func testLexiconTargetRefusesWhatCannotBeOne() {
        XCTAssertNil(ShortcutInput.lexiconTarget(from: ""))
        XCTAssertNil(ShortcutInput.lexiconTarget(from: "app"))
        XCTAssertNil(ShortcutInput.lexiconTarget(from: "app.*"))
        XCTAssertNil(ShortcutInput.lexiconTarget(from: "not an nsid"))
        XCTAssertNil(ShortcutInput.lexiconTarget(from: "https://example.com/app.bsky.feed.post"))
    }
}
