import XCTest
@testable import AturiCore

/// Ports the public-URI half of extension/lib/__tests__/urls.test.ts. Space
/// addresses are unsupported on iOS, so the space cases assert that they
/// fail closed instead of asserting the parsed space parts.
final class AtUriTests: XCTestCase {
    private let spaceRef = "at://did:plc:x/space/com.example.forum/skey1"
    private var spaceRecord: String { spaceRef + "/did:plc:y/app.bsky.feed.post/abc" }

    // MARK: parsing

    func testParsesAPublicRecord() {
        let parsed = AtUri(parsing: "at://did:plc:x/app.bsky.feed.post/abc")
        XCTAssertEqual(parsed, AtUri(repo: "did:plc:x", collection: "app.bsky.feed.post", rkey: "abc"))
        XCTAssertEqual(parsed?.isRecord, true)
    }

    func testParsesCollectionAndRepoForms() {
        XCTAssertEqual(
            AtUri(parsing: "at://did:plc:x/app.bsky.feed.post"),
            AtUri(repo: "did:plc:x", collection: "app.bsky.feed.post")
        )
        XCTAssertEqual(AtUri(parsing: "at://alice.bsky.social"), AtUri(repo: "alice.bsky.social"))
        XCTAssertEqual(AtUri(parsing: "at://alice.bsky.social")?.isRecord, false)
        XCTAssertEqual(AtUri(parsing: "at://did:plc:x/app.bsky.feed.post")?.isRecord, false)
    }

    func testStopsTheRepoSegmentAtAQueryOrFragment() {
        XCTAssertEqual(AtUri(parsing: "at://did:plc:x?y=1"), AtUri(repo: "did:plc:x"))
        XCTAssertEqual(AtUri(parsing: "at://did:plc:x#frag"), AtUri(repo: "did:plc:x"))
        XCTAssertEqual(
            AtUri(parsing: "at://did:plc:x/app.bsky.feed.post/abc?x=1#f"),
            AtUri(repo: "did:plc:x", collection: "app.bsky.feed.post", rkey: "abc")
        )
    }

    func testIgnoresTrailingSegmentsBeyondTheRkey() {
        XCTAssertEqual(
            AtUri(parsing: "at://did:plc:x/app.bsky.feed.post/abc/extra"),
            AtUri(repo: "did:plc:x", collection: "app.bsky.feed.post", rkey: "abc")
        )
    }

    func testRejectsNonAtInput() {
        XCTAssertNil(AtUri(parsing: ""))
        XCTAssertNil(AtUri(parsing: "https://bsky.app/profile/alice"))
        XCTAssertNil(AtUri(parsing: "did:plc:x"))
        XCTAssertNil(AtUri(parsing: "at://"))
        XCTAssertNil(AtUri(parsing: "at:///app.bsky.feed.post"))
    }

    func testSpaceAddressesFailClosed() {
        XCTAssertNil(AtUri(parsing: spaceRef))
        XCTAssertNil(AtUri(parsing: spaceRecord))
        XCTAssertNil(AtUri(parsing: "at://did:plc:x/space"))
        XCTAssertNil(AtUri(parsing: "at://did:plc:x/space/foo/self"))
    }

    func testLeavesAnNsidThatStartsWithSpaceAlone() {
        XCTAssertEqual(
            AtUri(parsing: "at://did:plc:x/space.example.thing/abc"),
            AtUri(repo: "did:plc:x", collection: "space.example.thing", rkey: "abc")
        )
        XCTAssertEqual(
            AtUri(parsing: "at://did:plc:x/spaces/com.example.forum/skey1"),
            AtUri(repo: "did:plc:x", collection: "spaces", rkey: "com.example.forum")
        )
        XCTAssertEqual(explorePath(fromAtUri: "at://did:plc:x/space.example.thing/abc"), "/explore/did:plc:x/space.example.thing/abc")
        XCTAssertEqual(rkeyFromAtUri("at://did:plc:x/space.example.thing/abc"), "abc")
    }

    // MARK: description

    func testDescriptionIsTheCanonicalSpelling() {
        XCTAssertEqual(AtUri(repo: "did:plc:x").description, "at://did:plc:x")
        XCTAssertEqual(AtUri(repo: "did:plc:x", collection: "app.bsky.feed.post").description, "at://did:plc:x/app.bsky.feed.post")
        XCTAssertEqual(
            AtUri(repo: "did:plc:x", collection: "app.bsky.feed.post", rkey: "abc").description,
            "at://did:plc:x/app.bsky.feed.post/abc"
        )
        // An rkey without a collection is not addressable and is dropped, as toAtUri does.
        XCTAssertEqual(AtUri(repo: "did:plc:x", rkey: "abc").description, "at://did:plc:x")
        XCTAssertEqual(AtUri(repo: "did:plc:x", collection: "", rkey: "abc").description, "at://did:plc:x")
    }

    func testRoundTrip() {
        for text in ["at://did:plc:x", "at://alice.test/app.bsky.feed.post", "at://did:web:example.com/com.example.thing/r-1"] {
            XCTAssertEqual(AtUri(parsing: text)?.description, text)
        }
    }

    // MARK: rkeyFromAtUri

    func testReadsRkeysOffPublicURIs() {
        XCTAssertEqual(rkeyFromAtUri("at://did:plc:x/app.bsky.feed.post/abc"), "abc")
        XCTAssertNil(rkeyFromAtUri("at://did:plc:x/app.bsky.feed.post"))
        XCTAssertNil(rkeyFromAtUri("at://did:plc:x"))
        XCTAssertNil(rkeyFromAtUri(nil))
        XCTAssertNil(rkeyFromAtUri(""))
        XCTAssertEqual(rkeyFromAtUri("at://did:plc:x/app.bsky.feed.post/abc?x=1"), "abc")
    }

    func testRkeyOfASpaceAddressIsNil() {
        XCTAssertNil(rkeyFromAtUri(spaceRecord), "the third segment of a space URI is the space type, not an rkey")
        XCTAssertNil(rkeyFromAtUri(spaceRef))
    }

    // MARK: encodeRepo

    func testEncodeRepoOnlyEscapesQueryAndFragmentCharacters() {
        XCTAssertEqual(encodeRepo("did:plc:abc"), "did:plc:abc")
        XCTAssertEqual(encodeRepo("alice.bsky.social"), "alice.bsky.social")
        XCTAssertEqual(encodeRepo("a?b#c"), "a%3Fb%23c")
        XCTAssertEqual(encodeRepo(nil), "")
        XCTAssertEqual(encodeRepo(""), "")
    }

    // MARK: explorePath

    func testMapsPublicURIsToExplorerPaths() {
        XCTAssertEqual(explorePath(fromAtUri: "at://did:plc:x/app.bsky.feed.post/abc"), "/explore/did:plc:x/app.bsky.feed.post/abc")
        XCTAssertEqual(explorePath(fromAtUri: "at://did:plc:x/app.bsky.feed.post"), "/explore/did:plc:x/app.bsky.feed.post")
        XCTAssertEqual(explorePath(fromAtUri: "at://did:plc:x"), "/explore/did:plc:x")
        XCTAssertEqual(explorePath(fromAtUri: "did:plc:x"), "/explore/did:plc:x")
        XCTAssertNil(explorePath(fromAtUri: ""))
        XCTAssertNil(explorePath(fromAtUri: nil))
        XCTAssertNil(explorePath(fromAtUri: "https://bsky.app/profile/x"))
    }

    func testExplorePathStopsTheRepoAtAQueryOrFragment() {
        XCTAssertEqual(explorePath(fromAtUri: "at://did:plc:x?y=1"), "/explore/did:plc:x")
        XCTAssertEqual(explorePath(fromAtUri: "at://did:plc:x#frag"), "/explore/did:plc:x")
    }

    func testExplorePathEncodesTheRkeyAndTheRepo() {
        // The repo segment stops at ? and #, so encodeRepo never sees them
        // from a parsed URI; it guards repos that arrive by other routes.
        XCTAssertEqual(explorePath(fromAtUri: "at://a?b/app.bsky.feed.post/x"), "/explore/a")
        XCTAssertEqual(explorePath(fromAtUri: "at://alice.bsky.social/app.bsky.feed.post/x"), "/explore/alice.bsky.social/app.bsky.feed.post/x")
        XCTAssertEqual(explorePath(fromAtUri: "at://did:plc:x/app.bsky.feed.post/r%20k"), "/explore/did:plc:x/app.bsky.feed.post/r%2520k")
        XCTAssertEqual(explorePath(fromAtUri: "at://did:plc:x/app.bsky.feed.post/a:b~c"), "/explore/did:plc:x/app.bsky.feed.post/a%3Ab~c")
    }

    func testExplorePathOfASpaceAddressIsNil() {
        XCTAssertNil(explorePath(fromAtUri: spaceRef))
        XCTAssertNil(explorePath(fromAtUri: spaceRecord))
        XCTAssertNil(explorePath(fromAtUri: "at://alice.example.com/space/com.example.foo/self"))
        XCTAssertNil(explorePath(fromAtUri: "at://did:plc:x/space"))
    }

    // MARK: shortDid

    func testShortDid() {
        XCTAssertEqual(shortDid("did:plc:z72i7hdynmk6r22z27h6tvur"), "did:plc:z72i\u{2026}tvur")
        XCTAssertEqual(shortDid("did:plc:abcdefghij"), "did:plc:abcdefghij", "18 characters or fewer stay whole")
        XCTAssertEqual(shortDid("did:web:example.com"), "did:web:example.com")
        XCTAssertEqual(shortDid("alice.bsky.social"), "alice.bsky.social")
        XCTAssertEqual(shortDid(nil), "")
        XCTAssertEqual(shortDid(""), "")
    }

    // MARK: validators

    func testValidatesDids() {
        XCTAssertTrue(isValidDid("did:plc:x"))
        XCTAssertTrue(isValidDid("did:web:example.com"))
        XCTAssertTrue(isValidDid("did:plc:z72i7hdynmk6r22z27h6tvur"))
        XCTAssertFalse(isValidDid("alice.bsky.social"))
        XCTAssertFalse(isValidDid("did:plc:"))
        XCTAssertFalse(isValidDid("did:PLC:x"))
        XCTAssertFalse(isValidDid("did:plc:x:"))
        XCTAssertFalse(isValidDid("did:plc:" + String(repeating: "a", count: 2048)))
    }

    func testValidatesNsids() {
        XCTAssertTrue(isValidNsid("com.example.forum"))
        XCTAssertTrue(isValidNsid("app.bsky.feed.post"))
        XCTAssertTrue(isValidNsid("com.atproto.repo.getRecord"))
        XCTAssertTrue(isValidNsid("net.users.bob.ping2"))
        XCTAssertFalse(isValidNsid("foo"))
        XCTAssertFalse(isValidNsid("com.example"))
        XCTAssertFalse(isValidNsid("com.example.1forum"))
        XCTAssertFalse(isValidNsid("com.example.for-um"))
        XCTAssertFalse(isValidNsid("1com.example.forum"))
        XCTAssertFalse(isValidNsid("com.-example.forum"))
        XCTAssertFalse(isValidNsid("com.example-.forum"))
        XCTAssertFalse(isValidNsid("com..forum"))
        XCTAssertFalse(isValidNsid(".com.example.forum"))
        XCTAssertFalse(isValidNsid("com.example.forum."))
        XCTAssertFalse(isValidNsid("com.exa mple.forum"))
        XCTAssertFalse(isValidNsid("com.example." + String(repeating: "a", count: 64)))
        XCTAssertFalse(isValidNsid(""))
    }

    func testValidatesRecordKeys() {
        XCTAssertTrue(isValidRecordKey("self"))
        XCTAssertTrue(isValidRecordKey("3k7abc"))
        XCTAssertTrue(isValidRecordKey("a.b_c~d:e-f"))
        XCTAssertFalse(isValidRecordKey("."))
        XCTAssertFalse(isValidRecordKey(".."))
        XCTAssertFalse(isValidRecordKey("a/b"))
        XCTAssertFalse(isValidRecordKey(""))
        XCTAssertFalse(isValidRecordKey("a b"))
        XCTAssertFalse(isValidRecordKey(String(repeating: "a", count: 513)))
        XCTAssertTrue(isValidRecordKey(String(repeating: "a", count: 512)))
    }

    func testValidatesHandles() {
        XCTAssertTrue(isValidHandle("alice.bsky.social"))
        XCTAssertTrue(isValidHandle("dame.is"))
        XCTAssertTrue(isValidHandle("aturi.to"))
        XCTAssertTrue(isValidHandle("my-name.example.com"))
        XCTAssertTrue(isValidHandle("8.example.com"))
        XCTAssertFalse(isValidHandle("alice"), "needs at least one dot")
        XCTAssertFalse(isValidHandle("alice bsky.social"))
        XCTAssertFalse(isValidHandle("did:plc:x"))
        XCTAssertFalse(isValidHandle("@alice.bsky.social"))
        XCTAssertFalse(isValidHandle("alice..social"))
        XCTAssertFalse(isValidHandle(".alice.social"))
        XCTAssertFalse(isValidHandle("alice.social."))
        XCTAssertFalse(isValidHandle("-alice.social"))
        XCTAssertFalse(isValidHandle("alice.123"), "TLD must start with a letter")
        XCTAssertFalse(isValidHandle(""))
        XCTAssertFalse(isValidHandle(String(repeating: "a", count: 250) + ".com"))
    }
}
